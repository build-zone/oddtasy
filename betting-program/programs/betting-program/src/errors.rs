use anchor_lang::prelude::*;

#[error_code]
pub enum ClubPoolError {
    #[msg("Pool is not open for entries")]
    PoolNotOpen,
    #[msg("Pool is not locked")]
    PoolNotLocked,
    #[msg("Pool is not resolved")]
    PoolNotResolved,
    #[msg("Entry deadline has passed")]
    DeadlinePassed,
    #[msg("Pool has reached its entry limit")]
    PoolFull,
    #[msg("Prediction is out of range for this market")]
    InvalidPrediction,
    #[msg("Winning outcome is out of range for this market")]
    InvalidOutcome,
    #[msg("Signer is not the resolver authority")]
    NotResolver,
    #[msg("Signer is not the pool authority")]
    NotAuthority,
    #[msg("Token mint does not match the pool USDC mint")]
    InvalidMint,
    #[msg("Token account owner mismatch")]
    NotOwner,
    #[msg("Winnings or refund already claimed")]
    AlreadyClaimed,
    #[msg("This entry did not pick the winning outcome")]
    NotAWinner,
    #[msg("Nothing to refund: pool is not voided or cancelled")]
    NothingToRefund,
    #[msg("Winner count exceeds the number of entries")]
    InvalidWinnerCount,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Invalid pool configuration")]
    InvalidConfig,
    // --- added in batch 2 (appended, so prior error codes are unchanged) ---
    #[msg("Pool cannot be cancelled in its current state")]
    PoolNotCancellable,
}