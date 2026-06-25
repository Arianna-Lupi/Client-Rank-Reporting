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

/** Minimal write surface — lets tests inject a fake without live Upstash. */
export interface ActiveClientWriter {
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
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

/**
 * Add a canonical siteUrl to the active set (CMD-01 persistence).
 *
 * Callers MUST pass a canonical `siteUrl` already resolved against an
 * authoritative list — raw user text is never written here.
 *
 * @param siteUrl Canonical GSC siteUrl to persist.
 * @param writer  Optional injected writer (defaults to the env-configured Redis
 *                client). Tests pass a fake to avoid a live Upstash connection.
 * @returns `true` when the member was newly added (SADD returned 1).
 */
export async function addClient(
  siteUrl: string,
  writer: ActiveClientWriter = getRedis(),
): Promise<boolean> {
  return (await writer.sadd(ACTIVE_KEY, siteUrl)) === 1;
}

/**
 * Remove a canonical siteUrl from the active set (CMD-02 persistence).
 *
 * @param siteUrl Canonical GSC siteUrl to remove.
 * @param writer  Optional injected writer (defaults to the env-configured Redis
 *                client). Tests pass a fake to avoid a live Upstash connection.
 * @returns `true` when the member was present and removed (SREM returned 1).
 */
export async function removeClient(
  siteUrl: string,
  writer: ActiveClientWriter = getRedis(),
): Promise<boolean> {
  return (await writer.srem(ACTIVE_KEY, siteUrl)) === 1;
}
