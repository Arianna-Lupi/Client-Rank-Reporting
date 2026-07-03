---
phase: 06-weekly-client-report-block-kit
reviewed: 2026-07-03T00:00:00Z
depth: deep
files_reviewed: 4
files_reviewed_list:
  - lib/weekly-report.ts
  - lib/weekly-report.test.ts
  - lib/slack/blocks.ts
  - lib/slack/blocks.test.ts
findings:
  critical: 0
  warning: 0
  info: 5
  total: 5
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-07-03
**Depth:** deep
**Files Reviewed:** 4
**Status:** issues_found (INFO only — no blockers, no warnings)

## Summary

Adversarial deep review of the weekly client report orchestrator (`lib/weekly-report.ts`),
its offline suite, and the weekly Block Kit builder added to `lib/slack/blocks.ts`, plus the
new weekly tests. I traced every discriminated path, the fetch wiring against the frozen
Phase 5 core, the top-3 slice/sort math, number/URL formatting, secret handling, and the
frozen-file invariants.

Result: the implementation is correct on every axis the phase demanded. No BLOCKER and no
WARNING findings. The five items below are INFO-level: two redundant/process notes, one
documented-tradeoff note, one test-fragility note, and one locked-decision conflict that was
resolved silently. None affect runtime correctness or security.

Verified positively (no defect):

- **Orchestrator totality & never-throw.** Every input maps to exactly one `WeeklyClientReport`
  variant. `fetchDaily` throw → `error`; zero rows → `no_data`; `resolveWeeklyWindow`
  insufficient → `insufficient_data`; success → `ok`. The `error` message is a fixed Spanish
  constant; the caught error is never interpolated (`catch {}` with no binding), so no
  secret/stack can leak. The planted-token test confirms it.
- **Correct fetch wiring.** `fetchDailyMetrics(s, { windowDays: 21 })` → `resolveWeeklyWindow`
  → `sliceWindow`(current)/`sliceWindow`(previous) → `aggregateWeek` ×2 → `computeWeeklyDeltas`.
  `fetchPageClicks` is called **twice with distinct windows**: `(currentStart, currentEnd)` and
  `(previousStart, previousEnd)` — no duplication of the current window into the previous slot
  (blocks.ts lines 87-88; spy test lines 103-112 pins both exact pairs). 21-day fetch amply
  covers 2 weeks + GSC lag.
- **URL degradation (T-06-02).** The per-URL fetch has its own `try/catch` that degrades both
  maps to empty while preserving the already-computed metrics; the report stays `ok`.
- **Top-3 slice & sort.** `urls` arrives pre-sorted by `|delta|` desc. `risers = filter(delta>0).slice(0,3)`
  and `droppers = filter(delta<0).slice(0,3)` preserve that order, so risers are the 3 largest
  positive deltas and droppers are the 3 most-negative deltas — correct sort direction. `delta===0`
  entries are excluded from both, so no empty section leaks.
- **🆕 semantics.** `isNew` (previous===0) can only co-occur with `delta >= 0`, so the marker
  can only appear on risers — never mislabels a dropper.
- **Formatting (RPT-10).** es-ES thousands via a module-level `Intl.NumberFormat`, CTR 2 decimals
  (`formatCtr2`, distinct from the frozen daily 1-decimal `formatCtr`), position 1 decimal, signed
  1-decimal delta via reused `deltaSuffix`. URL label shows only `new URL().pathname` truncated to
  49 chars + U+2026 while the href keeps the full URL; malformed URLs fall back to the raw string
  inside a `try/catch` (never throws).
- **Frozen-file invariants (git-verified).** `lib/metrics.ts` is byte-identical to its
  pre-Phase-6 state. `buildClientReportBlocks` and every daily helper are byte-unchanged: the
  diff of `lib/slack/blocks.ts` since the daily builder landed contains only additions in the
  weekly region and zero removed/modified lines.
