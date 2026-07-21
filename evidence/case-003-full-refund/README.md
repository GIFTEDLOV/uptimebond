# Case 003 — FULL_REFUND

A severe, undisputed failure: nearly a full day of total outage, unannounced,
acknowledged by the provider.

## Evidence summary

| Source | Reports |
|---|---|
| Independent monitor | 100% coverage, 1,428 min downtime, **96.80%** uptime |
| Provider status | 1,428 min unplanned, 0 min planned, 96.80% |
| Maintenance feed | Reachable, **zero** windows announced |

The dominant incident is `NWO-2026-07-14-01` / `NS-4612`: 23 hours 2 minutes of
total unavailability starting 2026-07-14T02:12:00Z, caused by a correlated disk
firmware fault that required restoring from off-site backup.

## Derivation

```
period          = 44,640 min
downtime        =   1,382 (major outage) + 31 + 15 = 1,428 min
uptime          = (44640 - 1428) / 44640 x 100
                = 96.801075%  ->  96.80%
```

96.80% is below the 98.00% floor, so SLA-4 applies: a 100% customer refund,
which the contract's outcome schedule maps to 10000 bps.

No maintenance exclusion is available. The maintenance feed was publicly
reachable and returned an empty `windows` array — a positive record that nothing
was announced, not an absence of data. The provider's own postmortem states the
outage was unplanned and unannounced.

**Expected outcome:** `FULL_REFUND`, `refund_bps 10000`, breaching SLA-1.

## What this case exercises

- The lower refund band, and the boundary between SLA-3 and SLA-4. At 96.80%
  there is no ambiguity about which band applies; a fixture sitting at 97.99%
  or 98.01% would test the boundary itself, and is worth adding later.
- An **empty** maintenance record that must be read as informative. This is the
  deliberate contrast with case 004, where the same conceptual source is
  unreadable. Case 003 says "nothing was announced"; case 004 says "we cannot
  tell you what was announced". Only one of those supports a ruling, and a
  validator that treats them alike will rule wrongly on one of the two.
- The full-refund path through `_settle`, where the provider's payout leg is
  zero and must therefore not be emitted at all.

---

*This README is not fetched by the contract. Validators see only the four JSON
files in this directory.*
