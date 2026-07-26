# UptimeBond — submission package

> Prepared, not submitted. Production-grade and submission-ready for the GenLayer
> Bradbury Testnet.

## One-line pitch

Escrow that settles its own SLA disputes — GenLayer validators re-fetch the
evidence, rule, and pay out, with no trusted middleman.

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
- Live demo (four verified outcomes): https://uptimebond.vercel.app/demo
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

## Demo script (3 minutes)

1. **Home (20s).** The one-screen pitch and the fixed outcome schedule. "The
   ruling controls the money, not a prompt."
2. **Live Demo (60s).** Switch across the four verified cases. For 002, point at the
   Settlement panel: customer 0.025 / provider 0.075 GEN, contract balance 0,
   "Payout finalized" — read live from the contract. Show 004: release rejected,
   0.1 GEN custodied.
3. **Create (45s).** Walk the wizard: provider address, evidence URLs with a live
   reachability test and JSON preview, settlement terms, review. Stop at Deploy
   (no live spend on camera unless piloting).
4. **Invite (25s).** Show the invitation link + QR and the "only the registered
   provider can accept" gate.
5. **Why GenLayer (30s).** Independent re-derivation + injection resistance +
   native settlement — the architecture slide.

## 2–3 minute video recording plan

- Screen-record at 1440×900; keep the wallet in a testnet account.
- Pre-fund both wallets so no faucet wait is on camera.
- Follow the demo script; narrate the Settlement panel's live values.
- For a real settlement on camera, pre-stage an agreement at `RULED` and only
  record the `release` + finalization + balance verification.

## Testing evidence

- 57 unit tests (validation, action state machine, registry, evidence
  normalization, formatting, role logic).
- 15-check mocked-wallet browser e2e (`npm run e2e`) — no GEN spent.
- Contract Direct Mode suite (201 tests) + live integration read checks in the repo.
- CI runs lint, typecheck, unit tests, build, e2e, and a secret scan on every push.
- Four contracts verified on-chain with recorded transaction hashes and balances.

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
- A live two-wallet pilot is prepared but must be executed manually (see the pilot kit).

## Adoption roadmap

1. **Now:** testnet product + verified demos + pilot kit.
2. **Pilot:** run real two-wallet pilots with a controlled outage; gather ruling
   accuracy and timing data.
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
