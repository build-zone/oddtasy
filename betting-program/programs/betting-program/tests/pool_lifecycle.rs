//! Full-lifecycle tests for the pari-mutuel pool program, using litesvm.
//!
//! Run:
//!   anchor build          # produces target/deploy/betting_program.so
//!   cargo test --test pool_lifecycle
//!
//! No validator and no surfpool needed: litesvm runs the program in-process and
//! bundles the SPL Token program, so USDC transfers work against a mint and token
//! accounts we set up directly.
//!
//! IMPORTANT: delete the scaffold's tests/test_initialize.rs. It references a
//! `betting_program::instruction::Initialize` that this program does not have
//! (our entry point is `initialize_config`), so it will not compile.

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
const USDC_UNIT: u64 = 1_000_000; // 6 decimals
const DEADLINE: i64 = 2_000_000_000; // far future; entries stay open

fn usdc(whole: u64) -> u64 {
    whole * USDC_UNIT
}

// The canonical SPL Token program id. Hardcoded so we depend on no spl-token crate.
fn token_program() -> Pubkey {
    Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap()
}

// ---- raw SPL account construction (layout is fixed, version-independent) ----

/// A 165-byte SPL token account: mint (0..32), owner (32..64), amount (64..72),
/// state byte (108) = 1 (Initialized). Everything else zeroed.
fn token_account_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1; // AccountState::Initialized
    d
}

/// An 82-byte SPL mint: mint_authority COption=Some (0..4 tag, 4..36 key),
/// supply (36..44)=0, decimals (44), is_initialized (45)=1, freeze COption=None.
fn mint_data(authority: &Pubkey, decimals: u8) -> Vec<u8> {
    let mut d = vec![0u8; 82];
    d[0..4].copy_from_slice(&1u32.to_le_bytes()); // Some
    d[4..36].copy_from_slice(authority.as_ref());
    d[44] = decimals;
    d[45] = 1; // is_initialized
    d
}

