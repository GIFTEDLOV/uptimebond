# UptimeBond — submission package

> Prepared, not submitted. Production-grade and submission-ready for the GenLayer
> Bradbury Testnet.

## Status — live two-wallet pilot complete ✓

The contract, frontend and tooling are production-grade for Bradbury. The four
v2 agreements are deployed, settled and verified on-chain, **and a fresh
two-wallet pilot was run end to end through the browser on 29 July 2026**:

| | |
|---|---|
| Contract | **[`0x5006115944D7F593E401239aeDb64abEF13dCc0a`](https://explorer-bradbury.genlayer.com/address/0x5006115944D7F593E401239aeDb64abEF13dCc0a)** |
| Escrow | 0.01 GEN, funded and settled |
| Outcome | `PARTIAL_REFUND`, 2500 bps, from the evidence alone |
| Payout | customer **25%** (0.0025 GEN), provider **75%** (0.0075 GEN), **balance zero** |
| Negative test | duplicate `release()` **rejected** — 5/5 DISAGREE, no state change, no funds moved |

Two separate wallets, two browser profiles, no scripts: the customer deployed,
funded, disputed, ruled and released; the provider accepted the SLA from an
invitation link. Full record:
[`docs/pilot/runs/2026-07-29-pilot.md`](../pilot/runs/2026-07-29-pilot.md).

**The earlier deployment-materialization incident is closed as no longer
reproducing.** A deployment on 27 July finalized `FINISHED_WITH_RETURN` with 5/5
AGREE and recorded storage writes, yet no contract ever existed at the address
its receipt named — and that address is still empty today. Deployments resumed
working on 29 July and the replacement materialized normally. **The cause was
never explained**, and the original evidence stands unrevised:
[`docs/incidents/BRADBURY-MATERIALIZATION-INCIDENT.md`](../incidents/BRADBURY-MATERIALIZATION-INCIDENT.md).
No funds were ever escrowed or lost by it — deployment transfers no value.

### Evidence completeness

No placeholders remain; this package is submission-ready exactly as written. Two
gaps in the pilot evidence are recorded rather than papered over: **per-wallet
balance deltas and screenshots were not captured**, because the run was
reconstructed from the chain afterwards. The contract-side settlement proof is
complete and independently reproducible.

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

## Live pilot (two wallets, browser only) — COMPLETE ✓

A real two-party agreement created, funded, accepted, disputed, ruled and
released entirely through the deployed app — no scripts, no CLI. Two separate
wallets in two browser profiles.

| Field | Value |
|---|---|
| Run date (UTC) | **2026-07-29**, 11:17 → 16:28 (5 h 10 min) |
| Contract | **[`0x5006115944D7F593E401239aeDb64abEF13dCc0a`](https://explorer-bradbury.genlayer.com/address/0x5006115944D7F593E401239aeDb64abEF13dCc0a)** |
| Customer / provider | `0x456Ccff0d33463E1834F724C5C5971D6cff6f1dc` / `0x79DD8260773C7D5DEA701dfC2D3dD804FF041bf2` |
| Escrow | 0.01 GEN |
| Evidence set | `evidence/case-002-partial-refund`, pinned at commit `ad00182` |
| Outcome | **`PARTIAL_REFUND`, 2500 bps** — breached `SLA-1`, maintenance not qualified |
| Customer payout | **0.0025 GEN** (25%) |
| Provider payout | **0.0075 GEN** (75%) |
| Contract balance after finalization | **0** · `payout_complete: true` |
| Network retries / failures | none blocking; `rule` carried on a 3/5 margin with 2 validator `TIMEOUT` |

| Step | Transaction | Consensus | Execution |
|---|---|---|---|
| deploy | [`0x8a8befa0332b4c73ac2ab09fb655fe9f38e1569b00130c99129c7930dafbafcc`](https://explorer-bradbury.genlayer.com/tx/0x8a8befa0332b4c73ac2ab09fb655fe9f38e1569b00130c99129c7930dafbafcc) | 5 AGREE | `FINISHED_WITH_RETURN` |
| fund (payable 0.01 GEN) | [`0xd95dce3cec29a55ccd6821fde43e3b43f22d239b06bcec09563449e35e056672`](https://explorer-bradbury.genlayer.com/tx/0xd95dce3cec29a55ccd6821fde43e3b43f22d239b06bcec09563449e35e056672) | 5 AGREE | `FINISHED_WITH_RETURN` |
| accept_sla (provider) | [`0x47f95e8f9956ae99ee7154059ac86aa5dfa5f4882561d27b1dcf85cc1695a82e`](https://explorer-bradbury.genlayer.com/tx/0x47f95e8f9956ae99ee7154059ac86aa5dfa5f4882561d27b1dcf85cc1695a82e) | 5 AGREE | `FINISHED_WITH_RETURN` |
| open_dispute | [`0xab3cfd69cfcf553f5f61628aeb1f76f6694bbcc7a5e56833027cfb68fab6cad9`](https://explorer-bradbury.genlayer.com/tx/0xab3cfd69cfcf553f5f61628aeb1f76f6694bbcc7a5e56833027cfb68fab6cad9) | 5 AGREE | `FINISHED_WITH_RETURN` |
| rule | [`0xb151be00c6f1802d513afef8733ed7eb5a33ce14c8dea49f109f53b8cb282ae4`](https://explorer-bradbury.genlayer.com/tx/0xb151be00c6f1802d513afef8733ed7eb5a33ce14c8dea49f109f53b8cb282ae4) | 3 AGREE, 2 TIMEOUT | `FINISHED_WITH_RETURN` |
| release | [`0xbd6922e842d468b3bd1623c889bac282a1b843b36b5af8e57f211aef56a4ed3f`](https://explorer-bradbury.genlayer.com/tx/0xbd6922e842d468b3bd1623c889bac282a1b843b36b5af8e57f211aef56a4ed3f) | 5 AGREE | `FINISHED_WITH_RETURN` |
| **release — duplicate, rejected** | [`0x7f9aad2fd451e35a8f726d27f86ca61506c4745d6f9faddcd5e94b9fdf83da10`](https://explorer-bradbury.genlayer.com/tx/0x7f9aad2fd451e35a8f726d27f86ca61506c4745d6f9faddcd5e94b9fdf83da10) | **5 DISAGREE** | **`FINISHED_WITH_ERROR`** |

### Negative safety test — the duplicate release

The last row was not planned. The provider submitted a second `release()` 27
seconds after the customer's, from a tab still showing `RULED`. Bradbury queued
it behind the first; by the time it executed the agreement was `RESOLVED` and the
single-shot guard refused it. **No state changed and no additional funds moved** —
the settlement on-chain is the first release, unchanged, contract balance zero.

An unplanned negative test is worth more than a scripted one, and this is the
guard that protects the escrow from exactly the mistake a real user makes. The
frontend was hardened in `0505189` so a tab holding state it has not re-read
cannot carry a write to signature, and so a postcondition can never be shown
under a transaction it does not belong to. That fix does **not** close this exact
race — at submission the contract genuinely still read `RULED`, because the
competing release was in flight and unfinalized, invisible in contract state.
Two parties can always submit inside one finality window; only the contract can
arbitrate it. Analysis: finding **F2** of
[`docs/pilot/runs/2026-07-29-pilot.md`](../pilot/runs/2026-07-29-pilot.md).

### What the evidence does and does not cover

Payout completion is asserted from the **live contract balance reaching zero**,
not from the agreement status. `FINISHED_WITH_RETURN` proves contract code ran;
only the balance proves value moved. The deployed source was also read back and
hashed: byte-identical to `contracts/uptime_bond.py`.

Not captured: per-wallet before/after balances and screenshots. The run was
reconstructed from the chain afterwards, and a signer's net delta is its gross
credit minus its own gas, which is not separable retrospectively.

## Guided walkthrough

The app is submitted to be driven directly: every claim below is reproducible in
the browser against the live contracts. `docs/submission/DEMO-SCRIPT.md` is the
narrated route through the product — problem, create, evidence, ruling,
settlement — for a reviewer who wants the intended order.

## Testing evidence

- 159 unit tests (validation, action state machine, registry, evidence
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
  balance movement, **plus a fifth from the completed two-wallet browser pilot** —
  seven transactions including a rejected duplicate release (see Live pilot).

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
- **One deployment materialized nothing, and the cause is still unknown.** A
  finalized, 5/5-agreed, `FINISHED_WITH_RETURN` deployment produced no contract
  at the address its receipt named, and that address is still empty. The client
  artifacts were byte-equivalent to a deployment that worked; the difference was
  a non-zero `storage_proof` against the control's zero. No funds were escrowed.
  Deployments resumed on 29 July and the replacement materialized normally, so
  this is **closed as no longer reproducing, not explained** —
  [`docs/incidents/BRADBURY-MATERIALIZATION-INCIDENT.md`](../incidents/BRADBURY-MATERIALIZATION-INCIDENT.md).
  Verify every deployment by reading the contract back; the app does, in 13
  checks, before it will offer a Fund button.
- **Competing writes inside one finality window cannot be prevented client-side.**
  Demonstrated by the pilot's duplicate release. The contract's single-shot guard
  arbitrates it and the escrow is never at risk, but the losing party pays gas and
  waits ~30 minutes to learn its call was refused.
- **The pilot's per-wallet balance deltas and screenshots were not captured.**
  The run was reconstructed from the chain afterwards. Contract-side settlement
  evidence is complete; wallet-side net deltas are not recoverable.
- **Deployed contract bytes were platform-dependent until `bde38c9`.** A Windows
  checkout submitted CRLF source (34,266 bytes, `93e1ddb9…`) where Linux
  submitted LF (33,517 bytes, `04fe3a7b…`). The Python logic is identical, but
  the bytes, the transaction hash and the derived contract address are not. All
  existing deployments carry the CRLF variant; `.gitattributes` now pins LF and
  CI asserts it.

## Adoption roadmap

1. **Now:** testnet product + four verified on-chain agreements + a completed
   two-wallet browser pilot that settled a real escrow and survived a duplicate
   release.
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
