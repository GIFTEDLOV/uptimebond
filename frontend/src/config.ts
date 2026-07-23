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
  | 'case-001-no-breach-v2'
  | 'case-002-partial-refund'
  | 'case-002-partial-refund-v2'
  | 'case-003-full-refund'
  | 'case-003-full-refund-v2'
  | 'case-004-insufficient-evidence'
  | 'case-004-insufficient-evidence-v2';

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
  /** Present when the agreement was deployed from the broken payout path.
   *
   * These contracts are immutable and `release()` is single-shot, so their
   * escrow can never be distributed. The ruling each one reached is valid and
   * consensus-backed — only the payout is dead. They are kept visible for the
   * audit trail and must not be presented as working demonstrations.
   */
  deprecated?: {
    reason: string;
    strandedLabel: string;
    supersededBy?: CaseId;
  };
}

const BROKEN_PAYOUT_REASON =
  'Deployed before commit 6e29b67. Its settlement paid EOAs through an internal ' +
  'GenVM message, which moves no value, so the escrow can never leave this ' +
  'contract. The ruling is valid; the payout is not.';

/**
 * A null address renders as "not yet deployed" rather than breaking the UI.
 *
 * Every agreement below the v2 entry was deployed from the broken payout path
 * and is marked `deprecated`. The default demo is the first entry, so the
 * working redeployment must stay at the top of this list.
 */
export const AGREEMENTS: AgreementConfig[] = [
  {
    id: 'case-002-partial-refund-v2',
    label: 'Case 002 — Partial refund',
    blurb:
      'Maintenance window announced 2 hours ahead, against an SLA requiring 24. ' +
      'The window does not qualify for exclusion, so its downtime counts and ' +
      'uptime lands at 99.10%.',
    // Fixed payout path, verified end to end on Bradbury: the escrow left the
    // contract at finalization — 0.025 GEN to the customer, 0.075 to the
    // provider, contract balance zero.
    address: '0x965C9B454867273F612BD48d181Ec418391750d5',
    escrowLabel: '0.1 GEN',
    evidenceDir: 'evidence/case-002-partial-refund',
    expected: { outcome: 'PARTIAL_REFUND', refundBps: 2500, note: '25% to the customer' },
  },
  {
    id: 'case-001-no-breach-v2',
    label: 'Case 001 — No breach',
    blurb: 'A clean month at 99.92% uptime, comfortably above the 99.5% commitment.',
    // Fixed payout path, verified: provider received the full 0.1 GEN at
    // finalization, contract balance zero.
    address: '0xa0c10C656692B4A8E44357d342C38C3DEEE2cFFe',
    escrowLabel: '0.1 GEN',
    evidenceDir: 'evidence/case-001-no-breach',
    expected: { outcome: 'NO_BREACH', refundBps: 0, note: 'provider keeps the full escrow' },
  },
  {
    id: 'case-003-full-refund-v2',
    label: 'Case 003 — Full refund',
    blurb: 'A 23-hour unannounced outage drops uptime to 96.80%, below the 98% floor.',
    // Fixed payout path, verified: customer received the full 0.1 GEN at
    // finalization, contract balance zero.
    address: '0xDF1A19ACBE068373f067EF6E226EE564032f4676',
    escrowLabel: '0.1 GEN',
    evidenceDir: 'evidence/case-003-full-refund',
    expected: { outcome: 'FULL_REFUND', refundBps: 10000, note: '100% to the customer' },
  },
  {
    id: 'case-004-insufficient-evidence-v2',
    label: 'Case 004 — Insufficient evidence',
    blurb:
      'The monitor covered only 61.62% of the period and the provider claims 100% ' +
      'uptime. The evidence cannot support a financial ruling.',
    // Fixed payout path, verified: release() reverts and the 0.1 GEN stays
    // custodied — the non-settling outcome moves no value, by design.
    address: '0x44DF768956c15f3B9aFBe82A08dAcB4a9A785F7d',
    escrowLabel: '0.1 GEN',
    evidenceDir: 'evidence/case-004-insufficient-evidence',
    expected: {
      outcome: 'INSUFFICIENT_EVIDENCE',
      refundBps: 0,
      note: 'no automatic settlement — release() reverts by design',
    },
  },
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
    deprecated: {
      reason: BROKEN_PAYOUT_REASON,
      strandedLabel: '1 GEN',
      supersededBy: 'case-002-partial-refund-v2',
    },
  },
  {
    id: 'case-001-no-breach',
    label: 'Case 001 — No breach',
    blurb: 'A clean month at 99.92% uptime, comfortably above the 99.5% commitment.',
    address: '0xE64Dcc5E82592c8BBF59003eF6AF772D739dDBAC',
    escrowLabel: '0.1 GEN',
    evidenceDir: 'evidence/case-001-no-breach',
    expected: { outcome: 'NO_BREACH', refundBps: 0, note: 'provider keeps the full escrow' },
    deprecated: {
      reason:
        'Deployed before commit 6e29b67, on the broken payout path. It never ' +
        'reached settlement, so the escrow is held by an unsettled agreement ' +
        'rather than lost to a failed payout — but releasing it would fail.',
      strandedLabel: '0.1 GEN',
    },
  },
  {
    id: 'case-003-full-refund',
    label: 'Case 003 — Full refund',
    blurb: 'A 23-hour unannounced outage drops uptime to 96.80%, below the 98% floor.',
    address: '0x7EA49E783B4839a20c39F77FFe62b3beF10195b7',
    escrowLabel: '0.1 GEN',
    evidenceDir: 'evidence/case-003-full-refund',
    expected: { outcome: 'FULL_REFUND', refundBps: 10000, note: '100% to the customer' },
    deprecated: { reason: BROKEN_PAYOUT_REASON, strandedLabel: '0.1 GEN' },
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
    deprecated: {
      reason:
        'Deployed before commit 6e29b67, on the broken payout path. ' +
        'INSUFFICIENT_EVIDENCE has no automatic settlement by design, so this ' +
        'case never exercised the payout bug.',
      strandedLabel: '0.1 GEN',
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
