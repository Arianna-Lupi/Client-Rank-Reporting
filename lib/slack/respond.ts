/**
 * Slack `response_url` follow-up sender (CR-01, deferred-work delivery).
 *
 * A slash command must be ACKnowledged within Slack's 3-second deadline. When
 * the real work (a GSC fetch plus a proactive post) runs in the background AFTER
 * that ack, the final confirmation cannot ride the initial HTTP response — it is
 * long gone. Slack's `response_url` is the documented channel for exactly this:
 * a short-lived URL (30 minutes, up to 5 uses) you POST a follow-up message to.
 *
 * This posts an EPHEMERAL follow-up (only the invoker sees it), never leaks a
 * token or internal error, and is a plain `fetch` — consistent with post.ts.
 *
 * Source: https://docs.slack.dev/interactivity/handling-user-interaction/#response_url
 */

/** Injectable fetch so the follow-up path is testable offline. */
export interface RespondDeps {
  fetchImpl?: typeof fetch;
}

/**
 * POST an ephemeral follow-up to a Slack `response_url`. A blank url is a no-op
 * (nothing to deliver to). Network/API failures are swallowed: a failed
 * follow-up must never crash the background job or surface a stack trace.
 */
export async function sendResponseUrl(
  responseUrl: string,
  text: string,
  deps: RespondDeps = {},
): Promise<void> {
  if (responseUrl === '') {
    return;
  }
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  try {
    await fetchImpl(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ response_type: 'ephemeral', text }),
    });
  } catch {
    // Best-effort delivery: never propagate a follow-up failure.
  }
}
