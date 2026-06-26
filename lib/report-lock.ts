/**
 * Daily-report idempotency claim (PER-02).
 *
 * Before the cron posts, it atomically claims a per-day lock in Redis with
 * `SET report:posted:<dateKey> 1 NX EX <ttl>`. The first invocation of the day
 * writes the key and wins the claim; any retry or extra invocation within the
 * report hour finds the key present and is skipped — preventing duplicate posts.
 *
 * The locker is injectable (same lazy `Redis.fromEnv()` pattern as clients.ts),
 * so importing this module never crashes without Upstash credentials and the
 * claim logic is unit-tested with a fake.
 */
import { Redis } from '@upstash/redis';

/** Key prefix for the per-day idempotency lock. */
const LOCK_PREFIX = 'report:posted:';

/** Lock TTL: 36 h, comfortably longer than the report window without lingering. */
const LOCK_TTL_SECONDS = 129600;

/** Minimal write surface this module needs — lets tests inject a fake client. */
export interface DailyReportLocker {
  set(key: string, value: string, opts: { nx: true; ex: number }): Promise<unknown>;
}

// Lazily created from env so importing this module never crashes when the
// Upstash credentials are absent (e.g. during unit tests of other modules).
let redis: Redis | undefined;
function getRedis(): Redis {
  if (redis === undefined) {
    redis = Redis.fromEnv(); // reads UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
  }
  return redis;
}

/**
 * Atomically claim the daily report lock for `dateKey` (YYYY-MM-DD in REPORT_TZ).
 *
 * @returns `true` when this call won the claim (SET NX wrote the key, returning
 *          'OK'); `false` when the key already existed (NX failed, returning null).
 */
export async function claimDailyReport(
  dateKey: string,
  locker: DailyReportLocker = getRedis(),
): Promise<boolean> {
  const result = await locker.set(`${LOCK_PREFIX}${dateKey}`, '1', {
    nx: true,
    ex: LOCK_TTL_SECONDS,
  });
  return result === 'OK';
}
