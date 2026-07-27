# Demo video script — 2:45

Shot-by-shot narration for the submission video. Timings are cumulative.
Written to be read aloud at a normal pace; each block is roughly the words that
fit its slot.

**Record at 1440×900.** Testnet accounts only. Pre-fund both wallets so no
faucet wait is on camera. Do not show a seed phrase, a private key, or a wallet
unlock screen at any point.

---

## 0:00–0:18 · The problem

**Screen:** `uptimebond.vercel.app` homepage. Hero fills the frame. Hold still
for two seconds before scrolling — let the headline read.

> When a service misses its uptime commitment, who decides whether you get
> your money back? Today it's whoever holds the funds and the logs — usually
> the provider. UptimeBond is escrow that settles that dispute itself.

---

## 0:18–0:35 · What it does

**Screen:** slow scroll to the trust section, then the four evidence sources.

> The customer's payment sits in escrow against the provider's SLA. Four public
> evidence sources are pinned when the agreement is created — the SLA terms, an
> independent monitor, the provider's status page, and its maintenance notices.
> Nobody can change them once a dispute exists.

---

## 0:35–0:55 · The zoom — adjudication

**Screen:** keep scrolling through the contained-frame-to-full-bleed transition
into the adjudication view. Let it play at reading speed; don't rush the scroll.

> When there's a dispute, it doesn't come to us. Every GenLayer validator
> retrieves all four sources itself and derives the outcome independently.
> Consensus is over the decision — never over anyone's wording.

---

## 0:55–1:12 · Why the money is safe

**Screen:** the settlement section, four outcome cards.

> Validators agree on a label. The contract maps that label to a payout it was
> given at deployment. That separation is the whole security property: evidence
> can change what's argued, never what's paid. So a prompt injection hidden in
> an untrusted status page cannot move the escrow.

---

## 1:12–1:50 · Proof on-chain

**Screen:** `/demo`. Land on **Case 002 — Partial refund**. Zoom the Settlement
panel so the figures are legible.

> Four agreements, one per outcome, each driven to settlement on Bradbury.
> This one ruled partial refund — the maintenance window was announced two hours
> ahead against a clause requiring twenty-four, so its downtime counts and
> uptime lands at 99.10%.
>
> Customer 0.025 GEN, provider 0.075, and — the number that matters — contract
> balance zero. Every figure is read live from the contract right now. We don't
> report a payout from status; we read the balance, because code finishing
> successfully doesn't prove value moved.

**Screen:** click to **Case 004 — Insufficient evidence**.

> And when the evidence can't support a ruling, nothing is paid. Release reverts
> by design and the escrow stays custodied.

---

## 1:50–2:20 · The real workflow

**Screen:** `/create`. Move through the wizard at a steady clip.

> This is the actual product, not a mockup. Provider address, the four evidence
> URLs — tested live in the browser before you commit to them — the escrow, the
> settlement terms, and a review that says plainly what becomes immutable.

**Screen:** the invite page with the QR.

> The provider opens an invitation link, reads exactly what they're being held
> to, and accepts. Only the registered provider wallet can — and that gate is
> the contract's, not the interface's.

---

## 2:20–2:45 · Why GenLayer

**Screen:** back to the dark adjudication section, or a still architecture frame.

> No conventional smart contract can read a JSON monitor report and reason about
> a maintenance-notice clause inside consensus. That's why this is built on
> GenLayer: web access and AI reasoning are part of consensus itself, every
> validator re-derives the ruling, and the same system that decides also
> custodies and settles the funds.
>
> Escrow that settles service disputes. Live on Bradbury today.

**End card:** `uptimebond.vercel.app` · `github.com/GIFTEDLOV/uptimebond`

---

## Production notes

- **Total: 2:45.** If you need to reach 2:00, cut 0:18–0:35 and shorten the
  create walkthrough — keep the zoom and keep the live balance read.
- **Respect the scroll.** The frame-to-full-bleed transition is scroll-driven;
  scroll at reading pace or it reads as a glitch. Do not record it with
  smooth-scrolling browser extensions active.
- **Don't fake a settlement.** If you want a live `release` on camera, pre-stage
  an agreement at `RULED` and record only the release, the finalization, and the
  balance verification — that is roughly 30 minutes of real time, so cut to the
  finalized state rather than editing the wait to look instant.
- **If the pilot ran**, swap the 1:12–1:50 block to the fresh pilot contract
  instead of case 002 and say the date. A settlement recorded this week beats a
  bundled demo.
- **Read the balance out loud.** It is the single most persuasive number in the
  video and the one most demos skip.
