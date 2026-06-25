/**
 * Slack command router (CMD-01 / CMD-02 / CMD-03 / CMD-04).
 *
 * Pure routing over the Slack `command` field to the three handlers. Unknown
 * commands return the fixed "Comando no soportado." string and never reach a
 * handler (T-02-08 mitigation). Deps are threaded through so production wires the
 * real GSC + Redis defaults while tests inject fakes.
 */
import { handleAdd } from './add.js';
import type { AddDeps } from './add.js';
import { handleList } from './list.js';
import type { ListDeps } from './list.js';
import { handleRemove } from './remove.js';
import type { RemoveDeps } from './remove.js';

export type CommandDeps = AddDeps & RemoveDeps & ListDeps;

/** Routes on the Slack command field. Returns the ephemeral reply text. */
export async function dispatch(
  command: string | null,
  arg: string,
  deps: CommandDeps = {},
): Promise<string> {
  switch (command) {
    case '/list':
      return handleList(deps);
    case '/add':
      return handleAdd(arg, deps);
    case '/remove':
      return handleRemove(arg, deps);
    default:
      return 'Comando no soportado.';
  }
}
