import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { ProgramTestContext } from "solana-bankrun";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMint2Instruction,
  createInitializeNonTransferableMintInstruction,
  getMintLen,
} from "@solana/spl-token";
import { processTransaction } from "../helpers";

/**
 * Create the vRDDK mint and return its address. It is
 * non-transferable (Token-2022), with mint authority = `mintAuthority`.
 */
export const createVrddkMint = async (
  context: ProgramTestContext,
  payer: Keypair,
  mintAuthority: PublicKey,
  decimals: number,
): Promise<PublicKey> => {
  const mint = Keypair.generate();
  const extensions = [ExtensionType.NonTransferable];
  const mintLen = getMintLen(extensions);
  const rent = await context.banksClient.getRent();
  const lamports = Number(rent.minimumBalance(BigInt(mintLen)));

  await processTransaction(
    context,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeNonTransferableMintInstruction(
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID,
      ),
      createInitializeMint2Instruction(
        mint.publicKey,
        decimals,
        mintAuthority,
        null,
        TOKEN_2022_PROGRAM_ID,
      ),
    ),
    [payer, mint],
  );

  return mint.publicKey;
};
