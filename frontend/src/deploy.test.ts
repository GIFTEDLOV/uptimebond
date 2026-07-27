import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CalldataAddress } from 'genlayer-js/types';

/**
 * Regression test for the failed browser deployment
 * `0x771ab1009b77fee8ee1d3e0422ec11045000af6f29d3b6b56123da0fe43d76b7`.
 *
 * All eight constructor arguments were submitted with correct values, but
 * `provider` went on the wire as a 42-character `str` instead of a 20-byte
 * `Address`. GenVM handed that str to `__init__(provider: Address, …)`; the
 * equality guards silently passed (a str never equals an Address) and the
 * assignment into the Address-typed storage slot raised a bare TypeError.
 * With no `gl.vm.UserError` there was no error text, so the transaction
 * reached consensus and reported FINISHED_WITH_ERROR with an empty message —
 * the hardest possible failure to diagnose from the explorer alone.
 *
 * `calldata.encode()` dispatches on `instanceof CalldataAddress`, so the
 * assertions below check class identity, not shape. A structural look-alike
 * would encode as a dict and fail exactly the same way.
 */

const deployed = vi.fn().mockResolvedValue('0xdeadbeef');

vi.mock('genlayer-js', () => ({
  chains: { testnetBradbury: { id: 4221 } },
  createClient: () => ({ deployContract: deployed }),
}));

const { deployContract, addressArg } = await import('./chain');

const PROVIDER = '0x79DD8260773C7D5DEA701dfC2D3dD804FF041bf2';
const CUSTOMER = '0x456Ccff0d33463E1834F724C5C5971D6cff6f1dc';
const BASE = 'https://raw.githubusercontent.com/GIFTEDLOV/uptimebond/ad0018207edfba936b4074d3f1ccb5a2df58ac3b/evidence/case-002-partial-refund';

const ARGS = {
  provider: PROVIDER,
  sla_terms_url: `${BASE}/sla-terms.json`,
  independent_monitor_url: `${BASE}/monitor-report.json`,
  provider_status_url: `${BASE}/provider-status.json`,
  maintenance_announcements_url: `${BASE}/maintenance-announcements.json`,
  deadlock_refund_bps: 5000,
  dispute_deadlock_seconds: 86400,
  insufficient_evidence_deadlock_seconds: 86400,
};

const CODE = '# { "Depends": "py-genlayer:x" }\n# UptimeBond — em dash and ’ apostrophe\n';

const submitted = async () => {
  deployed.mockClear();
  await deployContract(CUSTOMER, {}, CODE, ARGS);
  return deployed.mock.calls[0][0] as { code: string; args: unknown[] };
};

describe('deploy calldata encoding', () => {
  beforeEach(() => deployed.mockClear());

  it('encodes provider as an Address, never as a string', async () => {
    const { args } = await submitted();

    // The regression itself: tx 0x771ab100… put str(42) here.
    expect(typeof args[0]).not.toBe('string');
    expect(args[0]).toBeInstanceOf(CalldataAddress);

    const addr = args[0] as CalldataAddress;
    expect(addr.bytes).toHaveLength(20);
    expect(Array.from(addr.bytes).map((b) => b.toString(16).padStart(2, '0')).join(''))
      .toBe(PROVIDER.slice(2).toLowerCase());
  });

  it('submits all eight constructor arguments, in declaration order', async () => {
    const { args } = await submitted();
    expect(args).toHaveLength(8);
    expect(args.slice(1, 5)).toEqual([
      ARGS.sla_terms_url,
      ARGS.independent_monitor_url,
      ARGS.provider_status_url,
      ARGS.maintenance_announcements_url,
    ]);
    expect(args.slice(5)).toEqual([5000, 86400, 86400]);
  });

  it('passes the contract source through byte-identically', async () => {
    const { code } = await submitted();
    // Non-ASCII must survive: the source carries em dashes and typographic
    // apostrophes, and any re-encoding would change the deployed bytes.
    expect(code).toBe(CODE);
    expect(new TextEncoder().encode(code)).toEqual(new TextEncoder().encode(CODE));
  });

  it('refuses to build an Address from anything that is not 20 bytes', () => {
    expect(() => addressArg('0x1234')).toThrow(/Not a 20-byte address/);
    expect(() => addressArg('')).toThrow(/Not a 20-byte address/);
    expect(() => addressArg(`${PROVIDER}00`)).toThrow(/Not a 20-byte address/);
    // A wrong-but-plausible value must fail loudly here rather than 30 minutes
    // later at consensus.
    expect(() => addressArg('not-an-address')).toThrow(/Not a 20-byte address/);
  });

  it('accepts checksummed, lowercase, and unprefixed forms alike', () => {
    const hex = PROVIDER.slice(2).toLowerCase();
    for (const form of [PROVIDER, PROVIDER.toLowerCase(), hex, ` ${PROVIDER} `]) {
      const a = addressArg(form);
      expect(a).toBeInstanceOf(CalldataAddress);
      expect(Array.from(a.bytes).map((b) => b.toString(16).padStart(2, '0')).join('')).toBe(hex);
    }
  });
});
