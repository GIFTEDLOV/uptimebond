import { describe, it, expect } from 'vitest';
import { checkPostcondition, providerRoleConfirmed } from './postconditions';
import type { AgreementState, SettlementStatus } from '../chain';

/**
 * A finalized transaction with FINISHED_WITH_RETURN proves the code ran, not
 * that it did what was asked. Deploy 0x0c8e748c… finalized successfully and
 * produced no contract; a settlement can finalize with the escrow still in the
 * contract because payouts execute later. Each action states what must be true
 * afterwards, and success is reported only when that is observed.
 */

const CUST = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PROV = '0x06BBFc5F5A06953fFDB117DB376302d6Bd80eBdc';

const st = (over: Partial<AgreementState> = {}): AgreementState => ({
  customer: CUST, provider: PROV, status: 'ACTIVE', resolution_mode: '',
  escrow_atto: '10000000000000000', incident_window: '', dispute_opened_at: 0,
  outcome: '', refund_bps: 0, maintenance_qualified: false, breached_clause_ids: [],
  ruling_reason: '', insufficient_evidence_ruled_at: 0, settlement_pending: false,
  settlement_proposer: '0x0000000000000000000000000000000000000000',
  settlement_refund_bps: 0, ...over,
});

const settled = (over: Partial<SettlementStatus> = {}): SettlementStatus => ({
  status: 'RESOLVED', settlement_queued: true, payout_complete: true,
  contract_balance_atto: '0', escrow_atto: '10000000000000000',
  expected_customer_atto: '2500000000000000', expected_provider_atto: '7500000000000000',
  ...over,
});

describe('fund postcondition', () => {
  it('accepts the escrow actually being held', () => {
    const r = checkPostcondition({
      method: 'fund',
      st: st({ status: 'AWAITING_PROVIDER_ACCEPTANCE' }),
      settlement: settled({ contract_balance_atto: '10000000000000000', payout_complete: false }),
      expected: { escrowAtto: '10000000000000000' },
    });
    expect(r.ok).toBe(true);
  });

  it('rejects a status that did not advance', () => {
    const r = checkPostcondition({
      method: 'fund', st: st({ status: 'AWAITING_FUNDING' }), settlement: null,
      expected: { escrowAtto: '10000000000000000' },
    });
    expect(r.ok).toBe(false);
  });

  it('rejects an escrow that is not the amount we sent', () => {
    const r = checkPostcondition({
      method: 'fund',
      st: st({ status: 'AWAITING_PROVIDER_ACCEPTANCE', escrow_atto: '100000000000000000' }),
      settlement: null,
      expected: { escrowAtto: '10000000000000000' }, // 0.01 sent, 0.1 recorded
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/not the 10000000000000000 sent/);
  });

  it('rejects a recorded escrow the contract does not actually hold', () => {
    const r = checkPostcondition({
      method: 'fund',
      st: st({ status: 'AWAITING_PROVIDER_ACCEPTANCE' }),
      settlement: settled({ contract_balance_atto: '0', payout_complete: false }),
      expected: { escrowAtto: '10000000000000000' },
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/funds are not there/i);
  });
});

describe('lifecycle postconditions', () => {
  it('accept requires ACTIVE', () => {
    expect(checkPostcondition({ method: 'accept_sla', st: st({ status: 'ACTIVE' }), settlement: null }).ok).toBe(true);
    expect(checkPostcondition({ method: 'accept_sla', st: st({ status: 'AWAITING_PROVIDER_ACCEPTANCE' }), settlement: null }).ok).toBe(false);
  });

  it('dispute requires DISPUTED and the incident window we submitted', () => {
    const good = checkPostcondition({
      method: 'open_dispute', st: st({ status: 'DISPUTED', incident_window: 'May 2026' }),
      settlement: null, expected: { incidentWindow: 'May 2026' },
    });
    expect(good.ok).toBe(true);
    const wrong = checkPostcondition({
      method: 'open_dispute', st: st({ status: 'DISPUTED', incident_window: 'April 2026' }),
      settlement: null, expected: { incidentWindow: 'May 2026' },
    });
    expect(wrong.ok).toBe(false);
  });

  it('rule requires RULED and one of the four valid outcomes', () => {
    expect(checkPostcondition({
      method: 'rule', st: st({ status: 'RULED', outcome: 'PARTIAL_REFUND', refund_bps: 2500 }), settlement: null,
    }).ok).toBe(true);
    expect(checkPostcondition({
      method: 'rule', st: st({ status: 'RULED', outcome: '' }), settlement: null,
    }).ok).toBe(false);
    expect(checkPostcondition({
      method: 'rule', st: st({ status: 'RULED', outcome: 'SOMETHING_ELSE' }), settlement: null,
    }).ok).toBe(false);
  });

  it('release requires RESOLVED and a completed payout, not just a status', () => {
    expect(checkPostcondition({
      method: 'release', st: st({ status: 'RESOLVED' }), settlement: settled(),
    }).ok).toBe(true);

    // RESOLVED with the escrow still in the contract is queued, not paid.
    const queued = checkPostcondition({
      method: 'release', st: st({ status: 'RESOLVED' }),
      settlement: settled({ payout_complete: false, contract_balance_atto: '10000000000000000' }),
    });
    expect(queued.ok).toBe(false);
    expect(queued.detail).toMatch(/has not completed/);
  });

  it('mutual settlement and deadlock require their own resolution modes', () => {
    expect(checkPostcondition({
      method: 'accept_mutual_settlement',
      st: st({ status: 'RESOLVED', resolution_mode: 'MUTUAL_SETTLEMENT' }), settlement: settled(),
    }).ok).toBe(true);
    expect(checkPostcondition({
      method: 'accept_mutual_settlement',
      st: st({ status: 'RESOLVED', resolution_mode: 'DEADLOCK_FALLBACK' }), settlement: settled(),
    }).ok).toBe(false);
    expect(checkPostcondition({
      method: 'resolve_deadlock',
      st: st({ status: 'RESOLVED', resolution_mode: 'DEADLOCK_FALLBACK' }), settlement: settled(),
    }).ok).toBe(true);
  });

  it('an unknown method asserts nothing rather than claiming success', () => {
    expect(checkPostcondition({ method: 'whatever', st: st(), settlement: null }).ok).toBeNull();
  });
});

describe('provider role is only recorded once the contract confirms it', () => {
  it('is false while acceptance is merely submitted', () => {
    expect(providerRoleConfirmed(st({ status: 'AWAITING_PROVIDER_ACCEPTANCE' }), PROV)).toBe(false);
  });
  it('is false for a wallet that is not the registered provider', () => {
    expect(providerRoleConfirmed(st({ status: 'ACTIVE' }), CUST)).toBe(false);
  });
  it('is true only when ACTIVE and the connected wallet is the provider', () => {
    expect(providerRoleConfirmed(st({ status: 'ACTIVE' }), PROV)).toBe(true);
    expect(providerRoleConfirmed(st({ status: 'ACTIVE' }), PROV.toLowerCase())).toBe(true);
  });
  it('is false with no state at all', () => {
    expect(providerRoleConfirmed(null, PROV)).toBe(false);
  });
});
