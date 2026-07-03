import { describe, expect, it } from 'vitest';

import type { ChannelMapReader, ChannelMapWriter } from './channels.js';
import { getAllChannels, getClientChannel, setClientChannel } from './channels.js';

/**
 * Unit tests for the client->channel map (CH-01). All deps are injected fakes —
 * no live Upstash, no env read. Asserts the HASH key `clients:channels`, the
 * canonical siteUrl field, and the channel id value round-trip correctly.
 */

/** Fake reader over an in-memory record, recording the field/key it was asked for. */
function fakeReader(store: Record<string, string> | null): ChannelMapReader & {
  hgetCalls: Array<[string, string]>;
  hgetallCalls: string[];
} {
  const hgetCalls: Array<[string, string]> = [];
  const hgetallCalls: string[] = [];
  return {
    hgetCalls,
    hgetallCalls,
    async hget(key: string, field: string): Promise<string | null> {
      hgetCalls.push([key, field]);
      return store?.[field] ?? null;
    },
    async hgetall(key: string): Promise<Record<string, string> | null> {
      hgetallCalls.push(key);
      return store;
    },
  };
}

/** Fake writer recording every hset call. */
function fakeWriter(): ChannelMapWriter & { hsetCalls: Array<[string, Record<string, string>]> } {
  const hsetCalls: Array<[string, Record<string, string>]> = [];
  return {
    hsetCalls,
    async hset(key: string, obj: Record<string, string>): Promise<number> {
      hsetCalls.push([key, obj]);
      return 1;
    },
  };
}

describe('setClientChannel', () => {
  it('persists the channel id under field=siteUrl in HASH clients:channels', async () => {
    const writer = fakeWriter();
    await setClientChannel('sc-domain:deltacloudz.com', 'C0123ABCD', writer);
    expect(writer.hsetCalls).toEqual([
      ['clients:channels', { 'sc-domain:deltacloudz.com': 'C0123ABCD' }],
    ]);
  });
});

describe('getClientChannel', () => {
  it('returns the stored channel id for a mapped siteUrl', async () => {
    const reader = fakeReader({ 'sc-domain:deltacloudz.com': 'C0123ABCD' });
    const channel = await getClientChannel('sc-domain:deltacloudz.com', reader);
    expect(channel).toBe('C0123ABCD');
    expect(reader.hgetCalls).toEqual([['clients:channels', 'sc-domain:deltacloudz.com']]);
  });

  it('returns null for an unmapped siteUrl', async () => {
    const reader = fakeReader({ 'sc-domain:deltacloudz.com': 'C0123ABCD' });
    const channel = await getClientChannel('sc-domain:felipevergara.co', reader);
    expect(channel).toBeNull();
  });
});

describe('getAllChannels', () => {
  it('returns a Map of every field->value from hgetall', async () => {
    const reader = fakeReader({
      'sc-domain:deltacloudz.com': 'C0001',
      'sc-domain:childrenchic.com': 'C0002',
    });
    const map = await getAllChannels(reader);
    expect(map).toBeInstanceOf(Map);
    expect(map.get('sc-domain:deltacloudz.com')).toBe('C0001');
    expect(map.get('sc-domain:childrenchic.com')).toBe('C0002');
    expect(map.size).toBe(2);
    expect(reader.hgetallCalls).toEqual(['clients:channels']);
  });

  it('returns an empty Map when hgetall returns null (no key yet)', async () => {
    const reader = fakeReader(null);
    const map = await getAllChannels(reader);
    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBe(0);
  });
});
