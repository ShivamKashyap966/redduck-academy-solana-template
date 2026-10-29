use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::{ENTRY_SEED, RAFFLE_SEED, VAULT_SEED};
use crate::error::RaffleError;
use crate::state::{Entry, Raffle, Randomness};

#[derive(Accounts)]
#[instruction(entry_index: u64)]
pub struct ClaimPrize<'info> {
    #[account(mut)]
    pub winner: Signer<'info>,

    #[account(
        mut,
        seeds = [RAFFLE_SEED],
        bump = raffle.bump,
        has_one = mint,
        has_one = vault,
    )]
    pub raffle: Account<'info, Raffle>,

    #[account(
        seeds = [b"randomness"],
        bump,
    )]
    pub randomness: Account<'info, Randomness>,

    #[account(
        seeds = [ENTRY_SEED, entry_index.to_le_bytes().as_ref()],
        bump = entry.bump,
    )]
    pub entry: Account<'info, Entry>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = winner,
    )]
    pub winner_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = raffle.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

pub fn claim(ctx: Context<ClaimPrize>, entry_index: u64) -> Result<()> {
    let raffle = &mut ctx.accounts.raffle;
    let randomness = &ctx.accounts.randomness;

    require!(randomness.fulfilled, RaffleError::RandomnessNotFulfilled);
    require!(!raffle.claimed, RaffleError::AlreadyClaimed);
    require!(raffle.total_deposited > 0, RaffleError::NoEntries);

    // Compute winning ticket from randomness value
    let rand_num = u128::from_le_bytes(randomness.value[0..16].try_into().unwrap());
    let winning_ticket = (rand_num % (raffle.total_deposited as u128)) as u64;

    let entry = &ctx.accounts.entry;
    require!(entry.index == entry_index, RaffleError::NotWinner);
    require!(
        winning_ticket >= entry.start_ticket && winning_ticket < entry.end_ticket,
        RaffleError::NotWinner
    );
    require_keys_eq!(ctx.accounts.winner.key(), entry.player, RaffleError::NotWinner);

    raffle.claimed = true;

    let pot = ctx.accounts.vault.amount;
    let seeds: &[&[u8]] = &[RAFFLE_SEED, &[raffle.bump]];

    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.winner_ata.to_account_info(),
                authority: raffle.to_account_info(),
            },
            &[seeds],
        ),
        pot,
        ctx.accounts.mint.decimals,
    )?;

    Ok(())
}
