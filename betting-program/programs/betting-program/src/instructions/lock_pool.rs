use anchor_lang::prelude::*;

use crate::{
    errors::ClubPoolError,
    state::{Config, Pool, PoolStatus},
};

#[derive(Accounts)]
#[instruction(pool_id: [u8; 16])]
pub struct LockPool<'info> {
    /// Must be config.resolver_authority (the backend). Called at kickoff.
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
}

pub fn handler(ctx: Context<LockPool>, _pool_id: [u8; 16]) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    require!(pool.status == PoolStatus::Open, ClubPoolError::PoolNotOpen);
    pool.status = PoolStatus::Locked;
    Ok(())
}