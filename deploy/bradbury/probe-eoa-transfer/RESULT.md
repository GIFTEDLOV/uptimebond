# EOA transfer probe — Bradbury, 2026-07-21

**Verdict: the EVM external-message path transfers native GEN to an EOA. The
internal GenVM contract-message path does not.**

Probe contract: `0x743D6AcC9b72C98e5C9E51A49e4A2C9CdbD03D18`
Source: `contracts/probes/eoa_transfer_probe.py`
Funder / sender: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
Recipient EOA: `0x06BBFc5F5A06953fFDB117DB376302d6Bd80eBdc`

## Transactions

| Step | Tx | Consensus | Execution | Finalized |
|---|---|---|---|---|
| deploy | `0x640b134ef5789819707ce1a0def208b379de19c2a67972bf39bbf21d28d9556d` | ACCEPTED / AGREE (5/5) | FINISHED_WITH_RETURN | yes |
| load 0.01 GEN | `0x276213ff2941519c5d5779b7d7435b1b46b38f58615903f37ceaa6ccda35c75a` | ACCEPTED / AGREE (5/5) | FINISHED_WITH_RETURN | yes |
| pay 0.004 GEN | `0xfce0c51a17c482b18c742d6f284aa0661cc03f97be70fef646fd1413faaa679e` | ACCEPTED / AGREE (5/5) | FINISHED_WITH_RETURN | 1784673228 (22:34 UTC) |

## Balances

| Point | Sender | Recipient EOA | Probe contract |
|---|---|---|---|
| before deploy | 20.510756741161397044 | 1.999560430653096050 | — |
| after deploy | 20.510246451895962544 | 1.999560430653096050 | 0 |
| after load | 20.500119343545430044 | 1.999560430653096050 | 0.010000000000000000 |
| after pay **accepted** | 20.499994331929304844 | 1.999560430653096050 | 0.010000000000000000 |
| after pay **finalized** | 20.499994331929304844 | **2.003560430653096050** | **0.006000000000000000** |

Finalization delta: recipient `+4000000000000000` atto, probe `-4000000000000000`
atto. Exact, no leakage, no sender charge at finalization.

## The two facts that matter

**1. Acceptance proves nothing.** The `pay` transaction was ACCEPTED with
`FINISHED_WITH_RETURN` and 5/5 AGREE at 22:03, and the recipient balance was
still unchanged at 22:03. The value moved only at finalization, 31 minutes
later. Any check that reads a receipt and concludes "paid" is wrong by
construction.

**2. The wrong proxy is silently inert.** UptimeBond's `_settle` used
`gl.get_contract_at(eoa).emit_transfer(...)`. In the SDK these are different
operations:

| Call | gl_call op | Source |
|---|---|---|
| `gl.get_contract_at(a).emit_transfer(value=v, on=...)` | `PostMessage` — internal GenVM contract message | `genlayer/gl/genvm_contracts.py:192` |
| `_EoaRecipient(a).emit_transfer(value=v)` | `EthSend`, empty calldata — EVM value transfer | `genlayer/gl/_internal/eth.py:60` |

An EOA has no GenVM contract behind it, so `PostMessage` neither reverts nor
transfers. That is why four UptimeBond agreements reported successful,
finalized settlement while holding 100% of their escrow.

The EVM proxy's `emit_transfer` takes `value` only — it has **no `on`
parameter**. External-message default finalization applies, which the balances
above confirm is finalization-timed.

## Budget

0.01 GEN loaded (at cap). Fees: deploy 0.000510289265434500, load
0.000127108350532500, pay 0.000125011616125200 GEN.

0.006 GEN remains in the probe contract. It has no withdraw method, so that is
stranded by design — the probe was built to be minimal, not recoverable.
