import { describe, expect, it } from 'vitest';

import { computeDeltas, resolveComparablePair } from './metrics.js';
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

describe('computeDeltas (RPT-01)', () => {
  it('higher-is-better clicks improvement: +20%, improved=true', () => {
    const current = row('2026-06-20', { clicks: 120 });
    const previous = row('2026-06-19', { clicks: 100 });

    const d = computeDeltas(current, previous);

    expect(d.clicks.value).toBe(120);
    expect(d.clicks.previous).toBe(100);
    expect(d.clicks.deltaPct).toBe(20);
    expect(d.clicks.improved).toBe(true);
    expect(d.clicks.isNew).toBe(false);
  });

  it('higher-is-better clicks decline: -20%, improved=false', () => {
    const d = computeDeltas(row('d2', { clicks: 80 }), row('d1', { clicks: 100 }));

    expect(d.clicks.deltaPct).toBe(-20);
    expect(d.clicks.improved).toBe(false);
  });

  it('ctr improvement (fraction): 0.05 vs 0.04 -> +25%, improved=true', () => {
    const d = computeDeltas(row('d2', { ctr: 0.05 }), row('d1', { ctr: 0.04 }));

    expect(d.ctr.deltaPct).toBe(25);
    expect(d.ctr.improved).toBe(true);
  });

  it('impressions improvement: higher is better', () => {
    const d = computeDeltas(row('d2', { impressions: 2200 }), row('d1', { impressions: 2000 }));

    expect(d.impressions.deltaPct).toBe(10);
    expect(d.impressions.improved).toBe(true);
  });

  it('position is INVERTED: 4.2 vs 5.0 -> improved=true (rank got better)', () => {
    const d = computeDeltas(row('d2', { position: 4.2 }), row('d1', { position: 5.0 }));

    expect(d.position.deltaPct).toBe(-16);
    expect(d.position.improved).toBe(true);
  });

  it('position worse: 6.0 vs 5.0 -> +20%, improved=false', () => {
    const d = computeDeltas(row('d2', { position: 6.0 }), row('d1', { position: 5.0 }));

    expect(d.position.deltaPct).toBe(20);
    expect(d.position.improved).toBe(false);
  });

  it('rounds deltaPct to 1 decimal: 103 vs 97 -> 6.2', () => {
    const d = computeDeltas(row('d2', { clicks: 103 }), row('d1', { clicks: 97 }));

    expect(d.clicks.deltaPct).toBe(6.2);
  });

  it('divide-by-zero guard (higher-better): clicks 15 vs 0 -> null, isNew, improved=true', () => {
    const d = computeDeltas(row('d2', { clicks: 15 }), row('d1', { clicks: 0 }));

    expect(d.clicks).toEqual({ value: 15, previous: 0, deltaPct: null, improved: true, isNew: true });
  });

  it('divide-by-zero guard (position): 8 vs 0 -> null, isNew, improved=false, no NaN', () => {
    const d = computeDeltas(row('d2', { position: 8 }), row('d1', { position: 0 }));

    expect(d.position.deltaPct).toBeNull();
    expect(d.position.isNew).toBe(true);
    expect(d.position.improved).toBe(false);
    expect(Number.isNaN(d.position.deltaPct as number)).toBe(false);
  });
});
