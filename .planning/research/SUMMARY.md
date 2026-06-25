# Project Research Summary

**Project:** Client Rank Reporting — Slack GSC daily reporting bot
**Domain:** Vercel serverless Slack bot (slash commands + daily cron) reading Google Search Console
**Researched:** 2026-06-25
**Confidence:** HIGH

## Executive Summary

This is a single-agency internal tool: a Slack bot that posts a daily morning digest of Google Search Console metrics (impressions, clicks, CTR, average position) — one message per active client with day-over-day deltas — plus three slash commands (`/add`, `/remove`, `/list`) to manage which GSC properties are reported. The expert way to build this on Vercel is "thin handlers, shared services": two serverless entrypoints (a Slack Request-URL handler and a cron target) that both call the same stateless `lib/` modules for GSC access, Slack formatting, and KV persistence. There is no always-on process, no database beyond a single Redis set holding the active-client list, and no web UI — everything lives in Slack and all metrics are fetched on demand from GSC.

The recommended stack is the official `@slack/bolt@4` framework paired with the Vercel-native `@vercel/slack-bolt` receiver (which solves the 3-second-ack-on-serverless problem via Fluid Compute `waitUntil`), `googleapis` for GSC with Service Account JWT auth (per-property access, no domain-wide delegation), `@upstash/redis` for the active-client list (Vercel KV is deprecated), and Vercel Cron for the daily trigger. Note one important tension the architecture research surfaced: although Bolt is the stated framework, the three commands are trivially fast, so the safest serverless pattern is to do the work synchronously and fully `await` before responding rather than rely on Bolt's "ack-then-fire-and-forget" idiom, which silently dies when the instance freezes. Whichever path is chosen, signature verification must read the raw, unparsed request body.

The dominant risk profile is correctness-of-data and serverless-timing, not scale. The highest-value risk is the GSC data lag: querying a hardcoded "yesterday" returns empty or partial data and produces nonsense deltas, so the bot must query a trailing window and pick the latest two dates that actually returned data, comparing final-vs-final. The other critical risks are all well-documented and have clean mitigations: Vercel Cron is UTC-only (handle 9 AM local + DST inside the handler, not the cron string), the cron post must be idempotent (atomic `SET NX` key per day to prevent double-posts), Slack signature verification fails if the body is parsed before HMAC, and the Service Account private key newline escaping breaks on Vercel (base64-encode the whole JSON to sidestep it). Average position has inverted semantics (lower is better) — the single most error-prone formatting rule.

## Key Findings

### Recommended Stack

Official SDKs throughout, adapted for ephemeral serverless. The load-bearing choice is `@vercel/slack-bolt`, which makes Bolt work inside a single Web `Request` handler and keeps the function alive for background work after acking within Slack's 3-second deadline. GSC uses Service Account auth with per-property grants (the SA email must be added as a user on every property — an onboarding step per client). State is a single Redis set; everything else is fetched on demand. See STACK.md for full detail.

**Core technologies:**
- `@slack/bolt@4.7.3` + `@vercel/slack-bolt@1.5.1` — Slack framework + Vercel-native receiver — solves 3s-ack and signature verification on serverless
- `googleapis@173.0.0` — GSC `searchanalytics.query` + `sites.list` with Service Account JWT — official client, per-property auth, no domain-wide delegation
- `@upstash/redis@1.38.0` — persist active-client list across ephemeral invocations — HTTP/REST Redis, replaces deprecated Vercel KV
- Vercel Serverless Functions + Cron — HTTP endpoint for commands, daily UTC-scheduled push — no server to maintain

### Expected Features

The MVP is tightly defined and the scope is deliberately small. See FEATURES.md for the full landscape and Block Kit message format.

**Must have (table stakes):**
- Daily cron report, one message per active client, 4 metrics + % delta + direction emoji (position-inverted)
- "Last available day vs previous day" comparison handling the 2–3 day GSC lag — core correctness
- Date header showing which days are compared (trust given the lag)
- `/add` `/remove` `/list` with validation against `sites.list`, ephemeral confirmations, help on bad input
- Active client list in Upstash Redis; Slack signature verification; 3s ACK
- Empty/no-data handling (new property, weekend, lag)

**Should have (competitive):**
- Friendly client aliases mapped to GSC `siteUrl` (raw identifiers are ugly)
- Manual `/report` trigger (reuses daily code path)
- Permissions allowlist + change audit; top-movers summary line

**Defer (v2+):**
- Week-over-week / 7-day-avg comparison mode; threshold-based alerting; combined single-digest mode

