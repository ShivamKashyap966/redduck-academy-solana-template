use anchor_lang::prelude::*;

use crate::constants::MAX_MESSAGE_LEN;

#[account]
#[derive(InitSpace)]
pub struct Donation {
    pub amount: u64,
    pub timestamp: i64,
    #[max_len(MAX_MESSAGE_LEN)]
    pub message: String,
}
