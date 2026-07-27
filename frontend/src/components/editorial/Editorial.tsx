import {
  useEffect, useRef, useState, type ReactNode,
} from 'react';

/** True when the visitor has asked for reduced motion. Read lazily so the
 *  server-less first paint never depends on it. */
function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Fades and rises its children once, when they first scroll into view.
 * Content is present in the DOM and readable from the first paint — the
 * animation only affects opacity and transform, never availability, so
 * screen readers, search engines, and reduced-motion users see everything.
 */
export function Reveal({
  children, delay = 0, as: Tag = 'div', className = '',
}: {
  children: ReactNode;
  /** 1–4, mapped to a staggered transition-delay class. */
  delay?: 0 | 1 | 2 | 3 | 4;
  as?: 'div' | 'section' | 'article' | 'li' | 'header';
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { setShown(true); io.disconnect(); }
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    );
    io.observe(el);
    // Failsafe: content must never be permanently invisible because an
    // observer did not fire (odd viewports, print, headless capture).
    const failsafe = window.setTimeout(() => { setShown(true); io.disconnect(); }, 8000);
    return () => { window.clearTimeout(failsafe); io.disconnect(); };
  }, []);

  const cls = [
    'rise',
    shown ? 'in' : '',
    delay ? `d${delay}` : '',
    className,
  ].filter(Boolean).join(' ');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <Tag ref={ref as any} className={cls}>{children}</Tag>;
}

/**
 * The mark that heads an empty, invalid, or failed state. A quiet ring in the
 * house palette rather than an emoji, so these screens still read as part of
 * the same product. Purely decorative — the heading beneath carries the meaning.
 */
export function EmptyMark() {
  return (
    <svg className="empty-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <circle cx="24" cy="24" r="21" fill="none" stroke="var(--stone)" strokeWidth="1" />
      <circle
        cx="24" cy="24" r="13" fill="none" stroke="var(--stone)" strokeWidth="1"
        strokeDasharray="2 6" strokeLinecap="round"
      />
      <circle cx="24" cy="24" r="2.5" fill="var(--stone)" />
    </svg>
  );
}

/** A full-bleed editorial band with a centred measure inside. */
export function Section({
  children, tone = 'plain', id, labelledBy, className = '', innerClassName = '',
}: {
  children: ReactNode;
  tone?: 'plain' | 'tint' | 'beige' | 'dark';
  id?: string;
  labelledBy?: string;
  className?: string;
  innerClassName?: string;
}) {
  const toneCls = tone === 'tint' ? 'ed-tint'
    : tone === 'beige' ? 'ed-beige'
      : tone === 'dark' ? 'ed-dark on-dark' : '';
  return (
    <section id={id} aria-labelledby={labelledBy} className={`ed ${toneCls} ${className}`.trim()}>
      <div className={`ed-in ${innerClassName}`.trim()}>{children}</div>
    </section>
  );
}

/**
 * Scroll-driven zoom: the composition starts inside a small centred frame —
 * matching the framed panel in the section above — and its clip window opens
 * to the full viewport while the artwork scales up, so the two sections read
 * as one continuous move into the adjudication view.
 *
 * Only `clip-path` and `transform` are driven, both compositor-friendly, and
 * the value is written once per animation frame. Under `prefers-reduced-motion`
 * the stage collapses to a plain stacked section (see styles-editorial.css)
 * and the progress value is pinned at its final state.
 */
export function ZoomStage({
  flag, children, copy,
}: {
  /** Small caption shown while the frame is still contained. */
  flag?: string;
  children: ReactNode;
  copy: ReactNode;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (prefersReducedMotion()) {
      canvas.style.setProperty('--z', '1');
      return;
    }

    let raf = 0;
    const update = () => {
      raf = 0;
      const stage = stageRef.current;
      if (!stage || !canvasRef.current) return;
      const rect = stage.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      // Reach the full-bleed state before the stage unpins, so the immersive
      // view holds for a beat instead of snapping away at the boundary.
      const p = span > 0 ? (-rect.top / span) / 0.78 : 1;
      const z = Math.min(1, Math.max(0, p));
      canvasRef.current.style.setProperty('--z', z.toFixed(4));
    };
    const onScroll = () => { if (!raf) raf = window.requestAnimationFrame(update); };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <div className="zoom-stage" ref={stageRef}>
      <div className="zoom-sticky">
        {flag && <p className="zoom-flag">{flag}</p>}
        <div className="zoom-canvas" ref={canvasRef}>
          <div className="zoom-art">{children}</div>
          <div className="zoom-copy">
            <div className="zoom-copy-in">{copy}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
