use anchor_lang::prelude::*;

#[error_code]
pub enum DonorVaultError {
    #[msg("Donation amount must be greater than zero")]
    ZeroDonation,
    #[msg("Message length exceeds maximum allowed length")]
    MessageTooLong,
    #[msg("Math overflow")]
    MathOverflow,
}
