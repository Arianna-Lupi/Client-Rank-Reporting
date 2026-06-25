/**
 * Single user-facing capability of Phase 3 (RPT-04).
 *
 * `getClientReport(siteUrl, fetch?)` composes fetch -> resolve -> compute into a
 * discriminated, never-throwing result. The fetcher defaults to the production
 * `fetchDailyMetrics` but is injectable, so every branch is unit-tested offline.
 * Phase 4's cron calls this once per active client to get a render-ready report.
 *
 * See the <interfaces> block of 03-03-PLAN.md for the locked contract.
 */
import { fetchDailyMetrics } from './gsc.js';
import { computeDeltas, resolveComparablePair } from './metrics.js';
import type { DailyMetricRow, MetricDeltas } from './metrics.js';

/** A fetcher of per-date rows for a property. Injectable for tests; defaults to fetchDailyMetrics. */
export type DailyMetricsFetcher = (siteUrl: string) => Promise<DailyMetricRow[]>;

/** Render-ready result for one property. Total: every input maps to exactly one variant. */
export type ClientReport =
  | { status: 'ok'; date: string; deltas: MetricDeltas } // date = the last available day
  | { status: 'insufficient_data'; date?: string } // <2 days; date = the single day if present
  | { status: 'no_data' } // zero rows
  | { status: 'error'; message: string }; // fetcher threw; message is secret-free

/**
 * Compose fetch -> resolve -> compute into a never-throwing report (RPT-04).
 *
 * The fetcher's I/O is the only failure source: any throw becomes a fixed
 * generic Spanish error message (never the raw error/stack, so no credential
 * leaks into a Slack post). Missing/partial data maps to no_data /
 * insufficient_data — the function is total and never rejects on data shape.
 */
export async function getClientReport(
  siteUrl: string,
  fetch: DailyMetricsFetcher = fetchDailyMetrics,
): Promise<ClientReport> {
  let rows: DailyMetricRow[];
  try {
    rows = await fetch(siteUrl);
  } catch {
    // Secret-leak guard (RPT-04 / V7): never interpolate the caught error.
    return { status: 'error', message: 'No se pudo obtener datos de GSC' };
  }

  if (rows.length === 0) {
    return { status: 'no_data' };
  }

  const pair = resolveComparablePair(rows);
  if (pair.status === 'ok') {
    return { status: 'ok', date: pair.current.date, deltas: computeDeltas(pair.current, pair.previous) };
  }

  // insufficient_data: carry the single day's date when present, omit otherwise.
  return pair.current === null
    ? { status: 'insufficient_data' }
    : { status: 'insufficient_data', date: pair.current.date };
}
