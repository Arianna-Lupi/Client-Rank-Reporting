import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WeeklyClientReport } from '../../lib/weekly-report.js';
import { resetConfigCache } from '../../lib/config.js';
import { GET } from './daily-report.js';
import type { CronDeps } from './daily-report.js';

/**
 * Offline handler tests for the weekly, per-channel cron (SCH-04, CH-03). Every
 * dependency is injected via CronDeps — no live Redis, Slack or GSC. A fixed
 * `now` drives the hour/weekday gate deterministically.
 */

const CRON_SECRET = 'test-cron-secret';

const REQUIRED_ENV: Record<string, string> = {
  CRON_SECRET,
  SLACK_SIGNING_SECRET: 'shhh',
  SLACK_CHANNEL_ID: 'C0000',
  GSC_SA_KEY_B64: 'eyJ9',
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'tok',
  SLACK_BOT_TOKEN: 'xoxb-test',
  REPORT_TZ: 'America/New_York',
  REPORT_HOUR: '9',
  REPORT_DOW: '1', // Monday
};

// 2026-07-13 is a Monday. 13:00 UTC = 09:00 EDT -> matches hour AND weekday.
const MONDAY_9AM = new Date('2026-07-13T13:00:00Z');
// Same Monday but 08:00 local (wrong hour).
const MONDAY_8AM = new Date('2026-07-13T12:00:00Z');
// 2026-07-14 is a Tuesday, 09:00 local (right hour, wrong weekday).
const TUESDAY_9AM = new Date('2026-07-14T13:00:00Z');

const metric = { value: 0, previous: 0, deltaPct: null, improved: true, isNew: false };
const OK_REPORT: WeeklyClientReport = {
  status: 'ok',
  window: {
    currentStart: '2026-07-06',
    currentEnd: '2026-07-12',
    previousStart: '2026-06-29',
    previousEnd: '2026-07-05',
  },
  deltas: { clicks: metric, impressions: metric, ctr: metric, position: metric },
  urls: [],
};

interface CronBody {
  skipped?: string;
  dateKey?: string;
  posted?: number;
  skippedUnmapped?: number;
}

async function readBody(res: Response): Promise<CronBody> {
  return (await res.json()) as CronBody;
}

function authedRequest(secret = CRON_SECRET): Request {
  return new Request('https://x/api/cron/daily-report', {
    headers: { authorization: `Bearer ${secret}` },
  });
}

/** Recording post fake. */
function recordingPost(): {
  calls: Array<[string, unknown]>;
  fn: CronDeps['post'];
} {
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    fn: async (channel: string, blocks): Promise<void> => {
      calls.push([channel, blocks]);
    },
  };
}

function baseDeps(overrides: Partial<CronDeps> = {}): CronDeps {
  return {
    now: MONDAY_9AM,
    getActive: async () => new Set<string>(),
    getChannels: async () => new Map<string, string>(),
    claimLock: async () => true,
    getReport: async () => OK_REPORT,
    post: async () => {},
    ...overrides,
  };
}

beforeEach(() => {
  resetConfigCache();
  for (const [k, v] of Object.entries(REQUIRED_ENV)) {
    process.env[k] = v;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  resetConfigCache();
});

describe('cron GET', () => {
  it('returns 401 without a valid Bearer secret and calls no dependency', async () => {
    const claimLock = vi.fn(async () => true);
    const res = await GET(authedRequest('wrong'), baseDeps({ claimLock }));
    expect(res.status).toBe(401);
    expect(claimLock).not.toHaveBeenCalled();
  });

  it('skips on the wrong hour without claiming the lock or posting', async () => {
    const claimLock = vi.fn(async () => true);
    const post = recordingPost();
    const res = await GET(authedRequest(), baseDeps({ now: MONDAY_8AM, claimLock, post: post.fn }));
    const body = await readBody(res);
    expect(body.skipped).toBe('not-report-window');
    expect(claimLock).not.toHaveBeenCalled();
    expect(post.calls).toEqual([]);
  });

  it('skips on the wrong weekday even at the right hour', async () => {
    const claimLock = vi.fn(async () => true);
    const post = recordingPost();
    const res = await GET(authedRequest(), baseDeps({ now: TUESDAY_9AM, claimLock, post: post.fn }));
    const body = await readBody(res);
    expect(body.skipped).toBe('not-report-window');
    expect(claimLock).not.toHaveBeenCalled();
    expect(post.calls).toEqual([]);
  });

  it('skips when the lock is already claimed', async () => {
    const post = recordingPost();
    const res = await GET(authedRequest(), baseDeps({ claimLock: async () => false, post: post.fn }));
    const body = await readBody(res);
    expect(body.skipped).toBe('already-posted');
    expect(body.dateKey).toBe('2026-07-13');
    expect(post.calls).toEqual([]);
  });

  it('routes each mapped client to its own channel and warn-skips the unmapped one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const post = recordingPost();
    const res = await GET(
      authedRequest(),
      baseDeps({
        getActive: async () =>
          new Set(['sc-domain:a.com', 'sc-domain:b.com', 'sc-domain:c.com']),
        getChannels: async () =>
          new Map([
            ['sc-domain:a.com', 'C_AAA'],
            ['sc-domain:b.com', 'C_BBB'],
          ]),
        post: post.fn,
      }),
    );
    const body = await readBody(res);
    expect(body).toEqual({ posted: 2, skippedUnmapped: 1, dateKey: '2026-07-13' });
    expect(post.calls).toEqual([
      ['C_AAA', expect.anything()],
      ['C_BBB', expect.anything()],
    ]);
    // Unmapped client warned with siteUrl only.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]!.join(' ')).toContain('sc-domain:c.com');
  });

  it('skips a client whose report status is error without posting or leaking the message', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const post = recordingPost();
    const res = await GET(
      authedRequest(),
      baseDeps({
        getActive: async () => new Set(['sc-domain:a.com']),
        getChannels: async () => new Map([['sc-domain:a.com', 'C_AAA']]),
        getReport: async () => ({ status: 'error', message: 'secreto-que-no-debe-filtrarse' }),
        post: post.fn,
      }),
    );
    const body = await readBody(res);
    expect(body).toEqual({ posted: 0, skippedUnmapped: 0, dateKey: '2026-07-13' });
    expect(post.calls).toEqual([]);
    for (const call of errorSpy.mock.calls) {
      expect(call.join(' ')).not.toContain('secreto-que-no-debe-filtrarse');
    }
  });

  it('isolates a per-client post failure and still posts the other client', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const posted: string[] = [];
    const res = await GET(
      authedRequest(),
      baseDeps({
        getActive: async () => new Set(['sc-domain:a.com', 'sc-domain:b.com']),
        getChannels: async () =>
          new Map([
            ['sc-domain:a.com', 'C_AAA'],
            ['sc-domain:b.com', 'C_BBB'],
          ]),
        post: async (channel: string) => {
          if (channel === 'C_AAA') {
            throw new Error('slack down');
          }
          posted.push(channel);
        },
      }),
    );
    const body = await readBody(res);
    expect(posted).toEqual(['C_BBB']);
    expect(body).toEqual({ posted: 1, skippedUnmapped: 0, dateKey: '2026-07-13' });
    expect(errorSpy).toHaveBeenCalled();
  });
});
