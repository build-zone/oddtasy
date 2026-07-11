use anchor_lang::prelude::*;

use crate::{
    errors::ClubPoolError,
    state::{Config, Pool, PoolStatus},
};

#[derive(Accounts)]
#[instruction(pool_id: [u8; 16])]
pub struct CancelPool<'info> {
    /// Either the resolver authority (backend, on match abandonment) or the
    /// pool's host may cancel. Both paths only ever unlock refunds; neither can
    /// move funds anywhere except back to entrants.
    pub authority: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [b"pool", pool_id.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
}

pub fn handler(ctx: Context<CancelPool>, _pool_id: [u8; 16]) -> Result<()> {
    let signer = ctx.accounts.authority.key();
    let is_resolver = signer == ctx.accounts.config.resolver_authority;
    let is_host = signer == ctx.accounts.pool.authority;
    require!(is_resolver || is_host, ClubPoolError::NotAuthority);

    let pool = &mut ctx.accounts.pool;
    require!(
        pool.status == PoolStatus::Open || pool.status == PoolStatus::Locked,
        ClubPoolError::PoolNotCancellable
    );

    pool.status = PoolStatus::Cancelled;
    Ok(())
}