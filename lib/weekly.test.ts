import { describe, expect, it } from 'vitest';

import {
  aggregateWeek,
  computeWeeklyDeltas,
  rankUrlClickDeltas,
  resolveWeeklyWindow,
  sliceWindow,
} from './weekly.js';
import type { WeeklyAggregate } from './weekly.js';
import { MS_PER_DAY } from './constants.js';
import type { DailyMetricRow } from './metrics.js';

/** Build a DailyMetricRow with sensible defaults so cases stay readable. */
function row(date: string, over: Partial<DailyMetricRow> = {}): DailyMetricRow {
  return { date, clicks: 0, impressions: 0, ctr: 0, position: 0, ...over };
}

/** Build a contiguous run of daily rows from `start` for `count` days. */
function run(start: string, count: number, over: Partial<DailyMetricRow> = {}): DailyMetricRow[] {
  const rows: DailyMetricRow[] = [];
  const base = Date.parse(start);
  for (let i = 0; i < count; i++) {
    const date = new Date(base + i * MS_PER_DAY).toISOString().slice(0, 10);
    rows.push(row(date, over));
  }
  return rows;
}

describe('resolveWeeklyWindow (GSC-05)', () => {
  it('anchors on the max date and produces two contiguous 7-day windows', () => {
    const rows = run('2026-06-07', 14); // 2026-06-07 .. 2026-06-20
    const res = resolveWeeklyWindow(rows);

    expect(res.status).toBe('ok');
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.anchor).toBe('2026-06-20');
    expect(res.window).toEqual({
      currentStart: '2026-06-14',
      currentEnd: '2026-06-20',
      previousStart: '2026-06-07',
      previousEnd: '2026-06-13',
    });
  });

  it('unsorted input yields the same (max) anchor', () => {
    const rows = run('2026-06-07', 14);
    const shuffled = [...rows].reverse();
    const res = resolveWeeklyWindow(shuffled);

    expect(res.status).toBe('ok');
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.anchor).toBe('2026-06-20');
  });

  it('duplicate dates do not inflate distinct-day count', () => {
    // 7 distinct days duplicated == 14 rows but only 7 distinct -> insufficient
    const seven = run('2026-06-14', 7);
    const res = resolveWeeklyWindow([...seven, ...seven]);

    expect(res.status).toBe('insufficient_data');
    if (res.status !== 'insufficient_data') throw new Error('expected insufficient_data');
    expect(res.distinctDays).toBe(7);
  });

  it('exactly 7 distinct days -> insufficient_data', () => {
    const res = resolveWeeklyWindow(run('2026-06-14', 7));

    expect(res.status).toBe('insufficient_data');
    if (res.status !== 'insufficient_data') throw new Error('expected insufficient_data');
    expect(res.distinctDays).toBe(7);
  });

  it('exactly 8 distinct days -> ok with a single-day (partial) previous week', () => {
    const rows = run('2026-06-13', 8); // 2026-06-13 .. 2026-06-20
    const res = resolveWeeklyWindow(rows);

    expect(res.status).toBe('ok');
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.anchor).toBe('2026-06-20');
    // previous week spans 06-07..06-13 but only 06-13 has data -> partial allowed
    expect(res.window.previousStart).toBe('2026-06-07');
    expect(res.window.previousEnd).toBe('2026-06-13');
  });

  it('WR-01: gapped data (full current week + isolated old day, empty previous week) -> insufficient_data', () => {
    // Current week 2026-06-14..2026-06-20 fully populated (7 distinct days)
    // plus one isolated day at 2026-05-31 (anchor-20, older than previousStart
    // 2026-06-07). That is 8 distinct days -> passes the raw distinct-day gate,
    // but the previous window 2026-06-07..2026-06-13 carries zero data.
    const rows = [row('2026-05-31'), ...run('2026-06-14', 7)];
    const res = resolveWeeklyWindow(rows);

    // Must NOT resolve to 'ok' with an all-zero previous aggregate (which would
    // mislabel every metric as isNew:true / deltaPct:null).
    expect(res.status).toBe('insufficient_data');
    if (res.status !== 'insufficient_data') throw new Error('expected insufficient_data');
    expect(res.distinctDays).toBe(8);
  });

  it('WR-02: resolves window boundaries across a month and year boundary', () => {
    // 14 contiguous days 2025-12-23 .. 2026-01-05 -> anchor 2026-01-05.
    // currentStart and previousStart both roll back across the month/year edge.
    const res = resolveWeeklyWindow(run('2025-12-23', 14));

    expect(res.status).toBe('ok');
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.anchor).toBe('2026-01-05');
    expect(res.window).toEqual({
      currentStart: '2025-12-30',
      currentEnd: '2026-01-05',
      previousStart: '2025-12-23',
      previousEnd: '2025-12-29',
    });
  });

  it('honors a custom windowDays parameter', () => {
    const rows = run('2026-06-01', 20);
    const res = resolveWeeklyWindow(rows, 3);

    expect(res.status).toBe('ok');
    if (res.status !== 'ok') throw new Error('expected ok');
    expect(res.anchor).toBe('2026-06-20');
    expect(res.window).toEqual({
      currentStart: '2026-06-18',
      currentEnd: '2026-06-20',
      previousStart: '2026-06-15',
      previousEnd: '2026-06-17',
    });
  });
});

