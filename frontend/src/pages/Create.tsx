import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import contractSource from '../contract/uptime_bond.py?raw';
import {
  DEADLOCK_MIN_SECONDS, OUTCOME_SCHEDULE, SERVICE_CATEGORIES, EXPLORER,
} from '../config';
import {
  deployContract, fmtGen, pollTx, shortAddr, type DeployArgs,
} from '../chain';
import {
  checkDeadlockSeconds, checkEvidenceUrl, checkProvider, checkRefundBps, isAddress, parseEscrowGen,
} from '../lib/validation';
import { fetchEvidence, type EvidenceResult } from '../lib/evidence';
import {
  addPendingDeploy, archivePendingDeploy, readActiveDeploys, removePendingDeploy,
  upsertAgreement, type DeploymentDraft,
} from '../lib/registry';
import { useWallet } from '../state/wallet';
import { TxProgress } from '../components/Panels';
import { DeploymentUnverified } from '../components/DeploymentUnverified';
import { verifyDeployment, type DeployVerification } from '../lib/deployment';
import { sha256Hex } from '../lib/hash';
import { BUILD_VERSION } from '../lib/health';
import { SDK_VERSION } from '../config';
import type { TxTracker } from '../chain';

type Step = 1 | 2 | 3 | 4 | 5 | 6;
const STEP_NAMES = ['Parties', 'Service', 'Evidence', 'Settlement', 'Review', 'Deploy'];

interface Form {
  provider: string; providerLabel: string; serviceLabel: string;
  category: string; endpoint: string; period: string; notes: string;
  slaUrl: string; monitorUrl: string; statusUrl: string; maintUrl: string;
  escrowGen: string; deadlockPct: number; disputeDays: number; ieDays: number;
}

const EMPTY: Form = {
  provider: '', providerLabel: '', serviceLabel: '',
  category: 'web-api', endpoint: '', period: '', notes: '',
  slaUrl: '', monitorUrl: '', statusUrl: '', maintUrl: '',
  escrowGen: '0.1', deadlockPct: 50, disputeDays: 1, ieDays: 1,
};

