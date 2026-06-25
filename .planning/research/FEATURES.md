# Feature Research

**Domain:** Slack reporting/notification bot for SEO metrics (Google Search Console daily digest)
**Researched:** 2026-06-25
**Confidence:** HIGH (Slack Block Kit, slash command UX, GSC API freshness and sites.list all verified against official Slack and Google developer docs)

## Feature Landscape

### Table Stakes (Users Expect These)

Features the team assumes exist. Missing these = the bot feels broken or untrustworthy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Daily scheduled report at a fixed local time | Core promise: see movement each morning without entering GSC | MEDIUM | Vercel Cron triggers an HTTP function. Cron runs in UTC — convert from the env-configured timezone (e.g. `America/Mexico_City`) when computing the trigger hour. Account for DST drift. |
| One message per active client with the 4 core metrics | Stated in PROJECT: impressions, clicks, CTR, average position | LOW | Block Kit `section` block with `mrkdwn`. One message (or one block group) per property so the channel is scannable. |
| Percent delta vs previous comparable day, per metric | Explicit requirement; a raw number with no trend is useless for a morning glance | MEDIUM | `((current - previous) / previous) * 100`. Guard divide-by-zero when previous = 0 (show "new"/"—" instead of `Infinity%`). |
| Direction indicator (up/down) with emoji + sign | Users scan color/arrow before reading numbers; Slack design guidance says pair emoji with text | LOW | Use `:small_red_triangle:`/`:small_red_triangle_down:` or `:arrow_up:`/`:arrow_down:` + signed `%`. **Invert semantics for average position: lower is better**, so a position drop (e.g. 5.2 → 4.1) is GOOD/green. This is the single most error-prone formatting rule. |
| "Last available day vs previous day" comparison logic | GSC has a 2–3 day lag; fixed calendar dates (yesterday) return empty/partial data | MEDIUM | Query a window (e.g. last 10 days), find the most recent date that has data, compare it to the prior date with data. Optionally use `dataState: "final"` (default) to avoid partial days, or `dataState: "all"` + `metadata.first_incomplete_date` to detect the freshness boundary. |
| `/add <client>` to add a GSC property to the report | Stated requirement; self-service management without redeploy | MEDIUM | Validate the argument resolves to a real `siteUrl` from `sites.list`. Persist to Vercel KV / Upstash. Respond ephemeral confirmation. |
| `/remove <client>` to remove a property | Stated requirement | LOW | Validate it's currently in the active list; ephemeral error if not present. |
| `/list` of available GSC properties | Stated requirement; users need to know exact identifiers to `/add` | LOW–MEDIUM | Call `sites.list`; show `siteUrl` + whether each is currently active. Filter out `siteUnverifiedUser`. Mark which are already in the report. |
| Persistent active-client list across serverless invocations | Serverless is ephemeral; the list must survive between cron runs and commands | LOW | Vercel KV / Upstash Redis (already chosen). A simple JSON array or Redis set keyed per channel. |
| 3-second ACK + deferred response on slash commands | Slack hard requirement: ack within 3s or the user sees an error | MEDIUM | Ack immediately (HTTP 200), then use `response_url` for the real reply (up to 5 responses / 30 min). GSC calls in `/list`/`/add` can exceed 3s, so deferred response is mandatory, not optional. |
| Ephemeral confirmations and error messages | Slack best practice: positive affirmation per command; errors shouldn't spam the channel | LOW | `response_type: "ephemeral"` for confirmations/validation errors; only the daily report posts `in_channel`. |
| Help / usage response on bare or malformed command | Users inevitably type `/add` with no argument | LOW | Each command returns usage syntax + example when args are missing or invalid. |
| Graceful "no data" / empty-state handling | New properties, weekends, or the lag can yield zero rows | MEDIUM | Show "Sin datos disponibles para [client]" instead of `0` everywhere or a crash. Distinguish genuine zero from missing data. |
| Slack request signature verification | Security baseline; anyone could POST to the endpoint otherwise | LOW | Verify `X-Slack-Signature` / timestamp on every slash command request (Bolt does this automatically if configured with the signing secret). |

### Differentiators (Competitive Advantage)

