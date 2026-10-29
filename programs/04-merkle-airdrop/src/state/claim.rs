use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Claim {
    pub claimant: Pubkey,
    pub claimed: bool,
    pub bump: u8,
}
