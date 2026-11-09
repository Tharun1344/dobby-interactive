'use strict';
const { cmd } = require('../command');
const interactive = require('../lib/interactive');
const menuMode = require('../lib/menuMode');
const usage = require('../lib/usage');
const { buildMenuText } = require('../lib/commandList');

function classic(context) {
  return context.reply(buildMenuText(context.prefix));
}

// `.menu` opens the interactive menu (or the classic list in text mode).
// `.menu text|classic|list` always prints the classic command list.
// `.help <command>` (and `.menu <command>`) prints detailed usage.
cmd({ pattern: 'menu', alias: ['help', 'commands'], desc: 'Show the menu or detailed usage: .help <command>', category: 'main' }, async (sock, incoming, m, context) => {
  const arg = String(context.args[0] || '').toLowerCase();
  const classicWord = ['text', 'classic', 'list'].includes(arg);
  const helpRequest = arg && (!classicWord || context.command !== 'menu');

  if (helpRequest) {
    const entry = usage.getUsage(arg);
    if (entry) {
      await context.reply(usage.formatUsage(entry, context.prefix));
      return;
    }
    if (!classicWord) {
      await context.reply(`❓ Unknown command: *${arg}*\n\nSend *${context.prefix}menu text* for the full command list.`);
      return;
    }
  }

  if (classicWord) {
    await classic(context);
    return;
  }

  // Classic Text Mode is a per-account preference. It never disables ordinary
  // commands; it only changes how `.menu` is delivered. INTERACTIVE_TEXT_ONLY
  // still uses the interactive engine's numbered text fallback, preserving the
  // original environment-variable semantics.
  if (menuMode.get(context.accountId) === 'text') {
    await classic(context);
    return;
  }

  const opened = await interactive.openMenu({ sock, incoming, m, context });
  if (!opened) await classic(context);
});
