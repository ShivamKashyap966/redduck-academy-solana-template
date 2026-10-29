use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Entry {
    pub player: Pubkey,
    pub index: u64,
    pub start_ticket: u64,
    pub end_ticket: u64,
    pub amount: u64,
    pub bump: u8,
}
