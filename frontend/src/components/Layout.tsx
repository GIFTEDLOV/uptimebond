import { NavLink, Link, Outlet } from 'react-router-dom';
import { CHAIN_NAME, EXPLORER, REPO, PROD_ORIGIN } from '../config';
import { shortAddr } from '../chain';
import { useWallet } from '../state/wallet';

function WalletButton() {
  const w = useWallet();
  if (w.account) {
    return (
      <div className="wallet">
        <span className="pill" title={w.account}>
          <span className={`net ${w.wrongChain ? 'bad' : 'good'}`} aria-hidden="true" />
          {shortAddr(w.account)}
        </span>
        <button className="ghost" onClick={w.disconnect} aria-label="Disconnect wallet">Disconnect</button>
      </div>
    );
  }
  return (
    <button onClick={() => void w.connect()} disabled={w.connecting}>
      {w.connecting ? 'Connecting…' : 'Connect Wallet'}
    </button>
  );
}

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/create', label: 'Create Agreement' },
  { to: '/agreements', label: 'My Agreements' },
  { to: '/demo', label: 'Live Demo' },
  { to: '/help', label: 'How It Works' },
];

export function Layout() {
  const w = useWallet();
  return (
    <div className="app">
      <a href="#main" className="skip-link">Skip to content</a>

      <header className="masthead">
        <Link to="/" className="brand" aria-label="UptimeBond home">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M9 16.5l4.8 4.8L23 12" stroke="#fff" strokeWidth="3.2"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h1>UptimeBond</h1>
            <p className="tagline">SLA escrow, adjudicated by GenLayer validators</p>
          </div>
        </Link>
        <WalletButton />
      </header>

      <nav className="mainnav" aria-label="Primary">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}
            className={({ isActive }) => (isActive ? 'navlink active' : 'navlink')}>
            {n.label}
          </NavLink>
        ))}
      </nav>

      {w.wrongChain && (
        <div className="notice warn" role="alert">
          Your wallet is on the wrong network.{' '}
          <button className="linklike" onClick={() => void w.switchNetwork()}>Switch to {CHAIN_NAME}</button>{' '}
          to create or act on agreements. You can keep browsing in read-only mode.
        </div>
      )}
      {w.error && (
        <div className="notice error" role="alert">
          {w.error} <button className="linklike" onClick={w.clearError}>Dismiss</button>
        </div>
      )}
      {!w.hasWallet && (
        <div className="notice" role="status">
          Read-only mode: no wallet detected. Everything is live on-chain data — connect an EVM
          wallet (e.g. MetaMask) to create agreements or act as a party.
        </div>
      )}

      <main id="main">
        <Outlet />
      </main>

      <footer>
        <span>
          <a href={REPO} target="_blank" rel="noopener noreferrer">GitHub</a>{' · '}
          <a href={EXPLORER} target="_blank" rel="noopener noreferrer">Explorer</a>{' · '}
          <Link to="/help">How it works</Link>{' · '}
          <Link to="/privacy">Privacy</Link>{' · '}
          <Link to="/terms">Terms</Link>{' · '}
          <Link to="/diagnostics">Diagnostics</Link>
        </span>
        <span className="muted small">
          {CHAIN_NAME} · testnet only · <a href={PROD_ORIGIN}>{PROD_ORIGIN.replace('https://', '')}</a>
        </span>
      </footer>
    </div>
  );
}
