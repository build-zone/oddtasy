use anchor_lang::prelude::*;
use anchor_spl::token::{transfer as token_transfer, Token, TokenAccount, Transfer};

use crate::{
    errors::ClubPoolError,
    state::{Entry, Pool, PoolStatus},
};

#[derive(Accounts)]
#[instruction(pool_id: [u8; 16])]
pub struct ClaimRefund<'info> {
    #[account(mut)]
    pub member: Signer<'info>,

    #[account(mut, seeds = [b"pool", pool_id.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    #[account(mut, seeds = [b"vault", pool_id.as_ref()], bump = pool.vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"entry", pool_id.as_ref(), member.key().as_ref()],
        bump = entry.bump,
        constraint = entry.member == member.key() @ ClubPoolError::NotOwner,
    )]
    pub entry: Account<'info, Entry>,

    #[account(
        mut,
        constraint = member_token_account.owner == member.key() @ ClubPoolError::NotOwner,
        constraint = member_token_account.mint == pool.usdc_mint @ ClubPoolError::InvalidMint,
    )]
    pub member_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Available when the pool is Voided (resolved with zero winners) or Cancelled
/// (match abandoned or host-cancelled). Neither path takes rake, so the vault
/// holds the full sum of stakes and every entrant refunds exactly stake_paid.
pub fn handler(ctx: Context<ClaimRefund>, _pool_id: [u8; 16]) -> Result<()> {
    require!(
        ctx.accounts.pool.status == PoolStatus::Voided
            || ctx.accounts.pool.status == PoolStatus::Cancelled,
        ClubPoolError::NothingToRefund
    );
    require!(!ctx.accounts.entry.claimed, ClubPoolError::AlreadyClaimed);

    let refund = ctx.accounts.entry.stake_paid;
    let pool_id_bytes = ctx.accounts.pool.pool_id;
    let pool_bump = ctx.accounts.pool.bump;

    let seeds: &[&[u8]] = &[b"pool", pool_id_bytes.as_ref(), &[pool_bump]];
    let signer = &[seeds];

    token_transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.member_token_account.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            signer,
        ),
        refund,
    )?;

    ctx.accounts.entry.claimed = true;
    Ok(())
}