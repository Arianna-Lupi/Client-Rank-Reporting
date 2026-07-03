import { describe, expect, it } from 'vitest';

import type { ActiveClientWriter } from '../lib/clients.js';
import { ROSTER, seedRoster } from './seed-roster.js';

/**
 * Offline tests for the roster seed (CFG-01). All Redis access is injected as a
 * fake writer — the live SADD run is deferred to the credentials unblock.
 */

/** Fake writer recording every SADD, returning a programmed count. */
function fakeWriter(saddResult: number): ActiveClientWriter & {
  saddCalls: Array<[string, string[]]>;
} {
  const saddCalls: Array<[string, string[]]> = [];
  return {
    saddCalls,
    async sadd(key: string, ...members: string[]): Promise<number> {
      saddCalls.push([key, members]);
      return saddResult;
    },
    async srem(): Promise<number> {
      return 0;
    },
  };
}

describe('ROSTER', () => {
  it('contains exactly the four canonical hosts', () => {
    expect(ROSTER).toHaveLength(4);
  });

  it('includes deltacloudz, felipevergara, childrenchic and fhcaorlando', () => {
    const joined = ROSTER.join(' ');
    expect(joined).toContain('deltacloudz.com');
    expect(joined).toContain('felipevergara.co');
    expect(joined).toContain('childrenchic.com');
    expect(joined).toContain('fhcaorlando.com');
  });

  it('excludes nicmafia', () => {
    expect(ROSTER.some((s) => s.includes('nicmafia'))).toBe(false);
  });
});

describe('seedRoster', () => {
  it('issues one SADD to clients:active per roster entry', async () => {
    const writer = fakeWriter(1);
    await seedRoster(writer);
    expect(writer.saddCalls).toHaveLength(ROSTER.length);
    for (const [key, members] of writer.saddCalls) {
      expect(key).toBe('clients:active');
      expect(members).toHaveLength(1);
    }
    const seeded = writer.saddCalls.map(([, members]) => members[0]);
    expect(new Set(seeded)).toEqual(new Set(ROSTER));
  });

  it('is idempotent — re-running against an already-present set does not throw', async () => {
    const writer = fakeWriter(0); // SADD returns 0: member already present
    await expect(seedRoster(writer)).resolves.not.toThrow();
    expect(writer.saddCalls).toHaveLength(ROSTER.length);
  });
});
