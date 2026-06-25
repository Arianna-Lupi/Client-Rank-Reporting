/**
 * `/add <cliente>` handler (CMD-01 / CMD-04).
 *
 * Resolves the untrusted argument against the LIVE readable `sites.list`, then
 * persists only the canonical `siteUrl` it matched — the raw user text is never
 * written to Redis. All replies are neutral-Spanish ephemeral-ready strings; no
 * secret or raw body is ever interpolated.
 */
import { addClient } from '../clients.js';
import type { ActiveClientWriter } from '../clients.js';
import { listReadableSites as realListReadableSites } from '../gsc.js';
import type { GscSite } from '../gsc.js';
import { resolveSiteRef } from '../site-match.js';

export interface AddDeps {
  /** Defaults to the real gsc.listReadableSites. */
  listReadableSites?: () => Promise<GscSite[]>;
  /** Defaults to the real Redis writer (clients.addClient default). */
  writer?: ActiveClientWriter;
}

/** Returns the ephemeral Spanish reply text for `/add <arg>`. */
export async function handleAdd(arg: string, deps: AddDeps = {}): Promise<string> {
  const ref = arg.trim();
  if (ref === '') {
    return 'Uso: `/add <propiedad>` — por ejemplo `/add childrenchic.com`.';
  }

  const listSites = deps.listReadableSites ?? realListReadableSites;
  const sites = await listSites();
  const candidates = sites.map((s) => s.siteUrl);
  const result = resolveSiteRef(ref, candidates);

  if (result.kind === 'none') {
    return (
      `«${ref}» no es una propiedad legible por el bot.\n` +
      'Ejecuta `/list` para ver las propiedades disponibles.'
    );
  }

  if (result.kind === 'multiple') {
    const lines = result.candidates.map((c) => `• ${c}`).join('\n');
    return (
      `«${ref}» coincide con varias propiedades. Pega la exacta:\n${lines}`
    );
  }

  const added = await addClient(result.siteUrl, deps.writer);
  if (added) {
    return `Listo. Agregué *${result.siteUrl}* al reporte diario.`;
  }
  return `*${result.siteUrl}* ya estaba en el reporte.`;
}
