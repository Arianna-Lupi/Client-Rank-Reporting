import { describe, expect, it, vi } from 'vitest';

import { MS_PER_DAY } from './constants.js';
import type { DailyMetricRow } from './metrics.js';
import {
  aggregateWeek,
  computeWeeklyDeltas,
  rankUrlClickDeltas,
  resolveWeeklyWindow,
  sliceWindow,
} from './weekly.js';
import { getWeeklyClientReport } from './weekly-report.js';
import type { WeeklyReportDeps } from './weekly-report.js';

/**
 * Offline unit tests for getWeeklyClientReport (RPT-07/RPT-08/RPT-09). Every call
 * injects fake fetchers, so the real gsc.ts defaults are never exercised — no live
 * API and no credentials touched. The suite covers every discriminated branch, the
 * secret-free error variant, and the per-URL degradation path.
 */

function row(date: string, over: Partial<DailyMetricRow> = {}): DailyMetricRow {
  return { date, clicks: 0, impressions: 0, ctr: 0, position: 0, ...over };
}

/** Fourteen consecutive UTC days ending 2026-06-20 — two full comparable weeks. */
function twoWeeks(): DailyMetricRow[] {
  const rows: DailyMetricRow[] = [];
  const base = Date.UTC(2026, 5, 7); // 2026-06-07
  for (let i = 0; i < 14; i++) {
    const date = new Date(base + i * MS_PER_DAY).toISOString().slice(0, 10);
    rows.push(row(date, { clicks: 100 + i, impressions: 1000 + i * 10, ctr: 0.1, position: 5 - i * 0.1 }));
  }
  return rows;
}

/** Deps that resolve fixed rows + per-window click maps keyed by the resolved window. */
function depsOf(
  rows: DailyMetricRow[],
  currentClicks: Map<string, number> = new Map(),
  previousClicks: Map<string, number> = new Map(),
): WeeklyReportDeps {
  const resolved = resolveWeeklyWindow(rows);
  return {
    fetchDaily: () => Promise.resolve(rows),
    fetchPageClicks: (_siteUrl, start) => {
      if (resolved.status === 'ok' && start === resolved.window.currentStart) {
        return Promise.resolve(currentClicks);
      }
      return Promise.resolve(previousClicks);
    },
  };
}

describe('getWeeklyClientReport — ok path (RPT-07/RPT-08/RPT-09)', () => {
  it('two full weeks -> ok with window, WoW deltas and ranked URL deltas', async () => {
    const rows = twoWeeks();
    const resolved = resolveWeeklyWindow(rows);
    if (resolved.status !== 'ok') throw new Error('fixture must resolve ok');

    const current = new Map<string, number>([
      ['https://x.com/a', 50],
      ['https://x.com/b', 10],
    ]);
    const previous = new Map<string, number>([
      ['https://x.com/a', 20],
      ['https://x.com/c', 30],
    ]);

    const result = await getWeeklyClientReport('sc-domain:x.com', depsOf(rows, current, previous));

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');

    // window is exactly the resolved WeeklyWindow.
    expect(result.window).toEqual(resolved.window);

    // deltas deep-equal computeWeeklyDeltas of the same fixtures.
    const expectedDeltas = computeWeeklyDeltas(
      aggregateWeek(sliceWindow(rows, resolved.window.currentStart, resolved.window.currentEnd)),
      aggregateWeek(sliceWindow(rows, resolved.window.previousStart, resolved.window.previousEnd)),
    );
    expect(result.deltas).toEqual(expectedDeltas);

    // urls deep-equal rankUrlClickDeltas of the same maps (the FULL ranked list).
    expect(result.urls).toEqual(rankUrlClickDeltas(current, previous));
  });

  it('calls fetchPageClicks with the exact current and previous window dates', async () => {
    const rows = twoWeeks();
    const resolved = resolveWeeklyWindow(rows);
    if (resolved.status !== 'ok') throw new Error('fixture must resolve ok');

    const spy = vi.fn((_siteUrl: string, _start: string, _end: string) =>
      Promise.resolve(new Map<string, number>()),
    );

    await getWeeklyClientReport('sc-domain:x.com', {
      fetchDaily: () => Promise.resolve(rows),
      fetchPageClicks: spy,
    });

    expect(spy).toHaveBeenCalledWith(
      'sc-domain:x.com',
      resolved.window.currentStart,
      resolved.window.currentEnd,
    );
    expect(spy).toHaveBeenCalledWith(
      'sc-domain:x.com',
      resolved.window.previousStart,
      resolved.window.previousEnd,
    );
  });
});

