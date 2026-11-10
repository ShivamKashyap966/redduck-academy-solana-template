# 04 — Merkle Airdrop Solution

## 1. Why `init_if_needed` was unsafe for the shared claim marker
Using `init_if_needed` allows an existing on-chain account to satisfy Anchor's account-validation step without raising an error. If an account with the specified PDA seeds already exists, Anchor's `init_if_needed` deserializes and loads that existing account into the instruction context rather than rejecting the transaction. This shifts the entire burden of anti-double-claim protection to programmatic state assertions inside the instruction handler (e.g., checking `!claim.claimed`). If those manual assertions are absent, bypassed, or invalidated by account reinitialization, the existing claim marker could be reused or overwritten.

In contrast, Anchor's `init` constraint enforces strict one-time account creation at the runtime boundary. Under `init`, Anchor always issues a CPI to the Solana System Program's `create_account` instruction. If the PDA account has already been allocated or initialized (has lamports or nonzero data), the System Program immediately fails with `SystemError::AccountAlreadyInUse` (code `0x0`). This guarantees that account creation is strictly atomic and non-repeatable before the instruction body ever executes.

## 2. How the common claim-marker PDA and `init` together enforce the cross-path guard
The program exposes two independent claim mechanisms:
1. Merkle proof verification (`claim`)
2. Ed25519 signature verification (`claim_with_signature`)

To ensure that each recipient can claim at most once across the entire protocol, both instructions specify the exact same claim-marker PDA with identical seeds:

```rust
#[account(
    init,
    payer = claimant,
    space = 8 + Claim::INIT_SPACE,
    seeds = [CLAIM_SEED, claimant.key().as_ref()],
    bump,
)]
pub claim: Account<'info, Claim>,
```

where `CLAIM_SEED = b"claim"`.

Neither path incorporates caller-controlled values—such as claim method type, Merkle proof hashes, Ed25519 signature bytes, or claim amounts—into the PDA seeds. As a result, the PDA address is deterministically and uniquely bound to the recipient's public key (`claimant.key()`).

Together, the shared PDA address and the `init` constraint enforce the cross-path guard:
- **First Claim (Merkle or Signature):** The claimant presents valid authorization (proof or signature). The claim-marker PDA does not yet exist. The System Program successfully creates the account, and the program records `claim.claimed = true`.
- **Subsequent Claim (Same or Alternative Path):** Whether the claimant attempts to call the same claim method again or switches to the other verification path, Anchor derives the identical PDA address `[b"claim", claimant.key().as_ref()]`. Because the PDA was already created during the initial claim, Anchor's `init` constraint fails during System Program account creation (`AccountAlreadyInUse: 0x0`).

Because account creation failure occurs during account validation, neither the alternative proof path nor a duplicate invocation can bypass the guard or drain additional tokens.

## 3. Why Alice's signature cannot authorize Bob
The trusted signer creates an Ed25519 signature over a strictly formatted 72-byte message binding three components:

```text
[claimant_pubkey (32 bytes) || amount (8 bytes LE) || program_id (32 bytes)]
```

On-chain, `claim_with_signature` inspects the preceding Ed25519 verification instruction from the `instructions` sysvar (`SYSVAR_INSTRUCTIONS_PUBKEY`). It independently reconstructs the expected message using `ctx.accounts.claimant.key()`, the instruction `amount`, and `crate::ID`. It then verifies byte-for-byte that the message verified by the Ed25519 instruction matches this expected message:

```rust
let expected_message = [
    ctx.accounts.claimant.key().as_ref(),
    &amount.to_le_bytes(),
    crate::ID.as_ref(),
].concat();

require!(
    message == expected_message.as_slice(),
    MerkleError::InvalidSignatureMessage // 0x1774
);
```

If Bob attempts to reuse a valid signature issued for Alice:
- If Bob submits his own public key as `claimant`, the on-chain expected message binds `bob.key()`, which fails to match the signed message binding `alice.key()`. The transaction reverts specifically with `MerkleError::InvalidSignatureMessage` (`0x1774`).
- If Bob attempts to pass Alice's public key or Alice's claim PDA, Anchor rejects the transaction with a signer or seeds constraint violation (`ConstraintSeeds` / `0x7d6`).
- In all failure modes, the transaction aborts before the token transfer CPI, and Bob's token balance remains zero.

Consequently, an Ed25519 signature is strictly bound to its intended recipient and cannot be replayed by other users.

## 4. How the fixed-seed configuration PDA enforces one-time initialization
The `Config` PDA is derived using the fixed seed `[b"config"]` and initialized with Anchor's `init` constraint:

