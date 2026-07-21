# Case 004 — INSUFFICIENT_EVIDENCE

The evidence does not support a financial ruling in either direction. This case
exists to prove the system can decline to decide.

## Evidence summary

| Source | Reports |
|---|---|
| Independent monitor | **61.62% coverage**, `measurement_complete: false`, `uptime_percent: null` |
| Provider status | **100.0%** uptime, zero incidents, self-reported |
| Maintenance feed | **Inaccessible** — `access.state: restricted`, `windows: null` |

## Why no ruling is derivable

**The primary source cannot measure the period.** 17,131 of 44,640 minutes were
never sampled — a seven-day probe-fleet migration and a five-day collector
outage. The monitor publishes `uptime_percent: null` and
`period_uptime_derivable: false` rather than extrapolating from the 61.62% it
did observe. Under SLA-6 the monitor is the only source that can establish
measured uptime, and here it does not.

**The corroborating source contradicts it irreconcilably.** The monitor recorded
44 minutes of downtime inside intervals it *did* observe. The provider reports
100.0% uptime and zero incidents for the whole period. Both cannot be true. The
contradiction cannot be resolved, because the source that would adjudicate it is
the one with the gaps.

**The third source is unreadable.** The maintenance feed is
authentication-gated; public retrieval returns no records. So even the question
"was any of the observed downtime excusable under SLA-2?" cannot be answered.

Note the direction of the ambiguity: the missing data could conceal a breach or
conceal nothing at all. Ruling either way would be a guess that moves real
money.

**Expected outcome:** `INSUFFICIENT_EVIDENCE`, `refund_bps 0`,
`breached_clause_ids []`.

## What happens next on-chain

`INSUFFICIENT_EVIDENCE` is deliberately not settleable — `release` reverts on
it. The escrow is freed by one of:

1. **Mutual settlement** — either party proposes a split, the other accepts.
2. **Native appeal** of the `rule` transaction, if better evidence exists.
3. **`resolve_deadlock`** — after the insufficient-evidence deadline passes,
   either party settles at the pre-agreed `deadlock_refund_bps`.

Route 3 is why this case matters beyond adjudication: it is the state that would
strand the escrow forever if the deadlock breaker did not exist.

## What this case exercises

- A `null` uptime that must not be coerced to `0` — treating "unmeasured" as
  "zero uptime" would flip this case to `FULL_REFUND` and pay out on missing
  data.
- An inaccessible source distinguished from an empty one. Compare case 003,
  where `windows: []` is a positive record that nothing was announced. Here
  `windows` is `null` with an `access` block. Reading absence of data as absence
  of maintenance is the specific error this pairing is built to catch.
- The refusal path itself. A system that always produces a number is worse than
  one that admits when it cannot — the whole escrow design assumes some disputes
  end here.

---

*This README is not fetched by the contract. Validators see only the four JSON
files in this directory.*
