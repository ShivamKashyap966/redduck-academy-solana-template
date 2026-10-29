use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct StakePosition {
    pub user: Pubkey,
    pub index: u64,
    pub amount: u64,
    pub staked_at: i64,
    pub claimed: bool,
    pub bump: u8,
}
