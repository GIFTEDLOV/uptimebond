import { EXPLORER } from '../config';
import { shortAddr } from '../chain';
import type { DeployVerification } from '../lib/deployment';

/**
 * Shown when a deployment cannot be verified.
 *
 * Deliberately offers no Fund and no Invite: the address on screen may name
 * nothing at all. Transaction `0x0c8e748c…` finalized with
 * `FINISHED_WITH_RETURN` and named a contract address that has never existed —
 * funding it would send GEN to an address with no code to receive it.
 */
export function DeploymentUnverified({
  v, hash, busy, onRecheck,
}: {
  v: DeployVerification;
  hash?: string;
  busy: boolean;
  onRecheck: () => void;
}) {
  const failed = v.failed;
  const title = v.executionResult && v.executionResult !== 'FINISHED_WITH_RETURN'
    ? 'Deployment failed'
    : 'Deployment not verified';

  return (
    <div className="deploy-unverified">
      <div className="notice error" role="alert">
        <strong>{title}.</strong>{' '}
        {failed
          ? failed.detail
          : 'The deployment could not be confirmed on-chain.'}
      </div>

      <dl className="kv small">
        <dt>Transaction</dt>
        <dd>
          {hash ? (
            <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer" className="mono">
              {shortAddr(hash)} ↗
            </a>
          ) : <span className="muted">—</span>}
        </dd>
        <dt>Consensus status</dt>
        <dd className="mono">{v.consensusStatus || '—'}</dd>
        <dt>Execution result</dt>
        <dd className="mono">{v.executionResult || '—'}</dd>
        <dt>Address claimed</dt>
        <dd>
          {v.claimedAddress ? (
            <a
              href={`${EXPLORER}/address/${v.claimedAddress}`}
              target="_blank" rel="noopener noreferrer" className="mono"
            >
              {v.claimedAddress} ↗
            </a>
          ) : <span className="muted">none</span>}
        </dd>
      </dl>

      <p className="switch-label" style={{ marginTop: 22 }}>Verification checks</p>
      <ul className="check-list">
        {v.checks.map((c) => (
          <li key={c.id} className={c.ok === true ? 'pass' : c.ok === false ? 'fail' : 'skip'}>
            <span className="check-mark" aria-hidden="true" />
            <span className="check-body">
              <span className="check-label">{c.label}</span>
              <span className="check-detail">{c.detail}</span>
            </span>
            <span className="visually-hidden">
              {c.ok === true ? 'passed' : c.ok === false ? 'failed' : 'not reached'}
            </span>
          </li>
        ))}
      </ul>

      <div className="hero-cta" style={{ marginTop: 22 }}>
        <button onClick={onRecheck} disabled={busy}>
          {busy ? 'Checking…' : 'Run verification again'}
        </button>
      </div>

      <p className="muted small" style={{ marginTop: 16 }}>
        Funding and invitation stay disabled until every check passes. Do not redeploy from this
        screen — the transaction above is already final, and a second deployment would create a
        separate agreement. If the address never becomes readable, that transaction produced no
        usable contract and nothing was escrowed.
      </p>
    </div>
  );
}
