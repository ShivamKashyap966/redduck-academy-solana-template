import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BankrunProvider } from "anchor-bankrun";
import * as fs from "fs";
import * as path from "path";
import { AddedAccount, ProgramTestContext, start } from "solana-bankrun";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

import { Raffle } from "../../target/types/raffle";
import idl from "../../target/idl/raffle.json";
import {
  createMintAndFund,
  sendIxs,
  oneToken,
  findPDA,
} from "../helpers";

export interface RaffleFixture {
  context: ProgramTestContext;
  program: Program<Raffle>;
  payer: Keypair;
  mint: PublicKey;
  // The trusted oracle. In production this is MagicBlock's VRF identity; here
  // it's a key the tests control so they can mock the oracle's callback.
  oracle: Keypair;
  // The given VRF result account (PDA). Your `initialize` must create it.
  randomness: PublicKey;
  // Pre-funded accounts you can use as entrants.
  funded: Keypair[];
}

export const setupRaffle = async (): Promise<RaffleFixture> => {
  const deployDir = path.resolve("target/deploy");
  if (!fs.existsSync(deployDir)) {
    fs.mkdirSync(deployDir, { recursive: true });
  }
  const mockVrfDest = path.join(deployDir, "mock_vrf.so");
  const fixtureSrc = path.resolve("tests/fixtures/mock_vrf.so");
  if (!fs.existsSync(mockVrfDest) && fs.existsSync(fixtureSrc)) {
    fs.copyFileSync(fixtureSrc, mockVrfDest);
  }

  process.env.SBF_OUT_DIR = process.env.SBF_OUT_DIR ?? deployDir;
  process.env.BPF_OUT_DIR = process.env.BPF_OUT_DIR ?? deployDir;

  const accounts: Keypair[] = [];
  const accountsToInject: AddedAccount[] = [];

  for (let i = 0; i < 10; i++) {
    const keypair = Keypair.generate();
    accounts.push(keypair);

    accountsToInject.push({
      address: keypair.publicKey,
      info: {
        lamports: 1000 * LAMPORTS_PER_SOL,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
        rentEpoch: 0,
      },
    });
  }

  const oracleQueuePubkey = new PublicKey(
    "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh",
  );
  accountsToInject.push({
    address: oracleQueuePubkey,
    info: {
      lamports: 1000 * LAMPORTS_PER_SOL,
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
      rentEpoch: 0,
    },
  });

  const vrfProgramPubkey = new PublicKey(
    "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz",
  );

  const programs = [
    { name: "raffle", programId: new PublicKey(idl.address) },
  ];
  if (fs.existsSync(mockVrfDest)) {
    programs.push({ name: "mock_vrf", programId: vrfProgramPubkey });
  }

  const context = await start(programs, accountsToInject);
  const provider = new BankrunProvider(context);
  anchor.setProvider(provider);

  const program = new Program<Raffle>(idl as Raffle, provider);
  const payer = context.payer;
  const oracle = Keypair.generate();

  const randomness = findPDA(["randomness"], program)[0];
  const { mint } = await createMintAndFund(
    context,
    payer,
    payer.publicKey,
    oneToken(),
  );

  return { context, program, payer, mint, oracle, randomness, funded: accounts };
};

/**
 * Mock the oracle's VRF callback: deliver `value` (32 bytes) as the random
 * result. `payer` covers the fee; `oracle` signs to satisfy the program's
 * trusted-oracle check. (On-chain, `request_randomness` is what triggers this;
 * bankrun has no live VRF program, so the test stands in for the oracle here.)
 */
export const fulfillRandomness = async (
  env: RaffleFixture,
  value: number[],
): Promise<void> => {
  const { context, program, payer, oracle, randomness } = env;
  const ix = await program.methods
    .consumeRandomness(value)
    .accountsPartial({ oracle: oracle.publicKey, randomness })
    .instruction();
  await sendIxs(context, [payer, oracle], ix);
};
