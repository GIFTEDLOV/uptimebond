import { useEffect, useMemo, useState } from 'react';
import { EXPLORER } from '../config';
import { fmtGen, readEvidenceSources } from '../chain';
import { useWallet } from '../state/wallet';
import { useLiveAgreement, useWriteAction, roleFor } from '../state/hooks';
import { availableActions, type ActionDef } from '../lib/actions';
import { getAgreement, upsertAgreement } from '../lib/registry';
import { preflightAction } from '../lib/preflight';
import {
  checkPostcondition, providerRoleConfirmed, rejectionSummary, type PostconditionResult,
} from '../lib/postconditions';
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
  const {
    st, settlement, deadlock, loading, error, degraded, refreshedAt, supersededBy, refresh,
  } = useLiveAgreement(address);
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

  /** The last write submitted from this view: what it intended, and the exact
   *  transaction that carries it. The hash is what the postcondition is keyed
   *  on — a method name alone is not unique across a session. */
  const [lastAction, setLastAction] =
    useState<{ method: string; hash: string; incidentWindow?: string } | null>(null);

  /**
   * A postcondition, welded to the transaction it was computed for.
   *
   * Holding only the result meant the effect below re-derived it from whatever
   * state was current: an `accept_sla` postcondition computed at ACTIVE was
   * recomputed after the ruling and the release, and then rendered under the
   * release transaction's heading claiming the wrong thing about the wrong
   * write. It is now computed exactly once per hash and shown only while that
   * transaction is the one being tracked.
   */
  const [postcondition, setPostcondition] =
    useState<{ hash: string; method: string; result: PostconditionResult } | null>(null);

  /** The method currently being re-checked against live state, if any. */
  const [checking, setChecking] = useState<string | null>(null);
  /** A write abandoned by the pre-submit check, and why. */
  const [aborted, setAborted] = useState<{ method: string; reason: string; at: number } | null>(null);

  // A different contract invalidates everything held about the previous one:
  // the pending dialog, the retry outcome, the last action and its
  // postcondition all belong to an address that is no longer on screen.
  useEffect(() => {
    setPending(null);
    setRetry({ phase: 'idle' });
    setLastAction(null);
    setPostcondition(null);
    setAborted(null);
    setChecking(null);
    setSources(null);
    setIncident(incidentWindow ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const runRetry = async () => {
    setRetry({ phase: 'busy' });
    const r = await refresh();
    setRetry(r.ok
      ? { phase: 'ok', at: Date.now() }
      : { phase: 'fail', at: Date.now(), message: r.error ?? 'unknown error' });
  };

  const role = roleFor(wallet.account, st);

  useEffect(() => { onReadable?.(Boolean(st)); }, [st, onReadable]);

  // A newer status seen by another tab also invalidates an open confirmation
  // dialog: it was opened against state that no longer holds, and leaving it up
  // invites a confirmation click on a withdrawn action.
  useEffect(() => { if (supersededBy) setPending(null); }, [supersededBy]);

  // Record the provider role only once the contract confirms it.
  useEffect(() => {
    if (providerRoleConfirmed(st, wallet.account)) {
      upsertAgreement({ address, role: 'provider', source: 'invited' });
    }
  }, [st, wallet.account, address]);

  // Once a write finalizes, assert what it was supposed to achieve. A
  // successful execution result is not the same as the intended state change.
  //
  // Computed once, for one hash, and never again: a postcondition is a statement
  // about the state immediately after *that* transaction, so re-running it
  // against later state turns a true claim about the past into a false claim
  // about the present.
  useEffect(() => {
    if (!lastAction || !st) { return; }
    if (write.tx.hash !== lastAction.hash || write.tx.method !== lastAction.method) { return; }
    if (write.tx.phase !== 'finalized' || !write.tx.succeeded) { return; }
    if (postcondition?.hash === lastAction.hash) { return; }
    setPostcondition({
      hash: lastAction.hash,
      method: lastAction.method,
      result: checkPostcondition({
        method: lastAction.method,
        st,
        settlement,
        expected: {
          escrowAtto: fundAtto?.toString(),
          incidentWindow: lastAction.incidentWindow,
          sender: wallet.account ?? undefined,
        },
      }),
    });
  }, [
    write.tx.phase, write.tx.succeeded, write.tx.hash, write.tx.method,
    st, settlement, lastAction, postcondition, fundAtto, wallet.account,
  ]);

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
    // Another tab has read a status this one has not caught up to. Offering
    // anything derived from the state in hand would be offering an action
    // against a contract that has already moved — Release after RESOLVED being
    // the exact case. Nothing is offered until the two agree again.
    if (supersededBy) return [];
    const escrow = st.status === 'AWAITING_FUNDING' ? fundAtto : BigInt(st.escrow_atto || '0');
    return availableActions({ st, deadlock, role, fundAtto: escrow, incidentWindow: incident });
  }, [st, deadlock, role, fundAtto, incident, supersededBy]);

  const canAct = Boolean(wallet.account) && !wallet.wrongChain && !write.busy && !checking;

  /**
   * Re-read the contract and re-derive whether `method` is still callable.
   *
   * The freshly read snapshot comes back from `refresh()` directly rather than
   * being read off `st` — the hook's state has not re-rendered yet at this
   * point, so `st` here is still the stale value this check exists to reject.
   */
  const preflight = async (method: string) => {
    const live = await refresh();
    const fresh = live.st ?? null;
    const freshRole = roleFor(wallet.account, fresh);
    return preflightAction({
      method,
      live,
      ctx: fresh
        ? {
          st: fresh,
          deadlock: live.deadlock ?? null,
          role: freshRole,
          fundAtto: fresh.status === 'AWAITING_FUNDING' ? fundAtto : BigInt(fresh.escrow_atto || '0'),
          incidentWindow: incident,
        }
        : null,
    });
  };

  /**
   * Begin an action: retire everything reported about the previous one, then
   * re-establish that this one is still available. Returns the action as
   * re-derived from live state, or null if it was abandoned.
   *
   * Both entry points go through here — opening the dialog and submitting the
   * write — because they are separated by however long the user takes to read
   * it, which is exactly the window the incident fell through.
   */
  const beginAction = async (a: ActionDef): Promise<ActionDef | null> => {
    setPostcondition(null);
    setAborted(null);
    setChecking(a.method);
    const pre = await preflight(a.method);
    setChecking(null);
    if (pre.ok) return pre.action;
    setPending(null);
    setAborted({ method: a.method, reason: pre.reason, at: Date.now() });
    return null;
  };

  /** Open the confirmation dialog — but only for an action live state still
   *  offers. */
  const requestAction = async (a: ActionDef) => {
    const fresh = await beginAction(a);
    if (fresh) setPending(fresh);
  };

  /** Submit the write, re-checking availability one last time. The dialog can
   *  sit open for minutes; the state it was opened against is not a promise. */
  const submitAction = async (a: ActionDef) => {
    if (!wallet.account || !wallet.provider) return;
    // Use the action as re-derived from live state, never the copy captured when
    // the dialog opened: its payable value and arguments came from state that is
    // now known to be older.
    const fresh = await beginAction(a);
    if (!fresh) return;

    let args = fresh.args;
    if (fresh.method === 'propose_mutual_settlement') args = [bps];
    if (fresh.method === 'open_dispute') {
      const w = incident.trim();
      if (!w) return; // The contract rejects an empty window; never submit one.
      args = [w];
    }
    setPending(null);
    const hash = await write.run({
      method: fresh.method, args, valueWei: fresh.valueWei,
      account: wallet.account, provider: wallet.provider, address,
    });
    // Nothing was submitted (rejected signature, RPC refusal). There is no
    // transaction to hold a postcondition against.
    if (!hash) return;
    // The provider role is NOT saved here. A submitted accept_sla can revert,
    // be rejected by consensus, or never finalize; recording the role now would
    // mark the user as a party to an agreement they never joined. It is saved
    // once live state confirms ACTIVE and the connected wallet is the provider
    // — see the effect above.
    setLastAction({
      method: fresh.method,
      hash,
      incidentWindow: fresh.method === 'open_dispute' ? incident.trim() : undefined,
    });
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

      {supersededBy && (
        <div className="notice warn" role="status">
          <strong>This agreement moved to {supersededBy} elsewhere.</strong> Another tab read a newer
          status than the one shown here, so actions are withdrawn until this view catches up. It is
          re-reading the contract now.
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
                    onClick={() => void requestAction(a)}
                    disabled={!canAct || !a.roles.includes(role)}
                  >
                    {a.label}
                  </button>
                  <p className="muted small">{a.consequence}</p>
                </div>
              ))}
            </div>
          )}
          {checking && (
            <p className="muted small" role="status">
              Re-reading live state to confirm {checking}() is still available…
            </p>
          )}
          {write.busy && (
            <p className="muted small" role="status">
              A transaction is in flight; further actions are disabled until it settles.
            </p>
          )}
        </div>
      )}

      {/* A write the pre-submit check refused. Nothing was signed, so this is
          information rather than a failure — but it must be stated, or the
          button simply appeared not to work. */}
      {aborted && (
        <div className="notice warn" role="alert">
          <strong>{aborted.method}() was not submitted.</strong> {aborted.reason}{' '}
          {/* Timestamped for the same reason the retry outcome is: pressing the
              button again and getting the same answer must read as a new
              answer, not as a button that did nothing. */}
          <span className="muted small">Checked at {new Date(aborted.at).toLocaleTimeString()}.</span>
        </div>
      )}

      <TxProgress
        tx={write.tx}
        onDismiss={() => { write.reset(); setPostcondition(null); }}
      />

      {/* Shown only while the transaction it was computed for is the one being
          tracked. Without the hash and method match, the previous action's
          postcondition renders under the next action's transaction — an
          accept_sla result reported beneath a release. */}
      {postcondition && postcondition.result.ok !== null
        && postcondition.hash === write.tx.hash && postcondition.method === write.tx.method && (
        <div
          className={`notice ${postcondition.result.ok ? 'ok' : 'error'}`}
          role={postcondition.result.ok ? 'status' : 'alert'}
        >
          <strong>
            {postcondition.result.ok
              ? `${postcondition.method}() confirmed on-chain.`
              : `${postcondition.method}() finalized but did not take effect.`}
          </strong>{' '}
          {postcondition.result.detail}
        </div>
      )}

      {/* A guard that reverts is the contract doing its job. Say what that means
          for the party: nothing changed, nothing moved. */}
      {write.tx.phase === 'execution-error' && write.tx.method
        && write.tx.hash === lastAction?.hash && (
        <div className="notice warn" role="alert">
          <strong>{write.tx.method}() was rejected — safely.</strong>{' '}
          {rejectionSummary(write.tx.method, st)}
        </div>
      )}

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
        onConfirm={() => { if (pending) void submitAction(pending); }}
        confirmDisabled={
          (pending?.method === 'open_dispute' && !incident.trim()) || checking !== null
        }
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
