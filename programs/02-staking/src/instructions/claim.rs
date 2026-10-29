use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, Token2022};

use crate::constants::{CONFIG_SEED, LOCK_DURATION_SECONDS, STAKE_SEED, USER_SEED};
use crate::error::StakingError;
use crate::state::{Config, StakePosition, UserState};

#[derive(Accounts)]
#[instruction(index: u64)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = vrddk_mint,
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_state.bump,
        has_one = user,
    )]
    pub user_state: Account<'info, UserState>,

    #[account(
        mut,
        seeds = [STAKE_SEED, user.key().as_ref(), index.to_le_bytes().as_ref()],
        bump = stake_position.bump,
        has_one = user,
    )]
    pub stake_position: Account<'info, StakePosition>,

    /// CHECK: vRDDK Token-2022 mint
    #[account(mut, address = config.vrddk_mint)]
    pub vrddk_mint: AccountInfo<'info>,

    /// CHECK: user's vRDDK token account (Token-2022)
    #[account(mut)]
    pub user_vrddk_ata: AccountInfo<'info>,

    pub token2022_program: Program<'info, Token2022>,
}

pub fn claim(ctx: Context<Claim>, index: u64) -> Result<()> {
    let pos = &mut ctx.accounts.stake_position;
    require!(pos.index == index, StakingError::InvalidIndex);
    require!(!pos.claimed, StakingError::AlreadyClaimed);

    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= pos.staked_at + LOCK_DURATION_SECONDS,
        StakingError::StillLocked
    );

    pos.claimed = true;

    let seeds: &[&[u8]] = &[CONFIG_SEED, &[ctx.accounts.config.bump]];
    token_2022::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token2022_program.to_account_info(),
            token_2022::MintTo {
                mint: ctx.accounts.vrddk_mint.to_account_info(),
                to: ctx.accounts.user_vrddk_ata.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            &[seeds],
        ),
        pos.amount,
    )?;

    Ok(())
}
