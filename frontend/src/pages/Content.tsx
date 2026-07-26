import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CHAIN_ID, CHAIN_NAME, EXPLORER, REPO } from '../config';

function useTitle(t: string) {
  useEffect(() => { document.title = t; }, [t]);
}

export function Help() {
  useTitle('How it works — UptimeBond');
  return (
    <article className="prose">
      <h2>How UptimeBond works</h2>
      <p>
        UptimeBond is an escrow that settles service-level-agreement disputes on-chain. It runs as a
        GenLayer intelligent contract on the {CHAIN_NAME}. The contract holds the customer&apos;s
        payment, and when a dispute is raised, GenLayer validators independently retrieve the agreed
        evidence sources and re-derive the ruling. The contract then settles the escrow according to
        a fixed outcome schedule.
      </p>

      <h3>The lifecycle</h3>
      <ol>
        <li><strong>Create &amp; fund.</strong> The customer deploys an agreement — pinning the provider address, four immutable evidence URLs, the escrow amount, and deadlock terms — then funds the escrow.</li>
        <li><strong>Provider accepts.</strong> The provider opens the invitation link, connects the registered wallet, and accepts the SLA. The agreement becomes active.</li>
        <li><strong>Normal completion.</strong> If there is no breach, the customer approves the service and the provider is paid in full.</li>
        <li><strong>Dispute.</strong> Either party can open a dispute over a stated incident window.</li>
        <li><strong>Ruling.</strong> Validators re-fetch the evidence and derive one of four outcomes. Consensus is over the decision label only, never the prose reasoning.</li>
        <li><strong>Settlement.</strong> The escrow is released per the ruling. Payouts are EVM external messages that execute at finalization.</li>
      </ol>

      <h3>Who produces the evidence?</h3>
      <p>
        UptimeBond does not monitor your service. You supply evidence URLs — an SLA-terms document,
        an <em>independent monitor</em> report, a provider status page, and a maintenance feed. The
        independent monitor is the primary operational evidence. Validators fetch these sources during
        adjudication, so they must be public and, ideally, commit-pinned so they cannot shift mid-dispute.
        You can use an existing third-party uptime monitor or publish your own monitor output as JSON.
      </p>

      <h3>The outcome schedule</h3>
      <p>
        The model chooses a label; the contract maps it to a payout. This is what makes the system
        injection-resistant — evidence can influence the label, but never the numbers.
      </p>
      <ul>
        <li><code>NO_BREACH</code> — provider keeps 100%.</li>
        <li><code>PARTIAL_REFUND</code> — 25% to the customer, 75% to the provider.</li>
        <li><code>FULL_REFUND</code> — 100% to the customer.</li>
        <li><code>INSUFFICIENT_EVIDENCE</code> — no automatic settlement; the escrow stays custodied pending a mutual settlement, a native appeal, or the deadlock fallback.</li>
      </ul>

      <h3>Safety nets</h3>
      <p>
        Two deterministic deadlock breakers guarantee the escrow can always be freed without an
        off-chain coordinator, and disputed rulings can be re-adjudicated through GenLayer&apos;s native
        transaction appeal. A payout is never reported as complete from status alone — the app reads
        the live contract balance to confirm the funds actually moved.
      </p>

      <h3>Network</h3>
      <p>
        Chain: <strong>{CHAIN_NAME}</strong> (ID {CHAIN_ID}). Explore any contract or transaction at{' '}
        <a href={EXPLORER} target="_blank" rel="noopener noreferrer">{EXPLORER.replace('https://', '')}</a>.
        Source: <a href={REPO} target="_blank" rel="noopener noreferrer">GitHub</a>.
      </p>
      <p><Link to="/create">Create your first agreement →</Link></p>
    </article>
  );
}

export function Privacy() {
  useTitle('Privacy — UptimeBond');
  return (
    <article className="prose">
      <h2>Privacy</h2>
      <p><em>Testnet application. Last updated 2026.</em></p>
      <h3>What UptimeBond stores</h3>
      <p>
        UptimeBond is a client-side application with no backend account system and no server-side
        database of users. It does not collect names, emails, or passwords.
      </p>
      <ul>
        <li><strong>On your device only.</strong> Agreement addresses you create, import, or are invited to, along with any private labels and notes you add, are stored in your browser&apos;s local storage. Clearing site data removes them. They are never transmitted to us.</li>
        <li><strong>On the public blockchain.</strong> Anything you submit as a transaction — agreement creation, funding, disputes, rulings, settlements — is recorded on the public GenLayer Bradbury testnet and is visible to anyone.</li>
        <li><strong>Wallet.</strong> Your wallet address is read to determine your role in an agreement. We do not transmit it to third-party analytics.</li>
      </ul>
      <h3>What we never handle</h3>
      <p>
        We never request, display, store, or log private keys, seed phrases, or wallet passwords. All
        signing happens inside your wallet.
      </p>
      <h3>Third-party evidence</h3>
      <p>
        Evidence sources are URLs you choose, controlled by third parties. When you preview a source,
        your browser fetches it directly; we do not proxy or retain the contents.
      </p>
    </article>
  );
}

export function Terms() {
  useTitle('Terms — UptimeBond');
  return (
    <article className="prose">
      <h2>Terms</h2>
      <p><em>Testnet application. Last updated 2026.</em></p>
      <h3>No warranty, no legal guarantee</h3>
      <p>
        UptimeBond is experimental software provided “as is”, without warranty of any kind, for use on
        the GenLayer Bradbury <strong>testnet only</strong>. Testnet GEN has no monetary value.
        Nothing here is a real service-level agreement, financial product, investment, or legal contract,
        and nothing here is financial or legal advice.
      </p>
      <h3>You are responsible for what you sign</h3>
      <ul>
        <li>Verify every contract address, provider address, evidence URL, and escrow amount before signing. Deployed evidence sources are immutable.</li>
        <li>Transactions are irreversible once finalized. A transaction hash is not a confirmation.</li>
        <li>Validators are independent and may disagree, time out, or be delayed; the network can be congested.</li>
        <li>Evidence sources are controlled by third parties and may change or become unavailable.</li>
      </ul>
      <h3>Adjudication is probabilistic</h3>
      <p>
        Rulings are produced by validator consensus over external evidence and AI reasoning. Outcomes
        are best-effort, not guaranteed to be correct or final until they finalize, and can be appealed
        through GenLayer&apos;s native mechanism.
      </p>
      <h3>No mainnet claim</h3>
      <p>
        This deployment is production-grade and submission-ready for the GenLayer Bradbury testnet. It is
        not represented as ready for commercial or mainnet use.
      </p>
    </article>
  );
}

export function NotFound() {
  useTitle('Not found — UptimeBond');
  return (
    <div className="empty-state">
      <div className="empty-emoji" aria-hidden="true">🔍</div>
      <h2>Page not found</h2>
      <p className="muted">That route doesn&apos;t exist. It may have been a stale link.</p>
      <Link to="/" className="btn-primary">Back to dashboard</Link>
    </div>
  );
}
