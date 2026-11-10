# 04 — Merkle Airdrop Test Suite Output

All 11 tests pass, comprehensively verifying Merkle proof and Ed25519 signature verification pathways, anti-double-claim protections across all path combinations, unauthorized signer rejections, one-time initialization, and cross-user signature replay prevention.

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
```

## Rubric Verification

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
  Verified by `there is a test that signature for one user cannot be used by another (cross-user signature replay)`:
  - Alice's valid signature attempted by Bob with Bob's claim PDA fails message verification with `InvalidSignatureMessage` (`0x1774` / error `6004`). Bob's token balance remains zero (`bobBalance == 0`).
  - Attempting to pass Alice's claim PDA fails Anchor's seeds constraint (`ConstraintSeeds` / `0x7d6` / error `2006`).
- **15. initialize is one-time and cannot be re-run on the same config**:
  Enforced by Anchor `init` constraint on fixed PDA seeds `[b"config"]`. Second initialization is rejected by System Program with `AccountAlreadyInUse` (`0x0`), leaving root and signer intact. Verified by `enforces one-time initialization and rejects second initialize call`.
- **16. claimed test coverage matches actual test behavior**:
  All 11 tests directly match the requirements, covering legitimate claims, invalid proofs, replay attempts, double claims, unauthorized signers, zero amount, and double initialization.
- **17. test execution evidence confirms all tests pass**:
  All 11 tests execute and pass cleanly on-chain in Bankrun (`11 passing (2s)`, `0 failing`).

---

## CI Execution Details

- **Date:** 2026-11-10T13:01:44Z
- **Repository:** [`ShivamKashyap966/redduck-academy-solana-template`](https://github.com/ShivamKashyap966/redduck-academy-solana-template)
- **Branch:** `main`
- **Tested Code Commit:** [`e17db93797e754ef4af6ca19c24dcdf7bf191053`](https://github.com/ShivamKashyap966/redduck-academy-solana-template/commit/e17db93797e754ef4af6ca19c24dcdf7bf191053)
- **CI Documentation Snapshot:** [`14cbbf123b3641b71dcf87869385bf5640fe6bf9`](https://github.com/ShivamKashyap966/redduck-academy-solana-template/commit/14cbbf123b3641b71dcf87869385bf5640fe6bf9)
- **GitHub Actions Run:** [#23 (ID 42819872329)](https://github.com/ShivamKashyap966/redduck-academy-solana-template/actions/runs/42819872329)
- **Workflow / Job:** `Test` / `test`

---

## Detailed Log Evidence

### Criterion 06 — Anti-Double-Claim Protection Evidence

#### Scenario 1: Merkle Double-Claim
Calling `claim` twice for the same claimant:

```text
2026-11-10T13:01:44.8174159Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:01:44.8176155Z DEBUG Program log: Instruction: Claim
2026-11-10T13:01:44.8178016Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:01:44.8180800Z DEBUG Program log: Allocate: account Address { address: CDHcYd14ehvUFztF5wHP1jg1NrBicskwHfpXMU69obGZ, base: None } already in use
2026-11-10T13:01:44.8182462Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
2026-11-10T13:01:44.8185822Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
2026-11-10T13:01:44.8186968Z     ✔ refuses claiming twice via Merkle proof (anti-double-claim guard)
```

#### Scenario 2: Merkle then Signature Cross-Path Guard
Claiming via Merkle proof first, then attempting to claim via signature:

```text
2026-11-10T13:01:45.1501806Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:01:45.1503756Z DEBUG Program log: Instruction: ClaimWithSignature
2026-11-10T13:01:45.1505544Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:01:45.1507442Z DEBUG Program log: Allocate: account Address { address: Bz9QHxQS9yUeB3dqcGkEFi2FzFmUSAE8JU9G9dn4jQvF, base: None } already in use
2026-11-10T13:01:45.1509711Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
2026-11-10T13:01:45.1513149Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
2026-11-10T13:01:45.1513891Z     ✔ refuses claiming via signature if already claimed via Merkle proof
```

#### Scenario 3: Signature then Merkle Cross-Path Guard
Claiming via signature first, then attempting to claim via Merkle proof:

```text
2026-11-10T13:01:45.3056156Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:01:45.3057868Z DEBUG Program log: Instruction: Claim
2026-11-10T13:01:45.3059424Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:01:45.3060775Z DEBUG Program log: Allocate: account Address { address: EXZmeaosgwMq4fHUjTCFTGBGQKXA4Zc3xPh3Ynz8No1m, base: None } already in use
2026-11-10T13:01:45.3062300Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
2026-11-10T13:01:45.3065317Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
2026-11-10T13:01:45.3074033Z     ✔ refuses claiming via Merkle proof if already claimed via signature
```

#### Scenario 4: Signature Double-Claim
Calling `claim_with_signature` twice for the same claimant:

```text
2026-11-10T13:01:45.4793973Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:01:45.4795812Z DEBUG Program log: Instruction: ClaimWithSignature
2026-11-10T13:01:45.4797823Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:01:45.4800554Z DEBUG Program log: Allocate: account Address { address: 9EJsooJWDQTDXFLWjD6syr8F4RyKX8jdoJTxXrDh1QgG, base: None } already in use
2026-11-10T13:01:45.4803153Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
2026-11-10T13:01:45.4807436Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
2026-11-10T13:01:45.4810390Z     ✔ refuses claiming twice via signature
```

---

### Criterion 14 — Cross-User Signature Replay Evidence

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

Link to official GitHub Actions run: [GitHub Actions Run #23 (ID 42819872329)](https://github.com/ShivamKashyap966/redduck-academy-solana-template/actions/runs/42819872329)
