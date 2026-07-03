---
phase: 05-weekly-window-per-url-metrics
plan: 01
subsystem: weekly-compute
tags: [weekly, aggregation, deltas, per-url, pure-core]
requires: [lib/metrics.ts computeDeltas, lib/metrics.ts DailyMetricRow/MetricDeltas]
provides:
  - lib/weekly.ts (resolveWeeklyWindow, sliceWindow, aggregateWeek, computeWeeklyDeltas, rankUrlClickDeltas)
  - types WeeklyWindow, WeeklyWindowResult, WeeklyAggregate, UrlClickDelta
affects: [Phase 6 weekly report orchestrator / Block Kit rendering]
tech-stack:
  added: []
  patterns: [pure zero-I/O module, injectable-free deterministic compute, reuse of day-vs-day delta core]
key-files:
  created: [lib/weekly.ts, lib/weekly.test.ts]
  modified: []
decisions:
  - "Insufficient-data gate is windowDays+1 distinct days (default 8): one full current week + >=1 previous day"
  - "computeWeeklyDeltas delegates to metrics.ts computeDeltas via synthetic DailyMetricRow (date:''); no delta math duplicated, metrics.ts untouched"
  - "shiftDay uses Date.UTC only; no argument-less Date constructor so the anchor never reads today"
metrics:
  duration: ~10m
  completed: 2026-07-03
requirements: [GSC-05, RPT-05]
---

# Phase 5 Plan 01: Weekly Window + Per-URL Metrics Summary

Pure weekly-compute core `lib/weekly.ts`: anchors a "last 7 days with data vs prior 7" window on the last available GSC day (no today-reference), aggregates by SUM/recomputed-CTR/impression-weighted-position with ÷0 guards, computes WoW per-metric deltas by reusing `metrics.ts` computeDeltas unchanged, and ranks per-URL click deltas (incl. new URLs and droppers) by absolute magnitude for Phase 6.

## What was built

- `resolveWeeklyWindow(rows, windowDays=7)`: distinct-date set, gate `< windowDays+1 → insufficient_data{distinctDays}`, anchor = max date, four boundaries via `shiftDay`. Never references today.
- `sliceWindow(rows, start, end)`: inclusive lexicographic range filter; partial weeks allowed.
- `aggregateWeek(rows)`: Σclicks, Σimpressions, `ctr = clicks/impressions` (recomputed), `position = Σ(pos·impr)/Σimpr` (impression-weighted), ÷0 guards → 0, never NaN.
- `computeWeeklyDeltas(current, previous)`: delegates to `computeDeltas` (inherits inverted position + ÷0 guard) — no math duplicated, metrics.ts byte-identical.
- `rankUrlClickDeltas(current, previous)`: union join, `delta = current - previous`, `isNew = previous===0`, sorted by `|delta|` desc with url-ascending tiebreak; returns full ranked list.

## Verification

- `npx vitest run lib/weekly.test.ts` → 22 passed
- `npm test` → 118 passed (16 files), no regressions
- `npm run typecheck` → clean (strict + noUncheckedIndexedAccess)
- `git diff --exit-code lib/metrics.ts` → no changes
- Greps: `resolveWeeklyWindow|aggregateWeek`=2, `computeWeeklyDeltas|rankUrlClickDeltas`=2, `computeDeltas`=3, `new Date()`=0

## Deviations from Plan

- Task 2's functions (`computeWeeklyDeltas`, `rankUrlClickDeltas`) were implemented in the Task 1 GREEN commit because the shared `lib/weekly.test.ts` imports the full module surface; Task 2's dedicated test cases were then added in a follow-up `test(05-01)` commit. Net gate sequence (test → feat → test) preserved; no behavior change vs plan.

## Self-Check: PASSED
- lib/weekly.ts — FOUND
- lib/weekly.test.ts — FOUND
- Commits d24e340 (test), 0a8a4a3 (feat), 24316ff (test) — all in git log
