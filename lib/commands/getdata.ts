/**
 * `/getdata <cliente>` handler (CMD-09).
 *
 * Posts a single client's WEEKLY report to ITS mapped Slack channel on demand,
 * then replies ephemerally to the invoker confirming the destination. This is
 * Juan's explicit on-demand trigger: it sends the client's data to that client's
 * channel. It never fans out to every client and never posts an ephemeral
 * preview of the blocks.
 *
 * Reuses the Phase 6 weekly orchestrator + Block Kit builder. All replies are
 * neutral-Spanish, humanized, and secret-free (never interpolates report.message
 * or the bot token).
 */
import { getActiveClients } from '../clients.js';
import type { ActiveClientReader } from '../clients.js';
import { getClientChannel } from '../channels.js';
import type { ChannelMapReader } from '../channels.js';
import { resolveSiteRef } from '../site-match.js';
import { getWeeklyClientReport } from '../weekly-report.js';
import { buildWeeklyClientReportBlocks } from '../slack/blocks.js';
import { postMessage } from '../slack/post.js';

export interface GetDataDeps {
  /** Defaults to the real Redis active-set reader. */
  reader?: ActiveClientReader;
  /** Defaults to the real Redis channel-map reader. */
  channelReader?: ChannelMapReader;
  /** Defaults to the real Phase 6 weekly orchestrator. */
  getReport?: typeof getWeeklyClientReport;
  /** Defaults to the real proactive post. */
  post?: typeof postMessage;
}

/** Returns the ephemeral Spanish reply for `/getdata <cliente>`. */
export async function handleGetData(arg: string, deps: GetDataDeps = {}): Promise<string> {
  const ref = arg.trim();
  if (ref === '') {
    return 'Uso: `/getdata <cliente>` — por ejemplo `/getdata deltacloudz.com`.';
  }

  const active = [...(await getActiveClients(deps.reader))];
  const result = resolveSiteRef(ref, active);

  if (result.kind === 'none') {
    return `«${ref}» no está en el reporte. Agrégalo con \`/add\` primero.`;
  }
  if (result.kind === 'multiple') {
    const lines = result.candidates.map((c) => `• ${c}`).join('\n');
    return `«${ref}» coincide con varias propiedades. Pega la exacta:\n${lines}`;
  }

  const siteUrl = result.siteUrl;
  const channelId = await getClientChannel(siteUrl, deps.channelReader);
  if (channelId === null) {
    return `*${siteUrl}* todavía no tiene canal asignado. Asígnalo con \`/setchannel\` primero.`;
  }

  const getReport = deps.getReport ?? getWeeklyClientReport;
  const post = deps.post ?? postMessage;

  const report = await getReport(siteUrl);
  if (report.status === 'error') {
    // Secret-free: never interpolate report.message.
    return `No pude armar el reporte de *${siteUrl}* ahora mismo. Inténtalo de nuevo en un momento.`;
  }

  const blocks = buildWeeklyClientReportBlocks(siteUrl, report);
  await post(channelId, blocks);
  return `Listo, publiqué el reporte semanal de *${siteUrl}* en su canal.`;
}
