/**
 * Slack request signature verification (CMD-05, security gate).
 *
 * Reconstructs the `v0:{timestamp}:{rawBody}` base string, computes an
 * HMAC-SHA256 with the signing secret, and compares it against the
 * `x-slack-signature` header in constant time. Requests outside a 5-minute
 * window are rejected to mitigate replay attacks.
 *
 * Security invariants (ASVS V6):
 * - NEVER compare signatures with `===` (timing attack). Use `timingSafeEqual`.
 * - Length-guard before `timingSafeEqual` (it throws on mismatched lengths).
 * - NEVER log the signing secret or the raw body (ASVS V7).
 *
 * Source: https://docs.slack.dev/authentication/verifying-requests-from-slack/
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Replay window in seconds (Slack's documented tolerance). */
const MAX_AGE_SECONDS = 60 * 5;

/**
 * Verify a Slack request signature over the raw request body.
 *
 * @param rawBody       The exact, unparsed request body bytes as a string.
 * @param timestamp     The `x-slack-request-timestamp` header (unix seconds).
 * @param signature     The `x-slack-signature` header, e.g. `v0=<hex>`.
 * @param signingSecret The Slack signing secret. Defaults to env for prod use;
 *                      tests inject a known value.
 * @param now           Current time in milliseconds. Injectable for tests.
 * @returns `true` only when the signature is authentic and fresh.
 */
export function verifySlackSignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  signingSecret: string = process.env.SLACK_SIGNING_SECRET ?? '',
  now: number = Date.now(),
): boolean {
  if (signingSecret === '') {
    return false;
  }

  // 1. Replay protection: reject non-numeric or stale/future timestamps.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return false;
  }
  if (Math.abs(now / 1000 - ts) > MAX_AGE_SECONDS) {
    return false;
  }

  // 2. Reconstruct the base string and the expected signature.
  const base = `v0:${timestamp}:${rawBody}`;
  const expected = 'v0=' + createHmac('sha256', signingSecret).update(base).digest('hex');

  // 3. Constant-time compare with a length guard (timingSafeEqual throws on
  //    differing lengths, so we must check first — never use `===`).
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, signatureBuf);
}
