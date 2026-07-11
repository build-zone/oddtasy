use anchor_lang::prelude::*;

/// Sentinel stored in `Pool.winning_outcome` until the pool is resolved.
pub const UNRESOLVED: u16 = u16::MAX;

#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Admin wallet that can update config.
    pub admin: Pubkey,
    /// Backend keypair allowed to lock / resolve / cancel pools (the oracle).
    pub resolver_authority: Pubkey,
    /// USDC mint validated on every entry and payout.
    pub usdc_mint: Pubkey,
    /// USDC token account that receives rake + rounding remainder.
    pub treasury: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    /// The member who created the pool (host).
    pub authority: Pubkey,
    /// UUID bytes from the PostgreSQL pools table.
    pub pool_id: [u8; 16],
    /// USDC mint, copied from Config for local validation.
    pub usdc_mint: Pubkey,

    // --- Market description (the program is market-agnostic) ---
    /// Tag the backend/frontend interpret (0 = 1X2, 1 = over/under, 2 = correct-score, ...).
    pub market_type: u8,
    /// Optional market parameter, interpreted per market_type. For over/under this
    /// is the line * 10 (e.g. 2.5 -> 25). Zero when unused. The program never reads
    /// this for settlement; it only stores it so the pool is self-describing on-chain.
    pub market_param: u16,
    /// Number of valid outcomes. A prediction must satisfy `prediction < outcome_count`.
    /// 1X2 -> 3, over/under -> 2, correct-score 6x6 folded -> 36, etc.
    pub outcome_count: u16,

    /// Fixed equal stake per entry, in USDC base units (6 decimals).
    pub stake_amount: u64,
    /// Rake in basis points (500 = 5%). Enforced <= 1000 (10%) at creation.
    pub rake_bps: u16,

    pub max_entries: u32,
    pub entry_count: u32,
    pub total_pool: u64,

    /// UNRESOLVED until resolve_pool sets it.
    pub winning_outcome: u16,
    /// Set at resolve. Supplied by the resolver, auditable against public entries.
    pub winner_count: u32,
    /// Set at resolve: (total_pool - rake) / winner_count. What each winner claims.
    pub share_amount: u64,

    pub status: PoolStatus,
    /// Entry cutoff, unix seconds (typically kickoff).
    pub deadline: i64,

    pub vault_bump: u8,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum PoolStatus {
    Open,
    Locked,
    Resolved,
    Voided,
    Cancelled,
}

#[account]
#[derive(InitSpace)]
pub struct Entry {
    pub member: Pubkey,
    pub pool_id: [u8; 16],
    /// The outcome index this member picked. Validated `< pool.outcome_count`.
    pub prediction: u16,
    pub stake_paid: u64,
    /// Prevents double claim / double refund.
    pub claimed: bool,
    pub bump: u8,
}