#!/usr/bin/env node
/**
 * lifecycle.mjs — drives one UptimeBond case through its Bradbury lifecycle.
 *
 * Resume safety comes from the contract itself: the next action is derived
 * from on-chain `status`, never from local bookkeeping. Re-running after any
 * interruption re-reads state and continues from wherever the chain actually
 * is, so a crash between "submitted" and "receipt observed" cannot cause a
 * double write.
 *
 *   AWAITING_FUNDING              -> fund (payable)
 *   AWAITING_PROVIDER_ACCEPTANCE  -> accept_sla        [provider]
 *   ACTIVE                        -> open_dispute      [customer]
 *   DISPUTED                      -> rule
 *   RULED + settleable outcome    -> release
 *   RULED + INSUFFICIENT_EVIDENCE -> stop (no automatic settlement by design)
 *   RESOLVED                      -> done
 *
 * Usage:
 *   node lifecycle.mjs --case case-003-full-refund [--deploy] [--max-steps N]
 *                      [--dry-run] [--status]
 *
 * Exit: 0 ok//complete · 1 execution error · 2 tx failed · 3 usage/precondition
 *       5 unknown outcome (submitted but not observed — needs manual check)
 */

import { readFileSync } from 'node:fs';
import {
  client, signer, isUnlocked, assertSigner, save, load, jsonSafe, parseScalar,
  waitForTx, txStatus, classify, tryReceipt, readState, EXPLORER, contractHistory,
  submitWithRetry,
} from './lib.mjs';

const CFG = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));

// ---------------------------------------------------------------- arg parsing
const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2);
    opt[k] = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
  }
}
const caseId = opt.case;
if (!caseId || !CFG.cases[caseId]) {
  console.error(`usage: --case <${Object.keys(CFG.cases).join('|')}> [--deploy] [--status] [--dry-run]`);
  process.exit(3);
}

const C = CFG.cases[caseId];
const OUT = `deploy/bradbury/${caseId}`;
const log = (...a) => console.log(`[${caseId}]`, ...a);

function evidenceUrls() {
  const b = `${CFG.repo_raw_base}/${CFG.evidence_commit}/${C.evidence_dir}`;
  return {
    sla_terms_url: `${b}/sla-terms.json`,
    independent_monitor_url: `${b}/monitor-report.json`,
    provider_status_url: `${b}/provider-status.json`,
    maintenance_announcements_url: `${b}/maintenance-announcements.json`,
  };
}

/** Refuse to proceed if the pinned evidence is not actually fetchable. */
async function preflightEvidence() {
  const urls = evidenceUrls();
  const results = {};
  for (const [k, u] of Object.entries(urls)) {
    const r = await fetch(u);
    results[k] = { url: u, status: r.status, bytes: (await r.text()).length };
    if (!r.ok) {
      throw new Error(`evidence preflight failed: ${k} returned ${r.status}\n  ${u}\n` +
        `Validators re-fetch these independently; a broken URL guarantees a failed ruling.`);
    }
  }
  return results;
}

