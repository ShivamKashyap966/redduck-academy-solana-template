use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct UserState {
    pub user: Pubkey,
    pub stake_count: u64,
    pub bump: u8,
}
