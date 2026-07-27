import { useEffect, useMemo, useState } from 'react';
import { EXPLORER } from '../config';
import { fmtGen, readEvidenceSources } from '../chain';
import { useWallet } from '../state/wallet';
import { useLiveAgreement, useWriteAction, roleFor } from '../state/hooks';
import { availableActions, type ActionDef } from '../lib/actions';
import { getAgreement, upsertAgreement } from '../lib/registry';
import { ConfirmDialog } from './ConfirmDialog';
import {
  Deadlock, EvidenceSources, LifecycleBar, Overview, Ruling, Settlement, StatusChip, TxProgress,
} from './Panels';

/** Full agreement detail. Live-state driven; every action is gated by the
 *  contract-confirmed role and the current status/deadlines. */
export function AgreementView({
  address, fundAtto, incidentWindow, compact, onReadable,
}: {
  address: string;
  fundAtto?: bigint;
  incidentWindow?: string;
  compact?: boolean;
  /** Reports whether a real agreement could be read at this address, so the
   *  page around it can withhold Invite and Save. A finalized deployment is
   *  not enough — the contract has to answer. */
  onReadable?: (readable: boolean) => void;
}) {
  const wallet = useWallet();
  const { st, settlement, deadlock, loading, error, degraded, refreshedAt, refresh } = useLiveAgreement(address);
  const write = useWriteAction(refresh);
  const [sources, setSources] = useState<Record<string, string> | null>(null);
  const [pending, setPending] = useState<ActionDef | null>(null);
  const [bps, setBps] = useState(5000);
  // open_dispute(incident_window) requires a non-empty string; the contract
  // rejects a blank one. Collected in the confirmation dialog, seeded from the
  // caller's suggestion when there is one.
  const [incident, setIncident] = useState(incidentWindow ?? '');

  // Retry is its own state machine. Deriving it from `error` alone cannot tell
  // "failed again with the same message" from "the click did nothing", which is
  // exactly how the previous Retry button appeared unresponsive.
  type Retry =
    | { phase: 'idle' } | { phase: 'busy' }
    | { phase: 'ok'; at: number } | { phase: 'fail'; at: number; message: string };
  const [retry, setRetry] = useState<Retry>({ phase: 'idle' });

  const runRetry = async () => {
    setRetry({ phase: 'busy' });
    const r = await refresh();
    setRetry(r.ok
      ? { phase: 'ok', at: Date.now() }
      : { phase: 'fail', at: Date.now(), message: r.error ?? 'unknown error' });
  };

  const role = roleFor(wallet.account, st);

  useEffect(() => { onReadable?.(Boolean(st)); }, [st, onReadable]);

  // Evidence sources live on-chain (immutable). Read once per address.
  useEffect(() => {
    let alive = true;
    readEvidenceSources(address).then((s) => { if (alive) setSources(s); }).catch(() => {});
    return () => { alive = false; };
  }, [address]);

  // Resume a persisted, still-in-flight transaction after a reload.
  useEffect(() => {
    const e = getAgreement(address);
    if (e?.pendingTx && write.tx.phase === 'idle') {
      write.resume(address, e.pendingTx.hash, e.pendingTx.method, e.pendingTx.startedAt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const actions = useMemo(() => {
    if (!st) return [];
    const escrow = st.status === 'AWAITING_FUNDING' ? fundAtto : BigInt(st.escrow_atto || '0');
    return availableActions({ st, deadlock, role, fundAtto: escrow, incidentWindow: incident });
  }, [st, deadlock, role, fundAtto, incident]);

  const canAct = Boolean(wallet.account) && !wallet.wrongChain && !write.busy;

  const runAction = (a: ActionDef) => {
    if (!wallet.account || !wallet.provider) return;
    let args = a.args;
    if (a.method === 'propose_mutual_settlement') args = [bps];
    if (a.method === 'open_dispute') {
      const w = incident.trim();
      if (!w) return; // The contract rejects an empty window; never submit one.
      args = [w];
    }
    void write.run({
      method: a.method, args, valueWei: a.valueWei,
      account: wallet.account, provider: wallet.provider, address,
    });
    if (a.method === 'accept_sla') upsertAgreement({ address, role: 'provider', source: 'invited' });
    setPending(null);
  };

  if (loading && !st) {
    return <div className="card"><div className="skeleton-lines"><span /><span /><span /></div></div>;
  }
  if (!st && error) {
    return (
      <div className="card">
        <div className="notice error" role="alert">
          <strong>No readable agreement at this address.</strong> {error}
          <p className="small" style={{ margin: '10px 0 0' }}>
            A finalized deployment does not guarantee a contract exists here. If this address
            never becomes readable, that transaction produced no usable agreement — do not fund
            it.
          </p>
        </div>

        <div className="hero-cta" style={{ marginTop: 4 }}>
          <button onClick={() => void runRetry()} disabled={retry.phase === 'busy'}>
            {retry.phase === 'busy' ? 'Checking…' : 'Check again'}
          </button>
          <a
            href={`${EXPLORER}/address/${address}`}
            target="_blank" rel="noopener noreferrer" className="btn-ghost"
          >
            Open in explorer ↗
          </a>
        </div>

        {/* The outcome of the last check, always rendered so a repeat failure
            is visibly a new result rather than a button that did nothing. */}
        <p className="retry-status" role="status" aria-live="polite">
          {retry.phase === 'busy' && 'Re-reading the contract from the network…'}
          {retry.phase === 'ok' && `Contract read successfully at ${new Date(retry.at).toLocaleTimeString()}.`}
          {retry.phase === 'fail'
            && `Still unreadable at ${new Date(retry.at).toLocaleTimeString()} — ${retry.message}`}
          {retry.phase === 'idle' && 'Not checked since the page loaded.'}
        </p>
      </div>
    );
  }
  if (!st) return null;

  return (
    <>
      {degraded && (
        <div className="notice warn" role="status">
          Network is responding slowly — showing the last confirmed state. Bradbury can be congested;
          reads will keep retrying.{refreshedAt && ` Last updated ${new Date(refreshedAt).toLocaleTimeString()}.`}
        </div>
      )}

      <Settlement st={st} settlement={settlement} />

      <div className="grid">
        <Overview cfg={{ address }} st={st} role={role === 'unknown' ? 'disconnected' : role} account={wallet.account ?? undefined} />
        <LifecycleBar status={st.status} />
      </div>

      {(actions.length > 0 || (wallet.account && role === 'observer')) && !compact && (
        <div className="card">
          <div className="settle-head" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Actions</h2>
            <StatusChip status={st.status} />
          </div>
          {!wallet.account && (
            <p className="notice">Connect your wallet to act as the customer or provider.</p>
          )}
          {wallet.account && wallet.wrongChain && (
            <p className="notice warn">Switch to Bradbury to act on this agreement.</p>
          )}
          {wallet.account && role === 'observer' && (
            <p className="notice">
              This wallet is not a party to this agreement. Only the registered customer or provider can act.
            </p>
          )}
          {actions.length > 0 && (
            <div className="actions">
              {actions.map((a) => (
                <div key={a.method + a.label} className="action">
                  <button
                    className={a.tone === 'danger' ? 'danger-btn' : a.tone === 'primary' ? '' : 'ghost'}
                    onClick={() => setPending(a)}
                    disabled={!canAct || !a.roles.includes(role)}
                  >
                    {a.label}
                  </button>
                  <p className="muted small">{a.consequence}</p>
                </div>
              ))}
            </div>
          )}
          {write.busy && (
            <p className="muted small" role="status">
              A transaction is in flight; further actions are disabled until it settles.
            </p>
          )}
        </div>
      )}

      <TxProgress tx={write.tx} onDismiss={write.reset} />

      <div className="grid">
        <Ruling st={st} />
        {sources
          ? <EvidenceSources sources={sources} />
          : <div className="card"><h2>Evidence</h2><div className="skeleton-lines"><span /><span /></div></div>}
      </div>

      {/* Chain mechanics stay available but visually secondary: the settlement,
          the parties and the actions above are what a party acts on. */}
      <details className="tech-detail">
        <summary>Technical detail — deadlock fallback, appeals and finality</summary>
        <div className="grid">
          <Deadlock dl={deadlock} />
          <div className="card">
            <h2>Appeals &amp; finality</h2>
            <p>
              There is no custom AI re-ruling method. Parties use GenLayer&apos;s native transaction
              appeal to re-adjudicate the <code>rule</code> transaction.
            </p>
            <p>
              Every payout is an EVM external message that executes at finalization by protocol
              behavior (there is no <code>on</code> parameter), so funds never move before the
              accepted decision is final. A ruling that is accepted but not yet finalized can still
              be overturned.
            </p>
            <p className="muted small">
              <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer">View contract on the explorer ↗</a>
            </p>
          </div>
        </div>
      </details>

      <ConfirmDialog
        open={!!pending}
        title={pending?.label ?? ''}
        tone={pending?.tone}
        confirmLabel={pending?.label}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && runAction(pending)}
        confirmDisabled={pending?.method === 'open_dispute' && !incident.trim()}
      >
        <p>{pending?.consequence}</p>
        {pending?.method === 'open_dispute' && (
          <label className="field" style={{ marginTop: 14, marginBottom: 4 }}>
            <span>Incident window</span>
            <input
              type="text"
              value={incident}
              onChange={(e) => setIncident(e.target.value)}
              placeholder="e.g. NimbusAPI May 2026 uptime dispute"
              aria-label="Incident window being disputed"
            />
            <em className="muted small">
              The period the validators will rule on. Recorded on-chain with the dispute
              and shown to both parties. Required.
            </em>
          </label>
        )}
        {pending?.method === 'propose_mutual_settlement' && (
          <label className="field" style={{ marginTop: 10 }}>
            <span>Customer refund: <strong>{(bps / 100).toFixed(0)}%</strong></span>
            <input
              type="range" min={0} max={10000} step={100} value={bps}
              onChange={(e) => setBps(Number(e.target.value))}
              aria-label="Customer refund percentage"
            />
          </label>
        )}
        {pending?.valueWei !== undefined && (
          <p className="notice">This is a payable transaction of <strong>{fmtGen(pending.valueWei)} GEN</strong> plus gas.</p>
        )}
        <p className="muted small">
          Testnet only. A transaction hash is not a confirmation — the app tracks it through
          consensus and finalization before reporting success.
        </p>
      </ConfirmDialog>
    </>
  );
}
