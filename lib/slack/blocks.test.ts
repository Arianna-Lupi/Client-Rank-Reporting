import { describe, expect, it } from 'vitest';

import { buildClientReportBlocks, buildWeeklyClientReportBlocks } from './blocks.js';
import type { MetricDelta, MetricDeltas } from '../metrics.js';
import type { ClientReport } from '../report.js';
import type { UrlClickDelta, WeeklyWindow } from '../weekly.js';
import type { WeeklyClientReport } from '../weekly-report.js';

/**
 * Unit tests for the pure Block Kit builder (RPT-02 / RPT-03). No live Slack —
 * the builder is a total function over ClientReport, so every status and every
 * direction branch is asserted against the serialized block JSON.
 */

/** Build a MetricDelta fixture with sensible defaults per branch. */
function metric(overrides: Partial<MetricDelta>): MetricDelta {
  return {
    value: 0,
    previous: 0,
    deltaPct: 0,
    improved: false,
    isNew: false,
    ...overrides,
  };
}

const SITE = 'sc-domain:ariannalupi.com';

describe('buildClientReportBlocks', () => {
  it('renders an ok report with header, all four metrics and each direction branch', () => {
    const report: ClientReport = {
      status: 'ok',
      date: '2026-06-25',
      deltas: {
        // improved true -> 🟢 ▲
        impressions: metric({ value: 1200, previous: 1000, deltaPct: 20, improved: true }),
        // improved false -> 🔴 ▼
        clicks: metric({ value: 80, previous: 100, deltaPct: -20, improved: false }),
        // new property (deltaPct null / isNew) -> 🆕 nuevo
        ctr: metric({ value: 0.0345, previous: 0, deltaPct: null, improved: true, isNew: true }),
        // position improved (inverted, baked in Phase 3) -> 🟢 ▲
        position: metric({ value: 4.27, previous: 6.5, deltaPct: -34.3, improved: true }),
      },
    };

    const blocks = buildClientReportBlocks(SITE, report);
    const json = JSON.stringify(blocks);

    // Header carries the siteUrl and the report date.
    expect(blocks[0]?.type).toBe('header');
    expect(json).toContain(SITE);
    expect(json).toContain('2026-06-25');

    // Spanish metric labels, all four present.
    expect(json).toContain('Impresiones');
    expect(json).toContain('Clics');
    expect(json).toContain('CTR');
    expect(json).toContain('Posición');

    // Each direction branch is exercised at least once.
    expect(json).toContain('🟢');
    expect(json).toContain('🔴');
    expect(json).toContain('🆕');

    // CTR rendered as a percentage; position with one decimal.
    expect(json).toContain('3.5%'); // 0.0345 -> 3.5%
    expect(json).toContain('4.3'); // position toFixed(1)
  });

  it('renders insufficient_data as a friendly Spanish context block with the siteUrl', () => {
    const report: ClientReport = { status: 'insufficient_data', date: '2026-06-25' };
    const blocks = buildClientReportBlocks(SITE, report);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('context');
    const json = JSON.stringify(blocks);
    expect(json).toContain(SITE);
    expect(json.toLowerCase()).toContain('sin datos');
  });

  it('renders no_data as a friendly Spanish context block', () => {
    const report: ClientReport = { status: 'no_data' };
    const blocks = buildClientReportBlocks(SITE, report);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('context');
    expect(JSON.stringify(blocks)).toContain(SITE);
  });

  it('renders error defensively without leaking report.message', () => {
    const secret = 'stack-trace-with-credential-xyz';
    const report: ClientReport = { status: 'error', message: secret };
    const blocks = buildClientReportBlocks(SITE, report);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('context');
    const json = JSON.stringify(blocks);
    expect(json).toContain(SITE);
    expect(json).not.toContain(secret);
  });
});

/**
 * Unit tests for the weekly Block Kit builder (RPT-07/RPT-08/RPT-09/RPT-10). The
 * builder is a total function over WeeklyClientReport, asserted against the
 * serialized JSON. buildClientReportBlocks (daily v1.0) stays covered above and
 * must remain green.
 */

const WINDOW: WeeklyWindow = {
  currentStart: '2026-06-14',
  currentEnd: '2026-06-20',
  previousStart: '2026-06-07',
  previousEnd: '2026-06-13',
};

function wMetric(overrides: Partial<MetricDelta>): MetricDelta {
  return { value: 0, previous: 0, deltaPct: 0, improved: false, isNew: false, ...overrides };
}

const WEEKLY_DELTAS: MetricDeltas = {
  impressions: wMetric({ value: 12345, previous: 10287, deltaPct: 20, improved: true }),
  clicks: wMetric({ value: 15678, previous: 17041, deltaPct: -8, improved: false }),
  ctr: wMetric({ value: 0.0324, previous: 0.0309, deltaPct: 5, improved: true }),
  position: wMetric({ value: 4.7, previous: 4.8, deltaPct: -3, improved: true }),
};

function url(over: Partial<UrlClickDelta> & { url: string; delta: number }): UrlClickDelta {
  return { current: 0, previous: 0, isNew: false, ...over };
}

const LONG_PATH_URL =
  'https://cliente.com/blog/esta-es-una-ruta-muy-larga-que-supera-los-cincuenta-caracteres-facil';

