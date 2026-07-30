# Incident — a finalized deployment that produced no contract

**Status:** **closed as no longer reproducing** — deployments resumed working on
2026-07-29 and a full pilot ran end to end on a freshly deployed contract. The
root cause was never explained. See [section 9](#9-closing-note--deployments-resumed-2026-07-29).
**Impact:** no funds at risk. Nothing was escrowed, nothing was lost.

> Sections 1–8 are the original investigation, recorded while the incident was
> open, and are left exactly as written. Nothing in them has been deleted or
> revised — a later success does not make the earlier evidence wrong, and the
> transaction that produced no contract is still on-chain and still produces no
> contract.

A contract deployment reached consensus, finalized with `FINISHED_WITH_RETURN`,
was agreed by 5 of 5 validators, and reported storage writes containing the
correct constructor state — and no contract exists at the address the receipt
named. It has never existed there.

Everything the client controls was compared, byte for byte, against a
deployment that worked. They are equivalent. What follows is the evidence.

---

## 1. Subjects

| | Browser deployment | Scripted control |
|---|---|---|
| GenLayer tx | `0x0c8e748c6268cd68c05adb583e060bbae0af35c19e97f48302c13c61dbd9648a` | `0x28215db5fd84ee69154ce6a368d8b6023cf1fb848f623e2e33139eae3bf6893c` |
| Reported address | `0xc09d70CE30BAd8ce8519C40Ef12C037B9cfBd99f` | `0x965C9B454867273F612BD48d181Ec418391750d5` |
| Finalized (UTC) | 2026-07-27 05:46 | 2026-07-22 04:49 |
| Sender | `0x456Ccff0d33463E1834F724C5C5971D6cff6f1dc` | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Rollup tx | `0xd8e5b644242793ee64c425b88e3197672de84c467ed8197158b600d09ec1e341` | `0x82f3fe6c6248d0d4f37adc0af1fe0843247fe04d5cfde8898a92046bc70733ed` |
| Contract exists | **no** | yes |

Both deployed the same contract source with the same eight constructor
arguments (differing only in the provider address, by design).

A second browser transaction,
`0x771ab1009b77fee8ee1d3e0422ec11045000af6f29d3b6b56123da0fe43d76b7` →
`0xAd26CB95F1FE2E91FeB6af9Afe45BA30f3e63b44`, also produced no contract, but
that one is **ours**: it finalized `FINISHED_WITH_ERROR` because the frontend
encoded the `provider` argument as a 42-character string instead of a 20-byte
Address. Fixed in `7d01f47`. It is not part of this incident except as context.

---

## 2. Envelope comparison

Decoded from the raw `txData` of both transactions and from the rollup EVM
transactions. `!!` marks a difference.

```
                              BROWSER (no contract)          CONTROL (works)
   GenLayer tx status         FINALIZED                      FINALIZED
   execution result           FINISHED_WITH_RETURN           FINISHED_WITH_RETURN
   consensus result           AGREE (5/5)                    AGREE (5/5)
   transaction_type           CONTRACT_DEPLOYMENT            CONTRACT_DEPLOYMENT
   value                      0                              0
   numOfInitialValidators     3                              3
   initialRotations           3                              3
   leaderOnly                 false                          false
   txSlot / queueType         0 / 0                          0 / 0

   raw txData bytes           34920                          34920
   rlp prefix bytes           6                              6
   contract source bytes      34266                          34266
   contract source sha256     93e1ddb9…                      93e1ddb9…
   calldata blob bytes        644                            644
   trailing byte (leaderOnly) 00                             00

   constructor arg count      8                              8
!!   arg[0] provider          Address[79dd8260…]             Address[06bbfc5f…]
     arg[1..4] evidence URLs  str(143/148/149/159)           str(143/148/149/159)
     arg[5] refund bps        int(5000)                      int(5000)
     arg[6] dispute deadlock  int(86400)                     int(86400)
     arg[7] IE deadlock       int(86400)                     int(86400)

   EVM to (consensus)         0x0112bf6e83497965a5fdd6…      0x0112bf6e83497965a5fdd6…
   EVM selector               0xe71d5196                     0xe71d5196
   EVM chainId                0x107d                         0x107d
   EVM value / type           0x0 / 0x0                      0x0 / 0x0
   EVM input length           70346                          70346
   EVM receipt status         0x1                            0x1
   EVM receipt logs           10                             10

!! sender                     0x456Ccff0…                    0xf39Fd6e5…
!! calldata sha256            6f14eadb…                      d3ba5c34…   (provider bytes differ)
!! EVM nonce                  0x45                           0x73
!! EVM gas / gasPrice         0x2864618 / 0x833c14e          0x1aebc03 / 0x9e836e6
!! EVM receipt gasUsed        0x18e0dd7                      0x18e205b
!! fee                        137609550                      166213350
```

Every difference is one that must differ: the two parties, the account nonce,
gas market conditions, and the derived addresses. The calldata hash differs
only because the 20 provider bytes inside it differ.

**Structure, size, encoding, target, selector and wire types are identical.**

### Constructor wire types

The `provider` argument is tagged as a GenVM `Address` — 20 raw bytes — in
**both** transactions. This was verified by decoding the calldata with the
SDK's own decoder and asserting `instanceof CalldataAddress`, which is what
`calldata.encode()` dispatches on.

| # | Argument | Declared | Browser wire | Control wire |
|---|---|---|---|---|
| 1 | `provider` | `Address` | `Address` (20 bytes) | `Address` (20 bytes) |
| 2 | `sla_terms_url` | `str` | `str(143)` | `str(143)` |
| 3 | `independent_monitor_url` | `str` | `str(148)` | `str(148)` |
| 4 | `provider_status_url` | `str` | `str(149)` | `str(149)` |
| 5 | `maintenance_announcements_url` | `str` | `str(159)` | `str(159)` |
| 6 | `deadlock_refund_bps` | `int` | `5000` | `5000` |
| 7 | `dispute_deadlock_seconds` | `int` | `86400` | `86400` |
| 8 | `insufficient_evidence_deadlock_seconds` | `int` | `86400` | `86400` |

### SDK

Both were produced by **genlayer-js 1.1.8**. Since `a93ad56` the browser bundle
and the Node scripts resolve one repository-local, lockfile-pinned install, and
CI asserts that the `CalldataAddress` class object is literally the same on both
sides. `initializeConsensusSmartContract()` was checked in the SDK source and is
**deprecated and a no-op** in 1.1.8 — *"the consensus contract is now resolved
from the static chain definition"* — so it is neither required nor a factor.

### Source representation

`string` versus `Uint8Array` was considered and ruled out. RLP draws no
distinction between the two: both serialise to the same byte string. This is
confirmed empirically, not assumed — both transactions carry the identical
34,920-byte `txData` with the identical source hash.

---

## 3. Execution trace comparison

`gen_dbg_traceTransaction` on both, via `[{ txId }]`.

| Field | Browser | Control |
|---|---|---|
| `result_code` | **0** | **0** |
| `stdout` | empty | empty |
| `stderr` | empty | empty |
| `run_time` | `0s` | `0s` |
| `eq_outputs` | `[]` | `[]` |
| `return_data` length | **72826 chars** | **72826 chars** |
| `storage_changes` offset | 1160 | 1160 |
| `kind=Return` offset | 1136 | 1136 |
| evidence URLs in storage | **4** | **4** |
| customer written | `0x456ccff0…` ✓ | `0xf39fd6e5…` ✓ |
| provider written | `0x79dd8260…` ✓ | `0x06bbfc5f…` ✓ |
| **`storage_proof`** | **`0x5f46d5bc108b1545560be2fa8c5d1a67a8913e98549b871fdafe0b680cc7a8f0`** | **`0x0000…0000`** |

The browser deployment **did execute and did produce storage changes.** Both
party addresses and all four evidence URLs are present in the recorded state
writes, in the same layout as the control.

`storage_proof` is the only substantive difference: non-zero on the transaction
that did not materialize, zero on the one that did. This is node-side state
commitment; nothing a client submits influences it.

---

## 4. Post-state — nothing is there

Queried repeatedly, most recently roughly three hours after finalization and
again during production verification days later.

| Probe | Browser address | Control |
|---|---|---|
| `gen_getContractCode` | **`contract code not found at address`** | 34,198 chars returned |
| `gen_call get_state` @ `latest-nonfinal` | **`contract not found at address`** | OK |
| `gen_call get_state` @ `latest-final` | **`contract not found at address`** | OK |
| Explorer `/api/v1/contracts/<addr>` | **HTTP 404** | present |
| Native balance | **0 atto** | 0 atto (settled) |
| Escrow | **none — no contract to hold one** | 0.1 GEN, settled |

Six consecutive probes over 30 seconds all failed. This is not indexing lag.

The explorer's transaction record simultaneously reports
`transaction_type: CONTRACT_DEPLOYMENT`, `to_address_type: CONTRACT`,
`execution_result: FINISHED_WITH_RETURN`, `status: finalized`, and
`deployed_contract_address: 0xc09d70CE30BAd8ce8519C40Ef12C037B9cfBd99f` — an
address its own contracts endpoint 404s.

**No funds were escrowed.** Deployment does not transfer value; the escrow is a
separate, later `fund()` call that was never made and cannot be made against a
contract that does not exist. Cost was gas only.

---

## 5. Timeline

| When (UTC) | How | Execution | Materialized |
|---|---|---|---|
| 2026-07-21 16:25 | script | `FINISHED_WITH_RETURN` | yes |
| 2026-07-21 16:30 | script | — | yes |
| 2026-07-21 16:33 | script | `FINISHED_WITH_RETURN` | yes |
| 2026-07-21 22:32 | script | `FINISHED_WITH_RETURN` | yes |
| 2026-07-22 04:49 | script | `FINISHED_WITH_RETURN` | yes ← control |
| 2026-07-22 20:26 | script | `FINISHED_WITH_RETURN` | yes |
| 2026-07-22 20:27 | script | `FINISHED_WITH_RETURN` | yes |
| 2026-07-23 16:11 | script | `FINISHED_WITH_RETURN` | yes |
| 2026-07-27 04:20 | browser | `FINISHED_WITH_ERROR` | no — our encoding bug, fixed |
| 2026-07-27 05:46 | browser | `FINISHED_WITH_RETURN` | **no — this incident** |

Eight scripted deployments over 21–23 July all materialized. Both browser
deployments on 27 July did not.

### Remaining uncertainty, stated plainly

That timeline confounds two variables: **client** (browser vs script) and
**time** (a four-day gap). The envelope and trace evidence excludes the client
— the artifacts are equivalent to the byte, and the transaction executed and
wrote storage. It does **not** by itself prove the chain changed.

Separating them cleanly needs one scripted deployment made today. That spends
GEN and would be a fresh deployment attempt, both of which are out of scope
under the current freeze. Until then this is an unexplained node-side
inconsistency with a strong client-side exoneration, not a proven chain
regression.

---

## 6. Source lineage — two byte-identical-in-logic sources

The frontend embeds `contracts/uptime_bond.py` with Vite's `?raw` import and
submits **exactly those bytes**. The file's line endings therefore decide the
deployed bytes.

| | Historical deployments | Canonical / future |
|---|---|---|
| Line endings | CRLF | LF |
| Size | **34,266 bytes** | **33,517 bytes** |
| SHA-256 | **`93e1ddb9d29c33fba65ac1ba9402d2a11454755faaf373b06e76a8fb906721a3`** | **`04fe3a7b0b47cab5bb997bce645228e7eea10a0564ac55971753beae40c4c49f`** |
| Used by | the four verified v2 agreements, both July 2026 browser deployments | everything from `bde38c9` onward |

Git stored the file with LF; a Windows checkout with `core.autocrlf=true`
materialised CRLF; `vercel --prod` uploaded that working copy. So every
deployment to date submitted the 34,266-byte CRLF variant — which is exactly
what the on-chain envelope decoding shows.

**The Python logic is equivalent. The submitted bytes are not.** Different bytes
mean a different transaction payload, a different transaction hash, and a
different derived contract address. Two builds of the same commit could deploy
two different contracts depending only on which machine produced the bundle.

Fixed in `bde38c9`: `.gitattributes` pins the contract source to LF, both copies
were normalised, and CI asserts the invariant — the two copies byte-identical,
no CRLF, and `CONTRACT_SOURCE_SHA256` matching the file the bundle ships.

The already-deployed contracts keep the CRLF hash. That is historical fact about
immutable contracts, not a mismatch to repair.

---

## 7. What changed in the product as a result

No functional change was made in response to this incident — the chain-side
cause is not ours to fix. What changed is that the application can no longer be
fooled by it:

- `verifyDeployment` runs **13 checks** and reads the contract back before
  calling anything deployed: finalized, `FINISHED_WITH_RETURN`, address from the
  receipt, contract code present, source SHA-256 match, `get_state` answers,
  customer, provider, all four evidence URLs, all three deadlock parameters,
  `AWAITING_FUNDING`, zero escrow, zero balance.
- A deployment that fails any check shows **"Deployment failed"** or
  **"Deployment not verified"** with the failing check named, and **Fund, Invite
  and Save are withheld**.
- A permanently failed deployment can be **archived**: retained for the audit
  trail, never auto-resumed, never silently redeployed.

Had these existed on 27 July, the user would have seen *"No contract exists at
this address"* instead of a Fund button.

---

## 8. Reproduction

All read-only. No signatures, no GEN.

```bash
# Receipt, envelope and constructor arguments
node -e "import('genlayer-js').then(async ({createClient,chains,decodeInputData})=>{
  const c=createClient({chain:chains.testnetBradbury});
  const tx=await c.getTransaction({hash:'0x0c8e748c6268cd68c05adb583e060bbae0af35c19e97f48302c13c61dbd9648a'});
  console.log(tx.statusName, tx.txExecutionResultName, tx.txDataDecoded.contractAddress);
  console.log(decodeInputData(tx.txData).constructorArgs.get('args'));
})"

# Execution trace
curl -s https://rpc-bradbury.genlayer.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"gen_dbg_traceTransaction","params":[{"txId":"0x0c8e748c6268cd68c05adb583e060bbae0af35c19e97f48302c13c61dbd9648a"}]}'

# The contract that is not there
curl -s https://rpc-bradbury.genlayer.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"gen_getContractCode","params":[{"address":"0xc09d70CE30BAd8ce8519C40Ef12C037B9cfBd99f"}]}'

curl -s https://explorer-bradbury.genlayer.com/api/v1/contracts/0xc09d70CE30BAd8ce8519C40Ef12C037B9cfBd99f
```

---

## 9. Closing note — deployments resumed (2026-07-29)

Bradbury deployments started materializing again. A replacement deployment
succeeded, the contract it named exists, and a complete two-wallet pilot was
driven through it to settlement.

| | |
|---|---|
| Replacement deployment tx | [`0x8a8befa0332b4c73ac2ab09fb655fe9f38e1569b00130c99129c7930dafbafcc`](https://explorer-bradbury.genlayer.com/tx/0x8a8befa0332b4c73ac2ab09fb655fe9f38e1569b00130c99129c7930dafbafcc) |
| Materialized contract | [`0x5006115944D7F593E401239aeDb64abEF13dCc0a`](https://explorer-bradbury.genlayer.com/address/0x5006115944D7F593E401239aeDb64abEF13dCc0a) |
| Created (UTC) | 2026-07-29 11:17:08 |
| Sender | `0x456Ccff0d33463E1834F724C5C5971D6cff6f1dc` — the same account as the failed browser deployment |
| Consensus / execution | FINALIZED / AGREE (5/5) · `FINISHED_WITH_RETURN` |
| Contract code present | **yes** — 33,517 bytes, SHA-256 `04fe3a7b0b47cab5bb997bce645228e7eea10a0564ac55971753beae40c4c49f` |
| Subsequent lifecycle | funded, accepted, disputed, ruled `PARTIAL_REFUND`, released, balance zero |

The distinguishing check is the one section 4 applies to the failed address:
`gen_getContractCode` returns the source, `get_state` answers at both
`latest-final` and `latest-nonfinal`, and the explorer's contracts endpoint has
the record. All of it, repeatedly, days later — and through the full lifecycle,
which is a far stronger proof of materialization than a single read: a contract
that does not exist cannot hold an escrow, rule on evidence, or pay it out.

Full pilot record: [`../pilot/runs/2026-07-29-pilot.md`](../pilot/runs/2026-07-29-pilot.md).

### What this does and does not establish

**It closes the blocker.** Fresh self-service deployment works. The freeze on
deployments is lifted, and the two-wallet pilot that could not run is done.

**It does not explain the failure.** No cause was ever identified, and none of
the evidence in sections 1–8 is retracted. Transaction
`0x0c8e748c…` remains finalized, 5/5 agreed, with recorded storage writes and a
non-zero `storage_proof`, and `0xc09d70CE…` remains an address with no contract
at it. That is still true today and still unexplained.

The uncertainty stated in section 5 — client versus time, confounded — resolves
toward **time**. The replacement was sent from the same account, against the
same chain, with the same pinned SDK, and it materialized. The client-side
exoneration in sections 2 and 3 is therefore no longer carrying the argument
alone. Whatever changed was node-side, and it changed without an announcement we
saw.

**One deliberate difference is recorded for completeness**, and it is a
consequence of `bde38c9`, not a candidate cause: this deployment submitted the
**LF-canonical 33,517-byte source (`04fe3a7b…`)**, where the failed one submitted
the **CRLF 34,266-byte variant (`93e1ddb9…`)**. Different bytes mean a different
payload, hash and derived address. Nothing suggests line endings had anything to
do with materialization — the eight scripted deployments that *worked* in July
also carried the CRLF variant, which rules it out as the discriminator.

**Recommendation unchanged:** verify a deployment by reading the contract back
before treating it as real. `verifyDeployment`'s 13 checks (section 7) are what
make the difference between these two transactions visible to a user in seconds
rather than after an escrow has been sent.
