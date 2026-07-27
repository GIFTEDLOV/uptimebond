import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { isUptimeBondContract, readAgreement, shortAddr } from '../chain';
import { isAddress } from '../lib/validation';
import {
  listAgreements, removeAgreement, upsertAgreement, type RegistryEntry,
} from '../lib/registry';
import { useWallet } from '../state/wallet';
import { roleFor } from '../state/hooks';
import { StatusChip } from '../components/Panels';
import { EmptyMark } from '../components/editorial/Editorial';

export function Agreements() {
  const wallet = useWallet();
  const [entries, setEntries] = useState<RegistryEntry[]>(listAgreements());
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [importAddr, setImportAddr] = useState('');
  const [importErr, setImportErr] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => { document.title = 'My Agreements — UptimeBond'; }, []);

  const reload = useCallback(() => setEntries(listAgreements()), []);
  useEffect(() => {
    window.addEventListener('uptimebond:registry', reload);
    return () => window.removeEventListener('uptimebond:registry', reload);
  }, [reload]);

  const doImport = async () => {
    setImportErr(null);
    const addr = importAddr.trim();
    if (!isAddress(addr)) { setImportErr('Enter a valid 0x contract address.'); return; }
    setImporting(true);
    try {
      const ok = await isUptimeBondContract(addr);
      if (!ok) { setImportErr('That address is not a readable UptimeBond contract on Bradbury.'); return; }
      const st = await readAgreement(addr);
      upsertAgreement({
        address: addr, source: 'imported',
        role: roleFor(wallet.account, st) === 'unknown' ? 'observer' : roleFor(wallet.account, st),
        lastStatus: st.status, lastOutcome: st.outcome || undefined, refreshedAt: Date.now(),
      });
      setImportAddr('');
      reload();
    } catch {
      setImportErr('Could not read that contract. Check the address and network.');
    } finally {
      setImporting(false);
    }
  };

  const filtered = useMemo(() => entries.filter((e) => {
    if (q && !`${e.address} ${e.serviceLabel ?? ''} ${e.providerLabel ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (roleFilter !== 'all' && e.role !== roleFilter) return false;
    if (statusFilter !== 'all' && (e.lastStatus ?? '') !== statusFilter) return false;
    return true;
  }), [entries, q, roleFilter, statusFilter]);

  return (
    <>
      <div className="page-head">
        <h2>My agreements</h2>
        <p className="muted">
          A private index kept in this browser only — no account, no custody. The chain is the source
          of truth; this just remembers which contracts to show and your own labels.
        </p>
      </div>

      <div className="card import-card">
        <h2>Import an agreement</h2>
        <div className="import-row">
          <input
            type="text" inputMode="text" placeholder="0x contract address" value={importAddr}
            onChange={(e) => setImportAddr(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void doImport()}
            aria-label="Contract address to import"
          />
          <button onClick={() => void doImport()} disabled={importing}>
            {importing ? 'Checking…' : 'Import'}
          </button>
        </div>
        {importErr && <p className="notice error" role="alert">{importErr}</p>}
        <p className="muted small">The address is validated as an UptimeBond contract before it&apos;s added.</p>
      </div>

      {entries.length > 0 && (
        <div className="filters">
          <input type="search" placeholder="Search address or label…" value={q}
            onChange={(e) => setQ(e.target.value)} aria-label="Search agreements" />
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role">
            <option value="all">All roles</option>
            <option value="customer">Customer</option>
            <option value="provider">Provider</option>
            <option value="observer">Observer</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option value="all">All statuses</option>
            {['AWAITING_FUNDING','AWAITING_PROVIDER_ACCEPTANCE','ACTIVE','DISPUTED','RULED','RESOLVED'].map((s) => (
              <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>
            ))}
          </select>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="empty-state">
          <EmptyMark />
          <h3>No agreements yet</h3>
          <p className="muted">Create one, import an address, or open an invitation link.</p>
          <Link to="/create" className="btn-primary">Create an agreement</Link>
        </div>
      ) : filtered.length === 0 ? (
        <p className="muted">No agreements match those filters.</p>
      ) : (
        <div className="agreement-list">
          {filtered.map((e) => (
            <div key={e.address} className="agreement-row card">
              <div className="ar-main">
                <Link to={`/agreement/${e.address}`} className="ar-title">
                  {e.serviceLabel || 'Agreement'} <span className="mono muted">{shortAddr(e.address)}</span>
                </Link>
                <div className="ar-meta">
                  {e.lastStatus && <StatusChip status={e.lastStatus} />}
                  <span className={`badge role-${e.role}`}>{e.role}</span>
                  <span className="tag">{e.source}</span>
                  {e.providerLabel && <span className="muted small">provider: {e.providerLabel}</span>}
                </div>
              </div>
              <div className="ar-actions">
                <Link to={`/agreement/${e.address}`} className="btn-ghost">Open</Link>
                <button className="ghost" onClick={() => { removeAgreement(e.address); reload(); }}
                  aria-label={`Remove ${e.address} from this browser`}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="muted small">Removing a record only forgets it locally; it never changes anything on-chain.</p>
    </>
  );
}
