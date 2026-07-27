# UptimeBond — submission package

> Prepared, not submitted. Production-grade and submission-ready for the GenLayer
> Bradbury Testnet.

## ⚠️ Status — frozen at `v1.0.0-bradbury` (`11c39f9`)

The contract, frontend and tooling are production-grade for Bradbury, and the
**four v2 agreements are deployed, settled and verified on-chain**. Those are
real and independently checkable.

**Fresh self-service deployment is currently blocked.** A deployment on
27 July 2026 finalized with `FINISHED_WITH_RETURN`, 5 of 5 validators agreeing,
and recorded storage changes containing the correct constructor state — yet no
contract exists at the address its receipt named, at any state variant, and the
explorer's contracts endpoint 404s it. The transaction envelope is byte-for-byte
equivalent to a scripted deployment that worked, on the same pinned SDK; the one
substantive difference is a non-zero `storage_proof` where the working control
has zero. This is node-side as far as the client evidence can establish.

**No funds were escrowed or lost.** Deployment transfers no value; the escrow is
a separate later `fund()` call that was never made and cannot be made against a
contract that does not exist. Cost was gas only.

**The live two-wallet pilot is therefore prepared but NOT complete**, and
nothing in this package should be read as claiming otherwise. Full evidence:
[`docs/incidents/BRADBURY-MATERIALIZATION-INCIDENT.md`](../incidents/BRADBURY-MATERIALIZATION-INCIDENT.md).

### Remaining placeholders

These stay unfilled until fresh deployment is unblocked and the pilot runs:

| # | Placeholder | Source | Section |
|---|---|---|---|
| 1 | `<PILOT_CONTRACT>` | pilot step 1 | Live pilot |
| 2 | `<PILOT_DEPLOY_TX>` … `<PILOT_RELEASE_TX>` (6 hashes) | pilot steps 1–7 | Live pilot |
| 3 | `<PILOT_DATE>`, `<PILOT_OUTCOME>`, `<PILOT_CUSTOMER_PAYOUT>`, `<PILOT_PROVIDER_PAYOUT>`, `<PILOT_FINAL_BALANCE>`, `<PILOT_RETRIES>` | pilot step 8 | Live pilot |
| 4 | `<PILOT_SCREENSHOTS>` | pilot step 8 | Live pilot |
| 5 | `<VIDEO_URL>` | recording | Live URLs, Demo video |

Nothing else is pending. Do not edit any other section to "fill in" the pilot —
the placeholders above are the only ones that exist.

## One-line pitch

Escrow that settles service disputes — held on-chain, ruled by GenLayer
validators against public SLA evidence, and released without trusting either
party.

## Project description

UptimeBond is an on-chain service-level-agreement escrow. A customer locks payment
against a provider's uptime commitment. If the two disagree about whether the SLA
was met, the agreement is adjudicated by GenLayer validators that independently
re-fetch the agreed evidence sources, re-derive the ruling, and settle the escrow
according to a fixed, injection-resistant payout schedule. The entire lifecycle —
create, fund, accept, dispute, rule, release, mutual settlement, and deterministic
deadlock fallbacks — runs through the browser against a live intelligent contract.

## Problem statement

SLA disputes today are settled by whoever holds the money and the logs — usually
the provider — or by slow, expensive third parties. The customer must trust the
provider's status page; the provider must trust the customer's claim. There is no
neutral, verifiable adjudicator that can read heterogeneous, real-world evidence
(monitor reports, status pages, maintenance notices) and settle funds on it.

## Target users

- **Providers** (APIs, SaaS, hosting, RPC/indexers, AI services) who want to offer
  a credible, self-enforcing uptime guarantee as a differentiator.
- **Customers** who want SLA credits that don't depend on the provider's goodwill.
- **Marketplaces / DAOs** procuring infrastructure that need programmatic, auditable
  SLA settlement between parties who don't trust each other.

## Why centralized AI is insufficient

A single AI endpoint deciding the payout is a single point of trust and failure:
its output can't be independently verified, it can be prompted or bribed, and a
prompt injection hidden in an untrusted evidence source could move the money.
Centralized AI turns "who decides" into "who runs the model."

## Why GenLayer is essential

- **Native web + AI inside consensus.** The contract fetches its own evidence and
  reasons over it; there is no oracle to trust.
- **Independent re-derivation.** Every validator re-fetches the sources and derives
  the ruling; consensus is over the decision label only. No single party's output
  is authoritative.
- **Injection resistance by construction.** Validators agree on a label; the
  contract maps that label to a fixed payout. Evidence can influence the label,
  never the numbers.