export function Create() {
  const wallet = useWallet();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [f, setF] = useState<Form>(EMPTY);
  const [agreed, setAgreed] = useState(false);
  /**
   * Evidence reachability results, each bound to the exact URL that was tested.
   *
   * Storing only the result let an edited URL keep its predecessor's green
   * HTTP 200: type a good URL, press Test, change one character, and the step
   * still reported "tested". The URL is now part of the record and every check
   * is matched against the current field value before it counts.
   */
  const [evChecks, setEvChecks] = useState<
    Record<string, { url: string; result: EvidenceResult | 'loading' }>>({});

  // Deploy tracking. `deployedAddr` is set ONLY after verifyDeployment passes
  // every check — a finalized receipt naming an address is not a deployment.
  const [deployTx, setDeployTx] = useState<TxTracker>({ phase: 'idle' });
  const [deployedAddr, setDeployedAddr] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<DeployVerification | null>(null);
  const [draft, setDraft] = useState<DeploymentDraft | null>(null);
  const [archived, setArchived] = useState(false);
  const trackTimer = useRef<number | null>(null);
  const trackGen = useRef(0);

  useEffect(() => { document.title = 'Create Agreement — UptimeBond'; }, []);

  /**
   * Resume an interrupted deploy from a prior session.
   *
   * Only non-archived deploys are picked up, and the persisted draft supplies
   * the sender and provider. Previously this passed the *currently connected*
   * wallet and an empty provider, so a resumed verification could not check
   * ownership at all and would accept a contract created by another account.
   */
  useEffect(() => {
    const pending = readActiveDeploys();
    if (pending.length && deployTx.phase === 'idle' && !deployedAddr) {
      const p = pending[pending.length - 1];
      setStep(6);
      setDraft(p.draft);
      setDeployTx({ phase: 'submitted', method: 'deploy', hash: p.hash, startedAt: p.startedAt });
      trackDeploy(p.hash, p.draft, p.startedAt);
    }
    return () => {
      trackGen.current += 1;
      if (trackTimer.current !== null) window.clearTimeout(trackTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const escrow = useMemo(() => parseEscrowGen(f.escrowGen), [f.escrowGen]);
  const providerCheck = checkProvider(f.provider || '0x', wallet.account);
  const disputeSec = Math.round(f.disputeDays * 86400);
  const ieSec = Math.round(f.ieDays * 86400);

  const evUrls: [keyof Form, string][] = [
    ['slaUrl', 'SLA terms'], ['monitorUrl', 'Independent monitor'],
    ['statusUrl', 'Provider status'], ['maintUrl', 'Maintenance feed'],
  ];

  /** A passing test for the URL currently in the field — nothing older counts. */
  const evidencePassed = (k: keyof Form) => {
    const rec = evChecks[k as string];
    const url = (f[k] as string).trim();
    return !!rec && rec.url === url && rec.result !== 'loading' && rec.result.ok === true;
  };
  const evidenceResultFor = (k: keyof Form) => {
    const rec = evChecks[k as string];
    return rec && rec.url === (f[k] as string).trim() ? rec.result : undefined;
  };

  const stepValid: Record<Step, boolean> = {
    1: !!wallet.account && isAddress(f.provider) && providerCheck.ok,
    2: !!f.category,
    // Every source must be syntactically valid AND currently proven reachable.
    // Validators re-fetch these during adjudication; a URL that 404s guarantees
    // a failed ruling, and the terms are immutable once deployed.
    3: evUrls.every(([k]) => checkEvidenceUrl(f[k] as string).ok && evidencePassed(k)),
    4: escrow.ok && checkRefundBps(f.deadlockPct * 100).ok
      && checkDeadlockSeconds(disputeSec).ok && checkDeadlockSeconds(ieSec).ok,
    5: agreed,
    6: true,
  };

  const testUrl = async (k: keyof Form) => {
    const url = (f[k] as string).trim();
    if (!checkEvidenceUrl(url).ok) return;
    setEvChecks((p) => ({ ...p, [k]: { url, result: 'loading' } }));
    const r = await fetchEvidence(url);
    // Bind the result to the URL that produced it; if the field moved on while
    // the request was in flight, the result is for a URL nobody is using.
    setEvChecks((p) => ({ ...p, [k]: { url, result: r } }));
  };

  /**
   * Verify a finalized deployment end to end, then record it.
   *
   * Nothing is written to the local registry and no address is surfaced as an
   * agreement unless every check passes — otherwise a receipt that names a
   * contract the chain never materialised would become a fundable entry.
   */
  const runVerification = useCallback(async (hash: string, draft: DeploymentDraft) => {
    setVerifying(true);
    setDraft(draft);
    try {
      // Verification is driven entirely by the persisted draft — never by the
      // form (which is empty after a reload) or the connected wallet (which may
      // be a different account by then).
      const v = await verifyDeployment({ hash, draft });
      setVerification(v);
      if (v.ok && v.address) {
        setDeployedAddr(v.address);
        removePendingDeploy(hash);
        upsertAgreement({
          address: v.address, source: 'created', role: 'customer',
          serviceLabel: draft.serviceLabel || undefined,
          providerLabel: draft.providerLabel || undefined,
          notes: draft.notes || undefined,
          escrowAtto: draft.escrowAtto,
          lastStatus: v.state?.status ?? 'AWAITING_FUNDING',
          createdAt: Date.now(),
        });
      } else {
        setDeployedAddr(null);
      }
      return v;
    } finally {
      setVerifying(false);
    }
  }, []);

  /** Single-flight recursive timeout; cancelled on unmount via trackRef. */
  const trackDeploy = useCallback((hash: string, draft: DeploymentDraft, startedAt = Date.now()) => {
    trackGen.current += 1;
    const mine = trackGen.current;
    const schedule = () => {
      trackTimer.current = window.setTimeout(async () => {
        if (mine !== trackGen.current) return;
        const t = await pollTx(hash);
        if (mine !== trackGen.current) return;
        setDeployTx((prev) => ({ ...t, method: 'deploy', startedAt: prev.startedAt ?? startedAt }));
        if (t.phase === 'finalized' || t.phase === 'execution-error'
            || t.phase === 'failed' || t.phase === 'unknown') {
          // Always verify, even after a failed execution, so the panel can name
          // the exact failing check instead of showing a bare error.
          await runVerification(hash, draft);
          return;
        }
        schedule();
      }, 15000);
    };
    schedule();
  }, [runVerification]);

  const deploy = async () => {
    if (!wallet.account || !wallet.provider || !escrow.ok || !escrow.atto) return;
    setDeployTx({ phase: 'awaiting-signature', method: 'deploy', startedAt: Date.now() });
    const args: DeployArgs = {
      provider: f.provider,
      sla_terms_url: f.slaUrl, independent_monitor_url: f.monitorUrl,
      provider_status_url: f.statusUrl, maintenance_announcements_url: f.maintUrl,
      deadlock_refund_bps: f.deadlockPct * 100,
      dispute_deadlock_seconds: disputeSec, insufficient_evidence_deadlock_seconds: ieSec,
    };
    // Everything needed to verify this deployment later, independent of the
    // form and of whichever wallet happens to be connected at that point.
    const draft: DeploymentDraft = {
      sender: wallet.account,
      provider: f.provider,
      slaTermsUrl: f.slaUrl,
      independentMonitorUrl: f.monitorUrl,
      providerStatusUrl: f.statusUrl,
      maintenanceAnnouncementsUrl: f.maintUrl,
      deadlockRefundBps: f.deadlockPct * 100,
      disputeDeadlockSeconds: disputeSec,
      insufficientEvidenceDeadlockSeconds: ieSec,
      escrowAtto: escrow.atto.toString(),
      serviceLabel: f.serviceLabel || undefined,
      providerLabel: f.providerLabel || undefined,
      notes: f.notes || undefined,
      sourceSha256: await sha256Hex(contractSource),
      sdkVersion: SDK_VERSION,
      buildVersion: BUILD_VERSION,
    };

    let hash: string;
    try {
      hash = await deployContract(wallet.account, wallet.provider, contractSource, args);
    } catch (e) {
      const err = e as { code?: number; message?: string };
      setDeployTx({ phase: 'failed', method: 'deploy', startedAt: Date.now(),
        error: err.code === 4001 ? 'Deployment signature rejected in the wallet.' : (err.message ?? String(e)) });
      return;
    }
    // Persist BEFORE tracking so an interrupted deploy resumes, never repeats.
    addPendingDeploy({ hash, startedAt: Date.now(), draft });
    setDeployTx({ phase: 'submitted', method: 'deploy', hash, startedAt: Date.now() });
    trackDeploy(hash, draft);
  };

  /** Put a permanently failed finalized deployment aside without deleting it. */
  const archive = () => {
    if (!deployTx.hash) return;
    archivePendingDeploy(deployTx.hash,
      verification?.failed?.label ?? verification?.executionResult ?? 'verification failed');
    trackGen.current += 1;
    if (trackTimer.current !== null) { window.clearTimeout(trackTimer.current); trackTimer.current = null; }
    setArchived(true);
  };

  return (
    <div className="page-narrow">
      <div className="page-head">
        <p className="eyebrow">A guided agreement</p>
        <h2>Create an agreement</h2>
        <p className="muted">
          Six steps: the parties, the service, the evidence that will decide any dispute, the
          settlement terms, a review, and the deployment itself. Testnet GEN only.
        </p>
      </div>

      <ol className="wizard-steps" aria-label="Progress">
        {STEP_NAMES.map((name, i) => {
          const n = (i + 1) as Step;
          return (
            <li key={name} className={n === step ? 'current' : n < step ? 'done' : 'todo'} aria-current={n === step ? 'step' : undefined}>
              <span className="ws-n">{n}</span><span className="ws-label">{name}</span>
            </li>
          );
        })}
      </ol>

      <div className="card wizard-card">
        {step === 1 && (
          <>
            <h3>Parties</h3>
            {!wallet.account ? (
              <div className="notice warn">
                Connect your wallet first — the connected account becomes the customer.
                <div style={{ marginTop: 10 }}><button onClick={() => void wallet.connect()}>Connect wallet</button></div>
              </div>
            ) : (
              <p className="muted">Customer (you): <span className="mono">{wallet.account}</span></p>
            )}
            <label className="field">
              <span>Provider wallet address</span>
              <input type="text" placeholder="0x…" value={f.provider} onChange={(e) => set('provider', e.target.value)} />
              {f.provider && !providerCheck.ok && <em className="err">{providerCheck.reason}</em>}
            </label>
            <div className="field-row">
              <label className="field">
                <span>Provider label <span className="muted">(private, local only)</span></span>
                <input type="text" placeholder="Acme Hosting" value={f.providerLabel} onChange={(e) => set('providerLabel', e.target.value)} />
              </label>
              <label className="field">
                <span>Service label <span className="muted">(private, local only)</span></span>
                <input type="text" placeholder="Nimbus API" value={f.serviceLabel} onChange={(e) => set('serviceLabel', e.target.value)} />
              </label>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h3>Service</h3>
            <label className="field">
              <span>Service category</span>
              <select value={f.category} onChange={(e) => set('category', e.target.value)}>
                {SERVICE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <em className="muted small">{SERVICE_CATEGORIES.find((c) => c.id === f.category)?.hint}</em>
            </label>
            <label className="field">
              <span>Service endpoint <span className="muted">(optional)</span></span>
              <input type="text" placeholder="https://api.example.com/health" value={f.endpoint} onChange={(e) => set('endpoint', e.target.value)} />
            </label>
            <label className="field">
              <span>Agreement period</span>
              <input type="text" placeholder="e.g. May 2026, monthly" value={f.period} onChange={(e) => set('period', e.target.value)} />
            </label>
            <label className="field">
              <span>Internal notes <span className="muted">(private, local only)</span></span>
              <textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
            </label>
          </>
        )}

        {step === 3 && (
          <>
            <h3>Evidence sources</h3>
            <p className="muted">
              Four public URLs, fixed forever at deployment. UptimeBond does not monitor your service —
              the independent monitor produces the operational evidence, and validators re-fetch every
              source during adjudication. Prefer commit-pinned URLs; a moving source can make validators disagree.
            </p>
            {evUrls.map(([k, label]) => {
              const url = f[k] as string;
              const check = checkEvidenceUrl(url);
              // Only a result for the URL currently in the field is shown;
              // editing the URL discards the previous one rather than leaving a
              // stale green tick behind it.
              const res = evidenceResultFor(k);
              return (
                <div className="field" key={k}>
                  <span>{label} <span className="tag">{k === 'monitorUrl' ? 'Primary evidence' : k === 'slaUrl' ? 'Authoritative' : 'Corroborating'}</span></span>
                  <div className="import-row">
                    <input type="url" placeholder="https://…" value={url} onChange={(e) => set(k, e.target.value)} />
                    <button className="ghost" type="button" onClick={() => void testUrl(k)} disabled={!check.ok}>
                      {evidencePassed(k) ? 'Re-test' : 'Test'}
                    </button>
                  </div>
                  {url && !check.ok && <em className="err">{check.reason}</em>}
                  {check.warn && <em className="warn-text">⚠ {check.warn}</em>}
                  {check.ok && url && !res && (
                    <em className="warn-text">Not tested yet — press Test.</em>
                  )}
                  {res === 'loading' && <em className="muted small">Testing…</em>}
                  {res && res !== 'loading' && (
                    <div className={`ev-result ${res.ok ? 'ok' : 'bad'}`}>
                      <strong>{res.ok ? `HTTP ${res.status} · ${res.kind.toUpperCase()}` : (res.error ?? 'Unreachable')}</strong>
                      {res.normalized && (
                        <div className="ev-norm">
                          {res.normalized.uptime_pct !== undefined && <span>uptime {res.normalized.uptime_pct}%</span>}
                          {res.normalized.downtime_minutes !== undefined && <span>{res.normalized.downtime_minutes}m down</span>}
                          {res.normalized.total_checks !== undefined && <span>{res.normalized.total_checks} checks</span>}
                          {res.normalized.data_gap && <span className="warn-text">coverage gap</span>}
                        </div>
                      )}
                      {res.preview && <pre className="ev-preview">{res.preview.slice(0, 600)}</pre>}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="notice warn">These URLs become <strong>immutable</strong> after deployment and cannot be changed.</div>
          </>
        )}

        {step === 4 && (
          <>
            <h3>Settlement terms</h3>
            <label className="field">
              <span>Escrow amount (GEN)</span>
              <input type="text" inputMode="decimal" value={f.escrowGen} onChange={(e) => set('escrowGen', e.target.value)} />
              {!escrow.ok && <em className="err">{escrow.reason}</em>}
              {escrow.ok && <em className="muted small">{fmtGen(escrow.atto!)} GEN held in escrow</em>}
            </label>
            <label className="field">
              <span>Deadlock refund to customer: <strong>{f.deadlockPct}%</strong></span>
              <input type="range" min={0} max={100} step={5} value={f.deadlockPct} onChange={(e) => set('deadlockPct', Number(e.target.value))} />
              <em className="muted small">Split used only if a deadlock fallback resolves the escrow.</em>
            </label>
            <div className="field-row">
              <label className="field">
                <span>Dispute deadlock (days)</span>
                <input type="number" min={DEADLOCK_MIN_SECONDS / 86400} max={30} step={0.5} value={f.disputeDays} onChange={(e) => set('disputeDays', Number(e.target.value))} />
                {!checkDeadlockSeconds(disputeSec).ok && <em className="err">{checkDeadlockSeconds(disputeSec).reason}</em>}
              </label>
              <label className="field">
                <span>Insufficient-evidence deadlock (days)</span>
                <input type="number" min={DEADLOCK_MIN_SECONDS / 86400} max={30} step={0.5} value={f.ieDays} onChange={(e) => set('ieDays', Number(e.target.value))} />
                {!checkDeadlockSeconds(ieSec).ok && <em className="err">{checkDeadlockSeconds(ieSec).reason}</em>}
              </label>
            </div>
            <div className="schedule-preview">
              <p className="switch-label">Fixed outcome schedule</p>
              <table className="schedule">
                <thead><tr><th>Outcome</th><th>Customer</th><th>Provider</th></tr></thead>
                <tbody>
                  {OUTCOME_SCHEDULE.map((o) => (
                    <tr key={o.outcome}><td><code>{o.outcome.replaceAll('_', ' ')}</code></td><td>{o.customer}</td><td>{o.provider}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h3>Review</h3>
            <p className="muted">
              This is the whole agreement. The provider address and the four evidence sources
              are pinned at deployment and can never be edited afterwards — read them once more
              before you sign.
            </p>
            <dl className="kv review">
              <dt>Customer</dt><dd className="mono">{wallet.account && shortAddr(wallet.account)}</dd>
              <dt>Provider</dt><dd className="mono">{shortAddr(f.provider)} {f.providerLabel && `· ${f.providerLabel}`}</dd>
              <dt>Service</dt><dd>{SERVICE_CATEGORIES.find((c) => c.id === f.category)?.label}{f.serviceLabel && ` · ${f.serviceLabel}`}</dd>
              <dt>Escrow</dt><dd className="mono">{escrow.ok ? fmtGen(escrow.atto!) : '—'} GEN</dd>
              <dt>Deadlock split</dt><dd>{f.deadlockPct}% to customer</dd>
              <dt>Deadlines</dt><dd>{f.disputeDays}d dispute · {f.ieDays}d insufficient-evidence</dd>
            </dl>
            <div className="review-evidence">
              <p className="switch-label">Immutable evidence sources</p>
              <ul className="evidence">
                {evUrls.map(([k, label]) => <li key={k}><span>{label}</span><span className="mono small break">{f[k] as string}</span></li>)}
              </ul>
            </div>
            <div className="notice warn">
              <strong>Immutable evidence, and irreversible terms.</strong> Once deployed, the four
              evidence URLs above are the only sources any validator will ever read for this
              agreement, and neither party can change them, swap them, or add to them. The
              settlement terms are fixed the same way. Gas is paid in testnet GEN.
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>I have verified the provider address, evidence sources, and terms, and I understand this is testnet software with no guarantee. See <Link to="/terms">Terms</Link>.</span>
            </label>
          </>
        )}

        {step === 6 && (
          <>
            <h3>Deploy</h3>
            {!deployedAddr ? (
              <>
                <p className="muted">
                  Deploys the UptimeBond contract from your wallet. Neither a transaction hash nor
                  a finalized receipt is success — the app reads the contract back off-chain and
                  checks it really exists, is yours, and is awaiting funding before calling it
                  deployed. An interrupted deploy resumes here rather than redeploying.
                </p>
                {deployTx.phase === 'idle' && (
                  <button onClick={() => void deploy()} disabled={!wallet.account || wallet.wrongChain}>
                    Deploy agreement
                  </button>
                )}
                <TxProgress tx={deployTx} onDismiss={() => setDeployTx({ phase: 'idle' })} />

                {verifying && (
                  <p className="muted" role="status">Verifying the deployment on-chain…</p>
                )}

                {verification && !verification.ok && !verifying && (
                  <DeploymentUnverified
                    v={verification}
                    hash={deployTx.hash}
                    busy={verifying}
                    archived={archived}
                    onRecheck={() => {
                      if (deployTx.hash && draft) void runVerification(deployTx.hash, draft);
                    }}
                    onArchive={archive}
                  />
                )}

                {(deployTx.phase === 'failed' || deployTx.phase === 'execution-error')
                  && !verification && (
                  <button onClick={() => void deploy()}>Retry deploy</button>
                )}
              </>
            ) : (
              <div className="deploy-done">
                <div className="notice ok">
                  <strong>Deployed.</strong> Your agreement is live at{' '}
                  <span className="mono">{shortAddr(deployedAddr)}</span>. Next: fund the escrow and invite your provider.
                </div>
                <div className="hero-cta">
                  <button onClick={() => navigate(`/agreement/${deployedAddr}`)}>Fund escrow →</button>
                  <Link to={`/invite/${deployedAddr}`} className="btn-ghost">Invite provider</Link>
                  <a href={`${EXPLORER}/address/${deployedAddr}`} target="_blank" rel="noopener noreferrer" className="btn-ghost">Explorer ↗</a>
                </div>
                <p className="muted small">Funding, acceptance, and every later action happen on the agreement page.</p>
              </div>
            )}
          </>
        )}

        {step < 6 && (
          <div className="wizard-nav">
            <button className="ghost" onClick={() => setStep((s) => Math.max(1, s - 1) as Step)} disabled={step === 1}>Back</button>
            <button onClick={() => setStep((s) => Math.min(6, s + 1) as Step)} disabled={!stepValid[step]}>
              {step === 5 ? 'Continue to deploy' : 'Next'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
