/**
 * Slack slash-command endpoint (CMD-03, CMD-05, PER-01).
 *
 * Web-standard Vercel **Node** function. It must stay on the Node runtime
 * because `googleapis` does not run on Edge, so no edge-runtime export is
 * declared anywhere in this file. It:
 *   1. reads the RAW request body with `await req.text()` (Slack signs the raw
 *      bytes; parsing first would break the HMAC — Pitfall 1/2),
 *   2. verifies the Slack signature over those bytes and returns 401 on failure
 *      BEFORE any GSC/Redis work (T-01-07 / T-01-08 mitigation),
 *   3. routes `/list`: merges the GSC readable properties with the active set in
 *      Redis, marking active ones with ✓, and replies ephemerally (Spanish).
 *
 * Security (ASVS V7): never log the raw body, the signature headers, or any
 * secret. Errors reply with a generic Spanish message, never internal detail.
 *
 * Sources:
 *  - https://vercel.com/kb/guide/how-do-i-get-the-raw-body-of-a-serverless-function
 *  - https://docs.slack.dev/authentication/verifying-requests-from-slack/
 */
import { getActiveClients } from '../../lib/clients.js';
import { getConfig } from '../../lib/config.js';
import { listReadableSites } from '../../lib/gsc.js';
import type { GscSite } from '../../lib/gsc.js';
import { verifySlackSignature } from '../../lib/slack/verify.js';

// Fail-fast on cold start (SCH-03): validate every required env var the moment
// the function module is loaded, before a single request is served. If any is
// missing the cold start throws and the deploy surfaces the misconfiguration
// immediately instead of erroring deep inside `/list`. This reference also
// keeps `lib/config` wired into the real request path (not orphaned).
getConfig();

/**
 * Render the `/list` reply text in Spanish (mrkdwn). Pure: no I/O, so the
 * empty-properties case is trivially correct and testable. Active properties
 * (present in the Redis set) get a ✓; the rest get a • bullet.
 */
function formatListReply(sites: ReadonlyArray<GscSite>, active: ReadonlySet<string>): string {
  if (sites.length === 0) {
    return (
      'No hay propiedades legibles por la Service Account todavía.\n' +
      'Agrega el correo de la Service Account como usuario en cada propiedad de ' +
      'Google Search Console y vuelve a ejecutar `/list`.'
    );
  }
  const lines = sites.map((s) => `${active.has(s.siteUrl) ? '✓' : '•'} ${s.siteUrl}`);
  return `*Propiedades GSC*\n${lines.join('\n')}`;
}

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

  // 4. Input validation (V5): only the supported command proceeds.
  if (command !== '/list') {
    return ephemeral('Comando no soportado.');
  }

  // 5. Compose the reply from GSC + Redis. Any failure (auth, network) replies
  //    with a generic Spanish message rather than crashing or leaking detail.
  try {
    const [sites, active] = await Promise.all([listReadableSites(), getActiveClients()]);
    return ephemeral(formatListReply(sites, active));
  } catch {
    return ephemeral('Ocurrió un error al consultar las propiedades. Intenta de nuevo.');
  }
}
