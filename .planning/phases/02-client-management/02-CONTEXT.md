# Phase 2: Client Management - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning
**Mode:** Decisions locked by Claude (delegated by Juan; code-ahead while Slack signing secret is pending)

<domain>
## Phase Boundary

Self-service management of which GSC properties enter the daily report, via `/add <cliente>` and `/remove <cliente>`, validated against the live `sites.list` and storing canonical `siteUrl` values in the Redis SET `clients:active`. Code + unit tests only this round — the live end-to-end verification reuses Phase 1's deploy checkpoint (pending Slack signing secret from Arianna).

</domain>

<decisions>
## Implementation Decisions

### Command dispatch
- Refactor `api/slack/command.ts` into a dispatcher: verify HMAC once, then route on the Slack `command` field (`/list`, `/add`, `/remove`) to handlers in `lib/commands/`. `/list` logic moves to `lib/commands/list.ts` unchanged in behavior.
- New handlers: `lib/commands/add.ts`, `lib/commands/remove.ts`. Keeps the single Vercel function + single Slack Request URL (one endpoint, signature verified once).

### `/add <cliente>` resolution (CMD-01, CMD-04)
- Resolve the argument against the live readable `sites.list` (reuse `listReadableSites` from `lib/gsc.ts`):
  1. Exact match on canonical `siteUrl` (e.g. `sc-domain:ariannalupi.com` or `https://childrenchic.com/`) → use it.
  2. Else convenience match: normalize the input (strip scheme/`sc-domain:`/`www.`/trailing slash) and match against the same-normalized siteUrls.
     - Exactly one candidate → use it.
     - Multiple candidates → ephemeral error listing the canonical candidates, ask user to paste the exact one.
     - Zero candidates → ephemeral error "no es una propiedad legible por el bot" + hint to run `/list`.
- On resolved siteUrl: `SADD clients:active <siteUrl>`. If already present → ephemeral "ya estaba en el reporte". Else → ephemeral confirmation with the canonical siteUrl.
- Empty argument → ephemeral usage hint.

### `/remove <cliente>` (CMD-02, CMD-04)
- Resolve against the **current active set** (`clients:active`) using the same exact-then-normalized matching (do NOT require it to still be readable — a property could have lost access).
  - Exactly one match → `SREM` → ephemeral confirmation.
  - Multiple → list active candidates, ask to be specific.
  - Zero → ephemeral "no estaba en el reporte" + hint `/list` shows the ✓ ones.
- Empty argument → ephemeral usage hint.

### Persistence (extends Phase 1 `lib/clients.ts`)
- Add `addClient(siteUrl)` → `SADD clients:active`, returns whether it was newly added.
- Add `removeClient(siteUrl)` → `SREM clients:active`, returns whether it was present.
- Keep the injectable-client pattern from Phase 1 so all three are unit-testable without a live Upstash.

### Validation & messaging
- All responses ephemeral, in Spanish, never leak secrets or raw body.
- Normalization helper `normalizeSiteRef(input)` is a pure function in `lib/gsc.ts` (or `lib/site-match.ts`), unit-tested for: scheme strip, `sc-domain:` strip, `www.` strip, trailing slash, case-insensitive host.

### Permissions
- v1: anyone in the channel can `/add`/`/remove`. Allowlist + audit deferred to v2 (CMD-08).
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/slack/verify.ts` — HMAC verify (reuse in dispatcher).
- `lib/gsc.ts` — `listReadableSites`, `filterReadableSites`.
- `lib/clients.ts` — `getActiveClients` (read); extend with add/remove.
- `lib/config.ts` — env reader/validator.
- `api/slack/command.ts` — current single-command handler; refactor to dispatcher.

### Established Patterns
- Thin handler / shared `lib/` services; injectable Redis client for tests; Web-standard `POST(req: Request)` + raw body.

### Integration Points
- `api/slack/command.ts` dispatches to `lib/commands/{list,add,remove}.ts`.
</code_context>

<specifics>
## Specific Ideas

- Live GSC `sites.list` currently returns 5 readable properties (aprendoclub.com, childrenchic.com, ariannalupi.com, aprendoseo.com, nicmafia.com) — usable as real fixtures for normalization/match tests.
- Mixed `sc-domain:` and URL-prefix formats coexist in the account → normalization must handle both.
</specifics>

<deferred>
## Deferred Ideas

- Aliases legibles (CMD-06), `/report` on-demand (CMD-07), allowlist/audit (CMD-08) → v2.
- Live deploy/e2e verification → reuses Phase 1 deploy checkpoint (pending Slack secret).
</deferred>