Not required, but raise the tool from "works" to "pleasant and trusted." Should align with the core value: a fast, trustworthy morning glance.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Report header with the actual data date(s) compared | Removes ambiguity about *which* days are being compared given the lag | LOW | e.g. "Reporte GSC — 22 jun vs 21 jun (último día con datos)". Builds trust that the lag is handled correctly. |
| Absolute value shown alongside the delta | A +20% on tiny numbers is noise; the absolute makes deltas interpretable | LOW | "Clics: *142* (+18% ▲)". |
| Color-coded sentiment via emoji, position-aware | Green/red signaling that respects "lower position = better" | LOW | Pure formatting; high perceived polish for near-zero cost. |
| Single combined digest message option (all clients in one) | Less channel noise when many clients; easier to thread | MEDIUM | Conflicts with the chosen "one message per client" decision — offer as config, not default. Watch Block Kit limit of 50 blocks / message. |
| Per-metric thresholds / alert highlighting | Surfaces meaningful swings (e.g. clicks down >25%) with a callout | MEDIUM | Risk of alert fatigue; keep thresholds conservative and configurable. |
| Validation with fuzzy matching / suggestions on `/add` | "Did you mean `sc-domain:cliente.com`?" when input is close | MEDIUM | GSC identifiers are awkward (`sc-domain:` vs URL-prefix). Suggesting from `sites.list` reduces friction materially. |
| Manual `/report` trigger to run the digest on demand | Re-run after a fix or show a stakeholder live | LOW | Reuses the daily report code path; just a new command entry point. |
| Week-over-week or 7-day-avg comparison option | Day-vs-day is noisy (weekday/weekend swings); WoW is more stable | MEDIUM | Day-over-day for weekends especially is misleading. A second comparison mode adds real analytical value. |
| Top movers summary line | "Mayor subida: Cliente X (+40% clics)" at the top of the digest | LOW | Cheap synthesis that makes the digest skimmable at a glance. |
| Friendly client aliases mapped to GSC `siteUrl` | "acme" instead of `sc-domain:acme.com` in commands and report | MEDIUM | Requires an alias map in KV. Big UX win since raw GSC identifiers are ugly. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Web dashboard / custom UI | "It'd be nice to also see charts" | Explicitly out of scope; the whole point is *avoiding* a separate surface. Builds a frontend, hosting, auth — a different product | Keep everything in Slack; link out to GSC for deep dives |
| Real-time / hourly updates | "Why wait until 9 AM?" | GSC final data lags 2–3 days; hourly data is only last 8 days and still delayed. Real-time creates false precision and noise | One reliable daily digest of the last *final* day |
| Long-term historical store / data warehouse | "Let's keep all the history" | Out of scope v1; turns a stateless query tool into a database product with retention, migrations, cost | Query GSC on-demand; KV holds only the active-client list |
| Multi-workspace / multi-channel / multi-tenant | "Other teams might want it" | Out of scope; multiplies config, auth, and per-channel state for a single-agency internal tool | One workspace, one channel, hardcoded/env channel ID |
| Metrics beyond GSC (GA4, Ads, third-party ranks) | "Show everything in one place" | Out of scope v1; each source is its own auth, schema, and rate-limit surface | GSC-only v1; revisit only after the GSC bot is validated |
| Socket Mode / always-on listener | Common Slack bot default | Requires a persistent connection, incompatible with ephemeral serverless (already decided against) | HTTP Request URL endpoint + Vercel Cron |
| Interactive editing of report layout per user | "Let me customize my view" | Per-user state and modals for an internal team digest = overengineering | One agreed format; change via code/config |
| Open `/add` to everyone without any guardrail | "Keep it simple" | Anyone in the channel could pollute the report; no audit of who changed what | See Permissions below — at minimum log who ran the command; optionally restrict to an allowlist of user IDs |

## Permissions (who can add/remove)

GSC-side access is uniform (the Service Account reads all properties), so the only access question is *who can mutate the active list via Slack*.

- **Simplest (v1):** any member of the target channel can run `/add` `/remove` `/list`. Acceptable for a small internal agency channel. **(Recommended for MVP.)**
- **Lightweight guardrail (differentiator):** allowlist of Slack user IDs in env/KV; non-allowed users get an ephemeral "no autorizado" message. Low complexity, prevents accidental changes.
- **Audit (differentiator):** post a small ephemeral or channel note "Cliente X agregado por @juan" so changes are traceable.
- GSC `sites.list` returns a `permissionLevel` per property (`siteOwner`, `siteFullUser`, `siteRestrictedUser`, `siteUnverifiedUser`); filter out `siteUnverifiedUser` so users can't add a property the Service Account can't actually read.

