---
phase: 02-client-management
plan: 03
subsystem: client-management
tags: [dispatcher, slack, refactor, tdd]
requires:
  - lib/commands/add.ts (handleAdd)
  - lib/commands/remove.ts (handleRemove)
  - lib/slack/verify.ts (verifySlackSignature)
  - lib/config.ts (getConfig)
provides:
  - handleList + formatListReply (moved from Phase 1 shell)
  - dispatch router over the Slack command field
  - thin api/slack/command.ts shell (HMAC verify once -> parse -> dispatch -> ephemeral)
affects:
  - Phase 4 daily report (reuses listReadableSites/getActiveClients composition)
tech-stack:
  added: []
  patterns:
    - One Vercel function + one Slack Request URL, signature verified once
    - Routing testable in isolation under lib/; api/ shell stays thin wiring
key-files:
  created:
    - lib/commands/list.ts
    - lib/commands/list.test.ts
    - lib/commands/router.ts
    - lib/commands/router.test.ts
  modified:
    - api/slack/command.ts
decisions:
  - "/list logic moved verbatim into lib/commands/list.ts; Phase 1 output strings locked by list.test.ts"
  - "dispatch default branch returns the exact 'Comando no soportado.' string from the Phase 1 shell"
  - "Shell verifies HMAC and returns 401 before any URLSearchParams/dispatch call; cold-start getConfig() retained"
metrics:
  duration: ~5 min
  completed: 2026-06-25
---

# Phase 2 Plan 03: Dispatcher Shell Summary

Completed the command surface: moved `/list` into `lib/commands/list.ts` with byte-identical output, added a pure `dispatch` router over the Slack `command` field, and refactored `api/slack/command.ts` into a thin shell that verifies the HMAC once, parses, dispatches and wraps the reply ephemerally.

## What Was Built

- **lib/commands/list.ts** — `formatListReply` + `handleList` moved verbatim from the Phase 1 handler (same Spanish strings, same ✓/• logic, same `Promise.all` over `listReadableSites`/`getActiveClients`, now via injectable deps).
- **lib/commands/router.ts** — `dispatch(command, arg, deps?)`: switch routing `/list`/`/add`/`/remove` to their handlers; default returns "Comando no soportado.".
- **api/slack/command.ts** (refactored) — thin shell: raw body -> `verifySlackSignature` (401 on failure, before any parse) -> `URLSearchParams` -> `dispatch(command, text)` with no deps -> `ephemeral(...)`, wrapped in the existing generic-error try/catch. Removed the inlined `formatListReply` and the `/list`-specific branch. Retained the cold-start `getConfig()`.
- **Tests** — `list.test.ts` (4 cases, locks empty + populated output) + `router.test.ts` (5 cases, all routes + unknown + null), fakes only.

## TDD Gate Compliance

Task 1 followed RED -> GREEN: test commit `e84060e` precedes feat commit `04159f9`. Task 2 is a `type="auto"` refactor (no new behavior; covered by the moved-output lock and the existing verify.test.ts HMAC suite).

## Task Commits

| Task | Description | Commit |
| ---- | ----------- | ------ |
| 1 (RED) | failing list + router tests | e84060e |
| 1 (GREEN) | handleList + dispatch | 04159f9 |
| 2 | thin dispatcher shell refactor | 1534448 |

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `npx vitest run lib/commands/list.test.ts lib/commands/router.test.ts` — 9 passed
- Shell grep gate: `verifySlackSignature` present, `dispatch(` present, `formatListReply` absent -> SHELL_OK
- `npm test` — 45 passed (Phase 1's 11, including verify.test.ts HMAC gate, still green)
- `npm run typecheck` — clean
- No deploy / live-service calls attempted (live e2e reuses Phase 1's pending deploy checkpoint)

## Self-Check: PASSED

- lib/commands/list.ts — FOUND
- lib/commands/list.test.ts — FOUND
- lib/commands/router.ts — FOUND
- lib/commands/router.test.ts — FOUND
- api/slack/command.ts — FOUND (refactored)
- Commits e84060e, 04159f9, 1534448 — FOUND
