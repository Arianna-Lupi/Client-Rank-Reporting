# Phase 3: GSC Metrics + Delta Computation - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning
**Mode:** Decisions locked by Claude (delegated by Juan; code-ahead, the correctness core)

<domain>
## Phase Boundary

The correctness core: query GSC Search Analytics for a property, resolve the last day with available data via a trailing window (absorbing GSC's 2-3 day lag), and compute per-metric % deltas vs the previous comparable day, with safe handling of missing/partial/new data. Pure computation + live GSC query — NO Slack/Block Kit/cron (that is Phase 4). Unit tests for the pure delta/date logic; the live `searchanalytics.query` can be validated against the real account (SA is granted on 5 properties).

</domain>

<decisions>
## Implementation Decisions

### Data fetch (GSC-03)
- Extend `lib/gsc.ts` with `fetchDailyMetrics(siteUrl, { windowDays = 14, dataState = 'final' })`:
  - Calls `searchconsole('v1').searchanalytics.query` with `dimensions: ['date']`, `startDate` = today−windowDays, `endDate` = today, `dataState: 'final'` (stable numbers that don't change retroactively — per RESEARCH).
  - Returns the per-date rows `{ date, clicks, impressions, ctr, position }[]` sorted ascending.
- The four metrics: `clicks`, `impressions`, `ctr` (0-1 fraction from API), `position` (average; lower is better).

### Last-available-day resolution (GSC-04)
- Pure function `resolveComparablePair(rows)`: from the date-sorted rows, pick the two most recent dates that have data → `{ current, previous }`. Does NOT assume `today-1`; absorbs the lag. Rows are whatever GSC returned (it omits days with no data under `dataState: 'final'`).
- If fewer than 2 days have data → return `{ status: 'insufficient_data', current?, previous: null }`.

### Delta computation (RPT-01)
- Pure function `computeDeltas(current, previous)` → for each of the 4 metrics: `{ value: current, previous, deltaPct, improved }`.
  - `deltaPct = (current - previous) / previous * 100`, rounded to 1 decimal.
  - **Position is inverted**: `improved = current < previous` for position; `improved = current > previous` for clicks/impressions/ctr. (The arrow/emoji rendering itself is Phase 4 RPT-02; Phase 3 only sets the boolean + signed pct so Phase 4 has unambiguous direction.)
  - Division-by-zero guard: `previous === 0` → `deltaPct = null`, flag `isNew: true` (treat as new/just-started data, not a crash).

### Safe handling (RPT-04)
- A single `getClientReport(siteUrl)` orchestration in `lib/report.ts` (pure-ish, takes an injected fetcher for tests) returns a discriminated result:
  - `{ status: 'ok', date, deltas }` — normal.
  - `{ status: 'insufficient_data', date? }` — <2 days (new property / weekend gap).
  - `{ status: 'no_data' }` — zero rows.
  - Never throws on missing/partial data; upstream auth/network errors propagate as a separate `{ status: 'error', message }` (no secret leakage).

### Testability
- `resolveComparablePair`, `computeDeltas`, and the report assembly are pure and unit-tested with fixtures covering: normal 2+ days, exactly 2 days, 1 day (insufficient), 0 rows (no_data), previous=0 (isNew), position improvement (lower), ctr/clicks improvement (higher).
- `fetchDailyMetrics` isolates the googleapis call so `getClientReport` can be tested with an injected fetcher (no live calls in unit tests). One optional live smoke check against a real property is acceptable but not a unit test.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/gsc.ts` — existing `GoogleAuth` setup + `searchconsole` client (reuse the same auth for `searchanalytics.query`).
- `lib/clients.ts` — `getActiveClients` (Phase 4 will iterate these; Phase 3 just needs per-siteUrl fetch).
- Injectable-dependency test pattern established in Phases 1-2.

### Established Patterns
- Pure functions in `lib/`, dependency injection for I/O, discriminated-union return types over throwing.

### Integration Points
- `lib/report.ts` (new) composes `fetchDailyMetrics` + `resolveComparablePair` + `computeDeltas`. Phase 4's cron/Block Kit consumes `getClientReport`.
</code_context>

<specifics>
## Specific Ideas

- Real properties for an optional live smoke test: `sc-domain:ariannalupi.com`, `sc-domain:aprendoclub.com` (both `siteFullUser`).
- GSC reporting days are Pacific-time; `dataState: 'final'` chosen so numbers are stable across re-runs (RESEARCH Pitfall: fresh vs final).
- CTR comes from the API as a 0-1 fraction; keep it as fraction internally, format as % in Phase 4.
</specifics>

<deferred>
## Deferred Ideas

- Block Kit message rendering, arrow/emoji direction indicators (RPT-02), one-message-per-client → Phase 4.
- Daily cron, idempotency, tz scheduling (SCH-01/02, PER-02) → Phase 4.
- Alternative comparison windows (7d vs 7d, RPT-05), top-movers (RPT-06) → v2.
</deferred>
