import { describe, expect, it } from 'vitest';
import { bpsPct, fmtGen, shortAddr } from './chain';
import { AGREEMENTS, evidenceUrls, SOURCE_COMMIT } from './config';

describe('formatting', () => {
  it('renders whole GEN without a trailing decimal', () => {
    expect(fmtGen('1000000000000000000')).toBe('1');
    expect(fmtGen('100000000000000000')).toBe('0.1');
  });

  it('renders zero escrow', () => {
    expect(fmtGen('0')).toBe('0');
  });

  it('does not lose precision on wei-level amounts', () => {
    // Naive Number() conversion would round this away, which would misreport
    // a settlement by a few wei.
    expect(fmtGen('1000000000000000001')).toBe('1.000000000000000001');
  });

  it('maps basis points to the percentages the SLA uses', () => {
    expect(bpsPct(0)).toBe('0%');
    expect(bpsPct(2500)).toBe('25%');
    expect(bpsPct(10000)).toBe('100%');
    expect(bpsPct(5000)).toBe('50%');
  });

  it('shortens addresses and tolerates undefined', () => {
    expect(shortAddr('0x4dc6b188b3025f92F133515c3041cbc4E2019988')).toBe('0x4dc6…9988');
    expect(shortAddr(undefined)).toBe('—');
  });
});

describe('agreement config', () => {
  it('has a deployed address for every case', () => {
    for (const a of AGREEMENTS) {
      expect(a.address, `${a.id} must have an address`).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });

  it('defaults to the proven case-002 agreement', () => {
    expect(AGREEMENTS[0].id).toBe('case-002-partial-refund');
    expect(AGREEMENTS[0].address).toBe('0x4dc6b188b3025f92F133515c3041cbc4E2019988');
  });

  it('never points at the failed ghost contract', () => {
    const ghost = '0xb82f70950bbefbc6829c463a5922bb1b6333c637';
    for (const a of AGREEMENTS) {
      expect(a.address?.toLowerCase()).not.toBe(ghost);
    }
  });

  it('pins evidence to an immutable commit, never a branch', () => {
    for (const a of AGREEMENTS) {
      for (const e of evidenceUrls(a.evidenceDir)) {
        expect(e.url).toContain(SOURCE_COMMIT);
        expect(e.url).not.toMatch(/\/(main|master|HEAD)\//);
      }
    }
  });

  it('exposes exactly the four evidence sources the contract fetches', () => {
    const urls = evidenceUrls(AGREEMENTS[0].evidenceDir);
    expect(urls).toHaveLength(4);
    expect(urls.map((u) => u.url.split('/').pop())).toEqual([
      'sla-terms.json', 'monitor-report.json',
      'provider-status.json', 'maintenance-announcements.json',
    ]);
  });
});
