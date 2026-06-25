# Architecture Research

**Domain:** Vercel serverless Slack bot — daily Google Search Console (GSC) reporting + slash-command management
**Researched:** 2026-06-25
**Confidence:** HIGH (Vercel Cron + Slack ack patterns verified against current docs; GSC API surface from training data, MEDIUM)

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         TRIGGERS (inbound)                             │
├──────────────────────────────────────────────────────────────────────┤
│   Slack (HTTP POST)                          Vercel Cron (UTC)         │
│   /add  /remove  /list                       once daily ~9:00          │
│        │                                            │                  │
├────────┼────────────────────────────────────────────┼─────────────────┤
│        ▼                                            ▼                  │
│   ┌──────────────────────────┐          ┌──────────────────────────┐  │
│   │  api/slack/command.ts     │          │  api/cron/daily-report.ts │  │
│   │  - verify Slack signature │          │  - verify CRON_SECRET     │  │
│   │  - route by command       │          │  - load active clients    │  │
│   │  - synchronous reply (<3s) │          │  - loop: fetch + post     │  │
│   └─────────┬─────────────────┘          └─────────┬────────────────┘  │
│             │                                       │                   │
├─────────────┼───────────────────────────────────────┼──────────────────┤
│             ▼            SHARED SERVICE MODULES (lib/)▼                 │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐               │
│   │ clients.ts   │   │ gsc.ts       │   │ slack.ts     │               │
│   │ (KV CRUD)    │   │ (auth/query/ │   │ (Block Kit + │               │
│   │              │   │  delta)      │   │  chat.post)  │               │
│   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘               │
├──────────┼──────────────────┼──────────────────┼──────────────────────┤
│          ▼                  ▼                  ▼                        │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐               │
│   │ Vercel KV /  │   │ GSC Search   │   │ Slack Web API │              │
│   │ Upstash Redis│   │ Console API  │   │ (chat.post-   │              │
│   │ (client set) │   │ (Svc Account)│   │  Message)     │              │
│   └──────────────┘   └──────────────┘   └──────────────┘               │
└──────────────────────────────────────────────────────────────────────┘
```

Two independent entrypoints (slash-command handler, cron job) that share three stateless service modules. This is the canonical "thin handlers, shared services" serverless shape: each HTTP function is just a triggering shell; all reusable logic lives in `lib/` so both the command path and the cron path call the same GSC/Slack/KV code.

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `api/slack/command.ts` | Receive Slack slash commands, verify HMAC signature, route `/add` `/remove` `/list`, reply within 3s | Vercel Node function reading the **raw** request body |
| `api/cron/daily-report.ts` | Cron entrypoint: auth-guard, load active clients, iterate, post one Slack message each | Vercel Node function guarded by `CRON_SECRET` / Vercel cron header |
| `lib/clients.ts` | Persist + read the active-clients list (add/remove/list-active) | Redis Set in Vercel KV / Upstash |
| `lib/gsc.ts` | Service Account auth, `sites.list`, `searchanalytics.query`, find last-available-day, compute day-over-day deltas | `googleapis` (`webmasters`/`searchconsole` v1) |
| `lib/slack.ts` | Build Block Kit message per client, post via `chat.postMessage`, format `respond()` replies for commands | `@slack/web-api` (`WebClient`) |
| `lib/verify.ts` | Slack signing-secret HMAC verification (shared util) | `crypto` timing-safe compare |

## Recommended Project Structure

```
.
├── api/                          # Vercel serverless functions (each file = one route)
│   ├── slack/
│   │   └── command.ts            # Slack Request URL → handles /add /remove /list
│   └── cron/
│       └── daily-report.ts       # Vercel Cron target → builds + posts daily report
├── lib/                          # Shared, framework-free service modules (NOT routes)
│   ├── clients.ts                # KV persistence: addClient, removeClient, listActive
│   ├── gsc.ts                    # GSC auth + queries + delta computation
│   ├── slack.ts                  # Block Kit builders + chat.postMessage
│   ├── verify.ts                 # Slack signature verification
│   ├── format.ts                 # number/percent/arrow formatting (es-ES)
│   └── config.ts                 # env parsing (timezone, channel id, secrets)
├── vercel.json                   # crons[] + function maxDuration config
├── package.json
└── .env                          # local only; real secrets in Vercel env vars
```

### Structure Rationale

- **`api/` mirrors Vercel routing:** every file under `api/` becomes an HTTP endpoint. Keeping only two files here means only two URLs exist: the Slack Request URL and the cron target. Subfolders (`slack/`, `cron/`) keep the two concerns visibly separate.
- **`lib/` holds all logic, zero HTTP:** modules are pure functions over inputs — testable without spinning up a server, and reused identically by both entrypoints. This is the single most important boundary: handlers do I/O orchestration, `lib/` does the work.
- **One `gsc.ts` owning the delta logic:** the "last available day vs previous comparable day" rule is the trickiest business logic; centralizing it means `/list` (which only needs `sites.list`) and the cron job (which needs full metrics + deltas) draw from one source of truth.

## Architectural Patterns

### Pattern 1: Synchronous slash-command handling (no deferral)

**What:** Verify signature, do the small amount of work (a KV write, or one `sites.list` call), and return the Slack reply in the same HTTP response — all inside the 3-second window.

**When to use:** When the command's work reliably completes in well under 3s. All three commands here qualify: `/add` and `/remove` are single KV operations (~tens of ms); `/list` is one `sites.list` call (typically <1s).

**Trade-offs:** Simplest possible model — no `response_url`, no second function, no queue. The risk is only if work could exceed ~2.5s; here it cannot, so the standard "ack-then-defer" complexity is unjustified.

**Critical serverless caveat:** The Bolt-style "call `ack()` immediately, then keep working after responding" pattern is **fragile on serverless**. Once the function returns its HTTP response, Vercel may freeze/terminate the instance, killing any not-yet-awaited work. If you ever DO need deferred work, you must either (a) fully `await` it before responding, or (b) use `waitUntil()` from `@vercel/functions` to keep the instance alive, or (c) reply 200 immediately and post the result via the command's `response_url` from a separate invocation. For this project, prefer (a): just do the work synchronously.

**Example:**
```typescript
// api/slack/command.ts
export const config = { api: { bodyParser: false } }; // need RAW body for HMAC

