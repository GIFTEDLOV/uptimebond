# UptimeBond

**SLA escrow that adjudicates itself.** A customer pays for a service and holds
that payment in escrow against a provider's uptime commitment. If they disagree
about whether the SLA was met, GenLayer validators independently re-fetch the
evidence, derive the ruling, and settle the escrow — with no trusted middleman
and no off-chain coordinator.

Live on GenLayer Bradbury Testnet. Contract source: [`contracts/uptime_bond.py`](contracts/uptime_bond.py).

---

## The problem

Service level agreements are promises about facts — "99.5% uptime this month" —
but the facts are held by the party with the least interest in reporting them
honestly. When a customer believes the SLA was breached and the provider
believes it wasn't, three bad options follow:

1. **Trust the provider's status page.** The provider grades its own homework
   and decides what counts as "planned maintenance".
2. **Escalate to support.** Slow, opaque, and the provider still decides.
3. **Litigate or arbitrate.** Costs more than the service credit is worth, so
   in practice the customer absorbs the loss.

The dispute is usually small, factual, and repetitive — exactly the shape that
should be automatable, and exactly the shape that no existing mechanism handles
at a proportionate cost.

### Why centralized AI is insufficient

An LLM can read an SLA and an uptime report and reach a sound conclusion. That
is not the hard part. The hard part is that **the losing party has no reason to
accept it.**

- **Who ran it?** If the provider runs the model, the customer has no reason to
  trust the output. Reverse it and the provider doesn't either.
- **Was that really the answer?** A single API call is unverifiable after the
  fact. Nothing stops the operator from re-rolling until they like the result,
  or quietly editing the prompt.
- **Models are non-deterministic.** The same prompt can produce different
  answers. Without a mechanism that forces independent agreement, "the AI said
  so" is just one party's assertion with extra steps.
- **Who moves the money?** Even a correct ruling needs an escrow that pays out
  without either party's cooperation.

Centralized AI produces an *opinion*. Adversarial parties need a *verdict* —
one that is reproducible, checkable, and wired directly to the funds.

### Why adversarial parties need neutral adjudication

The customer wants a refund; the provider wants to keep the payment. Neither can
be trusted with the ruling, the evidence, or the escrow. The adjudicator must be
disinterested, its inputs must be immutable, and its output must be
independently reproducible — otherwise the whole thing collapses back into
"whoever controls the infrastructure wins".

### Why GenLayer is essential

GenLayer is the only piece here that isn't off-the-shelf. It provides:

- **Optimistic Democracy.** A leader proposes a ruling; validators
  independently re-execute and vote. Agreement is required before anything
  commits. No single party's model output is authoritative.
- **Native non-deterministic execution.** `gl.nondet.web.get()` and
  `gl.nondet.exec_prompt()` run *inside* consensus. The contract fetches its own
  evidence and calls its own model — it doesn't trust an oracle to do it.
- **Native GEN escrow.** The same system that adjudicates also custodies and
  pays out, with `on="finalized"` transfers so funds never move before the
  decision is final.
- **Native appeals.** A disputed ruling is re-adjudicated by the protocol, not
  by a bespoke "ask the AI again" method the contract author invented.

Take GenLayer away and you need an oracle network, a separate escrow contract,
a bespoke appeal mechanism, and a reason to believe the model output — four
trust assumptions instead of none.

---

## Architecture

```
   Customer ──fund()──┐                      ┌── evidence sources (untrusted, immutable URLs)
                      ▼                      │      · SLA terms          (authoritative clauses)
             ┌──────────────────┐            │      · independent monitor (PRIMARY)
             │   UptimeBond     │            │      · provider status     (corroborating)
             │   (GenLayer)     │            │      · maintenance feed    (corroborating)
             │                  │            │
             │  escrow custody  │            ▼
             │  lifecycle state │   ┌──────────────────────────┐
             │  ruling record   │◄──│  rule() — run_nondet     │
             │  settlement      │   │  leader derives ruling   │
             └──────────────────┘   │  EVERY validator         │
                      ▲             │  re-fetches + re-derives │
   Provider ──accept──┘             │  agreement on DECISION   │
                                    │  FIELDS ONLY             │
                                    └──────────────────────────┘
```

### Consensus boundary

| Layer | Owns | Never does |
|---|---|---|
| **Off-chain (frontend, scripts)** | UI, previews, indexing, transaction submission | Decide anything |
| **Contract** | Escrow custody, lifecycle transitions, the validator agreement rule, settlement | Trust evidence blindly |
| **Evidence sources** | Raw SLA terms and uptime facts | Are assumed honest |

Consensus is taken over **decision fields only**: `outcome`, `refund_bps`,
`maintenance_qualified`, and `breached_clause_ids`. The `ruling_reason` prose is
explanatory and is deliberately excluded — two honest validators will never
phrase a rationale identically, so comparing prose would break consensus for no
benefit.

