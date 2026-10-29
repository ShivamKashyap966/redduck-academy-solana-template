use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

pub use constants::*;
pub use error::*;
#[allow(ambiguous_glob_reexports)]
pub use instructions::*;
pub use state::*;

declare_id!("BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt");

#[program]
pub mod merkle_airdrop {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        merkle_root: [u8; 32],
        signer: Pubkey,
    ) -> Result<()> {
        instructions::initialize(ctx, merkle_root, signer)
    }

    pub fn claim(ctx: Context<ClaimMerkle>, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        instructions::claim(ctx, amount, proof)
    }

    pub fn claim_with_signature(ctx: Context<ClaimWithSignature>, amount: u64) -> Result<()> {
        instructions::claim_with_signature(ctx, amount)
    }
}
