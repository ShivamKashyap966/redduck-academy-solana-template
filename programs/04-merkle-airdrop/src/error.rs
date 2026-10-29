use anchor_lang::prelude::*;

#[error_code]
pub enum MerkleError {
    #[msg("Invalid Merkle proof")]
    InvalidProof,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Zero amount")]
    ZeroAmount,
    #[msg("Invalid signer for claim")]
    InvalidSigner,
    #[msg("Invalid signature message")]
    InvalidSignatureMessage,
    #[msg("Signature verification failed")]
    SignatureVerificationFailed,
    #[msg("Malformed Ed25519 instruction")]
    MalformedEd25519,
    #[msg("Not Ed25519 program")]
    NotEd25519,
}
