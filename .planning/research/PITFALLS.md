# Pitfalls Research

**Domain:** Daily GSC reporting Slack bot on Vercel serverless (Node + Slack Bolt + googleapis + KV)
**Researched:** 2026-06-25
**Confidence:** HIGH (Slack/Vercel/GSC behaviors verified against official docs and multiple corroborating sources)

## Critical Pitfalls

### Pitfall 1: Computing "% vs día anterior" against the wrong / incomplete day (GSC lag)

**What goes wrong:**
The bot reports a metric that swings wildly (e.g. "clics -80%") not because the client dropped, but because it compared a *partial/fresh* day against a *finalized* day, or compared "yesterday" (which has no data yet) against "the day before". GSC finalizes data with a ~2-3 day lag; querying a fixed `today - 1` returns zeros or partial numbers.

**Why it happens:**
Developers reach for `new Date()` minus one day, assuming GSC behaves like a real-time analytics product. It does not. By default the Search Analytics API returns only **finalized** data (~2 day lag). With `dataState: "all"` you get **fresh** (volatile) data for the most recent 1-2 days, but those days are flagged incomplete via `metadata.first_incomplete_date` and will change later. Mixing a fresh day with a final day produces a meaningless delta.

**How to avoid:**
- Do **not** hardcode dates. Query a window (e.g. last 10 days) with `dimensions: ["date"]` and `dataState: "final"`, then pick the **most recent date that actually returned rows** as "latest", and the date immediately before it as "previous". Compare like-for-like (final vs final).
- Be explicit about consistency: always use the same `dataState` for both days of the comparison. Pick `final` for stability (recommended for a daily digest) so numbers never retroactively change.
- Guard the percentage math: if the previous value is `0`, do not divide (Infinity / NaN). Render "nuevo" / "—" instead. Round position deltas separately (lower position = better, so a *decrease* in average position is an improvement — label direction explicitly).
- Treat CTR as derived (clicks/impressions), not as a metric to "average"; recompute it per day rather than averaging GSC's per-row CTR.

**Warning signs:**
Reports showing 0 / -100% across all clients on the same day; deltas that flip every day; CTR that doesn't equal clicks/impressions; first run looks fine but numbers change a day later (means you used fresh data).

**Phase to address:**
GSC data layer / reporting-logic phase (the metric-computation core). This is the highest-value correctness phase — write unit tests for the date-selection and delta functions.

---

### Pitfall 2: GSC reporting day is Pacific Time, not the bot's local/UTC day

**What goes wrong:**
The "day" boundaries in GSC are in America/Los_Angeles (Pacific). If the bot computes date ranges in UTC or in the agency's local timezone, it can request a date that GSC considers the wrong/incomplete day, causing off-by-one comparisons or empty results near day boundaries.

**Why it happens:**
GSC data is bucketed by Pacific-time calendar days. Developers assume the dates they pass are timezone-neutral or follow their own locale. Combined with Pitfall 1, this produces subtle "why is today missing" bugs.

**How to avoid:**
- Because Pitfall 1's fix selects "latest date that has data" empirically rather than computing a fixed target date, this largely self-corrects — but still build all date arithmetic in a fixed, explicit timezone. Use a date library (e.g. `date-fns-tz` / Luxon) and reason about GSC dates as plain `YYYY-MM-DD` strings, never as `Date` objects coerced through local/UTC offsets.
- Never use `toISOString().slice(0,10)` on a local `Date` to derive a GSC date — that silently shifts the day for anyone east/west of UTC.

**Warning signs:**
Latest available date appears to "arrive" a day late or early; results differ depending on what time of day the cron runs.

**Phase to address:**
GSC data layer phase (same date-handling module as Pitfall 1).

---

### Pitfall 3: Vercel Cron runs in UTC — 9 AM local will drift / be wrong

**What goes wrong:**
The requirement is a 9:00 AM local report. Vercel Cron schedules are **always UTC** and cannot be set to a named timezone. A naive `0 9 * * *` fires at 9 AM UTC, which is the middle of the night or late morning depending on the agency's actual zone, and **breaks twice a year at DST transitions**.

