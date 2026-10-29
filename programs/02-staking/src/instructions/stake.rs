use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::{CONFIG_SEED, STAKE_SEED, USER_SEED, VAULT_SEED};
use crate::error::StakingError;
use crate::state::{Config, StakePosition, UserState};

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = rddk_mint,
        has_one = vault,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserState::INIT_SPACE,
        seeds = [USER_SEED, user.key().as_ref()],
        bump,
    )]
    pub user_state: Account<'info, UserState>,

    #[account(
        init,
        payer = user,
        space = 8 + StakePosition::INIT_SPACE,
        seeds = [STAKE_SEED, user.key().as_ref(), user_state.stake_count.to_le_bytes().as_ref()],
        bump,
    )]
    pub stake_position: Account<'info, StakePosition>,

    #[account(
        mut,
        token::mint = rddk_mint,
        token::authority = user,
    )]
    pub user_rddk_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = config.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub rddk_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
    require!(amount > 0, StakingError::ZeroAmount);

    let user_state = &mut ctx.accounts.user_state;
    if user_state.stake_count == 0 {
        user_state.user = ctx.accounts.user.key();
        user_state.bump = ctx.bumps.user_state;
    }

    let stake_index = user_state.stake_count;

    let pos = &mut ctx.accounts.stake_position;
    pos.user = ctx.accounts.user.key();
    pos.index = stake_index;
    pos.amount = amount;
    pos.staked_at = Clock::get()?.unix_timestamp;
    pos.claimed = false;
    pos.bump = ctx.bumps.stake_position;

    user_state.stake_count = user_state
        .stake_count
        .checked_add(1)
        .ok_or(StakingError::MathOverflow)?;

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.user_rddk_ata.to_account_info(),
                mint: ctx.accounts.rddk_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.rddk_mint.decimals,
    )?;

    Ok(())
}
