import { describe, expect, it } from 'vitest';

import { fetchDailyMetrics, filterReadableSites } from './gsc.js';
import type { GscQueryFn, RawAnalyticsRow } from './gsc.js';

/**
 * Build a recording mock GscQueryFn that returns programmed rows and captures
 * the params it was called with. No live API is ever touched.
 */
function mockQuery(rows: RawAnalyticsRow[] | null | undefined): {
  fn: GscQueryFn;
  calls: Array<Parameters<GscQueryFn>[0]>;
} {
  const calls: Array<Parameters<GscQueryFn>[0]> = [];
  const fn: GscQueryFn = (params) => {
    calls.push(params);
    return Promise.resolve({ data: { rows: rows ?? null } });
  };
  return { fn, calls };
}

/** UTC day-difference between two 'YYYY-MM-DD' strings. */
function dayDiff(start: string, end: string): number {
  return (Date.parse(end) - Date.parse(start)) / 86_400_000;
}

/**
 * Unit tests for the readable-site filter (GSC-02). These use mock `siteEntry`
 * arrays and make NO live API calls, so they run without GSC credentials.
 */
describe('filterReadableSites', () => {
  it('excludes siteUnverifiedUser and keeps readable properties with siteUrl intact', () => {
    const entries = [
      { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://www.foo.com/', permissionLevel: 'siteFullUser' },
      { siteUrl: 'https://bar.com/', permissionLevel: 'siteRestrictedUser' },
      { siteUrl: 'https://unverified.com/', permissionLevel: 'siteUnverifiedUser' },
    ];

    const result = filterReadableSites(entries);

    // The unverified property is excluded; readable ones keep their canonical siteUrl.
    expect(result).toEqual([
      { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://www.foo.com/', permissionLevel: 'siteFullUser' },
      { siteUrl: 'https://bar.com/', permissionLevel: 'siteRestrictedUser' },
    ]);
    expect(result.some((s) => s.permissionLevel === 'siteUnverifiedUser')).toBe(false);
  });

  it('returns [] for undefined or empty entries without throwing', () => {
    expect(filterReadableSites(undefined)).toEqual([]);
    expect(filterReadableSites([])).toEqual([]);
  });

  it('skips entries missing siteUrl or permissionLevel', () => {
    const entries = [
      { siteUrl: 'sc-domain:ok.com', permissionLevel: 'siteOwner' },
      { permissionLevel: 'siteOwner' },
      { siteUrl: 'https://no-perm.com/' },
    ];

    expect(filterReadableSites(entries)).toEqual([
      { siteUrl: 'sc-domain:ok.com', permissionLevel: 'siteOwner' },
    ]);
  });
});

describe('fetchDailyMetrics (GSC-03)', () => {
  it('default path: queries dimensions:[date], dataState:final, 14-day window', async () => {
    const { fn, calls } = mockQuery([]);

    await fetchDailyMetrics('sc-domain:ariannalupi.com', undefined, fn);

    expect(calls).toHaveLength(1);
    const params = calls[0]!;
    expect(params.siteUrl).toBe('sc-domain:ariannalupi.com');
    expect(params.requestBody.dimensions).toEqual(['date']);
    expect(params.requestBody.dataState).toBe('final');
    expect(params.requestBody.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.requestBody.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dayDiff(params.requestBody.startDate, params.requestBody.endDate)).toBe(14);
  });

  it('custom opts: honors windowDays and dataState', async () => {
    const { fn, calls } = mockQuery([]);

    await fetchDailyMetrics('sc-domain:x.com', { windowDays: 7, dataState: 'all' }, fn);

    const params = calls[0]!;
    expect(params.requestBody.dataState).toBe('all');
    expect(dayDiff(params.requestBody.startDate, params.requestBody.endDate)).toBe(7);
  });

  it('maps rows to DailyMetricRow and sorts ascending by date', async () => {
    const { fn } = mockQuery([
      { keys: ['2026-06-20'], clicks: 100, impressions: 2000, ctr: 0.05, position: 5.0 },
      { keys: ['2026-06-18'], clicks: 80, impressions: 1800, ctr: 0.044, position: 5.4 },
    ]);

    const result = await fetchDailyMetrics('sc-domain:x.com', undefined, fn);

    expect(result).toHaveLength(2);
    expect(result[0]!.date).toBe('2026-06-18');
    expect(result[1]!.date).toBe('2026-06-20');
    expect(result[1]).toEqual({
      date: '2026-06-20',
      clicks: 100,
      impressions: 2000,
      ctr: 0.05,
      position: 5.0,
    });
  });

  it('empty/null rows -> [] without throwing', async () => {
    const empty = mockQuery([]);
    const nul = mockQuery(null);

    await expect(fetchDailyMetrics('sc-domain:x.com', undefined, empty.fn)).resolves.toEqual([]);
    await expect(fetchDailyMetrics('sc-domain:x.com', undefined, nul.fn)).resolves.toEqual([]);
  });

  it('missing numeric fields default to 0 (never NaN/undefined)', async () => {
    const { fn } = mockQuery([{ keys: ['2026-06-19'] }]);

    const result = await fetchDailyMetrics('sc-domain:x.com', undefined, fn);

    expect(result[0]).toEqual({
      date: '2026-06-19',
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0,
    });
  });

  it('skips rows without a date key', async () => {
    const { fn } = mockQuery([{ clicks: 5 }, { keys: ['2026-06-19'], clicks: 9 }]);

    const result = await fetchDailyMetrics('sc-domain:x.com', undefined, fn);

    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe('2026-06-19');
  });
});
