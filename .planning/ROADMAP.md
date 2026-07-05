# Roadmap: Client Rank Reporting — Slack GSC Bot

## Overview

The bot is built bottom-up as four vertical slices that match the dependency graph: shared services first, then the command surface, then the correctness-critical delta math, then the composed daily push. Phase 1 proves the three riskiest integration seams (Slack raw-body HMAC, GSC Service Account auth, Redis persistence) on the cheapest end-to-end path — `/list`. Phase 2 completes self-service client management. Phase 3 isolates the highest-value correctness work (last-available-day resolution and per-metric deltas) behind unit tests. Phase 4 composes everything into the Block Kit report and the idempotent, DST-safe daily cron. The result: every morning the team sees, without opening GSC, how each client moved day over day in Slack.

**Milestone v1.1 (Weekly Per-Client Reports):** Extends the existing report pipeline — it does NOT rebuild it. The v1.0 daily cron, Search Analytics client, delta core and Block Kit builder are reused; v1.1 hangs a weekly window (7d vs 7d), a per-URL `page`-dimension query, week-over-week deltas, top-mover URL lists, richer formatting, and per-client channel routing off those existing seams. Phases 5→7 continue numbering (v1.0 ended at Phase 4) and deliver: the weekly data layer, the composed weekly Block Kit report, and per-client channel routing with the initial roster.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

### Milestone v1.0 (complete)

- [ ] **Phase 1: Foundations + GSC Auth + `/list` Slice** - Deployed, signature-verified Slack endpoint that lists GSC properties via Service Account auth, with the active-client list persisted in Redis
- [x] **Phase 2: Client Management** - `/add` and `/remove` manage the active-client list with validation against `sites.list` and clear errors (completed 2026-06-25)
- [x] **Phase 3: GSC Metrics + Delta Computation** - Last-available-day resolution and per-metric % deltas (position inverted) with safe no-data handling (completed 2026-06-25)
- [x] **Phase 4: Block Kit Report + Daily Cron** - One Block Kit message per client posted automatically each morning, idempotent and tz-correct, on a secured cron (code complete 2026-06-26; live deploy/e2e credential-gated)

### Milestone v1.1 (Weekly Per-Client Reports)

- [x] **Phase 5: Weekly Window + Per-URL Metrics** - The weekly data layer: resolve last-7d-vs-prior-7d anchored to the last available GSC day, query per-URL clicks via the `page` dimension, and compute week-over-week % deltas (completed 2026-07-03)
- [x] **Phase 6: Weekly Client Report (Block Kit)** - A per-client weekly Block Kit report showing traffic + clicks + CTR + position WoW plus the top 3 rising and top 3 dropping URLs by clicks, with readable number formatting (completed 2026-07-03)
- [x] **Phase 7: Per-Client Channel Routing + Roster** - Each client's report posts to its own mapped Slack channel (Redis map, set by command); unmapped clients are skipped with a clear notice, and the initial roster is loaded (completed 2026-07-03)

## Phase Details

### Phase 1: Foundations + GSC Auth + `/list` Slice

**Goal**: A deployed Slack endpoint that authenticates to GSC with a Service Account, verifies Slack signatures on the raw body, lists readable GSC properties via `/list`, and persists the active-client list in Redis.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: GSC-01, GSC-02, CMD-03, CMD-05, PER-01, SCH-03
**Success Criteria** (what must be TRUE):

  1. The deployed Slack endpoint accepts valid requests and rejects ones whose HMAC signature (verified over the raw, unparsed body within the 5-minute window) is invalid
  2. Running `/list` in Slack returns the GSC properties the Service Account can read, with `siteUnverifiedUser` properties filtered out
  3. The active-client list is written to and read from Upstash Redis and survives across separate serverless invocations
  4. All sensitive config (base64 Service Account JSON, Slack tokens, destination channel, `REPORT_TZ`) is loaded from environment variables, with nothing hardcoded

**Plans**: 3 plans

Plans:

- [x] 01-01-PLAN.md — Provisioning (Slack App, GCP SA, Upstash) + scaffold TS/Vercel + lib/config.ts + npm install gate
- [x] 01-02-PLAN.md — Servicios compartidos con tests: verify.ts (HMAC), gsc.ts (sites.list + filtro), clients.ts (read Redis)
- [~] 01-03-PLAN.md — Handler /list + deploy a preview + seed Redis + verificación end-to-end
  - [x] Task 1 — `api/slack/command.ts` (handler /list) + README (committed 7f8da87, typecheck + tests pasan)
  - [ ] Task 2 — Deploy a preview de Vercel + seed `clients:active` + e2e de /list (checkpoint:human-verify, BLOQUEADO: faltan Slack signing secret, Upstash REST URL/token y la SA concedida en una propiedad GSC)

