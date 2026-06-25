---
phase: 01-foundations-gsc-auth-list-slice
plan: 01
subsystem: infra
tags: [typescript, vercel, googleapis, upstash-redis, vitest, service-account, env-config]

# Dependency graph
requires: []
provides:
  - "TypeScript/Vercel project scaffold (package.json, tsconfig, vercel.json, vitest.config)"
  - "Fail-fast env config loader lib/config.ts (getConfig) — SCH-03"
  - "Locked dependency tree (googleapis@173, @upstash/redis@1, @vercel/node@5, vitest@^3.2.0) installed via package-lock.json"
  - ".env.example documenting all 6 env vars; .env.local populated (GSC SA + REPORT_TZ)"
  - "GSC Service Account auth validated live (token OK — GSC-01)"
affects: [01-02, 01-03, 02, 03, 04]

# Tech tracking
tech-stack:
  added: [googleapis, "@upstash/redis", "@vercel/node", typescript, vitest, "@types/node"]
  patterns:
    - "Fail-fast env config: getConfig() memoizes and names any missing var; secrets never logged (ASVS V7)"
    - "Thin handlers / shared services layout: api/ + lib/"
    - "SA credential as full JSON in base64 (GSC_SA_KEY_B64) — no escaped-newline private key"

key-files:
  created:
    - package.json
    - tsconfig.json
    - vercel.json
    - vitest.config.ts
    - .gitignore
    - .env.example
    - lib/config.ts
    - package-lock.json
  modified:
    - .gitignore

key-decisions:
  - "Pinned TypeScript to 5.x (^5.9.0), not 6.x, for @vercel/node compatibility (RESEARCH A1)"
  - "vitest pinned to ^3.2.0, confirmed/approved at the package-legitimacy gate"
  - "tsconfig moduleResolution Bundler + ESNext for TS/ESM + vitest DX; skipLibCheck on"
  - "vercel.json declares api/slack/command.ts as a Node function (maxDuration 10), NOT Edge"
  - ".gitignore ignores *.json with allowlist (package/tsconfig/vercel/lock) to block SA key commits"

patterns-established:
  - "lib/config.ts getConfig() as the single fail-fast entry for sensitive config"
  - "SA credential decoded from base64 JSON in memory; never written to repo"

requirements-completed: [SCH-03]

# Metrics
duration: ~25min (incl. human provisioning + package gate)
completed: 2026-06-25
---

# Phase 1 Plan 01: Foundations Scaffold + Fail-fast Config Summary

**TypeScript/Vercel scaffold with a fail-fast `lib/config.ts` env loader, locked official dependencies (googleapis/@upstash/redis/@vercel/node/vitest), and a live-validated GSC Service Account credential — the shared floor for Plans 02-03 and Phases 2-4.**

## Performance

- **Duration:** ~25 min (including human provisioning of the SA and the package-legitimacy gate)
- **Started:** 2026-06-25 (Task 2 scaffold)
- **Completed:** 2026-06-25
- **Tasks:** 3 (Task 2 autonomous; Tasks 1 & 3 satisfied via human verification)
- **Files modified:** 8 created, 1 modified

## Accomplishments

- Scaffolded the TS/Vercel project: pinned deps, strict ESM tsconfig, minimal Node-runtime vercel.json, vitest config, `.gitignore`, and a fully documented `.env.example` (all 6 env vars incl. `REPORT_TZ`).
- Built `lib/config.ts`: a memoized `getConfig()` that reads every sensitive value from `process.env`, throws naming any missing required var, defaults `REPORT_TZ` to `America/Mexico_City`, and never logs secret values (SCH-03 / ASVS V7).
- Approved package names against the official npm registry (T-01-SC mitigated) and ran `npm install`; `node_modules/` + `package-lock.json` exist, `tsc --noEmit` exits 0.
- Provisioned the GCP Service Account and populated `.env.local` with `GSC_SA_KEY_B64` (base64 of the full SA JSON) + `REPORT_TZ`. GSC auth validated live: token mint OK (GSC-01 works).
- Hardened secret hygiene: SA JSON (`Arianna's Website Reporting.json`) and `.env.local` confirmed git-ignored; neither is tracked.

## Task Commits

