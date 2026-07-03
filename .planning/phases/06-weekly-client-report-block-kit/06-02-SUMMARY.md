---
phase: 06-weekly-client-report-block-kit
plan: 02
subsystem: slack-blocks
tags: [block-kit, weekly, formatting, humanized-copy, offline-tests]
requires: [lib/weekly-report.ts, lib/weekly.ts, lib/metrics.ts]
provides: [buildWeeklyClientReportBlocks]
affects: [lib/slack/blocks.ts, lib/slack/blocks.test.ts]
tech-stack:
  added: []
  patterns: [pure-total-builder, intl-numberformat-es-ES, graceful-degradation, humanized-copy]
key-files:
  created: []
  modified: [lib/slack/blocks.ts, lib/slack/blocks.test.ts]
decisions:
  - "Weekly copy is fully em/en-dash free; header uses ':' + ellipsis U+2026, click deltas use minus U+2212 (notation, not prose)"
  - "es-ES only groups thousands at >= 10000 (minimumGroupingDigits=2); test fixture uses grouping-visible values"
  - "Daily buildClientReportBlocks and its helpers left byte-unchanged; only additions to the file"
requirements: [RPT-07, RPT-08, RPT-09, RPT-10]
metrics:
  duration_min: 12
  completed: 2026-07-03
---

# Phase 6 Plan 02: Weekly Block Kit Builder Summary

`buildWeeklyClientReportBlocks(siteUrl, report)` renders `WeeklyClientReport` as a per-client Block Kit message: header with the current week range, four WoW metrics ("vs semana previa"), a divider, and top 3 rising / top 3 dropping URLs by click delta, with es-ES readable formatting and graceful degradation when URL data is missing. Added alongside the intact daily builder.

## What was built

- `buildWeeklyClientReportBlocks` in `lib/slack/blocks.ts` (total switch over all four variants, never throws, never leaks `report.message`).
- New private helpers: `formatThousands` (module-level `Intl.NumberFormat('es-ES')`), `formatCtr2` (2-decimal CTR override), `urlLink` (path-only mrkdwn link truncated ~50 chars with U+2026), `urlClickLine` (signed click delta with U+2212 for drops, 🆕 for new URLs), `urlSection`, `weeklyMetricsText`. Reuses existing `metricLine`, `directionLabel`, `deltaSuffix`, `formatPosition`, `contextBlock`.
- `describe('buildWeeklyClientReportBlocks')` added to `lib/slack/blocks.test.ts`: ok (top-3 slicing, es-ES thousands, 2-decimal CTR, 🆕, truncated link), ok with empty urls (degradation), insufficient_data, no_data, error (no message leak). Daily tests stay green.

## Copy / Humanizer

All weekly Spanish strings posted to Slack were run through the humanizer skill: neutral Spanish, no voseo, no AI tells, no em/en dashes in prose. The two no-data lines were varied to avoid templated parallelism. Functional notation preserved on purpose: ellipsis U+2026 (header/truncation) and minus U+2212 (click deltas).

## Verification

- `npx vitest run lib/slack/blocks.test.ts` → 9 passed (4 daily + 5 weekly).
- `npm test` (full suite) → 134 passed / 17 files.
- `npm run typecheck` → clean; no `any`, no @slack imports.
- `grep -c "es-ES"` → 3; daily `buildClientReportBlocks` unchanged; `lib/metrics.ts` unchanged (`git diff` empty).

## Deviations from Plan

**1. [Rule 1 - Test correctness] es-ES grouping threshold**
- Found during: Task 1 GREEN run.
- Issue: fixture asserted `1.234`, but es-ES only groups at >= 10000 (minimumGroupingDigits=2), so 1234 renders as `1234`.
- Fix: fixture click value set to 15678 (`15.678`); assertion updated. Behavior of the builder is correct.

**2. [Rule 1 - Test correctness] URL truncation assertion**
- Found during: Task 1 GREEN run.
- Issue: asserted the full path tail absent from JSON, but the mrkdwn href legitimately contains the full URL; only the visible label is truncated.
- Fix: assert the truncated label tail `los-c…>` instead.

**3. [Scope/constraint] Whole-file em-dash grep vs frozen daily builder**
- Task 2 acceptance `grep -c "—\|–" = 0` over the whole file is unreachable without editing `buildClientReportBlocks`, which the user forbade (v1.0 daily builder frozen; it has em dashes on lines 8, 13, 80, 88, 97, 99). Resolution: all NEW weekly copy and comments are 100% em/en-dash free; the 6 remaining dashes are pre-existing frozen daily-builder lines. This satisfies the hard rule (weekly posted copy is clean) while honoring the "do not modify the daily builder" constraint.

## Self-Check: PASSED

- lib/slack/blocks.ts (buildWeeklyClientReportBlocks) FOUND
- lib/slack/blocks.test.ts (describe buildWeeklyClientReportBlocks) FOUND
- Commits 806ecea (test), 34b5bff (feat), 550653a (style/humanize) present in history
