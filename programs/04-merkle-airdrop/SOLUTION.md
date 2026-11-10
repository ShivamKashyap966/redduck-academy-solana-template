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
