import { describe, expect, it, vi } from 'vitest';

import type { ActiveClientReader } from '../clients.js';
import type { ChannelMapReader } from '../channels.js';
import type { WeeklyClientReport } from '../weekly-report.js';
import { handleGetData } from './getdata.js';

/**
 * Unit tests for handleGetData (CMD-09). All deps injected — no live Slack/GSC.
 * Asserts the post targets the MAPPED channel id, that unmapped/unknown paths
 * post nothing, and that replies are humanized Spanish.
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

describe('handleGetData', () => {
  it('returns a usage hint on empty argument and posts nothing', async () => {
    const post = fakePost();
    const reply = await handleGetData('', {
      reader: fakeReader(ACTIVE),
      channelReader: fakeChannelReader({}),
      getReport: async () => OK_REPORT,
      post: post.fn as never,
    });
    expect(reply.toLowerCase()).toContain('uso');
    expect(post.calls).toEqual([]);
  });

  it('errors on an unknown/inactive client and posts nothing', async () => {
    const post = fakePost();
    const reply = await handleGetData('noexiste.com', {
      reader: fakeReader(ACTIVE),
      channelReader: fakeChannelReader({}),
      getReport: async () => OK_REPORT,
      post: post.fn as never,
    });
    expect(reply).toContain('no está en el reporte');
    expect(post.calls).toEqual([]);
  });

  it('errors when the active client has no mapped channel and posts nothing', async () => {
    const post = fakePost();
    const reply = await handleGetData('deltacloudz.com', {
      reader: fakeReader(ACTIVE),
      channelReader: fakeChannelReader({}), // no mapping
      getReport: async () => OK_REPORT,
      post: post.fn as never,
    });
    expect(reply).toContain('no tiene canal asignado');
    expect(reply).toContain('/setchannel');
    expect(post.calls).toEqual([]);
  });

  it('posts the weekly report to the mapped channel and confirms the destination', async () => {
    const post = fakePost();
    const getReport = vi.fn(async () => OK_REPORT);
    const reply = await handleGetData('deltacloudz.com', {
      reader: fakeReader(ACTIVE),
      channelReader: fakeChannelReader({ 'sc-domain:deltacloudz.com': 'C0123ABCD' }),
      getReport,
      post: post.fn as never,
    });
    expect(getReport).toHaveBeenCalledWith('sc-domain:deltacloudz.com');
    expect(post.calls).toHaveLength(1);
    expect(post.calls[0]![0]).toBe('C0123ABCD'); // posted to the mapped channel id
    expect(reply).toContain('sc-domain:deltacloudz.com');
    expect(reply).not.toMatch(/[—–]/);
  });

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
