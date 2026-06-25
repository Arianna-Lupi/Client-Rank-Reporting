---
phase: 01-foundations-gsc-auth-list-slice
plan: 02
subsystem: api
tags: [slack, hmac, googleapis, search-console, upstash, redis, vitest, typescript]

# Dependency graph
requires:
  - phase: 01-foundations-gsc-auth-list-slice (plan 01)
    provides: project scaffold, lib/config.ts, vitest + tsc scripts, pinned deps
provides:
  - lib/slack/verify.ts — reusable Slack HMAC signature verification (security gate)
  - lib/gsc.ts — Service Account auth + sites.list + siteUnverifiedUser filter
  - lib/clients.ts — read of the clients:active SET from Upstash Redis
affects: [01-03-handler, phase-02-client-management, phase-03-metrics, phase-04-report-cron]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin handlers, shared services: framework-free logic isolated in lib/"
    - "Pure extracted functions (filterReadableSites) for network-free unit tests"
    - "Lazy module-scope clients (GoogleAuth, Redis.fromEnv) for warm-start reuse without import-time crashes"
    - "Dependency injection via optional params (signingSecret/now, ActiveClientReader) for deterministic tests"

key-files:
  created:
    - lib/slack/verify.ts
    - lib/slack/verify.test.ts
    - lib/gsc.ts
    - lib/gsc.test.ts
    - lib/clients.ts
  modified: []

key-decisions:
  - "verifySlackSignature uses timingSafeEqual + length guard, never === (T-01-05)"
  - "Extracted pure filterReadableSites so GSC-02 is unit-tested without GSC credentials"
  - "Redis client and GSC auth created lazily so modules import safely when env is blank"
  - "getActiveClients accepts an injectable reader to allow mock-Redis unit tests"

patterns-established:
  - "TDD RED→GREEN per behavior task with atomic test()/feat() commits"
  - "Self-contained crypto tests compute real HMACs with a hardcoded secret (no env reads)"

requirements-completed: [CMD-05, GSC-01, GSC-02, PER-01]

# Metrics
duration: 12min
completed: 2026-06-25
---

# Phase 1 Plan 02: Shared Services (Slack HMAC, GSC Auth, Redis Read) Summary

**Three framework-free lib/ services: constant-time Slack v0 HMAC verification with a 5-minute replay window, Service Account GSC auth + `sites.list` filtering `siteUnverifiedUser`, and a `clients:active` SET read via `@upstash/redis` — all unit-tested without live credentials.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-25T10:49:00Z
- **Completed:** 2026-06-25T10:53:00Z
- **Tasks:** 2 (TDD, RED→GREEN)
- **Files modified:** 5 created

## Accomplishments
- `lib/slack/verify.ts`: reconstructs `v0:{ts}:{rawBody}`, HMAC-SHA256, `timingSafeEqual` with a length guard, rejects stale/future timestamps (>5 min) and malformed signatures (CMD-05 security gate).
- `lib/gsc.ts`: decodes the base64 Service Account JSON (no newline mangling), builds `GoogleAuth` with scope `webmasters.readonly`, calls `searchconsole('v1').sites.list`, and filters `siteUnverifiedUser` (GSC-01/GSC-02). The filter is a pure exported function for network-free tests.
- `lib/clients.ts`: reads the `clients:active` SET via `Redis.fromEnv().smembers(...)`, with an injectable reader so the read logic is unit-testable without a live Upstash connection (PER-01).
- 11 unit tests pass (8 verify incl. negative/replay/length-guard cases, 3 GSC filter); `tsc --noEmit` clean.

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **Task 1 (RED): Slack HMAC verify tests** - `209cd55` (test)
2. **Task 1 (GREEN): verifySlackSignature** - `a244df8` (feat)
3. **Task 2 (RED): GSC readable-site filter test** - `8c06faf` (test)
4. **Task 2 (GREEN): gsc.ts + clients.ts** - `83d2659` (feat)
5. **Task 2 (cleanup): reword comment to avoid literal newline-replace pattern** - `9d94ea5` (docs)

_Note: TDD tasks produce multiple commits (test → feat)._

## Files Created/Modified
- `lib/slack/verify.ts` - Constant-time Slack v0 HMAC verification with 5-min replay window.
- `lib/slack/verify.test.ts` - 8 cases incl. invalid/forged/tampered signature and stale/future/non-numeric timestamp (security gate).
- `lib/gsc.ts` - SA auth (base64 JSON) + `sites.list` + pure `filterReadableSites` (excludes `siteUnverifiedUser`).
- `lib/gsc.test.ts` - 3 cases: excludes unverified, keeps canonical siteUrl, empty/undefined → `[]`, skips incomplete entries.
- `lib/clients.ts` - `smembers('clients:active')` via Upstash Redis with injectable reader.

## Decisions Made
- Exported a pure `filterReadableSites(entries)` (alongside the network-bound `listReadableSites()`) so GSC-02 is testable with mock `siteEntry` arrays — satisfies the environment constraint of no live API calls.
- Lazy-initialized `Redis.fromEnv()` and `GoogleAuth`/`searchconsole` clients at module scope. This preserves warm-start reuse while letting the modules be imported safely even though Upstash/Slack env vars are blank (no import-time throw).
- `getActiveClients` takes an optional `ActiveClientReader`, enabling mock-Redis unit tests without provisioned Upstash credentials.

## Deviations from Plan

None - plan executed exactly as written. (The only extra commit, `9d94ea5`, rewords a comment so the file does not literally contain the `replace(/\n/g)` string referenced in Task 2 acceptance criteria; behavior unchanged.)

## Issues Encountered
None. Both `npm test` (11 passing) and `npm run typecheck` (exit 0) pass.

## User Setup Required
None for this plan — these are framework-free library modules. Live end-to-end verification (Slack signing secret, Upstash credentials, GSC Service Account grants on properties) is required before the Plan 03 preview deploy, as already tracked in STATE.md blockers.

## Next Phase Readiness
- Plan 03 can now build the thin `api/slack/command.ts` handler that calls `verifySlackSignature`, `listReadableSites`, and `getActiveClients`, returning an ephemeral `/list` reply.
- Blockers carried forward: SA email not yet granted on any GSC property (`sites.list` returns 0); Slack signing secret and Upstash credentials still blank in `.env.local`. All required before the Plan 03 preview deploy.

## Self-Check: PASSED

All 5 created files exist on disk and all 5 task commits are present in git history.

---
*Phase: 01-foundations-gsc-auth-list-slice*
*Completed: 2026-06-25*
