import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type { ActiveClientReader } from '../../lib/clients.js';
import type { ChannelMapReader } from '../../lib/channels.js';
import type { WeeklyClientReport } from '../../lib/weekly-report.js';
import type { CommandDeps } from '../../lib/commands/router.js';
import { POST } from './command.js';
import type { CommandEndpointDeps } from './command.js';

/**
 * Endpoint tests for the Slack slash-command handler, focused on CR-01 (the
 * 3-second ack). The signing secret matches the dummy in vitest.config so
 * `verifySlackSignature` (reading process.env) accepts our locally-signed body.
 * Every heavy seam is injected — no live Slack/GSC/Redis.
 */

const SIGNING_SECRET = 'test-signing';

/** Build a validly-signed Slack POST for the given form body. */
function signedRequest(body: string): Request {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = 'v0=' + createHmac('sha256', SIGNING_SECRET).update(`v0:${ts}:${body}`).digest('hex');
  return new Request('https://x/api/slack/command', {
    method: 'POST',
    headers: {
      'x-slack-signature': sig,
      'x-slack-request-timestamp': ts,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

const ACTIVE = ['sc-domain:deltacloudz.com'];

function fakeReader(members: string[]): ActiveClientReader {
  return { async smembers(): Promise<string[]> { return members; } };
}

function fakeChannelReader(map: Record<string, string>): ChannelMapReader {
  return {
    async hget(_key: string, field: string): Promise<string | null> { return map[field] ?? null; },
    async hgetall(): Promise<Record<string, string> | null> { return map; },
  };
}

const metric = { value: 0, previous: 0, deltaPct: null, improved: true, isNew: false };
const OK_REPORT: WeeklyClientReport = {
  status: 'ok',
  window: { currentStart: '2026-06-22', currentEnd: '2026-06-28', previousStart: '2026-06-15', previousEnd: '2026-06-21' },
  deltas: { clicks: metric, impressions: metric, ctr: metric, position: metric },
  urls: [],
};

interface EphemeralBody { response_type?: string; text?: string }

describe('POST /api/slack/command — signature gate', () => {
  it('returns 401 on an invalid signature and runs no handler', async () => {
    const dispatch = vi.fn(async () => 'nope');
    const req = new Request('https://x/api/slack/command', {
      method: 'POST',
      headers: { 'x-slack-signature': 'v0=bad', 'x-slack-request-timestamp': '1' },
      body: form({ command: '/list', text: '' }),
    });
    const res = await POST(req, { dispatch });
    expect(res.status).toBe(401);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('POST /api/slack/command — fast commands', () => {
  it('replies inline for /list within the ack', async () => {
    const dispatch = vi.fn(async () => 'lista');
    const res = await POST(signedRequest(form({ command: '/list', text: '' })), { dispatch });
    const body = (await res.json()) as EphemeralBody;
    expect(body.text).toBe('lista');
    expect(dispatch).toHaveBeenCalledWith('/list', '', undefined);
  });
});

describe('POST /api/slack/command — /getdata 3-second ack (CR-01)', () => {
  const handlerDeps: CommandDeps = {
    reader: fakeReader(ACTIVE),
    channelReader: fakeChannelReader({ 'sc-domain:deltacloudz.com': 'C_MAPPED' }),
    getReport: async () => OK_REPORT,
  };

  it('acks immediately WITHOUT awaiting the GSC fetch, then runs the post in the background', async () => {
    // `run` never settles during the ack — proves POST does not await it.
    let released!: () => void;
    const gate = new Promise<void>((r) => { released = r; });
    const run = vi.fn(async () => { await gate; return 'done'; });
    const respond = vi.fn(async (_url: string, _text: string) => {});
    const scheduled: Array<Promise<unknown>> = [];
    const schedule = (p: Promise<unknown>): void => { scheduled.push(p); };

    const res = await POST(signedRequest(form({ command: '/getdata', text: 'deltacloudz.com', response_url: 'https://hooks.slack.test/1' })), {
      run,
      respond,
      schedule,
      handlerDeps,
    } satisfies CommandEndpointDeps);

    const body = (await res.json()) as EphemeralBody;
    // The ack came back while the heavy work is still pending.
    expect(body.text).toContain('unos segundos');
    expect(run).toHaveBeenCalledTimes(1);
    expect(respond).not.toHaveBeenCalled(); // follow-up not sent yet
    expect(scheduled).toHaveLength(1);

    // Now let the background job finish and confirm exactly one follow-up.
    released();
    await Promise.all(scheduled);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]![0]).toBe('https://hooks.slack.test/1');
    expect(respond.mock.calls[0]![1]).toBe('done');
  });

  it('runs the real background job: posts to the mapped channel and sends one response_url follow-up', async () => {
    const posts: Array<[string, unknown]> = [];
    const respond = vi.fn(async (_url: string, _text: string) => {});
    const scheduled: Array<Promise<unknown>> = [];
    const schedule = (p: Promise<unknown>): void => { scheduled.push(p); };

    const res = await POST(signedRequest(form({ command: '/getdata', text: 'deltacloudz.com', response_url: 'https://hooks.slack.test/2' })), {
      respond,
      schedule,
      handlerDeps: {
        ...handlerDeps,
        post: (async (channel: string, blocks: unknown[]) => { posts.push([channel, blocks]); }) as never,
      },
    });

    const body = (await res.json()) as EphemeralBody;
    expect(body.text).toContain('unos segundos');
    // The post is deferred to the scheduled background job — the ack path itself
    // does not perform it. Draining the schedule runs the real job.
    expect(scheduled).toHaveLength(1);

    await Promise.all(scheduled);
    expect(posts).toHaveLength(1);
    expect(posts[0]![0]).toBe('C_MAPPED');
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]![1]).toContain('publiqué el reporte');
  });

  it('replies inline (no background job) for a validation error like an unknown client', async () => {
    const run = vi.fn(async () => 'should-not-run');
    const schedule = vi.fn();
    const res = await POST(signedRequest(form({ command: '/getdata', text: 'noexiste.com', response_url: 'https://hooks.slack.test/3' })), {
      run,
      schedule,
      handlerDeps,
    });
    const body = (await res.json()) as EphemeralBody;
    expect(body.text).toContain('no está en el reporte');
    expect(run).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('sends exactly one follow-up even when the background job throws', async () => {
    const respond = vi.fn(async (_url: string, _text: string) => {});
    const scheduled: Array<Promise<unknown>> = [];
    const schedule = (p: Promise<unknown>): void => { scheduled.push(p); };
    const run = vi.fn(async () => { throw new Error('gsc down'); });

    await POST(signedRequest(form({ command: '/getdata', text: 'deltacloudz.com', response_url: 'https://hooks.slack.test/4' })), {
      run,
      respond,
      schedule,
      handlerDeps,
    });

    await Promise.all(scheduled);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]![1]).toContain('Inténtalo de nuevo');
  });
});
