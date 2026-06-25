import { describe, expect, it } from 'vitest';

import { normalizeSiteRef, resolveSiteRef } from './site-match.js';

/**
 * Unit tests for the pure site-matching helpers (CMD-01 / CMD-04). No network,
 * no env, no Redis — just string logic over the five real GSC fixtures plus
 * synthetic multi/none cases.
 */

/** The canonical siteUrls currently readable in the account (real fixtures). */
const FIXTURES = [
  'sc-domain:aprendoclub.com',
  'https://childrenchic.com/',
  'sc-domain:ariannalupi.com',
  'https://aprendoseo.com/',
  'sc-domain:nicmafia.com',
];

describe('normalizeSiteRef', () => {
  it('strips scheme, www and trailing slash', () => {
    expect(normalizeSiteRef('https://www.childrenchic.com/')).toBe('childrenchic.com');
  });

  it('strips the sc-domain: prefix and lowercases', () => {
    expect(normalizeSiteRef('sc-domain:Ariannalupi.com')).toBe('ariannalupi.com');
  });

  it('is case-insensitive over the host', () => {
    expect(normalizeSiteRef('HTTP://WWW.NICMAFIA.COM')).toBe('nicmafia.com');
  });

  it('leaves an already-bare host unchanged', () => {
    expect(normalizeSiteRef('aprendoseo.com')).toBe('aprendoseo.com');
  });

  it('strips a trailing slash on its own', () => {
    expect(normalizeSiteRef('childrenchic.com/')).toBe('childrenchic.com');
  });
});

describe('resolveSiteRef', () => {
  it('returns an exact match outright on a canonical siteUrl', () => {
    expect(resolveSiteRef('sc-domain:ariannalupi.com', FIXTURES)).toEqual({
      kind: 'match',
      siteUrl: 'sc-domain:ariannalupi.com',
    });
  });

  it('resolves a convenience input to its single normalized candidate', () => {
    expect(resolveSiteRef('childrenchic.com', FIXTURES)).toEqual({
      kind: 'match',
      siteUrl: 'https://childrenchic.com/',
    });
  });

  it('normalizes scheme and www before matching', () => {
    expect(resolveSiteRef('https://www.aprendoseo.com', FIXTURES)).toEqual({
      kind: 'match',
      siteUrl: 'https://aprendoseo.com/',
    });
  });

  it('returns none when nothing matches', () => {
    expect(resolveSiteRef('noexiste.com', FIXTURES)).toEqual({ kind: 'none' });
  });

  it('returns multiple when several candidates normalize the same', () => {
    const synthetic = ['sc-domain:foo.com', 'https://foo.com/'];
    expect(resolveSiteRef('foo.com', synthetic)).toEqual({
      kind: 'multiple',
      candidates: ['sc-domain:foo.com', 'https://foo.com/'],
    });
  });

  it('lets an exact match win over normalized ambiguity', () => {
    const synthetic = ['sc-domain:foo.com', 'https://foo.com/'];
    expect(resolveSiteRef('https://foo.com/', synthetic)).toEqual({
      kind: 'match',
      siteUrl: 'https://foo.com/',
    });
  });
});
