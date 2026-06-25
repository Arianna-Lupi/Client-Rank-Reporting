<!-- GSD:project-start source:PROJECT.md -->

## Project

**Client Rank Reporting — Slack GSC Bot**

Un bot de Slack que publica diariamente en un canal el reporte de métricas de Google Search Console (impresiones, clics, CTR, posición media) para cada cliente, mostrando el porcentaje de variación respecto al día anterior. Incluye comandos `/add <cliente>`, `/remove <cliente>` y `/list` para gestionar qué clientes (propiedades GSC) entran al reporte. Es una herramienta interna para la agencia (Arianna Lupi) que evita entrar a GSC manualmente cada mañana.

**Core Value:** Cada mañana el equipo ve, sin entrar a GSC, cómo se movió cada cliente día contra día directamente en Slack.

### Constraints

- **Tech stack**: Node.js + Slack Bolt + `googleapis` — encaja con serverless y el ecosistema Slack/Google.
- **Hosting**: Vercel serverless (funciones + cron) — sin servidor que mantener.
- **Slack**: HTTP endpoint (Request URL) para slash commands; cron serverless para el push diario. No Socket Mode.
- **Persistencia**: Vercel KV / Upstash Redis para la lista de clientes activos (estado entre invocaciones efímeras).
- **GSC auth**: Service Account (JSON) con permiso de lectura sobre todas las propiedades a reportar.
- **Idioma**: reporte en español.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@slack/bolt` | `4.7.3` | Slack app framework (listeners for slash commands, posting messages) | Official Slack SDK. Bolt v4 is the current major. Gives you a unified `app.command()` / `app.client.chat.postMessage()` surface instead of hand-rolling routing. Bundles `@slack/web-api`, signature verification, and retry logic. |
| `@vercel/slack-bolt` | `1.5.1` | Vercel-native Bolt *receiver* (replaces Bolt's default HTTPReceiver/Socket Mode) | This is the load-bearing choice. Bolt's stock `HTTPReceiver` assumes a long-lived Node server; Socket Mode needs a persistent WebSocket — both incompatible with ephemeral functions. `@vercel/slack-bolt` adapts Bolt to a single Web-standard `Request` handler and uses Fluid Compute `waitUntil()` to **ack within Slack's 3-second deadline while work continues in the background**. Peer-depends on `@slack/bolt@^4.4.0`. Handles signature verification for you. |
| `googleapis` | `173.0.0` | Google Search Console Search Analytics client + Service Account auth | Official Google Node client. Exposes `searchconsole('v1')` with `searchanalytics.query` (clicks, impressions, CTR, position) and `sites.list` (powers `/list`). Bundles `google-auth-library` for JWT/Service Account auth — no separate dep needed. |
| Vercel Serverless Functions + Cron | platform | HTTP endpoint for slash commands; daily push | No server to maintain. Cron triggers an HTTP GET to your function on a schedule. Matches the project's "no always-on process" constraint. |
| `@upstash/redis` | `1.38.0` | Persist the active-clients list across ephemeral invocations | HTTP/REST-based Redis client (not a TCP socket pool) — purpose-built for serverless where connections can't be kept warm. This is what Vercel KV became (see "What NOT to Use"). Stateless `fetch` calls, works in any function runtime. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@slack/web-api` | `7.17.0` | Direct Web API calls | Already bundled inside `@slack/bolt`. You normally call it via `app.client`; only install standalone if you ever post from a context without a Bolt `app` instance (e.g. a pure cron file that doesn't boot Bolt). |
| `google-auth-library` | `10.9.0` | Service Account JWT minting | Already bundled inside `googleapis` (`google.auth.GoogleAuth` / `JWT`). Listed for awareness; do not install separately. |
| `date-fns` | `4.x` | Date math for "last day with data vs previous comparable day" | GSC has a 2–3 day lag; you walk backwards to the latest populated date and compute the prior comparable day. A small date lib avoids manual `Date` arithmetic bugs. Optional — native `Date` is workable. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Vercel CLI (`vercel`) | Local dev (`vercel dev`) + deploy + env management | `vercel env pull` to sync secrets locally. Cron does **not** fire under `vercel dev`; trigger the cron path manually with curl while developing. |
| ngrok / Vercel preview URL | Expose local endpoint to Slack for slash-command testing | Slack needs a public Request URL. Use a stable preview deployment or ngrok during dev. |
| TypeScript | Type safety on Slack/Google payloads | Bolt and googleapis ship first-class types. Strongly recommended for the form-urlencoded slash-command payloads. |

## Installation

# Core

# Supporting (optional)

# Dev

## Key Integration Notes

### Slack signature verification (serverless)

### The 3-second ack rule

### GSC Service Account access (per-property, NOT domain-wide delegation)

### Vercel Cron

### Secrets / env management

- `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`
- `GSC_SA_EMAIL`, `GSC_SA_PRIVATE_KEY` (escape newlines, or base64-encode the whole JSON and decode at runtime)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (auto-injected if you install Upstash via the Vercel Marketplace integration)
- `CRON_SECRET`, plus `REPORT_CHANNEL_ID` and `REPORT_TZ`

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@vercel/slack-bolt` receiver | Raw HTTP handler + `@slack/web-api` + manual signature verify | If you want zero framework magic and full control, or are on a non-Vercel host without a maintained receiver. More code, you own the 3s-ack and HMAC logic. Viable but more error-prone. |
| `@upstash/redis` | Vercel Postgres / Neon / Turso (SQLite) | If the "client list" grows into relational data (per-client config, history, audit). For a simple set of property URLs, Redis is lighter and faster. |
| `@upstash/redis` | Upstash via Vercel Marketplace integration | Same product — the Marketplace integration just auto-provisions and injects the `UPSTASH_REDIS_REST_*` env vars. Recommended path on Vercel; the npm client is identical. |
| `googleapis` | `google-auth-library` + raw `fetch` to GSC REST | If bundle size is critical (googleapis is large). For one API surface you could call the REST endpoint directly with a JWT. Rarely worth the loss of typed helpers. |
| Vercel Cron | GitHub Actions scheduled workflow hitting the endpoint | If you outgrow Hobby cron limits but don't want Pro, an external scheduler (GitHub Actions, cron-job.org) can GET the report endpoint with the `CRON_SECRET`. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Slack Socket Mode** (`socketMode: true`) | Requires a persistent WebSocket connection. Serverless functions are ephemeral and can't hold one open. Explicitly out of scope per PROJECT.md. | HTTP Request URL via `@vercel/slack-bolt`. |
| **Bolt default `HTTPReceiver` / `ExpressReceiver`** | Assume a long-running Node/Express server and a writable response stream; they don't map cleanly onto a single serverless Web `Request`/`Response`, and you lose the `waitUntil` background-work pattern. | `@vercel/slack-bolt` receiver. |
| **`@vercel/kv`** (`3.0.0`) | Deprecated. Vercel KV was retired and migrated to Upstash Redis (Dec 2024); new projects can't provision it. | `@upstash/redis` (directly, or via the Upstash Marketplace integration). |
| **Service Account JSON committed to repo / read from filesystem** | Serverless filesystem is ephemeral and read-only-ish; committing keys is a security leak. | Env vars (`GSC_SA_EMAIL` + `GSC_SA_PRIVATE_KEY`, or base64'd JSON). |
| **Domain-wide delegation for GSC** | Unnecessary complexity; GSC permissions are per-property, not Workspace-user impersonation. | Add the Service Account email as a user on each property. |
| **In-memory / module-global store for the client list** | Globals don't survive cold starts or span concurrent function instances — the list would silently reset. | `@upstash/redis`. |
| **OAuth user tokens for GSC** | Require interactive consent and token refresh; break for unattended daily cron runs. | Service Account (no human in the loop). |

## Stack Patterns by Variant

- One cron/day is fine for the morning report, but timing is approximate (±1h) and you can't add a second schedule.
- Because `/add`/`/remove`/`/list` are HTTP-triggered (not cron), they work fully on Hobby.
- Either upgrade to Pro (precise UTC scheduling) or run the cron hourly and gate execution inside the function against `REPORT_TZ` so it fires once at local 9:00 regardless of DST.
- Migrate the Redis value from a simple set of URLs to a hash, or move to Postgres/Turso. Keep the access behind a small `clients` repository module so the storage swap is contained.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@vercel/slack-bolt@1.5.1` | `@slack/bolt@^4.4.0` | Peer dependency. Install Bolt v4 (4.7.3); do not use Bolt v3. |
| `@slack/bolt@4.7.3` | bundles `@slack/web-api@7.x` | No need to install `@slack/web-api` separately for normal use. |
| `googleapis@173.0.0` | bundles `google-auth-library@10.x` | `google.auth.GoogleAuth` available without a separate install. |
| `@upstash/redis@1.38.0` | Node 18+ / Web `fetch` runtime | Works on Vercel Node and Edge runtimes; no TCP, so no connection pooling concerns. |

## Sources

- npm registry (`npm view`) — verified current versions: `@slack/bolt@4.7.3`, `@vercel/slack-bolt@1.5.1` (peer `@slack/bolt@^4.4.0`), `@slack/web-api@7.17.0`, `googleapis@173.0.0`, `google-auth-library@10.9.0`, `@upstash/redis@1.38.0`, `@vercel/kv@3.0.0`. HIGH.
- Vercel changelog — "Build Slack agents with @vercel/slack-bolt" (Fluid Compute `waitUntil`, 3s ack, signing-secret env): https://vercel.com/changelog/build-slack-agents-with-vercel-slack-bolt — HIGH.
- vercel-labs/slack-bolt DeepWiki troubleshooting (raw-body / `dispatch_failed` signature pitfall): https://deepwiki.com/vercel-labs/slack-bolt/7-troubleshooting — MEDIUM.
- Vercel docs — Redis on Vercel / KV deprecation → Upstash: https://vercel.com/docs/redis and https://vercel.com/marketplace/upstash — HIGH.
- Vercel docs — Cron Jobs (UTC-only, 5-field cron, CRON_SECRET, plan limits): https://vercel.com/docs/cron-jobs — HIGH.
- Google Search Console API — Prerequisites & Authorizing Requests (per-property permission, scopes): https://developers.google.com/webmaster-tools/v1/prereqs and https://developers.google.com/webmaster-tools/v1/how-tos/authorizing — HIGH.
- Upstash blog — Serverless Slackbot with Vercel + Upstash Redis (pattern reference): https://upstash.com/blog/vercel-note-taker-slackbot — MEDIUM.

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
