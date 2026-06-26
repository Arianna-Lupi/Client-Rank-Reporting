/**
 * Proactive Slack posting (RPT-03).
 *
 * `postMessage(channel, blocks)` POSTs a Block Kit message to Slack's
 * `chat.postMessage` Web API with `Authorization: Bearer <SLACK_BOT_TOKEN>`.
 * Proactive posts require a BOT token (not the request-signing secret), so this
 * reads `slackBotToken` from config by default. No Slack SDK — a plain `fetch`,
 * consistent with the project decision.
 *
 * Security: the bot token is never logged and never interpolated into the error
 * surfaced on a failed post; only Slack's own error code is propagated.
 */
import type { SlackBlock } from './blocks.js';
import { getConfig } from '../config.js';

/** Minimal shape of the chat.postMessage JSON response we depend on. */
interface SlackPostResponse {
  ok?: boolean;
  error?: string;
}

/** Injectable dependencies — both default to production (global fetch + config token). */
export interface PostDeps {
  fetchImpl?: typeof fetch;
  token?: string;
}

/**
 * Post a Block Kit message to `channel`. Resolves on `ok: true`; throws an Error
 * carrying Slack's error code (never the token) when the API returns `ok: false`.
 * `getConfig()` is only read when no token is injected, so tests need no env.
 */
export async function postMessage(
  channel: string,
  blocks: SlackBlock[],
  deps: PostDeps = {},
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const token = deps.token ?? getConfig().slackBotToken;

  const response = await fetchImpl('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel, blocks }),
  });

  const data = (await response.json()) as SlackPostResponse;
  if (data.ok !== true) {
    throw new Error(`Slack chat.postMessage falló: ${data.error ?? 'desconocido'}`);
  }
}
