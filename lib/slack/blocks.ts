/**
 * Block Kit message builder for one client's daily report (RPT-02, RPT-03).
 *
 * `buildClientReportBlocks(siteUrl, report)` is a pure, TOTAL function: every
 * ClientReport variant maps to a block array and it never throws. RPT-03 = one
 * message per client; RPT-02 = a per-metric direction indicator driven by the
 * `improved` boolean already computed in Phase 3 (position inversion is baked
 * in there — this module only maps `improved` to a colour/arrow, never re-inverts).
 *
 * Security: the `error` variant renders a generic friendly block and NEVER
 * surfaces `report.message` (which could carry internal detail) to Slack.
 *
 * No Slack SDK — emits plain Block Kit JSON, consistent with the project decision.
 */
import type { MetricDelta, MetricDeltas } from '../metrics.js';
import type { ClientReport } from '../report.js';

/** A minimal Block Kit block: a `type` discriminator plus open properties. */
export type SlackBlock = { type: string; [k: string]: unknown };

/** Map a metric's direction to an emoji + arrow (RPT-02). New properties get 🆕. */
function directionLabel(d: MetricDelta): string {
  if (d.isNew || d.deltaPct === null) {
    return '🆕 nuevo';
  }
  return d.improved ? '🟢 ▲' : '🔴 ▼';
}

/** Signed, 1-decimal percentage suffix for a delta, or empty for a new metric. */
function deltaSuffix(d: MetricDelta): string {
  if (d.deltaPct === null) {
    return '';
  }
  const sign = d.deltaPct >= 0 ? '+' : '';
  return ` (${sign}${d.deltaPct.toFixed(1)}%)`;
}

/** Format an integer-valued metric (impresiones / clics). */
function formatInt(value: number): string {
  return Math.round(value).toString();
}

/** Format CTR (a 0-1 fraction) as a percentage with 1 decimal. */
function formatCtr(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Format average position with exactly 1 decimal. */
function formatPosition(value: number): string {
  return value.toFixed(1);
}

/** One mrkdwn line: `*Label:* value indicator (±delta%)`. */
function metricLine(label: string, formattedValue: string, d: MetricDelta): string {
  return `*${label}:* ${formattedValue} ${directionLabel(d)}${deltaSuffix(d)}`;
}

/** Build the four metric lines in display order: Impresiones, Clics, CTR, Posición. */
function metricsText(deltas: MetricDeltas): string {
  return [
    metricLine('Impresiones', formatInt(deltas.impressions.value), deltas.impressions),
    metricLine('Clics', formatInt(deltas.clicks.value), deltas.clicks),
    metricLine('CTR', formatCtr(deltas.ctr.value), deltas.ctr),
    metricLine('Posición', formatPosition(deltas.position.value), deltas.position),
  ].join('\n');
}

/** A single friendly Spanish context block (used for all no-data states). */
function contextBlock(text: string): SlackBlock {
  return {
    type: 'context',
    elements: [{ type: 'mrkdwn', text }],
  };
}

/**
 * Render one client's report as Block Kit blocks (RPT-02, RPT-03). Total over
 * every ClientReport variant — never throws, never leaks `report.message`.
 */
export function buildClientReportBlocks(siteUrl: string, report: ClientReport): SlackBlock[] {
  switch (report.status) {
    case 'ok':
      return [
        {
          type: 'header',
          text: { type: 'plain_text', text: `📊 ${siteUrl} — ${report.date}`, emoji: true },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: metricsText(report.deltas) },
        },
      ];
    case 'insufficient_data':
    case 'no_data':
      return [contextBlock(`📊 *${siteUrl}* — sin datos suficientes todavía.`)];
    case 'error':
      return [contextBlock(`📊 *${siteUrl}* — sin datos disponibles por ahora.`)];
  }
}
