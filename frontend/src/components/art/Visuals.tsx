/**
 * Abstract product artwork.
 *
 * Every visual is inline SVG built from the page's own palette — no external
 * assets, no network requests, and nothing that the Content-Security-Policy
 * has to make room for. Each is exposed as `role="img"` with a real title and
 * description so the composition is not lost on a screen reader.
 */

/* The four evidence sources, in the order they appear in every composition. */
const SOURCES = [
  { label: 'SLA TERMS', accent: 'a-bronze', dAccent: 'd-accent' },
  { label: 'INDEPENDENT MONITOR', accent: 'a-olive', dAccent: 'd-olive' },
  { label: 'PROVIDER STATUS', accent: 'a-stone', dAccent: 'd-fill-2' },
  { label: 'MAINTENANCE NOTICES', accent: 'a-taupe', dAccent: 'd-fill' },
] as const;

/* ------------------------------------------------------------------ hero */

/**
 * The agreement, whole: customer and provider either side of a held escrow,
 * evidence pinned above it, validators beneath, and a settlement rail that
 * carries the outcome back out to both parties.
 */
export function AgreementVisual() {
  const sheetX = [342, 426, 510, 594];
  const validatorX = [388, 444, 500, 556, 612];
  return (
    <svg
      className="art" viewBox="0 0 1000 560" role="img"
      aria-labelledby="agv-t agv-d" preserveAspectRatio="xMidYMid meet"
    >
      <title id="agv-t">How an UptimeBond agreement is structured</title>
      <desc id="agv-d">
        Four pinned evidence sources feed into an escrow held between a customer and a
        provider. Validators sit below the escrow and read the evidence independently;
        their agreed outcome runs along a settlement rail that pays the refund to the
        customer and the remainder to the provider.
      </desc>

      {/* evidence */}
      <text className="a-cap" x="500" y="16" textAnchor="middle">PINNED EVIDENCE</text>
      {sheetX.map((x, i) => (
        <g key={x}>
          <rect className="a-bone" x={x} y="34" width="64" height="86" rx="5" />
          <rect className={SOURCES[i].accent} x={x + 12} y="48" width="8" height="8" rx="2" />
          <rect className="a-taupe" x={x + 12} y="68" width="40" height="3" rx="1.5" />
          <rect className="a-taupe" x={x + 12} y="78" width="30" height="3" rx="1.5" />
          <rect className="a-taupe" x={x + 12} y="88" width="36" height="3" rx="1.5" />
          <rect className="a-taupe" x={x + 12} y="98" width="22" height="3" rx="1.5" />
          <path className="a-ln-soft" d={`M${x + 32} 120 C ${x + 32} 142, 500 138, 500 158`} />
        </g>
      ))}

      {/* escrow */}
      <circle className="a-bone" cx="500" cy="270" r="104" />
      <circle className="a-beige" cx="500" cy="270" r="72" />
      <path className="a-arc-c" d="M500 166 A 104 104 0 0 1 604 270" />
      <path className="a-arc-p" d="M604 270 A 104 104 0 1 1 500 166" />
      <text className="a-cap" x="500" y="262" textAnchor="middle">ESCROW</text>
      <text
        x="500" y="296" textAnchor="middle" fontSize="21" fontStyle="italic"
        fontFamily="var(--serif)" fill="var(--ink-dim)"
      >
        held in trust
      </text>

      {/* parties */}
      <path className="a-ln" d="M180 262 C 258 230, 330 224, 397 246" />
      <path className="a-ln" d="M820 262 C 742 230, 670 224, 603 246" />
      <circle className="a-stone" cx="397" cy="246" r="3" />
      <circle className="a-stone" cx="603" cy="246" r="3" />

      <circle className="a-bone" cx="132" cy="270" r="48" />
      <circle className="a-bronze" cx="132" cy="270" r="6" />
      <text className="a-cap a-cap-ink" x="132" y="348" textAnchor="middle">CUSTOMER</text>

      <circle className="a-bone" cx="868" cy="270" r="48" />
      <circle className="a-olive" cx="868" cy="270" r="6" />
      <text className="a-cap a-cap-ink" x="868" y="348" textAnchor="middle">PROVIDER</text>

      {/* validators */}
      {validatorX.map((x) => (
        <path key={`f${x}`} className="a-ln-soft" d={`M500 374 C 500 394, ${x} 392, ${x} 406`} />
      ))}
      {validatorX.map((x, i) => (
        <g key={x}>
          <circle className="a-bone" cx={x} cy="414" r="9" />
          <circle className={i === 3 ? 'a-stone' : 'a-olive'} cx={x} cy="414" r="3.5" />
        </g>
      ))}
      <text className="a-cap" x="500" y="452" textAnchor="middle">VALIDATOR CONSENSUS</text>

      {/* settlement */}
      <path className="a-ln-soft" d="M500 423 L500 490" />
      <line className="a-ln" x1="132" y1="490" x2="868" y2="490" />
      <line className="a-ln" x1="132" y1="480" x2="132" y2="500" />
      <line className="a-ln" x1="868" y1="480" x2="868" y2="500" />
      <polygon className="a-bronze" points="348,484 334,490 348,496" />
      <polygon className="a-olive" points="652,484 666,490 652,496" />
      <text className="a-cap" x="132" y="522" textAnchor="middle">REFUND</text>
      <text className="a-cap" x="500" y="522" textAnchor="middle">SETTLEMENT</text>
      <text className="a-cap" x="868" y="522" textAnchor="middle">PAYOUT</text>
    </svg>
  );
}

