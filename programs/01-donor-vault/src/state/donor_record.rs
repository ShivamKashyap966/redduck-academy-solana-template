use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct DonorRecord {
    pub total: u64,
    pub donation_count: u64,
}