- **Native escrow, payouts, appeals, and deadlock breakers.** The same system that
  adjudicates also custodies and settles the funds, can be appealed, and can always
  be unwound deterministically.

No conventional smart-contract platform can read a JSON monitor report and a status
page and reason about a 24-hour maintenance-notice clause in consensus. This is the
class of problem GenLayer exists for.

## Technical architecture

- **Intelligent contract** (`contracts/uptime_bond.py`, pinned runner): escrow
  custody; a lifecycle state machine (AWAITING_FUNDING → … → RESOLVED); a `rule`
  method that runs validator consensus over four re-fetched evidence sources and
  emits one of four outcomes; a fixed outcome→bps payout map; EVM external-message
  payouts that execute at finalization; a mutual-settlement fallback for
  INSUFFICIENT_EVIDENCE; and two deterministic deadlock breakers keyed on the
  transaction timestamp. Consensus is on decision fields only; prose reasoning is
  explanatory.
- **Frontend** (React + TypeScript + Vite, react-router): a full product SPA —
  create wizard with in-browser deploy, funding, provider invitation (link/QR/share),
  a browser-local agreement registry, a role-gated action interface for every
  contract method, dispute/ruling/settlement views, and the four verified demo
  cases. Deploys and writes go through the connected wallet via genlayer-js.
- **Chain access** (`src/chain.ts`): read client, wallet client, in-browser
  `deployContract`, receipt→address recovery, balance reads, and a tx state machine
  that treats a hash as "submitted", not "done".

## Live URLs

- App: **https://uptimebond.vercel.app**
- Live cases (four verified outcomes): https://uptimebond.vercel.app/demo
- Demo video: **`<VIDEO_URL>`**
- Explorer: https://explorer-bradbury.genlayer.com

## Repository

https://github.com/GIFTEDLOV/uptimebond

## Verified contract addresses (Bradbury, chain 4221)

Each was driven end to end and its payout verified on-chain (fixed payout path,
contract source commit `6e29b67`):

| Case | Outcome | Address |
|---|---|---|
| 001-v2 | `NO_BREACH` | `0xa0c10C656692B4A8E44357d342C38C3DEEE2cFFe` |
| 002-v2 | `PARTIAL_REFUND` (2500 bps) | `0x965C9B454867273F612BD48d181Ec418391750d5` |
| 003-v2 | `FULL_REFUND` (10000 bps) | `0xDF1A19ACBE068373f067EF6E226EE564032f4676` |
| 004-v2 | `INSUFFICIENT_EVIDENCE` | `0x44DF768956c15f3B9aFBe82A08dAcB4a9A785F7d` |

## Live pilot (two wallets, browser only) — PREPARED, NOT COMPLETED

> **This pilot has not been run.** Fresh deployment on Bradbury is blocked by
> the state-materialization incident above. The run sheet
> (`docs/pilot/PILOT-RUN.md`) and evidence template
> (`docs/pilot/EVIDENCE-RECORD.md`) are ready; the table below is the shape of
> the record, not a record. Every value is a placeholder.

A real two-party agreement created, funded, accepted, disputed, ruled, and
released entirely through the deployed app — no scripts, no CLI.

| Field | Value |
|---|---|
| Run date (UTC) | `<PILOT_DATE>` |
| Contract | `<PILOT_CONTRACT>` |
| Escrow | 0.01 GEN |
| Evidence set | `evidence/case-002-partial-refund`, pinned at commit `ad00182` |
| Outcome | `<PILOT_OUTCOME>` (expected `PARTIAL_REFUND`, 2500 bps) |
| Customer payout | `<PILOT_CUSTOMER_PAYOUT>` (expected 0.0025 GEN) |
| Provider payout | `<PILOT_PROVIDER_PAYOUT>` (expected 0.0075 GEN) |
| Contract balance after finalization | `<PILOT_FINAL_BALANCE>` (expected 0) |
| Network retries / failures | `<PILOT_RETRIES>` |

| Step | Transaction |
|---|---|
| deploy | `<PILOT_DEPLOY_TX>` |
| fund (payable 0.01 GEN) | `<PILOT_FUND_TX>` |
| accept_sla (provider) | `<PILOT_ACCEPT_TX>` |
| open_dispute | `<PILOT_DISPUTE_TX>` |
| rule | `<PILOT_RULE_TX>` |
| release | `<PILOT_RELEASE_TX>` |

Screenshots: `<PILOT_SCREENSHOTS>` — eleven frames from review through to the
finalized release and both wallet balances, listed in the evidence record.