// ------------------------------------------------------------------- sending
async function send(step, { account, method, args = [], value = 0n, expectSigner }) {
  const outFile = `${OUT}/${step}.json`;
  const prev = load(outFile);
  if (prev?.classification?.ok) {
    log(`${step}: already recorded as committed (${prev.tx}) — skipping`);
    return { skipped: true, tx: prev.tx };
  }

  if (opt['dry-run']) { log(`${step}: DRY RUN — would call ${method}`); return { dry: true }; }

  const acct = await signer(account);
  if (expectSigner) assertSigner(acct.address, expectSigner, `${method} (${account})`);
  const c = await client(acct);

  log(`${step}: ${method} as ${account} (${acct.address})${value ? ` value=${value}` : ''}`);
  const hash = await submitWithRetry(
    () => c.writeContract({ address: contractAddress, functionName: method, args, value }),
    { onRetry: (n, max, secs, msg) =>
        log(`${step}: node refused submission (${n}/${max}), retrying in ${secs}s — ${msg}`) });
  log(`${step}: tx ${hash}`);

  // Persist before waiting: a wait that times out must never orphan a hash.
  save(outFile, {
    stage: 'SUBMITTED_AWAITING_RECEIPT', case: caseId, step, method,
    contract: contractAddress, signer_account: account, signer_address: acct.address,
    value_wei: value.toString(), tx: hash, explorer: `${EXPLORER}/tx/${hash}`,
    submitted_at: new Date().toISOString(),
    warning: 'Receipt not yet observed. Verify on-chain state before any retry.',
  });

  // Wait for FINALIZATION, not acceptance.
  //
  // Two independent reasons, both learned the hard way on Bradbury:
  //
  // 1. Submitting the next step while earlier ones are still unfinalized gets
  //    the transaction reverted by the consensus contract. The case-002-v2 run
  //    queued fund/accept/dispute on acceptance and then had `rule` reverted at
  //    submission — EVM status 0x0, ~30 minutes before the dispute finalized.
  //    Replaying that same call one block earlier succeeded, so it was the
  //    queue state at inclusion that rejected it, not the call itself.
  //
  // 2. Settlement transfers are external messages that execute at
  //    finalization. A run that stops at acceptance would report a payout that
  //    has not happened, which is the exact failure this harness now exists to
  //    prove against.
  //
  // Finality costs ~30 minutes per step. That is the real speed of the chain.
  const { state, detail } = await waitForTx(hash, {
    want: 'finalized',
    onTick: (s, secs) => { if (secs % 120 === 0) log(`${step}: ${s} (${secs}s)`); },
  });

  if (state === 'pending') {
    log(`${step}: UNKNOWN — still in flight after the wait window.`);
    log(`${step}: not retrying; outcome must be confirmed before any resend.`);
    save(outFile, { stage: 'UNKNOWN_STILL_PENDING', case: caseId, step, method,
      contract: contractAddress, tx: hash, explorer: `${EXPLORER}/tx/${hash}`,
      last_seen: jsonSafe(detail), checked_at: new Date().toISOString() });
    process.exit(5);
  }

  const receipt = await tryReceipt(c, hash);
  const cls = receipt ? classify(receipt)
                      : { ok: state === 'committed', consensus_status: detail?.status ?? 'UNKNOWN',
                          consensus_result: 'UNKNOWN', execution_result: detail?.execution_result ?? 'UNKNOWN',
                          validator_votes: [], validator_tally: {},
                          note: 'RPC receipt unavailable; classified from explorer index.' };

  save(outFile, {
    stage: 'OBSERVED', case: caseId, step, method, contract: contractAddress,
    signer_account: account, signer_address: acct.address, value_wei: value.toString(),
    tx: hash, explorer: `${EXPLORER}/tx/${hash}`, classification: cls,
    explorer_detail: jsonSafe(detail), receipt: jsonSafe(receipt),
    observed_at: new Date().toISOString(),
  });

  log(`${step}: consensus=${cls.consensus_status}/${cls.consensus_result} ` +
      `exec=${cls.execution_result} votes=${JSON.stringify(cls.validator_tally)} ` +
      `-> ${cls.ok ? 'SUCCESS' : 'FAILURE'}`);

  if (!cls.ok) {
    log(`${step}: FAILED — halting so the cause can be diagnosed before any further write.`);
    process.exit(String(cls.execution_result).includes('ERROR') ? 1 : 2);
  }
  return { tx: hash, cls };
}

// -------------------------------------------------------------------- deploy
let contractAddress = C.contract_address ?? load(`${OUT}/00-deploy.json`)?.contract_address ?? null;

async function doDeploy() {
  const existing = load(`${OUT}/00-deploy.json`);
  if (existing?.contract_address) {
    log(`deploy: already deployed at ${existing.contract_address} — skipping`);
    return existing.contract_address;
  }
  const ev = await preflightEvidence();
  log('deploy: evidence preflight OK (all four sources reachable)');

  const acct = await signer(CFG.accounts.customer);
  assertSigner(acct.address, CFG.addresses.customer, 'deploy (customer)');
  const c = await client(acct);
  const code = readFileSync('contracts/uptime_bond.py');
  const u = evidenceUrls();
  const args = [
    parseScalar(CFG.addresses.provider),      // encodes as address -> Address
    u.sla_terms_url, u.independent_monitor_url,
    u.provider_status_url, u.maintenance_announcements_url,
    CFG.defaults.deadlock_refund_bps,
    CFG.defaults.dispute_deadlock_seconds,
    CFG.defaults.insufficient_evidence_deadlock_seconds,
  ];

  log(`deploy: ${code.length} bytes as ${CFG.accounts.customer}`);
  const hash = await submitWithRetry(
    () => c.deployContract({ code, args }),
    { onRetry: (n, max, secs, msg) =>
        log(`deploy: node refused submission (${n}/${max}), retrying in ${secs}s — ${msg}`) });
  log(`deploy: tx ${hash}`);
  save(`${OUT}/00-deploy.json`, {
    stage: 'SUBMITTED_AWAITING_RECEIPT', case: caseId, tx: hash,
    explorer: `${EXPLORER}/tx/${hash}`, submitted_at: new Date().toISOString(),
  });

  // Finalization, for the same reason as every other step: the constructor's
  // state must be settled before `fund` is submitted against it.
  const { state, detail } = await waitForTx(hash, {
    want: 'finalized',
    onTick: (s, secs) => { if (secs % 120 === 0) log(`deploy: ${s} (${secs}s)`); },
  });
  if (state !== 'committed') {
    log('deploy: UNKNOWN/FAILED — halting.');
    save(`${OUT}/00-deploy.json`, { stage: 'UNKNOWN', case: caseId, tx: hash,
      last_seen: jsonSafe(detail) });
    process.exit(state === 'pending' ? 5 : 2);
  }

  const receipt = await tryReceipt(c, hash);
  const cls = receipt ? classify(receipt) : { ok: true, note: 'explorer-classified' };
  const addr = receipt?.tx_data_decoded?.contract_address
            ?? detail?.deployed_contract_address ?? receipt?.recipient ?? null;
  if (!addr) { log('deploy: could not determine contract address'); process.exit(2); }

  save(`${OUT}/00-deploy.json`, {
    stage: 'OBSERVED', case: caseId, contract_address: addr, tx: hash,
    explorer_tx: `${EXPLORER}/tx/${hash}`, explorer_contract: `${EXPLORER}/address/${addr}`,
    source_commit: CFG.evidence_commit, evidence: ev,
    constructor_arguments: {
      provider: CFG.addresses.provider, ...u,
      deadlock_refund_bps: CFG.defaults.deadlock_refund_bps,
      dispute_deadlock_seconds: CFG.defaults.dispute_deadlock_seconds,
      insufficient_evidence_deadlock_seconds: CFG.defaults.insufficient_evidence_deadlock_seconds,
    },
    classification: cls, receipt: jsonSafe(receipt), observed_at: new Date().toISOString(),
  });
  log(`deploy: contract ${addr}`);
  return addr;
}

