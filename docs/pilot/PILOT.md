# UptimeBond pilot kit

Everything needed to run a real two-wallet pilot on the GenLayer Bradbury
testnet, end to end, through the browser at
**[uptimebond.vercel.app](https://uptimebond.vercel.app)**.

> This kit prepares the pilot. It does **not** execute any transaction for you.
> Every step that spends testnet GEN or needs a wallet signature is done by you,
> in your wallet. Nothing here is completed until you run it.

**Running the pilot right now?** Use **[`PILOT-RUN.md`](PILOT-RUN.md)** — the
exact browser-only, two-wallet, 0.01 GEN run sheet, signature by signature — and
fill in **[`EVIDENCE-RECORD.md`](EVIDENCE-RECORD.md)** as you go. This file is
the background kit: evidence publishing, controlled-outage guidance, and the
options behind the choices the run sheet already makes for you.

---

## 0. Prerequisites

- Two browser wallets (e.g. MetaMask) with **separate accounts** — one customer,
  one provider.
- Both funded with a small amount of **Bradbury testnet GEN** (the customer needs
  escrow + gas; the provider needs gas only).
- Network added to each wallet:
  - Name: GenLayer Bradbury Testnet · Chain ID: **4221**
  - RPC: `https://rpc-bradbury.genlayer.com`
  - Explorer: `https://explorer-bradbury.genlayer.com`
  - Currency: GEN (18 decimals)
- Four **public, commit-pinned** evidence URLs (see `examples/` and the
  “Publishing evidence” section).

## 1. Pilot checklist (tick as you go)

- [ ] Provider wallet address copied.
- [ ] Four evidence URLs published, public, and returning HTTP 200.
- [ ] Evidence URLs commit-pinned (no moving branches).
- [ ] Customer: **Create Agreement** wizard completed and deployed.
- [ ] Deploy transaction **finalized**; contract address recorded.
- [ ] Customer: escrow **funded**; contract balance verified on-chain.
- [ ] Invitation link shared with the provider.
- [ ] Provider: wallet connected, **accept_sla** finalized, status = ACTIVE.
- [ ] (Happy path) Customer: **approve_service** → provider paid in full, OR
- [ ] (Dispute path) Either party: **open_dispute** with an incident window.
- [ ] Either party: **rule** finalized; outcome recorded.
- [ ] Either party: **release** finalized (if settleable).
- [ ] Payout **verified from the live contract balance** (not from status).
- [ ] Post-pilot verification checklist completed.

## 2. Customer instructions

1. Open the app, **Connect Wallet** (customer account), confirm Bradbury.
2. **Create Agreement**:
   - Step 1 — enter the provider wallet address. Add private labels if you like.
   - Step 2 — pick the service category and describe the period.
   - Step 3 — paste the four evidence URLs. Use **Test** on each: expect HTTP 200
     and a JSON/text preview. Fix any non-HTTPS or branch-pinned URL.
   - Step 4 — set the escrow (start small, e.g. **0.1 GEN**), the deadlock refund
     %, and the two deadlock deadlines (1 hour minimum).
   - Step 5 — review everything, tick the confirmation.
   - Step 6 — **Deploy**. Approve the signature. Wait for **finalized** — the app
     recovers the contract address for you. Do **not** close the tab mid-deploy;
     if you do, reopen Create and it resumes tracking instead of redeploying.
3. On the agreement page, **Fund escrow**. Approve the payable transaction. Wait
   for finalization; confirm **Escrow held** and the contract balance.
4. **Invite provider** — copy the link (or QR) and send it to the provider.

## 3. Provider instructions

1. Open the invitation link. You can read the whole agreement without a wallet.
2. Review the escrow, the customer, and the four evidence sources you are being
   held to. These are **immutable**.
3. **Connect Wallet** with the exact registered provider account. If you connect
   any other wallet, acceptance stays disabled.
4. **Accept SLA**. Approve the signature. Wait for finalization; confirm the
   status becomes **ACTIVE**. Optionally **Save to My Agreements**.

## 4. Running a controlled outage (dispute path)

To exercise adjudication honestly, make the evidence reflect a real breach:

1. During the agreement period, take the monitored endpoint down (or point the
   monitor at a deliberately failing target) for a measured window.
2. Ensure your **independent monitor** report captures the downtime and publishes
   updated JSON at the pinned URL (re-pin to a new commit and, if the agreement
   already exists, note that validators use the URL fixed at deployment — so the
   content at that commit must reflect the period you are disputing).
3. Either party opens a dispute with the incident window (e.g.
   `NimbusAPI May 2026 uptime dispute`).
4. Either party runs **rule**. Validators re-fetch the four sources and derive the
   outcome. Expect ~30 minutes and possible retries under load.
5. If settleable, either party runs **release**; verify the payout.

Downtime-to-outcome guide (per the fixed schedule, using the demo SLA):

| Uptime observed | Expected outcome | Customer | Provider |
|---|---|---|---|
| ≥ 99.50% | `NO_BREACH` | 0% | 100% |
| 98.00%–99.49% | `PARTIAL_REFUND` | 25% | 75% |
| < 98.00% | `FULL_REFUND` | 100% | 0% |
| Monitor coverage too low | `INSUFFICIENT_EVIDENCE` | — | — (custodied) |

## 5. Publishing evidence

UptimeBond does **not** monitor your service. You publish the evidence; validators
fetch it. Options:

- **Your own monitor output.** Run any uptime checker and publish its summary as
  JSON (see `examples/monitor-report.schema.json`). Host it on a commit-pinned
  GitHub raw URL, an object store, or any public HTTPS endpoint.
- **A third-party status page / monitor.** Many uptime services expose a public
  JSON or status URL — use it directly if it is stable and public.

Requirements for every source:
- **HTTPS**, public, and reachable server-side (validators fetch it, not your browser).
- **Commit-pinned** if on GitHub raw (a moving branch can make validators disagree).
- Content stable for the agreement/incident window.

See `examples/` for a schema and ready-to-adapt samples.

## 6. Expected-balance worksheet

Fill this before releasing, then verify after finalization. Amounts are **gross**
escrow transfers; each signer also pays gas, so a party that signs will see a
slightly smaller net delta.

| Field | Value |
|---|---|
| Escrow funded (GEN) | __________ |
| Ruling outcome | __________ |
| Refund bps | __________ |
| Expected customer payout (escrow × bps ÷ 10000) | __________ |
| Expected provider payout (escrow − customer) | __________ |
| Expected contract balance after finalization | **0** (settleable) / **escrow** (insufficient-evidence) |

Worked example — 0.1 GEN, `PARTIAL_REFUND` (2500 bps): customer 0.025, provider
0.075, contract balance 0.

## 7. Post-pilot verification checklist

- [ ] Agreement status is `RESOLVED` (or `RULED` + custodied for insufficient-evidence).
- [ ] `get_settlement_status.payout_complete` is `true` (settleable cases).
- [ ] Contract balance matches the worksheet (0 for settleable; escrow for custodied).
- [ ] Customer and provider balance deltas match expected payouts, net of gas.
- [ ] The release transaction is **finalized** on the explorer.
- [ ] A second `release()` is rejected (single-shot) — optional to test.
- [ ] The Settlement panel shows **Payout finalized** (or **Escrow custodied**).

## 8. What to send back after the pilot

Contract address, the deploy/fund/accept/dispute/rule/release transaction hashes,
the final `get_state` and `get_settlement_status`, and the filled worksheet.
