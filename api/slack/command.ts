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
 *      dispatcher (`/list`, `/add`, `/remove`, `/setchannel`), replying
 *      ephemerally (Spanish).
 *
 * 3-second ack (CR-01): the FAST commands (`/list`, `/add`, `/remove`,
 * `/setchannel`) finish well inside Slack's 3s budget and reply inline.
 * `/getdata` cannot — it runs a 21-day GSC fetch plus a proactive post. So it is
 * handled specially: a fast validation acks immediately, and the heavy fetch +
 * post run in the background (`waitUntil`), with the final confirmation
 * delivered to the invoker via Slack's `response_url` follow-up rather than the
 * initial HTTP response. This keeps the ack under 3s and removes the
 * timeout-retry that would otherwise double-post to a client channel.
 *
 * Security (ASVS V7): never log the raw body, the signature headers, or any
 * secret. Errors reply with a generic Spanish message, never internal detail.
 *
 * Sources:
 *  - https://vercel.com/kb/guide/how-do-i-get-the-raw-body-of-a-serverless-function
 *  - https://docs.slack.dev/authentication/verifying-requests-from-slack/
 *  - https://docs.slack.dev/interactivity/handling-user-interaction/#response_url
 */
import { dispatch } from '../../lib/commands/router.js';
import type { CommandDeps } from '../../lib/commands/router.js';
import { prepareGetData, runGetData } from '../../lib/commands/getdata.js';
import { sendResponseUrl } from '../../lib/slack/respond.js';
import { scheduleBackground } from '../../lib/runtime/background.js';
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

/**
 * Injectable seams so the endpoint (signature gate + 3s-ack routing) is testable
 * offline. Vercel calls `POST(req)` with no second argument, so every field
 * defaults to the real production import and the live path is unchanged.
 */
export interface CommandEndpointDeps {
  dispatch?: typeof dispatch;
  prepare?: typeof prepareGetData;
  run?: typeof runGetData;
  respond?: typeof sendResponseUrl;
  schedule?: typeof scheduleBackground;
  handlerDeps?: CommandDeps;
}

export async function POST(req: Request, deps: CommandEndpointDeps = {}): Promise<Response> {
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
  const responseUrl = params.get('response_url') ?? '';

  const dispatchImpl = deps.dispatch ?? dispatch;
  const prepare = deps.prepare ?? prepareGetData;
  const run = deps.run ?? runGetData;
  const respond = deps.respond ?? sendResponseUrl;
  const schedule = deps.schedule ?? scheduleBackground;
  const handlerDeps = deps.handlerDeps;

  // 4. Route the command. Any failure (auth, network) replies with a generic
  //    Spanish message rather than crashing or leaking detail. No deps -> the
  //    handlers wire the real GSC + Redis defaults in production.
  try {
    // /getdata is the only command with heavy work (GSC fetch + a proactive
    // post) that would blow the 3-second ack on the request path. Validate fast,
    // ack immediately, and run the fetch + post in the background — delivering
    // the confirmation via response_url so it never rides the ack (CR-01).
    if (command === '/getdata') {
      const plan = await prepare(text, handlerDeps);
      if (plan.kind === 'reply') {
        // Validation errors need no GSC fetch: reply inline within the ack.
        return ephemeral(plan.text);
      }
      // Kick off the heavy work WITHOUT awaiting it, then ack. Exactly one
      // response_url follow-up is sent whether the job succeeds or fails.
      schedule(
        run(plan, handlerDeps)
          .then((confirmation) => respond(responseUrl, confirmation))
          .catch(() =>
            respond(
              responseUrl,
              `No pude terminar el reporte de *${plan.siteUrl}*. Inténtalo de nuevo en un momento.`,
            ),
          ),
      );
      return ephemeral(plan.ack);
    }

    return ephemeral(await dispatchImpl(command, text, handlerDeps));
  } catch {
    return ephemeral('Ocurrió un error al consultar las propiedades. Intenta de nuevo.');
  }
}
