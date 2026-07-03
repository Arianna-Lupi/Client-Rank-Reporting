---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Weekly Per-Client Reports
status: roadmap_ready
last_updated: "2026-07-03T20:10:00.000Z"
last_activity: 2026-07-03
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-03)

**Core value:** Cada mañana el equipo ve, sin entrar a GSC, cómo se movió cada cliente día contra día directamente en Slack.
**Current focus:** Milestone v1.1 — Phase 5 (Weekly Window + Per-URL Metrics), roadmap ready, awaiting `/gsd:plan-phase 5`

## Current Position

Phase: 5 — Weekly Window + Per-URL Metrics (not started)
Plan: —
Status: Roadmap ready — v1.1 phases 5-7 mapped, awaiting planning
Last activity: 2026-07-03 — Milestone v1.1 roadmap created (Phases 5, 6, 7)

## Performance Metrics

**Velocity:**

- Total plans completed: 0 (v1.1)
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01 P01 | 25 | 3 tasks | 9 files |
| Phase 01 P02 | 12 | 2 tasks | 5 files |
| Phase 02 P01 | 6 | 2 tasks | 4 files |
| Phase 02 P02 | 5 | 2 tasks | 4 files |
| Phase 02 P03 | 5 | 2 tasks | 5 files |
| Phase 03 P01 | 4 | 2 tasks | 2 files |
| Phase 03 P02 | 3 | 1 task | 2 files |
| Phase 03 P03 | 3 | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- HTTP endpoint instead of Socket Mode (serverless-compatible)
- Service Account auth for GSC (unattended daily runs); base64-encode the whole SA JSON to avoid newline breakage on Vercel
- Upstash Redis for the active-client list (Vercel KV deprecated)
- lib/config.ts getConfig() is the single fail-fast entry for sensitive env config (SCH-03)
- [v1.1] Comparación semana vs semana (7d vs 7d previos), ventana móvil anclada al último día con datos
- [v1.1] 1 canal por cliente vía mapa en Redis (evita redeploy al cambiar canal)
- [v1.1] "tráfico" = impresiones; CTR y posición media se mantienen, no se reemplazan
- [v1.1] Extender el pipeline existente (cron diario + gsc.ts + delta core + Block Kit builder), no reconstruirlo

### Pending Todos

None yet.

### Blockers/Concerns

- Vercel plan (Hobby vs Pro) affects cron precision — Hobby allows ~1 cron/day with ~1h imprecision. v1.1 keeps the hourly-cron-gated-by-REPORT_TZ pattern; confirm plan before scheduling changes.
- GSC SA email not yet granted on any GSC property (sites.list returns 0); Slack + Upstash creds still blank in .env.local — required before any live e2e. Carried from v1.0 Plan 01-03 Task 2 (deploy + e2e of /list still blocked on creds).
- Phase 7 channel routing changes the report destination model from single-channel (v1.0) to per-client; confirm the v1.0 single `REPORT_CHANNEL_ID` path is superseded, not left dangling.
- childrenchic.com will be renamed to its new domain once Arianna confirms (affects CFG-01 roster seed).

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v1.0 e2e | Live deploy/seed/e2e of /list (Plan 01-03 Task 2) blocked on creds | Blocked | v1.0 |

## Session Continuity

Last session: 2026-07-03T20:10:00.000Z
Stopped at: Milestone v1.1 roadmap created — Phases 5 (GSC-05/06, RPT-05), 6 (RPT-07/08/09/10), 7 (CH-01/02/03, CFG-01). All 11 v1.1 requirements mapped.
Resume file: None — next step is `/gsd:plan-phase 5`
