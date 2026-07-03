---
phase: 06-weekly-client-report-block-kit
plan: 01
subsystem: weekly-report
tags: [orchestrator, gsc, weekly, di, offline-tests]
requires: [lib/weekly.ts, lib/gsc.ts, lib/metrics.ts]
provides: [getWeeklyClientReport, WeeklyClientReport, WeeklyReportDeps]
affects: [lib/weekly-report.ts, lib/weekly-report.test.ts]
tech-stack:
  added: []
  patterns: [discriminated-union, dependency-injection, secret-free-error, graceful-degradation]
key-files:
  created: [lib/weekly-report.ts, lib/weekly-report.test.ts]
  modified: []
decisions:
  - "Per-URL fetch guarded independently so a page-dimension failure degrades to empty urls without losing metrics (T-06-02)"
  - "error variant returns a fixed Spanish message, never the caught error (T-06-01, mirrors report.ts)"
requirements: [RPT-07, RPT-08, RPT-09]
metrics:
  duration_min: 8
  completed: 2026-07-03
---

# Phase 6 Plan 01: Weekly Report Orchestrator Summary

`getWeeklyClientReport(siteUrl, deps?)` composes Phase 5's pure weekly core with the GSC fetchers into a total, never-throwing `WeeklyClientReport` (ok / insufficient_data / no_data / error), wiring 21-day daily metrics into WoW deltas and two windows of per-URL clicks into a ranked delta list.

## What was built

- `lib/weekly-report.ts`: the weekly analogue of `report.ts`. Resolves injectable `fetchDaily` (default `fetchDailyMetrics(s, { windowDays: 21 })`) and `fetchPageClicks` (default gsc.ts). Flow: fetchDaily → `resolveWeeklyWindow` → `sliceWindow` ×2 → `aggregateWeek` ×2 → `computeWeeklyDeltas`, plus `fetchPageClicks` ×2 (exact resolved window dates) → `rankUrlClickDeltas`.
- Discriminated union `WeeklyClientReport`; the `ok` variant carries `window`, `deltas`, and the FULL ranked `urls` list (Phase 6 render slices top 3).
- `lib/weekly-report.test.ts`: 9 offline tests, all deps injected — the real gsc.ts defaults are never exercised.

## Verification

- `npx vitest run lib/weekly-report.test.ts` → 9 passed.
- `npm run typecheck` → clean under strict + noUncheckedIndexedAccess; no `any` type.
- Branch coverage: ok (deep-equal deltas + urls), no_data, insufficient_data, error, secret-safety (planted token absent from message), non-Error throw, URL degradation (throw and empty maps), and a spy asserting fetchPageClicks got the exact current/previous window dates.

## Deviations from Plan

None. Plan executed as written.

## Self-Check: PASSED

- lib/weekly-report.ts FOUND
- lib/weekly-report.test.ts FOUND
- Commit ced7a1d (test) and 46f13a9 (feat) present in history
