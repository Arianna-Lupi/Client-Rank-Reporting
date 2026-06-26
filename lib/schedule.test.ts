import { describe, expect, it } from 'vitest';

import { isReportHour, reportDateKey } from './schedule.js';

/**
 * Pure scheduling tests (SCH-01). `now` is always an injected fixed instant, so
 * these are deterministic and never read the wall clock. DST cases use
 * America/New_York (an unambiguous DST-observing zone) to prove the local hour
 * comes from Intl, not from a fixed UTC offset.
 */
const TZ = 'America/New_York';

describe('isReportHour', () => {
  it('returns true when the local hour equals the target hour', () => {
    // 2026-07-15 13:00 UTC = 09:00 EDT
    expect(isReportHour(new Date('2026-07-15T13:00:00Z'), TZ, 9)).toBe(true);
  });

  it('returns false on a non-matching hour', () => {
    // 2026-07-15 12:00 UTC = 08:00 EDT
    expect(isReportHour(new Date('2026-07-15T12:00:00Z'), TZ, 9)).toBe(false);
  });

  it('[DST] resolves local hour 9 across both DST and standard time', () => {
    // Summer (EDT, UTC-4): 13:00Z -> 09:00 local
    const summer = new Date('2026-07-15T13:00:00Z');
    // Winter (EST, UTC-5): 14:00Z -> 09:00 local
    const winter = new Date('2026-01-15T14:00:00Z');
    expect(isReportHour(summer, TZ, 9)).toBe(true);
    expect(isReportHour(winter, TZ, 9)).toBe(true);
    // The same UTC hour does NOT match across the DST boundary:
    expect(isReportHour(new Date('2026-01-15T13:00:00Z'), TZ, 9)).toBe(false);
  });
});

describe('reportDateKey', () => {
  it('returns the local YYYY-MM-DD, which can differ from the UTC day', () => {
    // 2026-06-26 02:00 UTC = 2026-06-25 22:00 in New_York (UTC-4)
    expect(reportDateKey(new Date('2026-06-26T02:00:00Z'), TZ)).toBe('2026-06-25');
  });

  it('returns the matching local day for a midday instant', () => {
    expect(reportDateKey(new Date('2026-06-26T13:00:00Z'), TZ)).toBe('2026-06-26');
  });
});
