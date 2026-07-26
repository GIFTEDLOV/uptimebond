import { describe, it, expect, beforeEach } from 'vitest';
import {
  listAgreements, upsertAgreement, getAgreement, removeAgreement,
  setPendingTx, clearPendingTx, addPendingDeploy, readPendingDeploys, removePendingDeploy,
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

describe('pending deploys', () => {
  it('adds, reads, and removes by hash', () => {
    const h = '0x' + 'a'.repeat(64);
    addPendingDeploy({ hash: h, startedAt: 1, args: {} });
    expect(readPendingDeploys().map((d) => d.hash)).toContain(h);
    removePendingDeploy(h);
    expect(readPendingDeploys()).toEqual([]);
  });
  it('dedupes on the same hash', () => {
    const h = '0x' + 'b'.repeat(64);
    addPendingDeploy({ hash: h, startedAt: 1, args: {} });
    addPendingDeploy({ hash: h, startedAt: 2, args: {} });
    expect(readPendingDeploys().length).toBe(1);
  });
});
