import { describe, it, expect } from 'vitest';
import { fmtGen, shortAddr, bpsPct } from '../chain';
import { roleFor } from '../state/hooks';
import type { AgreementState } from '../chain';

describe('formatting', () => {
  it('formats atto into trimmed GEN', () => {
    expect(fmtGen('100000000000000000')).toBe('0.1');
    expect(fmtGen('25000000000000000')).toBe('0.025');
    expect(fmtGen('1000000000000000000')).toBe('1');
    expect(fmtGen(0n)).toBe('0');
  });
  it('shortens addresses and tolerates undefined', () => {
    expect(shortAddr('0x965C9B454867273F612BD48d181Ec418391750d5')).toBe('0x965C…50d5');
    expect(shortAddr(undefined)).toBe('—');
  });
  it('renders bps as a percentage', () => {
    expect(bpsPct(2500)).toBe('25%');
    expect(bpsPct(10000)).toBe('100%');
    expect(bpsPct(0)).toBe('0%');
  });
});

describe('role derivation from live state', () => {
  const st = (over: Partial<AgreementState>) => ({
    customer: '0xAAA0000000000000000000000000000000000001',
    provider: '0xBBB0000000000000000000000000000000000002',
    status: 'ACTIVE', ...over,
  } as AgreementState);
  it('maps the connected wallet to its contract role', () => {
    expect(roleFor('0xAAA0000000000000000000000000000000000001', st({}))).toBe('customer');
    expect(roleFor('0xbbb0000000000000000000000000000000000002', st({}))).toBe('provider');
    expect(roleFor('0xCCC0000000000000000000000000000000000003', st({}))).toBe('observer');
  });
  it('is unknown with no wallet, observer with a wallet but no state', () => {
    expect(roleFor(null, st({}))).toBe('unknown');
    expect(roleFor(null, null)).toBe('unknown');
    expect(roleFor('0xAAA0000000000000000000000000000000000001', null)).toBe('observer');
  });
});
