import { describe, expect, it } from 'vitest';

import type { GscSite } from '../gsc.js';
import type { ActiveClientWriter } from '../clients.js';
import { handleAdd } from './add.js';

/**
 * Unit tests for handleAdd (CMD-01 / CMD-04). All deps are injected fakes — no
 * live GSC `sites.list`, no live Upstash. Asserts the canonical siteUrl from the
 * readable list (never the raw user argument) is what reaches the writer.
 */

/** The five real readable fixtures as GscSite[]. */
const FIXTURES: GscSite[] = [
  { siteUrl: 'sc-domain:aprendoclub.com', permissionLevel: 'siteOwner' },
  { siteUrl: 'https://childrenchic.com/', permissionLevel: 'siteFullUser' },
  { siteUrl: 'sc-domain:ariannalupi.com', permissionLevel: 'siteOwner' },
  { siteUrl: 'https://aprendoseo.com/', permissionLevel: 'siteOwner' },
  { siteUrl: 'sc-domain:nicmafia.com', permissionLevel: 'siteRestrictedUser' },
];

/** Fake writer recording sadd/srem calls and returning a programmed count. */
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

function depsWith(sites: GscSite[], writer: ActiveClientWriter) {
  return { listReadableSites: async () => sites, writer };
}

describe('handleAdd', () => {
  it('returns a usage hint on empty argument without touching sites or writer', async () => {
    const writer = fakeWriter(1);
    let sitesCalled = false;
    const reply = await handleAdd('', {
      listReadableSites: async () => {
        sitesCalled = true;
        return FIXTURES;
      },
      writer,
    });
    expect(reply).toContain('Uso');
    expect(reply).toContain('/add');
    expect(sitesCalled).toBe(false);
    expect(writer.saddCalls).toEqual([]);
  });

  it('adds the canonical siteUrl resolved from a convenience input', async () => {
    const writer = fakeWriter(1);
    const reply = await handleAdd('childrenchic.com', depsWith(FIXTURES, writer));
    expect(reply).toContain('https://childrenchic.com/');
    expect(writer.saddCalls).toEqual([['clients:active', ['https://childrenchic.com/']]]);
  });

  it('reports already-present when sadd returns 0', async () => {
    const writer = fakeWriter(0);
    const reply = await handleAdd('sc-domain:ariannalupi.com', depsWith(FIXTURES, writer));
    expect(reply).toContain('ya estaba en el reporte');
  });

  it('returns a not-readable error with a /list hint and never writes', async () => {
    const writer = fakeWriter(1);
    const reply = await handleAdd('noexiste.com', depsWith(FIXTURES, writer));
    expect(reply).toContain('no es una propiedad legible');
    expect(reply).toContain('/list');
    expect(writer.saddCalls).toEqual([]);
  });

  it('lists both candidates on a multi-match and never writes', async () => {
    const writer = fakeWriter(1);
    const multi: GscSite[] = [
      { siteUrl: 'sc-domain:foo.com', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://foo.com/', permissionLevel: 'siteOwner' },
    ];
    const reply = await handleAdd('foo.com', depsWith(multi, writer));
    expect(reply).toContain('sc-domain:foo.com');
    expect(reply).toContain('https://foo.com/');
    expect(writer.saddCalls).toEqual([]);
  });
});