### Contract lifecycle

```
AWAITING_FUNDING ──fund()──► AWAITING_PROVIDER_ACCEPTANCE ──accept_sla()──► ACTIVE
        │                              │                                      │
        │                     cancel_before_acceptance()          approve_service() ──► RESOLVED
        │                              ▼                                      │
        │                          RESOLVED                          open_dispute()
        │                                                                     ▼
        └──────────────────────────────────────────────────────────────► DISPUTED
                                                                              │
                                                                           rule()
                                                                              ▼
                                                                            RULED
                                                        ┌─────────────────────┼──────────────────┐
                                            settleable outcome      INSUFFICIENT_EVIDENCE   deadline passes
                                                  release()          propose/accept mutual   resolve_deadlock()
                                                     ▼                        ▼                    ▼
                                                  RESOLVED               RESOLVED             RESOLVED
```

14 public methods: 4 view, 10 write.

### Evidence model

Evidence URLs are **fixed at construction and never editable**. They are
**commit-pinned** raw GitHub URLs — never branch URLs — because every validator
re-fetches independently, and a source that moved between the leader's fetch and
a validator's would cause spurious disagreement rather than a real one.

`_fetch` classifies every HTTP outcome, and the classification decides whether a
ruling is even possible:

| Response | Treated as | Effect |
|---|---|---|
| 200 | `AVAILABLE` | Used as evidence |
| 404, 410 | `MISSING` | May yield INSUFFICIENT_EVIDENCE |
| 401, 403 | `INACCESSIBLE` | May yield INSUFFICIENT_EVIDENCE |
| 408, 425, 429, 5xx, timeout | `[TRANSIENT]` | Raises — validator disagrees, never settles |
| other 4xx | `[INVALID_EVIDENCE]` | Raises — validator disagrees |

A transient blip must never bank a ruling, so it forces disagreement instead.

### Payout model

Refunds are **derived from the outcome**, never taken from the model:

| Outcome | `refund_bps` | Customer | Provider |
|---|---|---|---|
| `NO_BREACH` | 0 | 0% | 100% |
| `PARTIAL_REFUND` | 2500 | 25% | 75% |
| `FULL_REFUND` | 10000 | 100% | 0% |
| `INSUFFICIENT_EVIDENCE` | 0 | — | — (no automatic settlement) |

If the model could set the payout, a prompt injection in an untrusted evidence
source could move the escrow. It can't: the model chooses a label, and the
contract maps that label to a number. This is regression-tested.

Settlement floors the customer refund and gives the provider the exact
remainder, so the two always sum back to the escrow with no leakage regardless
of divisibility.

### Appeals and finality

There is **no custom AI re-ruling method**. Parties use GenLayer's native
transaction appeal to re-adjudicate the `rule` transaction. Every settlement
uses `on="finalized"` transfers, so funds never move before the accepted
decision is final — which is exactly what makes the appeal path safe.

### Deadlock handling

Two deterministic liveness fallbacks guarantee the escrow can always be freed
without an off-chain coordinator, both gated on the deterministic transaction
timestamp (never block height, which GenLayer does not expose in-contract):

- **Branch A** — a dispute that adjudication never resolves.
- **Branch B** — an `INSUFFICIENT_EVIDENCE` ruling with no mutual settlement.

Both settle at the immutable `deadlock_refund_bps` agreed up front. Without
these, `INSUFFICIENT_EVIDENCE` would strand the escrow permanently.

---

## Test strategy

Two layers, deliberately different in what they can prove.

**Direct Mode — 195 tests, ~25s, no network.** Hermetic, mocks evidence and LLM
responses inline, runs the leader function only. This is where exhaustive
coverage lives: state transitions, access control, exact wei accounting, HTTP
classification, malformed model output, and the validator agreement rule via
replayed validator closures.

The suite is **mutation-verified** — I injected realistic bugs and confirmed
they fail:

| Injected bug | Tests that caught it |
|---|---|
| Payout leakage (floor both legs) | 1 |
| Dispute deadline off-by-one | 1 |
| Consensus ignores `maintenance_qualified` | 1 |
| Clause IDs left unsorted | 1 |
| `release` skips the settleable check | 1 |
| Model-supplied `refund_bps` trusted | 6 |
| Constructor double-conversion (the Bradbury bug) | **181 of 195** |

**Live Bradbury** — real validators, real GEN, real evidence over HTTP. Slow
(~30 min per transaction) and therefore narrow, but it is the only layer that
proves the model actually reaches the right verdict against real sources.

```bash
pytest tests/direct/ -q                                   # 195 tests
genvm-lint check contracts/uptime_bond.py                 # lint + validation
node deploy/scripts/lifecycle.mjs --case <id> --status    # live state
```

