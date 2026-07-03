---
status: passed
phase: 07-per-client-channel-routing-roster
milestone: v1.1
verified: 2026-07-03
level: offline-unit
requirements: [CH-01, CH-02, CH-03, CFG-01, CMD-09, SCH-04]
---

# Phase 7 Verification — Per-Client Channel Routing + Roster

All verification is offline unit-test level. Live GSC/Slack execution is still credential-gated (Phase 1 Task 2). Upstash credentials are now present in the environment, but the test suite stays offline via dependency injection (fake readers/writers, no `Redis.fromEnv()` construction in any test path).

## Result: PASSED

- Full suite: `npm test` -> 23 files, 170 tests passing (was 134 at end of Phase 6; +36 new).
- Typecheck: `npm run typecheck` -> clean (exit 0), no `any` on the new Redis HASH / Map / Set surfaces.
- v1.0 daily core and metrics tests unchanged and green (lib/report.test.ts, lib/metrics.test.ts, lib/report-lock.test.ts, lib/cron-auth.test.ts, lib/schedule isReportHour/reportDateKey cases).

## Requirement coverage

| Req | What | Evidence |
|-----|------|----------|
| CH-01 | client->channel map over HASH `clients:channels` | lib/channels.ts + channels.test.ts (5 tests: set, get hit/miss, getAll populated/empty) |
| SCH-04 | weekly DOW gate + reportDow config | isReportDow (schedule.test.ts) + reportDow default/override/fallback (config.test.ts) |
| CFG-01 | idempotent roster seed, nicmafia excluded | scripts/seed-roster.ts + test (ROSTER shape, one SADD/entry, idempotent) |
| CH-02 | /setchannel assigns + validates | setchannel.ts + test (usage, malformed channel, inactive client, happy path persists C-id) |
| CMD-09 | /getdata posts weekly to mapped channel | getdata.ts + test (usage, unknown, unmapped, mapped-post-to-channel-id, no fan-out) |
| CH-03 | weekly per-channel cron routing | api/cron/daily-report.ts + test (auth, hour/dow gate, lock, mapped/unmapped mix, error skip, post-failure isolation) |

## Targeted checks

- `grep clients:channels lib/channels.ts` -> match.
- `grep -E "case '/(setchannel|getdata)'" lib/commands/router.ts` -> both present.
- `grep -E "isReportDow|getAllChannels|getWeeklyClientReport" api/cron/daily-report.ts` -> all three present.
- `grep slackChannelId api/cron/daily-report.ts` -> no match (v1.0 destination retired from the posting path).

## Humanization

Applied to every Spanish string the bot posts or replies (/setchannel and /getdata confirmations and errors): neutral Spanish, no voseo, no em/en dashes, no AI tells, no secret interpolation. Enforced by regex assertions in setchannel.test.ts and getdata.test.ts (`expect(reply).not.toMatch(/[—–]/)`).

## Security (STRIDE dispositions)

- T-07-01 REPORT_DOW tampering -> resolveReportDow clamps to [0,6], fail-safe Monday. Covered.
- T-07-04 channel-arg tampering -> parseChannel accepts only `<#C…|name>`; bare/garbage rejected. Covered.
- T-07-05 off-roster client -> resolveSiteRef over the ACTIVE set only. Covered.
- T-07-06/09 info disclosure -> error paths never interpolate report.message; logs siteUrl-only. Covered (cron test asserts the secret never reaches console.error).
- T-07-07 fan-out/preview -> /getdata single-client only. Covered.
- T-07-08 cron auth -> 401 before any work. Covered.
- T-07-10 wrong-channel -> post only to `channels.get(siteUrl)`; unmapped warn+skip, no fallback. Covered.
- T-07-11 duplicate post -> claimDailyReport lock retained. Covered.
- T-07-12 one client aborting -> per-client try/catch. Covered.

## Deviations (auto-fixed, Rule 3)

1. Widened vitest/tsconfig include globs to cover `scripts/` and `api/` tests (07-01).
2. Renamed SetChannelDeps.writer -> channelWriter to let CommandDeps compose cleanly (07-02).
3. Added non-secret vitest `test.env` so the cron module's cold-start getConfig() loads under test (07-03).

## Deferred (unchanged from plan)

- Live seed run, live weekly cron, real chat.postMessage — deferred to the credentials unblock.
- /setchannel `off` clear, unmapped admin notice, cross-client digest, command allowlist — v2.
