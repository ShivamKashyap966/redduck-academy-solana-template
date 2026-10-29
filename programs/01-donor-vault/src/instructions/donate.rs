use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::constants::{DONATION_SEED, DONOR_SEED, MAX_MESSAGE_LEN, VAULT_SEED};
use crate::error::DonorVaultError;
use crate::state::{Donation, DonorRecord, Vault};

#[derive(Accounts)]
pub struct Donate<'info> {
    #[account(mut)]
    pub donor: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init_if_needed,
        payer = donor,
        space = 8 + DonorRecord::INIT_SPACE,
        seeds = [DONOR_SEED, donor.key().as_ref()],
        bump,
    )]
    pub donor_record: Account<'info, DonorRecord>,

    #[account(
        init,
        payer = donor,
        space = 8 + Donation::INIT_SPACE,
        seeds = [
            DONATION_SEED,
            donor.key().as_ref(),
            &donor_record.donation_count.to_le_bytes()
        ],
        bump,
    )]
    pub donation: Account<'info, Donation>,

    pub system_program: Program<'info, System>,
}

pub fn donate(ctx: Context<Donate>, amount: u64, message: String) -> Result<()> {
    require!(amount > 0, DonorVaultError::ZeroDonation);
    require!(message.len() <= MAX_MESSAGE_LEN, DonorVaultError::MessageTooLong);

    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.donor.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        amount,
    )?;

    let vault = &mut ctx.accounts.vault;
    let donor_record = &mut ctx.accounts.donor_record;

    if donor_record.donation_count == 0 {
        donor_record.donor = ctx.accounts.donor.key();
        vault.unique_donor_count = vault
            .unique_donor_count
            .checked_add(1)
            .ok_or(DonorVaultError::MathOverflow)?;
    }

    let timestamp = Clock::get()?.unix_timestamp;

    ctx.accounts.donation.set_inner(Donation {
        amount,
        timestamp,
        message,
    });

    donor_record.total = donor_record
        .total
        .checked_add(amount)
        .ok_or(DonorVaultError::MathOverflow)?;
    donor_record.donation_count = donor_record
        .donation_count
        .checked_add(1)
        .ok_or(DonorVaultError::MathOverflow)?;

    Ok(())
}