fn set_spl(svm: &mut LiteSVM, key: Pubkey, data: Vec<u8>) {
    svm.set_account(
        key,
        Account {
            lamports: 10_000_000, // rent-exempt for these sizes
            data,
            owner: token_program(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn balance(svm: &LiteSVM, ta: &Pubkey) -> u64 {
    let acc = svm.get_account(ta).expect("token account missing");
    u64::from_le_bytes(acc.data[64..72].try_into().unwrap())
}

// ---- PDAs ----

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

// ---- tx sending (every instruction here has exactly one signer) ----

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

fn warp(svm: &mut LiteSVM) {
    let mut clock = svm.get_sysvar::<anchor_lang::solana_program::clock::Clock>();
    clock.slot += 1;
    clock.unix_timestamp += 1;
    svm.set_sysvar(&clock);
    svm.expire_blockhash();
}

// ---- shared setup: fresh svm, program loaded, mint + treasury + config ready ----

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

    // mint (admin is the notional mint authority)
    let mint = Keypair::new().pubkey();
    set_spl(&mut svm, mint, mint_data(&admin.pubkey(), 6));

    // treasury token account, starts at 0
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

/// A member with SOL and a funded token account. Returns (keypair, token account).
fn make_member(svm: &mut LiteSVM, mint: &Pubkey, usdc_whole: u64) -> (Keypair, Pubkey) {
    let kp = make_wallet(svm);
    let ta = Keypair::new().pubkey();
    set_spl(svm, ta, token_account_data(mint, &kp.pubkey(), usdc(usdc_whole)));
    (kp, ta)
}

// ---- instruction helpers ----

#[allow(clippy::too_many_arguments)]
fn ix_create_pool(
    ctx: &Ctx,
    id: &[u8; 16],
    host: &Keypair,
    outcome_count: u16,
    stake: u64,
    rake_bps: u16,
    max_entries: u32,
) -> Instruction {
    Instruction::new_with_bytes(
        ctx.pid,
        &betting_program::instruction::CreatePool {
            pool_id: *id,
            market_type: 0,
            market_param: 0,
            outcome_count,
            stake_amount: stake,
            rake_bps,
            max_entries,
            deadline: DEADLINE,
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

fn ix_enter(ctx: &Ctx, id: &[u8; 16], member: &Keypair, member_ta: Pubkey, prediction: u16) -> Instruction {
    Instruction::new_with_bytes(
        ctx.pid,
        &betting_program::instruction::EnterPool { pool_id: *id, prediction }.data(),
        betting_program::accounts::EnterPool {
            member: member.pubkey(),
            pool: pool_pda(&ctx.pid, id),
            vault: vault_pda(&ctx.pid, id),
            entry: entry_pda(&ctx.pid, id, &member.pubkey()),
            member_token_account: member_ta,
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

fn ix_resolve(ctx: &Ctx, id: &[u8; 16], winning_outcome: u16, winner_count: u32) -> Instruction {
    Instruction::new_with_bytes(
        ctx.pid,
        &betting_program::instruction::ResolvePool { pool_id: *id, winning_outcome, winner_count }.data(),
        betting_program::accounts::ResolvePool {
            resolver: ctx.resolver.pubkey(),
            config: config_pda(&ctx.pid),
            pool: pool_pda(&ctx.pid, id),
            vault: vault_pda(&ctx.pid, id),
            treasury: ctx.treasury,
            token_program: token_program(),
        }
        .to_account_metas(None),
    )
}

fn ix_claim(ctx: &Ctx, id: &[u8; 16], member: &Keypair, member_ta: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        ctx.pid,
        &betting_program::instruction::ClaimWinnings { pool_id: *id }.data(),
        betting_program::accounts::ClaimWinnings {
            member: member.pubkey(),
            pool: pool_pda(&ctx.pid, id),
            vault: vault_pda(&ctx.pid, id),
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

fn ix_refund(ctx: &Ctx, id: &[u8; 16], member: &Keypair, member_ta: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        ctx.pid,
        &betting_program::instruction::ClaimRefund { pool_id: *id }.data(),
        betting_program::accounts::ClaimRefund {
            member: member.pubkey(),
            pool: pool_pda(&ctx.pid, id),
            vault: vault_pda(&ctx.pid, id),
            entry: entry_pda(&ctx.pid, id, &member.pubkey()),
            member_token_account: member_ta,
            token_program: token_program(),
        }
        .to_account_metas(None),
    )
}

// ============================ tests ============================

#[test]
fn happy_path_splits_pot_after_rake() {
    let mut ctx = setup();
    let id = new_id();
    let host = make_wallet(&mut ctx.svm);
    let (a, a_ta) = make_member(&mut ctx.svm, &ctx.mint, 100);
    let (b, b_ta) = make_member(&mut ctx.svm, &ctx.mint, 100);
    let (c, c_ta) = make_member(&mut ctx.svm, &ctx.mint, 100);

    // stake 5 USDC, 3 outcomes, 5% rake
    let ix = ix_create_pool(&ctx, &id, &host, 3, usdc(5), 500, 10);
    send_ok(&mut ctx.svm, ix, &host);

    for (m, ta, pred) in [(&a, a_ta, 0u16), (&b, b_ta, 0), (&c, c_ta, 1)] {
        let ix = ix_enter(&ctx, &id, m, ta, pred);
        send_ok(&mut ctx.svm, ix, m);
    }

    let ix = ix_lock(&ctx, &id, &ctx.resolver.insecure_clone());
    send_ok(&mut ctx.svm, ix, &ctx.resolver.insecure_clone());

    let ix = ix_resolve(&ctx, &id, 0, 2); // outcome 0 wins, 2 winners
    send_ok(&mut ctx.svm, ix, &ctx.resolver.insecure_clone());

    let ix = ix_claim(&ctx, &id, &a, a_ta);
    send_ok(&mut ctx.svm, ix, &a);
    let ix = ix_claim(&ctx, &id, &b, b_ta);
    send_ok(&mut ctx.svm, ix, &b);

    // total 15, rake 0.75, distributable 14.25, share 7.125 each (clean)
    assert_eq!(balance(&ctx.svm, &a_ta), usdc(95) + 7_125_000);
    assert_eq!(balance(&ctx.svm, &b_ta), usdc(95) + 7_125_000);
    assert_eq!(balance(&ctx.svm, &ctx.treasury), 750_000);
    assert_eq!(balance(&ctx.svm, &vault_pda(&ctx.pid, &id)), 0);

    // loser cannot claim
    let ix = ix_claim(&ctx, &id, &c, c_ta);
    expect_log(send(&mut ctx.svm, ix, &c), "NotAWinner");

    warp(&mut ctx.svm);
    // winner cannot double-claim
    let ix = ix_claim(&ctx, &id, &a, a_ta);
    expect_log(send(&mut ctx.svm, ix, &a), "AlreadyClaimed");
}

#[test]
fn remainder_is_swept_to_treasury() {
    let mut ctx = setup();
    let id = new_id();
    let host = make_wallet(&mut ctx.svm);
    let winners: Vec<(Keypair, Pubkey)> =
        (0..3).map(|_| make_member(&mut ctx.svm, &ctx.mint, 10)).collect();
    let (loser, loser_ta) = make_member(&mut ctx.svm, &ctx.mint, 10);

    // stake 1 USDC, rake 0 -> distributable 4_000_000 across 3 winners
    // share = floor(4_000_000 / 3) = 1_333_333, remainder = 1 -> treasury
    let ix = ix_create_pool(&ctx, &id, &host, 3, usdc(1), 0, 10);
    send_ok(&mut ctx.svm, ix, &host);

    for (w, ta) in &winners {
        let ix = ix_enter(&ctx, &id, w, *ta, 0);
        send_ok(&mut ctx.svm, ix, w);
    }
    let ix = ix_enter(&ctx, &id, &loser, loser_ta, 2);
    send_ok(&mut ctx.svm, ix, &loser);

    let ix = ix_lock(&ctx, &id, &ctx.resolver.insecure_clone());
    send_ok(&mut ctx.svm, ix, &ctx.resolver.insecure_clone());
    let ix = ix_resolve(&ctx, &id, 0, 3);
    send_ok(&mut ctx.svm, ix, &ctx.resolver.insecure_clone());

    for (w, ta) in &winners {
        let ix = ix_claim(&ctx, &id, w, *ta);
        send_ok(&mut ctx.svm, ix, w);
    }

    // each winner: 10 - 1 + 1.333333 = 10.333333
    assert_eq!(balance(&ctx.svm, &winners[0].1), 10_333_333);
    // rake was 0; the 1-unit remainder is the only treasury inflow
    assert_eq!(balance(&ctx.svm, &ctx.treasury), 1);
    // vault fully drained (3 * 1_333_333 + 1 swept = 4_000_000)
    assert_eq!(balance(&ctx.svm, &vault_pda(&ctx.pid, &id)), 0);
}

#[test]
fn void_refunds_everyone_when_nobody_wins() {
    let mut ctx = setup();
    let id = new_id();
    let host = make_wallet(&mut ctx.svm);
    let (a, a_ta) = make_member(&mut ctx.svm, &ctx.mint, 20);
    let (b, b_ta) = make_member(&mut ctx.svm, &ctx.mint, 20);

    let ix = ix_create_pool(&ctx, &id, &host, 3, usdc(5), 500, 10);
    send_ok(&mut ctx.svm, ix, &host);
    for (m, ta) in [(&a, a_ta), (&b, b_ta)] {
        let ix = ix_enter(&ctx, &id, m, ta, 0);
        send_ok(&mut ctx.svm, ix, m);
    }

    let ix = ix_lock(&ctx, &id, &ctx.resolver.insecure_clone());
    send_ok(&mut ctx.svm, ix, &ctx.resolver.insecure_clone());
    // actual outcome 2, nobody picked it -> Voided, no rake
    let ix = ix_resolve(&ctx, &id, 2, 0);
    send_ok(&mut ctx.svm, ix, &ctx.resolver.insecure_clone());
    assert_eq!(balance(&ctx.svm, &ctx.treasury), 0);

    let ix = ix_refund(&ctx, &id, &a, a_ta);
    send_ok(&mut ctx.svm, ix, &a);
    warp(&mut ctx.svm);
    let ix = ix_refund(&ctx, &id, &b, b_ta);
    send_ok(&mut ctx.svm, ix, &b);

    assert_eq!(balance(&ctx.svm, &a_ta), usdc(20));
    assert_eq!(balance(&ctx.svm, &b_ta), usdc(20));
    assert_eq!(balance(&ctx.svm, &vault_pda(&ctx.pid, &id)), 0);

    // cannot double-refund
    let ix = ix_refund(&ctx, &id, &a, a_ta);
    expect_log(send(&mut ctx.svm, ix, &a), "AlreadyClaimed");
}

#[test]
fn host_can_cancel_and_entrants_refund() {
    let mut ctx = setup();
    let id = new_id();
    let host = make_wallet(&mut ctx.svm);
    let (a, a_ta) = make_member(&mut ctx.svm, &ctx.mint, 20);

    let ix = ix_create_pool(&ctx, &id, &host, 3, usdc(5), 500, 10);
    send_ok(&mut ctx.svm, ix, &host);
    let ix = ix_enter(&ctx, &id, &a, a_ta, 1);
    send_ok(&mut ctx.svm, ix, &a);

    let ix = ix_cancel(&ctx, &id, &host); // host cancels an open pool
    send_ok(&mut ctx.svm, ix, &host);

    let ix = ix_refund(&ctx, &id, &a, a_ta);
    send_ok(&mut ctx.svm, ix, &a);
    assert_eq!(balance(&ctx.svm, &a_ta), usdc(20));
    assert_eq!(balance(&ctx.svm, &vault_pda(&ctx.pid, &id)), 0);
}

#[test]
fn guardrails_hold() {
    let mut ctx = setup();
    let id = new_id();
    let host = make_wallet(&mut ctx.svm);
    let (a, a_ta) = make_member(&mut ctx.svm, &ctx.mint, 20);

    let ix = ix_create_pool(&ctx, &id, &host, 3, usdc(5), 500, 10);
    send_ok(&mut ctx.svm, ix, &host);

    // prediction out of range (>= outcome_count)
    let ix = ix_enter(&ctx, &id, &a, a_ta, 3);
    expect_log(send(&mut ctx.svm, ix, &a), "InvalidPrediction");

    // valid entry
    let ix = ix_enter(&ctx, &id, &a, a_ta, 0);
    send_ok(&mut ctx.svm, ix, &a);

    // cannot enter the same pool twice (entry PDA already initialized)
    let ix = ix_enter(&ctx, &id, &a, a_ta, 1);
    assert!(send(&mut ctx.svm, ix, &a).is_err(), "double entry should fail");

    // non-resolver cannot lock
    let ix = ix_lock(&ctx, &id, &a);
    expect_log(send(&mut ctx.svm, ix, &a), "NotResolver");

    // lock, then entries must be rejected
    let ix = ix_lock(&ctx, &id, &ctx.resolver.insecure_clone());
    send_ok(&mut ctx.svm, ix, &ctx.resolver.insecure_clone());

    let (b, b_ta) = make_member(&mut ctx.svm, &ctx.mint, 20);
    let ix = ix_enter(&ctx, &id, &b, b_ta, 0);
    expect_log(send(&mut ctx.svm, ix, &b), "PoolNotOpen");

    // winner_count greater than entry_count is rejected
    let ix = ix_resolve(&ctx, &id, 0, 5);
    expect_log(send(&mut ctx.svm, ix, &ctx.resolver.insecure_clone()), "InvalidWinnerCount");
}