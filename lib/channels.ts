/**
 * Client -> Slack channel map (CH-01).
 *
 * Mirrors lib/clients.ts in structure: a fixed Redis key, a lazy `getRedis()`
 * so importing never crashes without Upstash credentials, and injectable
 * reader/writer surfaces so every path is unit-tested offline with fakes.
 *
 * Storage: a Redis HASH `clients:channels` where the field is the canonical GSC
 * `siteUrl` and the value is the resolved Slack channel id (`C…`). The `#name`
 * is never stored — only the id survives, so the cron can route each client's
 * report to a stable channel.
 *
 * Source: https://upstash.com/docs/redis/sdks/ts
 */
import { Redis } from '@upstash/redis';

/** Redis HASH holding the canonical siteUrl -> Slack channel id map. */
const CHANNELS_KEY = 'clients:channels';

/** Minimal read surface this module needs — lets tests inject a mock client. */
export interface ChannelMapReader {
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string> | null>;
}

/** Minimal write surface — lets tests inject a fake without live Upstash. */
export interface ChannelMapWriter {
  hset(key: string, obj: Record<string, string>): Promise<number>;
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
 * Read the Slack channel id mapped to a canonical siteUrl.
 *
 * @param siteUrl Canonical GSC siteUrl (the HASH field).
 * @param reader  Optional injected reader (defaults to the env Redis client).
 * @returns The channel id, or `null` when the client has no mapping yet.
 */
export async function getClientChannel(
  siteUrl: string,
  reader: ChannelMapReader = getRedis(),
): Promise<string | null> {
  return reader.hget(CHANNELS_KEY, siteUrl);
}

/**
 * Persist the resolved Slack channel id for a canonical siteUrl.
 *
 * Callers MUST pass a canonical `siteUrl` and a resolved channel id (`C…`) —
 * never the `#name`. Raw user text is validated upstream before it reaches here.
 *
 * @param siteUrl   Canonical GSC siteUrl (the HASH field).
 * @param channelId Resolved Slack channel id (the HASH value).
 * @param writer    Optional injected writer (defaults to the env Redis client).
 */
export async function setClientChannel(
  siteUrl: string,
  channelId: string,
  writer: ChannelMapWriter = getRedis(),
): Promise<void> {
  await writer.hset(CHANNELS_KEY, { [siteUrl]: channelId });
}

/**
 * Read the whole client -> channel map in one round trip (used by the cron).
 *
 * @param reader Optional injected reader (defaults to the env Redis client).
 * @returns A Map of siteUrl -> channelId; an EMPTY Map when the key does not
 *          exist yet (`hgetall` returns null).
 */
export async function getAllChannels(
  reader: ChannelMapReader = getRedis(),
): Promise<Map<string, string>> {
  const all = await reader.hgetall(CHANNELS_KEY);
  if (all === null) {
    return new Map();
  }
  return new Map(Object.entries(all));
}
