/**
 * Active-clients persistence (PER-01).
 *
 * Reads the `clients:active` SET from Upstash Redis — the only state that
 * survives between ephemeral serverless invocations. The set holds canonical
 * GSC `siteUrl` values; Phase 2 will add `sadd`/`srem` for `/add` and `/remove`.
 *
 * Source: https://upstash.com/docs/redis/sdks/ts
 */
import { Redis } from '@upstash/redis';

/** Redis key holding the SET of canonical siteUrls in the daily report. */
const ACTIVE_KEY = 'clients:active';

/** Minimal read surface this module needs — lets tests inject a mock client. */
export interface ActiveClientReader {
  smembers(key: string): Promise<string[]>;
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
 * Read the set of active client siteUrls from Redis.
 *
 * @param reader Optional injected reader (defaults to the env-configured Redis
 *               client). Tests pass a mock to exercise the logic without a live
 *               Upstash connection.
 */
export async function getActiveClients(
  reader: ActiveClientReader = getRedis(),
): Promise<Set<string>> {
  const members = await reader.smembers(ACTIVE_KEY);
  return new Set(members);
}
