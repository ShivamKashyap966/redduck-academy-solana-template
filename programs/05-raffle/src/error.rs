use anchor_lang::prelude::*;

#[error_code]
pub enum RaffleError {
    #[msg("the random value did not come from the trusted oracle")]
    UntrustedOracle,
    #[msg("Raffle is closed")]
    RaffleClosed,
    #[msg("Draw is not ready yet")]
    DrawNotReady,
    #[msg("No entries in raffle")]
    NoEntries,
    #[msg("Randomness already requested")]
    AlreadyRequested,
    #[msg("Randomness not yet requested")]
    RandomnessNotRequested,
    #[msg("Randomness not yet fulfilled")]
    RandomnessNotFulfilled,
    #[msg("Prize already claimed")]
    AlreadyClaimed,
    #[msg("Claimant is not the winner")]
    NotWinner,
    #[msg("Deposit amount must be greater than zero")]
    ZeroAmount,
    #[msg("Math overflow")]
    MathOverflow,
}
