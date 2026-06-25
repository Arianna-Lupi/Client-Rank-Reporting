---
phase: 03-gsc-metrics-delta-computation
plan: 03
subsystem: report-orchestration
tags: [composition, discriminated-union, di, tdd, rpt-04]
requires: [fetchDailyMetrics, resolveComparablePair, computeDeltas, DailyMetricRow, MetricDeltas]
provides:
  - getClientReport
  - ClientReport
  - DailyMetricsFetcher
affects: [Phase 4 cron + Block Kit (consumes getClientReport)]
tech-stack:
  added: []
  patterns: [discriminated-union-return, dependency-injection, total-function]
key-files:
  created: [lib/report.ts, lib/report.test.ts]
  modified: []
decisions:
  - "Catch block returns a fixed generic Spanish message ('No se pudo obtener datos de GSC'); the caught error/stack is never interpolated — the RPT-04 secret-leak guard"
  - "no_data takes precedence: rows.length === 0 short-circuits before resolveComparablePair so the no_data variant carries no date"
  - "fetch param defaults to the production fetchDailyMetrics; importing it is safe because gsc.ts inits googleapis lazily — tests always inject a fake so the default is never called in CI"
metrics:
  duration: 3
  completed: 2026-06-25
---

# Phase 3 Plan 03: getClientReport Summary

Composed the phase into its single user-facing capability: `getClientReport(siteUrl, fetch?)` in `lib/report.ts` (RPT-04). It calls the fetcher, resolves the comparable pair, computes the deltas, and returns a four-variant discriminated union — `ok | insufficient_data | no_data | error` — that never throws on missing/partial data and never leaks a secret in the error case. The fetcher defaults to `fetchDailyMetrics` but is injectable, so every branch is unit-tested offline.

## What Was Built

- `DailyMetricsFetcher` type and `ClientReport` union.
- `getClientReport`: try/catch around `await fetch(siteUrl)` (catch -> generic error message); `rows.length === 0` -> `no_data`; otherwise `resolveComparablePair` -> `ok` (date = current.date, deltas = computeDeltas) or `insufficient_data` (date carried when a single row is present, omitted when null). Total function — only the fetcher's I/O can fail, and that becomes the error variant.

## Tests

6 cases: happy path (ok, date = most recent, deltas deep-equal `computeDeltas(current, previous)`), exactly-1 row -> insufficient_data with date, 0 rows -> no_data with no date field, fetcher throws Error -> resolves (never rejects) to error variant, planted `PRIVATE_KEY=abc123` token never appears in the returned message, non-Error throw still handled. `npm test` 72 passed; `npm run typecheck` clean. Every call injects a fake fetcher — the real default is never exercised in CI.

## TDD Gate Compliance

- Task 1: `0cba6e5` test (RED) -> `dfaaf4f` feat (GREEN happy path).
- Task 2: `3aebb0c` test. Per the plan's Task 1 instruction ("leave the other branches as minimal correct fall-throughs ... do NOT stub them as throwing"), the insufficient_data / no_data / error branches were implemented correctly in the Task 1 GREEN commit; Task 2 added the exhaustive branch tests, which pass against that already-correct implementation. This is by plan design, not an unexpected pass.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Mitigations Applied

- T-03-06 (Information Disclosure): fixed generic message; `not.toContain('PRIVATE_KEY')` and `not.toContain('abc123')` asserted.
- T-03-07 (DoS): total function — the throws-but-resolves test proves no unhandled rejection can crash the Phase 4 cron loop.

## Self-Check: PASSED

- lib/report.ts — FOUND
- lib/report.test.ts — FOUND
- Commits dfaaf4f, 3aebb0c — FOUND
