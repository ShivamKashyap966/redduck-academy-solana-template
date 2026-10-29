use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{RAFFLE_SEED, RANDOMNESS_SEED, VAULT_SEED};
use crate::state::{Raffle, Randomness};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Raffle::INIT_SPACE,
        seeds = [RAFFLE_SEED],
        bump,
    )]
    pub raffle: Account<'info, Raffle>,

    #[account(
        init,
        payer = payer,
        space = 8 + Randomness::INIT_SPACE,
        seeds = [RANDOMNESS_SEED],
        bump,
    )]
    pub randomness: Account<'info, Randomness>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        seeds = [VAULT_SEED],
        bump,
        token::mint = mint,
        token::authority = raffle,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<Initialize>, draw_time: i64, oracle: Pubkey) -> Result<()> {
    ctx.accounts.raffle.set_inner(Raffle {
        admin: ctx.accounts.payer.key(),
        mint: ctx.accounts.mint.key(),
        vault: ctx.accounts.vault.key(),
        draw_time,
        total_deposited: 0,
        total_entries: 0,
        randomness_requested: false,
        claimed: false,
        bump: ctx.bumps.raffle,
        vault_bump: ctx.bumps.vault,
    });

    ctx.accounts.randomness.set_inner(Randomness {
        oracle,
        value: [0u8; 32],
        fulfilled: false,
    });

    Ok(())
}
