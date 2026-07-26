/** Input validation, shared by the create wizard, import, and action guards.
 *  Every check is pure and synchronous; reachability lives in evidence.ts. */

import { BPS_DENOM, DEADLOCK_MIN_SECONDS, DEADLOCK_MAX_SECONDS } from '../config';

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function isAddress(v: string): boolean {
  return ADDRESS_RE.test(v.trim());
}

export function isTxHash(v: string): boolean {
  return TX_HASH_RE.test(v.trim());
}

export function normalizeAddress(v: string): string {
  return v.trim();
}

export function sameAddress(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

export interface UrlCheck { ok: boolean; reason?: string; warn?: string; }

/** Validate an evidence URL: HTTPS-only, syntactically valid, and warn about
 *  mutable GitHub branch URLs (they must be commit-pinned to survive validator
 *  re-fetch after the source is locked at deployment). */
export function checkEvidenceUrl(raw: string): UrlCheck {
  const v = raw.trim();
  if (!v) return { ok: false, reason: 'Required.' };
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { ok: false, reason: 'Not a valid URL.' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'Must use HTTPS.' };
  if (!u.hostname.includes('.')) return { ok: false, reason: 'Host looks invalid.' };

  // Mutable GitHub source detection: raw.githubusercontent.com/<owner>/<repo>/<ref>/...
  // A 40-hex <ref> is a commit; anything else (a branch/tag) can move.
  if (u.hostname === 'raw.githubusercontent.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    const ref = parts[2];
    if (ref && !/^[0-9a-f]{40}$/i.test(ref)) {
      return {
        ok: true,
        warn: `"${ref}" looks like a branch or tag. Pin to a commit hash — a moving source can make validators disagree.`,
      };
    }
  }
  if (/github\.com\/.+\/blob\//.test(v)) {
    return { ok: true, warn: 'This is a GitHub page URL, not raw content. Use the raw, commit-pinned URL.' };
  }
  return { ok: true };
}

export interface EscrowCheck { ok: boolean; reason?: string; atto?: bigint; }

/** Parse a GEN amount (decimal string) into atto (1e18), enforcing positivity
 *  and a sane cap so a fat-finger can't lock huge testnet balances. */
export function parseEscrowGen(raw: string, maxGen = 1000): EscrowCheck {
  const v = raw.trim();
  if (!v) return { ok: false, reason: 'Required.' };
  if (!/^\d+(\.\d{1,18})?$/.test(v)) return { ok: false, reason: 'Enter a number, up to 18 decimals.' };
  const [whole, frac = ''] = v.split('.');
  const atto = BigInt(whole) * 10n ** 18n + BigInt((frac + '0'.repeat(18)).slice(0, 18));
  if (atto <= 0n) return { ok: false, reason: 'Must be greater than zero.' };
  if (atto > BigInt(maxGen) * 10n ** 18n) return { ok: false, reason: `Keep it under ${maxGen} GEN on testnet.` };
  return { ok: true, atto };
}

export function checkRefundBps(bps: number): UrlCheck {
  if (!Number.isInteger(bps)) return { ok: false, reason: 'Whole number of basis points.' };
  if (bps < 0 || bps > BPS_DENOM) return { ok: false, reason: `Between 0 and ${BPS_DENOM} bps (0–100%).` };
  return { ok: true };
}

export function checkDeadlockSeconds(sec: number): UrlCheck {
  if (!Number.isInteger(sec)) return { ok: false, reason: 'Whole number of seconds.' };
  if (sec < DEADLOCK_MIN_SECONDS || sec > DEADLOCK_MAX_SECONDS) {
    return { ok: false, reason: `Between ${DEADLOCK_MIN_SECONDS / 3600}h and ${DEADLOCK_MAX_SECONDS / 86400}d.` };
  }
  return { ok: true };
}

/** A provider address must be a valid, non-zero address that is not the customer. */
export function checkProvider(provider: string, customer?: string | null): UrlCheck {
  if (!isAddress(provider)) return { ok: false, reason: 'Enter a valid 0x address.' };
  if (sameAddress(provider, ZERO_ADDRESS)) return { ok: false, reason: 'Cannot be the zero address.' };
  if (customer && sameAddress(provider, customer)) {
    return { ok: false, reason: 'Provider must differ from the customer wallet.' };
  }
  return { ok: true };
}
