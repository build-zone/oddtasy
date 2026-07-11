use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

use crate::state::Config;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// The USDC mint every pool will validate against.
    pub usdc_mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
}

/// `treasury` is a USDC token account address. Its mint is validated at resolve
/// time (treasury.mint == pool.usdc_mint), so we accept it as a Pubkey here.
pub fn handler(
    ctx: Context<InitializeConfig>,
    resolver_authority: Pubkey,
    treasury: Pubkey,
) -> Result<()> {
    ctx.accounts.config.set_inner(Config {
        admin: ctx.accounts.admin.key(),
        resolver_authority,
        usdc_mint: ctx.accounts.usdc_mint.key(),
        treasury,
        bump: ctx.bumps.config,
    });
    Ok(())
}