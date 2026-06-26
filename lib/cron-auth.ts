/**
 * Cron authorization gate (SCH-02).
 *
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` on every invocation
 * when `CRON_SECRET` is configured in the project env. The cron endpoint must
 * reject any request that does not carry the exact secret, so an external caller
 * cannot trigger the daily report.
 *
 * Pure and side-effect free: never logs the header or the secret (ASVS V7).
 */

/**
 * True only when `headers` carries exactly `Authorization: Bearer <secret>`.
 * A blank secret never authorizes (defensive): a misconfigured deploy must not
 * accept a bare `Bearer ` header.
 */
export function isAuthorizedCron(headers: Headers, secret: string): boolean {
  if (secret.trim() === '') {
    return false;
  }
  const provided = headers.get('authorization');
  if (provided === null) {
    return false;
  }
  return provided === `Bearer ${secret}`;
}
