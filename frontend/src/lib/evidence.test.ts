import { describe, it, expect } from 'vitest';
import { normalizeUptime } from './evidence';

describe('uptime normalization', () => {
  it('reads canonical fields', () => {
    const n = normalizeUptime({
      period_start: '2026-05-01', period_end: '2026-05-31',
      total_checks: 8928, successful_checks: 8850, failed_checks: 78,
      downtime_minutes: 390, uptime_pct: 99.13, incidents: [1, 2], maintenance_windows: [{}],
    });
    expect(n?.uptime_pct).toBe(99.13);
    expect(n?.incidents).toBe(2);
    expect(n?.maintenance_windows).toBe(1);
    expect(n?.total_checks).toBe(8928);
  });
  it('reads aliased fields', () => {
    const n = normalizeUptime({ uptime: '98.5', downtime: 100, checks: 1000, gap: true });
    expect(n?.uptime_pct).toBe(98.5);
    expect(n?.downtime_minutes).toBe(100);
    expect(n?.data_gap).toBe(true);
  });
  it('descends into a nested report object', () => {
    const n = normalizeUptime({ report: { uptime_pct: 100 } });
    expect(n?.uptime_pct).toBe(100);
  });
  it('returns undefined for non-uptime documents', () => {
    expect(normalizeUptime({ hello: 'world' })).toBeUndefined();
    expect(normalizeUptime(null)).toBeUndefined();
    expect(normalizeUptime('a string')).toBeUndefined();
  });
  it('never throws on malformed shapes', () => {
    expect(() => normalizeUptime({ total_checks: {} })).not.toThrow();
  });
});
