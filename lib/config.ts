/**
 * Centralized, fail-fast configuration loader (SCH-03).
 *
 * Reads every sensitive setting from environment variables. Any required
 * variable that is missing or empty triggers a clear error that names the
 * offending variable. Secret VALUES are never logged (ASVS V7).
 */

export interface AppConfig {
  /** Slack signing secret used to verify the HMAC of incoming requests. */
  readonly slackSigningSecret: string;
  /** Destination Slack channel id (used by the daily report in Phase 4). */
  readonly slackChannelId: string;
  /** Base64-encoded Service Account JSON for Google Search Console auth. */
  readonly gscSaKeyB64: string;
  /** Upstash Redis REST endpoint URL. */
  readonly upstashRedisRestUrl: string;
  /** Upstash Redis REST token. */
  readonly upstashRedisRestToken: string;
  /** IANA timezone for the daily report. Defaults to America/Mexico_City. */
  readonly reportTz: string;
}

const DEFAULT_REPORT_TZ = 'America/Mexico_City';

/**
 * Read a required environment variable. Throws a descriptive error that names
 * the variable (but never the value of any secret) when it is undefined or
 * blank.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        'Define it in .env.local (dev) or the Vercel project settings (prod).',
    );
  }
  return value;
}

let cached: AppConfig | undefined;

/**
 * Build (and memoize) the validated application configuration. Call this early
 * in a cold start so missing configuration fails fast before any work runs.
 */
export function getConfig(): AppConfig {
  if (cached !== undefined) {
    return cached;
  }
  cached = {
    slackSigningSecret: requireEnv('SLACK_SIGNING_SECRET'),
    slackChannelId: requireEnv('SLACK_CHANNEL_ID'),
    gscSaKeyB64: requireEnv('GSC_SA_KEY_B64'),
    upstashRedisRestUrl: requireEnv('UPSTASH_REDIS_REST_URL'),
    upstashRedisRestToken: requireEnv('UPSTASH_REDIS_REST_TOKEN'),
    reportTz: process.env.REPORT_TZ?.trim() || DEFAULT_REPORT_TZ,
  };
  return cached;
}

/**
 * Reset the memoized configuration. Intended for tests that mutate
 * `process.env` between cases.
 */
export function resetConfigCache(): void {
  cached = undefined;
}
