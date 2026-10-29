import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  AccountLayout,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { assert } from "chai";

import {
  sendIxs,
  oneToken,
  findPDA,
  timeTravel,
  getTime,
  expectReverted,
} from "../helpers";
import { setupStaking, StakingFixture } from "./fixture";

describe("02-staking", () => {
  let env: StakingFixture;

  const userState = (user: PublicKey): PublicKey => {
    return findPDA(["user", user.toBuffer()], env.program)[0];
  };

  const stakePosition = (user: PublicKey, index: number | BN): PublicKey => {
    const idxBN = typeof index === "number" ? new BN(index) : index;
    return findPDA(
      ["stake", user.toBuffer(), idxBN.toArrayLike(Buffer, "le", 8)],
      env.program,
    )[0];
  };

  const getTokenBalance = async (
    address: PublicKey,
  ): Promise<bigint> => {
    const info = await env.context.banksClient.getAccount(address);
    if (!info) return 0n;
    const decoded = AccountLayout.decode(info.data);
    return decoded.amount;
  };

  beforeEach(async () => {
    env = await setupStaking();
  });

  it("stakes one token into a new position", async () => {
    const { context, program, payer, rddkMint, userRddkAta } = env;
    const position = stakePosition(payer.publicKey, 0);

    const stakeIx = await program.methods
      .stake(oneToken())
      .accountsPartial({
        stakePosition: position,
        userRddkAta,
        rddkMint,
        user: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [payer], stakeIx);

    const pos = await program.account.stakePosition.fetch(position);
    assert.equal(pos.amount.toString(), oneToken().toString());
    assert.isAbove(pos.stakedAt.toNumber(), 0);
    assert.isFalse(pos.claimed);

    const user = await program.account.userState.fetch(
      userState(payer.publicKey),
    );
    assert.equal(user.stakeCount.toNumber(), 1);
  });

  it("stakes multiple positions for the same user with incrementing indices", async () => {
    const { context, program, payer, rddkMint, userRddkAta } = env;

    const pos0 = stakePosition(payer.publicKey, 0);
    const stakeIx0 = await program.methods
      .stake(oneToken().muln(10))
      .accountsPartial({
        stakePosition: pos0,
        userRddkAta,
        rddkMint,
        user: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [payer], stakeIx0);

    const pos1 = stakePosition(payer.publicKey, 1);
    const stakeIx1 = await program.methods
      .stake(oneToken().muln(25))
      .accountsPartial({
        stakePosition: pos1,
        userRddkAta,
        rddkMint,
        user: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [payer], stakeIx1);

    const fetchedPos0 = await program.account.stakePosition.fetch(pos0);
    const fetchedPos1 = await program.account.stakePosition.fetch(pos1);

    assert.equal(fetchedPos0.amount.toString(), oneToken().muln(10).toString());
    assert.equal(fetchedPos0.index.toNumber(), 0);
    assert.equal(fetchedPos1.amount.toString(), oneToken().muln(25).toString());
    assert.equal(fetchedPos1.index.toNumber(), 1);

    const user = await program.account.userState.fetch(
      userState(payer.publicKey),
    );
    assert.equal(user.stakeCount.toNumber(), 2);
  });

  it("refuses claim before 3-day lock duration expires", async () => {
    const { context, program, payer, rddkMint, userRddkAta, vrddkMint } = env;
    const position = stakePosition(payer.publicKey, 0);

    const stakeIx = await program.methods
      .stake(oneToken().muln(5))
      .accountsPartial({
        stakePosition: position,
        userRddkAta,
        rddkMint,
        user: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [payer], stakeIx);

    const userVrddkAta = getAssociatedTokenAddressSync(
      vrddkMint,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    // Create vRDDK ATA
    await sendIxs(
      context,
      [payer],
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        userVrddkAta,
        payer.publicKey,
        vrddkMint,
        TOKEN_2022_PROGRAM_ID,
      ),
    );

    // Fast forward only 1 day (less than 3 days)
    const now = await getTime(context);
    await timeTravel(context, now + BigInt(24 * 60 * 60));

    const claimIx = await program.methods
      .claim(new BN(0))
      .accountsPartial({
        user: payer.publicKey,
        stakePosition: position,
        vrddkMint,
        userVrddkAta,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: "0x1770" } }, // StillLocked
      sendIxs(context, [payer], claimIx),
    );
  });

  it("claims vRDDK after 3-day lock duration and unstakes RDDK", async () => {
    const {
      context,
      program,
      payer,
      rddkMint,
      userRddkAta,
      vrddkMint,
      vault,
    } = env;
    const stakeAmount = oneToken().muln(100);
    const position = stakePosition(payer.publicKey, 0);

    const rddkBeforeStake = await getTokenBalance(userRddkAta);

    // 1. Stake 100 RDDK
    const stakeIx = await program.methods
      .stake(stakeAmount)
      .accountsPartial({
        stakePosition: position,
        userRddkAta,
        rddkMint,
        user: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [payer], stakeIx);

    const rddkAfterStake = await getTokenBalance(userRddkAta);
    assert.equal(
      (rddkBeforeStake - rddkAfterStake).toString(),
      stakeAmount.toString(),
    );

    // 2. Create user vRDDK ATA (Token-2022)
    const userVrddkAta = getAssociatedTokenAddressSync(
      vrddkMint,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    await sendIxs(
      context,
      [payer],
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        userVrddkAta,
        payer.publicKey,
        vrddkMint,
        TOKEN_2022_PROGRAM_ID,
      ),
    );

    // 3. Fast-forward past 3 days (3 days + 60s)
    const now = await getTime(context);
    await timeTravel(context, now + BigInt(3 * 24 * 60 * 60 + 60));

    // 4. Claim vRDDK
    const claimIx = await program.methods
      .claim(new BN(0))
      .accountsPartial({
        user: payer.publicKey,
        stakePosition: position,
        vrddkMint,
        userVrddkAta,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [payer], claimIx);

    const vrddkBal = await getTokenBalance(userVrddkAta);
    assert.equal(vrddkBal.toString(), stakeAmount.toString());

    const pos = await program.account.stakePosition.fetch(position);
    assert.isTrue(pos.claimed);

    // 5. Refuse second claim
    await expectReverted(
      { revertedWith: { message: "0x1771" } }, // AlreadyClaimed
      sendIxs(context, [payer], claimIx),
    );

    // 6. Unstake (burn 60 vRDDK to get 60 RDDK back)
    const unstakeAmount = oneToken().muln(60);
    const unstakeIx = await program.methods
      .unstake(unstakeAmount)
      .accountsPartial({
        user: payer.publicKey,
        rddkMint,
        vrddkMint,
        vault,
        userRddkAta,
        userVrddkAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [payer], unstakeIx);

    const vrddkAfterUnstake = await getTokenBalance(userVrddkAta);
    assert.equal(
      vrddkAfterUnstake.toString(),
      (stakeAmount.sub(unstakeAmount)).toString(),
    );

    const rddkAfterUnstake = await getTokenBalance(userRddkAta);
    assert.equal(
      (rddkAfterUnstake - rddkAfterStake).toString(),
      unstakeAmount.toString(),
    );
  });

  it("refuses stake with zero amount", async () => {
    const { context, program, payer, rddkMint, userRddkAta } = env;
    const position = stakePosition(payer.publicKey, 0);

    const stakeIx = await program.methods
      .stake(new BN(0))
      .accountsPartial({
        stakePosition: position,
        userRddkAta,
        rddkMint,
        user: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: "0x1772" } }, // ZeroAmount
      sendIxs(context, [payer], stakeIx),
    );
  });

  it("refuses unstake with zero amount", async () => {
    const {
      context,
      program,
      payer,
      rddkMint,
      userRddkAta,
      vrddkMint,
      vault,
    } = env;

    const userVrddkAta = getAssociatedTokenAddressSync(
      vrddkMint,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const unstakeIx = await program.methods
      .unstake(new BN(0))
      .accountsPartial({
        user: payer.publicKey,
        rddkMint,
        vrddkMint,
        vault,
        userRddkAta,
        userVrddkAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: "0x1772" } }, // ZeroAmount
      sendIxs(context, [payer], unstakeIx),
    );
  });

  it("enforces that vRDDK is non-transferable", async () => {
    const {
      context,
      program,
      payer,
      rddkMint,
      userRddkAta,
      vrddkMint,
    } = env;
    const position = stakePosition(payer.publicKey, 0);

    // Stake & fast-forward to claim vRDDK
    await sendIxs(
      context,
      [payer],
      await program.methods
        .stake(oneToken().muln(10))
        .accountsPartial({
          stakePosition: position,
          userRddkAta,
          rddkMint,
          user: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );

    const userVrddkAta = getAssociatedTokenAddressSync(
      vrddkMint,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    await sendIxs(
      context,
      [payer],
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        userVrddkAta,
        payer.publicKey,
        vrddkMint,
        TOKEN_2022_PROGRAM_ID,
      ),
    );

    const now = await getTime(context);
    await timeTravel(context, now + BigInt(3 * 24 * 60 * 60 + 60));

    await sendIxs(
      context,
      [payer],
      await program.methods
        .claim(new BN(0))
        .accountsPartial({
          user: payer.publicKey,
          stakePosition: position,
          vrddkMint,
          userVrddkAta,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        })
        .instruction(),
    );

    // Create another wallet and try to transfer vRDDK to it
    const recipient = Keypair.generate();
    const recipientVrddkAta = getAssociatedTokenAddressSync(
      vrddkMint,
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    await sendIxs(
      context,
      [payer],
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        recipientVrddkAta,
        recipient.publicKey,
        vrddkMint,
        TOKEN_2022_PROGRAM_ID,
      ),
    );

    // Attempt transfer of vRDDK (Token-2022 NonTransferable should reject this)
    const transferIx = createTransferCheckedInstruction(
      userVrddkAta,
      vrddkMint,
      recipientVrddkAta,
      payer.publicKey,
      BigInt(oneToken().muln(5).toString()),
      6,
      [],
      TOKEN_2022_PROGRAM_ID,
    );

    await expectReverted(
      { revertedWith: { message: "custom program error" } },
      sendIxs(context, [payer], transferIx),
    );
  });
});
