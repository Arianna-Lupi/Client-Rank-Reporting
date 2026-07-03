---
phase: 07-per-client-channel-routing-roster
plan: 02
subsystem: commands
tags: [slack-commands, router, channels, weekly-report]
requires:
  - lib/channels.ts
  - lib/clients.ts
  - lib/site-match.ts
  - lib/weekly-report.ts
  - lib/slack/blocks.ts
  - lib/slack/post.ts
provides:
  - lib/commands/setchannel.ts (handleSetChannel, SetChannelDeps)
  - lib/commands/getdata.ts (handleGetData, GetDataDeps)
  - lib/commands/router.ts dispatch for /setchannel and /getdata
affects: []
tech-stack:
  added: []
  patterns: [command-handler-di, resolve-against-active-set, humanized-spanish-copy]
key-files:
  created:
    - lib/commands/setchannel.ts
    - lib/commands/setchannel.test.ts
    - lib/commands/getdata.ts
    - lib/commands/getdata.test.ts
  modified:
    - lib/commands/router.ts
    - lib/commands/router.test.ts
decisions:
  - SetChannelDeps channel writer field named channelWriter (not writer) so CommandDeps composes cleanly.
  - /getdata is single-client, real-post-to-mapped-channel only; no fan-out, no ephemeral preview.
  - parseChannel accepts only the escaped <#C…|name> mention; bare #name and garbage rejected.
metrics:
  duration: 6m
  completed: 2026-07-03
requirements: [CH-02, CMD-09]
---

# Phase 7 Plan 02: /setchannel and /getdata commands Summary

Two operator-facing commands on the existing dispatcher: `/setchannel <cliente> <#canal>` assigns a client's destination channel, and `/getdata <cliente>` posts that client's weekly report to its mapped channel on demand. Both mirror the add/list handler + DI pattern and are offline-tested.

## What was built

- `lib/commands/setchannel.ts` — parses two tokens (client ref + channel ref), extracts the `C…` id from Slack's `<#C…|name>` mention (rejecting bare `#name`/garbage), validates the client against the ACTIVE set, persists via `setClientChannel`. Humanized Spanish confirm/errors. Assign-only.
- `lib/commands/getdata.ts` — resolves the active client, looks up its mapped channel (unmapped -> humanized "usa /setchannel"), then `getWeeklyClientReport` -> `buildWeeklyClientReportBlocks` -> `postMessage(mappedChannel, blocks)`, and confirms the destination ephemerally. Error-status reports never leak `report.message`. No fan-out, no preview.
- `lib/commands/router.ts` — `CommandDeps` widened to `AddDeps & RemoveDeps & ListDeps & SetChannelDeps & GetDataDeps`; `case '/setchannel'` and `case '/getdata'` added; unsupported branch unchanged.

## Deviations from Plan

**1. [Rule 3 - Blocking] Renamed SetChannelDeps.writer -> channelWriter**
- Found during: Task 3 (router composition).
- Issue: the plan named the setchannel writer `writer`, but `AddDeps`/`RemoveDeps` already carry `writer: ActiveClientWriter`. In the `CommandDeps` intersection this collapses to `ActiveClientWriter & ChannelMapWriter`, which no existing fake satisfies — the router test and production wiring would fail typecheck.
- Fix: renamed the field to `channelWriter` (typed `ChannelMapWriter`) so the intersection composes cleanly with no `any`. Handler and tests updated.
- Commit: 2edfc39

## Humanization

Every Spanish reply string was humanized: neutral Spanish, no voseo, no em/en dashes (asserted by a regex test in setchannel.test.ts and getdata.test.ts), no secret interpolation.

## Standing blocker

No live Slack/GSC/Upstash. All tests use injected fakes (no real postMessage, no real Redis). E2e deferred to the credentials unblock.

## Self-Check: PASSED

- Files exist: lib/commands/setchannel.ts, lib/commands/getdata.ts (verified on disk).
- Commits exist: ae042eb, 992cd9b, ea80fa4, 6f53780, 2edfc39.
- `grep -E "case '/(setchannel|getdata)'" lib/commands/router.ts` returns both.
