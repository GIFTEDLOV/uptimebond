/**
 * Deployment verification.
 *
 * A finalized deploy transaction is NOT proof that an agreement exists.
 * Transaction `0x0c8e748c6268cd68c05adb583e060bbae0af35c19e97f48302c13c61dbd9648a`
 * finalized with `FINISHED_WITH_RETURN`, every validator voted agree, and the
 * receipt named `0xc09d70CE30BAd8ce8519C40Ef12C037B9cfBd99f` as the deployed
 * contract — yet `gen_getContractCode` and `gen_call` both report "contract not
 * found" at that address, hours later, and its balance is zero. The receipt was
 * right about what it claimed; the chain simply has no contract there.
 *
 * So the UI must never infer a deployment from consensus alone. Every one of
 * these must hold before an agreement is treated as real and made fundable:
 *
 *   1. consensus status is FINALIZED
 *   2. txExecutionResultName is FINISHED_WITH_RETURN
 *   3. an authoritative address is named by the finalized receipt
 *   4. gen_getContractCode succeeds at that address
 *   5. get_state succeeds
 *   6. the contract's customer is the deploying wallet
 *   7. the contract's provider is the address we submitted
 *   8. the lifecycle status is AWAITING_FUNDING
 *
 * Anything less is reported as unverified, with the failing check named.
 */

import {
  getBalance, getContractCode, readAgreement, readDeadlockConfig, readDeployReceipt,
  readEvidenceSources, type AgreementState,
} from '../chain';
import { sha256Hex } from './hash';
import type { DeploymentDraft } from './registry';
import { sameAddress } from './validation';

export type DeployCheckId =
  | 'finalized' | 'execution' | 'address' | 'code' | 'source'
  | 'state' | 'customer' | 'provider' | 'evidence' | 'deadlock'
  | 'status' | 'escrow' | 'balance';

export interface DeployCheck {
  id: DeployCheckId;
  label: string;
  /** null = not reached, because an earlier check already failed. */
  ok: boolean | null;
  detail: string;
}

export interface DeployVerification {
  ok: boolean;
  /** Set only when every check passed. Never expose an unverified address as an agreement. */
  address: string | null;
  /** The address the receipt named, verified or not — for diagnostics and explorer links. */
  claimedAddress: string | null;
  state: AgreementState | null;
  consensusStatus: string;
  executionResult: string;
  checks: DeployCheck[];
  /** The first check that failed, if any. */
  failed: DeployCheck | null;
}

const LABELS: Record<DeployCheckId, string> = {
  finalized: 'Consensus finalized',
  execution: 'Execution finished with return',
  address: 'Contract address recovered from the receipt',
  code: 'Contract code present on-chain',
  source: 'Deployed source matches the source we submitted',
  state: 'Agreement state readable',
  customer: 'Customer matches the deploying wallet',
  provider: 'Provider matches the submitted address',
  evidence: 'All four evidence sources match what was submitted',
  deadlock: 'Deadlock terms match what was submitted',
  status: 'Lifecycle status is awaiting funding',
  escrow: 'Escrow is zero before funding',
  balance: 'Contract balance is zero before funding',
};

const ORDER: DeployCheckId[] = [
  'finalized', 'execution', 'address', 'code', 'source', 'state',
  'customer', 'provider', 'evidence', 'deadlock', 'status', 'escrow', 'balance',
];

export interface VerifyInput {
  hash: string;
  /**
   * The complete deployment intent, persisted at signing time.
   *
   * Verification compares the contract against what we meant to deploy, not
   * against whatever the form or the connected wallet says now. Passing only
   * sender and provider left the evidence URLs and deadlock terms — the terms
   * that decide every future ruling and are immutable — entirely unchecked.
   */
  draft: DeploymentDraft;
}

/**
 * Runs every check in order, stopping at the first failure. Checks after that
 * point are reported as "not reached" rather than as passing, so the panel can
 * never imply more was proven than actually was.
 */
