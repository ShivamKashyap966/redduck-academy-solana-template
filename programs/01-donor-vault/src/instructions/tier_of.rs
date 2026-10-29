use anchor_lang::prelude::*;

use crate::constants::DONOR_SEED;
use crate::state::{DonorRecord, Tier};

#[derive(Accounts)]
pub struct TierOf<'info> {
    /// CHECK: The donor address whose tier is being queried
    pub donor: UncheckedAccount<'info>,

    #[account(
        seeds = [DONOR_SEED, donor.key().as_ref()],
        bump,
        has_one = donor,
    )]
    pub donor_record: Account<'info, DonorRecord>,
}

pub fn tier_of(ctx: Context<TierOf>) -> Result<Tier> {
    Ok(Tier::from_total(ctx.accounts.donor_record.total))
}
