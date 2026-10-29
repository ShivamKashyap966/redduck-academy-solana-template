use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Raffle {
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub draw_time: i64,
    pub total_deposited: u64,
    pub total_entries: u64,
    pub randomness_requested: bool,
    pub claimed: bool,
    pub bump: u8,
    pub vault_bump: u8,
}
