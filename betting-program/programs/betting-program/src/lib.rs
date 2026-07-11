#![allow(ambiguous_glob_reexports)]
pub mod errors;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use errors::*;
pub use instructions::*;
pub use state::*;

// PLACEHOLDER. This is a NEW program, not SquadXI. Generate a fresh keypair
// (`anchor keys sync`) and replace this before deploying to devnet.
declare_id!("cisSZzchpfV9kJTuqjSNeT7KZcv8dirUsb2kKcAAsyT");

#[program]
pub mod club_pool {
    use super::*;

    // --- Config ---

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        resolver_authority: Pubkey,
        treasury: Pubkey,
    ) -> Result<()> {
        instructions::initialize_config::handler(ctx, resolver_authority, treasury)
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        resolver_authority: Pubkey,
        treasury: Pubkey,
    ) -> Result<()> {
        instructions::update_config::handler(ctx, resolver_authority, treasury)
    }

    // --- Pool lifecycle ---

    pub fn create_pool(
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
        instructions::create_pool::handler(
            ctx, pool_id, market_type, market_param, outcome_count, stake_amount,
            rake_bps, max_entries, deadline,
        )
    }

    pub fn enter_pool(ctx: Context<EnterPool>, pool_id: [u8; 16], prediction: u16) -> Result<()> {
        instructions::enter_pool::handler(ctx, pool_id, prediction)
    }

    pub fn lock_pool(ctx: Context<LockPool>, pool_id: [u8; 16]) -> Result<()> {
        instructions::lock_pool::handler(ctx, pool_id)
    }

    pub fn resolve_pool(
        ctx: Context<ResolvePool>,
        pool_id: [u8; 16],
        winning_outcome: u16,
        winner_count: u32,
    ) -> Result<()> {
        instructions::resolve_pool::handler(ctx, pool_id, winning_outcome, winner_count)
    }

    pub fn cancel_pool(ctx: Context<CancelPool>, pool_id: [u8; 16]) -> Result<()> {
        instructions::cancel_pool::handler(ctx, pool_id)
    }

    // --- Payouts ---

    pub fn claim_winnings(ctx: Context<ClaimWinnings>, pool_id: [u8; 16]) -> Result<()> {
        instructions::claim_winnings::handler(ctx, pool_id)
    }

    pub fn claim_refund(ctx: Context<ClaimRefund>, pool_id: [u8; 16]) -> Result<()> {
        instructions::claim_refund::handler(ctx, pool_id)
    }
}