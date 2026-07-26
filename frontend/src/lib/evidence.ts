/** Provider-neutral evidence helper.
 *
 * Fetches an evidence URL, reports the HTTP result, and produces an
 * *informational* preview. It never executes returned scripts, never renders
 * returned HTML, and never mutates the raw bytes validators will independently
 * re-fetch — the preview is a convenience for the human, nothing more.
 *
 * UptimeBond does not monitor anything itself. The independent monitor URL
 * produces the operational evidence; validators retrieve these sources during
 * adjudication and re-derive the ruling. */

export type EvidenceKind = 'json' | 'text' | 'unknown';

export interface EvidenceResult {
  url: string;
  ok: boolean;
  status?: number;
  statusText?: string;
  kind: EvidenceKind;
  /** Safe, escaped preview text (never HTML). */
  preview?: string;
  /** Normalized uptime fields, when recognizable. Informational only. */
  normalized?: NormalizedUptime;
  error?: string;
}

export interface NormalizedUptime {
  period_start?: string;
  period_end?: string;
  total_checks?: number;
  successful_checks?: number;
  failed_checks?: number;
  downtime_minutes?: number;
  uptime_pct?: number;
  incidents?: number;
  maintenance_windows?: number;
  data_gap?: boolean;
}

const KEY_ALIASES: Record<keyof NormalizedUptime, string[]> = {
  period_start: ['period_start', 'start', 'from', 'window_start'],
  period_end: ['period_end', 'end', 'to', 'window_end'],
  total_checks: ['total_checks', 'checks', 'total', 'samples'],
  successful_checks: ['successful_checks', 'success', 'up_checks', 'passed'],
  failed_checks: ['failed_checks', 'failures', 'down_checks', 'failed'],
  downtime_minutes: ['downtime_minutes', 'downtime_min', 'downtime', 'minutes_down'],
  uptime_pct: ['uptime_pct', 'uptime', 'uptime_percentage', 'availability'],
  incidents: ['incidents', 'incident_count', 'num_incidents'],
  maintenance_windows: ['maintenance_windows', 'maintenance', 'planned_windows'],
  data_gap: ['data_gap', 'gap', 'coverage_incomplete', 'incomplete'],
};

function pick(obj: Record<string, unknown>, aliases: string[]): unknown {
  for (const a of aliases) {
    if (a in obj && obj[a] != null) return obj[a];
  }
  return undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function arrLen(v: unknown): number | undefined {
  return Array.isArray(v) ? v.length : num(v);
}

/** Best-effort normalization of common uptime shapes. Returns undefined when the
 *  document does not look like an uptime report. Never throws. */
export function normalizeUptime(data: unknown): NormalizedUptime | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const o = data as Record<string, unknown>;
  const src = (o.report && typeof o.report === 'object' ? o.report : o) as Record<string, unknown>;
  const n: NormalizedUptime = {
    period_start: pick(src, KEY_ALIASES.period_start) as string | undefined,
    period_end: pick(src, KEY_ALIASES.period_end) as string | undefined,
    total_checks: num(pick(src, KEY_ALIASES.total_checks)),
    successful_checks: num(pick(src, KEY_ALIASES.successful_checks)),
    failed_checks: num(pick(src, KEY_ALIASES.failed_checks)),
    downtime_minutes: num(pick(src, KEY_ALIASES.downtime_minutes)),
    uptime_pct: num(pick(src, KEY_ALIASES.uptime_pct)),
    incidents: arrLen(pick(src, KEY_ALIASES.incidents)),
    maintenance_windows: arrLen(pick(src, KEY_ALIASES.maintenance_windows)),
    data_gap: Boolean(pick(src, KEY_ALIASES.data_gap)),
  };
  const hasAny = Object.values(n).some((v) => v !== undefined && v !== false && v !== '');
  return hasAny ? n : undefined;
}

/** Fetch an evidence source and describe it. Caps body size and never renders
 *  markup. On network failure returns ok:false with a classified error. */
export async function fetchEvidence(rawUrl: string, timeoutMs = 12000): Promise<EvidenceResult> {
  const url = rawUrl.trim();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(t);
    const ct = res.headers.get('content-type') ?? '';
    const raw = await res.text();
    const body = raw.slice(0, 4000); // cap
    let kind: EvidenceKind = 'unknown';
    let normalized: NormalizedUptime | undefined;
    let preview = body;
    if (ct.includes('json') || /^[\s]*[[{]/.test(body)) {
      try {
        const parsed = JSON.parse(raw);
        kind = 'json';
        preview = JSON.stringify(parsed, null, 2).slice(0, 4000);
        normalized = normalizeUptime(parsed);
      } catch {
        kind = 'text';
      }
    } else if (ct.includes('text') || ct.includes('plain')) {
      kind = 'text';
    }
    return {
      url, ok: res.ok, status: res.status, statusText: res.statusText,
      kind, preview, normalized,
      error: res.ok ? undefined : `HTTP ${res.status} ${res.statusText}`,
    };
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : String(e);
    const isAbort = /abort/i.test(msg);
    return {
      url, ok: false, kind: 'unknown',
      error: isAbort ? 'Timed out — the source did not respond in time.'
        : /Failed to fetch|NetworkError|CORS/i.test(msg)
          ? 'Could not reach the source from the browser (network or CORS). Validators fetch server-side, so this may still work at adjudication — but confirm the URL is public.'
          : msg,
    };
  }
}
