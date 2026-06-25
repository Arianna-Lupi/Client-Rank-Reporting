/**
 * Slack slash-command endpoint (CMD-03, CMD-05, PER-01).
 *
 * Web-standard Vercel **Node** function (stays on Node: `googleapis` does not
 * run on Edge, so no edge-runtime export is declared). Thin dispatcher shell:
 *   1. reads the RAW request body with `await req.text()` (Slack signs the raw
 *      bytes; parsing first would break the HMAC — Pitfall 1/2),
 *   2. verifies the Slack signature over those bytes and returns 401 on failure
 *      BEFORE any parsing or backend work (T-02-06 / T-02-07 mitigation),
 *   3. parses the verified body and routes the `command` field through the
 *      dispatcher (`/list`, `/add`, `/remove`), replying ephemerally (Spanish).
 *
 * Security (ASVS V7): never log the raw body, the signature headers, or any
 * secret. Errors reply with a generic Spanish message, never internal detail.
 *
 * Sources:
 *  - https://vercel.com/kb/guide/how-do-i-get-the-raw-body-of-a-serverless-function
 *  - https://docs.slack.dev/authentication/verifying-requests-from-slack/
 */
import { dispatch } from '../../lib/commands/router.js';
import { getConfig } from '../../lib/config.js';
import { verifySlackSignature } from '../../lib/slack/verify.js';

// Fail-fast on cold start (SCH-03): validate every required env var the moment
// the function module is loaded, before a single request is served. If any is
// missing the cold start throws and the deploy surfaces the misconfiguration
// immediately. This reference also keeps `lib/config` wired into the real
// request path (not orphaned).
getConfig();

/** Build an ephemeral Slack JSON response. */
function ephemeral(text: string): Response {
  return Response.json({ response_type: 'ephemeral', text });
}

export async function POST(req: Request): Promise<Response> {
  // 1. Raw body — unparsed bytes, exactly what Slack signed.
  const raw = await req.text();

  // 2. Verify the signature BEFORE parsing or any backend work.
  const signature = req.headers.get('x-slack-signature') ?? '';
  const timestamp = req.headers.get('x-slack-request-timestamp') ?? '';
  if (!verifySlackSignature(raw, timestamp, signature)) {
    return new Response('invalid signature', { status: 401 });
  }

  // 3. Now it is safe to parse the verified body (x-www-form-urlencoded).
  const params = new URLSearchParams(raw);
  const command = params.get('command');
  const text = params.get('text') ?? '';

  // 4. Route the command. Any failure (auth, network) replies with a generic
  //    Spanish message rather than crashing or leaking detail. No deps -> the
  //    handlers wire the real GSC + Redis defaults in production.
  try {
    return ephemeral(await dispatch(command, text));
  } catch {
    return ephemeral('Ocurrió un error al consultar las propiedades. Intenta de nuevo.');
  }
}
