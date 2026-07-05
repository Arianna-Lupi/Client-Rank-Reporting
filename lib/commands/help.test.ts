import { describe, expect, it } from 'vitest';

import { formatHelpReply, handleHelp } from './help.js';

/**
 * The /help reply is static, so these tests pin its contract: it must document
 * every user-facing command by name, so nobody in the channel is left guessing.
 */
describe('formatHelpReply', () => {
  it('lists every supported command', () => {
    const text = formatHelpReply();
    for (const cmd of ['/list', '/add', '/remove', '/setchannel', '/getdata', '/help']) {
      expect(text).toContain(cmd);
    }
  });

  it('explains how to add a new client', () => {
    expect(formatHelpReply()).toContain('`/add <propiedad>`');
  });

  it('handleHelp resolves to the same text', async () => {
    expect(await handleHelp()).toBe(formatHelpReply());
  });
});
