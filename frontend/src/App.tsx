import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  connectWallet, currentChainId, fmtGen, getInjected, pollTx, readAgreement,
  readDeadlock, sendTx, shortAddr, switchToBradbury,
  type AgreementState, type DeadlockStatus, type TxTracker,
} from './chain';
import { AGREEMENTS, CHAIN_ID, CHAIN_NAME, EXPLORER, REPO, SOURCE_COMMIT } from './config';
import { Deadlock, Evidence, LifecycleBar, Overview, Ruling, TxProgress, type Role } from './components/Panels';

export default function App() {
  const [cfgId, setCfgId] = useState(AGREEMENTS[0].id);
  const cfg = useMemo(() => AGREEMENTS.find((a) => a.id === cfgId)!, [cfgId]);

  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletErr, setWalletErr] = useState<string | null>(null);

  const [st, setSt] = useState<AgreementState | null>(null);
  const [dl, setDl] = useState<DeadlockStatus | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [tx, setTx] = useState<TxTracker>({ phase: 'idle' });
  const pollRef = useRef<number | null>(null);

  const provider = getInjected();

  /* ------------------------------------------------------------- contract */
  const refresh = useCallback(async () => {
    if (!cfg.address) { setSt(null); setLoading(false); return; }
    try {
      const [s, d] = await Promise.all([readAgreement(cfg.address), readDeadlock(cfg.address)]);
      setSt(s); setDl(d); setLoadErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cfg.address]);

  useEffect(() => { setLoading(true); void refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(() => { void refresh(); }, 20_000);
    return () => clearInterval(t);
  }, [refresh]);

  /* --------------------------------------------------------------- wallet */
  useEffect(() => {
    if (!provider) return;
    void (async () => {
      try { setChainId(await currentChainId(provider)); } catch { /* ignore */ }
    })();
    const onChain = () => window.location.reload();
    const onAcct = (...a: unknown[]) => {
      const accts = a[0] as string[] | undefined;
      setAccount(accts?.[0] ?? null);
    };
    provider.on?.('chainChanged', onChain);
    provider.on?.('accountsChanged', onAcct);
    return () => {
      provider.removeListener?.('chainChanged', onChain);
      provider.removeListener?.('accountsChanged', onAcct);
    };
  }, [provider]);

  const connect = async () => {
    setWalletErr(null);
    if (!provider) { setWalletErr('No EVM wallet detected. Install MetaMask to act as a party.'); return; }
    try {
      const accts = await connectWallet(provider);
      setAccount(accts[0] ?? null);
      const id = await currentChainId(provider);
      setChainId(id);
      if (id !== CHAIN_ID) await switchToBradbury(provider);
      setChainId(await currentChainId(provider));
    } catch (e) {
      setWalletErr(e instanceof Error ? e.message : String(e));
    }
  };

  const role: Role = useMemo(() => {
    if (!account) return 'disconnected';
    if (!st) return 'observer';
    if (account.toLowerCase() === st.customer.toLowerCase()) return 'customer';
    if (account.toLowerCase() === st.provider.toLowerCase()) return 'provider';
    return 'observer';
  }, [account, st]);

  const wrongChain = chainId !== null && chainId !== CHAIN_ID;

  /* ----------------------------------------------------------------- send */
  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const act = async (method: string, args: unknown[] = [], valueWei?: bigint) => {
    if (!cfg.address || !account || !provider) return;
    stopPolling();
    setTx({ phase: 'awaiting-signature', method, startedAt: Date.now() });
    let hash: string;
    try {
      hash = await sendTx({ address: cfg.address, method, args, valueWei, account, provider });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Submission was refused — no hash issued, so nothing committed.
      setTx({ phase: 'failed', method, error: `Submission refused: ${msg}`, startedAt: Date.now() });
      return;
    }
    // A hash is not success. Enter the observation loop.
    setTx({ phase: 'submitted', method, hash, startedAt: Date.now() });
    const started = Date.now();
    pollRef.current = window.setInterval(async () => {
      const t = await pollTx(hash);
      setTx((prev) => ({ ...t, method, startedAt: prev.startedAt ?? started }));
      if (t.phase === 'finalized' || t.phase === 'execution-error' || t.phase === 'failed') {
        stopPolling();
        void refresh();
      } else if (t.phase === 'consensus-accepted') {
        void refresh(); // state has applied; keep polling until finalized
      }
    }, 15_000);
  };

  useEffect(() => stopPolling, []);

  /* ------------------------------------------------------------- actions */
  const busy = tx.phase !== 'idle' && tx.phase !== 'finalized'
            && tx.phase !== 'execution-error' && tx.phase !== 'failed';
  const canAct = Boolean(account) && !wrongChain && !busy;

  const actions: { label: string; hint: string; run: () => void; show: boolean; enabled: boolean }[] = st ? [
    {
      label: `Fund escrow (${cfg.escrowLabel})`,
      hint: 'Customer pays for the service; the payment is held in escrow.',
      show: st.status === 'AWAITING_FUNDING',
      enabled: canAct && role === 'customer',
      run: () => void act('fund', [], BigInt(cfg.escrowLabel.startsWith('1 ') ? '1000000000000000000' : '100000000000000000')),
    },
    {
      label: 'Accept SLA',
      hint: 'Provider commits to the pinned SLA, evidence sources and deadlock terms.',
      show: st.status === 'AWAITING_PROVIDER_ACCEPTANCE',
      enabled: canAct && role === 'provider',
      run: () => void act('accept_sla'),
    },
    {
      label: 'Approve service',
      hint: 'Customer confirms no breach; the provider is paid in full. No AI runs.',
      show: st.status === 'ACTIVE',
      enabled: canAct && role === 'customer',
      run: () => void act('approve_service'),
    },
    {
      label: 'Open dispute',
      hint: 'Either party raises an SLA breach over a stated incident window.',
      show: st.status === 'ACTIVE',
      enabled: canAct && (role === 'customer' || role === 'provider'),
      run: () => void act('open_dispute', ['NimbusAPI May 2026 uptime and maintenance-notice dispute']),
    },
    {
      label: 'Run validator ruling',
      hint: 'Every validator re-fetches the evidence and derives the ruling independently.',
      show: st.status === 'DISPUTED',
      enabled: canAct && (role === 'customer' || role === 'provider'),
      run: () => void act('rule'),
    },
    {
      label: 'Release escrow',
      hint: 'Settle per the finalized ruling. Transfers apply at finalization.',
      show: st.status === 'RULED' && st.outcome !== 'INSUFFICIENT_EVIDENCE',
      enabled: canAct && (role === 'customer' || role === 'provider'),
      run: () => void act('release'),
    },
    {
      label: 'Resolve deadlock',
      hint: 'Deterministic fallback once the deadline passes.',
      show: Boolean(dl?.resolve_deadlock_available),
      enabled: canAct && (role === 'customer' || role === 'provider'),
      run: () => void act('resolve_deadlock'),
    },
  ].filter((a) => a.show) : [];

  /* ------------------------------------------------------------------ UI */
  return (
    <div className="app">
      <header>
        <div>
          <h1>UptimeBond</h1>
          <p className="tagline">SLA escrow adjudicated by GenLayer validators</p>
        </div>
        <div className="wallet">
          {wrongChain && (
            <button className="warn-btn" onClick={() => provider && switchToBradbury(provider)}>
              Wrong network — switch to {CHAIN_NAME}
            </button>
          )}
          {account ? (
            <span className="pill">
              <span className={`net ${wrongChain ? 'bad' : 'good'}`} />
              {shortAddr(account)}
            </span>
          ) : (
            <button onClick={() => void connect()}>Connect wallet</button>
          )}
        </div>
      </header>

      {walletErr && <div className="notice error">{walletErr}</div>}
      {!provider && (
        <div className="notice">
          Read-only mode: no wallet detected. Everything below is live on-chain data;
          connect a wallet to act as the customer or provider.
        </div>
      )}

      <nav className="cases">
        {AGREEMENTS.map((a) => (
          <button
            key={a.id}
            className={a.id === cfgId ? 'case active' : 'case'}
            onClick={() => setCfgId(a.id)}
            disabled={!a.address}
            title={a.address ?? 'not yet deployed'}
          >
            {a.label}
            {!a.address && <span className="tag">pending</span>}
          </button>
        ))}
      </nav>

      <p className="blurb">{cfg.blurb}</p>

      <TxProgress tx={tx} onDismiss={() => setTx({ phase: 'idle' })} />

      {loading && <div className="card"><p className="muted">Loading on-chain state…</p></div>}
      {loadErr && (
        <div className="card">
          <div className="notice error">
            Could not read the contract: {loadErr}
            <button className="ghost" onClick={() => void refresh()}>Retry</button>
          </div>
        </div>
      )}

      {st && (
        <>
          <div className="grid">
            <Overview cfg={cfg} st={st} role={role} account={account ?? undefined} />
            <LifecycleBar status={st.status} />
          </div>

          {actions.length > 0 && (
            <div className="card">
              <h2>Actions</h2>
              {role === 'observer' && (
                <p className="notice">
                  You are connected as an observer. Only the customer and provider can
                  act on this agreement.
                </p>
              )}
              <div className="actions">
                {actions.map((a) => (
                  <div key={a.label} className="action">
                    <button onClick={a.run} disabled={!a.enabled}>{a.label}</button>
                    <p className="muted small">{a.hint}</p>
                  </div>
                ))}
              </div>
              {busy && <p className="muted small">An action is in flight; further actions are disabled until it settles.</p>}
            </div>
          )}

          <div className="grid">
            <Ruling st={st} />
            <Evidence cfg={cfg} />
          </div>

          <div className="grid">
            <Deadlock dl={dl} />
            <div className="card">
              <h2>Appeals &amp; finality</h2>
              <p>
                There is no custom AI re-ruling method. Parties use GenLayer&apos;s native
                transaction appeal to re-adjudicate the <code>rule</code> transaction.
              </p>
              <p>
                Every settlement uses <code>on=&quot;finalized&quot;</code> transfers, so funds never
                move before the accepted decision is final. A ruling that is accepted but
                not yet finalized can still be overturned.
              </p>
              {st.status === 'RESOLVED' && (
                <div className="notice ok">
                  Settled via <strong>{st.resolution_mode.replaceAll('_', ' ').toLowerCase()}</strong>.
                  Customer received {fmtGen(
                    (BigInt(st.escrow_atto) * BigInt(st.refund_bps)) / 10000n,
                  )} GEN; provider received {fmtGen(
                    BigInt(st.escrow_atto) - (BigInt(st.escrow_atto) * BigInt(st.refund_bps)) / 10000n,
                  )} GEN, before gas.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <footer>
        <span>
          <a href={`${EXPLORER}/address/${cfg.address}`} target="_blank" rel="noreferrer">Explorer</a>
          {' · '}
          <a href={`${REPO}/tree/${SOURCE_COMMIT}`} target="_blank" rel="noreferrer">
            Source @ {SOURCE_COMMIT.slice(0, 7)}
          </a>
          {' · '}
          {CHAIN_NAME} (chain {CHAIN_ID})
        </span>
        <span className="muted small">
          Evidence fixtures are fabricated test data, not real monitoring.
        </span>
      </footer>
    </div>
  );
}
