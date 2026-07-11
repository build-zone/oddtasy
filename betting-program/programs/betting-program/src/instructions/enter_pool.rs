use anchor_lang::prelude::*;
use anchor_spl::token::{transfer as token_transfer, Token, TokenAccount, Transfer};

use crate::{
    errors::ClubPoolError,
    state::{Entry, Pool, PoolStatus},
};

#[derive(Accounts)]
#[instruction(pool_id: [u8; 16])]
pub struct EnterPool<'info> {
    #[account(mut)]
    pub member: Signer<'info>,

    #[account(mut, seeds = [b"pool", pool_id.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    #[account(mut, seeds = [b"vault", pool_id.as_ref()], bump = pool.vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    /// One entry per member per pool. `init` fails if the member already entered.
    #[account(
        init,
        payer = member,
        space = 8 + Entry::INIT_SPACE,
        seeds = [b"entry", pool_id.as_ref(), member.key().as_ref()],
        bump,
    )]
    pub entry: Account<'info, Entry>,

    #[account(
        mut,
        constraint = member_token_account.owner == member.key() @ ClubPoolError::NotOwner,
        constraint = member_token_account.mint == pool.usdc_mint @ ClubPoolError::InvalidMint,
    )]
    pub member_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<EnterPool>, pool_id: [u8; 16], prediction: u16) -> Result<()> {
    let clock = Clock::get()?;

    require!(ctx.accounts.pool.status == PoolStatus::Open, ClubPoolError::PoolNotOpen);
    require!(clock.unix_timestamp < ctx.accounts.pool.deadline, ClubPoolError::DeadlinePassed);
    require!(
        ctx.accounts.pool.entry_count < ctx.accounts.pool.max_entries,
        ClubPoolError::PoolFull
    );
    require!(
        prediction < ctx.accounts.pool.outcome_count,
        ClubPoolError::InvalidPrediction
    );

    let stake = ctx.accounts.pool.stake_amount;

    // Member signs for their own stake. On Anchor 1.x, CpiContext::new takes the
    // token program's Pubkey (.key()), not its AccountInfo.
    token_transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.member_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.member.to_account_info(),
            },
        ),
        stake,
    )?;

    let pool = &mut ctx.accounts.pool;
    pool.entry_count = pool.entry_count.checked_add(1).ok_or(ClubPoolError::MathOverflow)?;
    pool.total_pool = pool.total_pool.checked_add(stake).ok_or(ClubPoolError::MathOverflow)?;

    ctx.accounts.entry.set_inner(Entry {
        member: ctx.accounts.member.key(),
        pool_id,
        prediction,
        stake_paid: stake,
        claimed: false,
        bump: ctx.bumps.entry,
    });

    Ok(())
}