export default async function handler(req, res) {
  const raw = await readRawBody(req);
  if (!verifySlackSignature(raw, req.headers)) return res.status(401).end();

  const { command, text } = parseForm(raw);     // application/x-www-form-urlencoded
  let reply: string;
  switch (command) {
    case '/add':    reply = await addClient(text.trim()); break;
    case '/remove': reply = await removeClient(text.trim()); break;
    case '/list':   reply = await formatSiteList(await gsc.listSites()); break;
  }
  // ephemeral reply, returned synchronously inside the 3s window
  res.json({ response_type: 'ephemeral', text: reply });
}
```

### Pattern 2: Raw-body signature verification

**What:** Slack signs the exact raw request bytes. You must read the unparsed body, compute `HMAC-SHA256` over `v0:{timestamp}:{rawBody}` with the signing secret, and timing-safe-compare to `X-Slack-Signature`. Also reject timestamps older than ~5 min (replay protection).

**When to use:** Always, on the Slack endpoint. Disable Vercel's automatic body parser (`bodyParser: false`) or the raw bytes are gone before you can verify.

**Trade-offs:** A few extra lines vs. letting a framework do it. This is the #1 silent-failure source on Vercel + Slack (parser eats the body → signature never matches). Centralize it in `lib/verify.ts`.

### Pattern 3: Cron iteration with bounded sequential fan-out

**What:** The cron function loads the active-client set, then loops clients, and for each one: query GSC → compute deltas → post one Block Kit message. Run sequentially (or in small `Promise.all` batches) and isolate failures per client so one bad property doesn't abort the whole report.

**When to use:** The daily report. One message per client is a hard requirement, and per-client isolation keeps the report resilient.

**Trade-offs:** Sequential is simplest and stays well within the function timeout for a realistic agency client count (tens). Watch the total duration: each client ≈ 1 GSC query + 1 Slack post (~1–2s). Set `maxDuration` in `vercel.json` accordingly; if the client count ever grows large enough to risk the timeout, batch with limited concurrency or split the work.

**Example:**
```typescript
// api/cron/daily-report.ts
export default async function handler(req, res) {
  if (!isAuthorizedCron(req)) return res.status(401).end();   // guard the endpoint
  const clients = await listActive();
  for (const site of clients) {
    try {
      const { current, previous } = await gsc.fetchLastTwoComparableDays(site);
      const blocks = buildClientReport(site, current, previous);  // deltas + arrows
      await slack.post(process.env.SLACK_CHANNEL_ID, blocks);
    } catch (e) {
      await slack.postError(site, e);   // isolate: report failure, keep going
    }
  }
  res.status(200).json({ ok: true, count: clients.length });
}
```

### Pattern 4: Last-available-day delta resolution (GSC lag handling)

**What:** GSC data lags 2–3 days and finalizes incrementally. Do **not** hardcode "yesterday." Instead, query a trailing window (e.g. last ~10 days, `dimensions: ['date']`), take the most recent date that returned rows as "current day," and the prior returned date as "previous comparable day," then compute per-metric % change. Position is "lower is better," so its delta arrow inverts.

**When to use:** The core metric computation. This rule lives entirely in `lib/gsc.ts`.

**Trade-offs:** One slightly larger query instead of two fixed-date queries, but it is robust to the lag and to missing days. Hardcoded dates are the main cause of empty/partial daily reports.

## Data Flow

### Command Flow (`/add`, `/remove`, `/list`)

```
Slack user types /add example.com
    ↓  HTTP POST (x-www-form-urlencoded, signed)
