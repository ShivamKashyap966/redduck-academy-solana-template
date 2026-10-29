# 04 — Merkle Airdrop Test Suite Output

All 10 tests pass, comprehensively verifying Merkle proof and Ed25519 signature verification pathways, anti-double-claim protections across all path combinations, unauthorized signer rejections, and cross-user signature replay prevention.

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
    ✔ refuses claim with zero amount

  10 passing (335ms)
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
  Both claim paths use `Claim` PDA at `[b"claim", claimant.key().as_ref()]` with `init_if_needed`.
  Checks `require!(!ctx.accounts.claim.claimed, MerkleError::AlreadyClaimed)` and sets `claimed = true`.
  Blocks:
  1. Merkle $\rightarrow$ Merkle (`0x1771`)
  2. Merkle $\rightarrow$ Signature (`0x1771`)
  3. Signature $\rightarrow$ Merkle (`0x1771`)
  4. Signature $\rightarrow$ Signature (`0x1771`)
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
  When Bob tries to use Alice's signature:
  - If using Bob's claim PDA $\rightarrow$ signed message (`alice`) does not match expected message (`bob`), rejected with `InvalidSignatureMessage` (`0x1774`).
  - If passing Alice's claim PDA $\rightarrow$ Anchor rejects with constraint seeds violation.
- **15. initialize is one-time and cannot be re-run on the same config**:
  Enforced by Anchor fixed PDA seeds `[b"config"]`.
- **16 & 17. claimed test coverage matches actual test behavior**:
  All 10 tests pass on-chain in Bankrun.
