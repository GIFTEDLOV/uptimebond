import { NavLink, Link, Outlet, useLocation } from 'react-router-dom';
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
    <div className="wallet">
      <button onClick={() => void w.connect()} disabled={w.connecting}>
        {w.connecting ? 'Connecting…' : 'Connect Wallet'}
      </button>
    </div>
  );
}

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/create', label: 'Create' },
  { to: '/agreements', label: 'Agreements' },
  { to: '/demo', label: 'Live Cases' },
  { to: '/help', label: 'How It Works' },
];

/** The UptimeBond mark: an escrow ring closed by a settled bond. */
function Wordmark() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="13" fill="none" stroke="var(--espresso)" strokeWidth="1.6" />
      <path
        d="M16 3 A 13 13 0 0 1 27.3 22.5"
        fill="none" stroke="var(--bronze)" strokeWidth="2.6" strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="4" fill="var(--espresso)" />
    </svg>
  );
}

export function Layout() {
  const w = useWallet();
  const { pathname } = useLocation();
  // The homepage manages its own full-bleed editorial bands; every other
  // route is laid out inside the standard measure.
  const isEditorial = pathname === '/';

  return (
    <div className="app">
      <a href="#main" className="skip-link">Skip to content</a>

      <header className="masthead">
        <div className="masthead-in">
          <Link to="/" className="brand" aria-label="UptimeBond home">
            <Wordmark />
            <div>
              <h1>UptimeBond</h1>
              <p className="tagline">Escrow that settles service disputes</p>
            </div>
          </Link>

          <nav className="mainnav" aria-label="Primary">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => (isActive ? 'navlink active' : 'navlink')}>
                {n.label}
              </NavLink>
            ))}
          </nav>

          <WalletButton />
        </div>
      </header>

      {w.wrongChain && (
        <div className="banner-strip is-warn">
          <div className="notice warn" role="alert">
            Your wallet is on the wrong network.{' '}
            <button className="linklike" onClick={() => void w.switchNetwork()}>Switch to {CHAIN_NAME}</button>{' '}
            to create or act on agreements. You can keep browsing in read-only mode.
          </div>
        </div>
      )}
      {w.error && (
        <div className="banner-strip is-error">
          <div className="notice error" role="alert">
            {w.error} <button className="linklike" onClick={w.clearError}>Dismiss</button>
          </div>
        </div>
      )}
      {!w.hasWallet && (
        <div className="banner-strip">
          <div className="notice" role="status">
            Read-only mode: no wallet detected. Everything is live on-chain data — connect an EVM
            wallet (e.g. MetaMask) to create agreements or act as a party.
          </div>
        </div>
      )}

      <main id="main" className={isEditorial ? 'main-full' : 'main-shell'}>
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="footer-in">
          <div className="footer-top">
            <div className="footer-brand">
              <h2>UptimeBond</h2>
              <p>
                Escrow that settles service disputes — held on-chain, ruled by GenLayer
                validators, released without a trusted middleman.
              </p>
            </div>

            <div className="footer-col">
              <h3>Product</h3>
              <ul>
                <li><Link to="/create">Create Agreement</Link></li>
                <li><Link to="/agreements">My Agreements</Link></li>
                <li><Link to="/demo">Live Cases</Link></li>
                <li><Link to="/diagnostics">Diagnostics</Link></li>
              </ul>
            </div>

            <div className="footer-col">
              <h3>Resources</h3>
              <ul>
                <li><Link to="/help">How It Works</Link></li>
                <li><a href={REPO} target="_blank" rel="noopener noreferrer">GitHub</a></li>
                <li>
                  <a href={EXPLORER} target="_blank" rel="noopener noreferrer">Bradbury Explorer</a>
                </li>
              </ul>
            </div>

            <div className="footer-col">
              <h3>Legal</h3>
              <ul>
                <li><Link to="/terms">Terms</Link></li>
                <li><Link to="/privacy">Privacy</Link></li>
              </ul>
            </div>
          </div>

          <div className="footer-bottom">
            <span className="footer-status">
              <span className="net good" aria-hidden="true" />
              Production · live on {CHAIN_NAME} ·{' '}
              <a href={PROD_ORIGIN}>{PROD_ORIGIN.replace('https://', '')}</a>
            </span>
            <span className="footer-note">
              Testnet only. Testnet GEN has no monetary value and nothing here is a legally
              binding service-level agreement.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
