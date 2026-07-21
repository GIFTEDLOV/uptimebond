import type { AgreementState, DeadlockStatus, TxTracker } from '../chain';
import { bpsPct, fmtGen, shortAddr } from '../chain';
import { EXPLORER, SLA_CLAUSES, evidenceUrls, type AgreementConfig } from '../config';

export type Role = 'customer' | 'provider' | 'observer' | 'disconnected';

/* ------------------------------------------------------------------ status */

const LIFECYCLE = [
  'AWAITING_FUNDING',
  'AWAITING_PROVIDER_ACCEPTANCE',
  'ACTIVE',
  'DISPUTED',
  'RULED',
  'RESOLVED',
] as const;

const STATUS_COPY: Record<string, string> = {
  AWAITING_FUNDING: 'The customer has not yet paid the escrow.',
  AWAITING_PROVIDER_ACCEPTANCE: 'Escrow is held. The provider has not yet accepted the SLA.',
  ACTIVE: 'The SLA is live. Either party may raise a dispute.',
  DISPUTED: 'A dispute is open and awaiting validator adjudication.',
  RULED: 'Validators have ruled. Settlement may now proceed.',
  RESOLVED: 'The escrow has been settled and the agreement is closed.',
};

export function LifecycleBar({ status }: { status: string }) {
  const idx = LIFECYCLE.indexOf(status as (typeof LIFECYCLE)[number]);
  return (
    <div className="card">
      <h2>Lifecycle</h2>
      <ol className="lifecycle">
        {LIFECYCLE.map((s, i) => (
          <li
            key={s}
            className={i < idx ? 'done' : i === idx ? 'current' : 'todo'}
            aria-current={i === idx ? 'step' : undefined}
          >
            <span className="dot" aria-hidden="true" />
            <span className="label">{s.replaceAll('_', ' ').toLowerCase()}</span>
          </li>
        ))}
      </ol>
      <p className="muted">{STATUS_COPY[status] ?? `Unrecognised status: ${status}`}</p>
    </div>
  );
}

/* -------------------------------------------------------------- agreement */

