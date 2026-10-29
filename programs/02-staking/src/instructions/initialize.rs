use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use anchor_spl::token_2022::Token2022;

use crate::constants::{CONFIG_SEED, VAULT_SEED};
use crate::state::Config;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    pub rddk_mint: Account<'info, Mint>,

    /// CHECK: vRDDK is a Token-2022 non-transferable mint
    pub vrddk_mint: AccountInfo<'info>,

    #[account(
        init,
        payer = payer,
        seeds = [VAULT_SEED],
        bump,
        token::mint = rddk_mint,
        token::authority = config,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub token2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    ctx.accounts.config.set_inner(Config {
        rddk_mint: ctx.accounts.rddk_mint.key(),
        vrddk_mint: ctx.accounts.vrddk_mint.key(),
        vault: ctx.accounts.vault.key(),
        bump: ctx.bumps.config,
        vault_bump: ctx.bumps.vault,
    });
    Ok(())
}
