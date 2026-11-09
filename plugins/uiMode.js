'use strict';
const { cmd } = require('../command');
const menuMode = require('../lib/menuMode');

function ownerOnly(c) {
  if (!c.isOwner) {
    c.reply('⛔ Owner only.');
    return false;
  }
  return true;
}

cmd({ pattern: 'buttons', desc: 'Owner: enable interactive button/list menus', category: 'owner', fromMe: true }, async (_s, _m, _msg, c) => {
  if (!ownerOnly(c)) return;
  const accountId = c.accountId || 'default';
  try {
    menuMode.set(accountId, 'interactive');
  } catch (err) {
    return c.reply(`❌ Could not save menu mode: ${err.message}`);
  }
  const env = menuMode.envState();
  if (!env.enabled) {
    return c.reply([
      '✅ *Interactive Mode preference saved*',
      '',
      '⚠️ Menus are still text-only because the operator set *INTERACTIVE_ENABLED=false*.',
      'This is a deliberate global safety switch; .buttons does not override it.',
      `👤 Account: ${accountId}`,
    ].join('\n'));
  }
  if (env.textOnly) {
    return c.reply([
      '✅ *Interactive Mode preference saved*',
      '',
      '⚠️ Menus are still text-only because the operator set *INTERACTIVE_TEXT_ONLY=true*.',
      'This global override is stronger than per-account mode.',
      `👤 Account: ${accountId}`,
    ].join('\n'));
  }
  return c.reply([
    '✅ *Interactive Mode Enabled*',
    'Your bot menus will now use WhatsApp buttons and lists.',
    '',
    `👤 Account: ${accountId}`,
    `ℹ️ If a client does not render them, use ${c.prefix || '.'}text for classic menus.`,
  ].join('\n'));
});

cmd({ pattern: 'text', desc: 'Owner: enable classic text menus', category: 'owner', fromMe: true }, async (_s, _m, _msg, c) => {
  if (!ownerOnly(c)) return;
  const accountId = c.accountId || 'default';
  try {
    menuMode.set(accountId, 'text');
  } catch (err) {
    return c.reply(`❌ Could not save menu mode: ${err.message}`);
  }
  return c.reply([
    '✅ *Classic Text Mode Enabled*',
    'Your bot menus will now use the traditional text interface.',
    '',
    `👤 Account: ${accountId}`,
    'ℹ️ All normal text commands keep working. Use the menu’s numbered replies or send commands directly.',
  ].join('\n'));
});
