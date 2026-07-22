#!/usr/bin/env node
/**
 * balances.mjs — chain-layer native balance snapshots.
 *
 * Exists because `FINISHED_WITH_RETURN` proves only that contract code ran to
 * completion, not that value moved. UptimeBond's original `_settle` emitted an
 * internal GenVM PostMessage at two EOAs; every settle transaction reported
 * success and finalized, and not one atto left the contract. Nothing in the
 * receipt distinguishes that from a real payout — only the balances do.
 *
 * Read-only. Takes no account and touches no keychain.
 *
 * Usage:
 *   node balances.mjs --label before 0xAddr1 0xAddr2 ...
 *   node balances.mjs --label after --out FILE 0xAddr1 ...
 *   node balances.mjs --diff BEFORE.json AFTER.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const GLM = 'file:///C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/node_modules';
const gljs = await import(`${GLM}/genlayer-js/dist/index.js`);
const { createClient, chains } = gljs;

const argv = process.argv.slice(2);
const opt = { addresses: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--label') opt.label = argv[++i];
  else if (a === '--out') opt.out = argv[++i];
  else if (a === '--diff') { opt.diff = [argv[++i], argv[++i]]; }
  else opt.addresses.push(a);
}

const fmt = (wei) => {
  const neg = wei < 0n;
  const v = neg ? -wei : wei;
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
};

function save(path, obj) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

if (opt.diff) {
  // Difference two snapshots. Reports exact atto deltas — the only evidence
  // that distinguishes a real transfer from an inert one.
  const [b, a] = opt.diff.map((p) => JSON.parse(readFileSync(p, 'utf8')));
  const rows = {};
  for (const addr of Object.keys(a.balances)) {
    const before = BigInt(b.balances[addr] ?? '0');
    const after = BigInt(a.balances[addr]);
    rows[addr] = {
      before_wei: before.toString(),
      after_wei: after.toString(),
      delta_wei: (after - before).toString(),
      delta_gen: fmt(after - before),
    };
  }
  const out = { diff: { from: b.label, to: a.label }, rows };
  console.log(JSON.stringify(out, null, 2));
  save(opt.out, out);
} else {
  if (opt.addresses.length === 0) {
    console.error('usage: balances.mjs --label NAME 0xAddr...');
    process.exit(3);
  }
  const c = createClient({ chain: chains.testnetBradbury });
  const balances = {};
  for (const addr of opt.addresses) {
    balances[addr] = (await c.getBalance({ address: addr })).toString();
  }
  const out = {
    label: opt.label ?? null,
    read_at: new Date().toISOString(),
    balances,
    gen: Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, fmt(BigInt(v))])),
  };
  console.log(JSON.stringify(out, null, 2));
  save(opt.out, out);
}
