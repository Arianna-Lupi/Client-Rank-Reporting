/**
 * `/help` handler.
 *
 * Returns a static Spanish quick-reference of every command the bot supports,
 * so anyone in the channel can discover how to add clients, assign channels and
 * pull a report on demand without leaving Slack. Pure: no I/O, no deps read.
 */

/** The ephemeral `/help` reply text (Slack mrkdwn). Pure and constant. */
export function formatHelpReply(): string {
  return [
    '*Bot de reportes GSC: comandos disponibles*',
    '',
    'Cada mañana publico el reporte semanal de cada cliente en su canal. Estos son los comandos para gestionarlo:',
    '',
    '`/list`',
    'Muestra todas las propiedades de Google Search Console que puedo leer. Las que ya están en el reporte aparecen con ✓, el resto con •.',
    '',
    '`/add <propiedad>`',
    'Agrega un cliente al reporte. Usá el dominio tal cual aparece en `/list`. Ejemplo: `/add childrenchic.com`.',
    '',
    '`/remove <propiedad>`',
    'Quita un cliente del reporte. Ejemplo: `/remove childrenchic.com`.',
    '',
    '`/setchannel <cliente> #canal`',
    'Define en qué canal se publica el reporte de ese cliente. Ejemplo: `/setchannel childrenchic.com #reportes`. Sin canal asignado, el cliente se salta con aviso.',
    '',
    '`/getdata <cliente>`',
    'Genera y publica el reporte de ese cliente ahora mismo en su canal, sin esperar al envío diario. Ejemplo: `/getdata childrenchic.com`.',
    '',
    '`/help`',
    'Muestra esta ayuda.',
    '',
    'Flujo típico para sumar un cliente nuevo: `/list` para ver el nombre exacto, `/add <propiedad>`, `/setchannel <propiedad> <#canal>`, y listo. Podés confirmarlo al toque con `/getdata <propiedad>`.',
  ].join('\n');
}

/** Returns the ephemeral Spanish `/help` reply text. */
export async function handleHelp(): Promise<string> {
  return formatHelpReply();
}
