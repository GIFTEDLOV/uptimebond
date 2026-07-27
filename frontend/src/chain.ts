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
import { CalldataAddress } from 'genlayer-js/types';
import { CHAIN_ID } from './config';

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
  /** AGREE / DISAGREE — the settled consensus result, when the node reports one. */
  consensusResult?: string;
  validatorVotes?: string[];
  error?: string;
  startedAt?: number;
  /**
   * True only when consensus agreed AND the execution result is explicitly one
   * of the successful ones. Never inferred from status: a FINALIZED transaction
   * with no execution result, or with an unrecognised one, is not a success.
   */
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

interface RpcTx {
  statusName?: string;
  status?: string | number;
  txExecutionResultName?: string;
  resultName?: string;
  txDataDecoded?: { contractAddress?: string };
}

/**
 * The only execution results that mean the contract ran to completion.
 * Anything else — including an absent result — is not success.
 */
const SUCCESSFUL_EXECUTION = new Set(['FINISHED_WITH_RETURN', 'FINISHED_WITH_NO_RETURN']);

/**
 * Poll transaction status through the JSON-RPC via genlayer-js.
 *
 * The explorer index is NOT used from the browser: its API sends no
 * `Access-Control-Allow-Origin` header, so a browser fetch is CORS-blocked. The
 * RPC is CORS-open and returns the same consensus status and execution result.
 * Two rules still hold: a hash is not success, and consensus-accepted +
 * execution error is a failure.
 */
export async function pollTx(hash: string): Promise<TxTracker> {
  let tx: RpcTx | null = null;
  try {
    tx = (await readClient().getTransaction({ hash: hash as never })) as unknown as RpcTx;
  } catch {
    // Not indexed yet, or a transient RPC hiccup — keep waiting, don't error.
    return { phase: 'submitted', hash };
  }
  if (!tx) return { phase: 'submitted', hash };

  const status = String(tx.statusName ?? tx.status ?? '').toUpperCase();
  const exec = tx.txExecutionResultName ?? undefined;
  const consensusResult = tx.resultName ? String(tx.resultName).toUpperCase() : undefined;
  const base = { hash, consensusStatus: status, executionResult: exec, consensusResult };

  if (BAD.has(status.toLowerCase())) {
    return { ...base, phase: 'failed',
      error: `Consensus did not accept this transaction (${status.toLowerCase()}).` };
  }
  if (exec && exec.includes('ERROR')) {
    return { ...base, phase: 'execution-error',
      error: 'Consensus accepted the transaction but contract execution failed.' };
  }
  // A settled consensus result that is not agreement is a failure, whatever the
  // status says. Only AGREE (or a node that reports no result at all) proceeds.
  if (consensusResult && consensusResult !== 'AGREE'
      && (status === 'FINALIZED' || status === 'ACCEPTED')) {
    return { ...base, phase: 'failed',
      error: `Validators did not agree on this transaction (${consensusResult}).` };
  }

  if (status === 'FINALIZED' || status === 'ACCEPTED') {
    const finalized = status === 'FINALIZED';
    if (!exec) {
      // Finalized or accepted with no execution result is NOT success. Reporting
      // it as such is how a transaction that never ran gets treated as done.
      return { ...base, phase: 'unknown',
        error: `The transaction is ${status.toLowerCase()} but the node reported no execution `
          + 'result. Do not assume it succeeded — confirm the on-chain state before retrying.' };
    }
    if (!SUCCESSFUL_EXECUTION.has(exec.toUpperCase())) {
      return { ...base, phase: 'unknown',
        error: `Unrecognised execution result "${exec}". Confirm the on-chain state before retrying.` };
    }
    return { ...base, phase: finalized ? 'finalized' : 'consensus-accepted', succeeded: true };
  }

  if (PENDING.has(status.toLowerCase())) return { ...base, phase: 'pending-consensus' };
  return { ...base, phase: 'submitted' };
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

// -------------------------------------------------------------------- deploy
export interface DeployArgs {
  provider: string;
  sla_terms_url: string;
  independent_monitor_url: string;
  provider_status_url: string;
  maintenance_announcements_url: string;
  deadlock_refund_bps: number;
  dispute_deadlock_seconds: number;
  insufficient_evidence_deadlock_seconds: number;
}

/**
 * Encode a hex address as GenVM calldata's Address type.
 *
 * `calldata.encode()` dispatches on `instanceof CalldataAddress`. A plain
 * `"0x…"` string is therefore encoded as a 42-character `str`, and GenVM hands
 * that str to a constructor annotated `provider: Address`. The type comparisons
 * in `__init__` silently return False (a str never equals an Address), and the
 * assignment into the Address-typed storage slot then raises a bare TypeError —
 * no `gl.vm.UserError`, so the transaction reaches consensus and fails
 * execution with an empty error message.
 *
 * That is exactly how deploy `0x771ab100…` died: all eight arguments were
 * present and correct, but `provider` was on the wire as `str(42)` instead of
 * `Address(20 bytes)`. `deploy/scripts/lib.mjs` encodes the same argument
 * through `mkAddress()`, which is why the scripted deployments succeeded and
 * the browser's did not.
 */
export function addressArg(hex: string): CalldataAddress {
  const clean = hex.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{40}$/.test(clean)) {
    throw new Error(`Not a 20-byte address: ${JSON.stringify(hex)}`);
  }
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return new CalldataAddress(bytes);
}

