/**
 * `/remove <cliente>` handler (CMD-02 / CMD-04).
 *
 * Resolves the untrusted argument against the CURRENT active set (`clients:active`),
 * NOT `sites.list` — a property may have lost GSC access yet still need removal.
 * Only the canonical `siteUrl` it matched is removed; the raw user text is never
 * passed to Redis. Replies are neutral-Spanish ephemeral-ready strings.
 */
import { getActiveClients, removeClient } from '../clients.js';
import type { ActiveClientReader, ActiveClientWriter } from '../clients.js';
import { resolveSiteRef } from '../site-match.js';

export interface RemoveDeps {
  /** Defaults to the real Redis reader (clients.getActiveClients default). */
  reader?: ActiveClientReader;
  /** Defaults to the real Redis writer (clients.removeClient default). */
  writer?: ActiveClientWriter;
}

/** Returns the ephemeral Spanish reply text for `/remove <arg>`. */
export async function handleRemove(arg: string, deps: RemoveDeps = {}): Promise<string> {
  const ref = arg.trim();
  if (ref === '') {
    return 'Uso: `/remove <propiedad>` — por ejemplo `/remove childrenchic.com`.';
  }

  const active = await getActiveClients(deps.reader);
  const result = resolveSiteRef(ref, [...active]);

  if (result.kind === 'none') {
    return (
      `«${ref}» no estaba en el reporte.\n` +
      'Ejecuta `/list` para ver las propiedades activas (marcadas con ✓).'
    );
  }

  if (result.kind === 'multiple') {
    const lines = result.candidates.map((c) => `• ${c}`).join('\n');
    return `«${ref}» coincide con varias propiedades activas. Pega la exacta:\n${lines}`;
  }

  const removed = await removeClient(result.siteUrl, deps.writer);
  if (removed) {
    return `Listo. Quité *${result.siteUrl}* del reporte diario.`;
  }
  return (
    `«${result.siteUrl}» no estaba en el reporte.\n` +
    'Ejecuta `/list` para ver las propiedades activas (marcadas con ✓).'
  );
}
