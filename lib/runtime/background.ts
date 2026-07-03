/**
 * Background-work scheduler for serverless (CR-01).
 *
 * After a Slack slash command acks within the 3-second deadline, the heavy
 * work (GSC fetch + proactive post + response_url follow-up) must keep running
 * even though the HTTP response has already been returned. On Vercel Fluid
 * Compute the platform exposes a `waitUntil(promise)` on the per-request context
 * that keeps the function alive until the promise settles. We read that context
 * via the well-known `@vercel/request-context` symbol so we depend on NO extra
 * package (the same mechanism `@vercel/functions` uses internally).
 *
 * When no platform context is present (local dev, tests, other hosts) we fall
 * back to a detached promise whose rejection is swallowed, so a background
 * failure can never become an unhandled rejection that crashes the process.
 */

const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');

interface RequestContext {
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * Register `promise` as background work. Uses the platform `waitUntil` when
 * available; otherwise detaches the promise and swallows any rejection.
 */
export function scheduleBackground(promise: Promise<unknown>): void {
  const store = (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] as
    | { get?: () => RequestContext | undefined }
    | undefined;
  const waitUntil = store?.get?.()?.waitUntil;
  if (typeof waitUntil === 'function') {
    waitUntil(promise);
    return;
  }
  void promise.catch(() => {
    // Detached fallback: never surface an unhandled rejection.
  });
}
