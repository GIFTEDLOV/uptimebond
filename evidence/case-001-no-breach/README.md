# Case 001 — NO_BREACH

A clean month. The service missed its uptime target on two brief occasions,
neither large enough to breach, and all three sources agree.

## Evidence summary

| Source | Reports |
|---|---|
| Independent monitor | 100% coverage, 36 min downtime, **99.92%** uptime |
| Provider status | 36 min unplanned, 0 min planned, 99.92% |
| Maintenance feed | One window, announced 203 hours ahead, no impact |

Downtime is two short incidents: 21 minutes on 2026-07-05 and 15 minutes on
2026-07-22.

## Derivation

```
period          = 44,640 min
downtime        =      36 min
uptime          = (44640 - 36) / 44640 x 100
                = 99.919355%  ->  99.92%  (SLA-1 rounding)
```

99.92% is at or above the 99.50% commitment, so SLA-5 applies and no refund is
due. No clause is breached.

**Expected outcome:** `NO_BREACH`, `refund_bps 0`, `breached_clause_ids []`.

## What this case exercises

The uncontested path. Every source corroborates every other, coverage is
complete, and the maintenance window that did occur was announced 203 hours in
advance — comfortably clear of the 24-hour bar in SLA-2 — and caused no
downtime anyway. There is nothing for a validator to weigh, which makes this the
baseline: if validators cannot agree here, the disagreement is in the
adjudication logic, not in the evidence.

It is also the control for case 002. Both months contain real downtime; only the
announcement timing differs in consequence.

---

*This README is not fetched by the contract. Validators see only the four JSON
files in this directory.*
