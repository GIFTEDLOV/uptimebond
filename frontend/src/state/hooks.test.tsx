import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { AgreementState } from '../chain';

/**
 * Cross-address contamination and overlapping polls.
 *
 * The reader previously kept whatever it last set until a new read replaced it,
 * and polled with setInterval. Both are unsafe with real RPC latency: a slow
 * read of agreement A lands after a fast read of B and paints A's escrow,
 * status and payouts under B's address, and a fixed interval keeps firing while
 * a read is still in flight so responses arrive out of order.
 */

const CUST = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PROV = '0x06BBFc5F5A06953fFDB117DB376302d6Bd80eBdc';
const A = '0x965C9B454867273F612BD48d181Ec418391750d5';
const B = '0xa0c10C656692B4A8E44357d342C38C3DEEE2cFFe';

const state = (over: Partial<AgreementState>): AgreementState => ({
  customer: CUST, provider: PROV, status: 'ACTIVE', resolution_mode: '',
  escrow_atto: '0', incident_window: '', dispute_opened_at: 0, outcome: '', refund_bps: 0,
  maintenance_qualified: false, breached_clause_ids: [], ruling_reason: '',
  insufficient_evidence_ruled_at: 0, settlement_pending: false,
  settlement_proposer: '0x0000000000000000000000000000000000000000',
  settlement_refund_bps: 0, ...over,
});

/** Per-address deferred reads, so ordering can be controlled precisely. */
const pending = new Map<string, Array<(s: AgreementState) => void>>();
const readCalls: string[] = [];

const readAgreement = vi.fn((address: string) => {
  readCalls.push(address);
  return new Promise<AgreementState>((resolve) => {
    const q = pending.get(address) ?? [];
    q.push(resolve);
    pending.set(address, q);
  });
});
const resolveFor = (address: string, s: AgreementState) => {
  const q = pending.get(address) ?? [];
  const next = q.shift();
  pending.set(address, q);
  next?.(s);
};

vi.mock('../chain', () => ({
  readAgreement: (a: string) => readAgreement(a),
  readDeadlock: async () => null,
  readSettlement: async () => null,
  pollTx: async () => ({ phase: 'submitted' as const }),
  sendTx: async () => '0x',
}));
vi.mock('../lib/registry', () => ({
  upsertAgreement: vi.fn(), setPendingTx: vi.fn(), clearPendingTx: vi.fn(),
}));

const { useLiveAgreement } = await import('./hooks');

beforeEach(() => { pending.clear(); readCalls.length = 0; readAgreement.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

describe('address isolation', () => {
  it('state from address A can never appear under address B', async () => {
    const { result, rerender } = renderHook(
      ({ addr }: { addr: string }) => useLiveAgreement(addr),
      { initialProps: { addr: A } },
    );

    await act(async () => { resolveFor(A, state({ escrow_atto: '111', status: 'DISPUTED' })); });
    await waitFor(() => expect(result.current.st?.escrow_atto).toBe('111'));

    // Navigate to a different agreement.
    rerender({ addr: B });

    // A's state must be gone immediately — not left on screen under B.
    expect(result.current.st).toBeNull();
    expect(result.current.settlement).toBeNull();
    expect(result.current.deadlock).toBeNull();
    expect(result.current.error).toBeNull();

    await act(async () => { resolveFor(B, state({ escrow_atto: '222', status: 'ACTIVE' })); });
    await waitFor(() => expect(result.current.st?.escrow_atto).toBe('222'));
    expect(result.current.st?.status).toBe('ACTIVE');
  });

  it('a slow response for A cannot overwrite a fast response for B', async () => {
    const { result, rerender } = renderHook(
      ({ addr }: { addr: string }) => useLiveAgreement(addr),
      { initialProps: { addr: A } },
    );
    // A's read is in flight and deliberately not resolved yet.
    rerender({ addr: B });

    await act(async () => { resolveFor(B, state({ escrow_atto: '222' })); });
    await waitFor(() => expect(result.current.st?.escrow_atto).toBe('222'));

    // Now A finally answers — far too late. It must be discarded.
    await act(async () => { resolveFor(A, state({ escrow_atto: '111', status: 'RESOLVED' })); });
    await new Promise((r) => setTimeout(r, 20));

    expect(result.current.st?.escrow_atto).toBe('222');
    expect(result.current.st?.status).not.toBe('RESOLVED');
  });

  it('a stale failure for A cannot put an error on B', async () => {
    const { result, rerender } = renderHook(
      ({ addr }: { addr: string }) => useLiveAgreement(addr),
      { initialProps: { addr: A } },
    );
    rerender({ addr: B });
    await act(async () => { resolveFor(B, state({ escrow_atto: '222' })); });
    await waitFor(() => expect(result.current.st?.escrow_atto).toBe('222'));

    // A's read rejects after the switch.
    await act(async () => {
      const q = pending.get(A) ?? [];
      q.length = 0;
      readAgreement.mockRejectedValueOnce(new Error('contract not found'));
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.error).toBeNull();
    expect(result.current.st?.escrow_atto).toBe('222');
  });
});

describe('polling never overlaps', () => {
  // Real timers with a short interval. Fake timers deadlock React's scheduler
  // under renderHook, and the property under test — that a poll never starts
  // while one is in flight — is about real concurrency anyway.
  const settle = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

  it('does not start a second read while one is in flight', async () => {
    const { unmount } = renderHook(() => useLiveAgreement(A, 25));
    await waitFor(() => expect(readCalls.filter((a) => a === A).length).toBe(1));

    // Never answer the first read, and let many intervals elapse.
    await settle(300);

    // setInterval would have stacked roughly a dozen concurrent reads by now.
    expect(readCalls.filter((a) => a === A).length).toBe(1);
    unmount();
  });

  it('stops polling after unmount', async () => {
    const { unmount } = renderHook(() => useLiveAgreement(A, 25));
    await waitFor(() => expect(readCalls.length).toBe(1));
    await act(async () => { resolveFor(A, state({})); });
    await settle(60);

    unmount();
    const before = readCalls.length;
    await settle(200);
    expect(readCalls.length).toBe(before);
  });
});
