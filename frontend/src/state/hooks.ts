/** Reusable data + transaction hooks shared by the agreement and demo pages. */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  pollTx, readAgreement, readDeadlock, readSettlement, sendTx,
  type AgreementState, type DeadlockStatus, type SettlementStatus, type TxTracker,
} from '../chain';
import { clearPendingTx, setPendingTx, upsertAgreement, type RegistryRole } from '../lib/registry';
import { sameAddress } from '../lib/validation';

/**
 * Reduce an RPC error to the one line a person needs.
 *
 * viem and genlayer-js raise multi-line diagnostics ending in a library
 * version footer. Surfacing that verbatim buries the only part that matters —
 * "contract not found at address 0x…" — under boilerplate.
 */
export function readableError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  // The "Details:" line carries the address and the real cause; the first line
  // is usually a generic "Requested resource not found."
  const informative = lines.find((l) => /^Details:/i.test(l))
    ?? lines.find((l) => /not found|revert|timeout|denied|invalid/i.test(l))
    ?? lines[0] ?? raw;
  return informative
    .replace(/^Details:\s*/i, '')
    .replace(/\s*Version:\s*\S+\s*$/i, '')
    .trim();
}

export interface LiveAgreement {
  st: AgreementState | null;
  settlement: SettlementStatus | null;
  deadlock: DeadlockStatus | null;
  loading: boolean;
  error: string | null;
  degraded: boolean;
  refreshedAt: number | null;
  /** Resolves with the outcome of this read. Callers that surface a Retry
   *  control need it: `error` alone cannot distinguish "failed again with the
   *  same message" from "nothing happened", which is what made the old Retry
   *  button look dead. */
  refresh: () => Promise<{ ok: boolean; error?: string }>;
}

/** Live agreement reader with exponential backoff on transient RPC failure and
 *  a periodic refresh. Reads never auto-retry into an error state silently — a
 *  degraded flag surfaces so the UI can show a banner. */
export function useLiveAgreement(address: string | null, intervalMs = 20000): LiveAgreement {
  const [st, setSt] = useState<AgreementState | null>(null);
  const [settlement, setSettlement] = useState<SettlementStatus | null>(null);
  const [deadlock, setDeadlock] = useState<DeadlockStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const failures = useRef(0);

  const refresh = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!address) { setSt(null); setLoading(false); return { ok: false, error: 'No address.' }; }
    try {
      const [s, d, p] = await Promise.all([
        readAgreement(address),
        readDeadlock(address).catch(() => null),
        readSettlement(address).catch(() => null),
      ]);
      setSt(s); setDeadlock(d); setSettlement(p);
      setError(null); setDegraded(false); failures.current = 0;
      setRefreshedAt(Date.now());
      upsertAgreement({ address, lastStatus: s.status, lastOutcome: s.outcome || undefined, refreshedAt: Date.now() });
      return { ok: true };
    } catch (e) {
      failures.current += 1;
      setDegraded(failures.current >= 2);
      // Keep the last good state visible; only show error if we never loaded.
      const message = readableError(e);
      setError(message);
      return { ok: false, error: message };
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { setLoading(true); void refresh(); }, [refresh]);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const tick = () => {
      // Back off when failing: 20s, 40s, 80s, capped at 2m.
      const delay = Math.min(intervalMs * 2 ** Math.min(failures.current, 3), 120000);
      timer = window.setTimeout(async () => {
        if (cancelled) return;
        await refresh();
        tick();
      }, delay);
    };
    let timer = 0;
    tick();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [address, refresh, intervalMs]);

  return { st, settlement, deadlock, loading, error, degraded, refreshedAt, refresh };
}

export interface CaseSummary {
  st: AgreementState;
  settlement: SettlementStatus | null;
}

/**
 * One-shot read of several agreements at once, for summary displays such as
 * the homepage case studies. Deliberately does not poll: these are settled,
 * immutable outcomes, and a landing page should not hold an open read loop.
 * A contract that fails to read is simply omitted, never faked.
 */
