import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AGREEMENTS, EXPLORER, OUTCOME_SCHEDULE } from '../config';
import { fmtGen, shortAddr } from '../chain';
import { useCaseSummaries } from '../state/hooks';
import { settlementFigures, StatusChip, outcomeLabel } from '../components/Panels';
import { Reveal, Section, ZoomStage } from '../components/editorial/Editorial';
import {
  AdjudicationVisual, AgreementVisual, EvidenceVisual, TrustVisual,
} from '../components/art/Visuals';

/** The four verified Bradbury deployments, newest payout path only. */
const LIVE_CASES = AGREEMENTS.filter((a) => !a.deprecated && a.address);
const LIVE_ADDRESSES = LIVE_CASES.map((a) => a.address as string);

const OUTCOME_CLASS: Record<string, string> = {
  NO_BREACH: 'no_breach',
  PARTIAL_REFUND: 'partial_refund',
  FULL_REFUND: 'full_refund',
  INSUFFICIENT_EVIDENCE: 'insufficient_evidence',
};

const SOURCES = [
  { label: 'SLA terms', role: 'Authoritative clauses' },
  { label: 'Independent monitor', role: 'Primary evidence' },
  { label: 'Provider status', role: 'Corroborating' },
  { label: 'Maintenance notices', role: 'Corroborating' },
];

const CONSENSUS = [
  {
    n: 'I',
    h: 'Each validator retrieves the evidence itself',
    p: 'No oracle, no relayer, no submitted report. Every validator fetches the same four pinned URLs directly, at adjudication time.',
  },
  {
    n: 'II',
    h: 'Each validator derives its own outcome',
    p: 'The SLA clauses are applied independently. No single party’s reasoning is authoritative, and the prose is never what gets agreed on.',
  },
  {
    n: 'III',
    h: 'Consensus alone moves the escrow',
    p: 'Validators agree on a decision label. The contract maps that label to a fixed payout — so evidence can influence the ruling, never the numbers.',
  },
];

const LIFECYCLE = [
  { n: '01', t: 'Create', who: 'Customer', d: 'Pin the provider’s address, four public evidence URLs, the escrow amount, and the deadlock terms. Everything named here is fixed at deployment.' },
  { n: '02', t: 'Fund', who: 'Customer', d: 'The escrow is paid into the contract. From this moment the money is held by the agreement itself rather than by either party.' },
  { n: '03', t: 'Accept', who: 'Provider', d: 'The provider opens the invitation, connects the registered wallet, and commits to the pinned SLA. The agreement goes live.' },
  { n: '04', t: 'Dispute', who: 'Either party', d: 'When the service is claimed to have fallen short, either side opens a dispute against a stated incident window.' },
  { n: '05', t: 'Rule', who: 'Validators', d: 'Validators re-fetch every source, apply the clauses, and converge on one of four outcomes. Consensus is taken over the decision, not the wording.' },
  { n: '06', t: 'Settle', who: 'The contract', d: 'The escrow is released against the fixed schedule. Transfers execute at finalization, and the contract balance is the proof that they did.' },
];

const SPLIT: Record<string, { customer: number; provider: number }> = {
  NO_BREACH: { customer: 0, provider: 100 },
  PARTIAL_REFUND: { customer: 25, provider: 75 },
  FULL_REFUND: { customer: 100, provider: 0 },
  INSUFFICIENT_EVIDENCE: { customer: 0, provider: 0 },
};

