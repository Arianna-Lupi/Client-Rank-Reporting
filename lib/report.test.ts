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

describe('getClientReport — safe handling branches (RPT-04)', () => {
  it('exactly 1 row -> insufficient_data with the single day date', async () => {
    const result = await getClientReport('sc-domain:x.com', fetcherOf([row('2026-06-20')]));

    expect(result).toEqual({ status: 'insufficient_data', date: '2026-06-20' });
  });

  it('0 rows -> no_data with no date field', async () => {
    const result = await getClientReport('sc-domain:x.com', fetcherOf([]));

    expect(result).toEqual({ status: 'no_data' });
    expect('date' in result).toBe(false);
  });

  it('fetcher throws Error -> error variant, and the call RESOLVES (never rejects)', async () => {
    const throwing: DailyMetricsFetcher = () => Promise.reject(new Error('boom'));

    let result;
    try {
      result = await getClientReport('sc-domain:x.com', throwing);
    } catch {
      throw new Error('getClientReport must not reject');
    }

    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('expected error');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('secret safety: a planted token in the thrown error never leaks into message', async () => {
    const leaky: DailyMetricsFetcher = () =>
      Promise.reject(new Error('PRIVATE_KEY=abc123 leaked into the stack'));

    const result = await getClientReport('sc-domain:x.com', leaky);

    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('expected error');
    expect(result.message).not.toContain('PRIVATE_KEY');
    expect(result.message).not.toContain('abc123');
  });

  it('non-Error throw is still handled -> generic error variant', async () => {
    const weird: DailyMetricsFetcher = () => Promise.reject('weird');

    const result = await getClientReport('sc-domain:x.com', weird);

    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('expected error');
    expect(result.message.length).toBeGreaterThan(0);
  });
});
