# Case 002 — PARTIAL_REFUND

The interesting one. A five-hour outage that the provider calls scheduled
maintenance, announced two hours before it started. The entire ruling turns on
whether that announcement was timely.

## Evidence summary

| Source | Reports |
|---|---|
| Independent monitor | 100% coverage, 402 min downtime, **99.10%** uptime |
| Provider status | 102 min unplanned + 300 min *planned*, headline **99.77%** |
| Maintenance feed | Window `NS-MW-2026-07-12`, announced **2.0 hours** ahead |

The two headline percentages disagree because they count the same 300 minutes
differently — not because the underlying observations differ. Both sources agree
on what happened and when.

## Derivation

SLA-2 excludes maintenance downtime **only** when the window was announced at
least 24 hours before it began.

```
announced_at  = 2026-07-12T03:00:00Z
window_start  = 2026-07-12T05:00:00Z
lead time     = 2.0 hours   <   24 hours  ->  does not qualify
```

The window fails the notice test, so its 300 minutes count in full:

```
counted downtime = 300 (maintenance) + 58 + 44 = 402 min
uptime           = (44640 - 402) / 44640 x 100
                 = 99.099462%  ->  99.10%
```

99.10% falls inside the 98.00–99.49% band, so SLA-3 applies: a 25% customer
refund, which the contract's outcome schedule maps to 2500 bps.

**Expected outcome:** `PARTIAL_REFUND`, `refund_bps 2500`, breaching SLA-1 and
SLA-2.

## The pivot

Had the window been announced 24 hours ahead instead of 2, it would have been
excluded and the month would have looked like this:

```
counted downtime = 58 + 44 = 102 min
uptime           = 99.771505%  ->  99.77%   ->  NO_BREACH, refund_bps 0
```

The monitor publishes both figures — `uptime_percent` (99.10%) and
`uptime_percent_if_provider_maintenance_excluded` (99.77%) — so the arithmetic
is auditable from the fixture without recomputation. It publishes both *without*
saying which applies, because choosing between them is the adjudication.

## What this case exercises

- A rule that hinges on timestamp arithmetic rather than on a reported number.
- A provider whose self-reported headline figure is favourable to itself and is
  not wrong about any fact — only about which exclusion it is entitled to. This
  is the realistic shape of an SLA dispute, and it is why the monitor is primary
  evidence and the status page is merely corroborating.
- `maintenance_qualified` as a genuine decision field: here it resolves to
  `false`, and a validator that resolved it `true` would disagree on consensus
  even if it somehow landed on the same outcome.

---

*This README is not fetched by the contract. Validators see only the four JSON
files in this directory.*
