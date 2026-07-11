use anchor_lang::prelude::*;

use crate::{errors::ClubPoolError, state::Config};

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        constraint = config.admin == admin.key() @ ClubPoolError::NotAuthority,
    )]
    pub config: Account<'info, Config>,
}

/// Rotate the resolver keypair and/or the treasury token account. usdc_mint and
/// admin are fixed at initialization and cannot be changed here.
pub fn handler(
    ctx: Context<UpdateConfig>,
    resolver_authority: Pubkey,
    treasury: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.resolver_authority = resolver_authority;
    config.treasury = treasury;
    Ok(())
}