---
phase: 05-weekly-window-per-url-metrics
plan: 02
subsystem: gsc-data-layer
tags: [gsc, per-url, page-dimension, injectable, offline-tests]
requires: [lib/gsc.ts getSearchConsole, GscQueryFn, defaultQuery]
provides:
  - lib/gsc.ts fetchPageClicks(siteUrl, startDate, endDate, query?)
  - GscQueryFn requestBody extended with optional rowLimit
affects: [lib/weekly.ts rankUrlClickDeltas join, Phase 6 top-3 risers/droppers]
tech-stack:
  added: []
  patterns: [dependency-injected query fn, null-coalescing row mapping, non-breaking type extension]
key-files:
  created: []
  modified: [lib/gsc.ts, lib/gsc.test.ts]
decisions:
  - "GscQueryFn.requestBody.rowLimit made optional -> non-breaking; fetchDailyMetrics never sets it"
  - "fetchPageClicks returns Map<string,number>; repeated URL rows summed defensively"
metrics:
  duration: ~5m
  completed: 2026-07-03
requirements: [GSC-06]
---

# Phase 5 Plan 02: fetchPageClicks (Per-URL Query) Summary

Extended `lib/gsc.ts` with `fetchPageClicks(siteUrl, startDate, endDate, query?)` (GSC-06): a Search Analytics query with `dimensions:['page']`, `dataState:'final'`, `rowLimit:250` over an already-resolved window, returning a `URL → clicks` Map. Same DI + null-coalescing pattern as `fetchDailyMetrics`; runs fully offline via a mock `GscQueryFn`. `fetchDailyMetrics` and its suite are untouched.

## What was built

- `GscQueryFn.requestBody` gains optional `rowLimit?: number` (non-breaking).
- `fetchPageClicks`: calls query once with exact site + window dates; maps `keys[0] → clicks`; skips keyless/empty-key rows; null clicks coalesce to 0; repeated URLs summed; null rows → empty Map (no throw). Reuses `getSearchConsole()` / `GSC_SA_KEY_B64`.

## Verification

- `npx vitest run lib/gsc.test.ts` → 15 passed (9 existing + 6 new fetchPageClicks)
- `npm test` → 118 passed, no regressions
- `npm run typecheck` → clean
- Greps: `dimensions: ['page']`=1, `rowLimit: 250`=1, `export async function fetchPageClicks`=1

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED
- lib/gsc.ts fetchPageClicks — FOUND
- lib/gsc.test.ts describe fetchPageClicks — FOUND
- Commits 34eeff4 (test), b21a0a1 (feat) — all in git log
