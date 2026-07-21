/**
 * lib.mjs — shared Bradbury primitives for the UptimeBond harness.
 *
 * Key handling: signing keys come from the OS keychain the GenLayer CLI
 * populates, are held only in memory, and go straight to the SDK signer. No
 * function here logs, returns, serializes, or persists key material, and none
 * accepts a key as an argument.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const GLM = 'file:///C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/node_modules';
const { default: keytar } = await import(`${GLM}/keytar/lib/keytar.js`);
export const gljs = await import(`${GLM}/genlayer-js/dist/index.js`);
const { createClient, createAccount, chains, calldata } = gljs;

export const CHAIN = chains.testnetBradbury;
export const EXPECTED_CHAIN_ID = 4221;
export const EXPLORER = 'https://explorer-bradbury.genlayer.com';
export const EXPLORER_API = `${EXPLORER}/api/v1`;
const KEYCHAIN_SERVICE = 'genlayer-cli';

// Observed Bradbury behaviour: ACCEPTED lands in seconds, FINALIZED takes
// ~30 min, and transactions to the same contract are serialized by queue slot,
// so a step cannot start until the previous one on that contract clears.
export const FINALITY_HINT_SECONDS = 1900;

// ------------------------------------------------------------------ encoding
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ADDR_PREFIX_RE = /^addr#([0-9a-fA-F]{40})$/;
const BYTES_PREFIX_RE = /^b#([0-9a-fA-F]*)$/;
const HEX_RE = /^0x[0-9a-fA-F]+$/;

function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return b;
}

/**
 * genlayer-js does not re-export CalldataAddress from its package entry, but
 * calldata.encode() dispatches on `instanceof CalldataAddress`, so a plain
 * object will silently encode as a dict and the contract will receive
 * something that is not an Address. Resolve the real class from whichever
 * internal chunk exports it — discovered by scanning rather than hardcoded,
 * since the chunk filenames carry build hashes.
 */
const CalldataAddress = await (async () => {
  const direct = gljs.CalldataAddress ?? calldata?.CalldataAddress;
  if (typeof direct === 'function') return direct;
  const distDir = `${GLM}/genlayer-js/dist/`;
  for (const f of readdirSync(fileURLToPath(distDir)).filter(n => n.endsWith('.js'))) {
    try {
      const m = await import(`${distDir}${f}`);
      if (typeof m.CalldataAddress === 'function') return m.CalldataAddress;
    } catch { /* not a loadable chunk; keep scanning */ }
  }
  throw new Error('CalldataAddress could not be resolved from genlayer-js. ' +
    'Address arguments would encode as a dict instead of an address, so ' +
    'refusing to continue rather than deploying a broken contract.');
})();

export function mkAddress(bytes) {
  return new CalldataAddress(bytes);
}

// Mirrors the CLI's parseScalar. A bare 40-hex 0x string becomes an address,
// which is what makes `provider` arrive as an Address in the constructor
// rather than a str — the exact mismatch that broke the first deployment.
export function parseScalar(v) {
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

export function coerce(v) {
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

export function jsonSafe(v) {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = jsonSafe(x);
    return o;
  }
  return v;
}

export function save(file, obj) {
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(jsonSafe(obj), null, 2) + '\n');
}

export function load(file) {
  if (!file || !existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

// ------------------------------------------------------------------- signing
export async function isUnlocked(name) {
  return (await keytar.getPassword(KEYCHAIN_SERVICE, `account:${name}`)) !== null;
}

export async function signer(name) {
  const key = await keytar.getPassword(KEYCHAIN_SERVICE, `account:${name}`);
  if (!key) {
    throw new Error(
      `account '${name}' is locked. Unlock it yourself with:\n` +
      `  genlayer account unlock --account ${name}\n` +
      `This harness never accepts, prompts for, or stores a password or key.`);
  }
  return createAccount(key); // in memory only
}

export async function client(account) {
  if (Number(CHAIN.id) !== EXPECTED_CHAIN_ID) {
    throw new Error(`wrong chain: expected ${EXPECTED_CHAIN_ID}, got ${CHAIN.id}`);
  }
  return createClient(account ? { chain: CHAIN, account } : { chain: CHAIN });
}

/** Assert the signer for a role-restricted call is the address we expect. */
export function assertSigner(actual, expected, role) {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `signer mismatch for ${role}: expected ${expected}, got ${actual}. ` +
      `Refusing to send — a role-restricted call from the wrong account would revert.`);
  }
}

// ------------------------------------------------------------------ explorer
// The JSON-RPC receipt endpoint intermittently returns HTML or "Internal
// error" under load. The explorer index is the more reliable status source, so
// status polling goes through it and the RPC is used only for the rich receipt.
export async function txStatus(hash) {
  const r = await fetch(`${EXPLORER_API}/transactions/${hash}`);
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  if (!d) return null;
  return {
    hash: d.hash, status: d.status, execution_result: d.execution_result,
    submission_timestamp: d.submission_timestamp,
    finalization_timestamp: d.finalization_timestamp,
    leader: d.leader, validators: d.validators, queue: d.queue,
    value: d.value, from: d.from_address, to: d.to_address,
    deployed_contract_address: d.deployed_contract_address,
  };
}

