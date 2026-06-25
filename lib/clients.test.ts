import { describe, expect, it } from 'vitest';

import { addClient, removeClient } from './clients.js';
import type { ActiveClientWriter } from './clients.js';

/**
 * Unit tests for the write half of the clients repository (CMD-01 / CMD-02).
 * A hand-rolled fake `ActiveClientWriter` records calls and returns a programmed
 * count, so nothing touches a live Upstash connection.
 */

/** Fake writer recording the last sadd/srem call and returning a fixed count. */
function fakeWriter(result: number): ActiveClientWriter & {
  saddCalls: Array<[string, string[]]>;
  sremCalls: Array<[string, string[]]>;
} {
  const saddCalls: Array<[string, string[]]> = [];
  const sremCalls: Array<[string, string[]]> = [];
  return {
    saddCalls,
    sremCalls,
    async sadd(key: string, ...members: string[]): Promise<number> {
      saddCalls.push([key, members]);
      return result;
    },
    async srem(key: string, ...members: string[]): Promise<number> {
      sremCalls.push([key, members]);
      return result;
    },
  };
}

describe('addClient', () => {
  it('SADDs the canonical siteUrl and returns true when newly added', async () => {
    const writer = fakeWriter(1);
    const added = await addClient('sc-domain:ariannalupi.com', writer);

    expect(added).toBe(true);
    expect(writer.saddCalls).toEqual([['clients:active', ['sc-domain:ariannalupi.com']]]);
  });

  it('returns false when the siteUrl was already present (sadd 0)', async () => {
    const writer = fakeWriter(0);
    expect(await addClient('sc-domain:ariannalupi.com', writer)).toBe(false);
  });
});

describe('removeClient', () => {
  it('SREMs the canonical siteUrl and returns true when it was present', async () => {
    const writer = fakeWriter(1);
    const removed = await removeClient('https://childrenchic.com/', writer);

    expect(removed).toBe(true);
    expect(writer.sremCalls).toEqual([['clients:active', ['https://childrenchic.com/']]]);
  });

  it('returns false when the siteUrl was absent (srem 0)', async () => {
    const writer = fakeWriter(0);
    expect(await removeClient('https://childrenchic.com/', writer)).toBe(false);
  });
});