// Already ranked by |delta| descending (as rankUrlClickDeltas would return).
const MIXED_URLS: UrlClickDelta[] = [
  url({ url: LONG_PATH_URL, current: 100, previous: 0, delta: 100, isNew: true }),
  url({ url: 'https://cliente.com/servicios', current: 100, previous: 20, delta: 80 }),
  url({ url: 'https://cliente.com/viejo', current: 30, previous: 100, delta: -70 }),
  url({ url: 'https://cliente.com/contacto', current: 100, previous: 40, delta: 60 }),
  url({ url: 'https://cliente.com/antiguo', current: 50, previous: 100, delta: -50 }),
  url({ url: 'https://cliente.com/precios', current: 100, previous: 60, delta: 40 }), // 4th riser -> excluded
  url({ url: 'https://cliente.com/legacy', current: 70, previous: 100, delta: -30 }),
  url({ url: 'https://cliente.com/otro', current: 90, previous: 100, delta: -10 }), // 4th dropper -> excluded
];

const WEEKLY_SITE = 'sc-domain:cliente.com';

describe('buildWeeklyClientReportBlocks', () => {
  it('renders ok: header, WoW metrics, divider, top-3 risers and top-3 droppers', () => {
    const report: WeeklyClientReport = {
      status: 'ok',
      window: WINDOW,
      deltas: WEEKLY_DELTAS,
      urls: MIXED_URLS,
    };

    const blocks = buildWeeklyClientReportBlocks(WEEKLY_SITE, report);
    const json = JSON.stringify(blocks);

    // Header: week range with the ellipsis and the word semana.
    expect(blocks[0]?.type).toBe('header');
    expect(json).toContain('semana');
    expect(json).toContain('2026-06-14');
    expect(json).toContain('2026-06-20');
    expect(json).toContain('…'); // U+2026 ellipsis

    // A divider separates metrics from URL lists.
    expect(blocks.some((b) => b.type === 'divider')).toBe(true);

    // Four metric labels, impressions clarified as tráfico, and the WoW basis stated.
    expect(json).toContain('Impresiones');
    expect(json).toContain('tráfico');
    expect(json).toContain('Clics');
    expect(json).toContain('CTR');
    expect(json).toContain('Posición');
    expect(json).toContain('vs semana previa');

    // es-ES thousands separator on clicks and impressions.
    expect(json).toContain('12.345');
    expect(json).toContain('15.678');

    // CTR with 2 decimals; position with 1 decimal.
    expect(json).toContain('3.24%');
    expect(json).toContain('4.7');

    // Exactly 3 risers and 3 droppers -> 6 per-URL "clics" lines total.
    const clicsCount = (json.match(/clics/g) ?? []).length;
    expect(clicsCount).toBe(6);

    // The 4th riser and 4th dropper are sliced off.
    expect(json).not.toContain('/precios');
    expect(json).not.toContain('/otro');

    // New URL marker present.
    expect(json).toContain('🆕');

    // Signed per-URL click deltas: + for risers, U+2212 for droppers.
    expect(json).toContain('+100 clics');
    expect(json).toContain('−' + '70 clics');

    // mrkdwn link: full URL as href, but the visible label is only the path,
    // truncated to ~50 chars and closed with an ellipsis before the '>'.
    expect(json).toContain('<' + LONG_PATH_URL + '|/blog/');
    expect(json).toContain('los-c…>'); // truncated label tail + ellipsis before '>'
  });

  it('renders ok with empty urls: no URL sections, a friendly context degradation line', () => {
    const report: WeeklyClientReport = { status: 'ok', window: WINDOW, deltas: WEEKLY_DELTAS, urls: [] };

    const blocks = buildWeeklyClientReportBlocks(WEEKLY_SITE, report);
    const json = JSON.stringify(blocks);

    // header + metrics section + divider + degradation context.
    expect(blocks).toHaveLength(4);
    expect(blocks[3]?.type).toBe('context');
    expect(json).not.toContain('clics');
    expect(json).not.toContain('subieron');
    expect(json).not.toContain('bajaron');
  });

  it('renders insufficient_data as a single friendly context block with the siteUrl', () => {
    const report: WeeklyClientReport = { status: 'insufficient_data' };
    const blocks = buildWeeklyClientReportBlocks(WEEKLY_SITE, report);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('context');
    expect(JSON.stringify(blocks)).toContain(WEEKLY_SITE);
  });

  it('renders no_data as a single friendly context block with the siteUrl', () => {
    const report: WeeklyClientReport = { status: 'no_data' };
    const blocks = buildWeeklyClientReportBlocks(WEEKLY_SITE, report);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('context');
    expect(JSON.stringify(blocks)).toContain(WEEKLY_SITE);
  });

  it('renders error defensively without leaking report.message', () => {
    const secret = 'weekly-stack-trace-with-credential-xyz';
    const report: WeeklyClientReport = { status: 'error', message: secret };
    const blocks = buildWeeklyClientReportBlocks(WEEKLY_SITE, report);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('context');
    const json = JSON.stringify(blocks);
    expect(json).toContain(WEEKLY_SITE);
    expect(json).not.toContain(secret);
  });
});
