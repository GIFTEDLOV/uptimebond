#!/usr/bin/env node
/**
 * gl.mjs — Bradbury transaction driver for UptimeBond.
 *
 * Exists because the GenLayer CLI (0.39.1 and 0.39.2) hardcodes `value: 0n` in
 * its write action and exposes no --value flag, so it cannot call a payable
 * method. UptimeBond.fund() is payable, so the whole lifecycle is unreachable
 * through the CLI. genlayer-js supports value; this wraps it.
 *
 * Key handling: the signing key is read from the same OS keychain the CLI
 * populates (`genlayer account unlock`), held only in memory, and passed
 * straight to the SDK signer. It is never printed, written to disk, or placed
 * in any record file. Nothing here accepts a key as an argument.
 *
 * Receipt handling: consensus result and execution result are reported
 * separately. A transaction whose consensus ACCEPTED but whose execution was
 * FINISHED_WITH_ERROR is a FAILURE and exits non-zero — that distinction is
 * the whole point of inspecting receipts here.
 *
 * Usage:
 *   node gl.mjs read    --contract 0x.. --method get_state [--args ...]
 *   node gl.mjs write   --account NAME --contract 0x.. --method fund
 *                       [--args ...] [--value <wei>] [--out FILE] [--force]
 *   node gl.mjs deploy  --account NAME --code PATH [--args ...] [--out FILE]
 *   node gl.mjs receipt --tx 0x.. [--out FILE]
 *   node gl.mjs balance --account NAME
 *
 * Exit codes: 0 ok · 1 execution error · 2 consensus/other tx failure
 *             3 usage error · 4 refused (would duplicate a committed write)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const GLM = 'file:///C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/node_modules';
const { default: keytar } = await import(`${GLM}/keytar/lib/keytar.js`);
const gljs = await import(`${GLM}/genlayer-js/dist/index.js`);
const { createClient, createAccount, chains, calldata } = gljs;

const CHAIN = chains.testnetBradbury;
const EXPECTED_CHAIN_ID = 4221;
const KEYCHAIN_SERVICE = 'genlayer-cli';
const EXPLORER = 'https://explorer-bradbury.genlayer.com';

// ---------------------------------------------------------------- arg parsing
// Mirrors the CLI's coerceValue/parseScalar so an argument encodes identically
// here and there. In particular a bare 40-hex 0x string becomes an address,
// which is what makes `provider` arrive as an Address in the constructor.
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ADDR_PREFIX_RE = /^addr#([0-9a-fA-F]{40})$/;
const BYTES_PREFIX_RE = /^b#([0-9a-fA-F]*)$/;
const HEX_RE = /^0x[0-9a-fA-F]+$/;

function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return b;
}

// CalldataAddress is what the SDK encodes as the address type. Newer
// genlayer-js builds stopped re-exporting it from the package entrypoint and
// from `calldata`, so fall back to the chunk that still exports it. Resolved
// once at load: an address-typed constructor argument must encode as an
// address, or the contract receives a plain string and the deployment is
// silently wrong (this is exactly the class of bug ad00182 fixed).
const ADDRESS_CLASS = await (async () => {
  const direct = gljs.CalldataAddress ?? gljs.abi?.calldata?.CalldataAddress ?? calldata?.CalldataAddress;
  if (direct) return direct;
  const { readdirSync } = await import('node:fs');
  const dir = new URL(`${GLM}/genlayer-js/dist/`);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const m = await import(new URL(f, dir).href).catch(() => null);
    if (m?.CalldataAddress) return m.CalldataAddress;
  }
  return null;
})();

function mkAddress(bytes) {
  if (!ADDRESS_CLASS) throw new Error('CalldataAddress not found in genlayer-js');
  return new ADDRESS_CLASS(bytes);
}

function parseScalar(v) {
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  const m = v.match(ADDR_PREFIX_RE);
  if (m) return mkAddress(hexToBytes(m[1]));
  if (ADDRESS_RE.test(v)) return mkAddress(hexToBytes(v.slice(2)));
  const b = v.match(BYTES_PREFIX_RE);
  if (b) return hexToBytes(b[1]);
  if (HEX_RE.test(v)) return BigInt(v);
  if (!isNaN(Number(v)) && Number.isSafeInteger(Number(v))) return Number(v);
  if (!isNaN(Number(v))) return BigInt(v);
  return v;
}

function coerce(v) {
  if (v === null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isSafeInteger(v) ? v : BigInt(v);
  if (Array.isArray(v)) return v.map(coerce);
  if (typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = coerce(val);
    return o;
  }
  if (typeof v === 'string') return parseScalar(v);
  return v;
}

function parseArg(raw) {
  try {
    const p = JSON.parse(raw);
    if (typeof p === 'object' || Array.isArray(p)) return coerce(p);
  } catch { /* fall through to scalar */ }
  return parseScalar(raw);
}

function parseArgv(argv) {
  const out = { _: [], args: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--args') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out.args.push(parseArg(argv[++i]));
    } else if (a.startsWith('--')) {
      const k = a.slice(2);
      out[k] = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
    } else out._.push(a);
  }
  return out;
}

