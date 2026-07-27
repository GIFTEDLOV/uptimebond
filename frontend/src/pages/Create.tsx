import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import contractSource from '../contract/uptime_bond.py?raw';
import {
  DEADLOCK_MIN_SECONDS, OUTCOME_SCHEDULE, SERVICE_CATEGORIES, EXPLORER,
} from '../config';
import {
  deployContract, fmtGen, pollTx, recoverDeployedAddress, shortAddr, type DeployArgs,
} from '../chain';
import {
  checkDeadlockSeconds, checkEvidenceUrl, checkProvider, checkRefundBps, isAddress, parseEscrowGen,
} from '../lib/validation';
import { fetchEvidence, type EvidenceResult } from '../lib/evidence';
import {
  addPendingDeploy, readPendingDeploys, removePendingDeploy, upsertAgreement,
} from '../lib/registry';
import { useWallet } from '../state/wallet';
import { TxProgress } from '../components/Panels';
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
  const [evChecks, setEvChecks] = useState<Record<string, EvidenceResult | 'loading'>>({});

  // Deploy tracking
  const [deployTx, setDeployTx] = useState<TxTracker>({ phase: 'idle' });
  const [deployedAddr, setDeployedAddr] = useState<string | null>(null);

  useEffect(() => { document.title = 'Create Agreement — UptimeBond'; }, []);

  // Resume an interrupted deploy from a prior session.
  useEffect(() => {
    const pending = readPendingDeploys();
    if (pending.length && deployTx.phase === 'idle' && !deployedAddr) {
      const p = pending[pending.length - 1];
      setStep(6);
      setDeployTx({ phase: 'submitted', method: 'deploy', hash: p.hash, startedAt: p.startedAt });
      void trackDeploy(p.hash);
    }
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

  const stepValid: Record<Step, boolean> = {
    1: !!wallet.account && isAddress(f.provider) && providerCheck.ok,
    2: !!f.category,
    3: evUrls.every(([k]) => checkEvidenceUrl(f[k] as string).ok),
    4: escrow.ok && checkRefundBps(f.deadlockPct * 100).ok
      && checkDeadlockSeconds(disputeSec).ok && checkDeadlockSeconds(ieSec).ok,
    5: agreed,
    6: true,
  };

  const testUrl = async (k: keyof Form) => {
    const url = f[k] as string;
    if (!checkEvidenceUrl(url).ok) return;
    setEvChecks((p) => ({ ...p, [k]: 'loading' }));
    const r = await fetchEvidence(url);
    setEvChecks((p) => ({ ...p, [k]: r }));
  };

  async function trackDeploy(hash: string) {
    const started = Date.now();
    const timer = window.setInterval(async () => {
      const t = await pollTx(hash);
      setDeployTx((prev) => ({ ...t, method: 'deploy', startedAt: prev.startedAt ?? started }));
      if (t.phase === 'finalized') {
        window.clearInterval(timer);
        const addr = await recoverDeployedAddress(hash);
        if (addr) {
          setDeployedAddr(addr);
          removePendingDeploy(hash);
          upsertAgreement({
            address: addr, source: 'created', role: 'customer',
            serviceLabel: f.serviceLabel || undefined, providerLabel: f.providerLabel || undefined,
            notes: escrow.atto?.toString(), lastStatus: 'AWAITING_FUNDING', createdAt: Date.now(),
          });
        }
      } else if (t.phase === 'execution-error' || t.phase === 'failed') {
        window.clearInterval(timer);
        removePendingDeploy(hash);
      }
    }, 15000);
  }

  const deploy = async () => {
    if (!wallet.account || !wallet.provider || !escrow.ok) return;
    setDeployTx({ phase: 'awaiting-signature', method: 'deploy', startedAt: Date.now() });
    const args: DeployArgs = {
      provider: f.provider,
      sla_terms_url: f.slaUrl, independent_monitor_url: f.monitorUrl,
      provider_status_url: f.statusUrl, maintenance_announcements_url: f.maintUrl,
      deadlock_refund_bps: f.deadlockPct * 100,
      dispute_deadlock_seconds: disputeSec, insufficient_evidence_deadlock_seconds: ieSec,
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
    addPendingDeploy({ hash, startedAt: Date.now(), args: args as unknown as Record<string, unknown>,
      serviceLabel: f.serviceLabel, providerLabel: f.providerLabel });
    setDeployTx({ phase: 'submitted', method: 'deploy', hash, startedAt: Date.now() });
    void trackDeploy(hash);
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
              const res = evChecks[k];
              return (
                <div className="field" key={k}>
                  <span>{label} <span className="tag">{k === 'monitorUrl' ? 'Primary evidence' : k === 'slaUrl' ? 'Authoritative' : 'Corroborating'}</span></span>
                  <div className="import-row">
                    <input type="url" placeholder="https://…" value={url} onChange={(e) => set(k, e.target.value)} />
                    <button className="ghost" type="button" onClick={() => void testUrl(k)} disabled={!check.ok}>Test</button>
                  </div>
                  {url && !check.ok && <em className="err">{check.reason}</em>}
                  {check.warn && <em className="warn-text">⚠ {check.warn}</em>}
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
                  Deploys the UptimeBond contract from your wallet. A transaction hash is not success —
                  the app tracks it through consensus and finalization, then recovers the contract
                  address from the receipt. An interrupted deploy resumes here rather than redeploying.
                </p>
                {deployTx.phase === 'idle' && (
                  <button onClick={() => void deploy()} disabled={!wallet.account || wallet.wrongChain}>
                    Deploy agreement
                  </button>
                )}
                <TxProgress tx={deployTx} onDismiss={() => setDeployTx({ phase: 'idle' })} />
                {(deployTx.phase === 'failed' || deployTx.phase === 'execution-error') && (
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
