import { describe, it, expect, beforeEach } from 'vitest';
import {
  listAgreements, upsertAgreement, getAgreement, removeAgreement,
  setPendingTx, clearPendingTx, addPendingDeploy, readPendingDeploys, removePendingDeploy,
  archivePendingDeploy, readActiveDeploys, readArchivedDeploys, type DeploymentDraft,
} from './registry';

const A = '0x965C9B454867273F612BD48d181Ec418391750d5';
const B = '0xa0c10C656692B4A8E44357d342C38C3DEEE2cFFe';

beforeEach(() => localStorage.clear());

describe('agreement registry', () => {
  it('starts empty', () => {
    expect(listAgreements()).toEqual([]);
  });
  it('upserts and reads back', () => {
    upsertAgreement({ address: A, source: 'created', role: 'customer', serviceLabel: 'Nimbus' });
    const e = getAgreement(A);
    expect(e?.serviceLabel).toBe('Nimbus');
    expect(e?.role).toBe('customer');
  });
  it('merges on repeated upsert without duplicating', () => {
    upsertAgreement({ address: A, source: 'created' });
    upsertAgreement({ address: A, lastStatus: 'ACTIVE' });
    expect(listAgreements().length).toBe(1);
    expect(getAgreement(A)?.lastStatus).toBe('ACTIVE');
  });
  it('is case-insensitive on address', () => {
    upsertAgreement({ address: A, source: 'created' });
    expect(getAgreement(A.toLowerCase())).toBeTruthy();
  });
  it('removes without touching others', () => {
    upsertAgreement({ address: A, source: 'created' });
    upsertAgreement({ address: B, source: 'imported' });
    removeAgreement(A);
    expect(getAgreement(A)).toBeUndefined();
    expect(getAgreement(B)).toBeTruthy();
  });
  it('drops entries with invalid addresses on read', () => {
    localStorage.setItem('uptimebond.registry.v1', JSON.stringify({ version: 1, entries: [{ address: 'nope', source: 'created', role: 'customer', createdAt: 1 }] }));
    expect(listAgreements()).toEqual([]);
  });
  it('resets on a schema-version mismatch', () => {
    localStorage.setItem('uptimebond.registry.v1', JSON.stringify({ version: 99, entries: [{ address: A }] }));
    expect(listAgreements()).toEqual([]);
  });
  it('tracks and clears a pending tx', () => {
    upsertAgreement({ address: A, source: 'created' });
    setPendingTx(A, { hash: '0x' + '1'.repeat(64), method: 'fund', startedAt: 1 });
    expect(getAgreement(A)?.pendingTx?.method).toBe('fund');
    clearPendingTx(A);
    expect(getAgreement(A)?.pendingTx).toBeUndefined();
  });
});

const DRAFT: DeploymentDraft = {
  sender: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  provider: '0x06BBFc5F5A06953fFDB117DB376302d6Bd80eBdc',
  slaTermsUrl: 'https://example.com/sla.json',
  independentMonitorUrl: 'https://example.com/monitor.json',
  providerStatusUrl: 'https://example.com/status.json',
  maintenanceAnnouncementsUrl: 'https://example.com/maint.json',
  deadlockRefundBps: 5000,
  disputeDeadlockSeconds: 86400,
  insufficientEvidenceDeadlockSeconds: 86400,
  escrowAtto: '10000000000000000', // 0.01 GEN
  serviceLabel: 'Nimbus API',
  providerLabel: 'Acme Hosting',
  notes: 'renewal due in March',
  sourceSha256: '93e1ddb9d29c33fba65ac1ba9402d2a11454755faaf373b06e76a8fb906721a3',
  sdkVersion: '1.1.8',
  buildVersion: 'test',
};

