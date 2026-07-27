import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EXPLORER } from '../config';
import { isAddress } from '../lib/validation';
import { getAgreement, upsertAgreement } from '../lib/registry';
import { AgreementView } from '../components/AgreementView';
import { EmptyMark } from '../components/editorial/Editorial';

export function AgreementPage() {
  const { contractAddress = '' } = useParams();
  const [saved, setSaved] = useState(false);
  const [readable, setReadable] = useState(false);
  const valid = isAddress(contractAddress);

  useEffect(() => { document.title = `Agreement ${contractAddress.slice(0, 8)}… — UptimeBond`; }, [contractAddress]);
  useEffect(() => { setSaved(!!getAgreement(contractAddress)); }, [contractAddress]);

  // Escrow to fund, if this agreement is one we created and remembered.
  // Read from its own field: it used to be smuggled through `notes`, so a note
  // that happened to be digits was funded as an amount and writing an amount
  // destroyed the note.
  const entry = getAgreement(contractAddress);
  const fundAtto = entry?.escrowAtto && /^\d+$/.test(entry.escrowAtto)
    ? BigInt(entry.escrowAtto)
    : undefined;

  if (!valid) {
    return (
      <div className="empty-state">
        <EmptyMark />
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
            {/* Invite and Save stay hidden until the contract has actually
                answered. A finalized deploy can name an address that holds no
                contract at all — inviting a provider to one, or filing it as an
                agreement, would both be lies. */}
            {readable && (
              <Link to={`/invite/${contractAddress}`} className="btn-ghost">Invite provider</Link>
            )}
            {readable && !saved && (
              <button className="ghost" onClick={save}>Save to My Agreements</button>
            )}
            <a href={`${EXPLORER}/address/${contractAddress}`} target="_blank" rel="noopener noreferrer" className="btn-ghost">Explorer ↗</a>
          </div>
        </div>
        <p className="mono muted">{contractAddress}</p>
      </div>

      <AgreementView address={contractAddress} fundAtto={fundAtto} onReadable={setReadable} />
    </>
  );
}
