---
phase: 07-per-client-channel-routing-roster
plan: 01
subsystem: foundations
tags: [redis, channels, schedule, config, seed]
requires: [lib/clients.ts, lib/schedule.ts, lib/config.ts]
provides:
  - lib/channels.ts (getClientChannel, setClientChannel, getAllChannels, ChannelMapReader, ChannelMapWriter)
  - lib/schedule.ts::isReportDow
  - lib/config.ts::reportDow
  - scripts/seed-roster.ts (ROSTER, seedRoster)
affects: [07-02, 07-03]
tech-stack:
  added: []
  patterns: [injectable-reader-writer, lazy-redis-fromenv, intl-dst-safe-gate]
key-files:
  created:
    - lib/channels.ts
    - lib/channels.test.ts
    - lib/config.test.ts
    - scripts/seed-roster.ts
    - scripts/seed-roster.test.ts
  modified:
    - lib/schedule.ts
    - lib/schedule.test.ts
    - lib/config.ts
    - vitest.config.ts
    - tsconfig.json
decisions:
  - Store the resolved Slack channel id (never the #name) as the HASH value.
  - resolveReportDow fails safe to Monday (1) on any bad REPORT_DOW.
  - Roster seeded as sc-domain:<host>; exact canonical form to be confirmed vs sites.list before the live run.
metrics:
  duration: 8m
  completed: 2026-07-03
requirements: [CH-01, SCH-04, CFG-01]
---

# Phase 7 Plan 01: Channel-map, weekly gate, roster seed foundations Summary

Wave-1 primitives for per-client routing: a Redis HASH client->channel map, the weekly day-of-week scheduling gate plus its fail-safe config, and an idempotent roster seed. Every artifact is injectable and fully offline-tested.

## What was built

- `lib/channels.ts` — HASH `clients:channels` (field = canonical siteUrl, value = Slack channel id). Injectable `ChannelMapReader`/`ChannelMapWriter` mirroring `lib/clients.ts`. Exports `getClientChannel` (hit/miss), `setClientChannel` (persists id under siteUrl), `getAllChannels` (Map from hgetall, empty Map on null).
- `lib/schedule.ts::isReportDow(now, tz, dow)` — local weekday gate via `Intl` short-weekday parsing, DST-safe and deterministic. Existing `isReportHour`/`reportDateKey` untouched.
- `lib/config.ts::reportDow` — `resolveReportDow()` parses `REPORT_DOW` in [0,6], fail-safe default Monday (1). `slackChannelId` kept defined.
- `scripts/seed-roster.ts` — `ROSTER` of the four canonical hosts (nicmafia excluded, childrenchic rename-noted) and `seedRoster(writer?)` doing one idempotent SADD each via `addClient`. Main-guard runs it directly; verification is offline.

## Deviations from Plan

**1. [Rule 3 - Blocking] Widened test/type globs for scripts/ and api/**
- Found during: Task 3 (seed-roster test would not run).
- Issue: `vitest.config.ts` included only `lib/**/*.test.ts`; `tsconfig.json` included only `api` and `lib`. The new `scripts/` tests (and the Plan 07-03 `api` test) were invisible to the runner and the typechecker.
- Fix: added `api/**/*.test.ts` and `scripts/**/*.test.ts` to the vitest include, and `scripts/**/*.ts` to the tsconfig include.
- Commit: 16d664e

## Standing blocker

No live Upstash/GSC/Slack execution. All verification offline via injected fakes. Live seed run deferred to the credentials unblock.

## Self-Check: PASSED

- Files exist: lib/channels.ts, scripts/seed-roster.ts, lib/config.test.ts (verified on disk).
- Commits exist: 9998b44, 2d4881b, 552d8b8, e309b7f, 16d664e.
- `grep clients:channels lib/channels.ts` matches.
