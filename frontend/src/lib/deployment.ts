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
  getContractCode, readAgreement, readDeployReceipt,
  type AgreementState,
} from '../chain';
import { sameAddress } from './validation';

export type DeployCheckId =
  | 'finalized' | 'execution' | 'address' | 'code'
  | 'state' | 'customer' | 'provider' | 'status';

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
  state: 'Agreement state readable',
  customer: 'Customer matches the deploying wallet',
  provider: 'Provider matches the submitted address',
  status: 'Lifecycle status is awaiting funding',
};

const ORDER: DeployCheckId[] = [
  'finalized', 'execution', 'address', 'code', 'state', 'customer', 'provider', 'status',
];

export interface VerifyInput {
  hash: string;
  /** The wallet that signed the deployment. */
  sender: string;
  /** The provider address submitted to the constructor. */
  provider: string;
}

/**
 * Runs every check in order, stopping at the first failure. Checks after that
 * point are reported as "not reached" rather than as passing, so the panel can
 * never imply more was proven than actually was.
 */
export async function verifyDeployment(input: VerifyInput): Promise<DeployVerification> {
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

  try {
    const code = await getContractCode(claimedAddress);
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

  if (!sameAddress(state.customer, input.sender)) {
    fail('customer', `The contract's customer is ${state.customer}, not the deploying `
      + `wallet ${input.sender}. This is not your agreement.`);
    return finish();
  }
  pass('customer', state.customer);

  if (!sameAddress(state.provider, input.provider)) {
    fail('provider', `The contract's provider is ${state.provider}, not the address you `
      + `submitted (${input.provider}).`);
    return finish();
  }
  pass('provider', state.provider);

  if (state.status !== 'AWAITING_FUNDING') {
    fail('status', `The agreement is ${state.status}, not AWAITING_FUNDING.`);
    return finish();
  }
  pass('status', 'AWAITING_FUNDING');

  return finish();
}
