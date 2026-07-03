---
phase: 07-per-client-channel-routing-roster
reviewed: 2026-07-03T00:00:00Z
depth: deep
files_reviewed: 16
files_reviewed_list:
  - lib/channels.ts
  - lib/channels.test.ts
  - lib/schedule.ts
  - lib/schedule.test.ts
  - lib/config.ts
  - lib/config.test.ts
  - scripts/seed-roster.ts
  - scripts/seed-roster.test.ts
  - lib/commands/setchannel.ts
  - lib/commands/setchannel.test.ts
  - lib/commands/getdata.ts
  - lib/commands/getdata.test.ts
  - lib/commands/router.ts
  - lib/commands/router.test.ts
  - api/cron/daily-report.ts
  - api/cron/daily-report.test.ts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: resolved
resolved: 2026-07-03T00:00:00Z
resolution:
  fixed: [CR-01, WR-01, WR-02, WR-03, IN-01, IN-03]
  deferred: [IN-02]
  commits:
    WR-03: 291b398
    CR-01/WR-01/WR-02/IN-03: 878d145
    IN-01: 88f57bc
---

# Phase 7: Code Review Report

**Reviewed:** 2026-07-03
**Depth:** deep
**Files Reviewed:** 16
**Status:** resolved (CR-01, WR-01, WR-02, WR-03, IN-01, IN-03 fixed; IN-02 deferred)

## Summary

Reviewed the Phase 7 milestone (v1.1): per-client channel routing, the `isReportDow`
weekly gate, `reportDow` config, the roster seed, `/setchannel`, `/getdata`, router
widening, and the weekly cron rewire.

The core wiring is solid and matches the plan. Confirmed:

- **`isReportDow`** resolves the local weekday via `Intl` with a forced `en-US` locale
  and a `Sun=0…Sat=6` table; no JS-vs-ISO off-by-one, default Monday (1) on missing/invalid
  `REPORT_DOW`, DST-safe, same `Intl` mechanism as `isReportHour`. Correct.
- **Cron rewire**: 401 auth runs first, both hour AND weekday gates required, idempotency
  lock preserved and claimed only after the gates, `getAllChannels` + `getActiveClients`
  loaded once, per-client route to the mapped channel, unmapped client warn-skipped
  (siteUrl only) without aborting, `report.status === 'error'` skipped, per-client post
  failure isolated, `report.message`/token never leaked, `SLACK_CHANNEL_ID` no longer the
  destination, returns `{posted, skippedUnmapped, dateKey}`. Correct.
- **`/setchannel`** validates the channel mention shape AND active-set membership before
  persisting, stores the `C…` id (never the `#name`), humanized secret-free replies.
- **channels.ts** uses the correct HASH key, `hgetall` → full Map, canonical siteUrl as
  field, injectable surfaces.
- **seed-roster** ROSTER is exactly the 4 hosts with nicmafia absent; SADD-based; no
  channel preload.
- **v1.0 daily core unchanged**: `git diff` shows `lib/report.ts` and `lib/metrics.ts`
  untouched, and `buildClientReportBlocks` (blocks.ts:82-101) is intact.

The defects below are concentrated in `/getdata`: a Slack 3-second-ack violation, a hard-rule
em-dash in user-facing copy that the test suite misses, and a misleading confirmation on
empty-data reports.

## Critical Issues

### CR-01: `/getdata` runs heavy synchronous GSC work in the Slack request path — breaks the 3-second ack

**File:** `api/slack/command.ts:55-59`, `lib/commands/getdata.ts:61-69`
**Issue:** `api/slack/command.ts` awaits `dispatch(...)` fully before responding, with no
early-ack / `waitUntil` background pattern. For `/getdata`, `dispatch` runs
`getWeeklyClientReport` (a 21-day `fetchDailyMetrics` call plus two `fetchPageClicks` queries)
AND a `chat.postMessage` before the handler returns. That is up to five sequential network
round-trips inside the request. Slack's slash-command ack deadline is 3 seconds
(CLAUDE.md: "ack within Slack's 3-second deadline while work continues in the background";
"The 3-second ack rule"), while `vercel.json` sets `maxDuration: 10`. The function will
commonly finish (and post) after Slack has already shown `operation_timeout` to the invoker,
so the ephemeral "Listo, publiqué…" confirmation — the command's stated contract — never
reaches the user. Worse, a user who reads the timeout as failure and re-runs `/getdata`
triggers a second real post to the client's channel (no dedup on this path).

The existing fast commands (`/add`, `/remove`, `/list`) respect the 3s budget; `/getdata`
is the first command to put GSC fetch + a proactive post on the synchronous path.

