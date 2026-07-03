---
phase: 06-weekly-client-report-block-kit
status: passed
verified: 2026-07-03
scope: offline-unit-tests
requirements: [RPT-07, RPT-08, RPT-09, RPT-10]
blocker: "No live GSC/Slack/Upstash credentials — all verification is offline unit-test level"
---

# Phase 6 Verification: Weekly Client Report (Block Kit)

## Status: passed (offline)

All verification is offline unit-test level. The standing blocker (no live GSC/Slack/Upstash credentials) means no end-to-end run against real GSC or a real Slack channel was possible. Every fetcher is injected via DI and every builder is pure, so the suites assert against serialized output with zero network.

## Results

| Check | Result |
|-------|--------|
| `npx vitest run lib/weekly-report.test.ts` | 9 passed |
| `npx vitest run lib/slack/blocks.test.ts` | 9 passed (4 daily + 5 weekly) |
| `npm test` (full suite) | 134 passed / 17 files |
| `npm run typecheck` | clean (strict + noUncheckedIndexedAccess) |
| `lib/metrics.ts` unchanged | `git diff 0dfdd54 -- lib/metrics.ts` empty |
| Daily `buildClientReportBlocks` unchanged | only additions to blocks.ts; daily body byte-identical, daily tests green |
| No `any` type in new files | confirmed |
| es-ES formatting present | `grep -c "es-ES" lib/slack/blocks.ts` = 3 |

## Requirement coverage

- **RPT-07** (WoW metrics per client): `getWeeklyClientReport` produces `computeWeeklyDeltas`; `buildWeeklyClientReportBlocks` renders Impresiones (tráfico), Clics, CTR, Posición with direction + signed delta and "vs semana previa".
- **RPT-08 / RPT-09** (top 3 rising / dropping URLs): orchestrator ranks via `rankUrlClickDeltas`; builder slices `delta > 0` / `delta < 0` to 3 each, with 🆕 for new URLs.
- **RPT-10** (readable formatting): es-ES thousands (grouping at >= 10000), 2-decimal CTR, 1-decimal position, signed 1-decimal delta %, path-only mrkdwn links truncated ~50 chars.

## Security (STRIDE dispositions)

- **T-06-01 / T-06-03** (info disclosure via error): both the orchestrator error variant and the builder error block use fixed generic Spanish copy; planted-token tests confirm `report.message` never leaks.
- **T-06-02** (page-dimension DoS): per-URL fetch guarded; failure degrades to empty urls, metrics survive. Test-verified.

## Humanizer (hard rule)

Applied to all weekly Spanish copy posted to Slack: neutral Spanish, no voseo, no AI tells, no em/en dashes in prose. Notation preserved: ellipsis U+2026 and minus U+2212. All new weekly copy and comments are em/en-dash free.

## Deviation of note

Task 2's whole-file `grep "—\|–" = 0` criterion is not literally met because the frozen v1.0 daily builder (`buildClientReportBlocks`) retains 6 pre-existing em dashes (lines 8, 13, 80, 88, 97, 99) that the user forbade modifying. All NEW weekly code is dash-free, satisfying the hard rule for weekly posted copy. See 06-02-SUMMARY.md deviation 3.

## Human verification still pending (post-credentials)

- Real GSC query for a live property over a 21-day window resolves a sensible weekly window.
- Rendered message appears correctly in a Slack channel (Block Kit visual, link paths, emoji).
- These require credentials and are deferred to the Phase 7 channel-routing integration.
