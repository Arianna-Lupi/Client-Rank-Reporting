import { describe, expect, it, vi } from 'vitest';

import type { ActiveClientReader } from '../clients.js';
import type { ChannelMapReader } from '../channels.js';
import type { WeeklyClientReport } from '../weekly-report.js';
import { handleGetData, prepareGetData, runGetData } from './getdata.js';
import type { GetDataPlan } from './getdata.js';

/**
 * Unit tests for /getdata (CMD-09), split into the FAST validation phase
 * (prepareGetData) and the BACKGROUND phase (runGetData), plus the synchronous
 * composition (handleGetData). All deps injected — no live Slack/GSC. Asserts:
 *  - the post targets the MAPPED channel id;
 *  - unmapped/unknown/no-data paths post NOTHING (WR-02);
 *  - every user-facing reply branch is humanized with no em/en dash (WR-01/IN-03).
 */

const ACTIVE = ['sc-domain:deltacloudz.com', 'sc-domain:childrenchic.com'];

function fakeReader(members: string[]): ActiveClientReader {
  return { async smembers(): Promise<string[]> { return members; } };
}

/** Channel reader mapping a fixed set of siteUrls to channel ids. */
function fakeChannelReader(map: Record<string, string>): ChannelMapReader {
  return {
    async hget(_key: string, field: string): Promise<string | null> {
      return map[field] ?? null;
    },
    async hgetall(): Promise<Record<string, string> | null> {
      return map;
    },
  };
}

const metric = { value: 0, previous: 0, deltaPct: null, improved: true, isNew: false };
const OK_REPORT: WeeklyClientReport = {
  status: 'ok',
  window: {
    currentStart: '2026-06-22',
    currentEnd: '2026-06-28',
    previousStart: '2026-06-15',
    previousEnd: '2026-06-21',
  },
  deltas: { clicks: metric, impressions: metric, ctr: metric, position: metric },
  urls: [],
};

/** Recording post fake. */
function fakePost(): { calls: Array<[string, unknown]>; fn: (channel: string, blocks: unknown[]) => Promise<void> } {
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    fn: async (channel: string, blocks: unknown[]): Promise<void> => {
      calls.push([channel, blocks]);
    },
  };
}

const NO_DASH = /[—–]/;

/** Narrow a plan to its run variant for the background-phase tests. */
function asRun(plan: GetDataPlan): Extract<GetDataPlan, { kind: 'run' }> {
  if (plan.kind !== 'run') {
    throw new Error(`expected a run plan, got ${plan.kind}`);
  }
  return plan;
}

describe('prepareGetData (fast phase)', () => {
  it('returns a usage hint on empty argument and never fetches a channel', async () => {
    const plan = await prepareGetData('', {
      reader: fakeReader(ACTIVE),
      channelReader: fakeChannelReader({}),
    });
    expect(plan.kind).toBe('reply');
    expect(plan.kind === 'reply' && plan.text.toLowerCase()).toContain('uso');
  });

  it('replies on an unknown/inactive client', async () => {
    const plan = await prepareGetData('noexiste.com', {
      reader: fakeReader(ACTIVE),
      channelReader: fakeChannelReader({}),
    });
    expect(plan.kind === 'reply' && plan.text).toContain('no está en el reporte');
  });

  it('replies when the active client has no mapped channel', async () => {
    const plan = await prepareGetData('deltacloudz.com', {
      reader: fakeReader(ACTIVE),
      channelReader: fakeChannelReader({}), // no mapping
    });
    expect(plan.kind === 'reply' && plan.text).toContain('no tiene canal asignado');
    expect(plan.kind === 'reply' && plan.text).toContain('/setchannel');
  });

  it('resolves a green-light plan with the mapped channel and an ack, without any GSC fetch', async () => {
    const getReport = vi.fn(async () => OK_REPORT);
    const plan = await prepareGetData('deltacloudz.com', {
      reader: fakeReader(ACTIVE),
      channelReader: fakeChannelReader({ 'sc-domain:deltacloudz.com': 'C0123ABCD' }),
      getReport,
    });
    expect(plan.kind).toBe('run');
    const run = asRun(plan);
    expect(run.siteUrl).toBe('sc-domain:deltacloudz.com');
    expect(run.channelId).toBe('C0123ABCD');
    expect(run.ack.toLowerCase()).toContain('unos segundos');
    // The fast phase must NOT touch the GSC orchestrator.
    expect(getReport).not.toHaveBeenCalled();
  });
});

