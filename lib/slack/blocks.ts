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
import type { UrlClickDelta } from '../weekly.js';
import type { WeeklyClientReport } from '../weekly-report.js';

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

// ── Weekly report builder (RPT-07, RPT-08, RPT-09, RPT-10) ────────────────────
// Added alongside the daily builder above; buildClientReportBlocks and its
// helpers stay untouched so their tests remain green. All Spanish copy posted
// from here is humanized: no AI tells, no em/en dashes in prose. Notation is
// preserved on purpose: the header/truncation ellipsis (U+2026) and the minus
// sign (U+2212) in click deltas are symbols, not prose dashes.

/** Thousands-grouped es-ES integer formatter (Node full-ICU) for clicks/impressions. */
const esInteger = new Intl.NumberFormat('es-ES');

/** Format an integer metric with es-ES thousands separators (RPT-10). */
function formatThousands(value: number): string {
  return esInteger.format(Math.round(value));
}

/** Format CTR (a 0-1 fraction) as a percentage with 2 decimals: weekly override of the daily 1-decimal CTR (RPT-10). */
function formatCtr2(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/** Max characters shown for a URL path before it gets an ellipsis. */
const URL_PATH_MAX = 50;

/** Build an mrkdwn link that shows only the URL path, truncated with an ellipsis when long. */
function urlLink(u: UrlClickDelta): string {
  let path: string;
  try {
    path = new URL(u.url).pathname;
  } catch {
    path = u.url;
  }
  const label = path.length > URL_PATH_MAX ? `${path.slice(0, URL_PATH_MAX - 1)}…` : path;
  return `<${u.url}|${label}>`;
}

/** One URL line: optional 🆕, the path link, and the signed click delta (U+2212 for drops). */
function urlClickLine(u: UrlClickDelta): string {
  const marker = u.isNew ? '🆕 ' : '';
  const sign = u.delta >= 0 ? '+' : '−'; // '−' is U+2212, a notation symbol (not an en/em dash)
  return `${marker}${urlLink(u)} ${sign}${Math.abs(u.delta)} clics`;
}

/** A titled section listing a slice of URL movements. */
function urlSection(title: string, urls: ReadonlyArray<UrlClickDelta>): SlackBlock {
  const text = [title, ...urls.map(urlClickLine)].join('\n');
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

/** The four WoW metric lines with a lead that states the comparison basis (RPT-07). */
function weeklyMetricsText(deltas: MetricDeltas): string {
  return [
    'Así se movió la semana vs semana previa:',
    metricLine('Impresiones (tráfico)', formatThousands(deltas.impressions.value), deltas.impressions),
    metricLine('Clics', formatThousands(deltas.clicks.value), deltas.clicks),
    metricLine('CTR', formatCtr2(deltas.ctr.value), deltas.ctr),
    metricLine('Posición', formatPosition(deltas.position.value), deltas.position),
  ].join('\n');
}

/**
 * Render one client's WEEKLY report as Block Kit blocks (RPT-07/08/09/10).
 *
 * Total over every WeeklyClientReport variant, never throws, never leaks
 * `report.message`. The daily builder above is left intact. The `ok` layout is:
 * header with the current week range, the four WoW metrics, a divider, then the
 * top 3 rising and top 3 dropping URLs by click delta. When no URL movement is
 * available the URL sections are dropped for a friendly context line, so the
 * message never carries an empty section.
 */
export function buildWeeklyClientReportBlocks(
  siteUrl: string,
  report: WeeklyClientReport,
): SlackBlock[] {
  switch (report.status) {
    case 'ok': {
      const { window: w, deltas, urls } = report;
      const blocks: SlackBlock[] = [
        {
          type: 'header',
          text: { type: 'plain_text', text: `📊 ${siteUrl}: semana ${w.currentStart}…${w.currentEnd}`, emoji: true },
        },
        { type: 'section', text: { type: 'mrkdwn', text: weeklyMetricsText(deltas) } },
        { type: 'divider' },
      ];

      const risers = urls.filter((u) => u.delta > 0).slice(0, 3);
      const droppers = urls.filter((u) => u.delta < 0).slice(0, 3);

      if (risers.length === 0 && droppers.length === 0) {
        blocks.push(contextBlock('Esta semana no tengo URLs con movimiento para mostrar.'));
      } else {
        if (risers.length > 0) blocks.push(urlSection('*Las páginas que más subieron*', risers));
        if (droppers.length > 0) blocks.push(urlSection('*Las páginas que más bajaron*', droppers));
      }
      return blocks;
    }
    case 'insufficient_data':
    case 'no_data':
      return [contextBlock(`📊 *${siteUrl}*: aún faltan datos para armar el reporte semanal.`)];
    case 'error':
      return [contextBlock(`📊 *${siteUrl}*: por ahora no pude armar el reporte semanal.`)];
  }
}
