import { describe, expect, it } from 'vitest';

import type { ActiveClientReader, ActiveClientWriter } from '../clients.js';
import { handleRemove } from './remove.js';

/**
 * Unit tests for handleRemove (CMD-02 / CMD-04). Resolution targets the injected
 * ACTIVE set (not sites.list), so a property is removable even if it is no
 * longer readable. No live Upstash; the writer is a recording fake.
 */

/** Fake reader returning a fixed active set. */
function fakeReader(members: string[]): ActiveClientReader {
  return { async smembers(): Promise<string[]> { return members; } };
}

/** Fake writer recording srem calls and returning a programmed count. */
function fakeWriter(sremResult: number): ActiveClientWriter & {
  sremCalls: Array<[string, string[]]>;
} {
  const sremCalls: Array<[string, string[]]> = [];
  return {
    sremCalls,
    async sadd(): Promise<number> {
      return 0;
    },
    async srem(key: string, ...members: string[]): Promise<number> {
      sremCalls.push([key, members]);
      return sremResult;
    },
  };
}

describe('handleRemove', () => {
  it('returns a usage hint on empty argument without touching reader or writer', async () => {
    const writer = fakeWriter(1);
    const reply = await handleRemove('', {
      reader: fakeReader(['https://childrenchic.com/']),
      writer,
    });
    expect(reply).toContain('Uso');
    expect(reply).toContain('/remove');
    expect(writer.sremCalls).toEqual([]);
  });

  it('removes the canonical siteUrl resolved from the active set', async () => {
    const writer = fakeWriter(1);
    const reply = await handleRemove('childrenchic.com', {
      reader: fakeReader(['https://childrenchic.com/']),
      writer,
    });
    expect(reply).toContain('https://childrenchic.com/');
    expect(writer.sremCalls).toEqual([['clients:active', ['https://childrenchic.com/']]]);
  });

  it('returns not-in-report with a /list hint when not in the active set', async () => {
    const writer = fakeWriter(1);
    const reply = await handleRemove('nicmafia.com', {
      reader: fakeReader(['https://childrenchic.com/']),
      writer,
    });
    expect(reply).toContain('no estaba en el reporte');
    expect(reply).toContain('/list');
    expect(writer.sremCalls).toEqual([]);
  });

  it('lists both active candidates on a multi-match and never writes', async () => {
    const writer = fakeWriter(1);
    const reply = await handleRemove('foo.com', {
      reader: fakeReader(['sc-domain:foo.com', 'https://foo.com/']),
      writer,
    });
    expect(reply).toContain('sc-domain:foo.com');
    expect(reply).toContain('https://foo.com/');
    expect(writer.sremCalls).toEqual([]);
  });

  it('returns not-in-report when srem loses a race (returns 0)', async () => {
    const writer = fakeWriter(0);
    const reply = await handleRemove('childrenchic.com', {
      reader: fakeReader(['https://childrenchic.com/']),
      writer,
    });
    expect(reply).toContain('no estaba en el reporte');
  });
});
