import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  AccountLayout,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { assert } from "chai";

import { sendIxs, findPDA, oneToken, expectReverted } from "../helpers";
import { setupAirdrop, MerkleFixture } from "./fixture";
import { buildClaimSignatureIx } from "./signatures";

describe("04-merkle-airdrop", () => {
  let env: MerkleFixture;

  const claimPda = (claimant: PublicKey): PublicKey => {
    return findPDA(["claim", claimant.toBuffer()], env.program)[0];
  };

  const getTokenBalance = async (address: PublicKey): Promise<bigint> => {
    const acc = await env.context.banksClient.getAccount(address);
    if (!acc) return 0n;
    return AccountLayout.decode(acc.data).amount;
  };

  beforeEach(async () => {
    env = await setupAirdrop();
  });

  it("claims an allocation with a valid Merkle proof", async () => {
    const { context, program, mint, vault, entries, tree, claimants } = env;

    const claimant = claimants[0];
    const amount = entries[0].amount;
    const proof = tree.getProof(0).map((node) => [...node]);
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    // Create ATA for claimant
    await sendIxs(
      context,
      [claimant],
      createAssociatedTokenAccountInstruction(
        claimant.publicKey,
        claimantAta,
        claimant.publicKey,
        mint,
      ),
    );

    const ix = await program.methods
      .claim(amount, proof)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [claimant], ix);

    const balance = await getTokenBalance(claimantAta);
    assert.equal(balance.toString(), amount.toString());
  });

  it("refuses claim with an invalid Merkle proof", async () => {
    const { context, program, mint, vault, entries, claimants } = env;

    const claimant = claimants[0];
    const amount = entries[0].amount;
    const bogusProof = [new Array(32).fill(1), new Array(32).fill(2)];
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    await sendIxs(
      context,
      [claimant],
      createAssociatedTokenAccountInstruction(
        claimant.publicKey,
        claimantAta,
        claimant.publicKey,
        mint,
      ),
    );

    const ix = await program.methods
      .claim(amount, bogusProof)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: "0x1770" } }, // InvalidProof
      sendIxs(context, [claimant], ix),
    );
  });

  it("refuses claiming twice via Merkle proof (anti-double-claim guard)", async () => {
    const { context, program, mint, vault, entries, tree, claimants } = env;

    const claimant = claimants[0];
    const amount = entries[0].amount;
    const proof = tree.getProof(0).map((node) => [...node]);
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    await sendIxs(
      context,
      [claimant],
      createAssociatedTokenAccountInstruction(
        claimant.publicKey,
        claimantAta,
        claimant.publicKey,
        mint,
      ),
    );

    const ix = await program.methods
      .claim(amount, proof)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    // First claim succeeds
    await sendIxs(context, [claimant], ix);

    // Second claim blocked by anti-double-claim guard (AlreadyClaimed)
    await expectReverted(
      { revertedWith: { message: "0x1771" } }, // AlreadyClaimed
      sendIxs(context, [claimant], ix),
    );
  });

  it("claims an allocation with a valid signature", async () => {
    const { context, program, mint, vault, signer, payer } = env;

    const claimant = Keypair.generate();
    const amount = oneToken().muln(2);
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    // Fund claimant with SOL and create ATA
    await sendIxs(
      context,
      [payer],
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: claimant.publicKey,
        lamports: 10 * 1_000_000_000,
      }),
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        claimantAta,
        claimant.publicKey,
        mint,
      ),
    );

    const sigIx = buildClaimSignatureIx(
      signer,
      claimant.publicKey,
      amount,
      program.programId,
    );

    const claimIx = await program.methods
      .claimWithSignature(amount)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    await sendIxs(context, [claimant], sigIx, claimIx);

    const balance = await getTokenBalance(claimantAta);
    assert.equal(balance.toString(), amount.toString());
  });

  it("refuses claiming via signature if already claimed via Merkle proof", async () => {
    const { context, program, mint, vault, entries, tree, claimants, signer } =
      env;

    const claimant = claimants[1];
    const amount = entries[1].amount;
    const proof = tree.getProof(1).map((node) => [...node]);
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    await sendIxs(
      context,
      [claimant],
      createAssociatedTokenAccountInstruction(
        claimant.publicKey,
        claimantAta,
        claimant.publicKey,
        mint,
      ),
    );

    // 1. Claim via Merkle proof
    const merkleIx = await program.methods
      .claim(amount, proof)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [claimant], merkleIx);

    // 2. Attempt to claim via signature (blocked by anti-double-claim guard)
    const sigIx = buildClaimSignatureIx(
      signer,
      claimant.publicKey,
      amount,
      program.programId,
    );
    const sigClaimIx = await program.methods
      .claimWithSignature(amount)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: "0x1771" } }, // AlreadyClaimed
      sendIxs(context, [claimant], sigIx, sigClaimIx),
    );
  });

  it("refuses claiming via Merkle proof if already claimed via signature", async () => {
    const { context, program, mint, vault, entries, tree, claimants, signer } =
      env;

    const claimant = claimants[2];
    const amount = entries[2].amount;
    const proof = tree.getProof(2).map((node) => [...node]);
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    await sendIxs(
      context,
      [claimant],
      createAssociatedTokenAccountInstruction(
        claimant.publicKey,
        claimantAta,
        claimant.publicKey,
        mint,
      ),
    );

    // 1. Claim via signature
    const sigIx = buildClaimSignatureIx(
      signer,
      claimant.publicKey,
      amount,
      program.programId,
    );
    const sigClaimIx = await program.methods
      .claimWithSignature(amount)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    await sendIxs(context, [claimant], sigIx, sigClaimIx);

    // 2. Attempt to claim via Merkle proof (blocked by anti-double-claim guard)
    const merkleIx = await program.methods
      .claim(amount, proof)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: "0x1771" } }, // AlreadyClaimed
      sendIxs(context, [claimant], merkleIx),
    );
  });

  it("refuses claiming twice via signature", async () => {
    const { context, program, mint, vault, signer, payer } = env;

    const claimant = Keypair.generate();
    const amount = oneToken().muln(2);
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    await sendIxs(
      context,
      [payer],
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: claimant.publicKey,
        lamports: 10 * 1_000_000_000,
      }),
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        claimantAta,
        claimant.publicKey,
        mint,
      ),
    );

    const sigIx = buildClaimSignatureIx(
      signer,
      claimant.publicKey,
      amount,
      program.programId,
    );

    const claimIx = await program.methods
      .claimWithSignature(amount)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    // First signature claim succeeds
    await sendIxs(context, [claimant], sigIx, claimIx);

    // Second signature claim fails (AlreadyClaimed)
    const sigIx2 = buildClaimSignatureIx(
      signer,
      claimant.publicKey,
      amount,
      program.programId,
    );
    await expectReverted(
      { revertedWith: { message: "0x1771" } }, // AlreadyClaimed
      sendIxs(context, [claimant], sigIx2, claimIx),
    );
  });

  it("refuses claim with a signature signed by an unauthorized key", async () => {
    const { context, program, mint, vault, payer } = env;

    const claimant = Keypair.generate();
    const rogueSigner = Keypair.generate();
    const amount = oneToken().muln(3);
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    await sendIxs(
      context,
      [payer],
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: claimant.publicKey,
        lamports: 10 * 1_000_000_000,
      }),
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        claimantAta,
        claimant.publicKey,
        mint,
      ),
    );

    const sigIx = buildClaimSignatureIx(
      rogueSigner,
      claimant.publicKey,
      amount,
      program.programId,
    );

    const claimIx = await program.methods
      .claimWithSignature(amount)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: "0x1773" } }, // InvalidSigner
      sendIxs(context, [claimant], sigIx, claimIx),
    );
  });

  it("there is a test that signature for one user cannot be used by another (cross-user signature replay)", async () => {
    const { context, program, mint, vault, signer, payer } = env;

    const alice = Keypair.generate();
    const bob = Keypair.generate();
    const amount = oneToken().muln(2);
    const bobAta = getAssociatedTokenAddressSync(mint, bob.publicKey);

    await sendIxs(
      context,
      [payer],
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: bob.publicKey,
        lamports: 10 * 1_000_000_000,
      }),
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        bobAta,
        bob.publicKey,
        mint,
      ),
    );

    // Signature authorizes Alice
    const sigIx = buildClaimSignatureIx(
      signer,
      alice.publicKey,
      amount,
      program.programId,
    );

    // Bob tries to claim using Alice's signature with Bob's claim PDA
    const claimIxBobPda = await program.methods
      .claimWithSignature(amount)
      .accountsPartial({
        claim: claimPda(bob.publicKey),
        claimant: bob.publicKey,
        claimantAta: bobAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: "0x1774" } }, // InvalidSignatureMessage
      sendIxs(context, [bob], sigIx, claimIxBobPda),
    );

    // Bob tries to claim passing Alice's claim PDA (Anchor seeds constraint fails)
    const claimIxAlicePda = await program.methods
      .claimWithSignature(amount)
      .accountsPartial({
        claim: claimPda(alice.publicKey),
        claimant: bob.publicKey,
        claimantAta: bobAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: "custom program error" } },
      sendIxs(context, [bob], sigIx, claimIxAlicePda),
    );
  });

  it("refuses claim with zero amount", async () => {
    const { context, program, mint, vault, claimants } = env;

    const claimant = claimants[0];
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    await sendIxs(
      context,
      [claimant],
      createAssociatedTokenAccountInstruction(
        claimant.publicKey,
        claimantAta,
        claimant.publicKey,
        mint,
      ),
    );

    const ix = await program.methods
      .claim(new BN(0), [])
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: "0x1772" } }, // ZeroAmount
      sendIxs(context, [claimant], ix),
    );
  });
});
