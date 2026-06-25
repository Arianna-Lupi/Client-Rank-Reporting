import { describe, expect, it } from 'vitest';

import { resolveComparablePair } from './metrics.js';
import type { DailyMetricRow } from './metrics.js';

/**
 * Offline unit tests for the pure delta core (GSC-04 + RPT-01). No env, no I/O,
 * no current-date access — every case runs from inline fixtures.
 */

/** Build a DailyMetricRow with sensible defaults so cases stay readable. */
function row(date: string, over: Partial<DailyMetricRow> = {}): DailyMetricRow {
  return { date, clicks: 0, impressions: 0, ctr: 0, position: 0, ...over };
}

describe('resolveComparablePair (GSC-04)', () => {
  it('resolves current=last, previous=second-to-last from ascending rows', () => {
    const rows = [
      row('2026-06-16'),
      row('2026-06-17'),
      row('2026-06-18'),
      row('2026-06-19'),
      row('2026-06-20'),
    ];

    const pair = resolveComparablePair(rows);

    expect(pair.status).toBe('ok');
    if (pair.status !== 'ok') throw new Error('expected ok');
    expect(pair.current.date).toBe('2026-06-20');
    expect(pair.previous.date).toBe('2026-06-19');
  });

  it('sorts internally: unsorted input still yields current=max date', () => {
    const rows = [
      row('2026-06-18'),
      row('2026-06-20'),
      row('2026-06-16'),
      row('2026-06-19'),
      row('2026-06-17'),
    ];

    const pair = resolveComparablePair(rows);

    expect(pair.status).toBe('ok');
    if (pair.status !== 'ok') throw new Error('expected ok');
    expect(pair.current.date).toBe('2026-06-20');
    expect(pair.previous.date).toBe('2026-06-19');
  });

  it('does not mutate the caller array', () => {
    const rows = [row('2026-06-20'), row('2026-06-18'), row('2026-06-19')];
    const snapshot = rows.map((r) => r.date);

    resolveComparablePair(rows);

    expect(rows.map((r) => r.date)).toEqual(snapshot);
  });

  it('exactly 2 rows -> ok with later=current, earlier=previous', () => {
    const pair = resolveComparablePair([row('2026-06-18'), row('2026-06-20')]);

    expect(pair.status).toBe('ok');
    if (pair.status !== 'ok') throw new Error('expected ok');
    expect(pair.current.date).toBe('2026-06-20');
    expect(pair.previous.date).toBe('2026-06-18');
  });

  it('exactly 1 row -> insufficient_data with current=that row, previous=null', () => {
    const single = row('2026-06-20');
    const pair = resolveComparablePair([single]);

    expect(pair.status).toBe('insufficient_data');
    if (pair.status !== 'insufficient_data') throw new Error('expected insufficient_data');
    expect(pair.current).not.toBeNull();
    expect(pair.current?.date).toBe('2026-06-20');
    expect(pair.previous).toBeNull();
  });

  it('0 rows -> insufficient_data with current=null, previous=null', () => {
    const pair = resolveComparablePair([]);

    expect(pair.status).toBe('insufficient_data');
    if (pair.status !== 'insufficient_data') throw new Error('expected insufficient_data');
    expect(pair.current).toBeNull();
    expect(pair.previous).toBeNull();
  });
});
