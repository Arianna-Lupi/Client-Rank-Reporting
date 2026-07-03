/**
 * Idempotent roster seed (CFG-01).
 *
 * Seeds the initial active-client SET (`clients:active`) with the v1.1 roster.
 * SADD is idempotent, so re-running only re-adds members that already exist —
 * no duplicate state, safe to run more than once (T-07-03).
 *
 * The seed loads ONLY the active set. Channel mappings are assigned afterward via
 * `/setchannel`; this script never preloads `clients:channels`.
 *
 * CANONICAL siteUrl CAVEAT: the exact canonical string for each property must be
 * confirmed against `sites.list` before the live run (a property can exist as a
 * `sc-domain:<host>` domain property OR an `https://<host>/` URL-prefix entry).
 * The entries below use the domain-property form (`sc-domain:<host>`) as the
 * default; adjust any that GSC exposes only as a URL-prefix before seeding live.
 * Live execution is deferred to the credentials unblock (standing blocker).
 *
 * Run directly (once creds exist):  node scripts/seed-roster.js
 */
import { addClient } from '../lib/clients.js';
import type { ActiveClientWriter } from '../lib/clients.js';

/**
 * The v1.1 roster of canonical GSC siteUrls to seed into the active set.
 * nicmafia is intentionally excluded. childrenchic.com is seeded as-is pending
 * Arianna's domain rename (update this entry when the new domain is live).
 */
export const ROSTER: readonly string[] = [
  'sc-domain:deltacloudz.com',
  'sc-domain:felipevergara.co',
  // childrenchic.com — seeded as-is; update when Arianna's domain rename lands.
  'sc-domain:childrenchic.com',
  'sc-domain:fhcaorlando.com',
];

/**
 * SADD every roster siteUrl into the active set. Reuses lib/clients.ts
 * `addClient` (which writes to `clients:active`), passing the injectable writer
 * through so the seed is unit-testable offline.
 *
 * @param writer Optional injected writer (defaults to the env Redis client).
 */
export async function seedRoster(writer?: ActiveClientWriter): Promise<void> {
  for (const siteUrl of ROSTER) {
    await addClient(siteUrl, writer);
  }
}

// Main guard: run the seed with the real Redis writer when executed directly.
// `import.meta.url` matches the invoked script path only for a direct `node`
// run, not when imported by a test.
if (
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`
) {
  seedRoster()
    .then(() => {
      console.log(`seed-roster: seeded ${ROSTER.length} clients into clients:active`);
    })
    .catch((err: unknown) => {
      // Secret-free: log only a generic failure line, never the Redis token.
      console.error('seed-roster: failed to seed roster', err instanceof Error ? err.message : '');
      process.exitCode = 1;
    });
}
