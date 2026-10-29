use anchor_lang::prelude::*;

#[error_code]
pub enum StakingError {
    #[msg("Stake position is still locked")]
    StillLocked,
    #[msg("Stake position has already been claimed")]
    AlreadyClaimed,
    #[msg("Stake amount must be greater than zero")]
    ZeroAmount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid stake index")]
    InvalidIndex,
}
