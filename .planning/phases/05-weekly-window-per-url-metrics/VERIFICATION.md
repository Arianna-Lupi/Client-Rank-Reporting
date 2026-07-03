---
phase: 05-weekly-window-per-url-metrics
status: passed
verified: 2026-07-03
plans: [05-01, 05-02]
requirements: [GSC-05, GSC-06, RPT-05]
verification-level: offline-unit
---

# Phase 5 Verification: Weekly Window + Per-URL Metrics

**Status: passed** — all acceptance criteria met at the offline unit-test level. No live GSC/Slack/Upstash credentials were required (standing creds blocker remains in effect; no e2e in this phase, by design).

## Commands run and results

| Command | Result |
|---------|--------|
| `npm test` (vitest run, full suite) | 16 files, **118 passed** (baseline 90 + 28 new) |
| `npx vitest run lib/weekly.test.ts` | **22 passed** |
| `npx vitest run lib/gsc.test.ts` | **15 passed** (9 existing + 6 new) |
| `npm run typecheck` (`tsc --noEmit`, strict + noUncheckedIndexedAccess) | **clean, no errors** |
| `git diff --exit-code lib/metrics.ts` | **no diff** — v1.0 core byte-identical |

## Requirement coverage

- **GSC-05 (weekly window anchoring):** `resolveWeeklyWindow` anchors on the last day WITH DATA (max date from rows), never today; gate `< windowDays+1` → `insufficient_data`. Verified: happy 14-day path (exact 4 boundaries + anchor), unsorted-input same anchor, duplicate dates not inflating distinct count, exactly-7 → insufficient, exactly-8 → ok with partial previous week, custom windowDays.
- **GSC-06 (per-URL clicks):** `fetchPageClicks` queries `dimensions:['page']`, `dataState:'final'`, `rowLimit:250` for a resolved window; returns `URL→clicks` Map, injectable for offline tests. Verified: exact params, row mapping, keyless-row skip, null-clicks→0, repeated-URL sum, null rows→empty Map. `fetchDailyMetrics` unchanged.
- **RPT-05 (WoW deltas + per-URL ranking):** `aggregateWeek` SUMs clicks/impressions, recomputes CTR, impression-weights position with ÷0 guards; `computeWeeklyDeltas` reuses `metrics.ts computeDeltas` (inverted position, ÷0 guard) without modifying it; `rankUrlClickDeltas` returns the full list ranked by `|delta|` incl. new URLs and droppers with deterministic tiebreak.

## Acceptance greps

| Check | Expected | Actual |
|-------|----------|--------|
| `resolveWeeklyWindow\|aggregateWeek` in weekly.ts | 2 | 2 |
| `computeWeeklyDeltas\|rankUrlClickDeltas` in weekly.ts | 2 | 2 |
| `computeDeltas` in weekly.ts (core reuse) | >=1 | 3 |
| `new Date()` in weekly.ts (no today-reference) | 0 | 0 |
| `dimensions: ['page']` in gsc.ts | >=1 | 1 |
| `rowLimit: 250` in gsc.ts | present | 1 |
| `export async function fetchPageClicks` in gsc.ts | 1 | 1 |

## Constraints honored

- `lib/metrics.ts` NOT modified (v1.0 day-vs-day core stays green; confirmed via `git diff --exit-code`).
- New pure module `lib/weekly.ts` (zero I/O, zero env, no current-date access).
- `GscQueryFn` extension is non-breaking (`rowLimit` optional); `fetchDailyMetrics` suite intact.
- All verification offline via mock `GscQueryFn` / inline fixtures.

## Commits

| Hash | Type | Scope |
|------|------|-------|
| 34eeff4 | test | 05-02 failing fetchPageClicks tests |
| b21a0a1 | feat | 05-02 fetchPageClicks (GSC-06) |
| d24e340 | test | 05-01 failing weekly window/aggregation tests |
| 0a8a4a3 | feat | 05-01 weekly.ts window + aggregation |
| 24316ff | test | 05-01 computeWeeklyDeltas + rankUrlClickDeltas coverage |

## Human verification needed

None for this phase — the layer is pure compute + a DI-isolated query, fully covered offline. Live GSC/Slack/Upstash wiring is exercised in later phases when credentials are available.
