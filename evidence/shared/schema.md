# Evidence fixture schema

Every file under `evidence/case-*/` is a single JSON object describing one
evidence source for one demonstration case. This document defines the shape
those objects take.

The UptimeBond contract fetches four URLs per dispute and embeds the raw bodies
in the adjudication prompt. It does not parse these documents itself — no field
below is read by contract code. The schema exists so that the four sources in a
case are mutually intelligible and so a validator re-fetching them independently
sees exactly what the leader saw.

## Common envelope

Present in all sixteen JSON files, at the top level:

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | string | Semver of this schema. Currently `1.0.0`. |
| `case_id` | string | Directory name of the owning case, e.g. `case-002-partial-refund`. |
| `service_name` | string | Always `NimbusAPI`. |
| `service_period` | object | `{ "start": <iso8601>, "end": <iso8601> }`, the window under review. |
| `generated_at` | string | ISO-8601 UTC instant the document was produced. |
| `source_role` | string | Which of the four roles this document fills. See below. |

All timestamps everywhere in these files are ISO-8601 with an explicit `Z`
suffix. There are no local times and no naive timestamps.

### `source_role` values

| Value | File | Standing |
|---|---|---|
| `sla_terms` | `sla-terms.json` | Authoritative clause definitions |
| `independent_monitor` | `monitor-report.json` | **Primary** uptime evidence |
| `provider_status` | `provider-status.json` | Corroborating, self-reported |
| `maintenance_announcements` | `maintenance-announcements.json` | Corroborating, self-reported |

## Role-specific bodies

### `sla_terms`

Identical in all four cases — one locked agreement, four disputes over it.

- `document` — agreement identity: parties, `agreement_id`, `effective_from`.
- `measurement` — `metric`, `formula`, `period_minutes`, `rounding`, and
  `authoritative_source`.
- `clauses[]` — each with `id` (`SLA-1` … `SLA-6`), `title`, `text`, and any
  machine-readable bound (`threshold_percent`, `range`,
  `customer_refund_percent`, `notice_requirement_hours`). Clause ids are the
  vocabulary a ruling cites in `breached_clause_ids`.
- `evidence_sources` — which roles are primary and which corroborating.

### `independent_monitor`

- `monitor` — who operates the probe fleet, `check_interval_seconds`,
  `probe_regions`, and the `downtime_rule` used to mark a minute down.
- `measurement`:
  - `period_minutes`, `observed_minutes`, `coverage_percent`
  - `measurement_complete` (bool) and `data_gaps[]`
  - `counted_downtime_minutes`
  - `uptime_percent` and `uptime_percent_unrounded`
  - `period_uptime_derivable` (bool)
- `incidents[]` — `incident_id`, `start`, `end`, `downtime_minutes`, `summary`,
  `inside_announced_maintenance_window`,
  `provider_claims_scheduled_maintenance`, and where relevant
  `announcement_observed_at` / `announcement_lead_time_hours`.

When coverage is incomplete, `uptime_percent`, `uptime_percent_unrounded` and
`counted_downtime_minutes` are `null` rather than estimated, and
`period_uptime_derivable` is `false`. A monitor that cannot measure the period
says so instead of guessing.

### `provider_status`

- `status_page` — publisher, and the flags `self_reported: true` /
  `independent_of_provider: false` that mark this source's standing.
- `reported` — the provider's own figures, splitting
  `unplanned_downtime_minutes` from `planned_downtime_minutes`. Where the
  provider's headline `uptime_percent` excludes intervals it classifies as
  planned, `uptime_percent_basis` states that explicitly.
- `incidents[]` — provider incident records with a `classification` of
  `planned` or `unplanned`.

A `planned` classification here is a provider designation. Whether an interval
actually qualifies for exclusion is decided by SLA-2 against the announcement
record, not by this field.

### `maintenance_announcements`

- `announcement_channel` — publisher and whether the feed is public.
- `windows[]` — `window_id`, `announced_at`, `window_start`, `window_end`,
  `notice_lead_time_hours`, `scope`, `expected_customer_impact`.
- `access` — present **only** when the feed could not be retrieved. Carries
  `state`, `retrievable`, `http_equivalent_status`, `reason`, `observed_at`.
  When present, `windows` is `null`.

`notice_lead_time_hours` is raw arithmetic on the two timestamps beside it. The
fixture does not state whether that lead time satisfies SLA-2; applying the
24-hour test is the adjudicator's job.

Three distinct states must not be conflated:

| Situation | `windows` | `access` |
|---|---|---|
| Maintenance was announced | populated array | absent |
| Feed reachable, nothing announced | `[]` | absent |
| Feed could not be read | `null` | present |

An empty array is a positive record that nothing was announced. A `null` with
an `access` block is missing evidence. They are not interchangeable.

## What these files deliberately omit

No evidence file contains an expected verdict, an outcome label, a refund
amount in basis points, or any field naming what the ruling should be. The
ruling is derived by each validator from the evidence and the SLA clauses.
Baking a conclusion into the evidence would make the fixtures test the
adjudicator's reading comprehension instead of its judgement, and would make
consensus meaningless.

Per-case `README.md` files do discuss expected outcomes. Those are written for
human readers and are never fetched by the contract.
