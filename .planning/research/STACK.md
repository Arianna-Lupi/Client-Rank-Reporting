# Stack Research

**Domain:** Slack bot (slash commands + scheduled report) on Vercel serverless, reading Google Search Console
**Researched:** 2026-06-25
**Confidence:** HIGH

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

```bash
# Core
npm install @slack/bolt@4 @vercel/slack-bolt googleapis @upstash/redis

# Supporting (optional)
npm install date-fns

# Dev
npm install -D typescript @types/node vercel
```

## Key Integration Notes

### Slack signature verification (serverless)
Do **not** hand-roll HMAC verification. `@vercel/slack-bolt` performs the HMAC-SHA256 check over the raw body using `SLACK_SIGNING_SECRET` before dispatching. The one footgun: the **raw request body must reach the receiver unconsumed**. If you wrap it in a framework (Next.js route handler, H3/Nitro) that eagerly reads the body, signature verification fails with `dispatch_failed`. Mitigation: buffer the raw body yourself and hand a fresh `Request` to the receiver, or disable the framework's automatic body parsing for that route. If you ever skip `@vercel/slack-bolt` and go raw, the manual recipe is: reconstruct `v0:{timestamp}:{rawBody}`, HMAC-SHA256 with the signing secret, compare to `x-slack-signature` in constant time, and reject timestamps older than 5 minutes.

### The 3-second ack rule
Slack times out a slash command if not acked in 3s. A GSC query may exceed that. Pattern: `ack()` immediately (empty or "working…" response), then do the GSC fetch and `postMessage`/`respond` afterward. `@vercel/slack-bolt`'s `waitUntil()` integration keeps the function alive for that background work after the HTTP response is sent.

### GSC Service Account access (per-property, NOT domain-wide delegation)
For Search Console you do **not** need Google Workspace domain-wide delegation. Domain-wide delegation is only for impersonating Workspace *users*. For GSC:
1. Create a Service Account in Google Cloud, download the JSON key, enable the Search Console API on the project.
2. In each GSC property, add the Service Account's email (`name@project.iam.gserviceaccount.com`) as a user (Full or Restricted) — exactly like adding a human teammate.
3. Auth with scope `https://www.googleapis.com/auth/webmasters.readonly`.
4. `sites.list` returns only the properties the Service Account can see — this is the natural backing for `/list`.

Because the project requires "access to all properties," the Service Account email must be added to every property you want to report on. There is no account-wide grant in GSC; it is per-property. Flag this as an onboarding step per client.

Auth snippet shape (env-based key, no file on disk in serverless):
```js
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GSC_SA_EMAIL,
    private_key: process.env.GSC_SA_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
});
const searchconsole = google.searchconsole({ version: 'v1', auth });
```

### Vercel Cron
Configure in `vercel.json`. **Schedule is always UTC — there is no per-job timezone.** Convert the agency's 9:00 AM local time to UTC and hardcode it (or run hourly and gate on the target tz inside the function if DST matters). Standard 5-field cron, no seconds/year.
```json
{
  "crons": [{ "path": "/api/cron/daily-report", "schedule": "0 13 * * *" }]
}
```
Secure the cron endpoint: Vercel sends `Authorization: Bearer ${CRON_SECRET}`; verify it so the public URL can't be triggered by outsiders. **Plan caveat:** Vercel Hobby allows only one cron run per day and may fire within a ~1-hour window; Pro gives precise scheduling and multiple jobs. A daily report fits Hobby, but precise 9:00 timing and `/add`-driven flexibility favor Pro.

### Secrets / env management
Store as Vercel Environment Variables (Production + Preview), pulled locally via `vercel env pull`:
- `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`
- `GSC_SA_EMAIL`, `GSC_SA_PRIVATE_KEY` (escape newlines, or base64-encode the whole JSON and decode at runtime)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (auto-injected if you install Upstash via the Vercel Marketplace integration)
- `CRON_SECRET`, plus `REPORT_CHANNEL_ID` and `REPORT_TZ`
Never commit the Service Account JSON to the repo.

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

**If staying on Vercel Hobby:**
- One cron/day is fine for the morning report, but timing is approximate (±1h) and you can't add a second schedule.
- Because `/add`/`/remove`/`/list` are HTTP-triggered (not cron), they work fully on Hobby.

**If precise 9:00 AM and DST-correct timing matter:**
- Either upgrade to Pro (precise UTC scheduling) or run the cron hourly and gate execution inside the function against `REPORT_TZ` so it fires once at local 9:00 regardless of DST.

**If the client list later needs structured config (per-client channels, thresholds):**
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

---
*Stack research for: Slack GSC reporting bot on Vercel serverless*
*Researched: 2026-06-25*
</content>
</invoke>
