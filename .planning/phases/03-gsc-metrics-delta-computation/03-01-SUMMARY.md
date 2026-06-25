---
phase: 03-gsc-metrics-delta-computation
plan: 01
subsystem: metrics-core
tags: [pure-functions, deltas, tdd, gsc-04, rpt-01]
requires: []
provides:
  - DailyMetricRow
  - MetricDelta
  - MetricDeltas
  - ComparablePair
  - resolveComparablePair
  - computeDeltas
affects: [lib/gsc.ts (03-02), lib/report.ts (03-03)]
tech-stack:
  added: []
  patterns: [discriminated-union-return, pure-function, di-ready]
key-files:
  created: [lib/metrics.ts, lib/metrics.test.ts]
  modified: []
decisions:
  - "Lexicographic sort on 'YYYY-MM-DD' strings serves as chronological sort — no Date objects, keeps the function pure"
  - "Divide-by-zero guard returns deltaPct=null + isNew=true (never Infinity/NaN) so the Phase 4 render path can never show a nonsense delta"
  - "improved direction is computed even on the isNew branch so position never legitimately 0 still yields a deterministic boolean"
metrics:
  duration: 4
  completed: 2026-06-25
---

# Phase 3 Plan 01: Pure Delta Core Summary

Pure correctness substrate of Phase 3: a shared per-day metric row type, `resolveComparablePair` (last-available-day resolution, GSC-04) and `computeDeltas` (per-metric signed % deltas with inverted position and a divide-by-zero guard, RPT-01). Zero I/O, zero env, zero current-date access — 15 offline unit tests over inline fixtures.

## What Was Built

- `lib/metrics.ts` — `DailyMetricRow`, `MetricDelta`, `MetricDeltas`, `ComparablePair` types plus `resolveComparablePair` and `computeDeltas`.
- `resolveComparablePair`: shallow-copies and sorts rows ascending, returns the two most recent as `{status:'ok',current,previous}`, or `insufficient_data` for <2 rows (carrying the single row when length===1, else null). Never mutates the caller array; never references today's date.
- `computeDeltas`: per-metric `{value,previous,deltaPct,improved,isNew}`. Higher-is-better for clicks/impressions/ctr, inverted for position. `round1(x)=Math.round(x*10)/10`. `previous===0` -> `deltaPct=null,isNew=true`.

## Tests

15 cases: ascending 5-day, unsorted input (proves internal sort), no-mutation, exactly-2, exactly-1 (insufficient), 0 rows (insufficient), clicks/impressions/ctr improvement + decline, position inversion (better + worse), 1-dp rounding (6.2), and both divide-by-zero branches (higher-better + position). `npm test` 60 passed; `npm run typecheck` clean under noUncheckedIndexedAccess.

## TDD Gate Compliance

RED (test) and GREEN (feat) commits exist for both tasks:
- `b3215dd` test -> `1d7724c` feat (Task 1)
- `f7b69c1` test -> `08c309d` feat (Task 2)

## Deviations from Plan

None — plan executed exactly as written.

## Threat Mitigations Applied

- T-03-01 (DoS): divide-by-zero guard asserted by two tests (no Infinity/NaN).
- T-03-02 (Tampering): operates on a shallow copy; no-mutation test asserts the caller array is untouched.

## Self-Check: PASSED

- lib/metrics.ts — FOUND
- lib/metrics.test.ts — FOUND
- Commits 1d7724c, 08c309d — FOUND
