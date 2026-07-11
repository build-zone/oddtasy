use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    errors::ClubPoolError,
    state::{Config, Pool, PoolStatus, UNRESOLVED},
};

#[derive(Accounts)]
#[instruction(pool_id: [u8; 16])]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub host: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = host,
        space = 8 + Pool::INIT_SPACE,
        seeds = [b"pool", pool_id.as_ref()],
        bump,
    )]
    pub pool: Account<'info, Pool>,

    /// Vault token account owned by the Pool PDA. Holds all staked USDC.
    #[account(
        init,
        payer = host,
        seeds = [b"vault", pool_id.as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = pool,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        constraint = usdc_mint.key() == config.usdc_mint @ ClubPoolError::InvalidMint,
    )]
    pub usdc_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<CreatePool>,
    pool_id: [u8; 16],
    market_type: u8,
    market_param: u16,
    outcome_count: u16,
    stake_amount: u64,
    rake_bps: u16,
    max_entries: u32,
    deadline: i64,
) -> Result<()> {
    let clock = Clock::get()?;

    require!(outcome_count >= 2, ClubPoolError::InvalidConfig);
    require!(stake_amount > 0, ClubPoolError::InvalidConfig);
    require!(rake_bps <= 1_000, ClubPoolError::InvalidConfig); // hard cap 10%
    require!(max_entries >= 2, ClubPoolError::InvalidConfig);
    require!(deadline > clock.unix_timestamp, ClubPoolError::InvalidConfig);

    ctx.accounts.pool.set_inner(Pool {
        authority: ctx.accounts.host.key(),
        pool_id,
        usdc_mint: ctx.accounts.usdc_mint.key(),
        market_type,
        market_param,
        outcome_count,
        stake_amount,
        rake_bps,
        max_entries,
        entry_count: 0,
        total_pool: 0,
        winning_outcome: UNRESOLVED,
        winner_count: 0,
        share_amount: 0,
        status: PoolStatus::Open,
        deadline,
        vault_bump: ctx.bumps.vault,
        bump: ctx.bumps.pool,
    });

    Ok(())
}