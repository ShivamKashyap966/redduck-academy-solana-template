import { BN } from "@coral-xyz/anchor";
import {
  Ed25519Program,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";

/**
 * Builds the Ed25519 precompile instruction that authorizes `claimant` to claim
 * `amount`, signed by `signer`, which `claim_with_signature` verifies.
 * Binds claimant, amount, and the programId.
 */
export const buildClaimSignatureIx = (
  signer: Keypair,
  claimant: PublicKey,
  amount: BN,
  programId: PublicKey,
): TransactionInstruction => {
  const message = Buffer.concat([
    claimant.toBuffer(),
    amount.toArrayLike(Buffer, "le", 8),
    programId.toBuffer(),
  ]);

  return Ed25519Program.createInstructionWithPrivateKey({
    privateKey: signer.secretKey,
    message,
  });
};