describe('aggregateWeek', () => {
  it('sums clicks/impressions and recomputes CTR = clicks/impressions', () => {
    const agg = aggregateWeek([
      row('2026-06-14', { clicks: 10, impressions: 100 }),
      row('2026-06-15', { clicks: 30, impressions: 300 }),
    ]);

    expect(agg.clicks).toBe(40);
    expect(agg.impressions).toBe(400);
    expect(agg.ctr).toBeCloseTo(40 / 400, 10);
  });

  it('CTR is recomputed, NOT an average of daily CTRs', () => {
    // Daily CTRs are 0.5 and 0.01; simple average = 0.255. Recomputed = 11/1100.
    const agg = aggregateWeek([
      row('2026-06-14', { clicks: 1, impressions: 100, ctr: 0.01 }),
      row('2026-06-15', { clicks: 10, impressions: 1000, ctr: 0.5 }),
    ]);

    expect(agg.ctr).toBeCloseTo(11 / 1100, 10);
    expect(agg.ctr).not.toBeCloseTo(0.255, 5);
  });

  it('position is impression-weighted, not a simple average', () => {
    // simple avg of 2 and 10 = 6; weighted by impressions 900/100 = (2*900+10*100)/1000 = 2.8
    const agg = aggregateWeek([
      row('2026-06-14', { impressions: 900, position: 2 }),
      row('2026-06-15', { impressions: 100, position: 10 }),
    ]);

    expect(agg.position).toBeCloseTo(2.8, 10);
    expect(agg.position).not.toBeCloseTo(6, 5);
  });

  it('divide-by-zero guard: zero impressions -> ctr 0 and position 0, no NaN', () => {
    const agg = aggregateWeek([
      row('2026-06-14', { clicks: 0, impressions: 0, position: 5 }),
    ]);

    expect(agg.ctr).toBe(0);
    expect(agg.position).toBe(0);
    expect(Number.isNaN(agg.ctr)).toBe(false);
    expect(Number.isNaN(agg.position)).toBe(false);
  });

  it('empty rows -> all zeros, no NaN', () => {
    const agg = aggregateWeek([]);

    expect(agg).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
  });
});