// ------------------------------------------------------------------- signing
async function signer(name) {
  if (!name) fail(3, 'missing --account');
  const key = await keytar.getPassword(KEYCHAIN_SERVICE, `account:${name}`);
  if (!key) {
    fail(3,
      `account '${name}' is locked (no cached key).\n` +
      `  Unlock it yourself with:  genlayer account unlock --account ${name}\n` +
      `  This tool never accepts, prompts for, or stores a password or key.`);
  }
  return createAccount(key); // in memory only; never logged
}

function fail(code, msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

// ------------------------------------------------------------------ receipts
function classify(r) {
  const consensus = r?.status_name ?? r?.statusName ?? String(r?.status ?? 'UNKNOWN');
  const vote = r?.result_name ?? r?.resultName ?? String(r?.result ?? 'UNKNOWN');
  const exec = r?.tx_execution_result_name ?? r?.txExecutionResultName ?? 'UNKNOWN';
  const round = r?.last_round ?? r?.lastRound ?? {};
  const votes = round?.validatorVotesName ?? round?.validator_votes_name ?? [];
  const tally = votes.reduce((m, v) => ({ ...m, [v]: (m[v] ?? 0) + 1 }), {});
  // Consensus ACCEPTED with a failed execution is still a failure.
  const ok = (consensus === 'FINALIZED' || consensus === 'ACCEPTED')
          && vote === 'AGREE'
          && (exec === 'FINISHED_WITH_RETURN' || exec === 'FINISHED_WITH_NO_RETURN');
  return {
    ok, consensus_status: consensus, consensus_result: vote, execution_result: exec,
    validator_votes: votes, validator_tally: tally,
    validators: round?.roundValidators ?? round?.round_validators ?? [],
    leader_index: round?.leaderIndex ?? round?.leader_index ?? null,
    votes_committed: round?.votesCommitted ?? null,
    votes_revealed: round?.votesRevealed ?? null,
  };
}

function jsonSafe(v) {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = jsonSafe(x);
    return o;
  }
  return v;
}

function save(file, obj) {
  if (!file || file === true) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(jsonSafe(obj), null, 2) + '\n');
  console.log(`saved: ${file}`);
}

function report(label, hash, cls) {
  console.log(`\n${label}`);
  console.log(`  tx            : ${hash}`);
  console.log(`  explorer      : ${EXPLORER}/tx/${hash}`);
  console.log(`  consensus     : ${cls.consensus_status} / ${cls.consensus_result}`);
  console.log(`  execution     : ${cls.execution_result}`);
  console.log(`  validators    : ${JSON.stringify(cls.validator_tally)} (${cls.validator_votes.length} votes)`);
  console.log(`  VERDICT       : ${cls.ok ? 'SUCCESS' : 'FAILURE'}`);
}

async function client(account) {
  const c = createClient(account ? { chain: CHAIN, account } : { chain: CHAIN });
  if (Number(CHAIN.id) !== EXPECTED_CHAIN_ID) {
    fail(3, `wrong chain: expected ${EXPECTED_CHAIN_ID}, got ${CHAIN.id}`);
  }
  return c;
}

// Default to ACCEPTED, not FINALIZED. Bradbury reaches ACCEPTED in well under a
// minute but can take far longer to FINALIZE, and blocking on finality for every
// intermediate step burns the clock without adding safety. Finality is required
// only before settlement — pass --status FINALIZED there.
async function awaitReceipt(c, hash, opts = {}) {
  return c.waitForTransactionReceipt({
    hash,
    status: opts.status ?? 'ACCEPTED',
    retries: Number(opts.retries ?? 120),
    interval: Number(opts.interval ?? 5000),
  });
}

// Persist the hash the instant it exists, before any waiting. A receipt wait
// that times out must never lose the hash of a transaction that may have
// committed — recovering it afterwards is far harder than writing it here.
function saveSubmitted(file, payload) {
  if (!file || file === true) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(jsonSafe({
    ...payload, stage: 'SUBMITTED_AWAITING_RECEIPT',
    warning: 'Receipt not yet observed. State may or may not be committed. '
           + 'Verify on-chain state before any retry.',
  }), null, 2) + '\n');
  console.log(`saved (submitted): ${file}`);
}

// Refuse to resend a write whose record shows it already committed.
function guardDuplicate(o) {
  if (!o.out || o.out === true || o.force) return;
  if (!existsSync(o.out)) return;
  try {
    const prev = JSON.parse(readFileSync(o.out, 'utf8'));
    if (prev?.tx && prev?.classification?.ok) {
      console.error(`REFUSED: ${o.out} already records a committed transaction.`);
      console.error(`  tx: ${prev.tx}`);
      console.error(`  Re-running could double-write state. Pass --force only if the`);
      console.error(`  receipt proves no state was committed.`);
      process.exit(4);
    }
  } catch { /* unreadable record: fall through and proceed */ }
}

// ---------------------------------------------------------------------- main
const [cmd, ...rest] = process.argv.slice(2);
const o = parseArgv(rest);