/** Deploys UptimeBond from the connected customer wallet.
 *
 * Returns only the transaction hash. Deployment is NOT complete until the
 * transaction finalizes; the contract address is then recovered from the
 * receipt via `recoverDeployedAddress`. The caller must persist the hash before
 * anything else so an interrupted deploy can be resumed rather than repeated. */
export async function deployContract(
  account: string, provider: unknown, code: string, args: DeployArgs,
): Promise<string> {
  const c = walletClient(account, provider);
  return (await c.deployContract({
    code,
    // Constructor is positional; order mirrors contracts/uptime_bond.py.
    // `provider` is declared `Address` and MUST be encoded as one — see addressArg.
    args: [
      addressArg(args.provider),
      args.sla_terms_url,
      args.independent_monitor_url,
      args.provider_status_url,
      args.maintenance_announcements_url,
      args.deadlock_refund_bps,
      args.dispute_deadlock_seconds,
      args.insufficient_evidence_deadlock_seconds,
    ] as never[],
  })) as unknown as string;
}

/** Recover a deployed contract address from its deploy transaction, via the RPC
 *  (CORS-open). The decoded deploy data carries the address once committed.
 *  Returns null while still pending so the caller keeps waiting, never redeploys.
 *
 *  An address here means only that the receipt names one. It does NOT mean a
 *  contract exists at it — see `verifyDeployment`. */
export async function recoverDeployedAddress(hash: string): Promise<string | null> {
  try {
    const tx = (await readClient().getTransaction({ hash: hash as never })) as unknown as {
      txDataDecoded?: { contractAddress?: string };
      data?: { contract_address?: string };
      recipient?: string;
    };
    return tx?.txDataDecoded?.contractAddress ?? tx?.data?.contract_address ?? null;
  } catch {
    return null;
  }
}

/** The finalized deploy receipt, reduced to the fields deployment verification
 *  needs. `contractAddress` is what the receipt claims; `recipient` is the
 *  envelope target. For a deploy they must agree — a divergence means the
 *  address cannot be trusted. */
export interface DeployReceipt {
  statusName: string;
  executionResultName: string;
  contractAddress: string | null;
  recipient: string | null;
  sender: string | null;
}

export async function readDeployReceipt(hash: string): Promise<DeployReceipt | null> {
  try {
    const tx = (await readClient().getTransaction({ hash: hash as never })) as unknown as {
      statusName?: string;
      txExecutionResultName?: string;
      txDataDecoded?: { contractAddress?: string };
      data?: { contract_address?: string };
      recipient?: string;
      sender?: string;
    };
    if (!tx) return null;
    return {
      statusName: String(tx.statusName ?? ''),
      executionResultName: String(tx.txExecutionResultName ?? ''),
      contractAddress: tx.txDataDecoded?.contractAddress ?? tx.data?.contract_address ?? null,
      recipient: tx.recipient ?? null,
      sender: tx.sender ?? null,
    };
  } catch {
    return null;
  }
}

/** Fetch a deployed contract's source. Throws when no contract exists at the
 *  address — which is exactly the signal that a receipt-named address is not a
 *  real deployment. */
export async function getContractCode(address: string): Promise<string> {
  return await readClient().getContractCode(address as `0x${string}`);
}

// ------------------------------------------------------------------- balances
export async function getBalance(address: string): Promise<bigint> {
  const c = readClient();
  return await c.getBalance({ address: address as `0x${string}` });
}

// ------------------------------------------------ contract-type validation
/** Confirm an address is actually an UptimeBond contract before importing it,
 *  by probing the view surface. A non-UptimeBond contract throws or returns a
 *  shape without the expected keys. */
export async function isUptimeBondContract(address: string): Promise<boolean> {
  try {
    const s = await readAgreement(address);
    return typeof s?.status === 'string'
      && typeof s?.customer === 'string'
      && typeof s?.provider === 'string'
      && 'escrow_atto' in s && 'resolution_mode' in s;
  } catch {
    return false;
  }
}

/** Deadlock config as pinned at construction (immutable). */
export async function readDeadlockConfig(address: string) {
  const c = readClient();
  return (await c.readContract({
    address: address as `0x${string}`,
    functionName: 'get_deadlock_config',
    args: [],
    jsonSafeReturn: true,
  })) as unknown as {
    deadlock_refund_bps: number;
    dispute_deadlock_seconds: number;
    insufficient_evidence_deadlock_seconds: number;
  };
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