api/slack/command.ts
    ↓  verify raw-body HMAC (lib/verify.ts)
    ├── /add|/remove → lib/clients.ts → Vercel KV (Redis SET add/remove)
    └── /list        → lib/gsc.ts → GSC sites.list
    ↓  build text reply (lib/format.ts)
HTTP 200 { response_type: ephemeral, text } ──→ Slack shows reply (<3s)
```

### Daily Report Flow (cron)

```
Vercel Cron (UTC, once/day)
    ↓  GET api/cron/daily-report.ts (auth-guarded)
lib/clients.ts → KV → [ active site list ]
    ↓  for each site:
lib/gsc.ts → GSC searchanalytics.query (trailing window)
    ↓  resolve last-available-day + previous → compute deltas
lib/slack.ts → buildClientReport() → Block Kit
    ↓  chat.postMessage(channel, blocks)
Slack channel ← one message per client
```

### State Management

```
Vercel KV / Upstash (single Redis SET, e.g. key "active_clients")
    ▲ add/remove (commands)        ▼ read (cron + /list cross-check)
The ONLY persistent state. Everything else (metrics) is fetched
on-demand from GSC — no data warehouse, by design (PROJECT scope).
```

### Key Data Flows

1. **Active-client membership:** Slack command → `clients.ts` → KV Set. Source of truth for who appears in the report. `/list` reports GSC's *available* sites (from `sites.list`), which is a superset of the active set — consider showing both ("available" vs "active") to avoid confusion.
2. **Metric + delta:** Cron → `gsc.ts` (trailing-window query → last-available-day resolution → % deltas) → `slack.ts` (Block Kit) → channel. Stateless, recomputed every run.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1–25 clients | Sequential loop in one cron function. Set `maxDuration` ~60s (Pro). Fits comfortably. |
| 25–100 clients | Batch GSC queries with limited concurrency (e.g. p-limit at 5). Watch GSC quota + Slack rate limits (~1 msg/sec/channel). |
| 100+ clients | Split work: cron enqueues per-client jobs (QStash/Upstash) or chunks across multiple invocations; consider threading a single summary + per-client threads. |

### Scaling Priorities

1. **First bottleneck — function timeout on the cron loop:** total = clients × (GSC query + Slack post). Mitigate by raising `maxDuration` and/or bounded-concurrency batching before anything fancier.
2. **Second bottleneck — Slack channel rate limits:** `chat.postMessage` is roughly 1/sec per channel; many clients posting in a tight loop can hit Tier limits. Add light spacing or post into a thread.

## Anti-Patterns

### Anti-Pattern 1: Bolt "ack-then-work" with non-awaited async on Vercel

**What people do:** Use `@slack/bolt`'s `await ack(); /* fire-and-forget heavy work */` idiom copied from always-on servers.
**Why it's wrong:** After the HTTP response is sent, the serverless instance can freeze immediately — the deferred work silently never runs (or runs partially). Bolt's HTTP/`ExpressReceiver` model also fights Vercel's per-file routing.
**Do this instead:** Keep handlers synchronous (work is small), fully `await` before responding; if deferral is ever truly needed, use `waitUntil()` or `response_url` from a fresh invocation. For 3 small commands, raw Vercel functions + `@slack/web-api` are simpler than wiring a Bolt custom receiver — even though Bolt is the stated stack, scope it down to the WebClient for posting.

### Anti-Pattern 2: Hardcoding "yesterday" for the comparison

**What people do:** Query `today-1` vs `today-2` with fixed dates.
**Why it's wrong:** GSC's 2–3 day lag means those dates are often empty or still-finalizing → blank or wrong reports.
**Do this instead:** Trailing-window query; pick the two most recent dates that actually returned data (Pattern 4).

### Anti-Pattern 3: Letting Vercel parse the Slack body

**What people do:** Read `req.body` directly on the Slack endpoint.
**Why it's wrong:** The default body parser consumes the raw bytes, so the HMAC signature can never be reconstructed → every request fails verification (or, worse, verification is skipped).
**Do this instead:** `export const config = { api: { bodyParser: false } }` and read the raw stream in `lib/verify.ts`.

### Anti-Pattern 4: Unguarded cron endpoint

**What people do:** Leave `api/cron/daily-report.ts` publicly callable.
**Why it's wrong:** Anyone can trigger a full report (cost, spam, GSC quota burn).
**Do this instead:** Verify Vercel's cron auth header / a `CRON_SECRET` bearer token at the top of the handler.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Slack (inbound) | HTTP Request URL → signed POST, synchronous JSON reply | Raw-body HMAC; 3s budget; `bodyParser: false` |
| Slack (outbound) | `@slack/web-api` `WebClient.chat.postMessage` with Block Kit | Bot token (`SLACK_BOT_TOKEN`); ~1 msg/sec/channel |
| GSC Search Console | `googleapis` Service Account (JWT), `sites.list` + `searchanalytics.query` | SA must be added as user on every property; key stored as env var (not committed) |
| Vercel KV / Upstash | Redis Set for active clients | Single key; atomic add/remove; persists across invocations |
| Vercel Cron | `vercel.json` `crons[]` (path + schedule) | **UTC only**, fires anywhere within the scheduled hour, **no retry on failure**; Hobby = once/day max — Pro needed for sub-daily or tighter timing |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| handlers (`api/`) ↔ services (`lib/`) | direct function calls | handlers orchestrate; lib does work; no HTTP between them |
| `gsc.ts` ↔ Google | JWT auth client cached per invocation | re-auth per cold start is fine; SA needs read on all properties |
| `clients.ts` ↔ KV | Redis client from env URL | the only shared mutable state |

## Build Order (dependencies)

Bottom-up: shared services first (both entrypoints depend on them), then wire each trigger.

1. **`lib/config.ts` + `lib/verify.ts`** — env parsing + Slack signature util. Foundation; no deps.
2. **`lib/clients.ts` (KV)** — provision Vercel KV/Upstash, implement add/remove/listActive. Independently testable.
3. **`lib/gsc.ts`** — Service Account auth → `sites.list` first (simplest, unblocks `/list`), then `searchanalytics.query` + last-available-day/delta logic. Highest-risk module; build and verify against a real property early.
4. **`lib/slack.ts` + `lib/format.ts`** — `chat.postMessage` wrapper + Block Kit builder + es-ES formatting. Depends on the metric shape from `gsc.ts`.
5. **`api/slack/command.ts`** — wire verify + route to `clients.ts`/`gsc.ts`. Needs steps 1–3. (`/list` becomes usable as soon as 3's `sites.list` exists — good early end-to-end checkpoint.)
6. **`api/cron/daily-report.ts` + `vercel.json` crons** — wire `clients → gsc → slack` loop + cron schedule + `CRON_SECRET`. Needs steps 2–4. Last, because it composes everything.

**Phase implication:** `sites.list`/`/list` is the natural first vertical slice (auth + one read + one Slack reply, no delta math) — it proves Slack signing, GSC auth, and KV wiring end-to-end before tackling the harder delta computation and cron orchestration.

## Sources

- [Vercel Cron Jobs — docs](https://vercel.com/docs/cron-jobs) (HIGH) — `vercel.json` `crons[]`, UTC-only, fires within the hour, no retry
- [Vercel Cron — Usage & Pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) (HIGH) — Hobby once/day; Pro sub-daily
- [Vercel Academy — Ack & Latency](https://vercel.com/academy/slack-agents/acknowledgment-and-latency) (HIGH) — 3s ack on serverless, ack-first then `respond()`
- [Slack docs — Slash Commands](https://docs.slack.dev/tools/java-slack-sdk/guides/slash-commands/) (HIGH) — 3s timeout, `response_url` valid 30 min
- [bolt-python #335 — timeout after ack on serverless](https://github.com/slackapi/bolt-python/issues/335) (MEDIUM) — evidence that deferred work after ack fails when the instance freezes
- Google Search Console API (`sites.list`, `searchanalytics.query`), `googleapis` Service Account auth (MEDIUM — training data; verify method/scope names against current `googleapis` types during build)

---
*Architecture research for: Vercel serverless Slack GSC reporting bot*
*Researched: 2026-06-25*
