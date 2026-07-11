use anchor_lang::prelude::*;
use anchor_spl::token::{transfer as token_transfer, Token, TokenAccount, Transfer};

use crate::{
    errors::ClubPoolError,
    state::{Config, Pool, PoolStatus},
};

#[derive(Accounts)]
#[instruction(pool_id: [u8; 16])]
pub struct ResolvePool<'info> {
    /// Must be config.resolver_authority (the oracle). Called at full time.
    pub resolver: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [b"pool", pool_id.as_ref()],
        bump = pool.bump,
        constraint = config.resolver_authority == resolver.key() @ ClubPoolError::NotResolver,
    )]
    pub pool: Account<'info, Pool>,

    #[account(mut, seeds = [b"vault", pool_id.as_ref()], bump = pool.vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = treasury.key() == config.treasury @ ClubPoolError::InvalidConfig,
        constraint = treasury.mint == pool.usdc_mint @ ClubPoolError::InvalidMint,
    )]
    pub treasury: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// The resolver reports `winning_outcome` (from the TxLINE final score) and
/// `winner_count` (entries whose prediction == winning_outcome). winner_count is
/// a deterministic function of public on-chain entries, so it is auditable.
///
/// Math: rake = total_pool * rake_bps / 10_000.
/// If winner_count == 0 -> Voided, no rake taken, everyone refunds their stake.
/// Otherwise: share = (total_pool - rake) / winner_count (floor). The rake plus
/// the integer-division remainder are swept to treasury now, leaving the vault
/// holding exactly share * winner_count for winners to claim.
pub fn handler(
    ctx: Context<ResolvePool>,
    _pool_id: [u8; 16],
    winning_outcome: u16,
    winner_count: u32,
) -> Result<()> {
    require!(ctx.accounts.pool.status == PoolStatus::Locked, ClubPoolError::PoolNotLocked);
    require!(
        winning_outcome < ctx.accounts.pool.outcome_count,
        ClubPoolError::InvalidOutcome
    );
    require!(
        winner_count <= ctx.accounts.pool.entry_count,
        ClubPoolError::InvalidWinnerCount
    );

    let total_pool = ctx.accounts.pool.total_pool;
    let rake_bps = ctx.accounts.pool.rake_bps;
    let pool_id_bytes = ctx.accounts.pool.pool_id;
    let pool_bump = ctx.accounts.pool.bump;

    let rake = (total_pool as u128)
        .checked_mul(rake_bps as u128)
        .ok_or(ClubPoolError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(ClubPoolError::MathOverflow)? as u64;

    // No winners: void the pool, take no rake, entries refund their stake.
    if winner_count == 0 {
        let pool = &mut ctx.accounts.pool;
        pool.status = PoolStatus::Voided;
        pool.winning_outcome = winning_outcome;
        pool.winner_count = 0;
        pool.share_amount = 0;
        return Ok(());
    }

    let distributable = total_pool.checked_sub(rake).ok_or(ClubPoolError::MathOverflow)?;
    let share = distributable
        .checked_div(winner_count as u64)
        .ok_or(ClubPoolError::MathOverflow)?;
    let paid_out = share
        .checked_mul(winner_count as u64)
        .ok_or(ClubPoolError::MathOverflow)?;
    let remainder = distributable.checked_sub(paid_out).ok_or(ClubPoolError::MathOverflow)?;
    let to_treasury = rake.checked_add(remainder).ok_or(ClubPoolError::MathOverflow)?;

    // Sweep rake + remainder to treasury. Vault is left holding exactly
    // share * winner_count, so claims drain it to zero with no dust stranded.
    if to_treasury > 0 {
        let seeds: &[&[u8]] = &[b"pool", pool_id_bytes.as_ref(), &[pool_bump]];
        let signer = &[seeds];
        token_transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                signer,
            ),
            to_treasury,
        )?;
    }

    let pool = &mut ctx.accounts.pool;
    pool.status = PoolStatus::Resolved;
    pool.winning_outcome = winning_outcome;
    pool.winner_count = winner_count;
    pool.share_amount = share;

    Ok(())
}