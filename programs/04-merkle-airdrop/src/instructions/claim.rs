use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::{CLAIM_SEED, CONFIG_SEED, VAULT_SEED};
use crate::error::MerkleError;
use crate::state::{Claim, Config};

#[derive(Accounts)]
pub struct ClaimMerkle<'info> {
    #[account(mut)]
    pub claimant: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = mint,
        has_one = vault,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init_if_needed,
        payer = claimant,
        space = 8 + Claim::INIT_SPACE,
        seeds = [CLAIM_SEED, claimant.key().as_ref()],
        bump,
    )]
    pub claim: Account<'info, Claim>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = claimant,
    )]
    pub claimant_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = config.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn claim(ctx: Context<ClaimMerkle>, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
    require!(!ctx.accounts.claim.claimed, MerkleError::AlreadyClaimed);
    require!(amount > 0, MerkleError::ZeroAmount);

    // 1. Verify Merkle Proof
    let leaf_bytes = [ctx.accounts.claimant.key().as_ref(), &amount.to_le_bytes()].concat();
    let mut current = hash(&leaf_bytes).to_bytes();

    for sibling in proof {
        let combined = if current <= sibling {
            [current.as_ref(), sibling.as_ref()].concat()
        } else {
            [sibling.as_ref(), current.as_ref()].concat()
        };
        current = hash(&combined).to_bytes();
    }

    require!(
        current == ctx.accounts.config.merkle_root,
        MerkleError::InvalidProof
    );

    // 2. Mark claimant as claimed
    ctx.accounts.claim.set_inner(Claim {
        claimant: ctx.accounts.claimant.key(),
        claimed: true,
        bump: ctx.bumps.claim,
    });

    // 3. Transfer tokens from vault to claimant
    let seeds: &[&[u8]] = &[CONFIG_SEED, &[ctx.accounts.config.bump]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.claimant_ata.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    Ok(())
}