export function Overview({
  cfg, st, role, account,
}: { cfg: AgreementConfig; st: AgreementState; role: Role; account?: string }) {
  return (
    <div className="card">
      <h2>Agreement</h2>
      <dl className="kv">
        <dt>Contract</dt>
        <dd>
          <a href={`${EXPLORER}/address/${cfg.address}`} target="_blank" rel="noreferrer">
            {shortAddr(cfg.address ?? undefined)}
          </a>
        </dd>
        <dt>Escrow held</dt>
        <dd className="mono">{fmtGen(st.escrow_atto)} GEN</dd>
        <dt>Customer</dt>
        <dd>
          {shortAddr(st.customer)}
          {role === 'customer' && <span className="badge you">you</span>}
        </dd>
        <dt>Provider</dt>
        <dd>
          {shortAddr(st.provider)}
          {role === 'provider' && <span className="badge you">you</span>}
        </dd>
        <dt>Your role</dt>
        <dd>
          <span className={`badge role-${role}`}>{role}</span>
          {role === 'observer' && account && (
            <span className="muted"> — {shortAddr(account)} is not a party to this agreement</span>
          )}
        </dd>
        {st.incident_window && (
          <>
            <dt>Incident</dt>
            <dd>{st.incident_window}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

/* --------------------------------------------------------------- evidence */

export function Evidence({ cfg }: { cfg: AgreementConfig }) {
  return (
    <div className="card">
      <h2>Evidence</h2>
      <p className="muted">
        Fixed at construction and never editable. Every validator re-fetches these
        independently and re-derives the ruling — the contract does not distribute
        them. URLs are pinned to an immutable commit so the sources cannot shift
        between the leader&apos;s fetch and a validator&apos;s.
      </p>
      <ul className="evidence">
        {evidenceUrls(cfg.evidenceDir).map((e) => (
          <li key={e.key}>
            <a href={e.url} target="_blank" rel="noreferrer">{e.key}</a>
            <span className="tag">{e.role}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------------------------------------------- ruling */

export function Ruling({ st }: { st: AgreementState }) {
  if (!st.outcome) {
    return (
      <div className="card">
        <h2>Ruling</h2>
        <p className="muted">No ruling yet. The dispute must be adjudicated first.</p>
      </div>
    );
  }
  const insufficient = st.outcome === 'INSUFFICIENT_EVIDENCE';
  return (
    <div className="card">
      <h2>Ruling</h2>
      <div className={`outcome outcome-${st.outcome.toLowerCase()}`}>{st.outcome.replaceAll('_', ' ')}</div>
      <dl className="kv">
        <dt>Customer refund</dt>
        <dd className="mono">
          {bpsPct(st.refund_bps)} <span className="muted">({st.refund_bps} bps)</span>
        </dd>
        <dt>Provider share</dt>
        <dd className="mono">{bpsPct(10000 - st.refund_bps)}</dd>
        <dt>Maintenance qualified</dt>
        <dd>
          {st.maintenance_qualified ? 'Yes — downtime excused' : 'No — downtime counts in full'}
        </dd>
        <dt>Breached clauses</dt>
        <dd>
          {st.breached_clause_ids.length === 0
            ? <span className="muted">none</span>
            : (
              <ul className="clauses">
                {st.breached_clause_ids.map((c) => (
                  <li key={c}><code>{c}</code> {SLA_CLAUSES[c] ?? ''}</li>
                ))}
              </ul>
            )}
        </dd>
      </dl>
      {st.ruling_reason && (
        <details>
          <summary>Validator reasoning</summary>
          <p className="reason">{st.ruling_reason}</p>
          <p className="muted small">
            Reasoning is explanatory only. Consensus is taken over the decision fields
            (outcome, refund bps, maintenance qualification, breached clauses) — never
            over this prose, since two honest validators would never word it identically.
          </p>
        </details>
      )}
      {insufficient && (
        <div className="notice warn">
          <strong>No automatic settlement.</strong> The evidence could not support a
          financial ruling, so <code>release()</code> deliberately reverts. The escrow
          stays custodied until a mutual settlement is agreed, a native appeal
          re-adjudicates the ruling, or the deadlock deadline passes.
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- deadlock */

export function Deadlock({ dl }: { dl: DeadlockStatus | null }) {
  if (!dl) return null;
  const applicable = dl.applicable_deadline > 0;
  const remaining = applicable ? dl.applicable_deadline - dl.now : 0;
  return (
    <div className="card">
      <h2>Deadlock fallback</h2>
      <p className="muted">
        Guarantees the escrow can always be freed without an off-chain coordinator,
        gated on the deterministic transaction timestamp.
      </p>
      <dl className="kv">
        <dt>Fallback split</dt>
        <dd className="mono">{bpsPct(dl.deadlock_refund_bps)} to customer</dd>
        <dt>Applicable now</dt>
        <dd>{applicable ? 'Yes' : <span className="muted">Not in this state</span>}</dd>
        {applicable && (
          <>
            <dt>Deadline</dt>
            <dd className="mono">{new Date(dl.applicable_deadline * 1000).toISOString()}</dd>
            <dt>Available</dt>
            <dd>
              {dl.resolve_deadlock_available
                ? <span className="ok">Yes — resolve_deadlock() can be called</span>
                : `In ${Math.max(0, Math.floor(remaining / 3600))}h ${Math.max(0, Math.floor((remaining % 3600) / 60))}m`}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

/* ------------------------------------------------------- transaction state */

const PHASE_COPY: Record<string, { title: string; body: string; tone: string }> = {
  'awaiting-signature': {
    title: 'Waiting for your wallet',
    body: 'Approve the transaction in your wallet. Nothing has been sent yet.',
    tone: 'pending',
  },
  submitted: {
    title: 'Submitted — not yet confirmed',
    body: 'The node accepted the transaction for processing. This is NOT success: consensus and execution are still ahead.',
    tone: 'pending',
  },
  'pending-consensus': {
    title: 'Awaiting validator consensus',
    body: 'Validators are independently re-fetching the evidence and voting. On Bradbury this typically takes around 30 minutes.',
    tone: 'pending',
  },
  'consensus-accepted': {
    title: 'Consensus accepted · execution succeeded',
    body: 'Validators agreed and the contract executed successfully. The transaction can still be appealed until it finalizes.',
    tone: 'ok',
  },
  finalized: {
    title: 'Finalized',
    body: 'The appeal window has closed. Settlement transfers apply at finalization, so funds move only now.',
    tone: 'ok',
  },
  'execution-error': {
    title: 'Execution failed',
    body: 'Consensus accepted the transaction but the contract reverted. No state change was applied.',
    tone: 'error',
  },
  failed: {
    title: 'Transaction failed',
    body: 'Consensus did not accept this transaction.',
    tone: 'error',
  },
  unknown: {
    title: 'Outcome unknown',
    body: 'The status could not be read. Do NOT retry until you have confirmed on-chain state — the transaction may have committed.',
    tone: 'warn',
  },
};

export function TxProgress({ tx, onDismiss }: { tx: TxTracker; onDismiss: () => void }) {
  if (tx.phase === 'idle') return null;
  const c = PHASE_COPY[tx.phase] ?? PHASE_COPY.unknown;
  const elapsed = tx.startedAt ? Math.floor((Date.now() - tx.startedAt) / 1000) : 0;
  return (
    <div className={`card tx tone-${c.tone}`} role="status" aria-live="polite">
      <div className="tx-head">
        <h2>{tx.method ? `${tx.method}()` : 'Transaction'} — {c.title}</h2>
        {(c.tone === 'ok' || c.tone === 'error') && (
          <button className="ghost" onClick={onDismiss}>Dismiss</button>
        )}
      </div>
      <p>{c.body}</p>
      <ol className="phases">
        {['submitted', 'pending-consensus', 'consensus-accepted', 'finalized'].map((p) => {
          const order = ['submitted', 'pending-consensus', 'consensus-accepted', 'finalized'];
          const cur = order.indexOf(tx.phase);
          const mine = order.indexOf(p);
          const failed = tx.phase === 'execution-error' || tx.phase === 'failed';
          return (
            <li key={p} className={failed && mine > 0 ? 'todo' : mine < cur ? 'done' : mine === cur ? 'current' : 'todo'}>
              {p.replaceAll('-', ' ')}
            </li>
          );
        })}
      </ol>
      <dl className="kv small">
        {tx.hash && (
          <>
            <dt>Transaction</dt>
            <dd>
              <a href={`${EXPLORER}/tx/${tx.hash}`} target="_blank" rel="noreferrer" className="mono">
                {shortAddr(tx.hash)}
              </a>
            </dd>
          </>
        )}
        {tx.consensusStatus && (<><dt>Consensus</dt><dd className="mono">{tx.consensusStatus}</dd></>)}
        {tx.executionResult && (<><dt>Execution</dt><dd className="mono">{tx.executionResult}</dd></>)}
        {elapsed > 0 && (<><dt>Elapsed</dt><dd className="mono">{Math.floor(elapsed / 60)}m {elapsed % 60}s</dd></>)}
      </dl>
      {tx.error && <div className="notice error">{tx.error}</div>}
    </div>
  );
}
