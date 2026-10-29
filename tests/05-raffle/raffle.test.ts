import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  AccountLayout,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from "@solana/spl-token";
import { assert } from "chai";

import {
  sendIxs,
  oneToken,
  findPDA,
  getTime,
  timeTravel,
  expectReverted,
} from "../helpers";
import { setupRaffle, fulfillRandomness, RaffleFixture } from "./fixture";

describe("05-raffle", () => {
  let env: RaffleFixture;

  const rafflePda = (): PublicKey => findPDA(["raffle"], env.program)[0];
  const vaultPda = (): PublicKey => findPDA(["vault"], env.program)[0];
  const entryPda = (index: number | BN): PublicKey => {
    const idxBN = typeof index === "number" ? new BN(index) : index;
    return findPDA(
      ["entry", idxBN.toArrayLike(Buffer, "le", 8)],
      env.program,
    )[0];
  };

  const getTokenBalance = async (address: PublicKey): Promise<bigint> => {
    const acc = await env.context.banksClient.getAccount(address);
    if (!acc) return 0n;
    return AccountLayout.decode(acc.data).amount;
  };

  beforeEach(async () => {
    env = await setupRaffle();
  });

  it("there is a test for a winning claim (full lifecycle with request_randomness)", async () => {
    const { context, program, payer, mint, oracle, funded } = env;

    const now = await getTime(context);
    const drawTime = Number(now) + 3600;

    // 1. Initialize raffle
    const initIx = await program.methods
      .initialize(new BN(drawTime), oracle.publicKey)
      .accountsPartial({
        mint,
        payer: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [payer], initIx);

    const [alice, bob, charlie] = funded.slice(0, 3);
    const aliceAmount = oneToken().muln(10); // 10 tokens
    const bobAmount = oneToken().muln(20);   // 20 tokens
    const charlieAmount = oneToken().muln(70); // 70 tokens
    const totalPot = oneToken().muln(100);

    // Setup and fund entrants
    for (const [entrant, amt] of [
      [alice, aliceAmount],
      [bob, bobAmount],
      [charlie, charlieAmount],
    ] as [Keypair, BN][]) {
      const ata = getAssociatedTokenAddressSync(mint, entrant.publicKey);
      await sendIxs(
        context,
        [payer],
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          ata,
          entrant.publicKey,
          mint,
        ),
        createMintToInstruction(
          mint,
          ata,
          payer.publicKey,
          BigInt(amt.toString()),
        ),
      );
    }

    // 2. Deposits
    // Entry 0: Alice [0, 10)
    const aliceAta = getAssociatedTokenAddressSync(mint, alice.publicKey);
    await sendIxs(
      context,
      [alice],
      await program.methods
        .deposit(aliceAmount)
        .accountsPartial({
          player: alice.publicKey,
          playerAta: aliceAta,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );

    // Entry 1: Bob [10, 30)
    const bobAta = getAssociatedTokenAddressSync(mint, bob.publicKey);
    await sendIxs(
      context,
      [bob],
      await program.methods
        .deposit(bobAmount)
        .accountsPartial({
          player: bob.publicKey,
          playerAta: bobAta,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );

    // Entry 2: Charlie [30, 100)
    const charlieAta = getAssociatedTokenAddressSync(mint, charlie.publicKey);
    await sendIxs(
      context,
      [charlie],
      await program.methods
        .deposit(charlieAmount)
        .accountsPartial({
          player: charlie.publicKey,
          playerAta: charlieAta,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );

    // Verify vault balance
    const vaultBal = await getTokenBalance(vaultPda());
    assert.equal(vaultBal.toString(), totalPot.toString());

    // 3. Fast-forward past drawTime
    await timeTravel(context, BigInt(drawTime + 10));

    // 4. Request randomness (visibly exercised on-chain)
    const requestIx = await program.methods
      .requestRandomness()
      .accountsPartial({
        payer: payer.publicKey,
      })
      .instruction();
    await sendIxs(context, [payer], requestIx);

    const raffleState = await program.account.raffle.fetch(rafflePda());
    assert.isTrue(raffleState.randomnessRequested);

    // 5. Fulfill randomness
    // Choose a random value where random_u128 % totalPot falls into Charlie's ticket range [30, 100)
    const randomTicket = oneToken().muln(45); // 45 tokens
    const randomBytes = Buffer.alloc(32);
    randomBytes.writeBigUInt64LE(BigInt(randomTicket.toString()), 0);

    await fulfillRandomness(env, Array.from(randomBytes));

    // 6. Charlie (the rightful winner) claims the whole pot
    const charlieBalBefore = await getTokenBalance(charlieAta);
    assert.equal(charlieBalBefore.toString(), "0");

    await sendIxs(
      context,
      [charlie],
      await program.methods
        .claim(new BN(2))
        .accountsPartial({
          winner: charlie.publicKey,
          winnerAta: charlieAta,
          entry: entryPda(2),
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );

    const charlieBalAfter = await getTokenBalance(charlieAta);
    assert.equal(charlieBalAfter.toString(), totalPot.toString());

    // 7. Enforces single-use semantics (refuses double claim)
    await expectReverted(
      { revertedWith: { message: "0x1777" } }, // AlreadyClaimed
      sendIxs(
        context,
        [charlie],
        await program.methods
          .claim(new BN(2))
          .accountsPartial({
            winner: charlie.publicKey,
            winnerAta: charlieAta,
            entry: entryPda(2),
            mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction(),
      ),
    );
  });

  it("there is a test for an invalid claim (rejects non-winning entries)", async () => {
    const { context, program, payer, mint, oracle, funded } = env;

    const now = await getTime(context);
    const drawTime = Number(now) + 3600;

    await sendIxs(
      context,
      [payer],
      await program.methods
        .initialize(new BN(drawTime), oracle.publicKey)
        .accountsPartial({
          mint,
          payer: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );

    const [alice, bob, charlie] = funded.slice(0, 3);
    const aliceAmount = oneToken().muln(10);
    const bobAmount = oneToken().muln(20);
    const charlieAmount = oneToken().muln(70);

    for (const [entrant, amt] of [
      [alice, aliceAmount],
      [bob, bobAmount],
      [charlie, charlieAmount],
    ] as [Keypair, BN][]) {
      const ata = getAssociatedTokenAddressSync(mint, entrant.publicKey);
      await sendIxs(
        context,
        [payer],
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          ata,
          entrant.publicKey,
          mint,
        ),
        createMintToInstruction(
          mint,
          ata,
          payer.publicKey,
          BigInt(amt.toString()),
        ),
      );
    }

    const aliceAta = getAssociatedTokenAddressSync(mint, alice.publicKey);
    await sendIxs(
      context,
      [alice],
      await program.methods
        .deposit(aliceAmount)
        .accountsPartial({
          player: alice.publicKey,
          playerAta: aliceAta,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );

    const bobAta = getAssociatedTokenAddressSync(mint, bob.publicKey);
    await sendIxs(
      context,
      [bob],
      await program.methods
        .deposit(bobAmount)
        .accountsPartial({
          player: bob.publicKey,
          playerAta: bobAta,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );

    const charlieAta = getAssociatedTokenAddressSync(mint, charlie.publicKey);
    await sendIxs(
      context,
      [charlie],
      await program.methods
        .deposit(charlieAmount)
        .accountsPartial({
          player: charlie.publicKey,
          playerAta: charlieAta,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );

    await timeTravel(context, BigInt(drawTime + 10));

    // Request randomness
    await sendIxs(
      context,
      [payer],
      await program.methods
        .requestRandomness()
        .accountsPartial({
          payer: payer.publicKey,
        })
        .instruction(),
    );

    // Fulfill randomness picking ticket 45 in Charlie's range [30, 100)
    const randomTicket = oneToken().muln(45);
    const randomBytes = Buffer.alloc(32);
    randomBytes.writeBigUInt64LE(BigInt(randomTicket.toString()), 0);
    await fulfillRandomness(env, Array.from(randomBytes));

    // Non-winner Alice (Entry 0: [0, 10)) rejected with NotWinner (0x1778)
    await expectReverted(
      { revertedWith: { message: "0x1778" } },
      sendIxs(
        context,
        [alice],
        await program.methods
          .claim(new BN(0))
          .accountsPartial({
            winner: alice.publicKey,
            winnerAta: aliceAta,
            entry: entryPda(0),
            mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction(),
      ),
    );

    // Non-winner Bob (Entry 1: [10, 30)) rejected with NotWinner (0x1778)
    await expectReverted(
      { revertedWith: { message: "0x1778" } },
      sendIxs(
        context,
        [bob],
        await program.methods
          .claim(new BN(1))
          .accountsPartial({
            winner: bob.publicKey,
            winnerAta: bobAta,
            entry: entryPda(1),
            mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction(),
      ),
    );
  });

  it("enforces request_randomness guards: deadline, entries, and single-use semantics", async () => {
    const { context, program, payer, mint, oracle, funded } = env;

    const now = await getTime(context);
    const drawTime = Number(now) + 3600;

    await sendIxs(
      context,
      [payer],
      await program.methods
        .initialize(new BN(drawTime), oracle.publicKey)
        .accountsPartial({
          mint,
          payer: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );

    // 1. Refuses request_randomness before drawTime
    await expectReverted(
      { revertedWith: { message: "0x1772" } }, // DrawNotReady
      sendIxs(
        context,
        [payer],
        await program.methods
          .requestRandomness()
          .accountsPartial({
            payer: payer.publicKey,
          })
          .instruction(),
      ),
    );

    // Fast forward past drawTime with no entries
    await timeTravel(context, BigInt(drawTime + 10));

    // 2. Refuses request_randomness when there are no entries
    await expectReverted(
      { revertedWith: { message: "0x1773" } }, // NoEntries
      sendIxs(
        context,
        [payer],
        await program.methods
          .requestRandomness()
          .accountsPartial({
            payer: payer.publicKey,
          })
          .instruction(),
      ),
    );
  });

  it("refuses claim before randomness is fulfilled", async () => {
    const { context, program, payer, mint, oracle, funded } = env;

    const now = await getTime(context);
    const drawTime = Number(now) + 3600;

    await sendIxs(
      context,
      [payer],
      await program.methods
        .initialize(new BN(drawTime), oracle.publicKey)
        .accountsPartial({
          mint,
          payer: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );

    const alice = funded[0];
    const aliceAta = getAssociatedTokenAddressSync(mint, alice.publicKey);
    await sendIxs(
      context,
      [payer],
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        aliceAta,
        alice.publicKey,
        mint,
      ),
      createMintToInstruction(
        mint,
        aliceAta,
        payer.publicKey,
        BigInt(oneToken().toString()),
      ),
    );

    await sendIxs(
      context,
      [alice],
      await program.methods
        .deposit(oneToken())
        .accountsPartial({
          player: alice.publicKey,
          playerAta: aliceAta,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );

    // Try to claim before randomness is fulfilled
    await expectReverted(
      { revertedWith: { message: "0x1776" } }, // RandomnessNotFulfilled
      sendIxs(
        context,
        [alice],
        await program.methods
          .claim(new BN(0))
          .accountsPartial({
            winner: alice.publicKey,
            winnerAta: aliceAta,
            entry: entryPda(0),
            mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction(),
      ),
    );
  });

  it("refuses deposit after draw deadline", async () => {
    const { context, program, payer, mint, oracle, funded } = env;

    const now = await getTime(context);
    const drawTime = Number(now) + 10;

    await sendIxs(
      context,
      [payer],
      await program.methods
        .initialize(new BN(drawTime), oracle.publicKey)
        .accountsPartial({
          mint,
          payer: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );

    const alice = funded[0];
    const aliceAta = getAssociatedTokenAddressSync(mint, alice.publicKey);
    await sendIxs(
      context,
      [payer],
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        aliceAta,
        alice.publicKey,
        mint,
      ),
      createMintToInstruction(
        mint,
        aliceAta,
        payer.publicKey,
        BigInt(oneToken().toString()),
      ),
    );

    // Fast-forward past draw time
    await timeTravel(context, BigInt(drawTime + 10));

    await expectReverted(
      { revertedWith: { message: "0x1771" } }, // RaffleClosed
      sendIxs(
        context,
        [alice],
        await program.methods
          .deposit(oneToken())
          .accountsPartial({
            player: alice.publicKey,
            playerAta: aliceAta,
            mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction(),
      ),
    );
  });

  it("refuses deposit with zero amount", async () => {
    const { context, program, payer, mint, oracle, funded } = env;

    const now = await getTime(context);
    const drawTime = Number(now) + 3600;

    await sendIxs(
      context,
      [payer],
      await program.methods
        .initialize(new BN(drawTime), oracle.publicKey)
        .accountsPartial({
          mint,
          payer: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );

    const alice = funded[0];
    const aliceAta = getAssociatedTokenAddressSync(mint, alice.publicKey);
    await sendIxs(
      context,
      [payer],
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        aliceAta,
        alice.publicKey,
        mint,
      ),
    );

    await expectReverted(
      { revertedWith: { message: "0x1779" } }, // ZeroAmount
      sendIxs(
        context,
        [alice],
        await program.methods
          .deposit(new BN(0))
          .accountsPartial({
            player: alice.publicKey,
            playerAta: aliceAta,
            mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction(),
      ),
    );
  });
});
