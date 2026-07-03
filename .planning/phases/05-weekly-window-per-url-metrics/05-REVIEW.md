---
phase: 05-weekly-window-per-url-metrics
reviewed: 2026-07-03T00:00:00Z
depth: deep
files_reviewed: 4
files_reviewed_list:
  - lib/weekly.ts
  - lib/weekly.test.ts
  - lib/gsc.ts
  - lib/gsc.test.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: resolved
resolution:
  fixed:
    - WR-01
    - WR-02
    - IN-03
  deferred:
    - IN-01
    - IN-02
  deferred_reason: documented latent notes, no behavior change intended
  fixed_at: 2026-07-03
  commits:
    - 81d185c  # WR-01
    - 7074ea1  # WR-02
    - 7ba233c  # IN-03
---

# Phase 5: Code Review Report

**Reviewed:** 2026-07-03
**Depth:** deep
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed the pure weekly-computation layer (`lib/weekly.ts`), the per-URL GSC fetch
(`fetchPageClicks` in `lib/gsc.ts`), and both test suites, cross-referenced against the
locked decisions in `05-CONTEXT.md` and the two plans, and against the reused
`lib/metrics.ts` core.

Confirmed correct against spec:

- **Window anchoring** never reads today's date. `shiftDay` uses `Date.UTC(...)` + pure
  millisecond arithmetic (no argless `new Date()`), so it is DST-immune. The four
  boundaries (`currentStart = anchor-6`, `previousEnd = anchor-7`, `previousStart =
  anchor-13`, parameterized by `windowDays`) match the locked contract exactly.
- **Aggregation** math is correct: SUM for clicks/impressions, CTR recomputed as
  `clicks/impressions` with `÷0` guard, position as impression-weighted average with `÷0`
  guard. No NaN paths.
- **Weekly deltas** correctly reuse `computeDeltas` (inverted position, `previous===0` →
  `deltaPct null` + `isNew`) without duplicating math and without modifying `metrics.ts`
  (verified: no diff since `08c309d`).
- **Per-URL ranking** joins the URL union, includes new URLs and droppers, sorts by
  `|delta|` desc with a deterministic `url`-ascending tiebreak (engine-stability
  independent).
- **`fetchPageClicks`** uses `dimensions:['page']`, `dataState:'final'`, `rowLimit:250`,
  null-coalesces clicks, skips keyless rows, sums duplicate URLs.
- **Security:** no secret leaks. The new code performs no logging, no error interpolation,
  and does not touch `GSC_SA_KEY_B64` beyond the pre-existing `getSearchConsole()` path.

The findings below are correctness-robustness gaps and test-coverage holes, not crashes or
vulnerabilities.

## Warnings

### WR-01: Insufficient-data gate counts distinct days over ALL rows, not within the windows — the previous week can be entirely empty while status is `ok`

**File:** `lib/weekly.ts:81-101`
**Issue:** The gate is `distinctDays < windowDays + 1` computed over every date in `rows`,
regardless of whether those days fall inside the two resolved windows. The locked decision
(`05-CONTEXT.md:32`) states the threshold exists because you "cannot form two comparable
weeks" — i.e. it should guarantee data in *both* windows. It does not.

The fetch window is 21 days (`05-CONTEXT.md:30`), so a date older than `anchor-13` can
count toward the 8-distinct-day gate while contributing nothing to either window. Concrete
repro: a fully populated current week (`anchor-6..anchor`, 7 distinct days) plus one
isolated old day at `anchor-20`. That is 8 distinct days → passes the gate → `status:'ok'`,
but `previous` window `[anchor-13..anchor-7]` has zero data. `aggregateWeek` then returns an
all-zero previous aggregate, and `computeWeeklyDeltas` reports **every** metric as
`deltaPct:null` + `isNew:true` — presenting an established client's data gap as if the
client were brand new. Phase 6 will render that misleading WoW report.