### Phase 2: Client Management

**Goal**: Self-service management of which GSC properties are reported, via `/add` and `/remove`, validated against the live `sites.list` and storing canonical `siteUrl` values.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: CMD-01, CMD-02, CMD-04
**Success Criteria** (what must be TRUE):

  1. `/add <cliente>` adds a valid GSC property to the active-client list and confirms with an ephemeral message
  2. `/remove <cliente>` removes a property from the active-client list and confirms
  3. Invalid input (nonexistent property, already added, not in the list) returns a clear error message instead of failing silently
  4. The value persisted to Redis is the canonical `siteUrl` returned by `sites.list`, not free-form user text

**Plans**: 3 plans

Plans:

- [x] 02-01-PLAN.md — Fundamento: site-match (normalizeSiteRef + resolveSiteRef) + clients add/remove con tests (wave 1)
- [x] 02-02-PLAN.md — Handlers de comando: lib/commands/add.ts + remove.ts con tests (wave 2)
- [x] 02-03-PLAN.md — Dispatcher: mover /list a lib/commands/list.ts + router + refactor del shell api/slack/command.ts (wave 3)

### Phase 3: GSC Metrics + Delta Computation

**Goal**: The correctness core — query Search Analytics, resolve the last day with available data via a trailing window, and compute per-metric % deltas (position inverted) with safe handling of missing/partial data.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: GSC-03, GSC-04, RPT-01, RPT-04
**Success Criteria** (what must be TRUE):

  1. The bot fetches impresiones, clics, CTR and posición media for a property over a date range from Search Analytics
  2. The bot resolves the "last available day vs previous comparable day" by scanning a trailing window (never a hardcoded date), absorbing the 2-3 day GSC lag
  3. For each metric the bot computes the % variation of the last available day vs the previous day, with average position treated as inverted (lower is better) and divide-by-zero guarded
  4. Properties with no data / new / partial data yield a clear "sin datos" result instead of an error or nonsense delta

**Plans**: 3 plans

Plans:

- [x] 03-01-PLAN.md — Pure delta core: DailyMetricRow type + resolveComparablePair (GSC-04) + computeDeltas (RPT-01) with unit tests (wave 1)
- [x] 03-02-PLAN.md — lib/gsc.ts fetchDailyMetrics over a trailing window (GSC-03), injectable query, unit-tested with a mock (wave 2)
- [x] 03-03-PLAN.md — lib/report.ts getClientReport discriminated union + safe no-data/error handling (RPT-04), injected fetcher (wave 3)

### Phase 4: Block Kit Report + Daily Cron

