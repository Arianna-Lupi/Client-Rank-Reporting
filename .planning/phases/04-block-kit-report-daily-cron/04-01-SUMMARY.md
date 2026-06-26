---
phase: 04-block-kit-report-daily-cron
plan: 01
subsystem: ui
tags: [block-kit, slack, config, env, typescript, vitest]

requires:
  - phase: 03-gsc-metrics-delta-computation
    provides: ClientReport discriminated union + MetricDeltas (improved/isNew/deltaPct)
provides:
  - "buildClientReportBlocks(siteUrl, report): pure, total Block Kit builder (one message per client)"
  - "SlackBlock type exported for downstream cron/post wiring"
  - "AppConfig extended with slackBotToken, cronSecret, reportHour (default 9)"
affects: [04-03 cron handler, 04-03 postMessage]

tech-stack:
  added: []
  patterns:
    - "Pure total render function over a discriminated union (switch, never throws)"
    - "Direction indicator maps Phase 3 improved boolean to emoji/arrow without re-inverting position"

key-files:
  created:
    - lib/slack/blocks.ts
    - lib/slack/blocks.test.ts
  modified:
    - lib/config.ts
    - .env.example

key-decisions:
  - "Builder never re-inverts position; reuses the improved boolean baked in Phase 3 metrics.ts"
  - "error variant renders a generic friendly context block, never surfacing report.message (T-04-01)"
  - "REPORT_HOUR validated to integer [0,23]; any missing/invalid value falls back to 9"

patterns-established:
  - "Spanish metric labels: Impresiones, Clics, CTR, Posición"
  - "Block Kit emitted as plain JSON, no Slack SDK"

requirements-completed: [RPT-02, RPT-03]

duration: 6min
completed: 2026-06-26
---

# Phase 4 Plan 01: Block Kit Builder + Config Summary

**Pure `buildClientReportBlocks` rendering one Block Kit message per client with Phase-3-driven direction indicators (🟢▲/🔴▼/🆕), plus SLACK_BOT_TOKEN / CRON_SECRET / REPORT_HOUR added to config.**

## Performance

- **Duration:** ~6 min
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Extended `AppConfig` with `slackBotToken`, `cronSecret`, `reportHour` (validated 0-23, default 9) and documented all three in `.env.example`
- Pure, total `buildClientReportBlocks(siteUrl, report)` rendering header + 4 metric lines for `ok`, and a friendly Spanish context block for `insufficient_data` / `no_data` / `error`
- Direction indicator (RPT-02) maps the Phase 3 `improved` boolean to 🟢▲ / 🔴▼, with 🆕 nuevo for new properties (deltaPct null / isNew)
- CTR rendered as a percentage, position to 1 decimal, impresiones/clics as integers
- `error` variant never leaks `report.message` (verified by a test asserting absence of the secret)

## Task Commits

1. **Task 1: Extend config with SLACK_BOT_TOKEN, CRON_SECRET, REPORT_HOUR** - `aaaf1ca` (feat)
2. **Task 2: buildClientReportBlocks pure + tests** - `8e300f3` (feat, TDD test+impl in one commit after RED verification)

## Files Created/Modified
- `lib/config.ts` - 3 new readonly AppConfig fields + resolveReportHour helper
- `.env.example` - documented SLACK_BOT_TOKEN, CRON_SECRET, REPORT_HOUR
- `lib/slack/blocks.ts` - SlackBlock type + buildClientReportBlocks builder
- `lib/slack/blocks.test.ts` - coverage for every status and each direction branch

## Decisions Made
- Builder reuses Phase 3 `improved` (position inversion already baked in) instead of re-deriving direction
- New properties (`deltaPct === null` or `isNew`) render `🆕 nuevo` with no delta suffix
- All no-data states collapse to a single friendly Spanish context block, never an error

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. RED confirmed (missing module) before GREEN; 76/76 tests pass, typecheck green.

## Next Phase Readiness
- `SlackBlock` + `buildClientReportBlocks` ready for 04-03 cron iteration
- Config fields ready for cron auth (cronSecret) and scheduling (reportHour)

## Self-Check: PASSED

- FOUND: lib/slack/blocks.ts
- FOUND: lib/slack/blocks.test.ts
- FOUND commit: aaaf1ca
- FOUND commit: 8e300f3

---
*Phase: 04-block-kit-report-daily-cron*
*Completed: 2026-06-26*
