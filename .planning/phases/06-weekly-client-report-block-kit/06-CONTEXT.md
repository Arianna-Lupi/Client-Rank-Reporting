# Phase 6: Weekly Client Report (Block Kit) - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Compose the Phase 5 weekly data layer into a per-client report and render it as Block Kit (RPT-07, RPT-08, RPT-09, RPT-10). Deliver:
- A weekly report orchestrator that fetches daily rows + per-URL clicks and produces a never-throwing discriminated result.
- A Block Kit builder for the weekly message: traffic (impressions) + clicks WoW, CTR + average position WoW, and the top 3 rising / top 3 dropping URLs by click delta.
- Readable number/URL formatting.

NO channel routing (Phase 7) — this phase still returns blocks/report objects; who receives them and on which channel is Phase 7. The v1.0 daily builder (`buildClientReportBlocks`) and daily orchestrator (`report.ts`) stay intact.

</domain>

<decisions>
## Implementation Decisions

### Message Structure
- One Slack message per client (keeps the v1.0 one-message-per-client pattern).
- Header: `📊 {siteUrl} — semana {inicio}…{fin}` using the current window's date range.
- Section order: metrics section → divider → Top 3 rising URLs → Top 3 dropping URLs.
- "vs semana previa" stated explicitly in the copy so the comparison basis is clear.
- **All Slack-facing Spanish copy MUST be humanized** (apply the humanizer skill before finishing the phase): no AI tells, no em/en dashes, natural varied voice. This is a hard rule for every string the bot posts.

### Number Formatting (RPT-10)
- Clicks and impressions: thousands-separated via `Intl.NumberFormat('es-ES')` (e.g. `12.345`). Node full-ICU is available (verified).
- CTR: percentage with **2 decimals** (e.g. `3.24%`) — user override from the default 1 decimal.
- Average position: 1 decimal (e.g. `4.7`).
- Delta %: signed, 1 decimal (e.g. `+12.5%` / `-8.0%`).

### Top URLs Rendering
- Top 3 rising and top 3 dropping by absolute click delta (Phase 5's `rankUrlClickDeltas` full list, sliced here).
- URL shown as a clickable mrkdwn link with only the path, truncated to ~50 chars with ellipsis (`<fullUrl|/blog/…>`).
- Per-URL value is the signed click delta (`+12 clics` / `−8 clics`), not the absolute current clicks.
- Graceful degradation: render whatever URLs exist; if zero URL data, emit a friendly context line and omit the section (never an empty section).
- New URLs (previous 0 clicks) marked with 🆕 in the rising list.

### Weekly Orchestrator + Result States
- New module `lib/weekly-report.ts` with `getWeeklyClientReport(siteUrl, deps?)`, mirroring `report.ts`.
- New discriminated result `WeeklyClientReport` (ok / insufficient_data / no_data / error), total and never-throwing — same secret-free error handling as v1.0 (`error` variant never leaks the caught error).
- New Block Kit builder `buildWeeklyClientReportBlocks(siteUrl, report)`; leave `buildClientReportBlocks` (v1.0 daily) untouched so its tests stay green.
- The orchestrator consumes `fetchDailyMetrics` (21-day window) + `fetchPageClicks` for the two resolved windows, all injectable via DI so tests run offline.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/weekly.ts` (Phase 5): `resolveWeeklyWindow`, `aggregateWeek`, `computeWeeklyDeltas`, `rankUrlClickDeltas`. The orchestrator wires these.
- `lib/gsc.ts`: `fetchDailyMetrics`, `fetchPageClicks` (Phase 5). Inject both for offline tests.
- `lib/report.ts`: the discriminated `ClientReport` + never-throw compose pattern to mirror for `WeeklyClientReport`.
- `lib/slack/blocks.ts`: existing builder — reuse `directionLabel`/`deltaSuffix`/`contextBlock` helpers and the `SlackBlock` type; add weekly-specific formatting (thousands, URL link/truncate) alongside.
- `lib/constants.ts` (Phase 5): `MS_PER_DAY`, `PAGE_ROW_LIMIT` — extend with any new shared constants.

### Established Patterns
- Pure builders and orchestrators; network isolated behind injectable fetchers; exhaustive offline vitest.
- Spanish, secret-free copy; `error` variant renders a friendly generic block, never `report.message`.
- Direction indicator is driven by the already-computed `improved` boolean — never re-invert position here.

### Integration Points
- Phase 7 will call `getWeeklyClientReport` per client inside the cron and route `buildWeeklyClientReportBlocks` output to each client's mapped channel.

</code_context>

<specifics>
## Specific Ideas

- "tráfico" label in the message = impressions; "clics" = clicks; both shown WoW.
- The rising/dropping URL lists come straight from Phase 5's ranked list; this phase only slices top 3 each way and formats.
- Humanize every posted string (hard rule, restated in decisions).

</specifics>

<deferred>
## Deferred Ideas

- Cross-client "top movers" digest (RPT-06) — v2.
- Configurable top-N URLs (fixed at 3 for v1.1 per Arianna).

</deferred>
