# Roadmap: Client Rank Reporting — Slack GSC Bot

## Overview

The bot is built bottom-up as four vertical slices that match the dependency graph: shared services first, then the command surface, then the correctness-critical delta math, then the composed daily push. Phase 1 proves the three riskiest integration seams (Slack raw-body HMAC, GSC Service Account auth, Redis persistence) on the cheapest end-to-end path — `/list`. Phase 2 completes self-service client management. Phase 3 isolates the highest-value correctness work (last-available-day resolution and per-metric deltas) behind unit tests. Phase 4 composes everything into the Block Kit report and the idempotent, DST-safe daily cron. The result: every morning the team sees, without opening GSC, how each client moved day over day in Slack.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundations + GSC Auth + `/list` Slice** - Deployed, signature-verified Slack endpoint that lists GSC properties via Service Account auth, with the active-client list persisted in Redis
- [x] **Phase 2: Client Management** - `/add` and `/remove` manage the active-client list with validation against `sites.list` and clear errors (completed 2026-06-25)
- [ ] **Phase 3: GSC Metrics + Delta Computation** - Last-available-day resolution and per-metric % deltas (position inverted) with safe no-data handling
- [ ] **Phase 4: Block Kit Report + Daily Cron** - One Block Kit message per client posted automatically each morning, idempotent and tz-correct, on a secured cron

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

**Plans**: TBD

Plans:

- [ ] 03-01: TBD

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

**Plans**: TBD

Plans:

- [ ] 04-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundations + GSC Auth + `/list` Slice | 2/3 (01-03 Task 1 done; Task 2 e2e awaiting human creds) | In Progress|  |
| 2. Client Management | 3/3 | Complete   | 2026-06-25 |
| 3. GSC Metrics + Delta Computation | 0/TBD | Not started | - |
| 4. Block Kit Report + Daily Cron | 0/TBD | Not started | - |