Payout completion is asserted from the **live contract balance reaching zero**,
not from the agreement status. `FINISHED_WITH_RETURN` proves contract code ran;
only the balance proves value moved.

## Demo video

Script and shot list: `docs/submission/DEMO-SCRIPT.md` (2:45, with a cut to 2:00
noted). Recorded at 1440×900 on testnet accounts; no key or seed material appears
on camera. Link: **`<VIDEO_URL>`**

## Testing evidence

- 57 unit tests (validation, action state machine, registry, evidence
  normalization, formatting, role logic).
- 16-check mocked-wallet browser e2e (`npm run e2e`) — no GEN spent.
- Accessibility gate (`npm run a11y`): axe-core across WCAG 2.0/2.1 A + AA on all
  11 routes at desktop and mobile — **0 violations** — plus structural assertions
  axe cannot make (single `h1`, reachable skip link, visible focus ring, no
  colour-only status indicators).
- Visual/hygiene sweep (`npm run shots`): every route at both viewports, failing
  on console errors, failed requests, horizontal overflow, or targets under the
  24px WCAG 2.5.8 minimum — **0 problems**.
- Contract Direct Mode suite (201 tests) + live integration read checks in the repo.
- CI runs lint, typecheck, unit tests, build, e2e, the accessibility gate, the
  visual sweep, and a secret scan on every push.
- Four contracts verified on-chain with recorded transaction hashes and measured
  balance movement. The two-wallet browser pilot is prepared but not run — fresh
  deployment is blocked (see Status).

## Security considerations

- Fixed outcome→payout map: evidence can't move funds directly.
- No private-key/seed/password handling; signing stays in the wallet.
- CSP + security headers, escaped output, no dangerous HTML rendering, evidence
  previews never execute returned markup.
- Address/URL validation everywhere; unsupported contracts rejected on import.
- Payout completion read from the live balance, never inferred from status.

## Current limitations

- Bradbury testnet only; no mainnet claim, no real value, no legal guarantee.
- Validator rulings can be delayed, disagree, or time out under network load;
  submissions occasionally need a retry (handled, but supervised).
- Evidence sources are third-party controlled and must be public + commit-pinned.
- The agreement registry is browser-local (no cross-device sync by design).
- Each transaction takes roughly 26–32 minutes to finalize on Bradbury, so a full
  six-step agreement is a ~3-hour exercise. The UI is built around that: a hash
  is reported as *submitted*, never as success, and an interrupted deploy or
  action resumes tracking rather than resubmitting.
- **Fresh deployment is blocked on Bradbury.** A finalized, 5/5-agreed,
  `FINISHED_WITH_RETURN` deployment produced no contract at the address its
  receipt named. The client artifacts are byte-equivalent to a deployment that
  worked; the difference is a non-zero `storage_proof` against the control's
  zero. No funds were escrowed. Frozen pending a GenLayer answer —
  [`docs/incidents/BRADBURY-MATERIALIZATION-INCIDENT.md`](../incidents/BRADBURY-MATERIALIZATION-INCIDENT.md).
- **Deployed contract bytes were platform-dependent until `bde38c9`.** A Windows
  checkout submitted CRLF source (34,266 bytes, `93e1ddb9…`) where Linux
  submitted LF (33,517 bytes, `04fe3a7b…`). The Python logic is identical, but
  the bytes, the transaction hash and the derived contract address are not. All
  existing deployments carry the CRLF variant; `.gitattributes` now pins LF and
  CI asserts it.

## Adoption roadmap

1. **Now:** testnet product + four verified on-chain agreements + a prepared
   two-wallet pilot, blocked on the Bradbury materialization incident.
2. **Pilot at scale:** repeat with a controlled outage against a live service;
   gather ruling accuracy and timing data across evidence sets.
3. **Templates:** one-click SLA templates per service category; monitor adapters
   for common uptime providers.
4. **Multi-period agreements & subscriptions;** provider reputation from settled history.
5. **Mainnet** once GenLayer mainnet economics and validator guarantees support it.

## Why this should be a highlighted project

UptimeBond is a complete, working product — not a proof of concept — that uses the
one capability unique to GenLayer (verifiable web + AI adjudication in consensus)
to solve a real, universal B2B problem (SLA disputes), with the money-moving
decision made injection-resistant by design. Four outcomes are verified on-chain,
the full customer/provider workflow runs in the browser, and it ships with tests,
CI, security hardening, and a pilot kit.

## Note

The UptimeBond intelligent contract is submitted **only** as part of this product,
not separately as a standalone Intelligent Contract contribution.