**Explicit anti-features:** web dashboard, real-time/hourly updates, historical data warehouse, multi-workspace/multi-tenant, non-GSC metrics, Socket Mode.

### Architecture Approach

Two independent serverless entrypoints (`api/slack/command.ts`, `api/cron/daily-report.ts`) that share three framework-free service modules in `lib/`. Handlers do I/O orchestration; `lib/` does the work and is reused identically by both triggers. The trickiest business logic — last-available-day resolution and delta computation — is centralized in one `gsc.ts` module so `/list` and the cron job draw from one source of truth. See ARCHITECTURE.md for structure, patterns, and build order.

**Major components:**
1. `api/slack/command.ts` — verify HMAC on raw body, route `/add` `/remove` `/list`, reply synchronously (<3s)
2. `api/cron/daily-report.ts` — CRON_SECRET-guarded; load active clients, loop with per-client failure isolation, post one Block Kit message each
3. `lib/gsc.ts` — Service Account auth, `sites.list`, trailing-window query, last-available-day + delta logic (highest-risk module)
4. `lib/clients.ts` (Redis set), `lib/slack.ts` (Block Kit + chat.postMessage), `lib/verify.ts` + `lib/format.ts` (es-ES)

### Critical Pitfalls

1. **GSC lag / wrong comparison day** — never hardcode "yesterday"; query a trailing window, pick the latest two dates that returned data, compare final-vs-final with consistent `dataState`; guard divide-by-zero on previous=0 ("nuevo"/"—")
2. **Vercel Cron is UTC-only + DST** — don't encode 9 AM in the cron string; run more frequently and check "is it 9 AM in `REPORT_TZ` and have I not posted today?" inside the handler
3. **Duplicate daily posts** — atomic `SET NX` idempotency key `report:posted:<date>` with TTL so only one invocation posts; optional per-client keys for mid-run resume
4. **Slack signature verification on parsed body** — disable the body parser, verify HMAC over the raw `v0:timestamp:body`, enforce the 5-minute window, `timingSafeEqual`
5. **Service Account private key newline escaping breaks on Vercel** — base64-encode the entire SA JSON into one env var and decode at runtime; verify in a deployed preview, not just `vercel dev`
6. **sc-domain vs URL-prefix mismatch + SA not granted per property** — drive `/add` from canonical `sites.list` strings, store the exact `siteUrl`; add the SA email to every property (#1 cause of "0 rows")

## Implications for Roadmap

Build bottom-up: shared services first (both entrypoints depend on them), then the command trigger, then the cron orchestration. The natural first vertical slice is `/list` — it proves Slack signing, GSC auth, and KV wiring end-to-end before tackling the harder delta math and scheduling.

### Phase 1: Foundations + GSC auth + `/list` vertical slice
**Rationale:** Proves the three riskiest integration seams (Slack raw-body HMAC, GSC Service Account auth, Redis persistence) on the simplest possible path — one read, one reply, no delta math.
**Delivers:** Deployed Slack endpoint with verified signatures; GSC SA auth working in a deployed Vercel function; `lib/config`, `lib/verify`, `lib/clients` (Redis), `lib/gsc.listSites`; a working `/list` command.
**Addresses:** `/list`, KV persistence, signature verification (table stakes).
**Avoids:** Pitfalls 4 (signature on parsed body), 5 (private-key newline — use base64 JSON), 6 (per-property SA grant + exact siteUrl).

### Phase 2: Client management (`/add` `/remove`)
**Rationale:** Reuses Phase 1's verification and `sites.list`; completes the self-service management surface with minimal new risk.
**Delivers:** `/add` `/remove` with validation against `sites.list`, ephemeral confirmations and help, exact `siteUrl` stored in Redis.
**Uses:** `@upstash/redis`, `googleapis` `sites.list`.
**Implements:** `lib/clients.ts` mutations + `api/slack/command.ts` routing.
**Avoids:** Pitfall 6 (store canonical `siteUrl`, not free-form input); Pitfall 4 (Slack 3s — keep work synchronous and awaited).

### Phase 3: GSC metrics + delta computation (the correctness core)
**Rationale:** The highest-value correctness work; everything visual depends on it. Best built with unit tests before wiring any scheduling.
**Delivers:** `lib/gsc` trailing-window query, last-available-day resolution, per-metric % deltas (position inverted), CTR recomputed as clicks/impressions, zero-previous guards.
**Addresses:** Last-available-day comparison, no-data handling (table stakes).
**Avoids:** Pitfalls 1 (lag / dataState / divide-by-zero) and 2 (Pacific-time day boundaries) — write unit tests for date selection and delta math.

### Phase 4: Block Kit report + daily cron orchestration
**Rationale:** Composes everything; last because it depends on Phases 1–3.
**Delivers:** `lib/slack` Block Kit builder (es-ES, date header, position-aware arrows), `api/cron/daily-report.ts` with per-client failure isolation, `vercel.json` cron, CRON_SECRET guard, idempotency key.
**Addresses:** Daily report, date header, direction emoji, empty-state line (table stakes).
**Avoids:** Pitfalls 2 (cron UTC/DST — tz check in handler), 3 (duplicate posts — `SET NX`), and the cron-endpoint security gap.

### Phase 5 (post-validation): Aliases, manual `/report`, permissions/audit, top-movers
**Rationale:** Quality-of-life differentiators triggered by real usage; none block launch.
**Delivers:** Friendly aliases, on-demand `/report`, allowlist guardrail, top-movers TL;DR line.

### Phase Ordering Rationale
- Bottom-up matches the build-order dependency graph in ARCHITECTURE.md: `config`/`verify` → `clients` → `gsc` → `slack` → handlers → cron.
- `/list` first is the cheapest end-to-end proof of the three integration risks before the expensive delta logic.
- Delta math (Phase 3) is isolated and test-driven before it gets entangled with cron timing and Block Kit formatting, so correctness bugs surface in unit tests, not in the channel.
- Cron last because it is the only piece that composes all services and carries the idempotency/DST/security concerns together.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (GSC metrics):** GSC API method/scope names and `dataState`/`first_incomplete_date` behavior were MEDIUM confidence (training data) — verify against current `googleapis` types and a real property during planning.
- **Phase 1 (`@vercel/slack-bolt` vs raw handler):** decide Bolt-receiver vs raw-Vercel-function + WebClient; the raw-body/`dispatch_failed` interaction and the synchronous-vs-`waitUntil` tradeoff warrant a quick spike.

Phases with standard patterns (skip research-phase):
- **Phase 2 (`/add` `/remove`):** straightforward Redis CRUD + validation once Phase 1 exists.
- **Phase 4 Block Kit formatting:** Slack Block Kit is HIGH-confidence, well-documented.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified against npm; Vercel/Slack/Google integration behaviors from official docs |
| Features | HIGH | Slack slash-command UX, Block Kit, GSC freshness/`sites.list` all verified against official docs |
| Architecture | HIGH | Cron + ack patterns verified against current Vercel/Slack docs; GSC API surface MEDIUM (training data) |
| Pitfalls | HIGH | Slack/Vercel/GSC behaviors corroborated by official docs and multiple sources |

**Overall confidence:** HIGH

### Gaps to Address
- **Exact GSC `googleapis` method/scope names** (`searchconsole` vs `webmasters` v1): verify against installed package types early in Phase 3.
- **Vercel plan choice (Hobby vs Pro):** Hobby allows only one cron/day with ~1h imprecision; precise 9 AM + DST-safe hourly checks favor Pro. Confirm plan before finalizing the scheduling approach.
- **Bolt receiver vs raw handler:** resolve in Phase 1 spike; affects how the 3s-ack and signature verification are wired.
- **`dataState` choice (final vs all):** recommend `final` for a stable digest; confirm the agency accepts the ~2-day lag in exchange for non-changing numbers.

## Sources

### Primary (HIGH confidence)
- npm registry — verified current package versions (`@slack/bolt@4.7.3`, `@vercel/slack-bolt@1.5.1`, `googleapis@173.0.0`, `@upstash/redis@1.38.0`)
- Vercel docs — Cron Jobs (UTC-only, CRON_SECRET, plan limits), Redis/KV deprecation → Upstash, `@vercel/slack-bolt` changelog
- Slack docs — Verifying requests (v0 sig, raw body, 5-min window), Implementing slash commands (3s ack, response_url), Block Kit reference
- Google — Search Console API prerequisites, `Sites: list` (`permissionLevel`), Search Performance fresh-vs-final data (`dataState`, ~2-day lag)

### Secondary (MEDIUM confidence)
- vercel-labs/slack-bolt DeepWiki — raw-body / `dispatch_failed` signature pitfall
- Upstash blog — serverless Slackbot pattern reference
- bolt-python issues #335/#731 — deferred-work-after-ack failure on serverless; 3s timeout duplicate handling
- GSC reporting timezone is Pacific; Service Account private-key newline/PEM on Vercel (community threads)

### Tertiary (LOW confidence)
- GSC `searchanalytics.query`/`sites.list` exact method/scope names from `googleapis` (training data — verify against package types during Phase 3)

---
*Research completed: 2026-06-25*
*Ready for roadmap: yes*