## Report Message Format (Block Kit, concrete)

Recommended structure per the chosen "one message per client" decision. Use `mrkdwn` text objects; Slack auto-converts `:emoji:` shortcodes.

```
┌─ section (header line) ─────────────────────────────┐
│ *Cliente: Acme*  ·  22 jun vs 21 jun                │
├─ section (fields: 2-col grid) ──────────────────────┤
│ *Impresiones*            *Clics*                     │
│ 12,430  :small_red_triangle: +8.2%                  │
│                          1,042 :small_red_triangle_down: -3.1% │
│ *CTR*                    *Posición media*           │
│ 8.4%  :small_red_triangle: +0.4pp                   │
│                          4.1 :small_red_triangle: ▲ mejora (-1.1)│
├─ context (small footer) ────────────────────────────┤
│ Último día con datos en GSC · dataState: final       │
└─────────────────────────────────────────────────────┘
divider
```

Formatting rules:
- **Impressions, clicks, CTR:** up = green/▲ = good; down = red/▼ = bad.
- **Average position:** **inverted** — a *decrease* in the number is an *improvement* (green/▲). Label it explicitly ("mejora"/"empeora") so no one misreads.
- Show CTR delta in percentage points (`pp`), not percent-of-percent, to avoid confusion.
- Always print the compared dates in the header so the lag handling is transparent.
- Use a `divider` block between clients for scannability.
- Stay under the 50-block-per-message limit (only matters if combining many clients).

## Feature Dependencies

```
[Daily scheduled report]
    └──requires──> [Last-available-day comparison logic]
                       └──requires──> [GSC Search Analytics query + dataState handling]
    └──requires──> [Active client list persistence (KV)]
    └──requires──> [Per-metric delta + direction formatting (Block Kit)]

[/add] [/remove] [/list]
    └──requires──> [GSC sites.list (available properties)]
    └──requires──> [Active client list persistence (KV)]
    └──requires──> [3s ACK + deferred response via response_url]
    └──requires──> [Slack signature verification]

[Friendly aliases] ──enhances──> [/add /remove /list] and [Report message]
[Manual /report] ──reuses──> [Daily scheduled report] code path
[Permissions allowlist] ──enhances──> [/add] [/remove]
[Combined digest] ──conflicts──> [One-message-per-client decision]
[Week-over-week mode] ──enhances──> [Last-available-day comparison]
```

### Dependency Notes

- **Report requires comparison logic requires GSC query:** the freshness/lag handling is the foundation; nothing displays correctly until "last available day vs previous" is solved.
- **All commands require KV persistence and `sites.list`:** validation in `/add` depends on knowing the real property set; the active list lives in KV.
- **Commands require deferred response:** GSC API calls inside `/list` and `/add` validation will routinely exceed Slack's 3-second window — `response_url` is mandatory.
- **Aliases enhance everything but add KV schema:** defer until raw identifiers prove too painful.
- **Combined digest conflicts with one-per-client:** don't build both as defaults; one-per-client is the decided baseline.

## MVP Definition

### Launch With (v1)

- [ ] GSC auth via Service Account + `sites.list` — foundation for everything
- [ ] "Last available day vs previous day" comparison handling the 2–3 day lag — core correctness
- [ ] Daily cron report, one message per active client, 4 metrics + % delta + direction emoji (position-inverted) — the core value
- [ ] Date header showing which days are compared — trust
- [ ] `/add` `/remove` `/list` with validation against `sites.list`, ephemeral confirmations/errors, help on bad input
- [ ] Active client list in Vercel KV / Upstash
- [ ] 3s ACK + deferred response + Slack signature verification
- [ ] Empty/no-data handling (new property, weekend, lag)

### Add After Validation (v1.x)

- [ ] Friendly client aliases — trigger: raw GSC identifiers prove annoying in daily use
- [ ] Manual `/report` trigger — trigger: someone wants an on-demand run
- [ ] Permissions allowlist + change audit — trigger: accidental or unwanted list edits occur
- [ ] Top-movers summary line — trigger: number of clients grows enough to need a TL;DR

