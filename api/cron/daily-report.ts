/**
 * Daily report cron entrypoint (SCH-01, SCH-02, PER-02, RPT-03).
 *
 * Vercel Cron runs only in UTC with no per-job timezone, so `vercel.json`
 * schedules this hourly (`0 * * * *`) and the handler gates the real work to the
 * configured local hour via `isReportHour`. Composition order:
 *   1. Authorize the caller (Bearer CRON_SECRET) or 401 before any work (SCH-02).
 *   2. No-op unless the local hour in REPORT_TZ equals REPORT_HOUR (SCH-01).
 *   3. Claim the per-day idempotency lock; skip if already posted (PER-02).
 *   4. Iterate active clients: report -> blocks -> post, one message per client
 *      (RPT-03). A failure on one client is isolated and never aborts the run.
 *
 * Security (ASVS V7): never log the bot token, the cron secret, or
 * `report.message`; client errors log only a generic line + the siteUrl.
 */
import { getConfig } from '../../lib/config.js';
import { isAuthorizedCron } from '../../lib/cron-auth.js';
import { isReportHour, reportDateKey } from '../../lib/schedule.js';
import { claimDailyReport } from '../../lib/report-lock.js';
import { getActiveClients } from '../../lib/clients.js';
import { getClientReport } from '../../lib/report.js';
import { buildClientReportBlocks } from '../../lib/slack/blocks.js';
import { postMessage } from '../../lib/slack/post.js';

// Fail-fast on cold start (SCH-03): validate required env the moment the module
// loads, before any request is served.
getConfig();

export async function GET(req: Request): Promise<Response> {
  const cfg = getConfig();

  // 1. Authorize before any work (SCH-02).
  if (!isAuthorizedCron(req.headers, cfg.cronSecret)) {
    return new Response('unauthorized', { status: 401 });
  }

  // 2. Hourly cron no-ops every hour except the configured local hour (SCH-01).
  const now = new Date();
  if (!isReportHour(now, cfg.reportTz, cfg.reportHour)) {
    return Response.json({ skipped: 'not-report-hour' });
  }

  // 3. Claim the per-day idempotency lock; skip if already posted (PER-02).
  const dateKey = reportDateKey(now, cfg.reportTz);
  if (!(await claimDailyReport(dateKey))) {
    return Response.json({ skipped: 'already-posted', dateKey });
  }

  // 4. One Block Kit message per active client; isolate per-client failures.
  const clients = await getActiveClients();
  let posted = 0;
  for (const siteUrl of clients) {
    const report = await getClientReport(siteUrl);
    if (report.status === 'error') {
      // Never interpolate report.message (T-04-05).
      console.error('cron: client report error', siteUrl);
      continue;
    }
    const blocks = buildClientReportBlocks(siteUrl, report);
    try {
      await postMessage(cfg.slackChannelId, blocks);
      posted += 1;
    } catch {
      // A failed post for one client must not abort the whole run (T-04-07).
      console.error('cron: post failed', siteUrl);
    }
  }

  return Response.json({ posted, dateKey });
}
