import { describe, expect, it } from 'vitest';

import { postMessage } from './post.js';
import type { SlackBlock } from './blocks.js';

/**
 * Proactive posting tests (RPT-03). A fake fetch captures the request and
 * returns a programmed Slack JSON response, so nothing hits the live API. The
 * injected token lets the test run without env, and the ok:false case asserts
 * the bot token never leaks into the thrown error.
 */
const TOKEN = 'xoxb-super-secret-token-123';
const CHANNEL = 'C0123456789';
const BLOCKS: SlackBlock[] = [{ type: 'section', text: { type: 'mrkdwn', text: 'hola' } }];

/** Build a fake fetch capturing url/options and returning a Slack-shaped JSON. */
function fakeFetch(payload: { ok?: boolean; error?: string }): {
  impl: typeof fetch;
  calls: Array<[string, RequestInit | undefined]>;
} {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const impl = (async (url: string | URL | Request, options?: RequestInit) => {
    calls.push([String(url), options]);
    return { json: async () => payload } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('postMessage', () => {
  it('POSTs to chat.postMessage with a Bearer token and channel+blocks body', async () => {
    const { impl, calls } = fakeFetch({ ok: true });
    await postMessage(CHANNEL, BLOCKS, { fetchImpl: impl, token: TOKEN });

    expect(calls).toHaveLength(1);
    const [url, options] = calls[0]!;
    expect(url).toBe('https://slack.com/api/chat.postMessage');
    expect(options?.method).toBe('POST');
    const headers = options?.headers as Record<string, string>;
    expect(headers['Authorization']?.startsWith('Bearer ')).toBe(true);
    expect(headers['Content-Type']).toContain('application/json');
    const body = JSON.parse(String(options?.body));
    expect(body.channel).toBe(CHANNEL);
    expect(body.blocks).toEqual(BLOCKS);
  });

  it('throws on ok:false including the Slack error code but not the token', async () => {
    const { impl } = fakeFetch({ ok: false, error: 'channel_not_found' });

    await expect(
      postMessage(CHANNEL, BLOCKS, { fetchImpl: impl, token: TOKEN }),
    ).rejects.toThrow(/channel_not_found/);

    let message = '';
    try {
      await postMessage(CHANNEL, BLOCKS, { fetchImpl: impl, token: TOKEN });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('channel_not_found');
    expect(message).not.toContain(TOKEN);
  });
});