export async function contractHistory(address, limit = 25) {
  const r = await fetch(`${EXPLORER_API}/transactions?address=${address}&page_size=${limit}`);
  if (!r.ok) throw new Error(`explorer ${r.status}`);
  const d = await r.json();
  return d.transactions ?? [];
}

const TERMINAL_OK = new Set(['accepted', 'finalized']);
const TERMINAL_BAD = new Set(['canceled', 'undetermined', 'validators_timeout', 'leader_timeout']);

/**
 * Wait for a transaction to leave the pending states.
 * Returns {state, detail} where state is one of:
 *   committed | failed | pending  (pending = still in flight when we gave up)
 * Never throws on timeout — an unknown outcome must be reported, not guessed.
 */
export async function waitForTx(hash, { want = 'accepted', timeoutMs = 2_400_000,
                                        intervalMs = 15_000, onTick } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const d = await txStatus(hash).catch(() => null);
    if (d) {
      last = d;
      const s = (d.status ?? '').toLowerCase();
      if (onTick) onTick(s, Math.round((Date.now() - started) / 1000));
      if (TERMINAL_BAD.has(s)) return { state: 'failed', detail: d };
      if (want === 'finalized' ? s === 'finalized' : TERMINAL_OK.has(s)) {
        return { state: 'committed', detail: d };
      }
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return { state: 'pending', detail: last };
}

// ---------------------------------------------------------------- submission
// Transient node-level rejections. These are refusals to ACCEPT the
// transaction — the send call itself throws and no hash is issued, which
// proves nothing was committed and makes a retry safe. Anything not on this
// list is treated as unknown and is never retried automatically.
const RETRYABLE = [
  'pipeline backpressure',
  'not currently accepting transactions',
  'nonce too low',
  'replacement transaction underpriced',
  'ECONNRESET', 'ETIMEDOUT', 'socket hang up', 'fetch failed',
  'Internal error', 'service unavailable', 'Bad Gateway', 'Gateway Timeout',
];

function isRetryable(e) {
  const m = `${e?.shortMessage ?? ''} ${e?.message ?? ''} ${e?.details ?? ''}`;
  return RETRYABLE.some(s => m.toLowerCase().includes(s.toLowerCase()));
}

/**
 * Submit a transaction, retrying only when the node refused to accept it.
 *
 * `submit` must be a function that performs the send and resolves to a tx
 * hash. If it throws, no hash was issued, so no state can have been
 * committed and retrying cannot double-write. Once a hash exists this
 * function never retries — an in-flight transaction is the caller's problem
 * to resolve by observation, not by resending.
 */
export async function submitWithRetry(submit, { attempts = 6, baseMs = 20_000, onRetry } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await submit();
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e)) throw e;
      const wait = Math.min(baseMs * 2 ** i, 240_000);
      if (onRetry) onRetry(i + 1, attempts, Math.round(wait / 1000),
                           e?.shortMessage ?? e?.message ?? String(e));
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// ------------------------------------------------------------------ receipts
export function classify(r) {
  const consensus = r?.status_name ?? r?.statusName ?? String(r?.status ?? 'UNKNOWN');
  const vote = r?.result_name ?? r?.resultName ?? String(r?.result ?? 'UNKNOWN');
  const exec = r?.tx_execution_result_name ?? r?.txExecutionResultName ?? 'UNKNOWN';
  const round = r?.last_round ?? r?.lastRound ?? {};
  const votes = round?.validatorVotesName ?? round?.validator_votes_name ?? [];
  const tally = votes.reduce((m, v) => ({ ...m, [v]: (m[v] ?? 0) + 1 }), {});
  // Consensus ACCEPTED with a failed execution is a FAILURE.
  const ok = (consensus === 'FINALIZED' || consensus === 'ACCEPTED')
          && vote === 'AGREE'
          && (exec === 'FINISHED_WITH_RETURN' || exec === 'FINISHED_WITH_NO_RETURN');
  return {
    ok, consensus_status: consensus, consensus_result: vote, execution_result: exec,
    validator_votes: votes, validator_tally: tally,
    validators: round?.roundValidators ?? round?.round_validators ?? [],
    leader_index: round?.leaderIndex ?? round?.leader_index ?? null,
  };
}

/** Rich receipt via RPC; tolerates the endpoint's intermittent failures. */
export async function tryReceipt(c, hash, { status = 'ACCEPTED', retries = 3 } = {}) {
  try {
    return await c.waitForTransactionReceipt({ hash, status, retries, interval: 5000 });
  } catch {
    return null;
  }
}

export async function readState(address, method = 'get_state') {
  const c = await client();
  return c.readContract({ address, functionName: method, args: [], jsonSafeReturn: true });
}