describe('pending deploys', () => {
  it('adds, reads, and removes by hash', () => {
    const h = '0x' + 'a'.repeat(64);
    addPendingDeploy({ hash: h, startedAt: 1, draft: DRAFT });
    expect(readPendingDeploys().map((d) => d.hash)).toContain(h);
    removePendingDeploy(h);
    expect(readPendingDeploys()).toEqual([]);
  });

  it('dedupes on the same hash', () => {
    const h = '0x' + 'b'.repeat(64);
    addPendingDeploy({ hash: h, startedAt: 1, draft: DRAFT });
    addPendingDeploy({ hash: h, startedAt: 2, draft: DRAFT });
    expect(readPendingDeploys().length).toBe(1);
  });

  it('preserves the full deployment draft across a reload', () => {
    // The old record kept only raw args plus two labels, so a resumed session
    // verified against the connected wallet and an empty form. Everything
    // needed to verify must survive.
    const h = '0x' + 'c'.repeat(64);
    addPendingDeploy({ hash: h, startedAt: 1, draft: DRAFT });
    const back = readPendingDeploys().find((d) => d.hash === h)!.draft;
    expect(back).toEqual(DRAFT);
    expect(back.escrowAtto).toBe('10000000000000000');
    expect(back.sender).toBe(DRAFT.sender);
    expect(back.provider).toBe(DRAFT.provider);
    expect(back.sourceSha256).toBe(DRAFT.sourceSha256);
    expect(back.sdkVersion).toBe('1.1.8');
  });

  it('keeps 0.01 GEN as 0.01 GEN through a resume — never 0.1', () => {
    const h = '0x' + 'd'.repeat(64);
    addPendingDeploy({ hash: h, startedAt: 1, draft: DRAFT });
    const atto = BigInt(readPendingDeploys()[0].draft.escrowAtto);
    expect(atto).toBe(10_000_000_000_000_000n);
    expect(atto).not.toBe(100_000_000_000_000_000n);
  });

  it('archives a failed deployment without deleting or resuming it', () => {
    const h = '0x' + 'e'.repeat(64);
    addPendingDeploy({ hash: h, startedAt: 1, draft: DRAFT });
    archivePendingDeploy(h, 'contract never materialized');

    // Retained for the audit trail…
    expect(readPendingDeploys().map((d) => d.hash)).toContain(h);
    expect(readArchivedDeploys()[0].archiveReason).toBe('contract never materialized');
    expect(readArchivedDeploys()[0].draft).toEqual(DRAFT);
    // …but never picked up for automatic resume again.
    expect(readActiveDeploys()).toEqual([]);
  });

  it('archiving an unknown hash is a no-op', () => {
    archivePendingDeploy('0x' + 'f'.repeat(64), 'nothing here');
    expect(readPendingDeploys()).toEqual([]);
  });
});

describe('escrow is not smuggled through notes', () => {
  const A = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

  it('stores escrow in its own field and leaves notes alone', () => {
    upsertAgreement({ address: A, escrowAtto: '10000000000000000', notes: 'call Ana before funding' });
    const e = getAgreement(A)!;
    expect(e.escrowAtto).toBe('10000000000000000');
    expect(e.notes).toBe('call Ana before funding');
  });

  it('a numeric-looking note is never read back as an amount', () => {
    // "2026" is a plausible note. Under the old scheme it parsed as 2026 atto.
    upsertAgreement({ address: A, notes: '2026' });
    const e = getAgreement(A)!;
    expect(e.notes).toBe('2026');
    expect(e.escrowAtto).toBeUndefined();
  });

  it('migrates a v1 record that kept the amount in notes', () => {
    localStorage.setItem('uptimebond.registry.v1', JSON.stringify({
      version: 1,
      entries: [{ address: A, source: 'created', role: 'customer', createdAt: 1, notes: '10000000000000000' }],
    }));
    const e = getAgreement(A)!;
    expect(e.escrowAtto).toBe('10000000000000000');
    expect(e.notes).toBeUndefined();
  });

  it('leaves a genuine v1 note as a note during migration', () => {
    localStorage.setItem('uptimebond.registry.v1', JSON.stringify({
      version: 1,
      entries: [{ address: A, source: 'created', role: 'customer', createdAt: 1, notes: 'renewal in March' }],
    }));
    const e = getAgreement(A)!;
    expect(e.notes).toBe('renewal in March');
    expect(e.escrowAtto).toBeUndefined();
  });
});
