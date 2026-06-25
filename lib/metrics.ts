/**
 * Pure delta core (GSC-04 + RPT-01).
 *
 * The highest-value, lowest-tolerance logic of the project: resolve a property's
 * last-available day vs the previous comparable day, and compute per-metric
 * signed % deltas with inverted position direction and a divide-by-zero guard.
 *
 * Zero I/O, zero env, zero current-date access — exhaustively unit-tested so the
 * fetch wrapper (03-02) and the report orchestrator (03-03) are thin wiring.
 *
 * See the <interfaces> block of 03-01-PLAN.md for the locked contract.
 */

/** One GSC Search-Analytics day. ctr is a 0-1 fraction; position is average (lower is better). */
export interface DailyMetricRow {
  date: string; // 'YYYY-MM-DD'
  clicks: number;
  impressions: number;
  ctr: number; // 0-1 fraction, kept as fraction internally
  position: number; // average position; lower is better
}

/** Per-metric delta. deltaPct is null when previous === 0 (then isNew === true). */
export interface MetricDelta {
  value: number; // current value
  previous: number;
  deltaPct: number | null; // (current - previous) / previous * 100, 1 dp; null if previous === 0
  improved: boolean; // direction; inverted for position
  isNew: boolean; // true only when previous === 0
}

export interface MetricDeltas {
  clicks: MetricDelta;
  impressions: MetricDelta;
  ctr: MetricDelta;
  position: MetricDelta;
}

/** Two most recent days with data, or an insufficient-data signal. */
export type ComparablePair =
  | { status: 'ok'; current: DailyMetricRow; previous: DailyMetricRow }
  | { status: 'insufficient_data'; current: DailyMetricRow | null; previous: null };

/**
 * From date-sorted rows pick the two most recent days WITH DATA (GSC-04).
 *
 * Sorts a shallow copy ascending by the 'YYYY-MM-DD' date string (lexicographic
 * order matches chronological order for that format) so the caller's array is
 * never mutated. The last two elements become current/previous. Fewer than two
 * rows yields the insufficient_data variant instead of throwing — this is what
 * absorbs GSC's 2-3 day lag without ever referencing today's date.
 */
export function resolveComparablePair(
  rows: ReadonlyArray<DailyMetricRow>,
): ComparablePair {
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // noUncheckedIndexedAccess: branch on length so the indexed reads are non-null.
  if (sorted.length < 2) {
    return { status: 'insufficient_data', current: sorted[0] ?? null, previous: null };
  }

  const current = sorted[sorted.length - 1]!;
  const previous = sorted[sorted.length - 2]!;
  return { status: 'ok', current, previous };
}

/** Round to 1 decimal place (Math.round handles the .05 / -0 fixture cases). */
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * Build one MetricDelta. `higherIsBetter` is true for clicks/impressions/ctr and
 * false for position (lower rank is better). previousVal === 0 is the
 * divide-by-zero guard: deltaPct null + isNew true instead of Infinity/NaN.
 */
function delta(currentVal: number, previousVal: number, higherIsBetter: boolean): MetricDelta {
  if (previousVal === 0) {
    return {
      value: currentVal,
      previous: previousVal,
      deltaPct: null,
      improved: higherIsBetter ? currentVal > previousVal : currentVal < previousVal,
      isNew: true,
    };
  }
  return {
    value: currentVal,
    previous: previousVal,
    deltaPct: round1(((currentVal - previousVal) / previousVal) * 100),
    improved: higherIsBetter ? currentVal > previousVal : currentVal < previousVal,
    isNew: false,
  };
}

/**
 * Per-metric signed % deltas (RPT-01). clicks/impressions/ctr are higher-is-better;
 * position is INVERTED (improved = current < previous). Pure — sets the boolean +
 * signed pct that Phase 4 (RPT-02) renders; this plan renders nothing.
 */
export function computeDeltas(current: DailyMetricRow, previous: DailyMetricRow): MetricDeltas {
  return {
    clicks: delta(current.clicks, previous.clicks, true),
    impressions: delta(current.impressions, previous.impressions, true),
    ctr: delta(current.ctr, previous.ctr, true),
    position: delta(current.position, previous.position, false),
  };
}
