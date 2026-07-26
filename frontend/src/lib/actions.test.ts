import { describe, it, expect } from 'vitest';
import { availableActions } from './actions';
import type { AgreementState, DeadlockStatus } from '../chain';

const CUST = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PROV = '0x06BBFc5F5A06953fFDB117DB376302d6Bd80eBdc';

function state(over: Partial<AgreementState>): AgreementState {
  return {
    customer: CUST, provider: PROV, status: 'ACTIVE', resolution_mode: '',
    escrow_atto: '100000000000000000', incident_window: '', dispute_opened_at: 0,
    outcome: '', refund_bps: 0, maintenance_qualified: false, breached_clause_ids: [],
    ruling_reason: '', insufficient_evidence_ruled_at: 0, settlement_pending: false,
    settlement_proposer: '0x0000000000000000000000000000000000000000', settlement_refund_bps: 0,
    ...over,
  };
}
const methods = (st: AgreementState, role: 'customer' | 'provider' | 'observer', dl: DeadlockStatus | null = null) =>
  availableActions({ st, role, deadlock: dl }).map((a) => a.method);

describe('action availability', () => {
  it('AWAITING_FUNDING: customer funds or cancels; provider sees nothing', () => {
    const st = state({ status: 'AWAITING_FUNDING' });
    expect(methods(st, 'customer')).toEqual(['fund', 'cancel_before_acceptance']);
    expect(methods(st, 'provider')).toEqual([]);
  });
  it('AWAITING_PROVIDER_ACCEPTANCE: only provider accepts; customer can cancel', () => {
    const st = state({ status: 'AWAITING_PROVIDER_ACCEPTANCE' });
    expect(methods(st, 'provider')).toContain('accept_sla');
    expect(methods(st, 'customer')).toEqual(['cancel_before_acceptance']);
    expect(methods(st, 'observer')).toEqual([]);
  });
  it('ACTIVE: customer approves or disputes; provider only disputes', () => {
    const st = state({ status: 'ACTIVE' });
    expect(methods(st, 'customer')).toEqual(['approve_service', 'open_dispute']);
    expect(methods(st, 'provider')).toEqual(['open_dispute']);
  });
  it('DISPUTED: parties can rule; observer cannot', () => {
    const st = state({ status: 'DISPUTED' });
    expect(methods(st, 'customer')).toEqual(['rule']);
    expect(methods(st, 'observer')).toEqual([]);
  });
  it('RULED settleable: parties can release', () => {
    const st = state({ status: 'RULED', outcome: 'PARTIAL_REFUND', refund_bps: 2500 });
    expect(methods(st, 'provider')).toEqual(['release']);
  });
  it('RULED insufficient evidence: no release, only mutual settlement', () => {
    const st = state({ status: 'RULED', outcome: 'INSUFFICIENT_EVIDENCE' });
    const m = methods(st, 'customer');
    expect(m).not.toContain('release');
    expect(m).toContain('propose_mutual_settlement');
  });
  it('mutual settlement: only the counterparty can accept a pending proposal', () => {
    const st = state({
      status: 'RULED', outcome: 'INSUFFICIENT_EVIDENCE',
      settlement_pending: true, settlement_proposer: CUST, settlement_refund_bps: 4000,
    });
    expect(methods(st, 'provider')).toContain('accept_mutual_settlement');
    expect(methods(st, 'customer')).not.toContain('accept_mutual_settlement');
    expect(methods(st, 'customer')).toContain('propose_mutual_settlement'); // proposer may revise
  });
  it('RESOLVED: no actions', () => {
    expect(methods(state({ status: 'RESOLVED', outcome: 'FULL_REFUND' }), 'customer')).toEqual([]);
  });
  it('deadlock offered only when the contract says available', () => {
    const st = state({ status: 'DISPUTED' });
    const dl: DeadlockStatus = {
      status: 'DISPUTED', now: 0, dispute_opened_at: 0, insufficient_evidence_ruled_at: 0,
      applicable_deadline: 0, resolve_deadlock_available: true, deadlock_refund_bps: 5000,
    };
    expect(methods(st, 'customer', dl)).toContain('resolve_deadlock');
    expect(methods(st, 'customer', { ...dl, resolve_deadlock_available: false })).not.toContain('resolve_deadlock');
  });
  it('never offers a payable action to an observer', () => {
    const st = state({ status: 'AWAITING_FUNDING' });
    expect(methods(st, 'observer')).toEqual([]);
  });
});
