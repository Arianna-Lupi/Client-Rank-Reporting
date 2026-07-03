# Phase 7: Per-Client Channel Routing + Roster - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Route each client's weekly report to its own Slack channel and ship the milestone (CH-01, CH-02, CH-03, CFG-01, plus CMD-09 and SCH-04 added during discuss). Deliver:
- A Redis client→channel map with a set/update command.
- A weekly-cadence cron that posts each client's weekly report to its mapped channel, skipping unmapped clients without breaking the run.
- An on-demand `/getdata <cliente>` command.
- An idempotent roster seed script.

This is the composition/integration phase: it wires the Phase 5 data layer and Phase 6 report/builder into the live cron and commands. It supersedes the v1.0 single-channel daily posting path.

</domain>

<decisions>
## Implementation Decisions

### Channel Map Storage (CH-01)
- Redis HASH `clients:channels`: field = canonical siteUrl, value = Slack channel ID (`C…`).
- New module `lib/channels.ts`, injectable reader/writer surfaces mirroring `lib/clients.ts` (lazy `Redis.fromEnv`, DI for offline tests).
- Store the resolved channel ID, not the `#name`.
- Cron reads the whole map once via `hgetall`.

### Set-Channel Command (CH-02)
- Command `/setchannel <cliente> <#canal>`.
- Slack sends both the channel id and name in the command payload; persist the id.
- Validate: client must be in the active set, and the channel argument must be a well-formed channel reference. Clear, humanized Spanish error otherwise.
- v1.1 only ASSIGNS; unassigning/clearing is deferred to v2 (unmapped clients are handled by skip-with-log).

### On-Demand Report (CMD-09) — `/getdata`
- `/getdata <cliente>` posts THAT client's weekly report to ITS mapped channel (real post via chat.postMessage), on demand.
- Ephemeral reply to the invoker confirming the destination channel, or a clear humanized error if the client is unknown/inactive or has no mapped channel.
- Reuses `getWeeklyClientReport` + `buildWeeklyClientReportBlocks` (Phase 6). Does NOT post ephemeral previews and does NOT fan out to all clients.

### Cron Cadence + Routing (SCH-04, CH-03)
- Cadence is WEEKLY. The existing hourly cron (`0 * * * *`) additionally gates on day-of-week: run only when local weekday in REPORT_TZ equals `REPORT_DOW` (default Monday) AND local hour equals `REPORT_HOUR` (default 9). Extend `lib/schedule.ts` with the DOW gate.
- The cron switches to the weekly report: `getWeeklyClientReport` + `buildWeeklyClientReportBlocks` replace the daily `getClientReport` + `buildClientReportBlocks` in the posting path.
- Per-client routing: for each active client, look up its mapped channel and post there. A client with NO mapped channel is skipped with a `console.warn` (siteUrl only, no secrets) and does NOT abort the run.
- The v1.0 single `SLACK_CHANNEL_ID` posting path is SUPERSEDED — routing is 100% via the map. Keep the env var defined (config) but it is no longer the posting destination; note the v1.0 daily path is retired, not left dangling.
- Idempotency lock key stays per-run (now effectively per-week via the date key); keep the existing `claimDailyReport` mechanism, keyed on the run's date.

### Roster Seed (CFG-01)
- Idempotent script `scripts/seed-roster.ts` (SADD to the active set), run manually once live Upstash creds exist.
- Roster: deltacloudz.com, felipevergara.co, childrenchic.com, fhcaorlando.com. nicmafia is NOT included.
- childrenchic.com is seeded as-is with a rename note pending Arianna's new domain.
- Seed loads only the active-client SET; channel mappings are set afterward via `/setchannel` (seed does not preload channels).
- siteUrls are resolved to their canonical GSC form (`sc-domain:` or URL-prefix) — the script resolves against `sites.list` or documents the exact canonical strings to seed.

### Copy
- Every Spanish string the bot posts or replies (command confirmations, errors, skip notices that reach a user) MUST be humanized (hard rule) — no AI tells, no em/en dashes in prose, natural neutral voice, no voseo.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/clients.ts`: the exact pattern for `lib/channels.ts` (ACTIVE_KEY const, injectable Reader/Writer, lazy getRedis, canonical-siteUrl contract).
- `lib/weekly-report.ts` (Phase 6): `getWeeklyClientReport`. `lib/slack/blocks.ts`: `buildWeeklyClientReportBlocks`.
- `lib/slack/post.ts`: `postMessage(channelId, blocks)` via chat.postMessage — already channel-parameterized, so per-channel routing is a lookup + existing call.
- `lib/commands/router.ts` + `lib/commands/{add,remove,list}.ts`: the command handler + `CommandDeps` + `dispatch` switch pattern to extend for `/setchannel` and `/getdata`.
- `lib/schedule.ts`: `isReportHour`, `reportDateKey` — extend with a day-of-week gate.
- `api/cron/daily-report.ts`: the cron handler to rewire (auth → hour+dow gate → lock → per-client route+post).
- `lib/config.ts`: `getConfig()` fail-fast env; add `reportDow` (and keep `slackChannelId` for now).

### Established Patterns
- All persistence behind injectable interfaces; offline vitest with fakes; no live network in tests.
- Canonical siteUrl resolved against an authoritative list before writing; raw user text never persisted.
- Security (ASVS V7): never log the bot token, cron secret, or report.message; per-client failures isolated, generic log lines.
- Spanish, secret-free, humanized copy.

### Integration Points
- `/setchannel` and `/getdata` join the existing `dispatch` switch and `CommandDeps`.
- The cron composes channels map + active clients + weekly report + post.
- `scripts/` is a new dir; the seed is a standalone runnable, not part of the request path.

</code_context>

<specifics>
## Specific Ideas

- Juan explicitly requested `/getdata`: it must send that client's data to that client's channel (not an ephemeral-to-me preview, not a fan-out).
- Weekly cadence default is Monday 09:00 in REPORT_TZ; both `REPORT_DOW` and `REPORT_HOUR` are configurable.
- Unmapped client during the cron = quiet skip + warn log, no Slack spam.

</specifics>

<deferred>
## Deferred Ideas

- `/setchannel <cliente> off` to clear a mapping — v2.
- Posting an unmapped-client notice to an admin/fallback channel — v2 (v1.1 just warns).
- Cross-client top-movers digest (RPT-06) — v2.
- Allowlist/audit for who can run commands (CMD-08) — v2.
</deferred>
