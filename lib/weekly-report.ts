/**
 * Weekly per-client report orchestrator of v1.1 (RPT-07, RPT-08, RPT-09).
 *
 * `getWeeklyClientReport(siteUrl, deps?)` is the weekly analogue of report.ts'
 * `getClientReport`: it composes Phase 5's pure weekly core (lib/weekly.ts) with
 * the GSC fetchers (lib/gsc.ts) into a discriminated, total, never-throwing
 * result. It wires fetchDailyMetrics(21-day window) -> resolveWeeklyWindow ->
 * aggregateWeek(current)/aggregateWeek(previous) -> computeWeeklyDeltas for the
 * week-over-week metrics (RPT-07), and fetchPageClicks for the two resolved
 * windows -> rankUrlClickDeltas for the ranked URL list (input for the Phase 6
 * top-3 risers/droppers render, RPT-08/RPT-09).
 *
 * Both fetchers are injectable via `deps`, so every branch is unit-tested offline
 * without network or credentials. The `error` variant is secret-free: it never
 * interpolates the caught error (same guard as report.ts). A failure of the
 * secondary per-URL query degrades the URL list to empty while keeping the
 * already-computed metrics — the whole report does not collapse on a page-
 * dimension fault.
 */
import { fetchDailyMetrics, fetchPageClicks as gscFetchPageClicks } from './gsc.js';
import {
  aggregateWeek,
  computeWeeklyDeltas,
  rankUrlClickDeltas,
  resolveWeeklyWindow,
  sliceWindow,
} from './weekly.js';
import type { DailyMetricRow, MetricDeltas } from './metrics.js';
import type { UrlClickDelta, WeeklyWindow } from './weekly.js';

/** Injectable fetchers (DI for offline tests). Default to the production gsc.ts fns. */
export interface WeeklyReportDeps {
  fetchDaily?: (siteUrl: string) => Promise<DailyMetricRow[]>;
  fetchPageClicks?: (siteUrl: string, startDate: string, endDate: string) => Promise<Map<string, number>>;
}

/** Render-ready weekly result for one property. Total: every input maps to one variant. */
export type WeeklyClientReport =
  | { status: 'ok'; window: WeeklyWindow; deltas: MetricDeltas; urls: UrlClickDelta[] } // urls = FULL ranked list
  | { status: 'insufficient_data' } // fewer than two comparable weeks of data
  | { status: 'no_data' } // zero rows
  | { status: 'error'; message: string }; // fetcher threw; message is secret-free

/**
 * Compose the weekly data layer into a never-throwing report (RPT-07/08/09).
 *
 * The daily fetch is the only hard failure source: any throw becomes a fixed
 * generic Spanish message (never the raw error/stack, so no credential leaks into
 * a Slack post). Missing/partial data maps to no_data / insufficient_data. The
 * per-URL fetch has its own guard so a page-dimension fault degrades to an empty
 * URL list instead of losing the metrics.
 */
export async function getWeeklyClientReport(
  siteUrl: string,
  deps: WeeklyReportDeps = {},
): Promise<WeeklyClientReport> {
  const fetchDaily = deps.fetchDaily ?? ((s: string) => fetchDailyMetrics(s, { windowDays: 21 }));
  const fetchPageClicks = deps.fetchPageClicks ?? gscFetchPageClicks;

  let rows: DailyMetricRow[];
  try {
    rows = await fetchDaily(siteUrl);
  } catch {
    // Secret-leak guard (T-06-01): never interpolate the caught error.
    return { status: 'error', message: 'No se pudo obtener datos de GSC' };
  }

  if (rows.length === 0) {
    return { status: 'no_data' };
  }

  const resolved = resolveWeeklyWindow(rows);
  if (resolved.status === 'insufficient_data') {
    return { status: 'insufficient_data' };
  }

  const { window } = resolved;
  const currentRows = sliceWindow(rows, window.currentStart, window.currentEnd);
  const previousRows = sliceWindow(rows, window.previousStart, window.previousEnd);
  const deltas = computeWeeklyDeltas(aggregateWeek(currentRows), aggregateWeek(previousRows));

  // Per-URL clicks for both windows, guarded on their own (T-06-02): a page-
  // dimension failure degrades to empty maps so the metrics above still ship.
  let currentClicks: Map<string, number>;
  let previousClicks: Map<string, number>;
  try {
    currentClicks = await fetchPageClicks(siteUrl, window.currentStart, window.currentEnd);
    previousClicks = await fetchPageClicks(siteUrl, window.previousStart, window.previousEnd);
  } catch {
    currentClicks = new Map();
    previousClicks = new Map();
  }

  const urls = rankUrlClickDeltas(currentClicks, previousClicks);
  return { status: 'ok', window, deltas, urls };
}
