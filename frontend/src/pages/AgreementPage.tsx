import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EXPLORER } from '../config';
import { isAddress } from '../lib/validation';
import { getAgreement, upsertAgreement } from '../lib/registry';
import { AgreementView } from '../components/AgreementView';

export function AgreementPage() {
  const { contractAddress = '' } = useParams();
  const [saved, setSaved] = useState(false);
  const valid = isAddress(contractAddress);

  useEffect(() => { document.title = `Agreement ${contractAddress.slice(0, 8)}… — UptimeBond`; }, [contractAddress]);
  useEffect(() => { setSaved(!!getAgreement(contractAddress)); }, [contractAddress]);

  // Escrow to fund, if this agreement is one we created and remembered.
  const entry = getAgreement(contractAddress);
  const fundAtto = entry?.notes && /^\d+$/.test(entry.notes) ? BigInt(entry.notes) : undefined;

  if (!valid) {
    return (
      <div className="empty-state">
        <div className="empty-emoji" aria-hidden="true">⚠️</div>
        <h2>Invalid contract address</h2>
        <p className="muted">This route needs a valid 0x address.</p>
        <Link to="/agreements" className="btn-primary">My agreements</Link>
      </div>
    );
  }

  const save = () => {
    upsertAgreement({ address: contractAddress, source: 'imported' });
    setSaved(true);
  };

  return (
    <>
      <div className="page-head">
        <div className="ph-row">
          <h2>Agreement</h2>
          <div className="ph-actions">
            <Link to={`/invite/${contractAddress}`} className="btn-ghost">Invite provider</Link>
            {!saved && <button className="ghost" onClick={save}>Save to My Agreements</button>}
            <a href={`${EXPLORER}/address/${contractAddress}`} target="_blank" rel="noopener noreferrer" className="btn-ghost">Explorer ↗</a>
          </div>
        </div>
        <p className="mono muted">{contractAddress}</p>
      </div>

      <AgreementView address={contractAddress} fundAtto={fundAtto} />
    </>
  );
}
