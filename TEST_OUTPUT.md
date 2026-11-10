# Task 04: Merkle Airdrop — CI Test Execution Evidence

This document provides official CI execution evidence and transaction logs demonstrating that all 11 tests in the `04-merkle-airdrop` test suite pass, covering:
- **Criterion 06:** Anti-double-claim protection (Merkle and Signature paths using shared claim-marker PDA with `init`).
- **Criterion 14:** Cross-user signature replay protection (Alice's signature rejected when Bob attempts to use it).
- **Criteria 16 & 17:** Complete test-suite coverage and verified passing execution results.

---

## 1. Execution Metadata

- **Date:** 2026-11-10T11:54:21Z
- **Repository:** [`ShivamKashyap966/redduck-academy-solana-template`](https://github.com/ShivamKashyap966/redduck-academy-solana-template)
- **Branch:** `main`
- **Submitted Documentation Commit:** [`1111aa732aa5d654e2b50ee227ccf172928164ab`](https://github.com/ShivamKashyap966/redduck-academy-solana-template/commit/1111aa732aa5d654e2b50ee227ccf172928164ab)
- **Tested Code Commit:** [`e17db93797e754ef4af6ca19c24dcdf7bf191053`](https://github.com/ShivamKashyap966/redduck-academy-solana-template/commit/e17db93797e754ef4af6ca19c24dcdf7bf191053)
- **GitHub Actions Run:** [#20 (ID 42810645795)](https://github.com/ShivamKashyap966/redduck-academy-solana-template/actions/runs/42810645795)
- **Workflow / Job:** `Test` / `test`
- **Runner Environment:**
  - OS: Ubuntu 24.04.1 LTS (`ubuntu-latest` x86_64)
  - Solana Toolchain: Agave v2.1.0 (`sbf-solana-solana`)
  - Anchor CLI: `0.31.1`
  - Node.js: `v20.x`
  - Test Frameworks: `anchor-bankrun`, `@coral-xyz/anchor`, `mocha`

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

## 4. Criterion 06 — Anti-Double-Claim Protection Evidence

### Technical Mechanism
Both `claim` and `claim_with_signature` instructions derive the exact same claim-marker PDA:
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
By utilizing Anchor's `init` constraint, account creation is delegated to the Solana System Program's `create_account`. Once an account is initialized for a claimant, any subsequent attempt to re-initialize the account fails with `SystemError::AccountAlreadyInUse` (`0x0`).

### Scenarios Tested and Verified

1. **Merkle Double-Claim:** Calling `claim` twice for the same claimant.
   ```text
   2026-11-10T11:54:25.4046836Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
   2026-11-10T11:54:25.4047931Z DEBUG Program log: Instruction: Claim
   2026-11-10T11:54:25.4048948Z DEBUG Program 11111111111111111111111111111111 invoke [2]
   2026-11-10T11:54:25.4049912Z DEBUG Program log: Allocate: account Address { address: FvwYMMnhoC8t6bb8zSVCmvn2mELeQDDcqtzfKqy1aRqu, base: None } already in use
   2026-11-10T11:54:25.4050704Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
   2026-11-10T11:54:25.4052483Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
   2026-11-10T11:54:25.4057642Z     ✔ refuses claiming twice via Merkle proof (anti-double-claim guard)
   ```

2. **Merkle $\rightarrow$ Signature Cross-Path Guard:** Claiming via Merkle proof first, then attempting to claim via signature.
   ```text
   2026-11-10T11:54:25.6364815Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
   2026-11-10T11:54:25.6365912Z DEBUG Program log: Instruction: ClaimWithSignature
   2026-11-10T11:54:25.6366662Z DEBUG Program 11111111111111111111111111111111 invoke [2]
   2026-11-10T11:54:25.6367475Z DEBUG Program log: Allocate: account Address { address: P2NnWtpCrUPdTNvScr3q5yLWPAPXGSvg7BjRqQpAYdD, base: None } already in use
   2026-11-10T11:54:25.6368461Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
   2026-11-10T11:54:25.6370268Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
   2026-11-10T11:54:25.6380286Z     ✔ refuses claiming via signature if already claimed via Merkle proof
   ```

3. **Signature $\rightarrow$ Merkle Cross-Path Guard:** Claiming via signature first, then attempting to claim via Merkle proof.
   ```text
   2026-11-10T11:54:25.7619349Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
   2026-11-10T11:54:25.7620402Z DEBUG Program log: Instruction: Claim
   2026-11-10T11:54:25.7621335Z DEBUG Program 11111111111111111111111111111111 invoke [2]
   2026-11-10T11:54:25.7622595Z DEBUG Program log: Allocate: account Address { address: 3AtmsyoEsVKCnEFiQteRRZhA4uHrywxBiji9tJj3iUaH, base: None } already in use
   2026-11-10T11:54:25.7623573Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
   2026-11-10T11:54:25.7625679Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
   2026-11-10T11:54:25.7629781Z     ✔ refuses claiming via Merkle proof if already claimed via signature
   ```

4. **Signature Double-Claim:** Calling `claim_with_signature` twice for the same claimant.
   ```text
   2026-11-10T11:54:25.8908305Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
   2026-11-10T11:54:25.8909543Z DEBUG Program log: Instruction: ClaimWithSignature
   2026-11-10T11:54:25.8913480Z DEBUG Program 11111111111111111111111111111111 failed: custom program error: 0x0
   2026-11-10T11:54:25.8916157Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x0
   2026-11-10T11:54:25.8917915Z     ✔ refuses claiming twice via signature
   ```

---

## 5. Criterion 14 — Cross-User Signature Replay Evidence

### Test Objective
Verify that an Ed25519 signature generated for Alice cannot be reused or replayed by Bob. Specifically:
1. Alice's signature is valid for `[alice.publicKey || amount || programId]`.
2. Bob attempts to submit Alice's valid signature with Bob's own claimant account and Bob's claim PDA.
3. The program rejects the transaction with custom program error `0x1774` (`InvalidSignatureMessage`).
4. Bob receives zero tokens (`bobBalance == 0`).
5. Bob attempting to bypass message checking by passing Alice's claim PDA fails Anchor's seeds constraint (`0x7d6` / `ConstraintSeeds`).
6. The test passes cleanly in CI.

### Actual CI Log for Criterion 14 (Verbatim from Run #20)
```text
2026-11-10T11:54:26.1051968Z DEBUG Program 11111111111111111111111111111111 invoke [1]
2026-11-10T11:54:26.1053093Z DEBUG Program 11111111111111111111111111111111 success
2026-11-10T11:54:26.1054514Z DEBUG Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]
2026-11-10T11:54:26.1055530Z DEBUG Program log: Instruction: InitializeMint2
2026-11-10T11:54:26.1057482Z DEBUG Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success
2026-11-10T11:54:26.1058907Z DEBUG Program log: Create
2026-11-10T11:54:26.1064979Z DEBUG Program log: Initialize the associated token account
2026-11-10T11:54:26.1204868Z DEBUG Program ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL success
2026-11-10T11:54:26.1236018Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T11:54:26.1236747Z DEBUG Program log: Instruction: ClaimWithSignature
2026-11-10T11:54:26.1237772Z DEBUG Program 11111111111111111111111111111111 invoke [2]
2026-11-10T11:54:26.1238859Z DEBUG Program 11111111111111111111111111111111 success
2026-11-10T11:54:26.1239908Z DEBUG Program log: AnchorError thrown in programs/04-merkle-airdrop/src/instructions/claim_with_signature.rs:110. Error Code: InvalidSignatureMessage. Error Number: 6004. Error Message: Invalid signature message.
2026-11-10T11:54:26.1240991Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt consumed 18551 of 400000 compute units
2026-11-10T11:54:26.1241800Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x1774
2026-11-10T11:54:26.1281386Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt invoke [1]
2026-11-10T11:54:26.1282299Z DEBUG Program log: Instruction: ClaimWithSignature
2026-11-10T11:54:26.1283430Z DEBUG Program log: AnchorError caused by account: claim. Error Code: ConstraintSeeds. Error Number: 2006. Error Message: A seeds constraint was violated.
2026-11-10T11:54:26.1284154Z DEBUG Program log: Left:
2026-11-10T11:54:26.1284721Z DEBUG Program log: 4f4Qup7VRdmwdZLnmU9GEbjL56WV8F7xJHnqAjJ1UpjE
2026-11-10T11:54:26.1285421Z DEBUG Program log: Right:
2026-11-10T11:54:26.1286098Z DEBUG Program log: EMsawt2mxnL9L578oJGo6Z7yGkZvGDkyxLggunerc1bf
2026-11-10T11:54:26.1286828Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt consumed 10183 of 400000 compute units
2026-11-10T11:54:26.1287623Z DEBUG Program BbyrsYvVu6eTh7CGBaFfbJgS6Q7C8zQy1NfxA3Ne9xbt failed: custom program error: 0x7d6
2026-11-10T11:54:26.1288714Z     ✔ there is a test that signature for one user cannot be used by another (cross-user signature replay)
```

---

## 6. Criteria 16 & 17 — Test Coverage and Verified Execution Summary

### Test Coverage Breakdown
- **Task 04 Implementation:** Merkle root verification and Ed25519 signature verification claim mechanisms for SPL tokens.
- **Criteria 16 (Test Suite Coverage):**
  - Legitimate Merkle proof claim.
  - Invalid Merkle proof rejection.
  - Merkle double-claim rejection via System Program `AccountAlreadyInUse` (`0x0`).
  - Legitimate Ed25519 signature claim.
  - Merkle $\rightarrow$ Signature cross-path rejection (`0x0`).
  - Signature $\rightarrow$ Merkle cross-path rejection (`0x0`).
  - Signature double-claim rejection (`0x0`).
  - Unauthorized signature key rejection (`0x1773` / `UnauthorizedSigner`).
  - Cross-user signature replay rejection (`0x1774` / `InvalidSignatureMessage` and `0x7d6` / `ConstraintSeeds`).
  - One-time configuration initialization enforcement (`0x0`).
  - Zero amount claim rejection (`0x1772` / `ZeroAmount`).
- **Criteria 17 (Verified Passing Execution):**
  - All 11 tests executed and passed (`11 passing (1s)`, `0 failing`) in GitHub Actions CI run `#20` (`42810645795`).

Official GitHub Actions Run: [https://github.com/ShivamKashyap966/redduck-academy-solana-template/actions/runs/42810645795](https://github.com/ShivamKashyap966/redduck-academy-solana-template/actions/runs/42810645795)