export function Home() {
  useEffect(() => { document.title = 'UptimeBond — Escrow that settles service disputes'; }, []);
  const { rows, loading } = useCaseSummaries(LIVE_ADDRESSES);

  return (
    <>
      {/* ------------------------------------------------------------ 1. hero */}
      <section className="hero">
        <Reveal className="hero-copy">
          <p className="eyebrow">Escrow that settles service disputes</p>
          <h2 className="hero-title">
            Made for agreements that <span className="accent-em">keep their word</span>.
          </h2>
          <p className="hero-sub">
            UptimeBond holds service payments in escrow, lets GenLayer validators evaluate
            public SLA evidence, and settles the agreement without trusting either party.
          </p>
          <div className="hero-cta">
            <Link to="/create" className="btn-primary">Create Agreement</Link>
            <a href="#live-cases" className="btn-ghost">Explore Live Cases</a>
          </div>
          <p className="hero-fine">
            Live on the GenLayer Bradbury testnet. No real funds. No sign-up.
          </p>
        </Reveal>

        <Reveal className="hero-visual" delay={2}>
          <AgreementVisual />
        </Reveal>
      </section>

      {/* --------------------------------------------------- 2. trust position */}
      <Section tone="tint" labelledBy="trust-h" innerClassName="centered">
        <Reveal>
          <p className="eyebrow">The proposition</p>
          <h2 className="headline" id="trust-h">
            Two parties. One agreement.<br />No <span className="accent-em">trusted middleman</span>.
          </h2>
          <p className="lede">
            A service contract usually needs someone in the middle — a broker, an arbitrator,
            a payment processor with a dispute desk. UptimeBond removes that seat. The escrow,
            the evidence, the ruling and the payout all live in the same contract, and neither
            side can move the money alone.
          </p>
        </Reveal>
        <Reveal className="trust-panel" delay={1}>
          <TrustVisual />
        </Reveal>
      </Section>

      {/* -------------------------------------------------------- 3. evidence */}
      <Section labelledBy="ev-h" innerClassName="centered narrow">
        <Reveal>
          <p className="eyebrow">Evidence</p>
          <h2 className="headline" id="ev-h">
            Four sources, <span className="accent-em">pinned before the dispute exists</span>.
          </h2>
          <p className="lede">
            The SLA terms, an independent monitor, the provider’s own status page, and the
            maintenance notices. All four are fixed at deployment and can never be edited —
            so no one can change the record once they know they are losing.
          </p>
        </Reveal>

        <Reveal delay={1}>
          <figure className="frame frame-sm" style={{ margin: '0 auto' }}>
            <figcaption className="frame-cap">
              <span>Pinned evidence</span>
              <span>Immutable</span>
            </figcaption>
            <div className="frame-body">
              <EvidenceVisual />
            </div>
          </figure>
          <ul className="evidence" style={{ maxWidth: 560, margin: '26px auto 0', textAlign: 'left' }}>
            {SOURCES.map((s) => (
              <li key={s.label}>
                <span>{s.label}</span>
                <span className="tag">{s.role}</span>
              </li>
            ))}
          </ul>
          <p className="frame-hint">Keep scrolling — the record opens up</p>
        </Reveal>
      </Section>

      {/* ------------------------- 3b. the frame expands into the adjudication */}
      <ZoomStage
        flag="One dispute, six independent readings"
        copy={
          <>
            <h2 className="headline">
              The dispute goes to the validators, <span className="accent-em">not to us</span>.
            </h2>
            <p className="lede wide">
              The same four documents, opened out. Every validator retrieves each source
              itself and derives the outcome on its own before anything is agreed.
            </p>
          </>
        }
      >
        <AdjudicationVisual />
      </ZoomStage>

      {/* ----------------------------------------------- 4. validator consensus */}
      <Section tone="dark" labelledBy="cons-h">
        <Reveal>
          <p className="eyebrow">Adjudication</p>
          <h2 className="headline" id="cons-h">
            A ruling nobody had to be <span className="accent-em">trusted</span> for.
          </h2>
          <p className="lede wide">
            GenLayer validators run the adjudication as part of consensus itself. The contract
            reaches out to the web, reasons over what it finds, and only the agreed decision
            is written back — which is what makes the outcome enforceable rather than advisory.
          </p>
        </Reveal>
        <div className="consensus-grid">
          {CONSENSUS.map((c, i) => (
            <Reveal key={c.n} className="consensus-item" delay={(i + 1) as 1 | 2 | 3}>
              <span className="num">{c.n}</span>
              <h3>{c.h}</h3>
              <p>{c.p}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------ 5. settlement */}
      <Section labelledBy="set-h">
        <Reveal>
          <p className="eyebrow">Settlement</p>
          <h2 className="headline" id="set-h">
            Four outcomes. <span className="accent-em">One fixed schedule</span>.
          </h2>
          <p className="lede wide">
            Validators agree on a label; the contract maps that label to a payout it was
            given at deployment. That separation is the security property — a prompt
            injection in an untrusted evidence source can change what is argued, never
            what is paid.
          </p>
        </Reveal>
        <div className="payouts">
          {OUTCOME_SCHEDULE.map((o, i) => {
            const split = SPLIT[o.outcome];
            const settles = o.outcome !== 'INSUFFICIENT_EVIDENCE';
            return (
              <Reveal key={o.outcome} className="payout-card" delay={((i % 4) + 1) as 1 | 2 | 3 | 4}>
                <span className="payout-key">
                  <span className={`dot oc-${OUTCOME_CLASS[o.outcome]}`} aria-hidden="true" />
                  {settles ? 'Settles automatically' : 'No automatic settlement'}
                </span>
                <span className="payout-name">{outcomeLabel(o.outcome).toLowerCase()}</span>
                {settles ? (
                  <>
                    <div className="payout-split" aria-hidden="true">
                      {split.customer > 0 && (
                        <span className="seg-customer" style={{ flex: split.customer }} />
                      )}
                      {split.provider > 0 && (
                        <span className="seg-provider" style={{ flex: split.provider }} />
                      )}
                    </div>
                    <div className="payout-legend">
                      <span>Customer {o.customer}</span>
                      <span>Provider {o.provider}</span>
                    </div>
                  </>
                ) : (
                  <div className="payout-legend">
                    <span>Customer —</span>
                    <span>Provider —</span>
                  </div>
                )}
                <p>{o.note}</p>
              </Reveal>
            );
          })}
        </div>
      </Section>

      {/* ------------------------------------------------------ 6. live cases */}
      <Section tone="tint" id="live-cases" labelledBy="cases-h">
        <Reveal>
          <p className="eyebrow">On the record</p>
          <h2 className="headline" id="cases-h">
            Four agreements, <span className="accent-em">settled in public</span>.
          </h2>
          <p className="lede wide">
            One deployment per outcome, each driven to settlement on Bradbury. Every figure
            below is read live from the contract — including the balance, which is the only
            honest proof that the money actually moved.
          </p>
        </Reveal>

        <div className="cases-grid">
          {LIVE_CASES.map((cfg, i) => {
            const row = cfg.address ? rows[cfg.address] : undefined;
            const fig = row ? settlementFigures(row.st, row.settlement) : null;
            const outcome = row?.st.outcome || cfg.expected.outcome;
            return (
              <Reveal
                key={cfg.id} as="article" className="case-study"
                delay={((i % 4) + 1) as 1 | 2 | 3 | 4}
              >
                <div className="cs-head">
                  <span className="cs-index">{`Case ${String(i + 1).padStart(3, '0')}`}</span>
                  <span className="tag">{cfg.escrowLabel} escrow</span>
                </div>

                <h3 className={`cs-outcome oc-text-${OUTCOME_CLASS[outcome]}`}>
                  {outcomeLabel(outcome).toLowerCase()}
                </h3>
                <p className="cs-blurb">{cfg.blurb}</p>

                <dl className="cs-figures">
                  <div className="cs-fig">
                    <dt>Escrow</dt>
                    <dd>
                      {row ? fmtGen(row.st.escrow_atto) : '—'}
                      <span className="unit">GEN</span>
                    </dd>
                  </div>
                  <div className="cs-fig">
                    <dt>Contract balance</dt>
                    <dd>
                      {fig ? fmtGen(fig.balance) : '—'}
                      <span className="unit">GEN</span>
                    </dd>
                  </div>
                  <div className="cs-fig">
                    <dt>Customer payout</dt>
                    <dd>
                      {fig ? fmtGen(fig.customerAtto) : '—'}
                      <span className="unit">GEN</span>
                    </dd>
                  </div>
                  <div className="cs-fig">
                    <dt>Provider payout</dt>
                    <dd>
                      {fig ? fmtGen(fig.providerAtto) : '—'}
                      <span className="unit">GEN</span>
                    </dd>
                  </div>
                </dl>

                <div className="cs-status">
                  {row ? <StatusChip status={row.st.status} /> : null}
                  {fig && (
                    <span className={`payout-badge ${fig.badge.cls}`}>
                      <span className="pb-dot" aria-hidden="true" />
                      {fig.badge.text}
                    </span>
                  )}
                  {!row && (
                    <span className="tag">{loading ? 'Reading contract…' : 'Network unavailable'}</span>
                  )}
                </div>

                <div className="cs-foot">
                  <Link to={`/agreement/${cfg.address}`}>Open the full agreement →</Link>
                  <a
                    className="mono" href={`${EXPLORER}/address/${cfg.address}`}
                    target="_blank" rel="noopener noreferrer"
                  >
                    {shortAddr(cfg.address ?? undefined)} ↗
                  </a>
                </div>
              </Reveal>
            );
          })}
        </div>
      </Section>

      {/* --------------------------------------------------- 7. how it works */}
      <Section labelledBy="how-h">
        <Reveal>
          <p className="eyebrow">The lifecycle</p>
          <h2 className="headline" id="how-h">
            From promise to <span className="accent-em">payout</span>.
          </h2>
        </Reveal>
        <div className="lifecycle-ed">
          {LIFECYCLE.map((s) => (
            <Reveal key={s.n} className="life-step">
              <span className="life-n" aria-hidden="true">{s.n}</span>
              <div className="life-body">
                <h3>{s.t}</h3>
                <p>{s.d}</p>
                <span className="life-who">{s.who}</span>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal>
          <div className="hero-cta" style={{ marginTop: 44 }}>
            <Link to="/help" className="btn-ghost">Read how it works in detail</Link>
          </div>
        </Reveal>
      </Section>

      {/* ------------------------------------------------------ 8. final CTA */}
      <Section tone="dark" className="final-cta" labelledBy="cta-h" innerClassName="narrow">
        <Reveal>
          <h2 className="display" id="cta-h">
            Service promises should be <span className="accent-em">enforceable</span>.
          </h2>
          <p className="lede">
            Deploy an agreement, fund the escrow, invite the other side. It takes a few
            minutes and costs nothing but testnet gas.
          </p>
          <div className="hero-cta">
            <Link to="/create" className="btn-primary">Create an Agreement</Link>
            <Link to="/help" className="btn-ghost">How it works</Link>
          </div>
        </Reveal>
      </Section>

      {/* ------------------------------------------------------- 9. testnet */}
      <Section tone="beige" className="ed-line">
        <Reveal>
          <div className="notice" role="note" style={{ margin: 0, maxWidth: '72ch' }}>
            <strong>Testnet software.</strong> UptimeBond runs on the GenLayer Bradbury testnet
            with no legal guarantee and no real value at stake. Evidence sources are controlled
            by third parties, validators may disagree or time out, and you must verify every
            address and term before signing. See <Link to="/terms">Terms</Link> and{' '}
            <Link to="/privacy">Privacy</Link>.
          </div>
        </Reveal>
      </Section>
    </>
  );
}
