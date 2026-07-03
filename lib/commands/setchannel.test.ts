import { describe, expect, it } from 'vitest';

import type { ActiveClientReader } from '../clients.js';
import type { ChannelMapWriter } from '../channels.js';
import { handleSetChannel } from './setchannel.js';

/**
 * Unit tests for handleSetChannel (CH-02). All deps injected — no live Upstash.
 * Asserts the parsed C-id and canonical siteUrl reach the writer, and that every
 * error path replies in humanized Spanish without persisting anything.
 */

const ACTIVE = ['sc-domain:deltacloudz.com', 'sc-domain:childrenchic.com'];

/** Fake active-set reader over a fixed member list. */
function fakeReader(members: string[]): ActiveClientReader {
  return { async smembers(): Promise<string[]> { return members; } };
}

/** Recording channel writer. */
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

describe('handleSetChannel', () => {
  it('returns a usage hint naming both operands when arg has fewer than two tokens', async () => {
    const writer = fakeWriter();
    const reply = await handleSetChannel('deltacloudz.com', {
      reader: fakeReader(ACTIVE),
      channelWriter: writer,
    });
    expect(reply.toLowerCase()).toContain('uso');
    expect(reply).toContain('/setchannel');
    expect(writer.hsetCalls).toEqual([]);
  });

  it('rejects a malformed channel reference and persists nothing', async () => {
    const writer = fakeWriter();
    const reply = await handleSetChannel('deltacloudz.com #general', {
      reader: fakeReader(ACTIVE),
      channelWriter: writer,
    });
    expect(reply).toContain('canal');
    expect(reply).toContain('autocompletado');
    expect(writer.hsetCalls).toEqual([]);
  });

  it('rejects a client that is not in the active set', async () => {
    const writer = fakeWriter();
    const reply = await handleSetChannel('noexiste.com <#C0123ABCD|general>', {
      reader: fakeReader(ACTIVE),
      channelWriter: writer,
    });
    expect(reply).toContain('no está en el reporte');
    expect(writer.hsetCalls).toEqual([]);
  });

  it('persists the parsed C-id and canonical siteUrl on the happy path', async () => {
    const writer = fakeWriter();
    const reply = await handleSetChannel('deltacloudz.com <#C0123ABCD|deltacloudz>', {
      reader: fakeReader(ACTIVE),
      channelWriter: writer,
    });
    expect(writer.hsetCalls).toEqual([
      ['clients:channels', { 'sc-domain:deltacloudz.com': 'C0123ABCD' }],
    ]);
    expect(reply).toContain('sc-domain:deltacloudz.com');
    expect(reply).toContain('deltacloudz'); // channel name echoed
  });

  it('never emits an em/en dash in any reply', async () => {
    const replies = await Promise.all([
      handleSetChannel('', { reader: fakeReader(ACTIVE), channelWriter: fakeWriter() }),
      handleSetChannel('deltacloudz.com #general', { reader: fakeReader(ACTIVE), channelWriter: fakeWriter() }),
      handleSetChannel('noexiste.com <#C0123ABCD|general>', { reader: fakeReader(ACTIVE), channelWriter: fakeWriter() }),
      handleSetChannel('deltacloudz.com <#C0123ABCD|deltacloudz>', { reader: fakeReader(ACTIVE), channelWriter: fakeWriter() }),
    ]);
    for (const r of replies) {
      expect(r).not.toMatch(/[—–]/);
    }
  });
});