**Why it happens:**
`vercel.json` cron syntax looks like standard cron, so developers assume it honors a timezone. It does not. Vercel also rejects some cron sugar (no `MON`/`JAN` names, can't set day-of-month and day-of-week together).

**How to avoid:**
- Pick the UTC hour that corresponds to 9 AM in the target zone and document the DST caveat. For a single fixed zone, the simplest robust approach: schedule the cron to run **more frequently** (e.g. hourly, or twice around the target window) and have the handler check "is it currently 9 AM in `REPORT_TZ`? and have I not posted today?" before posting. This survives DST automatically.
- Keep the target timezone in an env var (`REPORT_TZ`, e.g. `America/...`) per the requirement that it's configurable; compute the local hour with a tz-aware library inside the handler, not in the cron string.
- Note Hobby-plan cron limits (limited frequency / once-per-day granularity on free tier) — verify the plan supports the chosen schedule before relying on hourly checks. On Pro, hourly+ is available.

**Warning signs:**
Report arrives at the wrong hour; arrives correctly for months then shifts by an hour after a DST change; cron silently not firing (plan frequency limit).

**Phase to address:**
Scheduling / cron phase. Verification: confirm the posted-at timestamp matches 9 AM `REPORT_TZ` across a simulated DST boundary.

---

### Pitfall 4: Slack's 3-second timeout → retries → duplicate work / failed commands

**What goes wrong:**
A slash command (`/add`, `/remove`, `/list`) that does real work (calls GSC, reads/writes KV) before responding can exceed Slack's hard **3-second** ACK deadline. Slack then shows `operation_timeout` to the user **and** retries, which can double-execute side effects.

**Why it happens:**
On serverless, cold starts plus a `googleapis` call (especially `/list`, which enumerates GSC properties) routinely blow past 3s. Developers do the work synchronously and return the result in the same response.

**How to avoid:**
- ACK within 3s **first**, then do the work. Two patterns:
  1. Respond immediately with an ephemeral "Procesando…" (HTTP 200), then POST the real result to the command's `response_url` (valid ~30 min, up to 5 delayed responses).
  2. For trivial, fast commands keep it inline, but budget for cold start.
- For `/list` (the slowest — it hits GSC), always use the deferred `response_url` pattern.
- Keep the Service Account / googleapis client initialized at module scope so warm invocations reuse it.

**Warning signs:**
Users see `operation_timeout` / "failed with the error"; a client gets added twice; intermittent failures correlated with cold starts.

**Phase to address:**
Slack slash-command phase. Verification: cold-start a `/list` and confirm ACK < 3s and result delivered via `response_url`.

---

### Pitfall 5: Cron retry / double-invocation → duplicate daily posts

**What goes wrong:**
The same daily report gets posted to the channel two (or more) times. Causes: Vercel re-invoking on transient failure, the hourly-check pattern from Pitfall 3 firing twice in the 9 AM hour, a manual re-deploy/redeploy triggering the function, or a partial failure mid-run that gets retried after some clients already posted.

**Why it happens:**
Serverless handlers are not idempotent by default. There's no built-in "I already ran today" memory because the runtime is ephemeral.

**How to avoid:**
- Idempotency key in KV: before posting, set a key like `report:posted:<YYYY-MM-DD in REPORT_TZ>` with a TTL (~36h). Use an atomic set-if-not-exists (`SET key val NX`) so concurrent invocations can't both win. Only the invocation that successfully claims the key posts.
- For per-client resilience, track which clients already posted today (`report:posted:<date>:<property>`), so a mid-run retry resumes rather than re-posting clients already done.
- Protect the cron endpoint with `CRON_SECRET` (Vercel sets `Authorization: Bearer $CRON_SECRET`) so nothing else can trigger a post.

**Warning signs:**
Two identical report blocks in the channel; duplicates appear after a redeploy or on days with a transient GSC/Slack error.

**Phase to address:**
Scheduling / posting phase, built jointly with the KV persistence phase (idempotency depends on KV).

---

### Pitfall 6: Slack signature verification fails on serverless (parsed body)

**What goes wrong:**
Signature verification returns 401 for legitimate Slack requests, or (worse) is skipped entirely. The bot either rejects all commands or accepts unauthenticated/replayed requests.

**Why it happens:**
Slack signs the **raw, unaltered request body** (`v0:timestamp:rawBody`, HMAC-SHA256 with the signing secret). Serverless frameworks (including Vercel's default body parser) parse JSON / urlencoded bodies before your handler sees them, so re-serializing produces a different string and the HMAC won't match. Also the timestamp must be within **5 minutes** (replay protection).

**How to avoid:**
- Capture the **raw body** before any parsing. On Vercel, disable the automatic body parser for the Slack route (`export const config = { api: { bodyParser: false } }` in the relevant runtime, or read the raw stream) and parse manually after verifying.
- If using `@slack/bolt`'s built-in receiver, let it handle verification, but ensure the adapter passes the raw body (the standard pitfall is wrapping Bolt in a way that strips it).
- Use a constant-time compare (`crypto.timingSafeEqual`), validate the 5-minute timestamp window, and store the signing secret in `SLACK_SIGNING_SECRET`.

**Warning signs:**
All commands 401 in production but work locally; verification "works" only because it's actually disabled; sporadic failures when clocks drift (timestamp window).

**Phase to address:**
Slack integration / security phase (first thing built for the HTTP endpoint).

---

### Pitfall 7: Service Account private key newline escaping in env vars

**What goes wrong:**
Auth to GSC fails with `error:1E08010C:DECODER routines::unsupported` or `Invalid PEM formatted message` / `Failed to parse private key`. Works locally, breaks on Vercel.

**Why it happens:**
The PEM private key is multi-line. Stored in an env var, the real newlines must be encoded as literal `\n`. Platforms mangle this: Vercel may strip or alter newlines, and `JSON.parse`/quoting differences mean the `\n` sequences don't become real newlines at runtime, so the OpenSSL decoder rejects the key.

**How to avoid:**
- Pick **one** canonical encoding and handle it consistently. Robust options:
  1. Base64-encode the entire Service Account JSON, store as a single env var, and `Buffer.from(x, 'base64')` + `JSON.parse` at runtime. This sidesteps all newline issues entirely (recommended).
  2. Or store `GOOGLE_PRIVATE_KEY` with literal `\n` and apply `key.replace(/\\n/g, '\n')` at startup — but test it on Vercel, not just locally.
- Never commit the JSON. Verify auth in a Vercel preview deployment, not just `vercel dev`.

**Warning signs:**
`DECODER routines::unsupported`, `Invalid PEM`, auth works in `vercel dev` but 500s in deployed function; the `replace(/\n/g,'\n')` no-op (note: `\n→\n` does nothing — must be `\\n→\n`).

**Phase to address:**
GSC auth phase (foundational — nothing works until this is solid). Use base64-JSON to eliminate the class of bug.

---

### Pitfall 8: GSC property URL format mismatch (sc-domain: vs URL-prefix)

**What goes wrong:**
`/list` returns properties but `/add <cliente>` or the daily query returns "permission denied" / empty data because the `siteUrl` passed to the API doesn't exactly match a verified property. Domain properties are `sc-domain:example.com`; URL-prefix properties are full URLs like `https://www.example.com/` (trailing slash, scheme, and `www` all matter).

**Why it happens:**
Users think in terms of "the client" (a bare domain), but the API requires the exact verified `siteUrl` string. A domain may exist as a domain-property, a URL-prefix property, both, or neither, and a Service Account only sees properties it's been granted on.

**How to avoid:**
- Drive `/add` from the canonical `siteUrl` strings returned by `sites.list()` — don't let users type free-form domains that you then guess-format. Store the exact `siteUrl` in KV as the key.
- When matching user input, normalize and resolve against the real list; if ambiguous (both domain + URL-prefix exist), ask which one or prefer the domain property.
- Confirm the Service Account email is added as a user on every property to be reported (this is the #1 "0 rows" cause).

**Warning signs:**
`/add` succeeds but daily report shows no data for that client; `User does not have sufficient permission for site`; mismatch between what `/list` shows and what queries accept.

**Phase to address:**
Client-management (`/add`/`/remove`/`/list`) + GSC data phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcoded UTC cron hour for 9 AM local | One line in vercel.json | Wrong time + breaks at every DST change | Never for a user-facing daily time; use hourly-check + tz |
| Synchronous slash-command handler (work before ACK) | Simpler code, no `response_url` plumbing | 3s timeouts, duplicate executions on retry | Only for trivially fast commands with warm functions |
| Fixed `today-1` date for the report | Trivial date math | Empty/partial data, nonsense deltas | Never — must select latest-with-data |
| Skip idempotency key | Less KV code | Duplicate daily posts on any retry | Never for the cron post |
| `\n`-replace private key (not base64) | Familiar pattern | Fragile across platforms/redeploys | OK if verified on Vercel preview; base64 is safer |
| Store client list in code/JSON file | No KV dependency | Lost on every deploy; `/add` doesn't persist | Never — requirement is persistence |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Slack slash commands | Returning result in the initial response (>3s) | ACK fast, deliver via `response_url` |
| Slack signing | Verifying against re-serialized parsed body | Verify raw body, 5-min window, timingSafeEqual |
| Slack messages | Posting all clients in one giant message | One message per client (per PROJECT decision); watch block limits |
| Vercel Cron | Assuming timezone support | UTC only; do tz logic in handler; protect with CRON_SECRET |
| GSC Search Analytics | Mixing `dataState: all` (fresh) with final days | Use one consistent `dataState`; select latest-with-data |
| GSC auth | Service Account not added to each property | Grant SA email read access per property; query exact `siteUrl` |
| googleapis on serverless | New client per invocation | Init client at module scope; reuse on warm |
| Vercel KV / Upstash | Non-atomic read-then-write for idempotency | Atomic `SET NX` with TTL |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Sequential GSC calls per client in cron | Cron approaches function timeout | Parallelize with concurrency cap; stay under timeout | ~15-30+ clients |
| `/list` enumerating all properties live every call | Slow `/list`, 3s timeout | Deferred `response_url`; optional short KV cache | Cold start + many properties |
| Function timeout too low for full run | Report truncated / partial post | Set adequate `maxDuration`; chunk if needed | More clients than fit in the window |
| Cold start on every slash command | Intermittent 3s timeouts | Warm-friendly code; deferred responses | Low-traffic internal tool (always cold) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Skipping/incorrect Slack signature verification | Anyone can POST fake commands, spoof `/remove` | Verify HMAC on raw body + 5-min window |
| Unprotected cron endpoint | External actor triggers spam reports | `CRON_SECRET` Bearer check on the route |
| Committing Service Account JSON / signing secret | Full read access to all clients' GSC leaked | Env vars only (base64 JSON); never in repo |
| Over-broad Service Account permissions | Larger blast radius if key leaks | Read-only, scoped to needed properties |
| Logging request bodies / tokens | Secrets in Vercel logs | Redact; never log signing secret or key |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Reporting raw deltas without direction labels | Team misreads "position -2" as bad when it's good | Label improvements explicitly (posición: mejor/peor) |
| Showing -100% when previous day was 0 | Looks like a crash, erodes trust | Render "nuevo"/"sin datos previos" instead |
| Not stating which dates are compared | Team can't tell the report has lag | Print "Datos del DD/MM vs DD/MM (lag GSC)" in each message |
| Silent failure when a client has no data | Missing client looks like it was removed | Post explicit "sin datos disponibles" line per client |
| `/add` accepting free-form domain | Adds a `siteUrl` that never returns data | Resolve against real `sites.list()` values |
| Report not in Spanish / wrong number format | Inconsistent with agency standard | Spanish labels, locale number/percent formatting |

## "Looks Done But Isn't" Checklist

- [ ] **Daily report:** Often missing idempotency — verify a forced retry does NOT double-post
- [ ] **Percentage delta:** Often missing zero/Infinity guard — verify behavior when previous day = 0
- [ ] **Date selection:** Often missing lag handling — verify it picks latest-with-data, not `today-1`
- [ ] **9 AM schedule:** Often missing DST safety — verify correct hour across a DST boundary in `REPORT_TZ`
- [ ] **Slash commands:** Often missing fast ACK — verify cold-start `/list` ACKs < 3s
- [ ] **Signature check:** Often "passing" because it's disabled — verify a tampered body is rejected (401)
- [ ] **Private key:** Often only tested locally — verify auth succeeds in a deployed Vercel function
- [ ] **Property format:** Often missing sc-domain vs URL-prefix — verify `/add` stores exact `siteUrl`
- [ ] **Cron endpoint:** Often unprotected — verify a request without `CRON_SECRET` is rejected
- [ ] **Client persistence:** Often lost on deploy — verify `/add` survives a redeploy (KV, not file)

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Duplicate daily posts | LOW | Add `SET NX` idempotency key; delete dupes manually; redeploy |
| Wrong report hour (UTC/DST) | LOW | Switch to hourly-check + tz-aware handler; redeploy |
| Private key auth failing in prod | LOW | Re-store as base64 JSON env var; redeploy |
| Signature verification 401s | MEDIUM | Capture raw body (disable bodyParser), re-test with Slack |
| Nonsense deltas (lag/dataState) | MEDIUM | Rewrite date-selection to latest-with-data + consistent dataState; add tests |
| Client list lost on deploy | MEDIUM | Migrate from file/code to KV; re-add clients via `/add` |
| SA missing property permissions | LOW | Add SA email to each GSC property; no code change |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| % delta / GSC lag / dataState | GSC data + reporting-logic | Unit tests: zero-prev, latest-with-data, final-vs-final |
| Pacific-time day boundaries | GSC data (date module) | Same-result regardless of run hour |
| Cron UTC vs 9 AM local + DST | Scheduling phase | Post timestamp = 9 AM REPORT_TZ across DST |
| Slack 3s timeout / retries | Slash-command phase | Cold-start `/list` ACK < 3s, result via response_url |
| Duplicate daily posts | Scheduling + KV phase | Forced retry produces exactly one post |
| Slack signature verification | Slack security phase (first) | Tampered body → 401; valid → 200 |
| Private key newline escaping | GSC auth phase (foundational) | Auth OK in deployed function (base64 JSON) |
| sc-domain vs URL-prefix | Client-mgmt + GSC data | `/add` stores exact siteUrl; query returns rows |
| Cron endpoint protection | Scheduling/security phase | No-secret request rejected |

## Sources

- Vercel Cron Jobs docs — UTC-only scheduling, syntax limits, CRON_SECRET: https://vercel.com/docs/cron-jobs (HIGH)
- Vercel community — cron timezone behavior (JST example): https://community.vercel.com/t/when-do-vercel-cron-jobs-execute-in-jst-same-day-or-next-day/4817 (MEDIUM)
- Slack — Verifying requests from Slack (v0 sig, raw body, 5-min window): https://docs.slack.dev/authentication/verifying-requests-from-slack/ (HIGH)
- Slack 3s timeout + X-Slack-Retry-Num duplicate handling: https://github.com/slackapi/bolt-python/issues/731 ; https://dev.to/jeremy_longshore/debugging-slack-integration-from-6-duplicate-responses-to-instant-acknowledgment-36ij (MEDIUM)
- Delayed responses via response_url: https://claudiajs.com/tutorials/slack-delayed-responses.html (MEDIUM)
- GSC Search Performance fresh vs final data (dataState, ~2-day lag): https://developers.google.com/search/blog/2019/09/search-performance-fresh-data ; https://support.google.com/webmasters/thread/216128633 (HIGH)
- GSC reporting timezone is Pacific: https://support.google.com/webmasters/thread/10467744/timezone-used-in-search-console-reporting (MEDIUM)
- Service Account private key newline / PEM on Vercel: https://github.com/gladly-team/next-firebase-auth/discussions/95 ; https://dev.to/cfofiu/how-to-store-a-long-private-key-in-vercel-s-environment-variables-46f5 (MEDIUM)

---
*Pitfalls research for: Daily GSC reporting Slack bot on Vercel serverless*
*Researched: 2026-06-25*