**Goal**: Compose the services into a daily report — one Block Kit message per active client with deltas and direction indicators — pushed automatically each morning by a secured, idempotent, tz-correct Vercel cron.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: RPT-02, RPT-03, PER-02, SCH-01, SCH-02
**Success Criteria** (what must be TRUE):

  1. Each morning at 9:00 in `REPORT_TZ` (handling Vercel Cron's UTC-only schedule and DST inside the handler) a report posts to the channel, one Block Kit message per active client
  2. Each message shows impresiones, clics, CTR and posición media with their % deltas and a direction arrow/emoji, with the indicator inverted for average position
  3. The report carries a date header stating which two days are being compared
  4. Reruns or retries do not produce a duplicate daily post (atomic `SET NX` idempotency key with TTL)
  5. The cron endpoint rejects any external trigger lacking the correct `CRON_SECRET`

**Plans**: 3 plans

Plans:

- [x] 04-01-PLAN.md — Config (SLACK_BOT_TOKEN, CRON_SECRET, REPORT_HOUR) + buildClientReportBlocks puro con dirección invertida y casos sin datos (RPT-02, RPT-03)
- [x] 04-02-PLAN.md — Primitivas del cron: isReportHour/reportDateKey DST-safe, isAuthorizedCron, claimDailyReport (SCH-01, SCH-02, PER-02)
- [x] 04-03-PLAN.md — postMessage proactivo + handler api/cron/daily-report.ts + vercel.json crons hourly (RPT-03, SCH-01, SCH-02, PER-02)

### Phase 5: Weekly Window + Per-URL Metrics

**Goal**: Extend the existing GSC data layer to a weekly model — resolve the "last 7 days with data vs the prior 7 days" window anchored to the last available GSC day, query per-URL clicks via the `page` dimension, and compute week-over-week % deltas per metric. This is the correctness core of v1.1; it reuses the v1.0 Search Analytics client and delta primitives rather than replacing them.
**Mode:** mvp
**Depends on**: Phase 4 (reuses `lib/gsc.ts` Search Analytics fetch and the Phase 3 delta core)
**Requirements**: GSC-05, GSC-06, RPT-05
**Success Criteria** (what must be TRUE):

  1. Given a property, the bot resolves a weekly comparison window as the last 7 days that have GSC data versus the 7 days immediately before them, anchored to the last available day (never a hardcoded date), absorbing the 2-3 day lag
  2. The bot queries Search Analytics with the `page` dimension and returns per-URL clicks for a property over a given date window
  3. For each metric (impresiones, clics, CTR, posición media) the bot computes the week-over-week % variation of the current 7-day window vs the prior comparable 7-day window, with position inverted and divide-by-zero guarded
  4. A property with no data / partial data over the window yields a clear "sin datos" result instead of an error or nonsense delta

**Plans**: 2 plans

Plans:

- [x] 05-01-PLAN.md — lib/weekly.ts puro: resolveWeeklyWindow (GSC-05), aggregateWeek (SUM/CTR/posición ponderada), computeWeeklyDeltas (RPT-05, reuso de metrics.ts) y rankUrlClickDeltas per-URL (wave 1)
- [x] 05-02-PLAN.md — lib/gsc.ts fetchPageClicks: clics por URL vía dimensión page, rowLimit 250, dataState final, inyectable y testeado offline (GSC-06) (wave 1)

### Phase 6: Weekly Client Report (Block Kit)

**Goal**: Compose the weekly data layer into the per-client report — extend the existing Block Kit builder so each client's message shows traffic (impressions) and clicks WoW plus CTR and average position with weekly deltas, and appends the top 3 URLs that rose most and the top 3 that dropped most in clicks, all with readable number/URL formatting.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: RPT-07, RPT-08, RPT-09, RPT-10
**Success Criteria** (what must be TRUE):

  1. Each client's report shows tráfico (impresiones) and clics week-over-week plus CTR and posición media, each with its weekly delta and a direction indicator (inverted for position)
  2. The report lists the top 3 URLs that rose the most in clicks week-over-week for that client
  3. The report lists the top 3 URLs that dropped the most in clicks week-over-week for that client
  4. Numbers and messages render readably in Block Kit (thousands separators, rounded percentages and position, trimmed/shortened URLs) without overflowing or breaking layout

**Plans**: 2 plans

Plans:

- [x] 06-01-PLAN.md — lib/weekly-report.ts: getWeeklyClientReport(siteUrl, deps?) orquestador discriminado (ok/insufficient_data/no_data/error), never-throwing y secret-free, fetchers inyectables; produce deltas WoW + lista rankeada de URLs (RPT-07/08/09) (wave 1)
- [x] 06-02-PLAN.md — buildWeeklyClientReportBlocks en lib/slack/blocks.ts: métricas WoW + Top 3 subidas/bajadas, formato es-ES/CTR 2 dec/posición/URLs truncadas (RPT-10), degradación amable, copy humanizada; builder diario intacto (wave 2) (RPT-07/08/09/10)

### Phase 7: Per-Client Channel Routing + Roster

**Goal**: Route each client's weekly report to its own Slack channel instead of a single shared channel — persist a client→channel map in Redis, expose a Slack command to set/update a client's destination channel, make the cron post each client's report to its mapped channel (skipping unmapped clients with a clear notice without breaking the run), and load the initial client roster.
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: CH-01, CH-02, CH-03, CFG-01
**Success Criteria** (what must be TRUE):

  1. The bot persists a map of client (GSC property) → destination Slack channel in Redis that survives across serverless invocations
  2. A Slack command sets or updates the destination channel for a given client, confirming the change
  3. The weekly run posts each client's report to its mapped channel; a client with no channel assigned is skipped with a clear notice and the rest of the run continues uninterrupted
  4. The initial roster (deltacloudz.com, felipevergara.co, childrenchic.com, fhcaorlando.com; nicmafia removed) is loaded as active clients

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundations + GSC Auth + `/list` Slice | 2/3 (01-03 Task 1 done; Task 2 e2e awaiting human creds) | In Progress|  |
| 2. Client Management | 3/3 | Complete   | 2026-06-25 |
| 3. GSC Metrics + Delta Computation | 3/3 | Complete   | 2026-06-25 |
| 4. Block Kit Report + Daily Cron | 3/3 | Complete (code; live e2e credential-gated) | 2026-06-26 |
| 5. Weekly Window + Per-URL Metrics | 2/2 | Complete   | 2026-07-03 |
| 6. Weekly Client Report (Block Kit) | 2/2 | Complete   | 2026-07-03 |
| 7. Per-Client Channel Routing + Roster | 3/3 | Complete   | 2026-07-03 |
