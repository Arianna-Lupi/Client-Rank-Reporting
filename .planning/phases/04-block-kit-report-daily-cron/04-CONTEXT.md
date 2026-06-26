# Phase 4: Block Kit Report + Daily Cron - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning
**Mode:** Decisions locked by Claude (delegated by Juan; code-ahead — final phase code; live deploy/e2e gated on Slack credentials)

<domain>
## Phase Boundary

Compose the existing services into the daily report: one Block Kit message per active client with deltas and direction indicators, pushed automatically each morning by a secured, idempotent, timezone-correct Vercel cron. Code + unit tests only this round; live posting needs a Slack bot token + deploy (pending). Consumes `getClientReport` (Phase 3), `getActiveClients` (Phase 1/2).

</domain>

<decisions>
## Implementation Decisions

### Block Kit message builder (RPT-02, RPT-03)
- Pure function `buildClientReportBlocks(siteUrl, report)` in `lib/slack/blocks.ts` → Block Kit blocks for ONE client (RPT-03 = one message per client).
  - Header block: the canonical siteUrl + the report date.
  - One line per metric (impresiones, clics, CTR, posición): value + direction indicator + deltaPct.
  - **Direction indicator (RPT-02)** driven by the `improved` boolean already computed in Phase 3 (position inversion is baked in there): `improved === true` → 🟢 ▲, `false` → 🔴 ▼, `deltaPct === null`/`isNew` → 🆕 "nuevo". CTR shown as %, position with 1 decimal.
  - `status: 'insufficient_data'` / `'no_data'` → a single friendly Spanish context block ("sin datos suficientes todavía"), never an error.
  - `status: 'error'` → the cron logs and skips that client (does not abort the whole run); no secret leakage.

### Proactive posting (RPT-03)
- `lib/slack/post.ts` `postMessage(channel, blocks)` → `fetch('https://slack.com/api/chat.postMessage')` with `Authorization: Bearer ${SLACK_BOT_TOKEN}` (NEW env var; proactive posts need a bot token, not the signing secret). No Slack SDK (consistent with project decision). Checks the `ok` field in the response and surfaces Slack API errors.

### Daily cron (SCH-01)
- `api/cron/daily-report.ts` — Vercel cron entrypoint. `vercel.json` schedules it **hourly** (`0 * * * *`) because Vercel Cron only runs in UTC with no per-job timezone.
- Pure `isReportHour(now, tz, hour)` using `Intl.DateTimeFormat` with `timeZone` (handles DST, no extra deps) → true only when the current hour in `REPORT_TZ` equals `REPORT_HOUR` (default 9). The hourly cron no-ops every other hour.
- On the matching hour: iterate `getActiveClients()` → for each, `getClientReport(siteUrl)` → `buildClientReportBlocks` → `postMessage(SLACK_CHANNEL_ID, blocks)`.

### Cron security (SCH-02)
- The endpoint rejects unauthenticated calls: require `Authorization: Bearer ${CRON_SECRET}` (NEW env var). Vercel Cron sends this header when `CRON_SECRET` is set. Non-matching → 401, no work done. Pure `isAuthorizedCron(headers, secret)` helper, unit-tested.

### Idempotency (PER-02)
- Before posting, claim a per-day lock in Redis: `SET report:posted:<YYYY-MM-DD-in-REPORT_TZ> 1 NX EX <~129600>` (36 h TTL). If the key already existed (claim fails) → skip the whole run (prevents duplicate daily posts from cron retries / multiple invocations within the 9:00 hour). Extend `lib/clients.ts` or a new `lib/report-lock.ts` with `claimDailyReport(dateKey)` using `set(key, '1', { nx: true, ex: ... })`, injectable for tests.

### Config
- `lib/config.ts` gains `SLACK_BOT_TOKEN`, `CRON_SECRET`, and `REPORT_HOUR` (default 9). `.env.example` documents all of them. `REPORT_TZ` already exists (default America/Mexico_City).

### Testability
- Pure/unit-tested: `buildClientReportBlocks` (every status + each direction case), `isReportHour` (matching/non-matching hour, DST boundary, injected `now`), `isAuthorizedCron` (valid/invalid/missing), `claimDailyReport` (first claim true / second false, injected redis). `postMessage` and the cron handler isolate I/O behind injected deps so the orchestration is testable without live Slack/Redis.
- `npm test` + `npm run typecheck` must pass.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/report.ts` `getClientReport(siteUrl)` (Phase 3) — discriminated union the builder renders.
- `lib/clients.ts` `getActiveClients()` (Phase 1/2) — the iteration source.
- `lib/config.ts` — extend with the 3 new env vars.
- Injectable-dependency test pattern from Phases 1-3.

### Established Patterns
- Thin handlers in `api/`, pure logic + DI in `lib/`, discriminated unions over throwing, Web-standard handlers, no Slack SDK, `@upstash/redis` for state.

### Integration Points
- `api/cron/daily-report.ts` (new) → `lib/slack/{blocks,post}.ts`, `lib/report-lock.ts`, `lib/report.ts`, `lib/clients.ts`, `lib/config.ts`.
- `vercel.json` gains a `crons` entry.
</code_context>

<specifics>
## Specific Ideas

- Report in Spanish. Metric labels: Impresiones, Clics, CTR, Posición.
- Real validation earlier showed the `isNew` (clicks 0→1) and position-improvement cases occur in live data — the builder must render both cleanly.
- Vercel Hobby cron runs once/day within an hour window; the hourly+tz-check pattern works on Hobby but the report may fire any minute within the 9:00 hour. Pro gives tighter timing. Plan decision deferred — does not affect code.

## NEW human dependencies (for deploy, not code)
- `SLACK_BOT_TOKEN` (xoxb-…) with `chat:write` scope — ask Arianna alongside the signing secret.
- `CRON_SECRET` — generate any random string, set in Vercel env (Vercel auto-sends it to cron invocations).
</specifics>

<deferred>
## Deferred Ideas

- `/report` on-demand command (CMD-07), top-movers summary (RPT-06), 7d-vs-7d mode (RPT-05) → v2.
- Live deploy + e2e cron verification → human checkpoint (needs bot token + deploy).
</deferred>
