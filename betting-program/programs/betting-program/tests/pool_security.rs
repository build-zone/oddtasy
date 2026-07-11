//! Security and invariant tests for the pari-mutuel pool program.
//!
//! Run:
//!   anchor build
//!   cargo test --test pool_security
//!
//! Self-contained (helpers duplicated from pool_lifecycle.rs on purpose, so this
//! file compiles independently). If you'd rather DRY it up later, move the shared
//! helpers into tests/common/mod.rs and `mod common;` from both files.
//!
//! Focus here is what the happy-path suite does not prove: money is conserved to
//! the lamport, one pool cannot touch another's funds, only the right signer can
//! move money, the state machine rejects out-of-order calls, and create-time
//! validation holds.

#![allow(dead_code)]

use {
    anchor_lang::{
        solana_program::{instruction::Instruction, pubkey::Pubkey, system_program},
        InstructionData, ToAccountMetas,
    },
    litesvm::{types::TransactionResult, LiteSVM},
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    std::str::FromStr,
};

const SOL: u64 = 1_000_000_000;
const USDC_UNIT: u64 = 1_000_000;
const DEADLINE: i64 = 2_000_000_000;

fn usdc(whole: u64) -> u64 {
    whole * USDC_UNIT
}

fn token_program() -> Pubkey {
    Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap()
}

fn token_account_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1;
    d
}

fn mint_data(authority: &Pubkey, decimals: u8) -> Vec<u8> {
    let mut d = vec![0u8; 82];
    d[0..4].copy_from_slice(&1u32.to_le_bytes());
    d[4..36].copy_from_slice(authority.as_ref());
    d[44] = decimals;
    d[45] = 1;
    d
}

fn set_spl(svm: &mut LiteSVM, key: Pubkey, data: Vec<u8>) {
    svm.set_account(
        key,
        Account { lamports: 10_000_000, data, owner: token_program(), executable: false, rent_epoch: 0 },
    )
    .unwrap();
}

fn balance(svm: &LiteSVM, ta: &Pubkey) -> u64 {
    let acc = svm.get_account(ta).expect("token account missing");
    u64::from_le_bytes(acc.data[64..72].try_into().unwrap())
}

fn config_pda(pid: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"config"], pid).0
}
fn pool_pda(pid: &Pubkey, id: &[u8; 16]) -> Pubkey {
    Pubkey::find_program_address(&[b"pool", id], pid).0
}
fn vault_pda(pid: &Pubkey, id: &[u8; 16]) -> Pubkey {
    Pubkey::find_program_address(&[b"vault", id], pid).0
}
fn entry_pda(pid: &Pubkey, id: &[u8; 16], member: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"entry", id, member.as_ref()], pid).0
}

fn new_id() -> [u8; 16] {
    Keypair::new().pubkey().to_bytes()[..16].try_into().unwrap()
}

fn send(svm: &mut LiteSVM, ix: Instruction, signer: &Keypair) -> TransactionResult {
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    svm.send_transaction(tx)
}

fn send_ok(svm: &mut LiteSVM, ix: Instruction, signer: &Keypair) {
    if let Err(f) = send(svm, ix, signer) {
        panic!("tx failed: {:?}\nlogs:\n{}", f.err, f.meta.logs.join("\n"));
    }
}

fn expect_log(res: TransactionResult, needle: &str) {
    match res {
        Ok(_) => panic!("expected failure containing '{needle}', but tx succeeded"),
        Err(f) => {
            let combined = format!("{:?}\n{}", f.err, f.meta.logs.join("\n"));
            assert!(combined.contains(needle), "expected '{needle}' in:\n{combined}");
        }
    }
}

/// Advance the clock and expire the blockhash so a re-sent (otherwise identical)
/// transaction gets a new signature and actually executes instead of being
/// deduplicated by the runtime as AlreadyProcessed.
fn warp(svm: &mut LiteSVM) {
    let mut clock = svm.get_sysvar::<anchor_lang::solana_program::clock::Clock>();
    clock.slot += 1;
    clock.unix_timestamp += 1;
    svm.set_sysvar(&clock);
    svm.expire_blockhash();
}

