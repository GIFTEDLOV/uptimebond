import { describe, it, expect } from 'vitest';
import { preflightAction } from './preflight';
import type { AgreementState } from '../chain';
import type { ActionContext } from './actions';

/**
 * The last check before a signature.
 *
 * `availableActions` is only as fresh as the state it was given. This function
 * re-derives availability from a state just read, and is what stops a tab
 * holding RULED from submitting a release the contract has already refused.
 */

const CUST = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PROV = '0x06BBFc5F5A06953fFDB117DB376302d6Bd80eBdc';

const state = (over: Partial<AgreementState> = {}): AgreementState => ({
  customer: CUST, provider: PROV, status: 'RULED', resolution_mode: '',
  escrow_atto: '10000000000000000', incident_window: '', dispute_opened_at: 0,
  outcome: 'FULL_REFUND', refund_bps: 10000, maintenance_qualified: false,
  breached_clause_ids: [], ruling_reason: '', insufficient_evidence_ruled_at: 0,
  settlement_pending: false,
  settlement_proposer: '0x0000000000000000000000000000000000000000',
  settlement_refund_bps: 0,
  ...over,
});

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({
  st: state(), deadlock: null, role: 'customer', ...over,
});

describe('preflightAction', () => {
  it('returns the action when it is still available', () => {
    const r = preflightAction({ method: 'release', live: { ok: true }, ctx: ctx() });
    expect(r.ok).toBe(true);
    expect(r.ok && r.action.method).toBe('release');
  });

  it('re-derives the action from live state rather than trusting the caller', () => {
    // The label and payable value come from the fresh derivation; a stale copy
    // captured when the button rendered is never used to build the write.
    const r = preflightAction({
      method: 'fund',
      live: { ok: true },
      ctx: ctx({ st: state({ status: 'AWAITING_FUNDING', outcome: '' }), fundAtto: 42n }),
    });
    expect(r.ok && r.action.valueWei).toBe(42n);
  });

  it('aborts when the agreement has moved past the action', () => {
    const r = preflightAction({
      method: 'release',
      live: { ok: true },
      ctx: ctx({ st: state({ status: 'RESOLVED', resolution_mode: 'RULING_RELEASE' }) }),
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/no longer available/);
    expect(!r.ok && r.reason).toMatch(/RESOLVED/);
    expect(!r.ok && r.reason).toMatch(/nothing was signed and nothing was spent/i);
  });

  it('aborts when the wallet is not a party', () => {
    const r = preflightAction({ method: 'release', live: { ok: true }, ctx: ctx({ role: 'observer' }) });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/observer/);
  });

  it('aborts when the read failed — unconfirmed is not available', () => {
    const r = preflightAction({
      method: 'release',
      live: { ok: false, error: 'contract not found at address' },
      ctx: null,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/could not be confirmed/i);
    expect(!r.ok && r.reason).toMatch(/contract not found/);
  });

  it('aborts when the read succeeded but produced no state', () => {
    const r = preflightAction({ method: 'release', live: { ok: true }, ctx: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/could not be confirmed/i);
  });
});