describe('runGetData (background phase)', () => {
  const PLAN = { kind: 'run', siteUrl: 'sc-domain:deltacloudz.com', channelId: 'C0123ABCD', ack: 'ack' } as const;

  it('posts an ok report to the mapped channel and confirms the destination', async () => {
    const post = fakePost();
    const getReport = vi.fn(async () => OK_REPORT);
    const reply = await runGetData(PLAN, { getReport, post: post.fn as never });
    expect(getReport).toHaveBeenCalledWith('sc-domain:deltacloudz.com');
    expect(post.calls).toHaveLength(1);
    expect(post.calls[0]![0]).toBe('C0123ABCD');
    expect(reply).toContain('sc-domain:deltacloudz.com');
  });

  it('posts NOTHING and replies truthfully on no_data (WR-02)', async () => {
    const post = fakePost();
    const reply = await runGetData(PLAN, {
      getReport: async () => ({ status: 'no_data' }) as never,
      post: post.fn as never,
    });
    expect(post.calls).toEqual([]);
    expect(reply).toContain('no tiene datos suficientes');
    expect(reply).toContain('No publiqué nada');
  });

  it('posts NOTHING and replies truthfully on insufficient_data (WR-02)', async () => {
    const post = fakePost();
    const reply = await runGetData(PLAN, {
      getReport: async () => ({ status: 'insufficient_data' }) as never,
      post: post.fn as never,
    });
    expect(post.calls).toEqual([]);
    expect(reply).toContain('no tiene datos suficientes');
  });

  it('posts NOTHING and replies generically on an error report (no secret leak)', async () => {
    const post = fakePost();
    const reply = await runGetData(PLAN, {
      getReport: async () => ({ status: 'error', message: 'secreto' }) as never,
      post: post.fn as never,
    });
    expect(post.calls).toEqual([]);
    expect(reply).not.toContain('secreto');
    expect(reply).toContain('No pude armar');
  });
});

describe('handleGetData (composition)', () => {
  it('never fans out to other clients — a single mapped client yields one post', async () => {
    const post = fakePost();
    await handleGetData('deltacloudz.com', {
      reader: fakeReader(ACTIVE),
      channelReader: fakeChannelReader({
        'sc-domain:deltacloudz.com': 'C0001',
        'sc-domain:childrenchic.com': 'C0002',
      }),
      getReport: async () => OK_REPORT,
      post: post.fn as never,
    });
    expect(post.calls).toHaveLength(1);
    expect(post.calls[0]![0]).toBe('C0001');
  });
});

describe('humanization: no em/en dash in any reply branch (WR-01/IN-03)', () => {
  const base = {
    reader: fakeReader(ACTIVE),
    channelReader: fakeChannelReader({ 'sc-domain:deltacloudz.com': 'C0001' }),
  };

  it('usage hint has no dash', async () => {
    const plan = await prepareGetData('', base);
    expect(plan.kind === 'reply' && plan.text).not.toMatch(NO_DASH);
  });

  it('unknown-client reply has no dash', async () => {
    const plan = await prepareGetData('noexiste.com', base);
    expect(plan.kind === 'reply' && plan.text).not.toMatch(NO_DASH);
  });

  it('unmapped-channel reply has no dash', async () => {
    const plan = await prepareGetData('childrenchic.com', base);
    expect(plan.kind === 'reply' && plan.text).not.toMatch(NO_DASH);
  });

  it('ack reply has no dash', async () => {
    const plan = await prepareGetData('deltacloudz.com', base);
    expect(plan.kind === 'run' && plan.ack).not.toMatch(NO_DASH);
  });

  it('happy-path confirmation has no dash', async () => {
    const plan = asRun(await prepareGetData('deltacloudz.com', base));
    const reply = await runGetData(plan, { getReport: async () => OK_REPORT, post: async () => {} });
    expect(reply).not.toMatch(NO_DASH);
  });

  it('no_data notice has no dash', async () => {
    const plan = asRun(await prepareGetData('deltacloudz.com', base));
    const reply = await runGetData(plan, { getReport: async () => ({ status: 'no_data' }) as never, post: async () => {} });
    expect(reply).not.toMatch(NO_DASH);
  });

  it('error notice has no dash', async () => {
    const plan = asRun(await prepareGetData('deltacloudz.com', base));
    const reply = await runGetData(plan, {
      getReport: async () => ({ status: 'error', message: 'x' }) as never,
      post: async () => {},
    });
    expect(reply).not.toMatch(NO_DASH);
  });
});