export async function verifyDeployment(input: VerifyInput): Promise<DeployVerification> {
  const { draft } = input;
  const results = new Map<DeployCheckId, DeployCheck>();
  let consensusStatus = '';
  let executionResult = '';
  let claimedAddress: string | null = null;
  let state: AgreementState | null = null;

  const pass = (id: DeployCheckId, detail: string) =>
    results.set(id, { id, label: LABELS[id], ok: true, detail });
  const fail = (id: DeployCheckId, detail: string) =>
    results.set(id, { id, label: LABELS[id], ok: false, detail });

  const finish = (): DeployVerification => {
    const checks = ORDER.map((id) => results.get(id)
      ?? { id, label: LABELS[id], ok: null, detail: 'Not reached — an earlier check failed.' });
    const failed = checks.find((c) => c.ok === false) ?? null;
    const ok = checks.every((c) => c.ok === true);
    return {
      ok,
      address: ok ? claimedAddress : null,
      claimedAddress,
      state: ok ? state : null,
      consensusStatus,
      executionResult,
      checks,
      failed,
    };
  };

  const receipt = await readDeployReceipt(input.hash);
  if (!receipt) {
    fail('finalized', 'The transaction could not be read from the network.');
    return finish();
  }
  consensusStatus = receipt.statusName;
  executionResult = receipt.executionResultName;

  if (receipt.statusName.toUpperCase() !== 'FINALIZED') {
    fail('finalized', `Consensus status is ${receipt.statusName || 'unknown'}, not FINALIZED.`);
    return finish();
  }
  pass('finalized', 'FINALIZED');

  if (receipt.executionResultName.toUpperCase() !== 'FINISHED_WITH_RETURN') {
    fail('execution', `Execution result is ${receipt.executionResultName || 'unknown'}. `
      + 'The transaction reached consensus but the contract did not run to completion.');
    return finish();
  }
  pass('execution', 'FINISHED_WITH_RETURN');

  claimedAddress = receipt.contractAddress ?? receipt.recipient ?? null;
  if (!claimedAddress) {
    fail('address', 'The finalized receipt names no contract address.');
    return finish();
  }
  if (receipt.contractAddress && receipt.recipient
      && !sameAddress(receipt.contractAddress, receipt.recipient)) {
    fail('address', `The receipt's contract address (${receipt.contractAddress}) and the `
      + `transaction recipient (${receipt.recipient}) disagree.`);
    return finish();
  }
  pass('address', claimedAddress);

  let code: string;
  try {
    code = await getContractCode(claimedAddress);
    if (!code || code.length === 0) {
      fail('code', 'The node returned empty contract code for this address.');
      return finish();
    }
    pass('code', `${code.length} characters of contract source present`);
  } catch {
    fail('code', 'No contract exists at this address. The node reports no code there, '
      + 'so the transaction finalized without leaving a contract behind.');
    return finish();
  }

  // The deployed bytes must be the bytes we sent. A mismatch means the address
  // holds somebody else's contract, or a different build of ours.
  const deployedSha = await sha256Hex(code);
  if (draft.sourceSha256 && deployedSha !== draft.sourceSha256) {
    fail('source', `The deployed source hashes to ${deployedSha.slice(0, 16)}…, not the `
      + `${draft.sourceSha256.slice(0, 16)}… we submitted.`);
    return finish();
  }
  pass('source', `sha256 ${deployedSha.slice(0, 16)}…`);

  try {
    state = await readAgreement(claimedAddress);
  } catch {
    fail('state', 'The contract did not answer get_state.');
    return finish();
  }
  if (!state || typeof state.status !== 'string') {
    fail('state', 'get_state returned an unrecognised shape.');
    return finish();
  }
  pass('state', 'get_state answered');

  if (!sameAddress(state.customer, draft.sender)) {
    fail('customer', `The contract's customer is ${state.customer}, not the deploying `
      + `wallet ${draft.sender}. This is not your agreement.`);
    return finish();
  }
  pass('customer', state.customer);

  if (!sameAddress(state.provider, draft.provider)) {
    fail('provider', `The contract's provider is ${state.provider}, not the address you `
      + `submitted (${draft.provider}).`);
    return finish();
  }
  pass('provider', state.provider);

  // The four evidence sources are immutable and decide every future ruling.
  // If any one of them is not what we submitted, the agreement is not ours in
  // any meaningful sense — and nothing can be done about it after funding.
  let sources: Record<string, string>;
  try {
    sources = await readEvidenceSources(claimedAddress);
  } catch {
    fail('evidence', 'The contract did not answer get_evidence_sources.');
    return finish();
  }
  const expectedSources: Array<[string, string, string]> = [
    ['sla_terms_url', 'SLA terms', draft.slaTermsUrl],
    ['independent_monitor_url', 'independent monitor', draft.independentMonitorUrl],
    ['provider_status_url', 'provider status', draft.providerStatusUrl],
    ['maintenance_announcements_url', 'maintenance feed', draft.maintenanceAnnouncementsUrl],
  ];
  const badSource = expectedSources.find(([key, , want]) => (sources[key] ?? '') !== want);
  if (badSource) {
    fail('evidence', `The on-chain ${badSource[1]} URL is "${sources[badSource[0]] ?? '(missing)'}", `
      + `not the "${badSource[2]}" that was submitted.`);
    return finish();
  }
  pass('evidence', 'all four sources match');

  // Deadlock terms decide the fallback split and when it becomes available.
  try {
    const cfg = await readDeadlockConfig(claimedAddress);
    const mismatch = (
      Number(cfg.deadlock_refund_bps) !== draft.deadlockRefundBps ? 'deadlock_refund_bps'
        : Number(cfg.dispute_deadlock_seconds) !== draft.disputeDeadlockSeconds ? 'dispute_deadlock_seconds'
          : Number(cfg.insufficient_evidence_deadlock_seconds) !== draft.insufficientEvidenceDeadlockSeconds
            ? 'insufficient_evidence_deadlock_seconds' : null
    );
    if (mismatch) {
      fail('deadlock', `On-chain ${mismatch} does not match the value submitted `
        + `(${JSON.stringify(cfg)} vs ${draft.deadlockRefundBps}/${draft.disputeDeadlockSeconds}/`
        + `${draft.insufficientEvidenceDeadlockSeconds}).`);
      return finish();
    }
    pass('deadlock', `${draft.deadlockRefundBps} bps · ${draft.disputeDeadlockSeconds}s · `
      + `${draft.insufficientEvidenceDeadlockSeconds}s`);
  } catch {
    fail('deadlock', 'The contract did not answer get_deadlock_config.');
    return finish();
  }

  if (state.status !== 'AWAITING_FUNDING') {
    fail('status', `The agreement is ${state.status}, not AWAITING_FUNDING.`);
    return finish();
  }
  pass('status', 'AWAITING_FUNDING');

  // A fresh agreement holds nothing. Anything else means this is not the
  // untouched contract we just created.
  if (BigInt(state.escrow_atto || '0') !== 0n) {
    fail('escrow', `Escrow is already ${state.escrow_atto} atto on a contract that should be unfunded.`);
    return finish();
  }
  pass('escrow', '0');

  try {
    const balance = await getBalance(claimedAddress);
    if (balance !== 0n) {
      fail('balance', `The contract already holds ${balance} atto before funding.`);
      return finish();
    }
    pass('balance', '0');
  } catch {
    fail('balance', 'The contract balance could not be read.');
    return finish();
  }

  return finish();
}
