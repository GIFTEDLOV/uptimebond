# UptimeBond Evidence Lab

Public, fixed evidence fixtures for demonstrating and testing UptimeBond's SLA
adjudication.

Each subdirectory is one self-contained dispute: an SLA, an independent uptime
report, a provider status page, and a maintenance announcement record. Point a
funded UptimeBond agreement at the four JSON files in a case directory and the
dispute becomes reproducible by anyone.

```
evidence/
├── README.md                          <- you are here
├── shared/schema.md                   <- field-by-field schema
├── case-001-no-breach/                <- 99.92%, clean month
├── case-002-partial-refund/           <- 99.10%, late maintenance notice
├── case-003-full-refund/              <- 96.80%, major unannounced outage
└── case-004-insufficient-evidence/    <- incomplete and contradictory
```

All four cases describe the same fictional agreement: **Acme Labs** (customer)
buys **NimbusAPI** from **Nimbus Systems** (provider), for the service period
**2026-07-01T00:00:00Z – 2026-07-31T23:59:59Z**, under a locked SLA requiring
99.5% uptime.

## Why controlled fixtures

Live monitoring endpoints make poor test evidence for a consensus system.

**Live data changes underneath the ruling.** UptimeBond reaches consensus by
having every validator independently re-fetch the evidence and re-derive the
decision. If the sources move between the leader's fetch and a validator's, the
two disagree over the data rather than over the judgement — and the transaction
fails for a reason that has nothing to do with the adjudication being tested. A
frozen fixture removes that variable: any disagreement is a real disagreement.

**Real incidents are rarely clean.** Production monitoring seldom hands you a
month that lands squarely in one refund band, and almost never hands you the
specific shape you need — a maintenance window announced exactly too late, or a
monitor whose coverage gap is large enough to make the period unmeasurable.
These four cases are constructed so each exercises one decision path with the
arithmetic worked out and auditable.

**Demonstrations must be reproducible.** Anyone can re-run these disputes months
from now and get the same evidence, so a recorded ruling stays verifiable.

**Failure cases are hard to catch in the wild.** Case 004 needs a source that is
simultaneously incomplete, contradicted, and inaccessible. Waiting for that to
occur naturally is not a test strategy.

## Every validator fetches independently

The contract does not distribute evidence to validators. It stores four URLs,
and during `rule` **each validator fetches all four itself** and re-derives the
ruling from what it got back. There is no shared copy and no trusted relay.

Consensus is then taken over the decision fields only — outcome, refund basis
points, whether maintenance qualified, and which clauses were breached. The
reasoning prose is explanatory and is deliberately excluded from the comparison,
since two honest validators will never phrase a rationale identically.

Three consequences shape how these fixtures are written:

- **They must be byte-stable.** A fixture that varies per request — a timestamp
  regenerated at serve time, a randomised ordering — would cause spurious
  disagreement. Nothing here is generated at request time.
- **They must be publicly readable without credentials,** except where a case
  deliberately models a restricted source (case 004's maintenance record, which
  is a fixture *about* inaccessibility, not an accidentally broken file).
- **They must not contain the answer.** No evidence file carries an
  `expected_verdict`, an outcome label, or a refund figure in basis points. If
  the verdict were embedded, validators would agree by copying rather than by
  reasoning, and consensus would prove nothing. Expected outcomes are documented
  in the per-case `README.md` files, which the contract never fetches.

## These are test fixtures, not monitoring data

**Everything here is fabricated.** NimbusAPI, Acme Labs, Nimbus Systems and
Northwind Uptime Observatory do not exist. The incidents did not happen. The
uptime figures were chosen to land in specific refund bands and the timestamps
were constructed to make specific clauses decide the case.

Do not cite these files as evidence of any real service's reliability, do not
reuse them as a template for a real SLA without legal review, and do not wire a
production agreement to these URLs. Their only purpose is to exercise UptimeBond
along known paths.

Real disputes must point at real, independent, contemporaneous sources. The
value of these fixtures is that they are *not* real — which is exactly what
disqualifies them from production use.

## Case index

| Case | Uptime | Deciding rule | Expected outcome |
|---|---|---|---|
| 001 | 99.92% | SLA-5 — at or above commitment | `NO_BREACH` (0 bps) |
| 002 | 99.10% | SLA-2 — 2h notice fails the 24h test | `PARTIAL_REFUND` (2500 bps) |
| 003 | 96.80% | SLA-4 — below the 98.00% floor | `FULL_REFUND` (10000 bps) |
| 004 | not derivable | SLA-6 — evidence insufficient | `INSUFFICIENT_EVIDENCE` (no settlement) |

See `shared/schema.md` for the document schema, and each case's `README.md` for
its derivation.

## Status

These fixtures are not yet wired into an automated test. The Direct Mode suite
in `tests/direct/` mocks evidence inline, which keeps it fast and hermetic.
Replaying these files end-to-end belongs in the integration suite, against a
running GenLayer environment with real validators — that work is still to come.
