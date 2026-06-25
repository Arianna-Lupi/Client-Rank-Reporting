---
phase: 03-gsc-metrics-delta-computation
plan: 02
subsystem: gsc-fetch
tags: [googleapis, search-analytics, di, tdd, gsc-03]
requires: [DailyMetricRow]
provides:
  - fetchDailyMetrics
  - FetchDailyOptions
  - RawAnalyticsRow
  - GscQueryFn
affects: [lib/report.ts (03-03)]
tech-stack:
  added: []
  patterns: [dependency-injection, reuse-existing-auth]
key-files:
  created: []
  modified: [lib/gsc.ts, lib/gsc.test.ts]
decisions:
  - "The live searchanalytics.query call is a one-line default (defaultQuery) behind an injectable GscQueryFn param, so the suite runs entirely against a recording mock"
  - "UTC window math via Date.now is acceptable: a 14-day window covers GSC's 2-3 day lag and resolveComparablePair picks the two most recent days WITH DATA regardless of the exact edge"
  - "Reused getAuth/getSearchConsole verbatim; filterReadableSites/listReadableSites untouched"
metrics:
  duration: 3
  completed: 2026-06-25
---

# Phase 3 Plan 02: fetchDailyMetrics Summary

Extended `lib/gsc.ts` with `fetchDailyMetrics(siteUrl, opts?, query?)` (GSC-03): builds a trailing date window, calls `searchanalytics.query` with `dimensions:['date']` and `dataState:'final'`, maps each row to the shared `DailyMetricRow` shape and returns them sorted ascending. The googleapis call is isolated behind an injectable `query` parameter so it is unit-tested with a hand-rolled mock — zero live API in CI.

## What Was Built

- `FetchDailyOptions` (windowDays default 14, dataState default 'final'), `RawAnalyticsRow`, `GscQueryFn` types.
- `fetchDailyMetrics`: computes `[today-windowDays, today]` UTC days, queries via the injected (or default) fn, maps rows with null-field coalescing to 0, skips keyless rows, sorts ascending, returns `[]` on null/empty.
- `defaultQuery` — a one-line wrapper over `getSearchConsole().searchanalytics.query`; the existing exports (`getAuth`, `getSearchConsole`, `filterReadableSites`, `listReadableSites`) are unchanged.

## Tests

6 new cases (9 total in gsc.test.ts): default request shape (dimensions:['date'], dataState 'final', 14-day span), custom opts (windowDays 7 + dataState 'all'), row mapping + ascending sort from out-of-order rows, empty + null rows -> [], missing numeric fields default to 0, keyless rows skipped. The existing `filterReadableSites` tests still pass. `grep -Ec 'getSearchConsole|google\.searchconsole' lib/gsc.test.ts` returns 0 (no live client path exercised). `npm test` 66 passed; `npm run typecheck` clean.

## TDD Gate Compliance

RED -> GREEN commits present:
- `203f5ab` test -> `156c64f` feat

## Deviations from Plan

None — plan executed exactly as written.

## Threat Mitigations Applied

- T-03-04 (Tampering): null/undefined fields coalesce to 0, keyless rows skipped — asserted by two tests; no NaN can flow downstream.
- T-03-05 (Information Disclosure): fetchDailyMetrics does not catch; auth/network errors propagate to 03-03 which converts them to a generic status. No secret logged here.

## Self-Check: PASSED

- lib/gsc.ts (modified) — FOUND
- lib/gsc.test.ts (modified) — FOUND
- Commits 203f5ab, 156c64f — FOUND
