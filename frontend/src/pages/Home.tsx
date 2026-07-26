import { Link } from 'react-router-dom';
import { useEffect } from 'react';
import { OUTCOME_SCHEDULE } from '../config';

export function Home() {
  useEffect(() => { document.title = 'UptimeBond — SLA escrow adjudicated by GenLayer'; }, []);
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">On-chain SLA dispute resolution</span>
          <h2 className="hero-title">Escrow that settles its own SLA disputes.</h2>
          <p className="hero-sub">
            A customer holds payment in escrow against a provider&apos;s uptime commitment. If they
            disagree about whether the SLA was met, GenLayer validators independently re-fetch the
            evidence, derive the ruling, and settle the escrow — no trusted middleman, no off-chain
            coordinator.
          </p>
          <div className="hero-cta">
            <Link to="/create" className="btn-primary">Create an agreement</Link>
            <Link to="/demo" className="btn-ghost">See four live rulings →</Link>
          </div>
          <p className="muted small">Live on the GenLayer Bradbury testnet. No real funds. No sign-up.</p>
        </div>
      </section>

      <section className="steps">
        {[
          { n: 1, t: 'Fund escrow', d: 'The customer deploys an agreement and locks GEN against the provider’s uptime SLA.' },
          { n: 2, t: 'Provider accepts', d: 'The provider connects a wallet and commits to the pinned SLA and evidence sources.' },
          { n: 3, t: 'Validators rule', d: 'On a dispute, every validator re-fetches the evidence and independently derives the outcome.' },
          { n: 4, t: 'Escrow settles', d: 'The contract pays out per the ruling — verified on-chain, not inferred from status.' },
        ].map((s) => (
          <div key={s.n} className="step-card">
            <span className="step-n">{s.n}</span>
            <h3>{s.t}</h3>
            <p className="muted">{s.d}</p>
          </div>
        ))}
      </section>

      <div className="grid">
        <div className="card">
          <h2>The ruling controls the money — not a prompt</h2>
          <p className="muted">
            Validators agree on a <em>decision label</em> only. The contract maps that label to a
            fixed payout schedule, so a prompt injection in an untrusted evidence source can never
            move the escrow.
          </p>
          <table className="schedule">
            <thead><tr><th>Outcome</th><th>Customer</th><th>Provider</th></tr></thead>
            <tbody>
              {OUTCOME_SCHEDULE.map((o) => (
                <tr key={o.outcome}>
                  <td><code>{o.outcome.replaceAll('_', ' ')}</code></td>
                  <td>{o.customer}</td>
                  <td>{o.provider}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Why this needs GenLayer</h2>
          <ul className="checks">
            <li><strong>Native web + AI in consensus.</strong> The contract fetches its own evidence and reasons over it — no oracle to trust.</li>
            <li><strong>Independent re-derivation.</strong> Every validator re-fetches the sources and re-derives the ruling; no single party&apos;s output is authoritative.</li>
            <li><strong>Native escrow &amp; payouts.</strong> The same system that adjudicates also custodies and settles the funds.</li>
            <li><strong>Native appeals &amp; deadlock breakers.</strong> Disputes can be appealed, and deterministic fallbacks guarantee the escrow can always be freed.</li>
          </ul>
          <p><Link to="/help">How it works in detail →</Link></p>
        </div>
      </div>

      <div className="notice" role="note">
        <strong>Testnet software.</strong> UptimeBond runs on the GenLayer Bradbury testnet with no
        legal guarantee and no real value at stake. Evidence sources are controlled by third parties,
        validators may disagree or time out, and you must verify every address and term before signing.
        See <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy</Link>.
      </div>
    </>
  );
}