// ---------------------------------------------------------------------- main
try {
  for (const role of ['customer', 'provider']) {
    const acc = CFG.accounts[role];
    if (!await isUnlocked(acc)) {
      console.error(`account '${acc}' (${role}) is locked.\n` +
        `  Unlock it yourself:  genlayer account unlock --account ${acc}`);
      process.exit(3);
    }
  }

  if (opt.deploy && !contractAddress) contractAddress = await doDeploy();
  if (!contractAddress) { console.error('no contract address; pass --deploy'); process.exit(3); }

  if (opt.status) {
    const st = await readState(contractAddress);
    console.log(JSON.stringify({ case: caseId, contract: contractAddress, state: jsonSafe(st) }, null, 2));
    process.exit(0);
  }

  const maxSteps = Number(opt['max-steps'] ?? 10);
  for (let n = 0; n < maxSteps; n++) {
    const st = await readState(contractAddress);
    const status = st.status;
    log(`state: ${status}${st.outcome ? ` outcome=${st.outcome}` : ''}`);
    save(`${OUT}/state-${status}.json`, { case: caseId, contract: contractAddress,
      state: jsonSafe(st), read_at: new Date().toISOString() });

    if (status === 'AWAITING_FUNDING') {
      await send('01-fund', { account: CFG.accounts.customer, method: 'fund',
        value: BigInt(C.escrow_wei), expectSigner: CFG.addresses.customer });
    } else if (status === 'AWAITING_PROVIDER_ACCEPTANCE') {
      await send('02-accept-sla', { account: CFG.accounts.provider, method: 'accept_sla',
        expectSigner: CFG.addresses.provider });
    } else if (status === 'ACTIVE') {
      await send('03-open-dispute', { account: CFG.accounts.customer, method: 'open_dispute',
        args: [C.incident_window], expectSigner: CFG.addresses.customer });
    } else if (status === 'DISPUTED') {
      log('rule: this is the real validator adjudication — evidence is re-fetched by every validator');
      await send('04-rule', { account: CFG.accounts.customer, method: 'rule',
        expectSigner: CFG.addresses.customer });
    } else if (status === 'RULED') {
      if (st.outcome === 'INSUFFICIENT_EVIDENCE') {
        log('RULED INSUFFICIENT_EVIDENCE — no automatic settlement by design. Stopping.');
        log('  Escrow remains custodied: mutual settlement, native appeal, or deadlock fallback.');
        break;
      }
      await send('05-release', { account: CFG.accounts.customer, method: 'release',
        expectSigner: CFG.addresses.customer });
    } else if (status === 'RESOLVED') {
      log(`RESOLVED via ${st.resolution_mode} — lifecycle complete.`);
      break;
    } else {
      log(`unexpected status '${status}' — stopping.`); process.exit(2);
    }
  }

  const final = await readState(contractAddress);
  save(`${OUT}/99-final-state.json`, {
    case: caseId, contract: contractAddress, expected: C.expected,
    final_state: jsonSafe(final), read_at: new Date().toISOString(),
  });
  log('final:', JSON.stringify({ status: final.status, outcome: final.outcome,
    refund_bps: final.refund_bps, maintenance_qualified: final.maintenance_qualified,
    breached: final.breached_clause_ids, resolution_mode: final.resolution_mode }));
} catch (e) {
  console.error(`[${caseId}] ERROR:`, e?.shortMessage ?? e?.message ?? String(e));
  process.exit(2);
}
