import { describe, expect, it } from 'vitest';

import { filterReadableSites } from './gsc.js';

/**
 * Unit tests for the readable-site filter (GSC-02). These use mock `siteEntry`
 * arrays and make NO live API calls, so they run without GSC credentials.
 */
describe('filterReadableSites', () => {
  it('excludes siteUnverifiedUser and keeps readable properties with siteUrl intact', () => {
    const entries = [
      { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://www.foo.com/', permissionLevel: 'siteFullUser' },
      { siteUrl: 'https://bar.com/', permissionLevel: 'siteRestrictedUser' },
      { siteUrl: 'https://unverified.com/', permissionLevel: 'siteUnverifiedUser' },
    ];

    const result = filterReadableSites(entries);

    // The unverified property is excluded; readable ones keep their canonical siteUrl.
    expect(result).toEqual([
      { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://www.foo.com/', permissionLevel: 'siteFullUser' },
      { siteUrl: 'https://bar.com/', permissionLevel: 'siteRestrictedUser' },
    ]);
    expect(result.some((s) => s.permissionLevel === 'siteUnverifiedUser')).toBe(false);
  });

  it('returns [] for undefined or empty entries without throwing', () => {
    expect(filterReadableSites(undefined)).toEqual([]);
    expect(filterReadableSites([])).toEqual([]);
  });

  it('skips entries missing siteUrl or permissionLevel', () => {
    const entries = [
      { siteUrl: 'sc-domain:ok.com', permissionLevel: 'siteOwner' },
      { permissionLevel: 'siteOwner' },
      { siteUrl: 'https://no-perm.com/' },
    ];

    expect(filterReadableSites(entries)).toEqual([
      { siteUrl: 'sc-domain:ok.com', permissionLevel: 'siteOwner' },
    ]);
  });
});
