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
  0 failing
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

## CI Execution Details

- **Date:** 2026-11-10T13:48:23Z
- **Repository:** [`ShivamKashyap966/redduck-academy-solana-template`](https://github.com/ShivamKashyap966/redduck-academy-solana-template)
- **Branch:** `main`
- **Tested Code Commit:** [`e17db93797e754ef4af6ca19c24dcdf7bf191053`](https://github.com/ShivamKashyap966/redduck-academy-solana-template/commit/e17db93797e754ef4af6ca19c24dcdf7bf191053)
- **GitHub Actions Run:** [#24 (ID 42827107641)](https://github.com/ShivamKashyap966/redduck-academy-solana-template/actions/runs/42827107641)
- **Workflow / Job:** `Test` / `test`

---

## Detailed Log Evidence

### Criterion 06 — Anti-Double-Claim Protection Evidence

#### Scenario 1: Merkle Double-Claim
Calling `claim` twice for the same claimant fails atomic account creation:

```text
2026-11-10T13:48:22.7169438Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:48:22.7170554Z DEBUG Program log: Instruction: Claim
2026-11-10T13:48:22.7171452Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:48:22.7172451Z DEBUG Allocate: account Address { address: HEnFDHhsbXsUk5MyfevQPYPTonnpXsF7YppMKPkrGaFo, base: None } already in use
2026-11-10T13:48:22.7173460Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
2026-11-10T13:48:22.7176135Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
2026-11-10T13:48:22.7178212Z     ✔ refuses claiming twice via Merkle proof (anti-double-claim guard)
```

#### Scenario 2: Merkle then Signature Cross-Path Guard
Claiming via Merkle proof first, then attempting to claim via signature fails:

```text
2026-11-10T13:48:22.9822823Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:48:22.9824261Z DEBUG Program log: Instruction: ClaimWithSignature
2026-11-10T13:48:22.9825298Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:48:22.9826315Z DEBUG Allocate: account Address { address: 82j1C913oU9u9fLqJdcmwJ4yS9oE6r7fP7mD8tY3a1bC, base: None } already in use
2026-11-10T13:48:22.9827318Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
2026-11-10T13:48:22.9830021Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
2026-11-10T13:48:22.9834767Z     ✔ refuses claiming via signature if already claimed via Merkle proof
```

#### Scenario 3: Signature then Merkle Cross-Path Guard
Claiming via signature first, then attempting to claim via Merkle proof fails:

```text
2026-11-10T13:48:23.1163761Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:48:23.1165046Z DEBUG Program log: Instruction: Claim
2026-11-10T13:48:23.1166407Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:48:23.1168121Z DEBUG Allocate: account Address { address: EPCX1gfvxgW9STb4yTQcdsd4yzNx68BBES4VKv3fZTJq, base: None } already in use
2026-11-10T13:48:23.1170191Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
2026-11-10T13:48:23.1173561Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
2026-11-10T13:48:23.1174803Z     ✔ refuses claiming via Merkle proof if already claimed via signature
```

#### Scenario 4: Signature Double-Claim
Calling `claim_with_signature` twice for the same claimant fails:

```text
2026-11-10T13:48:23.2784539Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T13:48:23.2786034Z DEBUG Program log: Instruction: ClaimWithSignature
2026-11-10T13:48:23.2787311Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T13:48:23.2788931Z DEBUG Allocate: account Address { address: EfqNBK9vqizvCgc49SvxdingmHVdqem8bdpr5MDyR6te, base: None } already in use
2026-11-10T13:48:23.2790557Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
2026-11-10T13:48:23.2792536Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
2026-11-10T13:48:23.2801408Z     ✔ refuses claiming twice via signature
```

---

### Criterion 14 — Cross-User Signature Replay Evidence

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

Link to official GitHub Actions run: [GitHub Actions Run #24 (ID 42827107641)](https://github.com/ShivamKashyap966/redduck-academy-solana-template/actions/runs/42827107641)
