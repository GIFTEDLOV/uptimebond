import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgreementState, DeployReceipt } from '../chain';

/**
 * Deployment verification regression suite.
 *
 * Built from two real failures on Bradbury:
 *
 *   0x771ab100…  FINALIZED + FINISHED_WITH_ERROR, no contract.
 *   0x0c8e748c…  FINALIZED + FINISHED_WITH_RETURN, all validators agree, the
 *                receipt names 0xc09d70CE…, and no contract has ever existed
 *                there. Balance zero, gen_getContractCode and gen_call both
 *                report "contract not found" hours after finalization.
 *
 * The second is the dangerous one: every signal short of reading the contract
 * back said success. So "finalized" and "finished with return" are necessary
 * and nowhere near sufficient, and these tests pin that.
 */

const receipt = vi.fn(async (): Promise<DeployReceipt | null> => null);
const code = vi.fn(async (): Promise<string> => '');
const state = vi.fn(async (): Promise<AgreementState> => ({} as AgreementState));

vi.mock('../chain', () => ({
  readDeployReceipt: () => receipt(),
  getContractCode: () => code(),
  readAgreement: () => state(),
}));

const { verifyDeployment } = await import('./deployment');

const SENDER = '0x456Ccff0d33463E1834F724C5C5971D6cff6f1dc';
const PROVIDER = '0x79DD8260773C7D5DEA701dfC2D3dD804FF041bf2';
const ADDR = '0xc09d70CE30BAd8ce8519C40Ef12C037B9cfBd99f';
const HASH = '0x0c8e748c6268cd68c05adb583e060bbae0af35c19e97f48302c13c61dbd9648a';

const okReceipt = (over: Partial<DeployReceipt> = {}): DeployReceipt => ({
  statusName: 'FINALIZED',
  executionResultName: 'FINISHED_WITH_RETURN',
  contractAddress: ADDR,
  recipient: ADDR,
  sender: SENDER,
  ...over,
});

const okState = (over: Partial<AgreementState> = {}): AgreementState => ({
  customer: SENDER, provider: PROVIDER, status: 'AWAITING_FUNDING', resolution_mode: '',
  escrow_atto: '0', incident_window: '', dispute_opened_at: 0, outcome: '', refund_bps: 0,
  maintenance_qualified: false, breached_clause_ids: [], ruling_reason: '',
  insufficient_evidence_ruled_at: 0, settlement_pending: false,
  settlement_proposer: '0x0000000000000000000000000000000000000000',
  settlement_refund_bps: 0, ...over,
});

const verify = () => verifyDeployment({ hash: HASH, sender: SENDER, provider: PROVIDER });
const checkFor = (v: Awaited<ReturnType<typeof verify>>, id: string) =>
  v.checks.find((c) => c.id === id);

describe('deployment verification', () => {
  beforeEach(() => {
    receipt.mockReset(); code.mockReset(); state.mockReset();
    receipt.mockResolvedValue(okReceipt());
    code.mockResolvedValue('# contract source');
    state.mockResolvedValue(okState());
  });

  it('accepts a genuinely deployed agreement', async () => {
    const v = await verify();
    expect(v.ok).toBe(true);
    expect(v.address).toBe(ADDR);
    expect(v.failed).toBeNull();
    expect(v.checks.every((c) => c.ok === true)).toBe(true);
    expect(v.state?.status).toBe('AWAITING_FUNDING');
  });

  it('rejects finalized + FINISHED_WITH_ERROR (tx 0x771ab100…)', async () => {
    receipt.mockResolvedValue(okReceipt({ executionResultName: 'FINISHED_WITH_ERROR' }));
    const v = await verify();
    expect(v.ok).toBe(false);
    expect(v.address).toBeNull();
    expect(v.failed?.id).toBe('execution');
    expect(v.executionResult).toBe('FINISHED_WITH_ERROR');
    // The contract must never be read after a failed execution.
    expect(code).not.toHaveBeenCalled();
    // Checks after the failure are "not reached", never silently passing.
    expect(checkFor(v, 'code')?.ok).toBeNull();
    expect(checkFor(v, 'status')?.ok).toBeNull();
  });

  it('rejects finalized + contract not found (tx 0x0c8e748c…)', async () => {
    code.mockRejectedValue(new Error('contract code not found at address'));
    const v = await verify();
    expect(v.ok).toBe(false);
    expect(v.address).toBeNull();
    expect(v.failed?.id).toBe('code');
    // Consensus and execution both looked perfect — that is the whole point.
    expect(checkFor(v, 'finalized')?.ok).toBe(true);
    expect(checkFor(v, 'execution')?.ok).toBe(true);
    // The claimed address is still reported, for the explorer link only.
    expect(v.claimedAddress).toBe(ADDR);
    expect(state).not.toHaveBeenCalled();
  });

  it('rejects a receipt whose address disagrees with the envelope recipient', async () => {
    receipt.mockResolvedValue(okReceipt({
      recipient: '0x1111111111111111111111111111111111111111',
    }));
    const v = await verify();
    expect(v.ok).toBe(false);
    expect(v.failed?.id).toBe('address');
    expect(code).not.toHaveBeenCalled();
  });

  it('rejects a contract that exists but belongs to someone else', async () => {
    state.mockResolvedValue(okState({ customer: '0x2222222222222222222222222222222222222222' }));
    const v = await verify();
    expect(v.ok).toBe(false);
    expect(v.failed?.id).toBe('customer');
    expect(v.address).toBeNull();
  });

  it('rejects a contract carrying a different provider than we submitted', async () => {
    state.mockResolvedValue(okState({ provider: '0x3333333333333333333333333333333333333333' }));
    const v = await verify();
    expect(v.ok).toBe(false);
    expect(v.failed?.id).toBe('provider');
  });

  it('rejects an agreement that is not awaiting funding', async () => {
    state.mockResolvedValue(okState({ status: 'RESOLVED' }));
    const v = await verify();
    expect(v.ok).toBe(false);
    expect(v.failed?.id).toBe('status');
  });

  it('rejects a transaction that is not finalized yet', async () => {
    receipt.mockResolvedValue(okReceipt({ statusName: 'ACCEPTED' }));
    const v = await verify();
    expect(v.ok).toBe(false);
    expect(v.failed?.id).toBe('finalized');
  });

  it('rejects an unreadable transaction without throwing', async () => {
    receipt.mockResolvedValue(null);
    const v = await verify();
    expect(v.ok).toBe(false);
    expect(v.failed?.id).toBe('finalized');
  });

  it('rejects a receipt that names no address at all', async () => {
    receipt.mockResolvedValue(okReceipt({ contractAddress: null, recipient: null }));
    const v = await verify();
    expect(v.ok).toBe(false);
    expect(v.failed?.id).toBe('address');
    expect(v.claimedAddress).toBeNull();
  });

  it('never returns an address unless every check passed', async () => {
    const failures: Array<() => void> = [
      () => receipt.mockResolvedValue(okReceipt({ executionResultName: 'FINISHED_WITH_ERROR' })),
      () => code.mockRejectedValue(new Error('not found')),
      () => state.mockRejectedValue(new Error('no answer')),
      () => state.mockResolvedValue(okState({ status: 'ACTIVE' })),
    ];
    for (const apply of failures) {
      receipt.mockResolvedValue(okReceipt());
      code.mockResolvedValue('# contract source');
      state.mockResolvedValue(okState());
      apply();
      const v = await verify();
      expect(v.ok).toBe(false);
      expect(v.address).toBeNull();
      expect(v.state).toBeNull();
    }
  });
});