### Future Consideration (v2+)

- [ ] Week-over-week / 7-day-avg comparison mode — defer: day-over-day validated first; adds analytical surface
- [ ] Threshold-based alert highlighting — defer: needs real usage to tune thresholds and avoid fatigue
- [ ] Combined single-digest mode — defer: only if channel noise becomes a complaint

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Last-available-day comparison (lag handling) | HIGH | MEDIUM | P1 |
| Daily report w/ 4 metrics + position-aware deltas | HIGH | MEDIUM | P1 |
| `/add` `/remove` `/list` + validation | HIGH | MEDIUM | P1 |
| KV persistence of active list | HIGH | LOW | P1 |
| 3s ACK + deferred response | HIGH | MEDIUM | P1 |
| Signature verification | HIGH | LOW | P1 |
| No-data / empty-state handling | HIGH | MEDIUM | P1 |
| Date header (which days compared) | MEDIUM | LOW | P1 |
| Friendly aliases | MEDIUM | MEDIUM | P2 |
| Manual `/report` trigger | MEDIUM | LOW | P2 |
| Permissions allowlist + audit | MEDIUM | LOW | P2 |
| Top-movers summary | MEDIUM | LOW | P2 |
| Week-over-week mode | MEDIUM | MEDIUM | P3 |
| Threshold alerts | LOW | MEDIUM | P3 |
| Combined digest mode | LOW | MEDIUM | P3 |

## Competitor Feature Analysis

| Feature | SEO reporting tools (AgencyAnalytics, Looker Studio GSC) | Generic Slack metric bots (Geckoboard, Statsbot-style) | Our Approach |
|---------|----------------------------------------------------------|--------------------------------------------------------|--------------|
| Delivery surface | Web dashboard + scheduled PDF/email | Slack message digest | Slack-only digest (no dashboard) |
| Data freshness handling | Often shows stale/partial silently | N/A | Explicit last-available-day vs previous, date shown |
| Period comparison | Configurable ranges, MoM/YoY | Simple vs-previous | Day-over-day v1; WoW later |
| Metric scope | Multi-source (GA, Ads, GSC, ranks) | Whatever you wire up | GSC-only by design |
| Property management | Web UI add/remove | Config files / web | In-Slack `/add` `/remove` `/list` |
| Trend display | Charts + arrows | Sparklines, arrows | Emoji arrows + signed %, position-inverted |

## Sources

- [Slack — Implementing slash commands](https://docs.slack.dev/interactivity/implementing-slash-commands/) — 3s ACK, `response_url`, ephemeral vs in_channel, help responses (HIGH)
- [Slack — Slash Commands Style Guide](https://medium.com/slack-developer-blog/slash-commands-style-guide-4e91272aa43a) — default help, positive affirmation, ephemeral for input (MEDIUM)
- [Slack — Designing with Block Kit](https://docs.slack.dev/block-kit/designing-with-block-kit) — pair emoji with text, placement, mrkdwn (HIGH)
- [Slack — Blocks reference](https://docs.slack.dev/reference/block-kit/blocks/) — section/fields/context/divider, 50-block limit (HIGH)
- [Google — Search Console API Sites: list](https://developers.google.com/webmaster-tools/v1/sites/list) — `siteUrl`, `permissionLevel` values (HIGH)
- [Google — Search Console API prerequisites](https://developers.google.com/webmaster-tools/v1/prereqs) — scopes, service account (HIGH)
- [Google updates Search Analytics API data freshness / `dataState`, `metadata.first_incomplete_date`](https://gradientgroup.com/google-updates-search-analytics-api-to-clarify-data-freshness/) — 2-day lag, fresh vs final data (MEDIUM)
- [GSC API delay community thread (2+ day lag confirmation)](https://support.google.com/webmasters/thread/216128633/data-from-gsc-api-is-delayed-by-over-2-days) — real-world lag confirmation (MEDIUM)
- [Vercel Academy — Slash Commands](https://vercel.com/academy/slack-agents/slash-commands) — serverless slash command + Zod validation pattern (MEDIUM)

---
*Feature research for: Slack GSC daily reporting bot*
*Researched: 2026-06-25*