describe('getWeeklyClientReport — safe handling branches', () => {
  it('0 rows -> no_data (no window/deltas/urls fields)', async () => {
    const result = await getWeeklyClientReport('sc-domain:x.com', {
      fetchDaily: () => Promise.resolve([]),
    });

    expect(result).toEqual({ status: 'no_data' });
    expect('window' in result).toBe(false);
    expect('deltas' in result).toBe(false);
    expect('urls' in result).toBe(false);
  });

  it('too few days -> insufficient_data', async () => {
    const rows = [row('2026-06-18', { clicks: 5 }), row('2026-06-19', { clicks: 6 }), row('2026-06-20', { clicks: 7 })];
    const result = await getWeeklyClientReport('sc-domain:x.com', { fetchDaily: () => Promise.resolve(rows) });

    expect(result).toEqual({ status: 'insufficient_data' });
  });

  it('fetchDaily throws Error -> error variant, and the call RESOLVES (never rejects)', async () => {
    const deps: WeeklyReportDeps = { fetchDaily: () => Promise.reject(new Error('boom')) };

    let result;
    try {
      result = await getWeeklyClientReport('sc-domain:x.com', deps);
    } catch {
      throw new Error('getWeeklyClientReport must not reject');
    }

    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('expected error');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('secret safety: a planted token in the thrown error never leaks into message', async () => {
    const deps: WeeklyReportDeps = {
      fetchDaily: () => Promise.reject(new Error('GSC_SA_KEY_B64=SECRET123 leaked into the stack')),
    };

    const result = await getWeeklyClientReport('sc-domain:x.com', deps);

    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('expected error');
    expect(result.message).not.toContain('GSC_SA_KEY_B64');
    expect(result.message).not.toContain('SECRET123');
  });

  it('non-Error throw is still handled -> generic error variant', async () => {
    const deps: WeeklyReportDeps = { fetchDaily: () => Promise.reject('weird') };

    const result = await getWeeklyClientReport('sc-domain:x.com', deps);

    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('expected error');
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe('getWeeklyClientReport — URL degradation (T-06-02)', () => {
  it('fetchPageClicks throws -> report stays ok with empty urls and intact metrics', async () => {
    const rows = twoWeeks();
    const resolved = resolveWeeklyWindow(rows);
    if (resolved.status !== 'ok') throw new Error('fixture must resolve ok');

    const result = await getWeeklyClientReport('sc-domain:x.com', {
      fetchDaily: () => Promise.resolve(rows),
      fetchPageClicks: () => Promise.reject(new Error('page dimension failed')),
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.urls).toEqual([]);

    // Metrics survive the URL failure.
    const expectedDeltas = computeWeeklyDeltas(
      aggregateWeek(sliceWindow(rows, resolved.window.currentStart, resolved.window.currentEnd)),
      aggregateWeek(sliceWindow(rows, resolved.window.previousStart, resolved.window.previousEnd)),
    );
    expect(result.deltas).toEqual(expectedDeltas);
  });

  it('fetchPageClicks resolves empty maps -> ok with empty urls', async () => {
    const rows = twoWeeks();
    const result = await getWeeklyClientReport('sc-domain:x.com', depsOf(rows));

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.urls).toEqual([]);
  });
});