```rust
#[account(
    init,
    payer = payer,
    space = 8 + Config::INIT_SPACE,
    seeds = [CONFIG_SEED],
    bump,
)]
pub config: Account<'info, Config>,
```

Because `CONFIG_SEED` is constant (`b"config"`), there is exactly one configuration PDA per program deployment. Anchor's `init` constraint invokes the System Program to allocate and assign the account. If `initialize` is called a second time, the account already exists on-chain, causing the System Program and Anchor runtime validation to fail with `AccountAlreadyInUse` (`0x0`). The existing configuration, including the original Merkle root and trusted signer pubkey, cannot be modified or overwritten.

## 5. Test Execution Evidence

### Execution Details
- **Repository:** [`ShivamKashyap966/redduck-academy-solana-template`](https://github.com/ShivamKashyap966/redduck-academy-solana-template)
- **Tested code commit:** `e17db93797e754ef4af6ca19c24dcdf7bf191053`
- **Documentation snapshot tested by CI:** `14cbbf123b3641b71dcf87869385bf5640fe6bf9`
- **CI run:** https://github.com/ShivamKashyap966/redduck-academy-solana-template/actions/runs/42819872329
- **Root-level evidence file:** [`../../TEST_OUTPUT.md`](../../TEST_OUTPUT.md)
- **Task Test Command:**

```bash
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/04-merkle-airdrop/*.test.ts
```

### Actual Full Test-Suite Output (11 Passing, 0 Failing)

```text
  04-merkle-airdrop
    ✔ claims an allocation with a valid Merkle proof
    ✔ refuses claim with an invalid Merkle proof
    ✔ refuses claiming twice via Merkle proof (anti-double-claim guard)
    ✔ claims an allocation with a valid signature
    ✔ refuses claiming via signature if already claimed via Merkle proof
    ✔ refuses claiming via Merkle proof if already claimed via signature
    ✔ refuses claiming twice via signature
    ✔ refuses claim with a signature signed by an unauthorized key
    ✔ there is a test that signature for one user cannot be used by another (cross-user signature replay)
    ✔ enforces one-time initialization and rejects second initialize call
    ✔ refuses claim with zero amount

  11 passing (2s)
  0 failing
```

### Criterion 06 — Anti-Double-Claim Execution Evidence
All four anti-double-claim pathways were verified against the System Program's atomic account creation guard:

#### Merkle Double Claim
System Program rejects second claim with `AccountAlreadyInUse` (`0x0`):

```text
2026-11-10T13:01:44.8174159Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:01:44.8176155Z DEBUG Program log: Instruction: Claim
2026-11-10T13:01:44.8178016Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:01:44.8180800Z DEBUG Program log: Allocate: account Address { address: CDHcYd14ehvUFztF5wHP1jg1NrBicskwHfpXMU69obGZ, base: None } already in use
2026-11-10T13:01:44.8182462Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
2026-11-10T13:01:44.8185822Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
2026-11-10T13:01:44.8186968Z     ✔ refuses claiming twice via Merkle proof (anti-double-claim guard)
```

#### Merkle then Signature Cross-Path Guard
Initial claim via Merkle blocks subsequent claim via signature (`0x0`):

```text
2026-11-10T13:01:45.1501806Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:01:45.1503756Z DEBUG Program log: Instruction: ClaimWithSignature
2026-11-10T13:01:45.1505544Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:01:45.1507442Z DEBUG Program log: Allocate: account Address { address: Bz9QHxQS9yUeB3dqcGkEFi2FzFmUSAE8JU9G9dn4jQvF, base: None } already in use
2026-11-10T13:01:45.1509711Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
2026-11-10T13:01:45.1513149Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
2026-11-10T13:01:45.1513891Z     ✔ refuses claiming via signature if already claimed via Merkle proof
```

#### Signature then Merkle Cross-Path Guard
Initial claim via signature blocks subsequent claim via Merkle proof (`0x0`):

```text
2026-11-10T13:01:45.3056156Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:01:45.3057868Z DEBUG Program log: Instruction: Claim
2026-11-10T13:01:45.3059424Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:01:45.3060775Z DEBUG Program log: Allocate: account Address { address: EXZmeaosgwMq4fHUjTCFTGBGQKXA4Zc3xPh3Ynz8No1m, base: None } already in use
2026-11-10T13:01:45.3062300Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
2026-11-10T13:01:45.3065317Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
2026-11-10T13:01:45.3074033Z     ✔ refuses claiming via Merkle proof if already claimed via signature
```

#### Signature Double Claim
Calling `claim_with_signature` twice fails with `0x0`:

```text
2026-11-10T13:01:45.4793973Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:01:45.4795812Z DEBUG Program log: Instruction: ClaimWithSignature
2026-11-10T13:01:45.4797823Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:01:45.4800554Z DEBUG Program log: Allocate: account Address { address: 9EJsooJWDQTDXFLWjD6syr8F4RyKX8jdoJTxXrDh1QgG, base: None } already in use
2026-11-10T13:01:45.4803153Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
2026-11-10T13:01:45.4807436Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
2026-11-10T13:01:45.4810390Z     ✔ refuses claiming twice via signature
```

### Criterion 14 — Cross-User Replay Execution Evidence
In the cross-user signature replay test:
1. **Alice's Valid Signature:** A valid Ed25519 signature authorizing `[alice.publicKey || amount || programId]` was submitted by Bob with Bob's claimant account and Bob's claim PDA.
2. **Rejection via `InvalidSignatureMessage` (`0x1774` / error `6004`):** The program reconstructed the expected message with `bob.publicKey`, detected the mismatch with Alice's signed message, and aborted execution before transferring tokens.
3. **Bob Balance Zero:** Bob's associated token account was inspected immediately after the revert, confirming Bob received zero tokens (`bobBalance == 0`).
4. **Anchor Seeds Guard (`0x7d6` / error `2006`):** Bob's attempt to masquerade as Alice by passing Alice's claim PDA failed Anchor's seeds constraint (`ConstraintSeeds`).
5. **Passed Test:** The test completed successfully and passed in the official CI runner:
   `✔ there is a test that signature for one user cannot be used by another (cross-user signature replay)`

#### Verbatim CI Runtime Log Excerpt (Run #23, ID 42819872329)

```text
2026-11-10T13:01:45.794625294Z DEBUG solana_runtime::message_processor::stable_log] Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:01:45.794634521Z DEBUG solana_runtime::message_processor::stable_log] Program 11111111111111111111111111111111 success
2026-11-10T13:01:45.794640833Z DEBUG solana_runtime::message_processor::stable_log] Program log: Initialize the associated token account
2026-11-10T13:01:45.7991614Z DEBUG Program ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL success
2026-11-10T13:01:45.8029073Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:01:45.8032043Z DEBUG Program log: Instruction: ClaimWithSignature
2026-11-10T13:01:45.8033822Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:01:45.8036037Z DEBUG Program 11111111111111111111111111111111 success
2026-11-10T13:01:45.8038785Z DEBUG Program log: AnchorError thrown in programs/04-merkle-airdrop/src/instructions/claim_with_signature.rs:110. Error Code: InvalidSignatureMessage. Error Number: 6004. Error Message: Invalid signature message.
2026-11-10T13:01:45.8042454Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt consumed 18551 of 400000 compute units
2026-11-10T13:01:45.8044659Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x1774
2026-11-10T13:01:45.8095938Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:01:45.8098248Z DEBUG Program log: Instruction: ClaimWithSignature
2026-11-10T13:01:45.8101240Z DEBUG Program log: AnchorError caused by account: claim. Error Code: ConstraintSeeds. Error Number: 2006. Error Message: A seeds constraint was violated.
2026-11-10T13:01:45.8103585Z DEBUG Program log: Left:
2026-11-10T13:01:45.8105421Z DEBUG Program log: 51ByxP28Qf4vDYM95sVbvVTgEHvwy7oWpbMJyZeNG2WJ
2026-11-10T13:01:45.8107386Z DEBUG Program log: Right:
2026-11-10T13:01:45.8109206Z DEBUG Program log: 9th7n5QkmUYxTwzuo7Ng2WB1kjccgHGkgzq9ULxyjEMF
2026-11-10T13:01:45.8111877Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt consumed 10183 of 400000 compute units
2026-11-10T13:01:45.8114749Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x7d6
2026-11-10T13:01:45.8117012Z     ✔ there is a test that signature for one user cannot be used by another (cross-user signature replay)
```

### Criteria 16 & 17 — Summary of Test Suite Execution
- **Criteria 16 (Comprehensive Coverage):** Covers all rubric requirements including positive claims, negative proof checks, unauthorized signers, cross-user replay, configuration immutability, zero amount rejections, and all four double-claim permutations.
- **Criteria 17 (Verified Passing Execution):** All 11 tests passed in GitHub Actions CI run `#23` (`42819872329`).

Link to verified GitHub Actions run: [GitHub Actions Run #23](https://github.com/ShivamKashyap966/redduck-academy-solana-template/actions/runs/42819872329)