try {
  if (cmd === 'read') {
    const c = await client();
    const res = await c.readContract({
      address: o.contract, functionName: o.method, args: o.args, jsonSafeReturn: true,
    });
    console.log(JSON.stringify(jsonSafe(res), null, 2));
    save(o.out, { contract: o.contract, method: o.method, result: res, read_at: new Date().toISOString() });

  } else if (cmd === 'write') {
    guardDuplicate(o);
    const acct = await signer(o.account);
    const c = await client(acct);
    const value = o.value ? BigInt(o.value) : 0n;
    console.log(`write ${o.method} on ${o.contract}`);
    console.log(`  signer : ${o.account} (${acct.address})`);
    console.log(`  value  : ${value} wei`);
    const hash = await c.writeContract({
      address: o.contract, functionName: o.method, args: o.args, value,
    });
    console.log(`  hash   : ${hash}`);
    saveSubmitted(o.out, { action: 'write', method: o.method, contract: o.contract,
      signer_account: o.account, signer_address: acct.address,
      value_wei: value.toString(), tx: hash, explorer: `${EXPLORER}/tx/${hash}`,
      submitted_at: new Date().toISOString() });
    const r = await awaitReceipt(c, hash, o);
    const cls = classify(r);
    report(`WRITE ${o.method}`, hash, cls);
    save(o.out, {
      action: 'write', method: o.method, contract: o.contract, signer_account: o.account,
      signer_address: acct.address, value_wei: value.toString(), tx: hash,
      explorer: `${EXPLORER}/tx/${hash}`, classification: cls,
      submitted_at: new Date().toISOString(), receipt: r,
    });
    if (!cls.ok) process.exit(cls.execution_result?.includes('ERROR') ? 1 : 2);

  } else if (cmd === 'deploy') {
    guardDuplicate(o);
    const acct = await signer(o.account);
    const c = await client(acct);
    const code = readFileSync(o.code);
    console.log(`deploy ${o.code} (${code.length} bytes)`);
    console.log(`  signer : ${o.account} (${acct.address})`);
    const hash = await c.deployContract({ code, args: o.args });
    console.log(`  hash   : ${hash}`);
    saveSubmitted(o.out, { action: 'deploy', code_path: o.code,
      signer_account: o.account, signer_address: acct.address, tx: hash,
      explorer: `${EXPLORER}/tx/${hash}`, submitted_at: new Date().toISOString() });
    const r = await awaitReceipt(c, hash, o);
    const cls = classify(r);
    const addr = r?.tx_data_decoded?.contract_address
              ?? r?.data?.contract_address ?? r?.recipient ?? null;
    report(`DEPLOY`, hash, cls);
    console.log(`  contract      : ${addr}`);
    save(o.out, {
      action: 'deploy', code_path: o.code, signer_account: o.account,
      signer_address: acct.address, tx: hash, contract_address: addr,
      explorer: `${EXPLORER}/tx/${hash}`, classification: cls,
      submitted_at: new Date().toISOString(), receipt: r,
    });
    if (!cls.ok) process.exit(cls.execution_result?.includes('ERROR') ? 1 : 2);

  } else if (cmd === 'receipt') {
    const c = await client();
    const r = await awaitReceipt(c, o.tx, o);
    const cls = classify(r);
    report(`RECEIPT`, o.tx, cls);
    save(o.out, { action: 'receipt', tx: o.tx, classification: cls, receipt: r });
    if (!cls.ok) process.exit(cls.execution_result?.includes('ERROR') ? 1 : 2);

  } else if (cmd === 'history') {
    // Recovers transaction hashes for a contract from the explorer index.
    // Needed when a receipt wait times out before the hash was recorded: the
    // transaction may well have committed, and resending blindly is unsafe.
    const url = `${EXPLORER}/api/v1/transactions?address=${o.contract}&page_size=${o.limit ?? 25}`;
    const res = await fetch(url);
    if (!res.ok) fail(2, `explorer returned ${res.status}`);
    const body = await res.json();
    const txs = (body.transactions ?? []).map(t => ({
      hash: t.hash, from: t.from_address, to: t.to_address,
      value_wei: t.value, status: t.status, created_at: t.created_at,
      created_at_utc: t.created_at ? new Date(t.created_at * 1000).toISOString() : null,
    }));
    console.log(JSON.stringify({ contract: o.contract, total: body.total, transactions: txs }, null, 2));
    save(o.out, { action: 'history', contract: o.contract, total: body.total, transactions: txs });

  } else if (cmd === 'balance') {
    const acct = await signer(o.account);
    const c = await client(acct);
    const bal = await c.getBalance({ address: acct.address });
    console.log(JSON.stringify({ account: o.account, address: acct.address, wei: bal.toString(),
      gen: (Number(bal) / 1e18).toFixed(18) }, null, 2));

  } else {
    fail(3, `unknown command '${cmd ?? ''}'. See header for usage.`);
  }
} catch (e) {
  fail(2, e?.shortMessage ?? e?.message ?? String(e));
}