- **Spanish copy.** New weekly strings are natural neutral Spanish with no AI writing tells and
  no em/en dashes in prose. The header uses `:` (not the `—` from CONTEXT — see IN-01). The
  U+2212 minus in click deltas and U+2026 ellipsis are notation, correctly retained.

## Info

### IN-01: Header deviates from the locked CONTEXT decision (silent conflict resolution)

**File:** `lib/slack/blocks.ts:182`
**Issue:** CONTEXT (`06-CONTEXT.md`, "Message Structure") locks the header as
`📊 {siteUrl} — semana {inicio}…{fin}` with an em-dash, but the same phase locks a hard
humanizer rule forbidding em/en dashes in posted prose. The two locked decisions conflict. The
implementation resolved it by using `📊 ${siteUrl}: semana …` (colon). The resolution is
reasonable and the humanizer rule should win, but the deviation from an explicit locked string
was made silently with no note in the summary.
**Fix:** None required in code. Record in the phase summary that the header separator was changed
from `—` to `:` to satisfy the no-dash humanizer rule, so the CONTEXT/implementation divergence
is auditable.

### IN-02: Plan acceptance criterion `grep -c "—\|–" == 0` is unsatisfiable as written

**File:** `.planning/phases/06-weekly-client-report-block-kit/06-02-PLAN.md:136`
**Issue:** Task 2's acceptance criterion greps the **whole** `blocks.ts` for em/en dashes and
expects 0, but the frozen daily builder legitimately contains 6 em-dashes (lines 8, 13, 80, 88,
97, 99) that the same task is explicitly forbidden to touch. The criterion can never pass against
the real file; it should have scoped the grep to the weekly region / new lines. Verification
defect, not a code defect — the shipped code is correct.
**Fix:** Scope the check to added lines only, e.g. `git diff <daily-commit> HEAD -- lib/slack/blocks.ts | grep '^+' | grep -c '—\|–'` expecting 0.

### IN-03: Redundant tautological assertions in the `no_data` test

**File:** `lib/weekly-report.test.ts:122-125`
**Issue:** After `expect(result).toEqual({ status: 'no_data' })`, the three follow-up checks
`expect('window' in result).toBe(false)` / `'deltas'` / `'urls'` are strictly redundant:
`toEqual` already fails on any extra key, so these can never fail independently. They add noise
without adding coverage.
**Fix:** Drop the three `in` assertions, or replace the `toEqual` with a looser `objectContaining`
if the intent was to allow extra keys (it is not). Keep only `toEqual({ status: 'no_data' })`.

### IN-04: URL-line count assertion is case-fragile

**File:** `lib/slack/blocks.test.ts:187-189`
**Issue:** `(json.match(/clics/g) ?? []).length` is expected to be exactly 6, which holds only
because the six URL lines use lowercase `clics` while the metric label is capitalized `Clics`
(no lowercase match). A future copy tweak that lowercases the metric label would silently shift
the count and make the test assert the wrong thing. The related empty-urls test at line 217
(`not.toContain('clics')`) shares the same case dependency.
**Fix:** Count URL lines directly instead of by substring, e.g. count section blocks whose text
starts with `🆕`/`<`, or match the full ` clics` suffix pattern anchored to a delta
(`/[+−]\d+ clics/g`) so the metric label can never collide.

### IN-05: Partial per-URL fetch failure discards a valid current-window map

**File:** `lib/weekly-report.ts:86-92`
**Issue:** Both `fetchPageClicks` calls share one `try/catch`; if the current-window fetch
succeeds but the previous-window fetch throws, the already-fetched valid current map is discarded
and both reset to empty. This is a deliberate and arguably safer choice (keeping current-only
would make every URL look `isNew` with an inflated delta and post misleading "new page" rows), so
it is not a bug — but the tradeoff is undocumented and the degradation test only exercises the
"both throw" shape, not the "second throws" shape.
**Fix:** Add a code comment stating the intentional all-or-nothing degradation, and optionally a
test where only the second `fetchPageClicks` rejects, asserting `urls === []` (no partial
mislabeled risers).

---

_Reviewed: 2026-07-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
