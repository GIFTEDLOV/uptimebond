import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { EXPLORER, PROD_ORIGIN } from '../config';
import { fmtGen, shortAddr } from '../chain';
import { isAddress, sameAddress } from '../lib/validation';
import { upsertAgreement } from '../lib/registry';
import { useWallet } from '../state/wallet';
import { useLiveAgreement, roleFor } from '../state/hooks';
import { AgreementView } from '../components/AgreementView';
import { EvidenceSources, StatusChip } from '../components/Panels';
import { readEvidenceSources } from '../chain';

/** Provider onboarding. Loads the live agreement with no wallet, shows the
 *  obligations, and only enables acceptance once the connected wallet matches the
 *  contract-registered provider. */
export function Invite() {
  const { contractAddress = '' } = useParams();
  const valid = isAddress(contractAddress);
  const wallet = useWallet();
  const { st, loading } = useLiveAgreement(valid ? contractAddress : null);
  const [sources, setSources] = useState<Record<string, string> | null>(null);
  const [qr, setQr] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const inviteUrl = `${PROD_ORIGIN}/invite/${contractAddress}`;

  useEffect(() => { document.title = 'Provider invitation — UptimeBond'; }, []);
  useEffect(() => {
    if (!valid) return;
    QRCode.toDataURL(inviteUrl, { margin: 1, width: 220 }).then(setQr).catch(() => {});
    readEvidenceSources(contractAddress).then(setSources).catch(() => {});
  }, [valid, inviteUrl, contractAddress]);

  const role = roleFor(wallet.account, st);
  const isRegisteredProvider = st && wallet.account && sameAddress(wallet.account, st.provider);

  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { /* ignore */ }
  };
  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: { title: string; url: string }) => Promise<void> };
    if (nav.share) { try { await nav.share({ title: 'UptimeBond agreement', url: inviteUrl }); } catch { /* cancelled */ } }
    else void copy();
  };

  if (!valid) {
    return (
      <div className="empty-state">
        <div className="empty-emoji" aria-hidden="true">⚠️</div>
        <h2>Invalid invitation</h2>
        <p className="muted">This invitation link needs a valid contract address.</p>
        <Link to="/" className="btn-primary">Home</Link>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Provider invitation</span>
        <h2>You&apos;ve been invited to accept an SLA</h2>
        <p className="mono muted">{contractAddress}</p>
      </div>

      {loading && !st && <div className="card"><div className="skeleton-lines"><span /><span /><span /></div></div>}

      {st && (
        <>
          <div className="grid">
            <div className="card">
              <div className="settle-head" style={{ marginBottom: 12 }}>
                <h2 style={{ margin: 0 }}>Agreement summary</h2>
                <StatusChip status={st.status} />
              </div>
              <dl className="kv">
                <dt>Escrow</dt><dd className="mono">{fmtGen(st.escrow_atto)} GEN</dd>
                <dt>Customer</dt><dd className="mono">{shortAddr(st.customer)}</dd>
                <dt>Provider (you)</dt><dd className="mono">{shortAddr(st.provider)}</dd>
              </dl>
              <div className="notice">
                <strong>Provider obligations.</strong> By accepting, you commit to the pinned SLA and
                the four immutable evidence sources below. If a dispute is opened, validators re-fetch
                those sources and rule; the escrow settles per the fixed outcome schedule. Only the
                registered provider wallet <span className="mono">{shortAddr(st.provider)}</span> can accept.
              </div>
            </div>

            <div className="card share-card">
              <h2>Share this invitation</h2>
              {qr && <img src={qr} alt="QR code linking to this invitation" className="qr" width={180} height={180} />}
              <div className="share-actions">
                <button onClick={() => void copy()}>{copied ? 'Copied ✓' : 'Copy link'}</button>
                <button className="ghost" onClick={() => void share()}>Share</button>
              </div>
              <p className="mono small break">{inviteUrl}</p>
            </div>
          </div>

          {sources && <EvidenceSources sources={sources} />}

          <div className="card">
            <h2>Accept the SLA</h2>
            {!wallet.account && (
              <>
                <p className="muted">Connect the registered provider wallet to accept.</p>
                <button onClick={() => void wallet.connect()} disabled={wallet.connecting}>
                  {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
                </button>
              </>
            )}
            {wallet.account && wallet.wrongChain && (
              <p className="notice warn">Switch to Bradbury to accept.</p>
            )}
            {wallet.account && !wallet.wrongChain && !isRegisteredProvider && st.status === 'AWAITING_PROVIDER_ACCEPTANCE' && (
              <p className="notice error">
                Connected wallet <span className="mono">{shortAddr(wallet.account)}</span> is not the
                registered provider. Acceptance is disabled — connect{' '}
                <span className="mono">{shortAddr(st.provider)}</span> instead.
              </p>
            )}
            {wallet.account && role === 'customer' && (
              <p className="notice">You are the customer on this agreement, not the provider.</p>
            )}
            {st.status !== 'AWAITING_PROVIDER_ACCEPTANCE' && (
              <p className="notice">
                This agreement is no longer awaiting acceptance (status: {st.status.replaceAll('_', ' ').toLowerCase()}).
              </p>
            )}

            {/* When the connected wallet IS the registered provider and the state
                is awaiting acceptance, the full action set (accept_sla) renders
                below, gated identically by the contract-confirmed role. */}
            {isRegisteredProvider && st.status === 'AWAITING_PROVIDER_ACCEPTANCE' && (
              <>
                <p className="muted">You are the registered provider. Review the sources above, then accept.</p>
                <button className="ghost" onClick={() => upsertAgreement({ address: contractAddress, source: 'invited', role: 'provider' })}>
                  Save to My Agreements
                </button>
              </>
            )}
          </div>

          <details className="full-detail">
            <summary>Full live agreement detail</summary>
            <AgreementView address={contractAddress} />
          </details>
        </>
      )}

      <p className="muted small">
        <a href={`${EXPLORER}/address/${contractAddress}`} target="_blank" rel="noopener noreferrer">Verify this contract on the explorer ↗</a>
      </p>
    </>
  );
}
