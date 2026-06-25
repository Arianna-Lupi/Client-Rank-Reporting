---
phase: 02-client-management
plan: 02
subsystem: client-management
tags: [commands, slack, tdd]
requires:
  - lib/site-match.ts (resolveSiteRef)
  - lib/clients.ts (getActiveClients, addClient, removeClient)
  - lib/gsc.ts (listReadableSites, GscSite)
provides:
  - handleAdd (resolve against readable sites, then add)
  - handleRemove (resolve against active set, then remove)
  - AddDeps / RemoveDeps injectable contracts
affects:
  - lib/commands/router.ts (wave 3 dispatcher consumes these)
tech-stack:
  added: []
  patterns:
    - Command handlers as injectable async functions returning ephemeral text
    - Add resolves against readable sites; remove resolves against the active set
key-files:
  created:
    - lib/commands/add.ts
    - lib/commands/add.test.ts
    - lib/commands/remove.ts
    - lib/commands/remove.test.ts
  modified: []
decisions:
  - "handleAdd resolves against live readable sites.list; handleRemove resolves against the active set (a property removable even if no longer readable)"
  - "Writers only ever receive result.siteUrl from resolveSiteRef — raw user text is never persisted (T-02-03 mitigation)"
  - "Lost-race removeClient (srem 0) returns the same 'no estaba en el reporte' message"
metrics:
  duration: ~5 min
  completed: 2026-06-25
---

# Phase 2 Plan 02: Command Handlers Summary

`handleAdd` and `handleRemove` as injectable async functions returning neutral-Spanish ephemeral text, composing wave 1's `resolveSiteRef` with the clients repository — all branch logic behind unit tests so wave 3 is pure routing.

## What Was Built

- **lib/commands/add.ts** — `handleAdd(arg, deps?)`: trims arg (empty -> usage hint), resolves against `listReadableSites()` siteUrls, then `none` (+/list hint), `multiple` (lists canonical candidates), or `match` -> `addClient` with newly-added vs already-present replies.
- **lib/commands/remove.ts** — `handleRemove(arg, deps?)`: resolves against `getActiveClients()`, mirrored branches, removing canonical-only with lost-race safety. No `listReadableSites` import.
- **Tests** — `add.test.ts` (5 cases) + `remove.test.ts` (5 cases) with injected fake sites/reader/writer; no live GSC/Upstash. Each asserts the writer never receives the raw argument and is never called on none/multiple.

## TDD Gate Compliance

Both tasks followed RED -> GREEN. Test commits (`7536741`, `7e98c55`) precede their feat commits (`3fae8ad`, `5bf877d`).

## Task Commits

| Task | Description | Commit |
| ---- | ----------- | ------ |
| 1 (RED) | failing handleAdd tests | 7536741 |
| 1 (GREEN) | handleAdd | 3fae8ad |
| 2 (RED) | failing handleRemove tests | 7e98c55 |
| 2 (GREEN) | handleRemove | 5bf877d |

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `npx vitest run lib/commands/add.test.ts` — 5 passed
- `npx vitest run lib/commands/remove.test.ts` — 5 passed
- `npm test` — 36 passed (Phase 1's 11 + wave-1 + wave-2 all green)
- `npm run typecheck` — clean
- `grep -c listReadableSites lib/commands/remove.ts` — 0 (remove resolves against the active set)

## Self-Check: PASSED

- lib/commands/add.ts — FOUND
- lib/commands/add.test.ts — FOUND
- lib/commands/remove.ts — FOUND
- lib/commands/remove.test.ts — FOUND
- Commits 7536741, 3fae8ad, 7e98c55, 5bf877d — FOUND
