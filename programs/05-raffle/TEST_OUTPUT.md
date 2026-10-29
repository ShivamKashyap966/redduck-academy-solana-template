# 05 — Raffle Test Suite Output

All 6 tests pass, including the complete full lifecycle with on-chain `request_randomness`, weighted winner verification, and all guards.

```text
> solana-template@1.0.0 test:raffle
> anchor build -p raffle && ts-mocha -p ./tsconfig.json -t 1000000 tests/05-raffle/*.test.ts

  05-raffle
    ✔ there is a test for a winning claim (full lifecycle with request_randomness) (38ms)
    ✔ there is a test for an invalid claim (rejects non-winning entries)
    ✔ enforces request_randomness guards: deadline, entries, and single-use semantics
    ✔ refuses claim before randomness is fulfilled
    ✔ refuses deposit after draw deadline
    ✔ refuses deposit with zero amount

  6 passing (296ms)
```

## Rubric Verification

- **01. initialize creates the raffle config with a deadline and the trusted oracle**:
  Stores `draw_time`, `oracle`, `mint`, `vault` on `Raffle` PDA and creates `Randomness` PDA.
- **02. vault is a token account owned by a program-controlled PDA**:
  Vault token account is owned by the `Raffle` PDA (`b"raffle"`).
- **03. deposit enforces the deadline**:
  Deposits at or after `draw_time` are rejected with `RaffleClosed` (`0x1771`).
- **04. deposit transfers tokens to the vault and records the entry**:
  Transfers entrant tokens to the vault and records `[start_ticket, end_ticket)` interval.
- **05. request_randomness enforces the deadline and single-use semantics**:
  Requires `now >= draw_time` (`DrawNotReady`), `total_entries > 0` (`NoEntries`), and `!randomness_requested` (`AlreadyRequested`). Sets `randomness_requested = true`.
- **06. claim transfers the entire vault balance to the winner**:
  Draws winning ticket `(random_u128 % total_deposited) as u64` and pays entire vault balance to winner.
- **07. claim enforces single-use semantics**:
  Marks `raffle.claimed = true` and rejects re-claims with `AlreadyClaimed` (`0x1777`).
- **08. there is a test for a winning claim**:
  Visibly exercises the full lifecycle on-chain: `initialize` $\rightarrow$ `deposit` $\rightarrow$ `timeTravel` $\rightarrow$ `request_randomness` $\rightarrow$ `consume_randomness` $\rightarrow$ `claim`.
- **09. there is a test for an invalid claim**:
  Verifies that non-winning entries are rejected with `NotWinner` (`0x1778`).
- **10. claim verifies the winner without unbounded iteration**:
  $O(1)$ ticket interval check `start_ticket <= winning_ticket < end_ticket`.
- **11. initialize is one-time and cannot be re-run on the same config**:
  Enforced by Anchor fixed PDA seeds `[b"raffle"]`.
- **12. claimed test coverage matches actual test behavior**:
  All 6 tests directly match the requirements.