describe('sliceWindow', () => {
  it('filters rows to the inclusive [start,end] range', () => {
    const rows = run('2026-06-10', 10);
    const sliced = sliceWindow(rows, '2026-06-14', '2026-06-16');

    expect(sliced.map((r) => r.date)).toEqual(['2026-06-14', '2026-06-15', '2026-06-16']);
  });

  it('allows a partial window (does not require 7 rows)', () => {
    const rows = [row('2026-06-13'), row('2026-06-20')];
    const sliced = sliceWindow(rows, '2026-06-14', '2026-06-20');

    expect(sliced.map((r) => r.date)).toEqual(['2026-06-20']);
  });
});

/** Build a WeeklyAggregate with zeroed defaults. */
function agg(over: Partial<WeeklyAggregate> = {}): WeeklyAggregate {
  return { clicks: 0, impressions: 0, ctr: 0, position: 0, ...over };
}

describe('computeWeeklyDeltas (RPT-05, reuse of metrics core)', () => {
  it('clicks/impressions improvement: higher-is-better, improved=true', () => {
    const d = computeWeeklyDeltas(
      agg({ clicks: 120, impressions: 2200 }),
      agg({ clicks: 100, impressions: 2000 }),
    );

    expect(d.clicks.deltaPct).toBe(20);
    expect(d.clicks.improved).toBe(true);
    expect(d.impressions.deltaPct).toBe(10);
    expect(d.impressions.improved).toBe(true);
  });

  it('weekly CTR delta higher-is-better', () => {
    const d = computeWeeklyDeltas(agg({ ctr: 0.05 }), agg({ ctr: 0.04 }));

    expect(d.ctr.deltaPct).toBe(25);
    expect(d.ctr.improved).toBe(true);
  });

  it('weekly position is INVERTED: lower current -> improved=true', () => {
    const d = computeWeeklyDeltas(agg({ position: 4.2 }), agg({ position: 5.0 }));

    expect(d.position.deltaPct).toBe(-16);
    expect(d.position.improved).toBe(true);
  });

  it('previous week clicks 0 -> deltaPct null + isNew true (÷0 guard inherited)', () => {
    const d = computeWeeklyDeltas(agg({ clicks: 15 }), agg({ clicks: 0 }));

    expect(d.clicks.deltaPct).toBeNull();
    expect(d.clicks.isNew).toBe(true);
    expect(d.clicks.improved).toBe(true);
  });
});

describe('rankUrlClickDeltas (per-URL ranking)', () => {
  it('ranks a riser and a dropper by |delta|', () => {
    const current = new Map([['/a', 100], ['/b', 5]]);
    const previous = new Map([['/a', 40], ['/b', 60]]);

    const ranked = rankUrlClickDeltas(current, previous);

    // /a delta +60, /b delta -55 -> /a first by magnitude
    expect(ranked.map((r) => r.url)).toEqual(['/a', '/b']);
    expect(ranked[0]).toEqual({ url: '/a', current: 100, previous: 40, delta: 60, isNew: false });
    expect(ranked[1]).toEqual({ url: '/b', current: 5, previous: 60, delta: -55, isNew: false });
  });

  it('includes a NEW URL (only in current) as a riser with isNew=true', () => {
    const ranked = rankUrlClickDeltas(new Map([['/new', 30]]), new Map());

    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toEqual({ url: '/new', current: 30, previous: 0, delta: 30, isNew: true });
  });

  it('includes a dropper (only in previous) with a negative delta', () => {
    const ranked = rankUrlClickDeltas(new Map(), new Map([['/gone', 25]]));

    expect(ranked[0]).toEqual({ url: '/gone', current: 0, previous: 25, delta: -25, isNew: false });
  });

  it('breaks |delta| ties deterministically by url ascending', () => {
    const current = new Map([['/z', 10], ['/a', 10]]);
    const previous = new Map([['/z', 0], ['/a', 0]]);

    const ranked = rankUrlClickDeltas(current, previous);

    expect(ranked.map((r) => r.url)).toEqual(['/a', '/z']);
  });

  it('empty maps -> []', () => {
    expect(rankUrlClickDeltas(new Map(), new Map())).toEqual([]);
  });
});
