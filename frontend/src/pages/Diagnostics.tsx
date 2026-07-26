import { useEffect, useState } from 'react';
import { CHAIN_ID, CHAIN_NAME, EXPLORER_API, RPC_URL } from '../config';
import { BUILD_VERSION, recentErrors, clearErrors, type ClientError } from '../lib/health';
import { useWallet } from '../state/wallet';

type Ping = 'checking' | 'ok' | 'down';

/** Application health / diagnostics. Privacy-conscious: shows build id, network
 *  reachability, and recent client errors with wallet addresses already redacted.
 *  Nothing here is transmitted anywhere. */
export function Diagnostics() {
  const wallet = useWallet();
  const [explorer, setExplorer] = useState<Ping>('checking');
  const [rpc, setRpc] = useState<Ping>('checking');
  const [errors, setErrors] = useState<ClientError[]>(recentErrors());

  useEffect(() => { document.title = 'Diagnostics — UptimeBond'; }, []);

  useEffect(() => {
    fetch(`${EXPLORER_API}/transactions/0x${'0'.repeat(64)}`)
      .then((r) => setExplorer(r.status < 500 ? 'ok' : 'down')).catch(() => setExplorer('down'));
    fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) })
      .then((r) => setRpc(r.ok ? 'ok' : 'down')).catch(() => setRpc('down'));
  }, []);

  const dot = (s: Ping) => <span className={`net ${s === 'ok' ? 'good' : s === 'down' ? 'bad' : ''}`} aria-hidden="true" />;

  return (
    <>
      <div className="page-head">
        <h2>Diagnostics</h2>
        <p className="muted">Local application health. Nothing on this page is sent anywhere.</p>
      </div>

      <div className="grid">
        <div className="card">
          <h2>Build &amp; network</h2>
          <dl className="kv">
            <dt>Build</dt><dd className="mono">{BUILD_VERSION}</dd>
            <dt>Network</dt><dd>{CHAIN_NAME} <span className="mono">(chain {CHAIN_ID})</span></dd>
            <dt>Wallet</dt><dd>{wallet.hasWallet ? (wallet.account ? 'connected' : 'available') : 'none detected'}</dd>
            <dt>Wallet chain</dt><dd>{wallet.chainId ?? '—'}{wallet.wrongChain ? ' (wrong network)' : ''}</dd>
            <dt>Explorer API</dt><dd role="status">{dot(explorer)} {explorer}</dd>
            <dt>JSON-RPC</dt><dd role="status">{dot(rpc)} {rpc}</dd>
          </dl>
        </div>
        <div className="card">
          <div className="settle-head" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Recent client errors</h2>
            {errors.length > 0 && <button className="ghost" onClick={() => { clearErrors(); setErrors([]); }}>Clear</button>}
          </div>
          {errors.length === 0 ? (
            <p className="muted">No client errors recorded this session.</p>
          ) : (
            <ul className="evidence">
              {errors.map((e, i) => (
                <li key={i}>
                  <span><span className="tag">{e.class}</span> {e.message}</span>
                  <span className="muted small">{new Date(e.at).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">Wallet addresses are redacted before anything is recorded.</p>
        </div>
      </div>
    </>
  );
}
