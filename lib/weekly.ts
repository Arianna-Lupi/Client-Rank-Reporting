/**
 * Pure weekly-window core of v1.1 (GSC-05 + RPT-05).
 *
 * Resolves a "last 7 days with data vs the prior 7 days" window anchored to the
 * last available GSC day (GSC-05), aggregates each window (SUM of clicks/
 * impressions, CTR recomputed as clicks/impressions, position as an
 * impression-weighted average), and computes week-over-week per-metric deltas by
 * reusing the day-vs-day delta core in `lib/metrics.ts` (RPT-05) — no delta math
 * is duplicated here. It also joins per-URL clicks from both windows into a list
 * ranked by absolute click delta (input for Phase 6's top-3 risers/droppers).
 *
 * Zero I/O, zero env, zero current-date access — the anchor comes ONLY from the
 * rows, which absorbs GSC's 2-3 day lag exactly like `resolveComparablePair`.
 * Exhaustively unit-tested offline so Phase 6 (Block Kit) is thin wiring.
 */
import { computeDeltas } from './metrics.js';
import type { DailyMetricRow, MetricDeltas } from './metrics.js';

/** The four inclusive date boundaries of the two comparable weeks ('YYYY-MM-DD'). */
export interface WeeklyWindow {
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
}

/** Resolved window anchored on the last day with data, or an insufficient-data signal. */
export type WeeklyWindowResult =
  | { status: 'ok'; window: WeeklyWindow; anchor: string }
  | { status: 'insufficient_data'; distinctDays: number };

/** Aggregated metrics over one week. ctr is a 0-1 fraction; position is impression-weighted. */
export interface WeeklyAggregate {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** One URL's week-over-week click movement. delta = current - previous. */
export interface UrlClickDelta {
  url: string;
  current: number;
  previous: number;
  delta: number;
  isNew: boolean;
}

/**
 * Shift a 'YYYY-MM-DD' date by `deltaDays` (may be negative) in UTC.
 *
 * Parses the parts explicitly and uses `Date.UTC`, then reformats — NEVER
 * `new Date()` without arguments, so nothing here reads the current date.
 */
function shiftDay(date: string, deltaDays: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const base = Date.UTC(y!, m! - 1, d!);
  return new Date(base + deltaDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Resolve the two comparable weekly windows anchored on the last day WITH DATA
 * (GSC-05). With fewer than `2 * windowDays` ... note: the gate is the minimum
 * distinct days needed to form two comparable weeks, i.e. `windowDays + 1`
 * (default 8): one full current week plus at least one day of the previous week.
 *
 * anchor = max date present in `rows`. From it:
 *   currentEnd    = anchor
 *   currentStart  = anchor - (windowDays - 1)
 *   previousEnd   = anchor - windowDays
 *   previousStart = anchor - (2 * windowDays - 1)
 *
 * Duplicate dates count once; unsorted input yields the same (max) anchor.
 * A partial previous week is allowed — the boundaries are computed regardless of
 * how many days actually carry data inside them.
 */
export function resolveWeeklyWindow(
  rows: ReadonlyArray<DailyMetricRow>,
  windowDays = 7,
): WeeklyWindowResult {
  const distinct = new Set<string>();
  for (const r of rows) distinct.add(r.date);
  const distinctDays = distinct.size;

  if (distinctDays < windowDays + 1) {
    return { status: 'insufficient_data', distinctDays };
  }

  let anchor = '';
  for (const date of distinct) {
    if (date > anchor) anchor = date;
  }

  const window: WeeklyWindow = {
    currentEnd: anchor,
    currentStart: shiftDay(anchor, -(windowDays - 1)),
    previousEnd: shiftDay(anchor, -windowDays),
    previousStart: shiftDay(anchor, -(2 * windowDays - 1)),
  };

  return { status: 'ok', window, anchor };
}

/**
 * Return only the rows whose date falls in the inclusive [start, end] range.
 * Comparison is lexicographic on 'YYYY-MM-DD' (== chronological). A partial
 * window is fine: this does not require exactly `windowDays` rows.
 */
export function sliceWindow(
  rows: ReadonlyArray<DailyMetricRow>,
  start: string,
  end: string,
): DailyMetricRow[] {
  return rows.filter((r) => r.date >= start && r.date <= end);
}

/**
 * Aggregate one week's daily rows (Phase 5 decision):
 *   clicks/impressions = SUM
 *   ctr      = impressions > 0 ? clicks / impressions : 0   (recomputed, not avg of CTRs)
 *   position = impressions > 0 ? Σ(position·impressions) / impressions : 0  (impression-weighted)
 * Empty rows / zero impressions yield 0 with the ÷0 guards — never NaN.
 */
export function aggregateWeek(rows: ReadonlyArray<DailyMetricRow>): WeeklyAggregate {
  let clicks = 0;
  let impressions = 0;
  let weightedPosition = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    weightedPosition += r.position * r.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? weightedPosition / impressions : 0,
  };
}

/**
 * Week-over-week per-metric deltas (RPT-05).
 *
 * Delegates to `computeDeltas` from metrics.ts by wrapping each aggregate in a
 * synthetic DailyMetricRow (date: ''). This reuse inherits the inverted position
 * direction and the previous===0 ÷0 guard (deltaPct null + isNew true) WITHOUT
 * duplicating any delta math and WITHOUT modifying metrics.ts.
 */
export function computeWeeklyDeltas(
  current: WeeklyAggregate,
  previous: WeeklyAggregate,
): MetricDeltas {
  return computeDeltas({ date: '', ...current }, { date: '', ...previous });
}

/**
 * Join per-URL clicks from both windows and rank by absolute click delta (RPT-05).
 *
 * Unions the URLs of both maps; for each: current (0 if absent), previous (0 if
 * absent), delta = current - previous, isNew = previous === 0. Sorts by |delta|
 * descending with a deterministic url-ascending tiebreak. Includes new URLs
 * (previous 0, risers) and droppers (current 0, negative delta). Returns the FULL
 * ranked list — Phase 6 slices the top 3 risers and top 3 droppers.
 */
export function rankUrlClickDeltas(
  current: ReadonlyMap<string, number>,
  previous: ReadonlyMap<string, number>,
): UrlClickDelta[] {
  const urls = new Set<string>([...current.keys(), ...previous.keys()]);
  const out: UrlClickDelta[] = [];
  for (const url of urls) {
    const cur = current.get(url) ?? 0;
    const prev = previous.get(url) ?? 0;
    out.push({ url, current: cur, previous: prev, delta: cur - prev, isNew: prev === 0 });
  }
  return out.sort((a, b) => {
    const byMagnitude = Math.abs(b.delta) - Math.abs(a.delta);
    if (byMagnitude !== 0) return byMagnitude;
    return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
  });
}
