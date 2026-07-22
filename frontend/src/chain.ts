/**
 * Chain access layer.
 *
 * Two rules drive everything here:
 *  1. A returned transaction hash is NOT success. It means the node accepted
 *     the transaction for processing. Consensus and execution are separate
 *     later outcomes, and either can still fail.
 *  2. Consensus ACCEPTED with execution FINISHED_WITH_ERROR is a failure. The
 *     UI must surface that rather than treating "accepted" as done.
 */

import { createClient, chains } from 'genlayer-js';
import { CHAIN_ID, EXPLORER_API } from './config';

export type TxPhase =
  | 'idle'
  | 'awaiting-signature'
  | 'submitted'
  | 'pending-consensus'
  | 'consensus-accepted'
  | 'execution-error'
  | 'finalized'
  | 'failed'
  | 'unknown';

export interface TxTracker {
  phase: TxPhase;
  hash?: string;
  method?: string;
  consensusStatus?: string;
  executionResult?: string;
  validatorVotes?: string[];
  error?: string;
  startedAt?: number;
  /** True only once execution is confirmed successful. */
  succeeded?: boolean;
}

export interface AgreementState {
  customer: string;
  provider: string;
  status: string;
  resolution_mode: string;
  escrow_atto: string;
  incident_window: string;
  dispute_opened_at: number;
  outcome: string;
  refund_bps: number;
  maintenance_qualified: boolean;
  breached_clause_ids: string[];
  ruling_reason: string;
  insufficient_evidence_ruled_at: number;
  settlement_pending: boolean;
  settlement_proposer: string;
  settlement_refund_bps: number;
}

/** Settlement facts derived from the contract's live native balance.
 *
 * `status === 'RESOLVED'` means the payout was *queued*, not that anyone was
 * paid: settlement transfers are EVM external messages that execute at
 * finalization, tens of minutes later. Never report completed payment from
 * status or arithmetic — read `payout_complete`, which is derived from the
 * balance actually leaving the contract.
 */
export interface SettlementStatus {
  status: string;
  settlement_queued: boolean;
  payout_complete: boolean;
  contract_balance_atto: string;
  escrow_atto: string;
  expected_customer_atto: string;
  expected_provider_atto: string;
}

export interface DeadlockStatus {
  status: string;
  now: number;
  dispute_opened_at: number;
  insufficient_evidence_ruled_at: number;
  applicable_deadline: number;
  resolve_deadlock_available: boolean;
  deadlock_refund_bps: number;
}

const chain = chains.testnetBradbury;

export function readClient() {
  return createClient({ chain });
}

export function walletClient(address: string, provider: unknown) {
  return createClient({
    chain,
    account: address as `0x${string}`,
    provider: provider as never,
  });
}

// --------------------------------------------------------------------- reads
export async function readAgreement(address: string): Promise<AgreementState> {
  const c = readClient();
  return (await c.readContract({
    address: address as `0x${string}`,
    functionName: 'get_state',
    args: [],
    jsonSafeReturn: true,
  })) as unknown as AgreementState;
}

export async function readDeadlock(address: string): Promise<DeadlockStatus> {
  const c = readClient();
  return (await c.readContract({
    address: address as `0x${string}`,
    functionName: 'get_deadlock_status',
    args: [],
    jsonSafeReturn: true,
  })) as unknown as DeadlockStatus;
}

export async function readSettlement(address: string): Promise<SettlementStatus> {
  const c = readClient();
  return (await c.readContract({
    address: address as `0x${string}`,
    functionName: 'get_settlement_status',
    args: [],
    jsonSafeReturn: true,
  })) as unknown as SettlementStatus;
}

export async function readEvidenceSources(address: string) {
  const c = readClient();
  return (await c.readContract({
    address: address as `0x${string}`,
    functionName: 'get_evidence_sources',
    args: [],
    jsonSafeReturn: true,
  })) as unknown as Record<string, string>;
}

// ------------------------------------------------------------- tx observation
const PENDING = new Set(['pending', 'proposing', 'committing', 'revealing', 'activated', 'queued']);
const BAD = new Set(['canceled', 'undetermined', 'validators_timeout', 'leader_timeout']);

