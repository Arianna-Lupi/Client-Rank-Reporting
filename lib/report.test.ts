import { describe, expect, it } from 'vitest';

import { computeDeltas } from './metrics.js';
import type { DailyMetricRow } from './metrics.js';
import { getClientReport } from './report.js';
import type { DailyMetricsFetcher } from './report.js';

/**
 * Offline unit tests for getClientReport (RPT-04). Every call injects a fake
 * fetcher, so the real fetchDailyMetrics default is never exercised — no live API.
 */

function row(date: string, over: Partial<DailyMetricRow> = {}): DailyMetricRow {
  return { date, clicks: 0, impressions: 0, ctr: 0, position: 0, ...over };
}

/** A fake fetcher resolving the given rows. */
function fetcherOf(rows: DailyMetricRow[]): DailyMetricsFetcher {
  return () => Promise.resolve(rows);
}

describe('getClientReport — happy path (RPT-04 MVP slice)', () => {
  it('2+ rows -> ok with date=most recent and deltas=computeDeltas(current,previous)', async () => {
    const previous = row('2026-06-18', { clicks: 100 });
    const current = row('2026-06-20', { clicks: 120 });

    const result = await getClientReport('sc-domain:x.com', fetcherOf([previous, current]));

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.date).toBe('2026-06-20');
    expect(result.deltas.clicks.value).toBe(120);
    expect(result.deltas.clicks.deltaPct).toBe(20);
    expect(result.deltas.clicks.improved).toBe(true);
    // Cross-check: deltas deep-equal computeDeltas of the same fixtures.
    expect(result.deltas).toEqual(computeDeltas(current, previous));
  });
});
