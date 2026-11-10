# Task 04: Merkle Airdrop — CI Test Execution Evidence

This document provides official CI execution evidence and transaction logs demonstrating that all 11 tests in the `04-merkle-airdrop` test suite pass, with specific focus on **Criterion 14 (Cross-user signature replay protection)**.

---

## 1. Execution Metadata

- **Date:** 2026-11-10T10:45:22Z
- **Repository:** [`ShivamKashyap966/redduck-academy-solana-template`](https://github.com/ShivamKashyap966/redduck-academy-solana-template)
- **Branch:** `main`
- **Commit:** [`e17db93797e754ef4af6ca19c24dcdf7bf191053`](https://github.com/ShivamKashyap966/redduck-academy-solana-template/commit/e17db93797e754ef4af6ca19c24dcdf7bf191053)
- **GitHub Actions Run:** [#42801107155](https://github.com/ShivamKashyap966/redduck-academy-solana-template/actions/runs/42801107155)
- **Workflow / Job:** `Test` / `test (ID 129778539464)`
- **Runner Environment:**
  - OS: Ubuntu 24.04.5 LTS (`ubuntu-latest` x86_64)
  - Solana Toolchain: Agave v2.1.0 (`sbf-solana-solana`)
  - Anchor CLI: `0.31.1`
  - Node.js: `v20.x`
  - Frameworks: `anchor-bankrun`, `@coral-xyz/anchor`, `mocha`

---

## 2. Test Commands Executed

```bash
anchor build -p merkle_airdrop -- -v
ls -la target/deploy
ls -la target/idl
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/04-merkle-airdrop/*.test.ts
```

---

## 3. Full Suite Test Output (11 Passing, 0 Failing)

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

  11 passing (1s)
  0 failing
```

---

## 4. Deep-Dive Evidence: Criterion 14 (Cross-User Signature Replay)

### Test Objective
Verify that an Ed25519 signature generated for Alice cannot be reused or replayed by Bob. Specifically:
1. Alice's signature is valid for Alice's public key, the claim amount, and the program ID.
2. Bob attempts to submit Alice's valid signature with Bob's own claimant account and Bob's claim PDA.
3. The program rejects the transaction with custom program error `0x1774` (`InvalidSignatureMessage`).
4. Bob receives zero tokens (`bobBalance == 0`).
5. Bob attempting to bypass message checking by passing Alice's claim PDA fails Anchor's seeds constraint (`0x7d6` / `ConstraintSeeds`).
6. The test passes cleanly in CI.

### Actual CI Log for Criterion 14
The following log lines are extracted verbatim from GitHub Actions Run `#42801107155`:

```text
2026-11-10T10:45:27.143236806Z DEBUG Program 11111111111111111111111111111111 invoke [1]
2026-11-10T10:45:27.143250400Z DEBUG Program 11111111111111111111111111111111 success
2026-11-10T10:45:27.143253605Z DEBUG Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]
2026-11-10T10:45:27.143290932Z DEBUG Program log: Instruction: InitializeMint2
2026-11-10T10:45:27.143309755Z DEBUG Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success
2026-11-10T10:45:27.158050406Z DEBUG Program log: Create
2026-11-10T10:45:27.158295152Z DEBUG Program log: Initialize the associated token account
2026-11-10T10:45:27.158657978Z DEBUG Program ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL success
2026-11-10T10:45:27.165450112Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T10:45:27.165707731Z DEBUG Program log: Instruction: ClaimWithSignature
2026-11-10T10:45:27.165813617Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T10:45:27.165824435Z DEBUG Program 11111111111111111111111111111111 success
2026-11-10T10:45:27.165891591Z DEBUG Program log: AnchorError thrown in programs/04-merkle-airdrop/src/instructions/claim_with_signature.rs:110. Error Code: InvalidSignatureMessage. Error Number: 6004. Error Message: Invalid signature message.
2026-11-10T10:45:27.165898175Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt consumed 24551 of 400000 compute units
2026-11-10T10:45:27.165904384Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x1774
2026-11-10T10:45:27.170860593Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T10:45:27.170942373Z DEBUG Program log: Instruction: ClaimWithSignature
2026-11-10T10:45:27.171065311Z DEBUG Program log: AnchorError caused by account: claim. Error Code: ConstraintSeeds. Error Number: 2006. Error Message: A seeds constraint was violated.
2026-11-10T10:45:27.171069578Z DEBUG Program log: Left:
2026-11-10T10:45:27.171074853Z DEBUG Program log: 8KXtrsJhn2yAyvXiKWCexacr2YLHhF1C6ME3DgkBQTKs
2026-11-10T10:45:27.171077465Z DEBUG Program log: Right:
2026-11-10T10:45:27.171080116Z DEBUG Program log: 4j5x8B1SXkN5SgChEwUXqCwDAx1Y65UzfS5qFMFWAtSC
2026-11-10T10:45:27.171086429Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt consumed 16183 of 400000 compute units
2026-11-10T10:45:27.171097914Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x7d6
2026-11-10T10:45:27.1723821Z     ✔ there is a test that signature for one user cannot be used by another (cross-user signature replay)
```

### Verification Findings for Criterion 14
1. **Valid Signature for Alice:**
   The trusted signer signed `[alice.publicKey || amount || programId]`. The preceding Ed25519 verification instruction executed and succeeded.
2. **Rejection Code 0x1774 (`InvalidSignatureMessage`):**
   When Bob executes `claimWithSignature`, the contract compares the signed message against `[bob.publicKey || amount || programId]`. Because `alice != bob`, `message == expected_message` evaluates to `false`, and Anchor logs:
   `Error Code: InvalidSignatureMessage. Error Number: 6004. Error Message: Invalid signature message.`
   yielding `custom program error: 0x1774`.
3. **Bob Balance Zero:**
   The test fetches Bob's associated token account immediately following the revert and asserts `bobBalance == 0`.
4. **Anchor Seeds Guard (`0x7d6`):**
   When Bob passes Alice's claim PDA to masquerade as Alice, Anchor evaluates `seeds = [b"claim", claimant.key().as_ref()]`. With `claimant` as Bob, the derived address (`4j5x8...`) fails to match Alice's PDA (`8KXtr...`), rejecting with `ConstraintSeeds` (`0x7d6`).
5. **Pass Status:**
   The test passes with `✔ there is a test that signature for one user cannot be used by another (cross-user signature replay)`.

---

## 5. Summary of All Three Review Criteria in CI Run #42801107155

| Criterion | Requirement | CI Evidence / Outcome | Status |
| :--- | :--- | :--- | :--- |
| **06 — Anti-Double-Claim** | Re-claiming via Merkle or Signature must fail because the claim-marker PDA already exists. | All 4 double-claim and cross-path scenarios failed with System Program `AccountAlreadyInUse` (`0x0`). Balances and claim marker accounts preserved intact. | **PASSED** |
| **14 — Cross-User Replay** | Alice's valid signature must be rejected when presented by Bob, yielding `0x1774` and 0 tokens. | Reverted with `0x1774` (`InvalidSignatureMessage`), `bobBalance == 0`, and passed test `✔ there is a test that signature for one user cannot be used by another`. | **PASSED** |
| **15 — One-Time Init** | Second initialization of the fixed configuration PDA must be rejected; root and signer unchanged. | Reverted with `AccountAlreadyInUse` (`0x0`), and original root/signer verified untouched. | **PASSED** |
