import { describe, expect, it } from 'vitest';

import { claimDailyReport } from './report-lock.js';
import type { DailyReportLocker } from './report-lock.js';

/**
 * Idempotency-claim tests (PER-02). A fake locker records the SET call and
 * returns a programmed value: 'OK' on the first claim of the day (key written)
 * and null when the NX claim fails (key already existed). Nothing touches a
 * live Upstash connection.
 */
function fakeLocker(result: 'OK' | null): DailyReportLocker & {
  calls: Array<[string, string, { nx: true; ex: number }]>;
} {
  const calls: Array<[string, string, { nx: true; ex: number }]> = [];
  return {
    calls,
    async set(key: string, value: string, opts: { nx: true; ex: number }): Promise<unknown> {
      calls.push([key, value, opts]);
      return result;
    },
  };
}

describe('claimDailyReport', () => {
  it('claims the lock the first time (set returns OK) and uses the prefixed key with nx', async () => {
    const locker = fakeLocker('OK');
    const claimed = await claimDailyReport('2026-06-26', locker);

    expect(claimed).toBe(true);
    expect(locker.calls).toHaveLength(1);
    const [key, value, opts] = locker.calls[0]!;
    expect(key).toBe('report:posted:2026-06-26');
    expect(key.startsWith('report:posted:')).toBe(true);
    expect(value).toBe('1');
    expect(opts.nx).toBe(true);
    expect(opts.ex).toBeGreaterThan(0);
  });

  it('returns false when the key already existed (set returns null)', async () => {
    const locker = fakeLocker(null);
    expect(await claimDailyReport('2026-06-26', locker)).toBe(false);
  });
});
