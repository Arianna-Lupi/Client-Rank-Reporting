---
phase: 04-block-kit-report-daily-cron
plan: 03
subsystem: api
tags: [vercel-cron, slack, fetch, idempotency, block-kit, vitest]

requires:
  - phase: 04-block-kit-report-daily-cron
    provides: buildClientReportBlocks (04-01), isReportHour/reportDateKey/isAuthorizedCron/claimDailyReport (04-02)
  - phase: 03-gsc-metrics-delta-computation
    provides: getClientReport
  - phase: 01-foundations
    provides: getActiveClients
provides:
  - "postMessage(channel, blocks, deps?): proactive chat.postMessage with bot token, no SDK"
  - "api/cron/daily-report.ts: GET handler composing auth -> hour -> claim -> per-client post"
  - "vercel.json hourly cron entry + 60s maxDuration for the handler"
affects: [deploy, e2e verification]

tech-stack:
  added: []
  patterns:
    - "Thin Web-standard GET handler composing pure lib primitives; getConfig() fail-fast on cold start"
    - "Per-client error isolation: status error -> continue; postMessage in per-client try/catch"

key-files:
  created:
    - lib/slack/post.ts
    - lib/slack/post.test.ts
    - api/cron/daily-report.ts
  modified:
    - vercel.json

key-decisions:
  - "Hourly UTC cron (0 * * * *) + isReportHour gate because Vercel Cron has no per-job timezone"
  - "postMessage reads getConfig only when no token injected, so tests need no env"
  - "Per-client failures (error status or post throw) are logged generically and skipped, never aborting the run"

patterns-established:
  - "Proactive Slack posts use the bot token via raw fetch, never the signing secret or an SDK"

requirements-completed: [RPT-03, SCH-01, SCH-02, PER-02]

duration: 4min
completed: 2026-06-26
---

# Phase 4 Plan 03: Proactive Post + Daily Cron Handler Summary

**`postMessage` (Bearer bot token, no SDK) plus the `api/cron/daily-report.ts` GET handler that composes auth -> tz-hour -> idempotency claim -> one Block Kit message per client, scheduled hourly in vercel.json.**

## Performance

- **Duration:** ~4 min
- **Tasks:** 2 (Task 1 TDD)
- **Files modified:** 4 (3 created, vercel.json edited)

## Accomplishments
- `lib/slack/post.ts` — `postMessage` POSTs Block Kit to `chat.postMessage` with a Bearer bot token, detects `ok:false` and throws Slack's error code without leaking the token (RPT-03)
- `api/cron/daily-report.ts` — GET handler: 401 without `CRON_SECRET` before any work (SCH-02), no-op off the report hour (SCH-01), per-day idempotency claim (PER-02), then iterates active clients into one Block Kit message each (RPT-03)
- Per-client isolation: a `status: 'error'` report `continue`s and a failed `postMessage` is caught per-client, so one bad client never aborts the run
- `vercel.json` — hourly cron `0 * * * *` for `/api/cron/daily-report` + `maxDuration: 60`

## Task Commits

1. **Task 1: postMessage proactive + tests** - `8d22e10` (feat, TDD)
2. **Task 2: cron handler + vercel.json crons** - `e5c6f42` (feat)

## Files Created/Modified
- `lib/slack/post.ts` / `.test.ts` - proactive chat.postMessage wrapper
- `api/cron/daily-report.ts` - composed daily cron handler
- `vercel.json` - hourly crons entry + handler maxDuration

## Decisions Made
- Hourly UTC schedule + `isReportHour` gate (Vercel Cron is UTC-only, no per-job tz)
- `getConfig()` read lazily in postMessage only when a token is not injected
- Generic per-client error logging (siteUrl only), never `report.message` / token / secret

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. 90/90 tests pass, typecheck green, vercel.json parses as valid JSON. No live Slack/Redis/GSC calls in tests.

## User Setup Required

**Live deploy + e2e cron verification is a human checkpoint** (deferred per CONTEXT). Before the cron can post for real, set in the Vercel project env:
- `SLACK_BOT_TOKEN` (xoxb-…, scope `chat:write`)
- `CRON_SECRET` (any random string; Vercel auto-forwards it to cron invocations)
- Optionally `REPORT_HOUR` (defaults to 9) and `REPORT_TZ` (defaults to America/Mexico_City)

## Next Phase Readiness
- Full vertical slice complete in code; only live deploy + e2e remain (credential-gated)

## Self-Check: PASSED

- FOUND: lib/slack/post.ts, lib/slack/post.test.ts, api/cron/daily-report.ts
- FOUND commits: 8d22e10, e5c6f42

---
*Phase: 04-block-kit-report-daily-cron*
*Completed: 2026-06-26*
