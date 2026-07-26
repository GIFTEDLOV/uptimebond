import { describe, it, expect } from 'vitest';
import {
  isAddress, isTxHash, sameAddress, checkEvidenceUrl, parseEscrowGen,
  checkRefundBps, checkDeadlockSeconds, checkProvider, ZERO_ADDRESS,
} from './validation';

describe('address + hash validation', () => {
  it('accepts a well-formed address', () => {
    expect(isAddress('0x965C9B454867273F612BD48d181Ec418391750d5')).toBe(true);
  });
  it('rejects malformed addresses', () => {
    expect(isAddress('0x123')).toBe(false);
    expect(isAddress('965C9B454867273F612BD48d181Ec418391750d5')).toBe(false);
    expect(isAddress('0xZZZZ9B454867273F612BD48d181Ec418391750d5')).toBe(false);
  });
  it('validates tx hashes', () => {
    expect(isTxHash('0x' + 'a'.repeat(64))).toBe(true);
    expect(isTxHash('0x' + 'a'.repeat(40))).toBe(false);
  });
  it('compares addresses case-insensitively', () => {
    expect(sameAddress('0xABC0000000000000000000000000000000000001', '0xabc0000000000000000000000000000000000001')).toBe(true);
    expect(sameAddress(null, '0x0')).toBe(false);
  });
});

describe('evidence URL checks', () => {
  it('requires https', () => {
    expect(checkEvidenceUrl('http://x.com/a').ok).toBe(false);
    expect(checkEvidenceUrl('https://x.com/a').ok).toBe(true);
  });
  it('rejects non-URLs and empty', () => {
    expect(checkEvidenceUrl('not a url').ok).toBe(false);
    expect(checkEvidenceUrl('').ok).toBe(false);
  });
  it('accepts commit-pinned github raw URLs without warning', () => {
    const r = checkEvidenceUrl('https://raw.githubusercontent.com/o/r/' + 'a'.repeat(40) + '/f.json');
    expect(r.ok).toBe(true);
    expect(r.warn).toBeUndefined();
  });
  it('warns on branch-based github raw URLs', () => {
    const r = checkEvidenceUrl('https://raw.githubusercontent.com/o/r/main/f.json');
    expect(r.ok).toBe(true);
    expect(r.warn).toMatch(/branch or tag/);
  });
  it('warns on github blob (non-raw) URLs', () => {
    expect(checkEvidenceUrl('https://github.com/o/r/blob/main/f.json').warn).toBeTruthy();
  });
});

describe('escrow parsing', () => {
  it('parses whole and fractional GEN into atto', () => {
    expect(parseEscrowGen('0.1').atto).toBe(10n ** 17n);
    expect(parseEscrowGen('1').atto).toBe(10n ** 18n);
    expect(parseEscrowGen('0.025').atto).toBe(25n * 10n ** 15n);
  });
  it('rejects zero, negative, and junk', () => {
    expect(parseEscrowGen('0').ok).toBe(false);
    expect(parseEscrowGen('abc').ok).toBe(false);
    expect(parseEscrowGen('').ok).toBe(false);
  });
  it('caps absurd amounts', () => {
    expect(parseEscrowGen('999999').ok).toBe(false);
  });
});

describe('contract bounds', () => {
  it('bounds refund bps 0..10000', () => {
    expect(checkRefundBps(0).ok).toBe(true);
    expect(checkRefundBps(10000).ok).toBe(true);
    expect(checkRefundBps(10001).ok).toBe(false);
    expect(checkRefundBps(-1).ok).toBe(false);
  });
  it('bounds deadlock seconds 1h..30d', () => {
    expect(checkDeadlockSeconds(3600).ok).toBe(true);
    expect(checkDeadlockSeconds(2592000).ok).toBe(true);
    expect(checkDeadlockSeconds(3599).ok).toBe(false);
    expect(checkDeadlockSeconds(2592001).ok).toBe(false);
  });
});

describe('provider check', () => {
  const CUST = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  it('rejects zero, invalid, and self', () => {
    expect(checkProvider(ZERO_ADDRESS).ok).toBe(false);
    expect(checkProvider('0x123').ok).toBe(false);
    expect(checkProvider(CUST, CUST).ok).toBe(false);
  });
  it('accepts a distinct valid provider', () => {
    expect(checkProvider('0x06BBFc5F5A06953fFDB117DB376302d6Bd80eBdc', CUST).ok).toBe(true);
  });
});
