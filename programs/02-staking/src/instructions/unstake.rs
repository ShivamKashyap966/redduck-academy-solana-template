use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use anchor_spl::token_2022::{self, Token2022};

use crate::constants::{CONFIG_SEED, VAULT_SEED};
use crate::error::StakingError;
use crate::state::Config;

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = rddk_mint,
        has_one = vrddk_mint,
        has_one = vault,
    )]
    pub config: Account<'info, Config>,

    pub rddk_mint: Account<'info, Mint>,

    /// CHECK: vRDDK Token-2022 mint
    #[account(mut, address = config.vrddk_mint)]
    pub vrddk_mint: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = config.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = rddk_mint,
        token::authority = user,
    )]
    pub user_rddk_ata: Account<'info, TokenAccount>,

    /// CHECK: user's vRDDK token account (Token-2022)
    #[account(mut)]
    pub user_vrddk_ata: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub token2022_program: Program<'info, Token2022>,
}

pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
    require!(amount > 0, StakingError::ZeroAmount);

    // 1. Burn vRDDK tokens from user
    token_2022::burn(
        CpiContext::new(
            ctx.accounts.token2022_program.to_account_info(),
            token_2022::Burn {
                mint: ctx.accounts.vrddk_mint.to_account_info(),
                from: ctx.accounts.user_vrddk_ata.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    // 2. Transfer matching RDDK from vault to user
    let seeds: &[&[u8]] = &[CONFIG_SEED, &[ctx.accounts.config.bump]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.rddk_mint.to_account_info(),
                to: ctx.accounts.user_rddk_ata.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.rddk_mint.decimals,
    )?;

    Ok(())
}