struct Ctx {
    svm: LiteSVM,
    pid: Pubkey,
    mint: Pubkey,
    treasury: Pubkey,
    admin: Keypair,
    resolver: Keypair,
}

fn setup() -> Ctx {
    let pid = betting_program::id();
    let mut svm = LiteSVM::new();
    let so = include_bytes!("../../../target/deploy/betting_program.so");
    svm.add_program(pid, so).unwrap();

    let admin = Keypair::new();
    let resolver = Keypair::new();
    svm.airdrop(&admin.pubkey(), 100 * SOL).unwrap();
    svm.airdrop(&resolver.pubkey(), 100 * SOL).unwrap();

    let mint = Keypair::new().pubkey();
    set_spl(&mut svm, mint, mint_data(&admin.pubkey(), 6));

    let treasury = Keypair::new().pubkey();
    set_spl(&mut svm, treasury, token_account_data(&mint, &admin.pubkey(), 0));

    let ix = Instruction::new_with_bytes(
        pid,
        &betting_program::instruction::InitializeConfig {
            resolver_authority: resolver.pubkey(),
            treasury,
        }
        .data(),
        betting_program::accounts::InitializeConfig {
            admin: admin.pubkey(),
            config: config_pda(&pid),
            usdc_mint: mint,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_ok(&mut svm, ix, &admin);

    Ctx { svm, pid, mint, treasury, admin, resolver }
}

fn make_wallet(svm: &mut LiteSVM) -> Keypair {
    let kp = Keypair::new();
    svm.airdrop(&kp.pubkey(), 10 * SOL).unwrap();
    kp
}

fn make_member(svm: &mut LiteSVM, mint: &Pubkey, usdc_whole: u64) -> (Keypair, Pubkey) {
    let kp = make_wallet(svm);
    let ta = Keypair::new().pubkey();
    set_spl(svm, ta, token_account_data(mint, &kp.pubkey(), usdc(usdc_whole)));
    (kp, ta)
}

#[allow(clippy::too_many_arguments)]
fn ix_create_pool(
    ctx: &Ctx, id: &[u8; 16], host: &Keypair,
    outcome_count: u16, stake: u64, rake_bps: u16, max_entries: u32,
) -> Instruction {
    Instruction::new_with_bytes(
        ctx.pid,
        &betting_program::instruction::CreatePool {
            pool_id: *id, market_type: 0, market_param: 0, outcome_count,
            stake_amount: stake, rake_bps, max_entries, deadline: DEADLINE,
        }
        .data(),
        betting_program::accounts::CreatePool {
            host: host.pubkey(),
            config: config_pda(&ctx.pid),
            pool: pool_pda(&ctx.pid, id),
            vault: vault_pda(&ctx.pid, id),
            usdc_mint: ctx.mint,
            token_program: token_program(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn ix_enter(ctx: &Ctx, id: &[u8; 16], member: &Keypair, ta: Pubkey, prediction: u16) -> Instruction {
    Instruction::new_with_bytes(
        ctx.pid,
        &betting_program::instruction::EnterPool { pool_id: *id, prediction }.data(),
        betting_program::accounts::EnterPool {
            member: member.pubkey(),
            pool: pool_pda(&ctx.pid, id),
            vault: vault_pda(&ctx.pid, id),
            entry: entry_pda(&ctx.pid, id, &member.pubkey()),
            member_token_account: ta,
            token_program: token_program(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn ix_lock(ctx: &Ctx, id: &[u8; 16], resolver: &Keypair) -> Instruction {
    Instruction::new_with_bytes(
        ctx.pid,
        &betting_program::instruction::LockPool { pool_id: *id }.data(),
        betting_program::accounts::LockPool {
            resolver: resolver.pubkey(),
            config: config_pda(&ctx.pid),
            pool: pool_pda(&ctx.pid, id),
        }
        .to_account_metas(None),
    )
}

fn ix_resolve_with(
    ctx: &Ctx, id: &[u8; 16], resolver: &Keypair, treasury: Pubkey,
    winning_outcome: u16, winner_count: u32,
) -> Instruction {
    Instruction::new_with_bytes(
        ctx.pid,
        &betting_program::instruction::ResolvePool { pool_id: *id, winning_outcome, winner_count }.data(),
        betting_program::accounts::ResolvePool {
            resolver: resolver.pubkey(),
            config: config_pda(&ctx.pid),
            pool: pool_pda(&ctx.pid, id),
            vault: vault_pda(&ctx.pid, id),
            treasury,
            token_program: token_program(),
        }
        .to_account_metas(None),
    )
}

fn ix_claim_with(
    ctx: &Ctx, id: &[u8; 16], member: &Keypair, vault: Pubkey, member_ta: Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        ctx.pid,
        &betting_program::instruction::ClaimWinnings { pool_id: *id }.data(),
        betting_program::accounts::ClaimWinnings {
            member: member.pubkey(),
            pool: pool_pda(&ctx.pid, id),
            vault,
            entry: entry_pda(&ctx.pid, id, &member.pubkey()),
            member_token_account: member_ta,
            token_program: token_program(),
        }
        .to_account_metas(None),
    )
}

fn ix_cancel(ctx: &Ctx, id: &[u8; 16], authority: &Keypair) -> Instruction {
    Instruction::new_with_bytes(
        ctx.pid,
        &betting_program::instruction::CancelPool { pool_id: *id }.data(),
        betting_program::accounts::CancelPool {
            authority: authority.pubkey(),
            config: config_pda(&ctx.pid),
            pool: pool_pda(&ctx.pid, id),
        }
        .to_account_metas(None),
    )
}

fn ix_refund(ctx: &Ctx, id: &[u8; 16], member: &Keypair, ta: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        ctx.pid,
        &betting_program::instruction::ClaimRefund { pool_id: *id }.data(),
        betting_program::accounts::ClaimRefund {
            member: member.pubkey(),
            pool: pool_pda(&ctx.pid, id),
            vault: vault_pda(&ctx.pid, id),
            entry: entry_pda(&ctx.pid, id, &member.pubkey()),
            member_token_account: ta,
            token_program: token_program(),
        }
        .to_account_metas(None),
    )
}

// Convenience: create -> N enter -> lock -> resolve, returns the pool id and the
// member (keypair, ta, prediction) list so callers can claim/inspect.
fn run_pool(
    ctx: &mut Ctx, host: &Keypair, resolver: &Keypair,
    outcome_count: u16, stake: u64, rake_bps: u16, max_entries: u32,
    picks: &[(u64, u16)], // (starting USDC, prediction)
    winning_outcome: u16, winner_count: u32,
) -> ([u8; 16], Vec<(Keypair, Pubkey, u16)>) {
    let id = new_id();
    let ix = ix_create_pool(ctx, &id, host, outcome_count, stake, rake_bps, max_entries);
    send_ok(&mut ctx.svm, ix, host);

    let mut members = Vec::new();
    for (start, pred) in picks {
        let (kp, ta) = make_member(&mut ctx.svm, &ctx.mint, *start);
        let ix = ix_enter(ctx, &id, &kp, ta, *pred);
        send_ok(&mut ctx.svm, ix, &kp);
        members.push((kp, ta, *pred));
    }

    let ix = ix_lock(ctx, &id, resolver);
    send_ok(&mut ctx.svm, ix, resolver);
    let ix = ix_resolve_with(ctx, &id, resolver, ctx.treasury, winning_outcome, winner_count);
    send_ok(&mut ctx.svm, ix, resolver);

    (id, members)
}

// ============================ invariants ============================

#[test]
fn conservation_of_funds_holds() {
    // 5 entrants at 7 USDC, 2.5% rake, 3 pick the winning outcome. After all
    // winners claim, the total USDC across every account must be unchanged.
    let mut ctx = setup();
    let host = make_wallet(&mut ctx.svm);
    let resolver = ctx.resolver.insecure_clone();

    let picks = [(100u64, 0u16), (100, 0), (100, 0), (100, 1), (100, 2)];
    let (id, members) = run_pool(&mut ctx, &host, &resolver, 3, usdc(7), 250, 10, &picks, 0, 3);

    for (kp, ta, pred) in &members {
        if *pred == 0 {
            let ix = ix_claim_with(&ctx, &id, kp, vault_pda(&ctx.pid, &id), *ta);
            send_ok(&mut ctx.svm, ix, kp);
        }
    }

    let total_across_accounts: u64 = members.iter().map(|(_, ta, _)| balance(&ctx.svm, ta)).sum::<u64>()
        + balance(&ctx.svm, &ctx.treasury)
        + balance(&ctx.svm, &vault_pda(&ctx.pid, &id));

    assert_eq!(total_across_accounts, usdc(500), "USDC was created or destroyed");
    assert_eq!(balance(&ctx.svm, &vault_pda(&ctx.pid, &id)), 0, "vault should be empty");
}

#[test]
fn everyone_wins_still_conserves() {
    let mut ctx = setup();
    let host = make_wallet(&mut ctx.svm);
    let resolver = ctx.resolver.insecure_clone();

    let picks = [(50u64, 0u16), (50, 0), (50, 0), (50, 0)];
    let (id, members) = run_pool(&mut ctx, &host, &resolver, 3, usdc(5), 500, 10, &picks, 0, 4);

    for (kp, ta, _) in &members {
        let ix = ix_claim_with(&ctx, &id, kp, vault_pda(&ctx.pid, &id), *ta);
        send_ok(&mut ctx.svm, ix, kp);
    }

    let total: u64 = members.iter().map(|(_, ta, _)| balance(&ctx.svm, ta)).sum::<u64>()
        + balance(&ctx.svm, &ctx.treasury)
        + balance(&ctx.svm, &vault_pda(&ctx.pid, &id));
    assert_eq!(total, usdc(200));
    assert_eq!(balance(&ctx.svm, &vault_pda(&ctx.pid, &id)), 0);
}

#[test]
fn single_winner_takes_pot_minus_rake() {
    let mut ctx = setup();
    let host = make_wallet(&mut ctx.svm);
    let resolver = ctx.resolver.insecure_clone();

    // 3 entrants at 10 USDC, 10% rake, exactly one winner.
    let picks = [(100u64, 0u16), (100, 1), (100, 2)];
    let (id, members) = run_pool(&mut ctx, &host, &resolver, 3, usdc(10), 1000, 10, &picks, 0, 1);

    let (winner, w_ta, _) = &members[0];
    let ix = ix_claim_with(&ctx, &id, winner, vault_pda(&ctx.pid, &id), *w_ta);
    send_ok(&mut ctx.svm, ix, winner);

    // total 30, rake 3, winner takes 27; started 100, staked 10 -> 90 + 27 = 117
    assert_eq!(balance(&ctx.svm, w_ta), usdc(90) + usdc(27));
    assert_eq!(balance(&ctx.svm, &ctx.treasury), usdc(3));
    assert_eq!(balance(&ctx.svm, &vault_pda(&ctx.pid, &id)), 0);
}

// ============================ cross-pool / account attacks ============================

#[test]
fn cannot_claim_against_another_pools_vault() {
    let mut ctx = setup();
    let host = make_wallet(&mut ctx.svm);
    let resolver = ctx.resolver.insecure_clone();

    // Pool A: our winner.
    let (id_a, members) = run_pool(&mut ctx, &host, &resolver, 3, usdc(5), 500, 10, &[(50, 0)], 0, 1);
    let (winner, w_ta, _) = &members[0];

    // Pool B exists with its own vault.
    let id_b = new_id();
    let ix = ix_create_pool(&ctx, &id_b, &host, 3, usdc(5), 500, 10);
    send_ok(&mut ctx.svm, ix, &host);

    // Claim on A but pass B's vault. The vault seeds are bound to A's pool_id, so
    // the swapped account fails the seeds constraint.
    let ix = ix_claim_with(&ctx, &id_a, winner, vault_pda(&ctx.pid, &id_b), *w_ta);
    assert!(send(&mut ctx.svm, ix, winner).is_err(), "cross-pool vault must be rejected");

    // The legit claim still works.
    let ix = ix_claim_with(&ctx, &id_a, winner, vault_pda(&ctx.pid, &id_a), *w_ta);
    send_ok(&mut ctx.svm, ix, winner);
}

#[test]
fn cannot_claim_into_an_account_you_dont_own() {
    let mut ctx = setup();
    let host = make_wallet(&mut ctx.svm);
    let resolver = ctx.resolver.insecure_clone();

    let (id, members) = run_pool(&mut ctx, &host, &resolver, 3, usdc(5), 500, 10, &[(50, 0)], 0, 1);
    let (winner, _w_ta, _) = &members[0];

    // A token account owned by someone else.
    let (_stranger, stranger_ta) = make_member(&mut ctx.svm, &ctx.mint, 0);

    let ix = ix_claim_with(&ctx, &id, winner, vault_pda(&ctx.pid, &id), stranger_ta);
    expect_log(send(&mut ctx.svm, ix, winner), "NotOwner");
}

#[test]
fn resolve_rejects_wrong_treasury() {
    let mut ctx = setup();
    let host = make_wallet(&mut ctx.svm);
    let resolver = ctx.resolver.insecure_clone();

    let id = new_id();
    let ix = ix_create_pool(&ctx, &id, &host, 3, usdc(5), 500, 10);
    send_ok(&mut ctx.svm, ix, &host);
    let (m, ta) = make_member(&mut ctx.svm, &ctx.mint, 50);
    let ix = ix_enter(&ctx, &id, &m, ta, 0);
    send_ok(&mut ctx.svm, ix, &m);
    let ix = ix_lock(&ctx, &id, &resolver);
    send_ok(&mut ctx.svm, ix, &resolver);

    // A valid token account of the right mint, but NOT the configured treasury.
    let fake_treasury = Keypair::new().pubkey();
    set_spl(&mut ctx.svm, fake_treasury, token_account_data(&ctx.mint, &host.pubkey(), 0));

    let ix = ix_resolve_with(&ctx, &id, &resolver, fake_treasury, 0, 1);
    expect_log(send(&mut ctx.svm, ix, &resolver), "InvalidConfig");
}

#[test]
fn enter_rejects_foreign_mint_account() {
    let mut ctx = setup();
    let host = make_wallet(&mut ctx.svm);

    let id = new_id();
    let ix = ix_create_pool(&ctx, &id, &host, 3, usdc(5), 500, 10);
    send_ok(&mut ctx.svm, ix, &host);

    // A second mint and a token account on it, owned by the member.
    let other_mint = Keypair::new().pubkey();
    set_spl(&mut ctx.svm, other_mint, mint_data(&host.pubkey(), 6));
    let member = make_wallet(&mut ctx.svm);
    let foreign_ta = Keypair::new().pubkey();
    set_spl(&mut ctx.svm, foreign_ta, token_account_data(&other_mint, &member.pubkey(), usdc(50)));

    let ix = ix_enter(&ctx, &id, &member, foreign_ta, 0);
    expect_log(send(&mut ctx.svm, ix, &member), "InvalidMint");
}

// ============================ authorization boundaries ============================

#[test]
fn only_resolver_can_resolve() {
    let mut ctx = setup();
    let host = make_wallet(&mut ctx.svm);
    let resolver = ctx.resolver.insecure_clone();

    let id = new_id();
    let ix = ix_create_pool(&ctx, &id, &host, 3, usdc(5), 500, 10);
    send_ok(&mut ctx.svm, ix, &host);
    let (m, ta) = make_member(&mut ctx.svm, &ctx.mint, 50);
    let ix = ix_enter(&ctx, &id, &m, ta, 0);
    send_ok(&mut ctx.svm, ix, &m);
    let ix = ix_lock(&ctx, &id, &resolver);
    send_ok(&mut ctx.svm, ix, &resolver);

    // An impostor signs resolve.
    let impostor = make_wallet(&mut ctx.svm);
    let ix = ix_resolve_with(&ctx, &id, &impostor, ctx.treasury, 0, 1);
    expect_log(send(&mut ctx.svm, ix, &impostor), "NotResolver");
}

#[test]
fn cancel_requires_host_or_resolver() {
    let mut ctx = setup();
    let host = make_wallet(&mut ctx.svm);
    let resolver = ctx.resolver.insecure_clone();

    let id = new_id();
    let ix = ix_create_pool(&ctx, &id, &host, 3, usdc(5), 500, 10);
    send_ok(&mut ctx.svm, ix, &host);

    // A random signer cannot cancel.
    let stranger = make_wallet(&mut ctx.svm);
    let ix = ix_cancel(&ctx, &id, &stranger);
    expect_log(send(&mut ctx.svm, ix, &stranger), "NotAuthority");

    // The resolver can (backend abandonment path).
    let ix = ix_cancel(&ctx, &id, &resolver);
    send_ok(&mut ctx.svm, ix, &resolver);
}

// ============================ state-machine guards ============================

#[test]
fn claim_requires_resolved_state() {
    let mut ctx = setup();
    let host = make_wallet(&mut ctx.svm);
    let resolver = ctx.resolver.insecure_clone();

    // Open pool with an entry; claiming before resolve must fail.
    let id = new_id();
    let ix = ix_create_pool(&ctx, &id, &host, 3, usdc(5), 500, 10);
    send_ok(&mut ctx.svm, ix, &host);
    let (m, ta) = make_member(&mut ctx.svm, &ctx.mint, 50);
    let ix = ix_enter(&ctx, &id, &m, ta, 0);
    send_ok(&mut ctx.svm, ix, &m);

    let ix = ix_claim_with(&ctx, &id, &m, vault_pda(&ctx.pid, &id), ta);
    expect_log(send(&mut ctx.svm, ix, &m), "PoolNotResolved");

    // A voided pool must be refunded, not claimed.
    let id2 = new_id();
    let ix = ix_create_pool(&ctx, &id2, &host, 3, usdc(5), 500, 10);
    send_ok(&mut ctx.svm, ix, &host);
    let (m2, ta2) = make_member(&mut ctx.svm, &ctx.mint, 50);
    let ix = ix_enter(&ctx, &id2, &m2, ta2, 0);
    send_ok(&mut ctx.svm, ix, &m2);
    let ix = ix_lock(&ctx, &id2, &resolver);
    send_ok(&mut ctx.svm, ix, &resolver);
    let ix = ix_resolve_with(&ctx, &id2, &resolver, ctx.treasury, 2, 0); // Voided
    send_ok(&mut ctx.svm, ix, &resolver);

    let ix = ix_claim_with(&ctx, &id2, &m2, vault_pda(&ctx.pid, &id2), ta2);
    expect_log(send(&mut ctx.svm, ix, &m2), "PoolNotResolved");
}

#[test]
fn refund_rejects_resolved_pool() {
    let mut ctx = setup();
    let host = make_wallet(&mut ctx.svm);
    let resolver = ctx.resolver.insecure_clone();

    let (id, members) = run_pool(&mut ctx, &host, &resolver, 3, usdc(5), 500, 10, &[(50, 0)], 0, 1);
    let (m, ta, _) = &members[0];

    let ix = ix_refund(&ctx, &id, m, *ta);
    expect_log(send(&mut ctx.svm, ix, m), "NothingToRefund");
}

#[test]
fn resolve_requires_locked_and_is_single_shot() {
    let mut ctx = setup();
    let host = make_wallet(&mut ctx.svm);
    let resolver = ctx.resolver.insecure_clone();

    // Resolving an OPEN (never locked) pool is rejected.
    let id = new_id();
    let ix = ix_create_pool(&ctx, &id, &host, 3, usdc(5), 500, 10);
    send_ok(&mut ctx.svm, ix, &host);
    let (m, ta) = make_member(&mut ctx.svm, &ctx.mint, 50);
    let ix = ix_enter(&ctx, &id, &m, ta, 0);
    send_ok(&mut ctx.svm, ix, &m);
    let ix = ix_resolve_with(&ctx, &id, &resolver, ctx.treasury, 0, 1);
    expect_log(send(&mut ctx.svm, ix, &resolver), "PoolNotLocked");

    // Now lock + resolve once (ok), then resolve again must fail.
    let ix = ix_lock(&ctx, &id, &resolver);
    send_ok(&mut ctx.svm, ix, &resolver);

    warp(&mut ctx.svm);  
    let ix = ix_resolve_with(&ctx, &id, &resolver, ctx.treasury, 0, 1);
    send_ok(&mut ctx.svm, ix, &resolver);

    warp(&mut ctx.svm); // make the repeat a distinct transaction
    let ix = ix_resolve_with(&ctx, &id, &resolver, ctx.treasury, 0, 1);
    expect_log(send(&mut ctx.svm, ix, &resolver), "PoolNotLocked");
}

#[test]
fn terminal_states_reject_further_actions() {
    let mut ctx = setup();
    let host = make_wallet(&mut ctx.svm);
    let resolver = ctx.resolver.insecure_clone();

    let (id, _m) = run_pool(&mut ctx, &host, &resolver, 3, usdc(5), 500, 10, &[(50, 0)], 0, 1);

    // Entering a resolved pool is rejected.
    let (late, late_ta) = make_member(&mut ctx.svm, &ctx.mint, 50);
    let ix = ix_enter(&ctx, &id, &late, late_ta, 0);
    expect_log(send(&mut ctx.svm, ix, &late), "PoolNotOpen");

    // Cancelling a resolved pool is rejected.
    let ix = ix_cancel(&ctx, &id, &host);
    expect_log(send(&mut ctx.svm, ix, &host), "PoolNotCancellable");

    // Locking an already-locked pool is rejected.
    let id2 = new_id();
    let ix = ix_create_pool(&ctx, &id2, &host, 3, usdc(5), 500, 10);
    send_ok(&mut ctx.svm, ix, &host);
    let ix = ix_lock(&ctx, &id2, &resolver);
    send_ok(&mut ctx.svm, ix, &resolver);
    warp(&mut ctx.svm);
    let ix = ix_lock(&ctx, &id2, &resolver);
    expect_log(send(&mut ctx.svm, ix, &resolver), "PoolNotOpen");
}

#[test]
fn pool_full_is_enforced() {
    let mut ctx = setup();
    let host = make_wallet(&mut ctx.svm);

    let id = new_id();
    let ix = ix_create_pool(&ctx, &id, &host, 3, usdc(5), 500, 2); // max 2
    send_ok(&mut ctx.svm, ix, &host);

    for pred in [0u16, 1] {
        let (m, ta) = make_member(&mut ctx.svm, &ctx.mint, 50);
        let ix = ix_enter(&ctx, &id, &m, ta, pred);
        send_ok(&mut ctx.svm, ix, &m);
    }

    let (third, third_ta) = make_member(&mut ctx.svm, &ctx.mint, 50);
    let ix = ix_enter(&ctx, &id, &third, third_ta, 2);
    expect_log(send(&mut ctx.svm, ix, &third), "PoolFull");
}

#[test]
fn create_validates_parameters() {
    let mut ctx = setup();
    let host = make_wallet(&mut ctx.svm);

    // rake above the 10% cap
    let ix = ix_create_pool(&ctx, &new_id(), &host, 3, usdc(5), 1001, 10);
    expect_log(send(&mut ctx.svm, ix, &host), "InvalidConfig");

    // fewer than 2 outcomes
    let ix = ix_create_pool(&ctx, &new_id(), &host, 1, usdc(5), 500, 10);
    expect_log(send(&mut ctx.svm, ix, &host), "InvalidConfig");

    // zero stake
    let ix = ix_create_pool(&ctx, &new_id(), &host, 3, 0, 500, 10);
    expect_log(send(&mut ctx.svm, ix, &host), "InvalidConfig");

    // fewer than 2 max entries
    let ix = ix_create_pool(&ctx, &new_id(), &host, 3, usdc(5), 500, 1);
    expect_log(send(&mut ctx.svm, ix, &host), "InvalidConfig");
}