/* ----------------------------------------------------------------- trust */

/** Two parties, one agreement, and a deliberately empty middle. */
export function TrustVisual() {
  return (
    <svg
      className="art" viewBox="0 0 1000 260" role="img"
      aria-labelledby="tv-t tv-d" preserveAspectRatio="xMidYMid meet"
    >
      <title id="tv-t">Two parties and no intermediary</title>
      <desc id="tv-d">
        A customer on the left and a provider on the right sit at either end of a single
        agreement. The space between them, where a broker or arbitration service would
        normally sit, is drawn as an empty dashed circle marked no intermediary.
      </desc>

      <line className="a-ln-soft" x1="150" y1="96" x2="850" y2="96" />

      <circle className="a-bone" cx="150" cy="96" r="34" />
      <circle className="a-bronze" cx="150" cy="96" r="5" />
      <text className="a-cap a-cap-ink" x="150" y="164" textAnchor="middle">CUSTOMER</text>

      <circle className="a-bone" cx="850" cy="96" r="34" />
      <circle className="a-olive" cx="850" cy="96" r="5" />
      <text className="a-cap a-cap-ink" x="850" y="164" textAnchor="middle">PROVIDER</text>

      <circle className="a-dash" cx="500" cy="96" r="52" fill="none" />
      <line className="a-ln" x1="466" y1="130" x2="534" y2="62" />
      <text className="a-cap" x="500" y="164" textAnchor="middle">NO INTERMEDIARY</text>

      <rect className="a-espresso" x="150" y="206" width="700" height="3" rx="1.5" />
      <circle className="a-espresso" cx="150" cy="207.5" r="4.5" />
      <circle className="a-espresso" cx="850" cy="207.5" r="4.5" />
      <text className="a-cap a-cap-ink" x="500" y="240" textAnchor="middle">ONE AGREEMENT, ON-CHAIN</text>
    </svg>
  );
}

/* -------------------------------------------------------------- evidence */

/**
 * The four pinned sources, contained. This is the composition the section
 * below zooms into, so its arrangement is deliberately repeated there.
 */
