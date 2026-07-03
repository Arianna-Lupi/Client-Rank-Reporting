# Phase 5: Weekly Window + Per-URL Metrics - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend the existing GSC data layer to a weekly model (GSC-05, GSC-06, RPT-05). Deliver:
- A "last 7 days with data vs prior 7 days" window anchored to the last available GSC day.
- Weekly aggregation of clicks, impressions, CTR, and average position.
- Per-URL clicks via the `page` dimension for each window, ranked by click delta.
- Week-over-week % deltas per metric, reusing the v1.0 delta primitives.

Pure data/computation layer. NO Block Kit rendering (Phase 6) and NO channel routing (Phase 7). The v1.0 day-vs-day core (`lib/metrics.ts`, `lib/report.ts`) stays intact; this phase adds alongside it.

</domain>

<decisions>
## Implementation Decisions

### Weekly Aggregation
- Clicks and impressions aggregate by SUM over the 7 days.
- CTR is RECOMPUTED as clicks_sum / impressions_sum (not an average of daily CTRs), with divide-by-zero guard.
- Average position aggregates as an IMPRESSION-WEIGHTED average (Σ position·impressions / Σ impressions), matching how GSC composes position; guard zero impressions.
- Window size defaults to 7 days but is a configurable parameter.

### Window Resolution / Anchoring
- Anchor on the last day WITH DATA. current window = [anchor-6 … anchor]; previous window = [anchor-13 … anchor-7]. Never reference today's date directly (absorbs GSC's 2-3 day lag, consistent with v1.0 `resolveComparablePair`).
- Trailing fetch window is 21 days (covers 14 days of data + lag margin).
- Partial current week is allowed: sum whatever days exist in each window; do not require exactly 7.
- Insufficient-data threshold: fewer than 8 distinct days with data → `insufficient_data` (cannot form two comparable weeks).

### Per-URL Clicks (page dimension)
- One query per window with `dimensions: ['page']`, dataState `final`.
- rowLimit 250 per window, ranked/joined by URL.
- Ranking metric is the ABSOLUTE click delta per URL (current − previous), for both risers and droppers.
- New URLs (0 previous clicks) are included and count as risers by their absolute delta.

### Code Structure
- New module `lib/weekly.ts` for the weekly window + aggregation + weekly-delta logic; reuses primitives from `lib/metrics.ts` and `lib/gsc.ts`.
- Do NOT modify the v1.0 day-vs-day core; add alongside so existing tests stay green.
- Weekly per-metric deltas reuse the existing `MetricDelta` shape (value/previous/deltaPct/improved/isNew).
- Per-URL query is a new injectable function in `lib/gsc.ts`: `fetchPageClicks(siteUrl, startDate, endDate, query?)`, DI-shaped like `fetchDailyMetrics` for offline unit tests.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/gsc.ts`: `fetchDailyMetrics`, `GscQueryFn` (injectable query DI), `isoDay`, lazy `getSearchConsole`, `defaultQuery`. Add `fetchPageClicks` following the same DI + null-coalescing pattern.
- `lib/metrics.ts`: `DailyMetricRow`, `MetricDelta`, `round1`, the `delta()` builder (higherIsBetter flag, previous===0 → deltaPct null + isNew). Reuse the delta math for weekly aggregates.
- `lib/report.ts`: discriminated `ClientReport` result pattern (`ok`/`insufficient_data`/`no_data`/`error`, never throws) — mirror this for the weekly report result in Phase 6.

### Established Patterns
- Pure logic modules are zero-I/O, zero-env, exhaustively unit tested; network isolated behind an injectable query fn so the suite runs offline.
- Date strings are 'YYYY-MM-DD'; lexicographic sort == chronological.
- Spanish, secret-free error messages; never interpolate caught errors into results.

### Integration Points
- Phase 6 will call the weekly report orchestrator (built on `lib/weekly.ts`) per client to render Block Kit.
- `fetchPageClicks` uses the same `getSearchConsole()` client and `GSC_SA_KEY_B64` auth as the daily fetch.

</code_context>

<specifics>
## Specific Ideas

- "tráfico" in Arianna's request = impressions; clicks are reported separately. Both aggregate weekly by SUM.
- Top 3 risers / top 3 droppers by click delta are consumed by Phase 6; this phase must expose the ranked per-URL deltas (more than 3, e.g. full ranked list) so Phase 6 slices the top 3.

</specifics>

<deferred>
## Deferred Ideas

- Cross-client "top movers" summary (RPT-06) — deferred to v2.
- Alternative calendar-week (Mon–Sun) window — not chosen; anchored-to-last-day model used instead.

</deferred>
