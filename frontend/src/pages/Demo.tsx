import { useEffect, useMemo, useState } from 'react';
import { AGREEMENTS } from '../config';
import { AgreementView } from '../components/AgreementView';

const LIVE = AGREEMENTS.filter((a) => !a.deprecated && a.address);
const ARCHIVED = AGREEMENTS.filter((a) => a.deprecated);

const OUTCOME_CLASS: Record<string, string> = {
  NO_BREACH: 'no_breach', PARTIAL_REFUND: 'partial_refund',
  FULL_REFUND: 'full_refund', INSUFFICIENT_EVIDENCE: 'insufficient_evidence',
};

/** The four verified agreements, preserved as public demonstrations. Read-only
 *  proof: each was driven to settlement and its payout verified on-chain. */
export function Demo() {
  const [id, setId] = useState(LIVE[0].id);
  const [showArchived, setShowArchived] = useState(false);
  const cfg = useMemo(() => AGREEMENTS.find((a) => a.id === id)!, [id]);
  useEffect(() => { document.title = 'Live Demo — UptimeBond'; }, []);

  return (
    <>
      <div className="page-head">
        <h2>Live demo</h2>
        <p className="muted">
          Four agreements, each deployed on Bradbury and driven to settlement. Every value below is
          read live from the contract. These are the verified proof cases — the real workflow lives
          under <a href="/create">Create Agreement</a>.
        </p>
      </div>

      <div className="case-switch">
        <p className="switch-label">Verified agreements · one per outcome</p>
        <nav className="cases" aria-label="Demo cases">
          {LIVE.map((a) => (
            <button key={a.id} className={a.id === id ? 'case active' : 'case'} onClick={() => setId(a.id)}>
              <span className="case-name">{a.label}</span>
              <span className="case-tag">
                <span className={`oc-dot oc-${OUTCOME_CLASS[a.expected.outcome]}`} aria-hidden="true" />
                {a.expected.outcome.replaceAll('_', ' ').toLowerCase()}
              </span>
            </button>
          ))}
        </nav>

        {ARCHIVED.length > 0 && (
          <>
            <button className="deprecated-toggle" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
              {showArchived ? '▾' : '▸'} {ARCHIVED.length} archived deployments (broken payout — not usable)
            </button>
            {showArchived && (
              <nav className="cases archived" aria-label="Archived cases">
                {ARCHIVED.map((a) => (
                  <button key={a.id} className={a.id === id ? 'case active' : 'case'} onClick={() => setId(a.id)}>
                    <span className="case-name">{a.label}</span>
                    <span className="case-tag"><span className="arch-flag">⚠ escrow stranded</span></span>
                  </button>
                ))}
              </nav>
            )}
          </>
        )}
      </div>

      <p className="blurb">{cfg.blurb}</p>

      {cfg.deprecated && (
        <div className="notice error">
          <strong>Deprecated deployment — escrow permanently stranded.</strong>{' '}
          {cfg.deprecated.reason} {cfg.deprecated.strandedLabel} is locked in this contract and cannot
          be recovered: it is immutable and <code>release()</code> is single-shot.
        </div>
      )}

      {cfg.address && <AgreementView address={cfg.address} />}
    </>
  );
}
