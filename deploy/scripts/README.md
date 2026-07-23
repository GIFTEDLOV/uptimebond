# Bradbury live test harness

Scripts for deploying and driving UptimeBond agreements on GenLayer Bradbury.

## Why these exist

The GenLayer CLI cannot do this job:

- **It cannot call payable methods.** Both 0.39.1 and 0.39.2 hardcode
  `value: 0n` in the write action and expose no `--value` flag. `fund()` is
  payable, so the entire lifecycle is unreachable through the CLI.
- **It reports a single status.** Distinguishing *consensus accepted* from
  *execution succeeded* matters — a transaction can be ACCEPTED by consensus
  and still have reverted.
- **It cannot resume.** A dropped receipt wait leaves you unsure whether a
  transaction committed.

## Files

| File | Purpose |
|---|---|
| `lib.mjs` | Shared primitives: signing, encoding, explorer polling, receipt classification, submission retry |
| `gl.mjs` | One-shot CLI: `read`, `write`, `deploy`, `receipt`, `history`, `balance` |
| `lifecycle.mjs` | Drives one case end to end; resumable |
| `cases.json` | Case definitions: evidence dirs, escrow amounts, expected outcomes |

## Key handling

Signing keys come from the **same OS keychain the GenLayer CLI populates**
(`genlayer account unlock`), are held only in memory, and are passed straight to
the SDK signer.

**No script here accepts a key or password as an argument, and no key ever
reaches `console.log`, a record file, or disk.** If an account is locked, the
scripts refuse and tell you to unlock it yourself:

```bash
genlayer account unlock --account provider
```

## Usage

```bash
# Read live state
node deploy/scripts/gl.mjs read --contract 0x4dc6… --method get_state

# Drive a case (deploys if needed, then runs to completion)
node deploy/scripts/lifecycle.mjs --case case-003-full-refund --deploy

# Check where a case is without sending anything
node deploy/scripts/lifecycle.mjs --case case-002-partial-refund --status

# Recover transaction hashes if a wait was interrupted
node deploy/scripts/gl.mjs history --contract 0x4dc6…
```

Exit codes: `0` ok · `1` execution error · `2` transaction failed ·
`3` usage/precondition · `4` refused (would duplicate a committed write) ·
`5` unknown outcome, needs manual confirmation.

## How it handles Bradbury

Three behaviours found the hard way, all handled:

**Transactions are serialized per contract and slow.** Each step now waits on
the previous one's **finality** — roughly 26–32 minutes per transaction on the
same contract. (It used to advance on acceptance; that got the next step
reverted by the consensus contract while the previous one was unfinalized, and
it would report a settlement whose transfers had not executed. See the
finalization comment in `lifecycle.mjs`.)

**Run cases serially, not in parallel — despite the independent per-contract
queues.** The earlier advice here said the opposite and it is wrong. All cases
sign with the same customer account, and under load the node intermittently
reverts a submission at the consensus contract (`0x0112Bf6e…`) — the revert
lands *before* a GenLayer transaction hash exists, so nothing commits and the
run halts. This was observed both with two runs sharing the signer and in a
fully serial run, alongside `TIMEOUT` / `DETERMINISTIC_VIOLATION` validator
votes and `l1_sender_commit` backpressure — i.e. it is node congestion, not
purely a signer race. A retry clears it every time. Running serially keeps only
one submission in flight and makes these retries tractable; true parallelism
would need a separate signer per case.

**The JSON-RPC receipt endpoint is unreliable under load.** It intermittently
returns HTML or `Internal error`. Status polling goes through the explorer index
instead; the RPC is used only for the richer receipt, and is optional.

**The node rejects sends when busy** with
`pipeline backpressure (l1_sender_commit)`. That refusal happens *before* a hash
is issued, which proves nothing committed, so submission retries with
exponential backoff. **Once a hash exists nothing is ever retried
automatically** — an in-flight transaction must be resolved by observation.

## Safety properties

- **Resume is state-driven.** The next action is derived from on-chain `status`
  every iteration, never from local bookkeeping. Re-running after any
  interruption continues from wherever the chain actually is.
- **The hash is persisted before the receipt wait.** A wait that times out can
  never orphan a transaction that may have committed.
- **Signer is asserted before every role-restricted call**, so a wrong-account
  transaction is refused locally instead of reverting on-chain 30 minutes later.
- **Consensus ACCEPTED + execution FINISHED_WITH_ERROR is a failure** and exits
  non-zero.
- **Writes refuse to re-run** against a record that already shows a committed
  transaction unless `--force` is passed.
- **Evidence is preflighted** before deploy — all four URLs must return 200,
  because validators re-fetch them and a broken URL guarantees a failed ruling.

## Adding a case

Add an entry to `cases.json` with an `evidence_dir`, `escrow_wei`,
`incident_window`, and `expected` block, then:

```bash
node deploy/scripts/lifecycle.mjs --case <your-case> --deploy
```

Records land in `deploy/bradbury/<case>/`, one JSON file per step, each with the
transaction hash, explorer link, consensus/execution classification, validator
votes, and full receipt.
