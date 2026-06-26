import { describe, expect, it } from 'vitest';

import { buildClientReportBlocks } from './blocks.js';
import type { MetricDelta } from '../metrics.js';
import type { ClientReport } from '../report.js';

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
