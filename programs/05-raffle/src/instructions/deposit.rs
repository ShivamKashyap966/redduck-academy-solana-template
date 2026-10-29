use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::{ENTRY_SEED, RAFFLE_SEED, VAULT_SEED};
use crate::error::RaffleError;
use crate::state::{Entry, Raffle};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [RAFFLE_SEED],
        bump = raffle.bump,
        has_one = mint,
        has_one = vault,
    )]
    pub raffle: Account<'info, Raffle>,

    #[account(
        init,
        payer = player,
        space = 8 + Entry::INIT_SPACE,
        seeds = [ENTRY_SEED, raffle.total_entries.to_le_bytes().as_ref()],
        bump,
    )]
    pub entry: Account<'info, Entry>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = player,
    )]
    pub player_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = raffle.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, RaffleError::ZeroAmount);

    let raffle = &mut ctx.accounts.raffle;
    let now = Clock::get()?.unix_timestamp;
    require!(now < raffle.draw_time, RaffleError::RaffleClosed);
    require!(!raffle.randomness_requested, RaffleError::RaffleClosed);

    let start_ticket = raffle.total_deposited;
    let end_ticket = start_ticket
        .checked_add(amount)
        .ok_or(RaffleError::MathOverflow)?;

    let entry_index = raffle.total_entries;

    ctx.accounts.entry.set_inner(Entry {
        player: ctx.accounts.player.key(),
        index: entry_index,
        start_ticket,
        end_ticket,
        amount,
        bump: ctx.bumps.entry,
    });

    raffle.total_deposited = end_ticket;
    raffle.total_entries = raffle
        .total_entries
        .checked_add(1)
        .ok_or(RaffleError::MathOverflow)?;

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.player_ata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.player.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    Ok(())
}
