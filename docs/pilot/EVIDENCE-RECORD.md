# Live pilot evidence record

Copy this file to `docs/pilot/runs/<YYYY-MM-DD>-pilot.md` and fill it in as the
run proceeds — not afterwards from memory. Every `__________` is a blank.

Record what actually happened, including retries and failures. A run that hit
two node retries and says so is stronger evidence than one that claims to have
been clean.

---

## 1. Run header

| Field | Value |
|---|---|
| Run date (UTC) | __________ |
| Operator | __________ |
| App URL / build | https://uptimebond.vercel.app · build `__________` (from `/diagnostics`) |
| Network | GenLayer Bradbury Testnet, chain 4221 |
| Contract source commit | `6e29b67` (fixed payout path) |
| Evidence commit | `ad0018207edfba936b4074d3f1ccb5a2df58ac3b` |
| Evidence set | `evidence/case-002-partial-refund` |
| Escrow | 0.01 GEN (`10000000000000000` atto) |
| Expected outcome | `PARTIAL_REFUND` · 2500 bps |

## 2. Parties

| Role | Address | Wallet |
|---|---|---|
| Customer | `0x__________` | __________ |
| Provider | `0x__________` | __________ |

## 3. Contract

| Field | Value |
|---|---|
| **Contract address** | `0x__________` |
| Explorer | https://explorer-bradbury.genlayer.com/address/`__________` |
| Invitation link | https://uptimebond.vercel.app/invite/`__________` |
| Incident window used | `__________` |

## 4. Transaction hashes

One row per signed transaction. "Finalized at" is when the app reported
**finalized**, not when the wallet returned the hash.

| # | Method | Signer | Hash | Submitted (UTC) | Finalized (UTC) | Elapsed | Consensus | Execution |
|---|---|---|---|---|---|---|---|---|
| 1 | `deploy` | customer | `0x__________` | ______ | ______ | ______ | __________ | __________ |
| 2 | `fund` (payable 0.01) | customer | `0x__________` | ______ | ______ | ______ | __________ | __________ |
| 3 | `accept_sla` | provider | `0x__________` | ______ | ______ | ______ | __________ | __________ |
| 4 | `open_dispute` | __________ | `0x__________` | ______ | ______ | ______ | __________ | __________ |
| 5 | `rule` | __________ | `0x__________` | ______ | ______ | ______ | __________ | __________ |
| 6 | `release` | __________ | `0x__________` | ______ | ______ | ______ | __________ | __________ |

Explorer link pattern: `https://explorer-bradbury.genlayer.com/tx/<hash>`

## 5. Balances

All values in GEN. **Before** = before transaction 1. **After** = after
transaction 6 finalized.

| Account | Before | After | Delta | Expected gross delta |
|---|---|---|---|---|
| Customer | ______ | ______ | ______ | **+0.0025** − gas for 4 tx |
| Provider | ______ | ______ | ______ | **+0.0075** − gas for 1 tx |
| Contract | **0** (not yet deployed) | ______ | ______ | **0** |

Intermediate contract balance checkpoints:

| Moment | Contract balance | Expected |
|---|---|---|
| After deploy finalized | ______ | 0 |
| After fund finalized | ______ | **0.01** |
| After accept finalized | ______ | 0.01 |
| After rule finalized | ______ | 0.01 (ruling moves no value) |
| After release **accepted**, before finalization | ______ | 0.01 (transfers execute at finalization) |
| After release **finalized** | ______ | **0** |

> The row that matters is the last one. `FINISHED_WITH_RETURN` proves contract
> code ran, not that value moved — only the balance reaching zero proves the
> payout. This is the exact failure the pre-`6e29b67` payout path had.

## 6. Validator outcome

| Field | Observed | Expected |
|---|---|---|
| Outcome | `__________` | `PARTIAL_REFUND` |
| Refund bps | ______ | 2500 |
| Customer share | ______ % | 25% |
| Provider share | ______ % | 75% |
| Maintenance qualified | ______ | No — downtime counts in full |
| Breached clauses | `__________` | `SLA-1` |
| Final status | `__________` | `RESOLVED` |
| `payout_complete` | ______ | `true` |
| Settlement badge shown | `__________` | **Payout finalized** |

Validator reasoning (paste the text from the Ruling disclosure — explanatory
only; consensus is over the decision fields, never this prose):

```
__________
```

**If the outcome differed from expected**, record why you think so — which
source, which clause, what the monitor reported:

```
__________
```

## 7. Network retries and failures

One row per retry, revert, timeout, or anything that needed a second attempt.
Leave the table empty only if nothing happened.

| # | Step | What happened | Hash issued? | Resolution | Time lost |
|---|---|---|---|---|---|
| 1 | ______ | ______ | yes / no | ______ | ______ |
| 2 | ______ | ______ | yes / no | ______ | ______ |

Classification guide:

| Observed | Committed? | Safe to retry? |
|---|---|---|
| Rejected before a hash was issued (`l1_sender_commit` backpressure) | No | Yes |
| Hash issued, consensus pending a long time | Unknown | **No** — wait or verify on-chain first |
| Consensus accepted, execution `FINISHED_WITH_ERROR` | No state change | Yes, after fixing the cause |
| Consensus `canceled` / `validators_timeout` / `undetermined` | No | Yes |
| App reported *Outcome unknown* | Unknown | **No** — verify on the explorer first |

Totals: **______ retries**, **______ failures**, **______ minutes lost**.

## 8. Screenshots

Save to `docs/pilot/runs/<date>/` and link them here. Redact nothing — these are
testnet addresses.

| # | File | Shows |
|---|---|---|
| 1 | `01-review.png` | Create wizard step 5, review screen with provider address and four evidence URLs |
| 2 | `02-deploy-finalized.png` | Deploy panel at **finalized**, contract address recovered |
| 3 | `03-funded.png` | Agreement page: escrow held 0.01 GEN, status awaiting acceptance |
| 4 | `04-invite.png` | Invitation page with link and QR |
| 5 | `05-provider-accept.png` | Provider view, registered wallet connected, Accept SLA available |
| 6 | `06-active.png` | Status **Active** after acceptance |
| 7 | `07-disputed.png` | Status **Disputed** with the incident window shown |
| 8 | `08-ruling.png` | Ruling card: outcome, bps, breached clause, validator reasoning open |
| 9 | `09-settlement.png` | Settlement panel: 0.0025 / 0.0075 / balance 0, **Payout finalized** |
| 10 | `10-explorer.png` | Explorer showing the release transaction finalized |
| 11 | `11-balances.png` | Both wallet balances after |

## 9. Sign-off

- [ ] All six transactions finalized
- [ ] Contract balance is 0
- [ ] Both party deltas reconcile with the expected gross payouts, net of gas
- [ ] Settlement panel reports **Payout finalized**
- [ ] Every retry and failure recorded in section 7
- [ ] All screenshots captured
- [ ] `SUBMISSION.md` pilot placeholders replaced with the values above

| | |
|---|---|
| Completed (UTC) | __________ |
| Total wall-clock | __________ |
| Verdict | pass / pass-with-findings / fail |
| Findings | __________ |
