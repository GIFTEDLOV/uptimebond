/** Privacy-conscious client health + observability.
 *
 * Records structured errors in a small in-memory ring for the diagnostics panel.
 * Never transmits wallet addresses or ships data to a third party by default —
 * an external monitor could be wired in here later, but only without secrets and
 * without exposing wallet data. */

export const BUILD_VERSION: string =
  (import.meta.env?.VITE_BUILD_ID as string | undefined) ?? 'dev';

export type ErrorClass = 'rpc' | 'react-render' | 'evidence' | 'wallet' | 'unknown';

export interface ClientError {
  at: number;
  scope: string;
  class: ErrorClass;
  message: string;
  meta?: Record<string, unknown>;
}

const RING: ClientError[] = [];
const MAX = 50;

function classify(scope: string, message: string): ErrorClass {
  if (scope === 'react-render') return 'react-render';
  if (/rpc|fetch|network|timeout|explorer/i.test(message)) return 'rpc';
  if (/evidence|cors/i.test(message)) return 'evidence';
  if (/wallet|signature|account|chain/i.test(message)) return 'wallet';
  return 'unknown';
}

/** Redact anything address-shaped so wallet data never lands in telemetry. */
function redact(s: string): string {
  return s.replace(/0x[0-9a-fA-F]{40}/g, '0x…redacted');
}

export function logError(scope: string, err: unknown, meta?: Record<string, unknown>): void {
  const message = redact(err instanceof Error ? err.message : String(err));
  const e: ClientError = { at: Date.now(), scope, class: classify(scope, message), message, meta };
  RING.push(e);
  if (RING.length > MAX) RING.shift();
  if (import.meta.env?.DEV) console.warn(`[uptimebond:${scope}]`, message, meta ?? '');
}

export function recentErrors(): ClientError[] {
  return [...RING].reverse();
}

export function clearErrors(): void { RING.length = 0; }