Note: when all data lies within `[anchor-13..anchor]`, ≥8 distinct days *does* guarantee ≥1
day in the previous window (7 current slots can't hold 8 days), so normal contiguous data is
fine. The bug only surfaces with a gap pattern, which GSC data legitimately produces.

**Fix:** Gate on distinct days that actually fall in the resolved span (or require each
window non-empty). For example, after computing boundaries:
```typescript
const inCurrent = new Set([...distinct].filter((d) => d >= window.currentStart && d <= window.currentEnd));
const inPrevious = new Set([...distinct].filter((d) => d >= window.previousStart && d <= window.previousEnd));
if (inCurrent.size < 1 || inPrevious.size < 1) {
  return { status: 'insufficient_data', distinctDays };
}
```
(Or, minimally, require `inPrevious.size >= 1` since a partial current week is explicitly
allowed.)

### WR-02: No test exercises date arithmetic across month/year boundaries

**File:** `lib/weekly.test.ts:29-98`
**Issue:** Every `resolveWeeklyWindow` fixture uses June 2026 dates, and both windows stay
inside June (`2026-06-07..2026-06-20`). The most bug-prone path — `shiftDay` rolling
`currentStart`/`previousStart` back across a month or year boundary — is never asserted. The
implementation is correct (`Date.UTC` handles it), but a regression here would ship
undetected. This is exactly the class of bug the phase's own guidance flags (date math).

**Fix:** Add a boundary case, e.g. anchor `2026-01-05` (≥8 distinct days) and assert
`previousStart === '2025-12-23'`, `currentStart === '2025-12-30'`, so the shift crosses both
the month and year boundary:
```typescript
it('crosses month/year boundary correctly', () => {
  const res = resolveWeeklyWindow(run('2025-12-23', 14)); // .. 2026-01-05
  if (res.status !== 'ok') throw new Error('expected ok');
  expect(res.window).toEqual({
    previousStart: '2025-12-23', previousEnd: '2025-12-29',
    currentStart: '2025-12-30', currentEnd: '2026-01-05',
  });
});
```

## Info

### IN-01: Coalesced-to-0 position can drag the impression-weighted average downward

**File:** `lib/weekly.ts:131`
**Issue:** `fetchDailyMetrics` coalesces a missing `position` to `0` (`lib/gsc.ts:157`).
`aggregateWeek` then computes `weightedPosition += r.position * r.impressions`. A row with
`impressions > 0` but `position === 0` (a defensive-coalesce artifact, not a real GSC value —
GSC position is 1-based) would pull the weekly weighted position toward 0, understating it.
Real GSC rows with impressions always carry a position, so this is latent, but it is
untested and would silently skew the metric if upstream ever emits such a row.
**Fix:** Not required now. If hardening, weight only rows with a positive position, or assert
in a test that a `position:0 / impressions>0` row is handled as intended.

### IN-02: A current-only URL with 0 clicks is flagged `isNew:true` with `delta:0`

**File:** `lib/weekly.ts:174`
**Issue:** For a URL present only in `current` with value `0`, the row is
`{current:0, previous:0, delta:0, isNew:true}` — semantically an odd "new riser" that gained
nothing. `fetchPageClicks` is unlikely to emit 0-click rows, so this is edge-only and
untested. Consider gating `isNew` on `current > 0` if Phase 6's labeling depends on it.
**Fix:** Optional; document that `isNew` means "absent in previous" rather than "new
traffic," or tighten to `prev === 0 && cur > 0`.

### IN-03: Duplicated magic constants (`86_400_000`, `rowLimit 250`)

**File:** `lib/weekly.ts:58`, `lib/gsc.ts:141,186`, `lib/weekly.test.ts:23`
**Issue:** The ms-per-day literal `86_400_000` is repeated across source and tests, and the
`rowLimit: 250` window cap is an inline literal. Minor maintainability; a named constant
(`MS_PER_DAY`, `PAGE_ROW_LIMIT`) would document intent and centralize the spec value.
**Fix:** Extract shared constants. Non-blocking.

---

_Reviewed: 2026-07-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