1. **Task 2: Scaffold + lib/config.ts** - `094c8a5` (feat)
2. **Task 3: Lock dependencies + ignore SA keys** - `802f63d` (chore)

**Plan metadata:** committed with SUMMARY/STATE/ROADMAP update.

_Task 1 (provisioning) and Task 3 (package-legitimacy gate) were satisfied via human verification — Juan approved the 4 package names against npmjs.com and provisioned the SA + `.env.local`._

## Files Created/Modified

- `package.json` - Pinned deps + `test`/`typecheck` scripts; `type: module`
- `tsconfig.json` - Strict ESM, target ES2022, Node types, noEmit
- `vercel.json` - Declares `api/slack/command.ts` as a Node function (NOT Edge)
- `vitest.config.ts` - Resolves `lib/**/*.test.ts` in TS/ESM, node environment
- `.gitignore` - Ignores `.env.local`, `.env*.local`, `.vercel`, and `*.json` (SA keys) with an allowlist
- `.env.example` - Documents all 6 env vars with origin, no real values
- `lib/config.ts` - Fail-fast `getConfig()` env loader
- `package-lock.json` - Locked dependency tree from the approved install

## Decisions Made

- Pinned TypeScript to `^5.9.0` (not 6.x) per RESEARCH A1 for `@vercel/node` compatibility.
- `vitest` pinned to `^3.2.0`, confirmed at the legitimacy gate.
- `.gitignore` uses `*.json` + allowlist so a Service Account key can never be committed accidentally (T-01-01).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Hardened `.gitignore` to block all `*.json` SA keys**
- **Found during:** Task 3 (provisioning closure)
- **Issue:** The real SA key landed in the repo root (`Arianna's Website Reporting.json`); a bare `.env.local` rule would not stop a stray JSON key from being committed.
- **Fix:** Added `*.json` ignore with an allowlist for `package.json`/`tsconfig.json`/`vercel.json`/`package-lock.json`. Verified with `git check-ignore` and a blocked `git add` dry-run.
- **Files modified:** `.gitignore`
- **Verification:** `git check-ignore "Arianna's Website Reporting.json"` returns the path; `git ls-files` shows no secrets tracked.
- **Committed in:** `802f63d`

---

**Total deviations:** 1 auto-fixed (1 missing-critical security control)
**Impact on plan:** Necessary for T-01-01 (secret-leak prevention). No scope creep.

## Issues Encountered

- **`sites.list` returns 0 properties (NOT a bug):** Live GSC auth succeeds (token OK), but `sites.list` returns zero entries because the SA email is not yet granted on any GSC property. This is the documented per-property dependency (RESEARCH Pitfall 4 / threat T-01-02 = accept). It is a pending human onboarding step, not a defect.

## User Setup Required

External service configuration is partially complete and partially deferred:

- **Done:** GCP Service Account created; `GSC_SA_KEY_B64` + `REPORT_TZ` populated in `.env.local`; GSC token auth validated live.
- **Pending before the Plan 03 deploy (its own deploy checkpoint will gate these):**
  1. **Grant the SA email on each GSC property** (`<sa>@<project>.iam.gserviceaccount.com` → Settings → Users and permissions). Without this, `sites.list` returns nothing and `/list` shows no properties.
  2. **Provision Slack** — `SLACK_SIGNING_SECRET` + `SLACK_CHANNEL_ID` (currently blank in `.env.local`).
  3. **Provision Upstash Redis** — `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (currently blank).

## Next Phase Readiness

- Scaffold, config loader, and locked deps are ready; `lib/config.ts` is the shared config entry for Plans 02-03.
- Plan 02 (verify.ts / gsc.ts / clients.ts + tests) can proceed: `vitest` and `tsc` both work.
- **Blocker for end-to-end verification (Plan 03):** Slack + Upstash credentials and the GSC per-property SA grant must be completed before the preview deploy.

## Self-Check: PASSED

- Files present: package.json, tsconfig.json, vercel.json, vitest.config.ts, .gitignore, .env.example, lib/config.ts, package-lock.json — all FOUND.
- Commits present: `094c8a5`, `802f63d` — both FOUND in git log.
- Secrets: `.env.local` and SA JSON confirmed git-ignored, none tracked.
- `tsc --noEmit` exit 0.

---
*Phase: 01-foundations-gsc-auth-list-slice*
*Completed: 2026-06-25*
