use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

pub use constants::*;
pub use error::*;
#[allow(ambiguous_glob_reexports)]
pub use instructions::*;
pub use state::*;

declare_id!("3JPbgoXU4LVsC4Lp2WzxQ7HufHTcFoNShfhiLLABKEFQ");

#[program]
pub mod raffle {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, draw_time: i64, oracle: Pubkey) -> Result<()> {
        instructions::initialize(ctx, draw_time, oracle)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit(ctx, amount)
    }

    pub fn request_randomness(ctx: Context<RequestRandomness>) -> Result<()> {
        instructions::request_randomness(ctx)
    }

    pub fn consume_randomness(ctx: Context<ConsumeRandomness>, randomness: [u8; 32]) -> Result<()> {
        instructions::consume_randomness(ctx, randomness)
    }

    pub fn claim(ctx: Context<ClaimPrize>, entry_index: u64) -> Result<()> {
        instructions::claim(ctx, entry_index)
    }
}
