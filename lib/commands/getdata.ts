/**
 * `/getdata <cliente>` handler (CMD-09).
 *
 * Posts a single client's WEEKLY report to ITS mapped Slack channel on demand,
 * then confirms the destination to the invoker. This is Juan's explicit
 * on-demand trigger: it sends the client's data to that client's channel. It
 * never fans out to every client and never posts an ephemeral preview.
 *
 * 3-second ack (CR-01): the flow is split so the HTTP command path can ACK
 * within Slack's deadline and run the heavy work afterwards.
 *   - `prepareGetData` is the FAST phase: pure validation against the active set
 *     and the channel map (no GSC fetch). It returns either a terminal reply
 *     (usage/unknown/ambiguous/unmapped) or an ack plus the resolved target.
 *   - `runGetData` is the BACKGROUND phase: the 21-day GSC fetch, the conditional
 *     post, and the confirmation text. It must NOT run on the synchronous ack
 *     path when called from the HTTP endpoint.
 *   - `handleGetData` composes both for non-HTTP callers (the `dispatch` router,
 *     offline tests) where awaiting the whole thing is fine.
 *
 * Reuses the Phase 6 weekly orchestrator + Block Kit builder. All replies are
 * neutral-Spanish, humanized, and secret-free (never interpolates report.message
 * or the bot token). No em/en dashes in any reply branch (humanizer hard rule).
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

/**
 * Result of the FAST validation phase. Either a terminal reply (nothing to do
 * in the background), or a green light with the resolved target and the ack
 * text to return immediately.
 */
export type GetDataPlan =
  | { kind: 'reply'; text: string }
  | { kind: 'run'; siteUrl: string; channelId: string; ack: string };

/**
 * FAST phase: validate `<cliente>` against the active set and the channel map.
 * Does NO GSC work, so it is safe to await inside the 3-second ack budget.
 * Every error branch (usage, unknown, ambiguous, unmapped) is a terminal reply.
 */
export async function prepareGetData(arg: string, deps: GetDataDeps = {}): Promise<GetDataPlan> {
  const ref = arg.trim();
  if (ref === '') {
    return { kind: 'reply', text: 'Uso: `/getdata <cliente>`. Por ejemplo `/getdata deltacloudz.com`.' };
  }

  const active = [...(await getActiveClients(deps.reader))];
  const result = resolveSiteRef(ref, active);

  if (result.kind === 'none') {
    return { kind: 'reply', text: `«${ref}» no está en el reporte. Agrégalo con \`/add\` primero.` };
  }
  if (result.kind === 'multiple') {
    const lines = result.candidates.map((c) => `• ${c}`).join('\n');
    return { kind: 'reply', text: `«${ref}» coincide con varias propiedades. Pega la exacta:\n${lines}` };
  }

  const siteUrl = result.siteUrl;
  const channelId = await getClientChannel(siteUrl, deps.channelReader);
  if (channelId === null) {
    return {
      kind: 'reply',
      text: `*${siteUrl}* todavía no tiene canal asignado. Asígnalo con \`/setchannel\` primero.`,
    };
  }

  return {
    kind: 'run',
    siteUrl,
    channelId,
    ack: `Estoy armando el reporte semanal de *${siteUrl}* y lo publico en su canal en unos segundos.`,
  };
}

/**
 * BACKGROUND phase: fetch the weekly report and post it to the mapped channel
 * ONLY when there is a real report (`status === 'ok'`). On `no_data` /
 * `insufficient_data` it posts NOTHING to the live client channel and returns a
 * truthful notice instead (WR-02). Returns the confirmation/notice text; the
 * caller decides whether to deliver it inline or via `response_url`.
 */
export async function runGetData(
  plan: Extract<GetDataPlan, { kind: 'run' }>,
  deps: GetDataDeps = {},
): Promise<string> {
  const getReport = deps.getReport ?? getWeeklyClientReport;
  const post = deps.post ?? postMessage;

  const report = await getReport(plan.siteUrl);

  if (report.status === 'error') {
    // Secret-free: never interpolate report.message.
    return `No pude armar el reporte de *${plan.siteUrl}* ahora mismo. Inténtalo de nuevo en un momento.`;
  }
  if (report.status !== 'ok') {
    // no_data / insufficient_data: do NOT spam the client channel with a
    // "faltan datos" card, and do NOT claim a report was published (WR-02).
    return `*${plan.siteUrl}* todavía no tiene datos suficientes para un reporte semanal. No publiqué nada en su canal.`;
  }

  const blocks = buildWeeklyClientReportBlocks(plan.siteUrl, report);
  await post(plan.channelId, blocks);
  return `Listo, publiqué el reporte semanal de *${plan.siteUrl}* en su canal.`;
}

/**
 * Synchronous composition of both phases for non-HTTP callers (the `dispatch`
 * router and offline tests). Awaits the whole flow and returns the reply text.
 * The HTTP endpoint does NOT use this — it acks with the plan first, then runs
 * the background phase off the request path.
 */
export async function handleGetData(arg: string, deps: GetDataDeps = {}): Promise<string> {
  const plan = await prepareGetData(arg, deps);
  if (plan.kind === 'reply') {
    return plan.text;
  }
  return runGetData(plan, deps);
}
