# Live pilot run sheet — browser only, two wallets, 0.01 GEN

> **This run sheet has been executed successfully.** 2026-07-29, contract
> [`0x5006115944D7F593E401239aeDb64abEF13dCc0a`](https://explorer-bradbury.genlayer.com/address/0x5006115944D7F593E401239aeDb64abEF13dCc0a):
> ruled `PARTIAL_REFUND` 2500 bps, escrow settled 0.0025 GEN to the customer and
> 0.0075 GEN to the provider, contract balance zero. Full record:
> [`runs/2026-07-29-pilot.md`](runs/2026-07-29-pilot.md).
>
> Two things that run learned, worth knowing before you repeat it: record the
> wallet balances at step 0 *as you go* (they cannot be recovered afterwards),
> and see finding **F2** — two parties can both submit `release()` inside one
> finality window, and only the contract can arbitrate that.

The exact sequence for one real end-to-end agreement on GenLayer Bradbury,
driven entirely through **[uptimebond.vercel.app](https://uptimebond.vercel.app)**.
No scripts, no CLI, no keys on disk.

`PILOT.md` is the background kit — evidence publishing, downtime guides, options.
**This file is the run sheet.** Follow it top to bottom and fill in
`EVIDENCE-RECORD.md` as you go.

> Nothing in this file is executed for you. Every numbered **SIGN** step is a
> wallet signature you perform yourself.

---

## Budget and timing

| | |
|---|---|
| Escrow | **0.01 GEN** |
| Signed transactions | 6 (deploy, fund, accept, dispute, rule, release) |
| Gas | Customer pays 4 (deploy, fund, dispute or rule, release); provider pays 1–2 |
| Wall-clock | **~2.5–3.5 hours.** Bradbury serializes transactions per contract and each step waits on the previous one's *finality* — roughly 26–32 minutes each |
| Customer wallet needs | 0.01 GEN escrow + gas for 4 transactions |
| Provider wallet needs | gas only |

Do not run this against a deadline. Start it when you can leave the tab open.

---

## Before you start

- [ ] Two browser wallet accounts, **different addresses**. Call them CUSTOMER and PROVIDER.
- [ ] Both have Bradbury added: chain ID **4221**, RPC `https://rpc-bradbury.genlayer.com`, currency GEN (18 decimals).
- [ ] CUSTOMER holds at least 0.05 GEN (0.01 escrow + gas headroom).
- [ ] PROVIDER holds at least 0.02 GEN (gas only).
- [ ] `EVIDENCE-RECORD.md` copied to a working file you will fill in.
- [ ] Screen recorder ready if you want the video from the same run.

### Evidence set

Use the commit-pinned case-002 fixtures. They are public, immutable, already
return HTTP 200, and they produce a **settleable** outcome, so `release` works.
An `INSUFFICIENT_EVIDENCE` set would make `release` revert by design and the
pilot could not complete.

```
https://raw.githubusercontent.com/GIFTEDLOV/uptimebond/ad0018207edfba936b4074d3f1ccb5a2df58ac3b/evidence/case-002-partial-refund/sla-terms.json
https://raw.githubusercontent.com/GIFTEDLOV/uptimebond/ad0018207edfba936b4074d3f1ccb5a2df58ac3b/evidence/case-002-partial-refund/monitor-report.json
https://raw.githubusercontent.com/GIFTEDLOV/uptimebond/ad0018207edfba936b4074d3f1ccb5a2df58ac3b/evidence/case-002-partial-refund/provider-status.json
https://raw.githubusercontent.com/GIFTEDLOV/uptimebond/ad0018207edfba936b4074d3f1ccb5a2df58ac3b/evidence/case-002-partial-refund/maintenance-announcements.json
```

Expected ruling: `PARTIAL_REFUND`, 2500 bps — uptime 99.10% against a 99.50%
commitment, with a maintenance window announced only 2 hours ahead of a clause
requiring 24.

### Expected settlement at 0.01 GEN

| Field | Value |
|---|---|
| Escrow | 0.01 GEN (`10000000000000000` atto) |
| Outcome | `PARTIAL_REFUND` |
| Refund bps | 2500 |
| Customer receives | **0.0025 GEN** |
| Provider receives | **0.0075 GEN** |
| Contract balance after finalization | **0** |

Amounts are gross escrow transfers. Each signer also pays gas, so a party that
signed will see a slightly smaller net delta than the gross figure.

---

## Step 0 — Record the opening balances

Before anything is signed, record what both wallets and the (not yet existing)
contract hold. Do this from the wallet UI, the explorer, or `/diagnostics`.

- [ ] CUSTOMER balance before → record
- [ ] PROVIDER balance before → record
- [ ] Open https://uptimebond.vercel.app/diagnostics and confirm **JSON-RPC: ok**

---

## Step 1 — Customer creates and deploys

Browser: CUSTOMER wallet active.

1. Open **https://uptimebond.vercel.app**, click **Connect Wallet**, approve.
   Confirm the pill shows the CUSTOMER address and the dot is olive, not red.
   A red dot or a "wrong network" banner means the wallet is off Bradbury —
   click **Switch to GenLayer Bradbury Testnet** first.
2. Click **Create** in the nav.
3. **Step 1 · Parties** — paste the PROVIDER address into *Provider wallet
   address*. Labels are optional and stay in your browser only.
   The **Next** button stays disabled until the address is valid and differs
   from the connected customer.
4. **Step 2 · Service** — category `Website or API`. Period: something you can
   recognise later, e.g. `Pilot — <today's date>`.
5. **Step 3 · Evidence** — paste the four URLs above in order (SLA terms,
   Independent monitor, Provider status, Maintenance feed). Press **Test** on
   each and confirm `HTTP 200 · JSON`. No warning triangle should appear — these
   are commit-pinned.
6. **Step 4 · Settlement**
   - Escrow amount: **`0.01`** — confirm it reads *0.01 GEN held in escrow*.
   - Deadlock refund to customer: leave **50%**.
   - Dispute deadlock: leave **1** day. Insufficient-evidence deadlock: leave **1** day.
7. **Step 5 · Review** — check the provider address character by character and
   all four URLs. Tick the confirmation box.
8. **Step 6 · Deploy** — press **Deploy agreement**.

   **SIGN 1 — deploy.** Approve in the wallet.

9. Leave the tab open. The panel moves *submitted → awaiting validator consensus
   → consensus accepted → finalized*, then recovers and shows the contract
   address. **A hash is not success; wait for finalized.**
   - If you close the tab, reopen **Create** — it resumes tracking the same
     transaction rather than redeploying.

- [ ] Deploy finalized
- [ ] Contract address recorded
- [ ] Deploy transaction hash recorded

---

## Step 2 — Customer funds the escrow

Still CUSTOMER.

1. From the deploy panel press **Fund escrow →** (or open
   `/agreement/<address>`).
2. In the Actions card press **Fund escrow**. The confirmation dialog states
   *This is a payable transaction of 0.01 GEN plus gas*. Confirm that number.

   **SIGN 2 — fund (payable, 0.01 GEN).** Approve.

3. Wait for **finalized**.
4. Verify on the agreement page: **Escrow held 0.01 GEN**, status
   **Awaiting acceptance**.

- [ ] Fund finalized, hash recorded
- [ ] Contract balance reads 0.01 GEN

---

## Step 3 — Customer sends the invitation

1. Press **Invite provider**. Copy the link (or scan the QR from the provider's
   device).
2. Send it to whoever holds the PROVIDER wallet.

- [ ] Invitation link recorded

---

## Step 4 — Provider opens the invite and accepts

Browser: PROVIDER wallet active. Use a **separate browser profile or window** —
switching accounts inside one MetaMask instance mid-flow is the most common way
to sign from the wrong address.

1. Open the invitation link. The whole agreement is readable with no wallet.
2. Read the four evidence sources. These are what you are being held to and they
   cannot be changed.
3. **Connect Wallet** with the registered PROVIDER account.
   - Connecting any other account leaves acceptance disabled and shows
     *Connected wallet … is not the registered provider*. That gate is the
     contract's, not the UI's.
4. Scroll to the Actions card and press **Accept SLA**.

   **SIGN 3 — accept_sla.** Approve.

5. Wait for **finalized**. Status becomes **Active**.

- [ ] Accept finalized, hash recorded
- [ ] Status is ACTIVE

---

## Step 5 — Open the dispute

Either party may do this; the run sheet uses CUSTOMER so the provider only ever
signs once.

1. On `/agreement/<address>`, Actions card → **Open dispute**.
2. The confirmation dialog asks for an **Incident window**. It is required — the
   contract rejects a blank one — and confirmation stays disabled until you
   enter it. Use something you will recognise later, e.g.
   `Pilot — May 2026 uptime and maintenance-notice dispute`.

   **SIGN 4 — open_dispute.** Approve.

3. Wait for **finalized**. Status becomes **Disputed** and the window you typed
   appears in the Agreement card as *Incident*.

- [ ] Dispute finalized, hash recorded
- [ ] Incident window visible on the agreement page

---

## Step 6 — Submit the ruling

1. Actions card → **Run validator ruling**.

   **SIGN 5 — rule.** Approve.

2. This is the long one. Every validator independently re-fetches all four URLs
   and derives the outcome. Expect **~30 minutes** and possible retries under
   load.
3. On success the Ruling card shows `PARTIAL_REFUND`, customer refund 25%
   (2500 bps), maintenance qualified **No**, breached clause `SLA-1`, and the
   validator reasoning under the disclosure.

- [ ] Rule finalized, hash recorded
- [ ] Outcome recorded (expected `PARTIAL_REFUND` / 2500 bps)
- [ ] Any retries or validator timeouts recorded

**If the outcome is not `PARTIAL_REFUND`:** record what it actually was and stop
to compare against the evidence before releasing. A different outcome is a
finding worth reporting, not a failure to hide. If it is
`INSUFFICIENT_EVIDENCE`, `release` will revert by design — use the mutual
settlement path instead and note it.

---

## Step 7 — Release the settlement

1. Actions card → **Release settlement**. The dialog warns it is single-shot.

   **SIGN 6 — release.** Approve.

2. Wait for **finalized**. Payout transfers are EVM external messages that
   execute *at finalization* — the contract still holds the escrow until then,
   and the Settlement panel will say **Payout queued** in the meantime.

- [ ] Release finalized, hash recorded

---

## Step 8 — Verify balances and contract state

Do not accept the status as proof. Read the money.

1. On `/agreement/<address>`, the Settlement panel must show:
   - Outcome **Partial refund**
   - Customer receives **0.0025 GEN**, Provider receives **0.0075 GEN**
   - **Contract balance 0 GEN** — *fully distributed*
   - Badge **Payout finalized** (this is derived from the live balance, not from status)
2. Agreement status is **Resolved**.
3. Open the contract on the explorer from the page link and confirm the release
   transaction is finalized.
4. Record CUSTOMER and PROVIDER balances after. Deltas should be the gross
   payouts minus each party's own gas.
5. Optional: confirm `release` is single-shot — the action no longer appears.

- [ ] Contract balance is 0
- [ ] Payout finalized badge shown
- [ ] Customer delta ≈ +0.0025 GEN − gas
- [ ] Provider delta ≈ +0.0075 GEN − gas
- [ ] Release transaction finalized on the explorer
- [ ] Screenshots captured (see the record template)

---

## If something goes wrong

| Symptom | What it means | Do this |
|---|---|---|
| Wallet shows a hash but the app still says *submitted* | Normal. A hash is not success. | Wait. Consensus is a later, separate outcome. |
| *Awaiting validator consensus* for over ~45 min | Bradbury congestion | Keep waiting. Do **not** resubmit — the transaction may still commit. |
| *Consensus accepted · execution failed* | Consensus ran, contract reverted | No state changed. Read the error, fix the cause, retry the action. |
| *Outcome unknown* | Status could not be read | **Do not retry.** Check the contract state on the explorer first. |
| Submission rejected before any hash appears | Node backpressure (`l1_sender_commit`) | Nothing committed. Safe to retry the same action. |
| Tab closed mid-deploy | — | Reopen **Create**; it resumes tracking, it does not redeploy. |
| Tab closed mid-action | — | Reopen `/agreement/<address>`; the in-flight transaction resumes. |
| Provider "not the registered provider" | Wrong account connected | Switch accounts in the wallet; the contract enforces this. |

Record every retry and every failure in the evidence record. A pilot that hit
two retries and reported them is worth more than one that claims a clean run.

---

## Fixed before this run sheet was published — `open_dispute`

Recorded because it is exactly the class of failure this pilot exists to catch,
and because the fix is what makes step 5 executable.

`contracts/uptime_bond.py` declares `open_dispute(self, incident_window: str)`
and rejects an empty window:

```python
if not incident_window:
    raise gl.vm.UserError(f"{ERROR_INPUT} Incident window is required")
```

`lib/actions.ts` passed that argument only when `AgreementView` received an
`incidentWindow` prop — and no caller supplied one, so the browser submitted
`open_dispute` with **zero arguments** against a method requiring one. Because
the revert surfaces at consensus, the failure would have landed ~30 minutes
after the signature.

The four published demo cases were disputed through
`deploy/scripts/lifecycle.mjs`, which reads `incident_window` from `cases.json`,
so the UI path had never been exercised.

Fixed in `68a2aa9`: the confirmation dialog now collects the window, keeps
confirmation disabled until it is non-blank, and trims it before submission.
Covered by `src/components/AgreementView.test.tsx` and a unit test pinning the
argument contract in `availableActions`.
