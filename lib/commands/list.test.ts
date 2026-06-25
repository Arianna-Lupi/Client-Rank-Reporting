import { describe, expect, it } from 'vitest';

import type { GscSite } from '../gsc.js';
import type { ActiveClientReader } from '../clients.js';
import { formatListReply, handleList } from './list.js';

/**
 * Locks the Phase 1 `/list` output so moving it into lib/commands/list.ts is
 * provably behavior-preserving. No live GSC/Upstash — fakes only.
 */

const FIXTURES: GscSite[] = [
  { siteUrl: 'sc-domain:aprendoclub.com', permissionLevel: 'siteOwner' },
  { siteUrl: 'https://childrenchic.com/', permissionLevel: 'siteFullUser' },
];

const EMPTY_TEXT =
  'No hay propiedades legibles por la Service Account todavía.\n' +
  'Agrega el correo de la Service Account como usuario en cada propiedad de ' +
  'Google Search Console y vuelve a ejecutar `/list`.';

function fakeReader(members: string[]): ActiveClientReader {
  return { async smembers(): Promise<string[]> { return members; } };
}

describe('formatListReply', () => {
  it('returns the unchanged empty-properties text', () => {
    expect(formatListReply([], new Set())).toBe(EMPTY_TEXT);
  });

  it('marks active properties with ✓ and the rest with •', () => {
    const active = new Set(['https://childrenchic.com/']);
    expect(formatListReply(FIXTURES, active)).toBe(
      '*Propiedades GSC*\n• sc-domain:aprendoclub.com\n✓ https://childrenchic.com/',
    );
  });
});

describe('handleList', () => {
  it('composes the same text from injected sites + reader', async () => {
    const reply = await handleList({
      listReadableSites: async () => FIXTURES,
      reader: fakeReader(['https://childrenchic.com/']),
    });
    expect(reply).toBe(
      '*Propiedades GSC*\n• sc-domain:aprendoclub.com\n✓ https://childrenchic.com/',
    );
  });

  it('returns the empty text when there are no readable sites', async () => {
    const reply = await handleList({
      listReadableSites: async () => [],
      reader: fakeReader([]),
    });
    expect(reply).toBe(EMPTY_TEXT);
  });
});
