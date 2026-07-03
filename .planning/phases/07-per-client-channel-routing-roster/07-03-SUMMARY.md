---
phase: 07-per-client-channel-routing-roster
plan: 03
subsystem: cron
tags: [cron, weekly, routing, idempotency, security]
requires:
  - lib/channels.ts
  - lib/schedule.ts::isReportDow
  - lib/config.ts::reportDow
  - lib/weekly-report.ts
  - lib/slack/blocks.ts
  - lib/slack/post.ts
  - lib/report-lock.ts
  - lib/cron-auth.ts
provides:
  - api/cron/daily-report.ts weekly per-channel handler (GET, CronDeps)
affects: []
tech-stack:
  added: []
  patterns: [cron-di-seam, weekly-cadence-gate, per-client-isolation]
key-files:
  created:
    - api/cron/daily-report.test.ts
  modified:
    - api/cron/daily-report.ts
    - vitest.config.ts
decisions:
  - Cadence gated on isReportHour AND isReportDow; schedule stays hourly 0 * * * * in vercel.json.
  - SLACK_CHANNEL_ID retired from the posting path; routing is 100% via the channel map.
  - Unmapped client -> siteUrl-only warn + skip, never a shared-channel fallback.
metrics:
  duration: 7m
  completed: 2026-07-03
requirements: [SCH-04, CH-03]
---

# Phase 7 Plan 03: Weekly per-channel cron rewire Summary

Rewired `api/cron/daily-report.ts` from the v1.0 single-channel daily path to the v1.1 weekly, per-channel routed path. The hourly cron now also gates on the configured weekday, loads the client->channel map once, and posts each active client's weekly report to its own mapped channel, skipping unmapped clients with a warn.

## What was built

- Composition order: Bearer auth (401 unchanged) -> `isReportHour AND isReportDow` gate (`skipped: not-report-window`, no lock) -> `claimDailyReport(dateKey)` lock (`skipped: already-posted`) -> load `getAllChannels()` + `getActiveClients()` once -> per client: mapped channel lookup, `getWeeklyClientReport` -> `buildWeeklyClientReportBlocks` -> `postMessage(mappedChannelId, blocks)`.
- Unmapped client: `console.warn` siteUrl only, `skippedUnmapped++`, continue. Report `status === 'error'`: generic `console.error` (never `report.message`), skip. Post throw: caught, generic log, run continues.
- Returns `Response.json({ posted, skippedUnmapped, dateKey })`. `slackChannelId` never referenced in the posting path.
- `CronDeps` DI seam (now, getActive, getChannels, claimLock, getReport, buildBlocks, post), each defaulting to the real import so Vercel's `GET(req)` is unchanged.
- `api/cron/daily-report.test.ts` — 7 offline cases: auth 401, wrong-hour skip, wrong-weekday skip, lock-claimed skip, mapped/unmapped mix (asserts each mapped client posts to its own channel id + unmapped warn), error-status no-post + no-leak, per-client post-failure isolation.

## Deviations from Plan

**1. [Rule 3 - Blocking] Added vitest test.env for cold-start getConfig()**
- Found during: Task 2 (test collection).
- Issue: the cron module calls `getConfig()` at import (cold-start fail-fast). ESM import hoisting runs that before any `beforeEach` env setup, so importing the module under test threw on missing env.
- Fix: added non-secret dummy env defaults to `vitest.config.ts` `test.env`, satisfied at import time. Per-suite `beforeEach`/`resetConfigCache()` still override as needed. No live services touched.
- Commit: 34201a2

## Security

Logs are siteUrl-only and secret-free (ASVS V7). A test asserts the error-status path never logs `report.message`. Bearer auth and the idempotency lock are preserved. No shared-channel fallback.

## Standing blocker

No live GSC/Slack/Upstash. All verification offline with injected fakes; the live weekly run is deferred to the credentials unblock. `vercel.json` unchanged (`0 * * * *`).

## Self-Check: PASSED

- File exists: api/cron/daily-report.test.ts (verified on disk).
- Commits exist: 56fabe5, 34201a2.
- `grep -E "isReportDow|getAllChannels|getWeeklyClientReport" api/cron/daily-report.ts` returns all three; `grep slackChannelId api/cron/daily-report.ts` returns nothing.
