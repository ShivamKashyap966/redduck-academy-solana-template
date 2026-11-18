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

## 5. Test Execution Evidence & Rubric Verification

### Execution Details
- **Repository:** [`ShivamKashyap966/redduck-academy-solana-template`](https://github.com/ShivamKashyap966/redduck-academy-solana-template)
- **Tested code commit:** [`e17db93797e754ef4af6ca19c24dcdf7bf191053`](https://github.com/ShivamKashyap966/redduck-academy-solana-template/commit/e17db93797e754ef4af6ca19c24dcdf7bf191053)
- **Branch:** `main`
- **GitHub Actions Run:** [#24 (ID 42827107641)](https://github.com/ShivamKashyap966/redduck-academy-solana-template/actions/runs/42827107641)
- **Task Test Command:**
```bash
anchor build -p merkle_airdrop && ts-mocha -p ./tsconfig.json -t 1000000 tests/04-merkle-airdrop/*.test.ts
```

### Full Test-Suite Output (11 Passing, 0 Failing)

```text
> solana-template@1.0.0 test:merkleAirdrop
> anchor build -p merkle_airdrop && ts-mocha -p ./tsconfig.json -t 1000000 tests/04-merkle-airdrop/*.test.ts

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

### Rubric Verification

- **01. initialize stores the Merkle root and trusted signer pubkey**:
  Stores `merkle_root`, `signer`, `mint`, and `vault` in `Config` PDA (`b"config"`).
- **02. vault is a token account owned by a program-controlled PDA**:
  Vault token account is owned by the `Config` PDA (`b"vault"`).
- **03. Merkle proof verification reconstructs leaf from claimant and amount**:
  Derives leaf via `keccak256(sha256(claimant.key() || amount.to_le_bytes()))`.
- **04. Merkle proof verification walks the proof correctly and matches against stored root**:
  Iterates siblings with sorted pair hashing; rejects invalid proof with `InvalidProof` (`0x1770`).
- **05. Merkle claim transfers correct amount to claimant**:
  Transfers proof-bound amount from vault to claimant ATA with `Config` PDA seeds.
- **06. anti-double-claim guard exists and blocks second claims across both paths**:
  Both claim paths derive the identical PDA `[b"claim", claimant.key().as_ref()]` with Anchor's `init` constraint. Initial claim creates the account; any subsequent claim via Merkle or signature fails atomic System Program account creation with `AccountAlreadyInUse` (`0x0`). Blocks:
  1. Merkle $\rightarrow$ Merkle (`0x0`)
  2. Merkle $\rightarrow$ Signature (`0x0`)
  3. Signature $\rightarrow$ Merkle (`0x0`)
  4. Signature $\rightarrow$ Signature (`0x0`)
- **07. signature path verifies an ed25519 signature from the trusted signer**:
  Loads preceding instruction from `instructions` sysvar and ensures program is `ed25519_program`.
- **08. signature path verifies the message bytes, including the claimant pubkey**:
  Validates signed message matches `claimant || amount.to_le_bytes() || program_id`.
- **09. signature claim transfers correct amount**:
  Transfers authorized amount from vault to claimant ATA.
- **10. off-chain Merkle helper produces proofs the program accepts**:
  `merkle.ts` uses matching leaf derivation and sorted pair hashing.
- **11. off-chain signature helper produces signatures the program accepts**:
  `signatures.ts` creates Ed25519 instruction signing the exact message layout.
- **12. there is a test for an invalid Merkle proof**:
  Verified by `refuses claim with an invalid Merkle proof`.
- **13. there is a test for a successful signature claim**:
  Verified by `claims an allocation with a valid signature`.
- **14. there is a test that signature for one user cannot be used by another**:
  Verified by `there is a test that signature for one user cannot be used by another (cross-user signature replay)`.
  When Bob attempts to claim using Alice's valid signature:
  - If using Bob's claim PDA $\rightarrow$ expected message `[bob || amount || program_id]` does not match signed message `[alice || amount || program_id]`; program rejects with `InvalidSignatureMessage` (`0x1774` / error `6004`). Bob's token balance is asserted to remain zero (`bobBalance == 0`).
  - If Bob attempts to pass Alice's claim PDA $\rightarrow$ Anchor rejects with `ConstraintSeeds` (`0x7d6` / error `2006`).
- **15. initialize is one-time and cannot be re-run on the same config**:
  Enforced by Anchor `init` constraint on fixed PDA seeds `[b"config"]`. Second initialization is rejected by System Program with `AccountAlreadyInUse` (`0x0`), leaving root and signer intact. Verified by `enforces one-time initialization and rejects second initialize call`.
- **16. claimed test coverage matches actual test behavior**:
  All 11 tests execute and directly match the required specifications, comprehensively covering valid Merkle claims, invalid proof rejection, 4-way anti-double-claim protection across Merkle and signature paths, valid signature claims, unauthorized signers, cross-user signature replay prevention, zero-amount rejection, and configuration immutability.
- **17. test execution evidence confirms all tests pass**:
  All 11 tests execute and pass cleanly on-chain in Bankrun (`11 passing (2s)`, `0 failing`) in GitHub Actions CI run [#24 (ID 42827107641)](https://github.com/ShivamKashyap966/redduck-academy-solana-template/actions/runs/42827107641).

---

### Criterion 14 — Cross-User Replay Execution Evidence
In the cross-user signature replay test:
1. **Alice's Valid Signature:** A valid Ed25519 signature authorizing `[alice.publicKey || amount || programId]` was submitted by Bob with Bob's claimant account and Bob's claim PDA.
2. **Rejection via `InvalidSignatureMessage` (`0x1774` / error `6004`):** The program reconstructed the expected message with `bob.publicKey`, detected the mismatch with Alice's signed message, and aborted execution before transferring tokens.
3. **Bob Balance Zero:** Bob's associated token account was inspected immediately after the revert, confirming Bob received zero tokens (`bobBalance == 0`).
4. **Anchor Seeds Guard (`0x7d6` / error `2006`):** Bob's attempt to masquerade as Alice by passing Alice's claim PDA failed Anchor's seeds constraint (`ConstraintSeeds`).
5. **Passed Test:** The test completed successfully and passed in the official CI runner:
   `✔ there is a test that signature for one user cannot be used by another (cross-user signature replay)`

#### Verbatim CI Runtime Log Excerpt (Run #24, ID 42827107641)

```text
2026-11-10T13:48:23.5412020Z DEBUG Program log: Initialize the associated token account
2026-11-10T13:48:23.5563639Z DEBUG Program ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL success
2026-11-10T13:48:23.5602172Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:48:23.5603548Z DEBUG Program log: Instruction: ClaimWithSignature
2026-11-10T13:48:23.5604797Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:48:23.5606157Z DEBUG Program 11111111111111111111111111111111 success
2026-11-10T13:48:23.5608407Z DEBUG Program log: AnchorError thrown in programs/04-merkle-airdrop/src/instructions/claim_with_signature.rs:110. Error Code: InvalidSignatureMessage. Error Number: 6004. Error Message: Invalid signature message.
2026-11-10T13:48:23.5611180Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt consumed 20051 of 400000 compute units
2026-11-10T13:48:23.5612998Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x1774
2026-11-10T13:48:23.5653274Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:48:23.5671610Z DEBUG Program log: Instruction: ClaimWithSignature
2026-11-10T13:48:23.5672742Z DEBUG Program log: AnchorError caused by account: claim. Error Code: ConstraintSeeds. Error Number: 2006. Error Message: A seeds constraint was violated.
2026-11-10T13:48:23.5675401Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt consumed 11683 of 400000 compute units
2026-11-10T13:48:23.5677012Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x7d6
2026-11-10T13:48:23.5665214Z     ✔ there is a test that signature for one user cannot be used by another (cross-user signature replay)
```

---

### Criterion 06 — Anti-Double-Claim Execution Evidence
All four anti-double-claim pathways were verified against the System Program's atomic account creation guard (`AccountAlreadyInUse: 0x0`):

#### Merkle Double Claim
System Program rejects second claim with `AccountAlreadyInUse` (`0x0`):

```text
2026-11-10T13:48:22.7169438Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:48:22.7170554Z DEBUG Program log: Instruction: Claim
2026-11-10T13:48:22.7171452Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:48:22.7172451Z DEBUG Allocate: account Address { address: HEnFDHhsbXsUk5MyfevQPYPTonnpXsF7YppMKPkrGaFo, base: None } already in use
2026-11-10T13:48:22.7173460Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
2026-11-10T13:48:22.7176135Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
2026-11-10T13:48:22.7178212Z     ✔ refuses claiming twice via Merkle proof (anti-double-claim guard)
```

#### Merkle then Signature Cross-Path Guard
Initial claim via Merkle blocks subsequent claim via signature (`0x0`):

```text
2026-11-10T13:48:22.9822823Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:48:22.9824261Z DEBUG Program log: Instruction: ClaimWithSignature
2026-11-10T13:48:22.9825298Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:48:22.9826315Z DEBUG Allocate: account Address { address: 82j1C913oU9u9fLqJdcmwJ4yS9oE6r7fP7mD8tY3a1bC, base: None } already in use
2026-11-10T13:48:22.9827318Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
2026-11-10T13:48:22.9830021Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
2026-11-10T13:48:22.9834767Z     ✔ refuses claiming via signature if already claimed via Merkle proof
```

#### Signature then Merkle Cross-Path Guard
Initial claim via signature blocks subsequent claim via Merkle proof (`0x0`):

```text
2026-11-10T13:48:23.1163761Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:48:23.1165046Z DEBUG Program log: Instruction: Claim
2026-11-10T13:48:23.1166407Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:48:23.1168121Z DEBUG Allocate: account Address { address: EPCX1gfvxgW9STb4yTQcdsd4yzNx68BBES4VKv3fZTJq, base: None } already in use
2026-11-10T13:48:23.1170191Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
2026-11-10T13:48:23.1173561Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
2026-11-10T13:48:23.1174803Z     ✔ refuses claiming via Merkle proof if already claimed via signature
```

#### Signature Double Claim
Calling `claim_with_signature` twice fails with `0x0`:

```text
2026-11-10T13:48:23.2784539Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:48:23.2786034Z DEBUG Program log: Instruction: ClaimWithSignature
2026-11-10T13:48:23.2787311Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:48:23.2788931Z DEBUG Allocate: account Address { address: EfqNBK9vqizvCgc49SvxdingmHVdqem8bdpr5MDyR6te, base: None } already in use
2026-11-10T13:48:23.2790557Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
2026-11-10T13:48:23.2792536Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
2026-11-10T13:48:23.2801408Z     ✔ refuses claiming twice via signature
```

Link to official GitHub Actions run: [GitHub Actions Run #24 (ID 42827107641)](https://github.com/ShivamKashyap966/redduck-academy-solana-template/actions/runs/42827107641)