export function useCaseSummaries(addresses: readonly string[]) {
  const [rows, setRows] = useState<Record<string, CaseSummary>>({});
  const [loading, setLoading] = useState(true);
  const key = addresses.join(',');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const list = key ? key.split(',') : [];
    void (async () => {
      const out: Record<string, CaseSummary> = {};
      await Promise.all(list.map(async (address) => {
        try {
          const [st, settlement] = await Promise.all([
            readAgreement(address),
            readSettlement(address).catch(() => null),
          ]);
          out[address] = { st, settlement };
        } catch {
          // Leave this address out; the card falls back to its pinned summary.
        }
      }));
      if (alive) { setRows(out); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [key]);

  return { rows, loading };
}

export interface WriteAction {
  tx: TxTracker;
  busy: boolean;
  run: (opts: {
    method: string; args?: unknown[]; valueWei?: bigint;
    account: string; provider: unknown; address: string;
  }) => Promise<void>;
  reset: () => void;
  /** Resume tracking a previously-submitted hash after a reload. */
  resume: (address: string, hash: string, method: string, startedAt: number) => void;
}

/** Runs a contract write and tracks it to finality. Persists the hash before
 *  awaiting so an interruption is recoverable, and never resubmits a write once
 *  a hash exists. */
export function useWriteAction(onSettled?: () => void): WriteAction {
  const [tx, setTx] = useState<TxTracker>({ phase: 'idle' });
  const pollRef = useRef<number | null>(null);
  const stop = () => { if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => stop, []);

  const track = useCallback((address: string, hash: string, method: string, startedAt: number) => {
    stop();
    pollRef.current = window.setInterval(async () => {
      const t = await pollTx(hash);
      setTx((prev) => ({ ...t, method, startedAt: prev.startedAt ?? startedAt }));
      if (t.phase === 'finalized' || t.phase === 'execution-error' || t.phase === 'failed') {
        stop();
        clearPendingTx(address);
        onSettled?.();
      } else if (t.phase === 'consensus-accepted') {
        onSettled?.();
      }
    }, 15000);
  }, [onSettled]);

  const run: WriteAction['run'] = useCallback(async ({ method, args, valueWei, account, provider, address }) => {
    stop();
    const startedAt = Date.now();
    setTx({ phase: 'awaiting-signature', method, startedAt });
    let hash: string;
    try {
      hash = await sendTx({ address, method, args, valueWei, account, provider });
    } catch (e) {
      const err = e as { code?: number; message?: string };
      const msg = err.code === 4001 ? 'Signature rejected in the wallet.' : (err.message ?? String(e));
      // No hash was issued, so nothing committed — safe to let the user retry.
      setTx({ phase: 'failed', method, error: `Not submitted: ${msg}`, startedAt });
      return;
    }
    setPendingTx(address, { hash, method, startedAt });
    setTx({ phase: 'submitted', method, hash, startedAt });
    track(address, hash, method, startedAt);
  }, [track]);

  const resume: WriteAction['resume'] = useCallback((address, hash, method, startedAt) => {
    setTx({ phase: 'submitted', method, hash, startedAt });
    track(address, hash, method, startedAt);
  }, [track]);

  const busy = tx.phase !== 'idle' && tx.phase !== 'finalized'
    && tx.phase !== 'execution-error' && tx.phase !== 'failed';

  return { tx, busy, run, reset: () => { stop(); setTx({ phase: 'idle' }); }, resume };
}

/** Determine the connected wallet's role from live contract state — never from
 *  local metadata. A wallet is a party only when the contract confirms it. */
export function roleFor(account: string | null, st: AgreementState | null): RegistryRole {
  if (!account || !st) return account ? 'observer' : 'unknown';
  if (sameAddress(account, st.customer)) return 'customer';
  if (sameAddress(account, st.provider)) return 'provider';
  return 'observer';
}
