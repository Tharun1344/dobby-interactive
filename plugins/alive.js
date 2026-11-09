'use strict';
const { cmd } = require('../command');
const config = require('../config');
const { buildAliveCard } = require('../lib/aliveCard');
const { getOwnerLinks, ownerLinkLines, linkSummary, linkButtons } = require('../lib/ownerLinks');
const messages = require('../lib/interactive/messages');

// Native URL buttons are attempted only when explicitly enabled. The installed
// Baileys 6.7.x line does not officially support cta_url native-flow buttons on
// every client, so the default is the compatible text alternative. The main
// status card never contains raw URLs either way.
function nativeUrlButtonsEnabled() {
  return String(process.env.ALIVE_URL_BUTTONS || 'false').toLowerCase() === 'true';
}

async function sendSocialLinks(sock, c, mek, links) {
  if (!links.length) return;
  const useNative = nativeUrlButtonsEnabled() && links.length <= 3;
  if (useNative) {
    try {
      await messages.sendUrlButtons(sock, c.from, {
        title: '🔗 Connect with us',
        text: linkSummary(links),
        footer: 'Tap a button to open the official link.',
        links: linkButtons(links),
        quoted: mek,
      });
      return;
    } catch (err) {
      console.warn('[alive] native URL buttons failed, using text links:', err?.message || err);
    }
  }
  const intro = nativeUrlButtonsEnabled()
    ? '🔗 *Connect with us*\n\nThis connection does not support native URL buttons, so here are the links:'
    : '🔗 *Connect with us*';
  await sock.sendMessage(c.from, {
    text: `${intro}\n\n${ownerLinkLines(links).join('\n')}`,
  }, { quoted: mek });
}

cmd({ pattern: 'alive', desc: 'Show bot status, uptime, version and owner links', category: 'main' }, async (sock, mek, _m, c) => {
  const card = buildAliveCard({
    accountId: c.accountId,
    prefix: c.prefix,
    botNumber: c.botNumber,
    name: config.BOT_NAME,
    ownerName: config.OWNER_NAME,
  });

  if (config.ALIVE_IMG) {
    try {
      await sock.sendMessage(c.from, { image: { url: config.ALIVE_IMG }, caption: card.text }, { quoted: mek });
    } catch (err) {
      console.warn('[alive image]', err.message);
      await c.reply(card.text);
    }
  } else {
    await c.reply(card.text);
  }

  await sendSocialLinks(sock, c, mek, getOwnerLinks()).catch(err => {
    console.warn('[alive links]', err?.message || err);
  });
});

cmd({ pattern: 'ping', desc: 'Check response speed', category: 'main' }, async (_sock, _mek, _m, { reply }) => reply(`🏓 *PONG!*
⚡ Bot is responding
⏱️ Uptime: ${require('../lib/functions').runtime(process.uptime()) || '0 seconds'}`));
