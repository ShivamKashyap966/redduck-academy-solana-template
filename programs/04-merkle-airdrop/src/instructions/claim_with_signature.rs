use anchor_lang::prelude::*;
use anchor_lang::solana_program::ed25519_program;
use anchor_lang::solana_program::sysvar::instructions as ix_sysvar;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::{CLAIM_SEED, CONFIG_SEED, VAULT_SEED};
use crate::error::MerkleError;
use crate::state::{Claim, Config};

#[derive(Accounts)]
pub struct ClaimWithSignature<'info> {
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

    /// CHECK: Validated against Solana instructions sysvar
    #[account(address = ix_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
}

pub fn claim_with_signature(ctx: Context<ClaimWithSignature>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.claim.claimed, MerkleError::AlreadyClaimed);
    require!(amount > 0, MerkleError::ZeroAmount);

    // 1. Inspect preceding Ed25519 instruction in current transaction
    let current_index = ix_sysvar::load_current_index_checked(
        &ctx.accounts.instructions.to_account_info(),
    )
    .map_err(|_| MerkleError::SignatureVerificationFailed)?;

    require!(current_index > 0, MerkleError::SignatureVerificationFailed);

    let sig_ix = ix_sysvar::load_instruction_at_checked(
        (current_index - 1) as usize,
        &ctx.accounts.instructions.to_account_info(),
    )
    .map_err(|_| MerkleError::SignatureVerificationFailed)?;

    require_keys_eq!(sig_ix.program_id, ed25519_program::ID, MerkleError::NotEd25519);

    let d = &sig_ix.data;
    require!(d.len() >= 16 && d[0] == 1, MerkleError::MalformedEd25519);

    let u16_at = |i: usize| u16::from_le_bytes([d[i], d[i + 1]]) as usize;
    let (sig_ix_num, pk_off, pk_ix) = (u16_at(4), u16_at(6), u16_at(8));
    let (msg_off, msg_size, msg_ix) = (u16_at(10), u16_at(12), u16_at(14));

    require!(
        sig_ix_num == 0xffff && pk_ix == 0xffff && msg_ix == 0xffff,
        MerkleError::MalformedEd25519
    );
    require!(
        d.len() >= pk_off + 32 && d.len() >= msg_off + msg_size,
        MerkleError::MalformedEd25519
    );

    let mut pubkey = [0u8; 32];
    pubkey.copy_from_slice(&d[pk_off..pk_off + 32]);
    let signer_pubkey = Pubkey::from(pubkey);

    require_keys_eq!(
        signer_pubkey,
        ctx.accounts.config.signer,
        MerkleError::InvalidSigner
    );

    // 2. Verify signed message binds claimant, amount, and this program ID
    let message = &d[msg_off..msg_off + msg_size];
    let expected_message = [
        ctx.accounts.claimant.key().as_ref(),
        &amount.to_le_bytes(),
        crate::ID.as_ref(),
    ]
    .concat();

    require!(
        message == expected_message.as_slice(),
        MerkleError::InvalidSignatureMessage
    );

    // 3. Mark claimant as claimed
    ctx.accounts.claim.set_inner(Claim {
        claimant: ctx.accounts.claimant.key(),
        claimed: true,
        bump: ctx.bumps.claim,
    });

    // 4. Transfer tokens from vault to claimant
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
