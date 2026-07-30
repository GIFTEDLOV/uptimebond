import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSupersededStatus } from './hooks';
import { upsertAgreement } from '../lib/registry';

/**
 * Cross-tab staleness.
 *
 * Two tabs on one agreement share no React state. During the pilot a provider
 * tab held RULED while the customer released from another tab; the contract
 * reached RESOLVED and the stale tab kept offering Release until its next poll.
 * Every tab records the status and read time it observed in the shared registry,
 * so another tab's read is an immediate signal here rather than a 20-second
 * window.
 */

const ADDRESS = '0x965C9B454867273F612BD48d181Ec418391750d5';

/** What a write from another tab looks like to this one: localStorage already
 *  holds the new value, and the browser raises `storage`. */
const otherTabRead = (status: string, at: number) => {
  upsertAgreement({ address: ADDRESS, lastStatus: status, refreshedAt: at });
  window.dispatchEvent(new Event('storage'));
};

describe('useSupersededStatus', () => {
  beforeEach(() => { localStorage.clear(); });

  it('reports a newer status read by another tab', () => {
    const readAt = Date.now();
    const { result } = renderHook(() => useSupersededStatus(ADDRESS, 'RULED', readAt));
    expect(result.current).toBeNull();

    act(() => { otherTabRead('RESOLVED', readAt + 1000); });
    expect(result.current).toBe('RESOLVED');
  });

  it('stays null while the other tab agrees', () => {
    const readAt = Date.now();
    const { result } = renderHook(() => useSupersededStatus(ADDRESS, 'RULED', readAt));

    act(() => { otherTabRead('RULED', readAt + 1000); });
    expect(result.current).toBeNull();
  });

  it('ignores a registry entry older than this tab’s own read', () => {
    // A leftover entry from an earlier session is not news, it is history —
    // treating it as a supersede would suppress every action on load.
    const readAt = Date.now();
    act(() => { otherTabRead('RULED', readAt - 60000); });

    const { result } = renderHook(() => useSupersededStatus(ADDRESS, 'RESOLVED', readAt));
    expect(result.current).toBeNull();
  });

  it('clears once this tab catches up to the newer status', () => {
    const readAt = Date.now();
    const { result, rerender } = renderHook(
      ({ current, at }: { current: string; at: number }) =>
        useSupersededStatus(ADDRESS, current, at),
      { initialProps: { current: 'RULED', at: readAt } },
    );

    act(() => { otherTabRead('RESOLVED', readAt + 1000); });
    expect(result.current).toBe('RESOLVED');

    // This tab re-reads the contract and sees RESOLVED too.
    rerender({ current: 'RESOLVED', at: readAt + 2000 });
    expect(result.current).toBeNull();
  });

  it('also reacts to a write from this same tab', () => {
    // Same-window localStorage writes raise no `storage` event, which is why the
    // registry dispatches its own — two views of one agreement in one tab must
    // not diverge either.
    const readAt = Date.now();
    const { result } = renderHook(() => useSupersededStatus(ADDRESS, 'RULED', readAt));

    act(() => {
      upsertAgreement({ address: ADDRESS, lastStatus: 'RESOLVED', refreshedAt: readAt + 1000 });
    });
    expect(result.current).toBe('RESOLVED');
  });

  it('reports nothing when there is no address or no state in hand', () => {
    const readAt = Date.now();
    act(() => { otherTabRead('RESOLVED', readAt + 1000); });

    expect(renderHook(() => useSupersededStatus(null, 'RULED', readAt)).result.current).toBeNull();
    expect(renderHook(() => useSupersededStatus(ADDRESS, null, readAt)).result.current).toBeNull();
  });
});
