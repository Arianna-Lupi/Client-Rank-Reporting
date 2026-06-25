---
phase: 02-client-management
plan: 01
subsystem: client-management
tags: [site-match, persistence, tdd]
requires:
  - lib/clients.ts (Phase 1 getActiveClients + getRedis + ActiveClientReader)
  - lib/gsc.ts (GscSite canonical siteUrl contract)
provides:
  - normalizeSiteRef + resolveSiteRef (pure site matching)
  - addClient + removeClient (injectable Redis writer)
  - ActiveClientWriter interface
affects:
  - lib/commands/add.ts (wave 2, consumes resolveSiteRef + addClient)
  - lib/commands/remove.ts (wave 2, consumes resolveSiteRef + removeClient)
tech-stack:
  added: []
  patterns:
    - Pure side-effect-free matching behind unit tests
    - Injectable Redis writer mirrors the Phase 1 reader pattern
key-files:
  created:
    - lib/site-match.ts
    - lib/site-match.test.ts
    - lib/clients.test.ts
  modified:
    - lib/clients.ts
decisions:
  - "Exact canonical equality wins before normalized matching (locked CONTEXT precedence: exact -> normalized single -> multiple -> none)"
  - "normalizeSiteRef strips sc-domain:/scheme/www/trailing-slash then lowercases; pure string function, no I/O"
  - "addClient/removeClient default writer to lazy getRedis() so production needs no wiring"
metrics:
  duration: ~6 min
  completed: 2026-06-25
---

# Phase 2 Plan 01: Site-Match + Clients Write Foundation Summary

Pure `normalizeSiteRef`/`resolveSiteRef` matching plus `addClient`/`removeClient` on an injectable Redis SET writer, both exhaustively unit-tested offline over the five real GSC fixtures and synthetic multi/none cases.

## What Was Built

- **lib/site-match.ts** — `normalizeSiteRef(input)` reduces any ref to a lowercased bare host (strips `sc-domain:`, scheme, `www.`, trailing slash). `resolveSiteRef(input, candidates)` returns a discriminated `ResolveResult` (`match`/`multiple`/`none`) with exact canonical equality short-circuiting normalized ambiguity.
- **lib/clients.ts** (extended) — added `ActiveClientWriter` (sadd/srem) and `addClient`/`removeClient`, both defaulting their writer to the existing lazy `getRedis()`. `getActiveClients`/`ActiveClientReader` untouched.
- **Tests** — `lib/site-match.test.ts` (11 cases) and `lib/clients.test.ts` (4 cases) with a hand-rolled fake writer; no live Upstash/GSC.

## TDD Gate Compliance

Both tasks followed RED -> GREEN. Test commits (`2ea9b59`, `5ff5fb0`) precede their feat commits (`3c21eae`, `012dcde`).

## Task Commits

| Task | Description | Commit |
| ---- | ----------- | ------ |
| 1 (RED) | failing site-match tests | 2ea9b59 |
| 1 (GREEN) | normalizeSiteRef + resolveSiteRef | 3c21eae |
| 2 (RED) | failing addClient/removeClient tests | 5ff5fb0 |
| 2 (GREEN) | addClient + removeClient | 012dcde |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Non-null assertion on single normalized match**
- **Found during:** Task 2 typecheck
- **Issue:** `tsconfig` `noUncheckedIndexedAccess` typed `matches[0]` as `string | undefined`, failing `tsc --noEmit`.
- **Fix:** Added `matches[0]!` (safe — guarded by the `length === 1` branch).
- **Files modified:** lib/site-match.ts
- **Commit:** 2dcec1f

## Verification

- `npx vitest run lib/site-match.test.ts` — 11 passed
- `npx vitest run lib/clients.test.ts` — 4 passed
- `npm test` — 26 passed (Phase 1's 11 still green)
- `npm run typecheck` — clean
- Purity check on lib/site-match.ts — 0 matches for `process.env|Redis|fetch`

## Self-Check: PASSED

- lib/site-match.ts — FOUND
- lib/site-match.test.ts — FOUND
- lib/clients.test.ts — FOUND
- Commits 2ea9b59, 3c21eae, 5ff5fb0, 012dcde, 2dcec1f — FOUND
