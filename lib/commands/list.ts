/**
 * `/list` handler (CMD-03), moved verbatim from the Phase 1 shell.
 *
 * Merges the GSC readable properties with the active set in Redis, marking
 * active ones with ✓ and the rest with •. The formatter is pure; `handleList`
 * composes it over injectable deps so it is unit-testable without live services.
 */
import { getActiveClients } from '../clients.js';
import type { ActiveClientReader } from '../clients.js';
import { listReadableSites as realListReadableSites } from '../gsc.js';
import type { GscSite } from '../gsc.js';

export interface ListDeps {
  listReadableSites?: () => Promise<GscSite[]>;
  reader?: ActiveClientReader;
}

/**
 * Render the `/list` reply text in Spanish (mrkdwn). Pure: no I/O. Active
 * properties (present in the Redis set) get a ✓; the rest get a • bullet.
 */
export function formatListReply(
  sites: ReadonlyArray<GscSite>,
  active: ReadonlySet<string>,
): string {
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

/** Returns the ephemeral Spanish `/list` reply text. */
export async function handleList(deps: ListDeps = {}): Promise<string> {
  const listSites = deps.listReadableSites ?? realListReadableSites;
  const [sites, active] = await Promise.all([listSites(), getActiveClients(deps.reader)]);
  return formatListReply(sites, active);
}
