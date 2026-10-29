use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub signer: Pubkey,
    pub merkle_root: [u8; 32],
    pub bump: u8,
    pub vault_bump: u8,
}
