# GenLayer support report — paste-ready

Copy from the rule below. Full evidence:
[`BRADBURY-MATERIALIZATION-INCIDENT.md`](BRADBURY-MATERIALIZATION-INCIDENT.md).

---

**Bradbury: a deployment finalized `FINISHED_WITH_RETURN` with 5/5 AGREE and produced no contract**

Hi — we have a contract deployment on Bradbury that reached consensus, finalized
successfully, and left nothing at the address the receipt names. Before raising
it I compared it end to end against one of our own deployments that worked, and
I can't find a client-side difference. Hoping someone can tell me what I'm
missing or whether this is known.

**Transactions**

- Failed to materialize: `0x0c8e748c6268cd68c05adb583e060bbae0af35c19e97f48302c13c61dbd9648a`
  - reported address `0xc09d70CE30BAd8ce8519C40Ef12C037B9cfBd99f`
  - finalized 2026-07-27 05:46 UTC, sender `0x456Ccff0d33463E1834F724C5C5971D6cff6f1dc`
- Working control: `0x28215db5fd84ee69154ce6a368d8b6023cf1fb848f623e2e33139eae3bf6893c`
  - address `0x965C9B454867273F612BD48d181Ec418391750d5`, finalized 2026-07-22 04:49 UTC

Same contract source, same eight constructor arguments (only the provider
address differs), genlayer-js **1.1.8** on both.

**What the receipt says**

`status FINALIZED` · `execution FINISHED_WITH_RETURN` · `result AGREE`, 5 of 5
validators · `transaction_type CONTRACT_DEPLOYMENT` · `to_address_type CONTRACT`
· `deployed_contract_address 0xc09d70CE…` · EVM receipt `status 0x1`, 10 logs.

`gen_dbg_traceTransaction` returns `result_code 0`, empty `stdout`/`stderr`,
and a `return_data` byte-for-byte the same length as the control (72,826 chars)
with `storage_changes` at the same offset — **including the correct customer and
provider addresses and all four evidence URLs written into storage.**

**What the chain says**

- `gen_getContractCode` → `contract code not found at address`
- `gen_call get_state` → `contract not found at address`, at **both**
  `latest-nonfinal` and `latest-final`
- explorer `/api/v1/contracts/0xc09d70CE…` → **404**
- balance 0, no escrow (deployment moves no value, so nothing was at risk)

Six probes over 30 seconds, ~3 hours after finalization, and again days later.
Not indexing lag. The control answers all of these normally.

**Envelope comparison — everything the client controls is identical**

Both transactions: raw `txData` **34,920 bytes**, 6-byte RLP prefix, contract
source **34,266 bytes / sha256 `93e1ddb9…`**, calldata blob **644 bytes**,
`leaderOnly` false, 8 constructor args with `arg[0]` tagged as a GenVM
**`Address`** (20 raw bytes) in both, EVM target `0x0112bf6e83497965a5fdd6dad1e447a6e004271d`,
selector `0xe71d5196`, chainId `0x107d`, value 0, type `0x0`, input length
**70,346**, `numOfInitialValidators` 3, `initialRotations` 3.

The only differences are the ones that must differ: sender, the 20 provider
bytes inside the calldata, account nonce, gas/fee, and the derived addresses.

**The one substantive difference we found**

```
storage_proof   failed : 0x5f46d5bc108b1545560be2fa8c5d1a67a8913e98549b871fdafe0b680cc7a8f0
                control: 0x0000000000000000000000000000000000000000000000000000000000000000
```

Non-zero on the deployment that did not materialize, zero on the one that did.

**Timeline**

Eight scripted deployments 21–23 July 2026 all materialized. Two browser
deployments on 27 July did not. (The first of those two,
`0x771ab100…`, was our own bug — we encoded `provider` as a string instead of
an Address and it finalized `FINISHED_WITH_ERROR`. Fixed. The one above is
different: correct encoding, successful execution, no contract.)

We're aware the timeline confounds client with a four-day gap. We can't separate
them without making another deployment, which we've frozen pending an answer.

**Questions**

1. Is a **non-zero `storage_proof`** on a successful deployment expected, or does
   it indicate the state write was staged but not committed?
2. How can a transaction be `FINISHED_WITH_RETURN` with populated
   `storage_changes` and still materialize **no contract**? Is there a commit
   step after consensus that can fail silently?
3. Was there a **Bradbury state or deployment change between 23 and 27 July
   2026** — node upgrade, state-commitment change, storage-proof rollout,
   migration?
4. Can the missing contract be **repaired, replayed or recovered** from the
   finalized transaction, or is that address permanently dead?
5. **Is another deployment currently safe**, or will it hit the same thing? We
   have frozen deployments until we know.
6. Which **validator or node logs** would help? We can supply anything on the
   client side. Round leader was `0x0c526A6af46A038E31dA21C123756Ab2D75f06Bc`,
   activator `0xB7551beF37a05995218f9a1BB7A93e5B6705f535`, epoch 109, starting
   block 15717119, rollup tx `0xd8e5b644242793ee64c425b88e3197672de84c467ed8197158b600d09ec1e341`.

**Reproduce**

```bash
curl -s https://rpc-bradbury.genlayer.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"gen_dbg_traceTransaction","params":[{"txId":"0x0c8e748c6268cd68c05adb583e060bbae0af35c19e97f48302c13c61dbd9648a"}]}'

curl -s https://rpc-bradbury.genlayer.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"gen_getContractCode","params":[{"address":"0xc09d70CE30BAd8ce8519C40Ef12C037B9cfBd99f"}]}'
```

Repo: https://github.com/GIFTEDLOV/uptimebond — full write-up at
`docs/incidents/BRADBURY-MATERIALIZATION-INCIDENT.md`, frozen at tag
`v1.0.0-bradbury`. Happy to run any diagnostic. Thanks.
