/**
 * `/setchannel <cliente> <#canal>` handler (CH-02).
 *
 * Assigns the Slack channel where a client's weekly report gets posted. Slack
 * sends the channel as an escaped mention `<#C0123ABCD|name>`; this handler
 * extracts and persists only the `C…` id, never the raw `#name`. The client ref
 * is resolved against the ACTIVE set, so an off-roster property can never be
 * mapped. All replies are neutral-Spanish, humanized, and secret-free.
 *
 * v1.1 only ASSIGNS a channel; clearing a mapping is deferred to v2.
 */
import { getActiveClients } from '../clients.js';
import type { ActiveClientReader } from '../clients.js';
import { setClientChannel } from '../channels.js';
import type { ChannelMapWriter } from '../channels.js';
import { resolveSiteRef } from '../site-match.js';

export interface SetChannelDeps {
  /** Defaults to the real Redis reader (clients.getActiveClients default). */
  reader?: ActiveClientReader;
  /** Defaults to the real Redis writer (channels.setClientChannel default). */
  writer?: ChannelMapWriter;
}

/** Parsed Slack channel mention. */
interface ParsedChannel {
  id: string;
  name: string;
}

/**
 * Extract the channel id (and name) from Slack's escaped mention
 * `<#C0123ABCD|name>`. Returns null for anything else, including a bare `#name`
 * (which carries no id) or free-form garbage (T-07-04).
 */
function parseChannel(ref: string): ParsedChannel | null {
  const match = ref.match(/^<#(C[A-Z0-9]+)(?:\|([^>]*))?>$/);
  if (match === null) {
    return null;
  }
  return { id: match[1]!, name: match[2] ?? '' };
}

/** Returns the ephemeral Spanish reply for `/setchannel <cliente> <#canal>`. */
export async function handleSetChannel(
  arg: string,
  deps: SetChannelDeps = {},
): Promise<string> {
  const trimmed = arg.trim();
  const firstSpace = trimmed.indexOf(' ');
  if (trimmed === '' || firstSpace === -1) {
    return (
      'Uso: `/setchannel <cliente> <#canal>`. ' +
      'Por ejemplo `/setchannel deltacloudz.com #reportes`.'
    );
  }

  const clientRef = trimmed.slice(0, firstSpace).trim();
  const channelRef = trimmed.slice(firstSpace + 1).trim();

  const channel = parseChannel(channelRef);
  if (channel === null) {
    return (
      'No reconozco ese canal. Elígelo desde el autocompletado de Slack: ' +
      'escribe # y selecciónalo de la lista para que llegue con su id.'
    );
  }

  const active = [...(await getActiveClients(deps.reader))];
  const result = resolveSiteRef(clientRef, active);

  if (result.kind === 'none') {
    return `«${clientRef}» no está en el reporte. Agrégalo con \`/add\` primero.`;
  }
  if (result.kind === 'multiple') {
    const lines = result.candidates.map((c) => `• ${c}`).join('\n');
    return `«${clientRef}» coincide con varias propiedades. Pega la exacta:\n${lines}`;
  }

  await setClientChannel(result.siteUrl, channel.id, deps.writer);
  const channelLabel = channel.name === '' ? 'ese canal' : `#${channel.name}`;
  return `Listo, el reporte de *${result.siteUrl}* ahora se publica en ${channelLabel}.`;
}
