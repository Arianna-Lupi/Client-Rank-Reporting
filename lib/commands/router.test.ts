import { describe, expect, it } from 'vitest';

import type { GscSite } from '../gsc.js';
import type { ActiveClientReader, ActiveClientWriter } from '../clients.js';
import { dispatch } from './router.js';
import type { CommandDeps } from './router.js';

/**
 * Routing tests for dispatch(). Injects fakes for sites/reader/writer so no live
 * GSC/Upstash is touched. Covers /list, /add, /remove and the unsupported branch.
 */

const FIXTURES: GscSite[] = [
  { siteUrl: 'sc-domain:aprendoclub.com', permissionLevel: 'siteOwner' },
  { siteUrl: 'https://childrenchic.com/', permissionLevel: 'siteFullUser' },
];

function fakeReader(members: string[]): ActiveClientReader {
  return { async smembers(): Promise<string[]> { return members; } };
}

function fakeWriter(result: number): ActiveClientWriter {
  return {
    async sadd(): Promise<number> { return result; },
    async srem(): Promise<number> { return result; },
  };
}

function deps(): CommandDeps {
  return {
    listReadableSites: async () => FIXTURES,
    reader: fakeReader(['https://childrenchic.com/']),
    writer: fakeWriter(1),
  };
}

describe('dispatch', () => {
  it('routes /list to the list reply', async () => {
    const reply = await dispatch('/list', '', deps());
    expect(reply).toContain('*Propiedades GSC*');
  });

  it('routes /add to handleAdd', async () => {
    const reply = await dispatch('/add', 'childrenchic.com', deps());
    expect(reply).toContain('https://childrenchic.com/');
  });

  it('routes /remove to handleRemove', async () => {
    const reply = await dispatch('/remove', 'childrenchic.com', deps());
    expect(reply).toContain('https://childrenchic.com/');
  });

  it('routes /setchannel to handleSetChannel', async () => {
    const hsetCalls: Array<[string, Record<string, string>]> = [];
    const reply = await dispatch('/setchannel', 'childrenchic.com <#C0777XYZ|childrenchic>', {
      ...deps(),
      channelWriter: {
        async hset(key: string, obj: Record<string, string>): Promise<number> {
          hsetCalls.push([key, obj]);
          return 1;
        },
      },
    });
    expect(reply).toContain('https://childrenchic.com/');
    expect(hsetCalls).toEqual([['clients:channels', { 'https://childrenchic.com/': 'C0777XYZ' }]]);
  });

  it('routes /getdata to handleGetData', async () => {
    const posts: Array<[string, unknown]> = [];
    const reply = await dispatch('/getdata', 'childrenchic.com', {
      ...deps(),
      channelReader: {
        async hget(): Promise<string | null> { return 'C0777XYZ'; },
        async hgetall(): Promise<Record<string, string> | null> { return null; },
      },
      getReport: async () => ({ status: 'no_data' }) as never,
      post: (async (channel: string, blocks: unknown[]) => {
        posts.push([channel, blocks]);
      }) as never,
    });
    expect(reply).toContain('https://childrenchic.com/');
    expect(posts).toHaveLength(1);
    expect(posts[0]![0]).toBe('C0777XYZ');
  });

  it('returns the unsupported message for an unknown command', async () => {
    expect(await dispatch('/desconocido', '', deps())).toBe('Comando no soportado.');
  });

  it('returns the unsupported message for a null command', async () => {
    expect(await dispatch(null, '', deps())).toBe('Comando no soportado.');
  });
});
