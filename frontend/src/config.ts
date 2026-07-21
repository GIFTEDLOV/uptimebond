/** Deployed agreements and network constants. */

export const CHAIN_ID = 4221;
export const CHAIN_ID_HEX = '0x107d';
export const CHAIN_NAME = 'GenLayer Bradbury Testnet';
export const RPC_URL = 'https://rpc-bradbury.genlayer.com';
export const EXPLORER = 'https://explorer-bradbury.genlayer.com';
export const EXPLORER_API = `${EXPLORER}/api/v1`;

export const SOURCE_COMMIT = 'ad0018207edfba936b4074d3f1ccb5a2df58ac3b';
export const REPO = 'https://github.com/GIFTEDLOV/uptimebond';

/**
 * Bradbury serializes transactions per contract and each step waits on the
 * previous one's finality, so a single action can take ~30 minutes to settle.
 * The UI must never imply completion before the receipt says so.
 */
export const TYPICAL_SETTLE_SECONDS = 1900;

export type CaseId =
  | 'case-001-no-breach'
  | 'case-002-partial-refund'
  | 'case-003-full-refund'
  | 'case-004-insufficient-evidence';

export interface AgreementConfig {
  id: CaseId;
  label: string;
  blurb: string;
  address: string | null;
  escrowLabel: string;
  evidenceDir: string;
  expected: {
    outcome: string;
    refundBps: number;
    note: string;
  };
}

/**
 * The case-002 address is the proven live agreement and is the default demo.
 * The others are filled in as their deployments complete; a null address
 * renders as "not yet deployed" rather than breaking the UI.
 */
export const AGREEMENTS: AgreementConfig[] = [
  {
    id: 'case-002-partial-refund',
    label: 'Case 002 — Partial refund',
    blurb:
      'Maintenance window announced 2 hours ahead, against an SLA requiring 24. ' +
      'The window does not qualify for exclusion, so its downtime counts and ' +
      'uptime lands at 99.10%.',
    address: '0x4dc6b188b3025f92F133515c3041cbc4E2019988',
    escrowLabel: '1 GEN',
    evidenceDir: 'evidence/case-002-partial-refund',
    expected: { outcome: 'PARTIAL_REFUND', refundBps: 2500, note: '25% to the customer' },
  },
  {
    id: 'case-001-no-breach',
    label: 'Case 001 — No breach',
    blurb: 'A clean month at 99.92% uptime, comfortably above the 99.5% commitment.',
    address: '0xE64Dcc5E82592c8BBF59003eF6AF772D739dDBAC',
    escrowLabel: '0.1 GEN',
    evidenceDir: 'evidence/case-001-no-breach',
    expected: { outcome: 'NO_BREACH', refundBps: 0, note: 'provider keeps the full escrow' },
  },
  {
    id: 'case-003-full-refund',
    label: 'Case 003 — Full refund',
    blurb: 'A 23-hour unannounced outage drops uptime to 96.80%, below the 98% floor.',
    address: '0x7EA49E783B4839a20c39F77FFe62b3beF10195b7',
    escrowLabel: '0.1 GEN',
    evidenceDir: 'evidence/case-003-full-refund',
    expected: { outcome: 'FULL_REFUND', refundBps: 10000, note: '100% to the customer' },
  },
  {
    id: 'case-004-insufficient-evidence',
    label: 'Case 004 — Insufficient evidence',
    blurb:
      'The monitor covered only 61.62% of the period and the provider claims 100% ' +
      'uptime. The evidence cannot support a financial ruling.',
    address: '0xb0C263bEf959E640060045D47659582D23bb67c0',
    escrowLabel: '0.1 GEN',
    evidenceDir: 'evidence/case-004-insufficient-evidence',
    expected: {
      outcome: 'INSUFFICIENT_EVIDENCE',
      refundBps: 0,
      note: 'no automatic settlement — release() reverts by design',
    },
  },
];

export function evidenceUrls(dir: string) {
  const base = `https://raw.githubusercontent.com/GIFTEDLOV/uptimebond/${SOURCE_COMMIT}/${dir}`;
  return [
    { key: 'SLA terms', role: 'Authoritative clauses', url: `${base}/sla-terms.json` },
    { key: 'Independent monitor', role: 'Primary evidence', url: `${base}/monitor-report.json` },
    { key: 'Provider status', role: 'Corroborating', url: `${base}/provider-status.json` },
    { key: 'Maintenance feed', role: 'Corroborating', url: `${base}/maintenance-announcements.json` },
  ];
}

export const SLA_CLAUSES: Record<string, string> = {
  'SLA-1': 'Uptime commitment — at least 99.50% of the service period',
  'SLA-2': 'Maintenance exclusion — only if announced 24h+ in advance',
  'SLA-3': 'Partial credit — 98.00%–99.49% uptime yields a 25% refund',
  'SLA-4': 'Full credit — below 98.00% uptime yields a 100% refund',
  'SLA-5': 'No credit at or above the 99.50% commitment',
  'SLA-6': 'Evidence hierarchy and insufficiency',
};