**Fix:** Ack immediately and do the fetch+post in the background. On Vercel Fluid Compute,
schedule the work with `waitUntil` and return the ephemeral confirmation up front, or split
`/getdata` so it acks ("Estoy armando el reporte de X, lo publico en su canal en unos
segundos.") and posts asynchronously:
```ts
// api/slack/command.ts (sketch)
import { waitUntil } from '@vercel/functions';
// ...
if (command === '/getdata') {
  waitUntil(dispatch(command, text)); // fire-and-forget the fetch+post
  return ephemeral('Estoy armando el reporte y lo publico en el canal del cliente.');
}
return ephemeral(await dispatch(command, text)); // fast commands stay inline
```
Alternatively adopt the `@vercel/slack-bolt` receiver (already the recommended stack in
CLAUDE.md) so ack/`waitUntil` is handled for you.

## Warnings

### WR-01: Em dash in user-facing Spanish copy violates the humanization hard rule (and the test misses it)

**File:** `lib/commands/getdata.ts:38`
**Issue:** The usage hint uses an em dash in prose the bot replies to a user:
`'Uso: \`/getdata <cliente>\` — por ejemplo \`/getdata deltacloudz.com\`.'`. The project hard
rule forbids em/en dashes in any string the bot posts or replies (CLAUDE.md humanizer rule;
07-CONTEXT decision "no em/en dashes in prose"). The `/getdata` test only asserts
`not.toMatch(/[—–]/)` on the happy-path reply (getdata.test.ts:107); it never checks the
usage-hint reply, so the violation ships green. (`setchannel.ts` correctly uses no dashes and
its test checks all four replies — mirror that.)
**Fix:** Replace the em dash with a period or "por ejemplo" without a dash, and extend the
dash assertion to every reply branch:
```ts
return 'Uso: `/getdata <cliente>`. Por ejemplo `/getdata deltacloudz.com`.';
```

### WR-02: `/getdata` on empty-data reports posts a "faltan datos" notice yet claims it published the report

**File:** `lib/commands/getdata.ts:61-69`
**Issue:** The handler only special-cases `report.status === 'error'`. For `no_data` and
`insufficient_data` it falls through, calls `buildWeeklyClientReportBlocks` (which renders
"aún faltan datos para armar el reporte semanal"), posts THAT to the client's live channel,
and replies "Listo, publiqué el reporte semanal de *X* en su canal." The router test confirms
this: a `no_data` report yields one real post (router.test.ts:76-83). So an on-demand
`/getdata` for a data-starved property spams the client channel with a no-data card and tells
the operator a report was published. Misleading confirmation plus channel noise on a live
client channel.
**Fix:** Branch on the non-`ok` statuses before posting; reply ephemerally to the invoker
instead of posting to the client channel:
```ts
if (report.status !== 'ok') {
  return `*${siteUrl}* todavía no tiene datos suficientes para un reporte semanal. No publiqué nada en su canal.`;
}
```

### WR-03: Cron claims the weekly lock before the Redis map/set load — a load failure loses the whole week's report

**File:** `api/cron/daily-report.ts:69-81`
**Issue:** `claimLock(dateKey)` is awaited (line 69) before `getChannels()` and `getActive()`
(lines 80-81). Those two calls are new to the rewired cron and are not guarded. If either
Redis read throws, the handler rejects and returns a 500 — but the idempotency key is already
written with a 36h TTL (`report-lock.ts:19`). Since the hour+dow gate only opens once per week,
no later invocation that day passes the gate, and a manual re-trigger is blocked by the held
lock, so the week's report is silently dropped until the next scheduled day.
**Fix:** Load the map and set before claiming the lock, or release/skip the lock on a load
failure. Simplest is to move the two reads above the claim:
```ts
const channels = await getChannels();
const clients = await getActive();
if (!(await claimLock(dateKey))) {
  return Response.json({ skipped: 'already-posted', dateKey });
}
```

## Info

### IN-01: The "idempotent" seed test does not actually exercise idempotency

**File:** `scripts/seed-roster.test.ts:59-63`
**Issue:** The test named "is idempotent — re-running against an already-present set does not
throw" injects `fakeWriter(0)` and asserts only that `seedRoster` resolves and issues
`ROSTER.length` SADDs. `seedRoster` calls `addClient` per entry regardless of the SADD return
value, and the fake never throws, so the assertion is near-tautological — it proves the loop
runs, not that re-seeding is safe (SADD idempotency is a Redis property the offline fake cannot
demonstrate). The name overclaims what is verified.
**Fix:** Either rename to reflect what is checked ("issues one SADD per entry regardless of
prior membership") or assert the returned boolean is tolerated (e.g. that a `0` result does not
change the number/order of calls versus a `1` result).

### IN-02: Roster siteUrls are unverified `sc-domain:` guesses; a URL-prefix-only property silently yields no data

**File:** `scripts/seed-roster.ts:28-34`
**Issue:** All four entries assume the `sc-domain:<host>` canonical form. The file's own caveat
notes some properties may exist in GSC only as `https://<host>/` URL-prefix entries. If seeded
wrong, `getWeeklyClientReport` fetches against a siteUrl GSC does not recognize and the weekly
report degrades to `no_data`/`error` for that client with no obvious signal. Documented and
deferred to the live run, so not a code defect — flagged so it is verified against `sites.list`
before seeding.
**Fix:** Before the live seed, confirm each canonical string via `sites.list` and adjust any
URL-prefix-only property.

### IN-03: `/getdata` usage-hint reply is outside the em/en-dash test coverage

**File:** `lib/commands/getdata.test.ts:107`
**Issue:** The only dash assertion runs on the happy-path reply. Every user-facing branch
(usage hint, unknown client, unmapped, error) should be dash-checked the way
`setchannel.test.ts:78-88` checks all four of its replies. This gap is what let WR-01 through.
**Fix:** Add a case that asserts `not.toMatch(/[—–]/)` across all `handleGetData` reply
branches.

---

_Reviewed: 2026-07-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
