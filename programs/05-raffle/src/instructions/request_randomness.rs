use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use ephemeral_vrf_sdk::anchor::vrf;
use ephemeral_vrf_sdk::consts::DEFAULT_QUEUE;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

use crate::constants::RAFFLE_SEED;
use crate::error::RaffleError;
use crate::state::{Raffle, Randomness};

#[vrf]
#[derive(Accounts)]
pub struct RequestRandomness<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [RAFFLE_SEED],
        bump = raffle.bump,
    )]
    pub raffle: Account<'info, Raffle>,

    #[account(mut, seeds = [b"randomness"], bump)]
    pub randomness: Account<'info, Randomness>,

    /// CHECK: the VRF oracle queue, pinned by address.
    #[account(mut, address = DEFAULT_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
}

pub fn request_randomness(ctx: Context<RequestRandomness>) -> Result<()> {
    let raffle = &mut ctx.accounts.raffle;
    let now = Clock::get()?.unix_timestamp;

    require!(now >= raffle.draw_time, RaffleError::DrawNotReady);
    require!(raffle.total_entries > 0, RaffleError::NoEntries);
    require!(!raffle.randomness_requested, RaffleError::AlreadyRequested);

    raffle.randomness_requested = true;

    // Name `consume_randomness` as the callback and forward the `Randomness`
    // account (writable) so the oracle's reply can be written into it.
    let ix = create_request_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.payer.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::ConsumeRandomness::DISCRIMINATOR.to_vec(),
        caller_seed: ctx.accounts.randomness.key().to_bytes(),
        accounts_metas: Some(vec![SerializableAccountMeta {
            pubkey: ctx.accounts.randomness.key(),
            is_signer: false,
            is_writable: true,
        }]),
        ..Default::default()
    });
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
    Ok(())
}