interface ExplorerTx {
  status?: string;
  execution_result?: string;
  leader?: string;
  validators?: string[];
}

/**
 * Poll the explorer index rather than the JSON-RPC receipt endpoint: under
 * load the RPC intermittently returns HTML or "Internal error", which would
 * otherwise surface to the user as a spurious failure.
 */
export async function pollTx(hash: string): Promise<TxTracker> {
  let detail: ExplorerTx | null = null;
  try {
    const r = await fetch(`${EXPLORER_API}/transactions/${hash}`);
    if (r.ok) detail = (await r.json()) as ExplorerTx;
  } catch {
    return { phase: 'unknown', hash, error: 'Could not reach the explorer to check status.' };
  }
  if (!detail) return { phase: 'submitted', hash };

  const status = (detail.status ?? '').toLowerCase();
  const exec = detail.execution_result ?? undefined;

  if (BAD.has(status)) {
    return { phase: 'failed', hash, consensusStatus: status, executionResult: exec,
      error: `Consensus did not accept this transaction (${status}).` };
  }
  if (exec && exec.includes('ERROR')) {
    // Consensus may say accepted; execution still failed. Not a success.
    return { phase: 'execution-error', hash, consensusStatus: status, executionResult: exec,
      error: 'Consensus accepted the transaction but contract execution failed.' };
  }
  if (status === 'finalized') {
    return { phase: 'finalized', hash, consensusStatus: status, executionResult: exec, succeeded: true };
  }
  if (status === 'accepted') {
    return { phase: 'consensus-accepted', hash, consensusStatus: status, executionResult: exec,
      succeeded: Boolean(exec && !exec.includes('ERROR')) };
  }
  if (PENDING.has(status)) return { phase: 'pending-consensus', hash, consensusStatus: status };
  return { phase: 'submitted', hash, consensusStatus: status };
}

// -------------------------------------------------------------------- writes
export interface SendOpts {
  address: string;
  method: string;
  args?: unknown[];
  valueWei?: bigint;
  account: string;
  provider: unknown;
}

/** Submits and returns the hash. Callers must then poll — a hash is not success. */
export async function sendTx(o: SendOpts): Promise<string> {
  const c = walletClient(o.account, o.provider);
  return (await c.writeContract({
    address: o.address as `0x${string}`,
    functionName: o.method,
    args: (o.args ?? []) as never[],
    value: o.valueWei ?? 0n,
  })) as unknown as string;
}

// -------------------------------------------------------------------- wallet
export interface Eip1193 {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (e: string, cb: (...a: unknown[]) => void) => void;
  removeListener?: (e: string, cb: (...a: unknown[]) => void) => void;
}

export function getInjected(): Eip1193 | null {
  const w = window as unknown as { ethereum?: Eip1193 };
  return w.ethereum ?? null;
}

export async function currentChainId(p: Eip1193): Promise<number> {
  const id = (await p.request({ method: 'eth_chainId' })) as string;
  return parseInt(id, 16);
}

export async function connectWallet(p: Eip1193): Promise<string[]> {
  return (await p.request({ method: 'eth_requestAccounts' })) as string[];
}

export async function switchToBradbury(p: Eip1193): Promise<void> {
  const hex = `0x${CHAIN_ID.toString(16)}`;
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (e) {
    const err = e as { code?: number };
    if (err.code === 4902) {
      await p.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: hex,
          chainName: 'GenLayer Bradbury Testnet',
          nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
          rpcUrls: ['https://rpc-bradbury.genlayer.com'],
          blockExplorerUrls: ['https://explorer-bradbury.genlayer.com'],
        }],
      });
    } else throw e;
  }
}

// -------------------------------------------------------------------- format
export function fmtGen(wei: string | bigint | number): string {
  const v = typeof wei === 'bigint' ? wei : BigInt(String(wei ?? 0));
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function shortAddr(a?: string): string {
  if (!a) return '—';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function bpsPct(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}
