/**
 * Weekly report cron entrypoint (SCH-04, CH-03).
 *
 * Vercel Cron runs only in UTC with no per-job timezone, so `vercel.json`
 * schedules this hourly (`0 * * * *`) and the handler gates the real work to a
 * WEEKLY cadence: the configured local hour AND the configured local weekday in
 * REPORT_TZ (default Monday 09:00). Composition order:
 *   1. Authorize the caller (Bearer CRON_SECRET) or 401 before any work (SCH-02).
 *   2. No-op unless it is the report hour AND the report weekday (SCH-04).
 *   3. Claim the per-run idempotency lock; skip if already posted (PER-02).
 *   4. Load the client->channel map and the active set ONCE, then post each
 *      client's WEEKLY report to ITS mapped channel (CH-03). An unmapped client
 *      is skipped with a siteUrl-only warn and never aborts the run. Per-client
 *      report/post failures are isolated.
 *
 * The v1.0 single `SLACK_CHANNEL_ID` posting destination is retired — routing is
 * 100% via the channel map. Security (ASVS V7): never log the bot token, the
 * cron secret, or `report.message`; client logs are a generic line + the siteUrl.
 */
import { getConfig } from '../../lib/config.js';
import { isAuthorizedCron } from '../../lib/cron-auth.js';
import { isReportHour, isReportDow, reportDateKey } from '../../lib/schedule.js';
import { claimDailyReport } from '../../lib/report-lock.js';
import { getActiveClients } from '../../lib/clients.js';
import { getAllChannels } from '../../lib/channels.js';
import { getWeeklyClientReport } from '../../lib/weekly-report.js';
import { buildWeeklyClientReportBlocks } from '../../lib/slack/blocks.js';
import { postMessage } from '../../lib/slack/post.js';

// Fail-fast on cold start (SCH-03): validate required env the moment the module
// loads, before any request is served.
getConfig();

/**
 * Injectable dependencies so the handler is exhaustively testable offline. Every
 * field defaults to the real production import, so Vercel's `GET(req)` call (no
 * second argument) runs the live path unchanged.
 */
export interface CronDeps {
  now?: Date;
  getActive?: typeof getActiveClients;
  getChannels?: typeof getAllChannels;
  claimLock?: typeof claimDailyReport;
  getReport?: typeof getWeeklyClientReport;
  buildBlocks?: typeof buildWeeklyClientReportBlocks;
  post?: typeof postMessage;
}

export async function GET(req: Request, deps: CronDeps = {}): Promise<Response> {
  const cfg = getConfig();

  // 1. Authorize before any work (SCH-02).
  if (!isAuthorizedCron(req.headers, cfg.cronSecret)) {
    return new Response('unauthorized', { status: 401 });
  }

  // 2. Weekly cadence: fire only at the configured hour AND weekday (SCH-04).
  const now = deps.now ?? new Date();
  if (
    !isReportHour(now, cfg.reportTz, cfg.reportHour) ||
    !isReportDow(now, cfg.reportTz, cfg.reportDow)
  ) {
    return Response.json({ skipped: 'not-report-window' });
  }

  // 3. Claim the per-run idempotency lock; skip if already posted (PER-02).
  const claimLock = deps.claimLock ?? claimDailyReport;
  const dateKey = reportDateKey(now, cfg.reportTz);
  if (!(await claimLock(dateKey))) {
    return Response.json({ skipped: 'already-posted', dateKey });
  }

  // 4. Load the channel map and the active set once, then route per client.
  const getChannels = deps.getChannels ?? getAllChannels;
  const getActive = deps.getActive ?? getActiveClients;
  const getReport = deps.getReport ?? getWeeklyClientReport;
  const buildBlocks = deps.buildBlocks ?? buildWeeklyClientReportBlocks;
  const post = deps.post ?? postMessage;

  const channels = await getChannels();
  const clients = await getActive();

  let posted = 0;
  let skippedUnmapped = 0;
  for (const siteUrl of clients) {
    const channelId = channels.get(siteUrl);
    if (!channelId) {
      // Unmapped client: quiet skip + warn (siteUrl only, no secrets). CH-03.
      console.warn('cron: client has no mapped channel', siteUrl);
      skippedUnmapped += 1;
      continue;
    }

    const report = await getReport(siteUrl);
    if (report.status === 'error') {
      // Never interpolate report.message (T-07-09).
      console.error('cron: client report error', siteUrl);
      continue;
    }

    const blocks = buildBlocks(siteUrl, report);
    try {
      await post(channelId, blocks);
      posted += 1;
    } catch {
      // A failed post for one client must not abort the whole run (T-07-12).
      console.error('cron: post failed', siteUrl);
    }
  }

  return Response.json({ posted, skippedUnmapped, dateKey });
}
