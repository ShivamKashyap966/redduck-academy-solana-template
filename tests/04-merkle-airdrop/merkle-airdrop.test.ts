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

    // Verify claim marker exists and is marked claimed
    const claimAccount = await program.account.claim.fetch(
      claimPda(claimant.publicKey),
    );
    assert.isTrue(claimAccount.claimed);
    assert.equal(
      claimAccount.claimant.toBase58(),
      claimant.publicKey.toBase58(),
    );

    const balanceBefore = await getTokenBalance(claimantAta);
    assert.equal(balanceBefore.toString(), amount.toString());

    // Second claim blocked by Anchor init constraint (SystemError::AccountAlreadyInUse: 0x0)
    await expectReverted(
      { revertedWith: { message: "custom program error: 0x0" } },
      sendIxs(context, [claimant], ix),
    );

    // Assert claimant balance did not increase and claim marker remains intact
    const balanceAfter = await getTokenBalance(claimantAta);
    assert.equal(balanceAfter.toString(), balanceBefore.toString());
    const claimAfter = await program.account.claim.fetch(
      claimPda(claimant.publicKey),
    );
    assert.isTrue(claimAfter.claimed);
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

    // Verify claim marker exists after Merkle claim
    const claimAccount = await program.account.claim.fetch(
      claimPda(claimant.publicKey),
    );
    assert.isTrue(claimAccount.claimed);
    assert.equal(
      claimAccount.claimant.toBase58(),
      claimant.publicKey.toBase58(),
    );

    const balanceBefore = await getTokenBalance(claimantAta);
    assert.equal(balanceBefore.toString(), amount.toString());

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

    // Blocked by Anchor init constraint because shared claim-marker PDA already exists (0x0)
    await expectReverted(
      { revertedWith: { message: "custom program error: 0x0" } },
      sendIxs(context, [claimant], sigIx, sigClaimIx),
    );

    // Assert claimant balance did not increase and claim marker remains intact
    const balanceAfter = await getTokenBalance(claimantAta);
    assert.equal(balanceAfter.toString(), balanceBefore.toString());
    const claimAfter = await program.account.claim.fetch(
      claimPda(claimant.publicKey),
    );
    assert.isTrue(claimAfter.claimed);
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

    // Verify claim marker exists after signature claim
    const claimAccount = await program.account.claim.fetch(
      claimPda(claimant.publicKey),
    );
    assert.isTrue(claimAccount.claimed);
    assert.equal(
      claimAccount.claimant.toBase58(),
      claimant.publicKey.toBase58(),
    );

    const balanceBefore = await getTokenBalance(claimantAta);
    assert.equal(balanceBefore.toString(), amount.toString());

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

    // Blocked by Anchor init constraint because shared claim-marker PDA already exists (0x0)
    await expectReverted(
      { revertedWith: { message: "custom program error: 0x0" } },
      sendIxs(context, [claimant], merkleIx),
    );

    // Assert claimant balance did not increase and claim marker remains intact
    const balanceAfter = await getTokenBalance(claimantAta);
    assert.equal(balanceAfter.toString(), balanceBefore.toString());
    const claimAfter = await program.account.claim.fetch(
      claimPda(claimant.publicKey),
    );
    assert.isTrue(claimAfter.claimed);
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

    // Verify claim marker exists
    const claimAccount = await program.account.claim.fetch(
      claimPda(claimant.publicKey),
    );
    assert.isTrue(claimAccount.claimed);
    assert.equal(
      claimAccount.claimant.toBase58(),
      claimant.publicKey.toBase58(),
    );

    const balanceBefore = await getTokenBalance(claimantAta);
    assert.equal(balanceBefore.toString(), amount.toString());

    // Second signature claim fails because shared claim-marker PDA already exists (0x0)
    const sigIx2 = buildClaimSignatureIx(
      signer,
      claimant.publicKey,
      amount,
      program.programId,
    );
    await expectReverted(
      { revertedWith: { message: "custom program error: 0x0" } },
      sendIxs(context, [claimant], sigIx2, claimIx),
    );

    // Assert claimant balance did not increase and claim marker remains intact
    const balanceAfter = await getTokenBalance(claimantAta);
    assert.equal(balanceAfter.toString(), balanceBefore.toString());
    const claimAfter = await program.account.claim.fetch(
      claimPda(claimant.publicKey),
    );
    assert.isTrue(claimAfter.claimed);
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

    // Confirm that Bob receives no tokens from the failed transaction
    const bobBalance = await getTokenBalance(bobAta);
    assert.equal(bobBalance.toString(), "0");

    // Bob tries to claim passing Alice's claim PDA (Anchor seeds constraint fails: 2006 = 0x7d6)
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
      { revertedWith: { message: "0x7d6" } }, // ConstraintSeeds
      sendIxs(context, [bob], sigIx, claimIxAlicePda),
    );
  });

  it("enforces one-time initialization and rejects second initialize call", async () => {
    const { context, program, mint, payer, config, signer, tree } = env;

    // 1. Initial configuration was successfully initialized in setupAirdrop
    const initialConfig = await program.account.config.fetch(config);
    assert.deepEqual([...initialConfig.merkleRoot], [...tree.root]);
    assert.equal(initialConfig.signer.toBase58(), signer.publicKey.toBase58());

    // 2. Attempt to initialize the same configuration PDA a second time
    const fakeSigner = Keypair.generate();
    const fakeRoot = new Array(32).fill(0xee);
    const reinitIx = await program.methods
      .initialize(fakeRoot, fakeSigner.publicKey)
      .accountsPartial({
        mint,
        payer: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    // 3. Assert that the second initialization fails because config PDA already exists (SystemError::AccountAlreadyInUse: 0x0)
    await expectReverted(
      { revertedWith: { message: "custom program error: 0x0" } },
      sendIxs(context, [payer], reinitIx),
    );

    // 4. Fetch the configuration afterward and confirm root and signer were not overwritten
    const postConfig = await program.account.config.fetch(config);
    assert.deepEqual([...postConfig.merkleRoot], [...tree.root]);
    assert.equal(postConfig.signer.toBase58(), signer.publicKey.toBase58());
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
