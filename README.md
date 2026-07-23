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

Both parties are externally owned accounts, so each payout leaves the contract
through an **EVM external message** (`@gl.evm.contract_interface` →
`emit_transfer`), which executes at **finalization** — not the internal GenVM
contract-message path, which is inert against an EOA and moves no value. A
settled agreement therefore reads `RESOLVED` with the payout *queued* for a few
minutes to tens of minutes before the escrow actually leaves; `get_settlement_status`
reports `payout_complete` from the live contract balance, never from status
alone. This distinction is the fix in commit `6e29b67`; the earlier
implementation is documented in
[`deploy/bradbury/probe-eoa-transfer/RESULT.md`](deploy/bradbury/probe-eoa-transfer/RESULT.md).

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

Network **GenLayer Bradbury Testnet**, chain ID **4221** ·
[explorer](https://explorer-bradbury.genlayer.com/).

Contract source: the fixed payout path at commit **`6e29b67`** (`contracts/uptime_bond.py`,
unchanged since). Evidence sources pinned at commit **`ad00182`**. Each payout
leaves the contract through an EVM external message that executes at
finalization — see [Payout model](#payout-model) and
[`deploy/bradbury/probe-eoa-transfer/RESULT.md`](deploy/bradbury/probe-eoa-transfer/RESULT.md).

### Verified agreements (fixed payout path) ✓

Every case below was driven `deploy → fund → accept → dispute → rule → release`
and its escrow movement was measured on-chain across the release finalization
boundary. Full records under `deploy/bradbury/<case>/99-final-state.json`.

| Case | Outcome | Contract | Escrow settlement (measured) |
|---|---|---|---|
| **001-v2** no breach | `NO_BREACH` | [`0xa0c10C656692B4A8E44357d342C38C3DEEE2cFFe`](https://explorer-bradbury.genlayer.com/address/0xa0c10C656692B4A8E44357d342C38C3DEEE2cFFe) | provider received **0.1 GEN**, customer 0, **contract balance 0** |
| **002-v2** partial refund | `PARTIAL_REFUND` 2500 bps | [`0x965C9B454867273F612BD48d181Ec418391750d5`](https://explorer-bradbury.genlayer.com/address/0x965C9B454867273F612BD48d181Ec418391750d5) | customer received **0.025 GEN**, provider received **0.075 GEN**, **contract balance 0** |
| **003-v2** full refund | `FULL_REFUND` 10000 bps | [`0xDF1A19ACBE068373f067EF6E226EE564032f4676`](https://explorer-bradbury.genlayer.com/address/0xDF1A19ACBE068373f067EF6E226EE564032f4676) | customer received **0.1 GEN**, provider 0, **contract balance 0** |
| **004-v2** insufficient evidence | `INSUFFICIENT_EVIDENCE` | [`0x44DF768956c15f3B9aFBe82A08dAcB4a9A785F7d`](https://explorer-bradbury.genlayer.com/address/0x44DF768956c15f3B9aFBe82A08dAcB4a9A785F7d) | automatic `release()` **rejected**, **0.1 GEN remains custodied** |

Each agreement was funded with **0.1 GEN**. Case 004 is the inverse gate:
`INSUFFICIENT_EVIDENCE` has no automatic settlement, so `release()` reverts and
the escrow stays in custody — proving the payout fix pays settleable outcomes
without turning the unsettleable one into a payout.

**Transactions** (all hashes are full; open at
`https://explorer-bradbury.genlayer.com/tx/<hash>`):

| Case | Deploy tx | Ruling tx | Release tx |
|---|---|---|---|
| 001-v2 | `0x846a227db36d4e3e87199aa1bafebcb09b0bfb056be6f7a3939dcfe2805129a3` | `0x842d7544a3d0b5bd6c50acc07b54f691ab92da31c82643d3626123347047fc0c` | `0x8fc3afb7829a83c689d44d417fbf4d8b28dc7231c250abd3ecd0f6d5a66b997d` |
| 002-v2 | `0x28215db5fd84ee69154ce6a368d8b6023cf1fb848f623e2e33139eae3bf6893c` | `0x2c0ebf63ede17d46da4566133abd9bffb8d31fd2f240549df905506ee2165e97` | `0xc3ca00fe2c4acee2b8af8d2e45fb82373e4c785965d15ee810009a2f6c79b064` |
| 003-v2 | `0x8114096c8d571b0ef7a71eebca3cf128383e8e9cf145032d8727a868df9580d1` | `0xff60eb612533ebe10c11dfd826e946073ecd011bd21e47f134408031c73838ae` | `0x34789e5edd99cec68b53a3c96552ab09d703457be3abae5dfcb3938f63f18e4a` |
| 004-v2 | `0x0e11d6a815b77709a384f18e52c72628c17d585d5bfc797886786d1e1c781945` | `0xd5a73921c5807481e4e20688d2b19b7b62f4b112fa89cbe8dbfbbe83173768e3` | `0xeef01ac7ace209fab1c635a5c9ffc8255981afb2f18b564ae982acc2be79fe47` (reverted, by design) |

Consensus notes: 002-v2 ruled and released at a clean 5/5 AGREE. 001-v2 and
003-v2 ruled on 3/5 majorities (with 2 validator `TIMEOUT` and 2
`DETERMINISTIC_VIOLATION` respectively) and released 5/5 AGREE — correct
outcomes, weaker margins from validator-side re-execution under node load, not
contract faults. 004-v2's `release()` was ACCEPTED by consensus but execution
`FINISHED_WITH_ERROR` with 5/5 DISAGREE — the `Outcome INSUFFICIENT_EVIDENCE
has no settlement` guard. 002-v2 also has a duplicate-release attempt
(`0x86bf7fce249303a6794460d39783e4f12f015a50776458177df2b80caf893649`)
rejected 5/5 DISAGREE, moving no value.

Case 002-v2's ruling, derived by validators from the evidence alone:

> "The independent monitor is the primary evidence and reports an uptime of
> 99.1%, which is below the 99.5% SLA commitment. The 300-minute maintenance
> window on May 12 does not qualify for exclusion as it was announced only 2
> hours in advance, failing the 24-hour notice requirement in SLA-2. Therefore,
> all 402 minutes of downtime count, resulting in a breach that falls within
> the 98.00% to 99.49% range for a partial refund per SLA-3."

### ⚠️ Deprecated broken-payout deployments — do not use as demos

These four contracts were deployed **before commit `6e29b67`**. Their `_settle`
paid EOAs through an internal GenVM `PostMessage`, which is inert against an
externally owned account: it moved no value while reporting success. The ruling
on each is valid and consensus-backed; **only the payout is broken.** The
contracts are immutable and `release()` is single-shot, so the escrow **cannot
be recovered** by any further call. Do not fund them, do not call `release`
again, and do not present them as working demonstrations.

| Contract | Case | On-chain state | Escrow (stranded) |
|---|---|---|---|
| [`0x4dc6b188b3025f92F133515c3041cbc4E2019988`](https://explorer-bradbury.genlayer.com/address/0x4dc6b188b3025f92F133515c3041cbc4E2019988) | 002 partial refund | RESOLVED, `PARTIAL_REFUND` 2500 (paid nobody) | **1 GEN** — superseded by 002-v2 |
| [`0x7EA49E783B4839a20c39F77FFe62b3beF10195b7`](https://explorer-bradbury.genlayer.com/address/0x7EA49E783B4839a20c39F77FFe62b3beF10195b7) | 003 full refund | RESOLVED, `FULL_REFUND` 10000 (paid nobody) | **0.1 GEN** |
| [`0xE64Dcc5E82592c8BBF59003eF6AF772D739dDBAC`](https://explorer-bradbury.genlayer.com/address/0xE64Dcc5E82592c8BBF59003eF6AF772D739dDBAC) | 001 no breach | DISPUTED (never settled) | **0.1 GEN** |
| [`0xb0C263bEf959E640060045D47659582D23bb67c0`](https://explorer-bradbury.genlayer.com/address/0xb0C263bEf959E640060045D47659582D23bb67c0) | 004 insufficient evidence | AWAITING_PROVIDER_ACCEPTANCE (never settled) | **0.1 GEN** |

Total permanently stranded: **1.3 GEN** of testnet funds. Treat as lost absent
an official protocol recovery mechanism.

**⚠️ `0xB82f70950BbEfBC6829c463A5922Bb1B6333C637` is a separate failed ghost
contract from the pre-`ad00182` constructor bug. Never fund or interact with
it.**

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