> On Windows, `genvm-lint` needs `PYTHONIOENCODING=utf-8` — it prints `✓` and
> crashes on a cp1252 console otherwise.

---

## Bradbury deployments

Chain 4221 · [explorer](https://explorer-bradbury.genlayer.com/) · all
deployments from source commit `ad00182`.

| Case | Expected | Contract | Deploy tx | Ruling tx | Final outcome |
|---|---|---|---|---|---|
| 002 partial refund | `PARTIAL_REFUND` 2500 | [`0x4dc6b188…19988`](https://explorer-bradbury.genlayer.com/address/0x4dc6b188b3025f92F133515c3041cbc4E2019988) | `0xecf36d39…cb46a4` | `0x8f1fc211…611001` | **`PARTIAL_REFUND` 2500 bps — RESOLVED ✓** |
| 003 full refund | `FULL_REFUND` 10000 | [`0x7EA49E78…0195b7`](https://explorer-bradbury.genlayer.com/address/0x7EA49E783B4839a20c39F77FFe62b3beF10195b7) | `0xd75a5268…c63a20` | `0x7d171a61…9bfd94` | **`FULL_REFUND` 10000 bps — RESOLVED ✓** |
| 001 no breach | `NO_BREACH` 0 | [`0xE64Dcc5E…9dDBAC`](https://explorer-bradbury.genlayer.com/address/0xE64Dcc5E82592c8BBF59003eF6AF772D739dDBAC) | `0xfbbf49f8…1002dc` | in flight | DISPUTED — ruling in flight |
| 004 insufficient | `INSUFFICIENT_EVIDENCE` | [`0xb0C263bE…bb67c0`](https://explorer-bradbury.genlayer.com/address/0xb0C263bEf959E640060045D47659582D23bb67c0) | `0xfe082e17…33df0e` | not reached | AWAITING_PROVIDER_ACCEPTANCE |

**⚠️ `0xB82f70950BbEfBC6829c463A5922Bb1B6333C637` is a failed ghost contract
from the pre-`ad00182` constructor bug. Never fund or interact with it.**

### Case 003 — full refund, also verified

Ruling tx `0x7d171a61…9bfd94`, release tx `0xb6d5f52a…f5bd88`, both 5/5 AGREE:

```
outcome               : FULL_REFUND         (expected FULL_REFUND ✓)
refund_bps            : 10000               (expected 10000 ✓)
breached_clause_ids   : ["SLA-1", "SLA-4"]
resolution_mode       : CONSENSUS_RULING
```

96.80% uptime is below the 98.00% floor, so SLA-4's full credit applies —
derived by the validators from the evidence alone.

### Case 002 — verified end to end

The headline result. Real validators, real evidence fetched over HTTP, real
escrow:

| Step | Tx | Consensus | Execution |
|---|---|---|---|
| deploy | `0xecf36d39…cb46a4` | FINALIZED / AGREE 5/5 | FINISHED_WITH_RETURN |
| `fund` (1 GEN) | `0x9a723f95…94cd4f8` | ACCEPTED / AGREE 5/5 | FINISHED_WITH_RETURN |
| `accept_sla` | `0x0bd14b19…c04761` | ACCEPTED / AGREE 5/5 | FINISHED_WITH_RETURN |
| `open_dispute` | `0x2da79b1e…c6130e` | ACCEPTED | FINISHED_WITH_RETURN |
| `rule` | `0x8f1fc211…611001` | ACCEPTED, 5 validators | FINISHED_WITH_RETURN |

Validators returned:

```
outcome               : PARTIAL_REFUND      (expected PARTIAL_REFUND ✓)
refund_bps            : 2500                (expected 2500 ✓)
maintenance_qualified : false               (expected false ✓)
breached_clause_ids   : ["SLA-1"]
```

> "The independent monitor is the primary evidence and reports an uptime of
> 99.1%, which is below the 99.5% SLA commitment. The 300-minute maintenance
> window on May 12 does not qualify for exclusion as it was announced only 2
> hours in advance, failing the 24-hour notice requirement in SLA-2. Therefore,
> all 402 minutes of downtime count, resulting in a breach that falls within
> the 98.00% to 99.49% range for a partial refund per SLA-3."

The validators derived the pivot the fixture was built around — the 2-hour
notice failing SLA-2's 24-hour bar — entirely from the evidence.

**One documented deviation:** `breached_clause_ids` is `["SLA-1"]`, where the
case README anticipated `["SLA-1", "SLA-2"]`. The validators' reading is
defensible and arguably better: SLA-1 (the uptime commitment) is the clause
*breached*; SLA-2 is the exclusion *test* that failed, not itself a breach. The
decision fields that control money are exactly as expected. This is recorded as
a deviation rather than quietly reframed as a success.

---

## Frontend

```bash
cd frontend && npm install && npm run dev     # http://localhost:3000
```

Real dApp, not a mockup: reads come from `genlayer-js` against the live chain,
writes go through an injected wallet. Read-only without a wallet.

The rule the UI enforces everywhere: **a transaction hash is not success.** The
tracker moves through distinct, named phases — awaiting signature → submitted →
pending consensus → consensus accepted → finalized — and a consensus-ACCEPTED
transaction whose execution was `FINISHED_WITH_ERROR` renders as a **failure**.
An unreadable status renders as "outcome unknown — do not retry before
confirming on-chain state".

Covers role detection (customer/provider/observer by address), chain detection
with a switch prompt, commit-pinned evidence links, ruling presentation,
deadlock deadlines, the insufficient-evidence path, and appeal/finality.

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

---

## Demo walkthrough

1. `npm run dev`, open `http://localhost:3000` — case 002 loads by default with
   live state read from Bradbury.
2. Read the **Evidence** panel and open a source. Note the URL is pinned to a
   commit hash.
3. Read the **Ruling** panel: `PARTIAL_REFUND`, 25% refund, maintenance not
   qualified, and the validators' reasoning.
4. Switch cases in the top nav to see the other three agreements.
5. Connect a wallet as the customer or provider to act; as any other address the
   UI shows the observer role and disables the actions.

---

## Repository structure

```
contracts/uptime_bond.py     the intelligent contract (659 lines)
evidence/                    four commit-pinned fixture cases + schema
tests/direct/                195 hermetic Direct Mode tests
deploy/scripts/              gl.mjs (tx driver), lifecycle.mjs (harness), lib.mjs
deploy/bradbury/             deployment + transaction records per case
frontend/                    React/TS/Vite dApp on port 3000
```

---

## Security assumptions

- **Evidence sources are untrusted but assumed available.** The contract cannot
  tell a genuinely-missing source from a censored one; it refuses to rule rather
  than guess.
- **Prompt injection is contained, not prevented.** A malicious evidence source
  could influence the *outcome label*, but cannot set the payout — refund basis
  points are derived from the label by the contract. The blast radius is
  bounded by the outcome schedule.
- **GitHub is a availability dependency.** Commit-pinning makes content
  immutable, but if raw.githubusercontent.com is down, `rule()` fails transiently
  and validators disagree rather than settling wrongly. Production use should
  prefer content-addressed storage.
- **The deploying key is the customer.** `gl.message.sender_address` becomes the
  customer, so deploying on someone's behalf with an operator key records the
  *operator* as the customer.
- **Validator honesty is GenLayer's assumption, not ours.** UptimeBond inherits
  whatever guarantees the network provides.

---

## Known limitations

Stated plainly rather than glossed:

- **Two of four cases completed a full ruling and settlement** (002 and 003).
  Cases 001 and 004 were deployed, funded and driven as far as Bradbury's
  ~30-minute-per-transaction cadence allowed within the session. Their live
  status is in `deploy/bradbury/`.
- **Settlement transfers had not finalized** when this was written. Both
  `release()` transactions are ACCEPTED with 5/5 AGREE and state is RESOLVED /
  CONSENSUS_RULING, but transfers use `on="finalized"` — so the GEN had
  correctly *not* moved yet. That is the contract behaving as designed, not a
  failure, but the wallet-level payout is not claimed as confirmed here.
- **Wallet deltas include gas.** The provider balance moved 2.0 → 1.99956 GEN
  purely from `accept_sla` gas across three contracts; no escrow had landed.
  Gas and settlement must not be conflated when reading balances.
- **Live negative/authorization checks were not run on Bradbury.** They are
  covered thoroughly in Direct Mode (access control, duplicate funding,
  premature release, duplicate release), but running them live would require a
  separate deployment and ~30 minutes per reverting transaction. Not claimed as
  live-tested.
- **Deadlock deadlines were not exercised in real time.** The minimum window is
  1 hour and deployments use 24. Deterministic time progression is covered in
  Direct Mode via `warp`. A dedicated short-window deployment would be needed to
  demonstrate it live.
- **The frontend was not verified in a browser.** It builds, typechecks, lints,
  passes its tests, and serves on port 3000, and its data layer reads the live
  contracts — but no browser session confirmed the rendered UI.
- **The GenLayer CLI cannot call payable methods.** Both 0.39.1 and 0.39.2
  hardcode `value: 0n`, which is why `deploy/scripts/` exists.
- **`genlayer schema` and `genlayer code` are Studio-only.** Deployed source was
  verified against the deployment calldata instead.
- **Evidence fixtures are fabricated.** NimbusAPI, Acme Labs and Nimbus Systems
  do not exist. Never cite them as real reliability data.