export function EvidenceVisual() {
  const pos = [
    { x: 12, y: 10 }, { x: 258, y: 10 },
    { x: 12, y: 166 }, { x: 258, y: 166 },
  ];
  return (
    <svg
      className="art" viewBox="0 0 480 320" role="img"
      aria-labelledby="ev-t ev-d" preserveAspectRatio="xMidYMid meet"
    >
      <title id="ev-t">The four evidence sources fixed at deployment</title>
      <desc id="ev-d">
        Four documents laid out in a grid: the SLA terms, an independent monitor report
        showing an uptime trace with a dip, the provider&apos;s own status page, and a feed
        of maintenance notices.
      </desc>

      {pos.map((p, i) => (
        <g key={SOURCES[i].label}>
          <rect className="a-bone" x={p.x} y={p.y} width="210" height="128" rx="7" />
          <rect className={SOURCES[i].accent} x={p.x + 16} y={p.y + 16} width="8" height="8" rx="2" />
          <text className="a-cap" x={p.x + 32} y={p.y + 24} fontSize="10">{SOURCES[i].label}</text>

          {i === 1 ? (
            <>
              <path
                className="a-arc-p" strokeWidth="2" fill="none"
                d={`M${p.x + 16} ${p.y + 78} L${p.x + 46} ${p.y + 74} L${p.x + 76} ${p.y + 80}
                    L${p.x + 100} ${p.y + 76} L${p.x + 118} ${p.y + 104} L${p.x + 136} ${p.y + 72}
                    L${p.x + 166} ${p.y + 76} L${p.x + 194} ${p.y + 72}`}
              />
              <rect className="a-taupe" x={p.x + 16} y={p.y + 46} width="120" height="3" rx="1.5" />
              <rect className="a-taupe" x={p.x + 16} y={p.y + 114} width="64" height="3" rx="1.5" />
            </>
          ) : i === 2 ? (
            <>
              <rect className="a-taupe" x={p.x + 16} y={p.y + 46} width="150" height="3" rx="1.5" />
              <circle className="a-olive" cx={p.x + 22} cy={p.y + 72} r="5" />
              <rect className="a-taupe" x={p.x + 36} y={p.y + 70} width="90" height="3" rx="1.5" />
              <rect className="a-taupe" x={p.x + 16} y={p.y + 94} width="130" height="3" rx="1.5" />
              <rect className="a-taupe" x={p.x + 16} y={p.y + 108} width="86" height="3" rx="1.5" />
            </>
          ) : i === 3 ? (
            <>
              <rect className="a-taupe" x={p.x + 16} y={p.y + 46} width="140" height="3" rx="1.5" />
              <rect
                className="a-dash" x={p.x + 16} y={p.y + 62} width="106" height="26" rx="4"
                fill="none"
              />
              <rect className="a-taupe" x={p.x + 16} y={p.y + 100} width="118" height="3" rx="1.5" />
              <rect className="a-taupe" x={p.x + 16} y={p.y + 112} width="70" height="3" rx="1.5" />
            </>
          ) : (
            <>
              <rect className="a-taupe" x={p.x + 16} y={p.y + 46} width="170" height="3" rx="1.5" />
              <rect className="a-taupe" x={p.x + 16} y={p.y + 60} width="140" height="3" rx="1.5" />
              <rect className="a-taupe" x={p.x + 16} y={p.y + 74} width="158" height="3" rx="1.5" />
              <rect className="a-taupe" x={p.x + 16} y={p.y + 88} width="120" height="3" rx="1.5" />
              <rect className="a-taupe" x={p.x + 16} y={p.y + 102} width="96" height="3" rx="1.5" />
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

/* ---------------------------------------------------------- adjudication */

/** Vertical placement of the validator lanes, mirrored either side of the cluster. */
const LANE_Y = [150, 286, 422];
/** Where each lane's connector meets the evidence cluster. */
const LANE_JOIN = [250, 330, 396];

/**
 * The same four sources, opened out. As the zoom stage progresses, the
 * validator lanes and then the settlement rail surface around the cluster —
 * the `z-mid` and `z-late` classes read the stage's own progress variable.
 */
export function AdjudicationVisual() {
  const sheets = [
    { x: 420, y: 216 }, { x: 610, y: 216 },
    { x: 420, y: 340 }, { x: 610, y: 340 },
  ];
  const lane = (y: number, side: 'l' | 'r', bend: number) =>
    side === 'l'
      ? `M286 ${y + 44} C 350 ${y + 44}, 366 ${bend}, 418 ${bend}`
      : `M914 ${y + 44} C 850 ${y + 44}, 834 ${bend}, 782 ${bend}`;

  return (
    <svg
      className="art" viewBox="0 0 1200 660" role="img"
      aria-labelledby="adj-t adj-d" preserveAspectRatio="xMidYMid meet"
    >
      <title id="adj-t">Validators adjudicating the pinned evidence</title>
      <desc id="adj-d">
        The four pinned evidence documents sit at the centre. Six validator lanes surround
        them, each retrieving all four sources and deriving its own outcome. Their agreement
        flows down to a settlement rail that splits between a customer refund and a provider
        payout.
      </desc>

      {/* --- the cluster, carried over from the framed panel above ------- */}
      <text className="d-cap" x="600" y="190" textAnchor="middle">PINNED EVIDENCE</text>
      {sheets.map((s, i) => (
        <g key={SOURCES[i].label}>
          <rect className="d-panel" x={s.x} y={s.y} width="170" height="104" rx="7" />
          <rect className={SOURCES[i].dAccent} x={s.x + 14} y={s.y + 14} width="8" height="8" rx="2" />
          <text className="d-cap" x={s.x + 30} y={s.y + 22} fontSize="9.5">{SOURCES[i].label}</text>
          <rect className="d-fill" x={s.x + 14} y={s.y + 44} width="134" height="3" rx="1.5" />
          <rect className="d-fill" x={s.x + 14} y={s.y + 58} width="106" height="3" rx="1.5" />
          <rect className="d-fill" x={s.x + 14} y={s.y + 72} width="122" height="3" rx="1.5" />
          <rect className="d-fill" x={s.x + 14} y={s.y + 86} width="72" height="3" rx="1.5" />
        </g>
      ))}

      {/* --- validators ------------------------------------------------- */}
      <g className="z-mid">
        <text className="d-cap" x="600" y="58" textAnchor="middle">
          EVERY VALIDATOR RETRIEVES EVERY SOURCE, INDEPENDENTLY
        </text>

        {LANE_Y.map((y, i) => (
          <g key={`l${y}`}>
            <path className="d-ln-soft" d={lane(y, 'l', LANE_JOIN[i])} />
            <rect className="d-panel" x="86" y={y} width="200" height="88" rx="9" />
            <text className="d-cap" x="104" y={y + 28} fontSize="10">
              {`VALIDATOR 0${i + 1}`}
            </text>
            {[0, 1, 2, 3].map((k) => (
              <rect
                key={k} className={k === 1 ? 'd-olive' : 'd-fill-2'}
                x={104 + k * 14} y={y + 42} width="8" height="8" rx="2"
              />
            ))}
            <rect className="d-accent" x="104" y={y + 64} width="96" height="3" rx="1.5" />
          </g>
        ))}

        {LANE_Y.map((y, i) => (
          <g key={`r${y}`}>
            <path className="d-ln-soft" d={lane(y, 'r', LANE_JOIN[i])} />
            <rect className="d-panel" x="914" y={y} width="200" height="88" rx="9" />
            <text className="d-cap" x="932" y={y + 28} fontSize="10">
              {`VALIDATOR 0${i + 4}`}
            </text>
            {[0, 1, 2, 3].map((k) => (
              <rect
                key={k} className={k === 1 ? 'd-olive' : 'd-fill-2'}
                x={932 + k * 14} y={y + 42} width="8" height="8" rx="2"
              />
            ))}
            <rect
              className={i === 2 ? 'd-fill-2' : 'd-accent'}
              x="932" y={y + 64} width="96" height="3" rx="1.5"
            />
          </g>
        ))}
      </g>

      {/* --- settlement -------------------------------------------------- */}
      <g className="z-late">
        <path className="d-ln-soft" d="M600 452 L600 596" />
        <line className="d-ln" x1="180" y1="596" x2="1020" y2="596" />
        <line className="d-ln" x1="180" y1="586" x2="180" y2="606" />
        <line className="d-ln" x1="1020" y1="586" x2="1020" y2="606" />
        <circle className="d-accent" cx="600" cy="596" r="6" />
        <polygon className="d-accent" points="404,590 388,596 404,602" />
        <polygon className="d-olive" points="796,590 812,596 796,602" />
        <text className="d-cap" x="270" y="632" textAnchor="middle">CUSTOMER REFUND</text>
        <text className="d-cap" x="600" y="632" textAnchor="middle">CONSENSUS SETTLES THE ESCROW</text>
        <text className="d-cap" x="930" y="632" textAnchor="middle">PROVIDER PAYOUT</text>
      </g>
    </svg>
  );
}
