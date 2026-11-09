'use strict';
/**
 * Pure `.alive` card builder. No socket calls and no raw social URLs, so the
 * main card stays clean on every client. Links are sent separately.
 */
const config = require('../config');
const { runtime } = require('./functions');
const { commands } = require('../command');

function botVersion() {
  try { return require('../package.json').version || ''; } catch { return ''; }
}

function visibleCommandCount() {
  try {
    return commands.filter(item => item && item.pattern && !item.dontAddCommandList && !item.hidden).length;
  } catch {
    return 0;
  }
}

/** Mask a phone number so `.alive` never prints the full linked number. */
function maskNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 6) return '';
  return `${digits.slice(0, 3)}${'*'.repeat(Math.max(3, digits.length - 5))}${digits.slice(-2)}`;
}

function buildAliveCard({
  accountId = 'default',
  prefix = '.',
  botNumber = '',
  name = '',
  ownerName = '',
  uptime = runtime(process.uptime()),
  version = botVersion(),
  commandCount = visibleCommandCount(),
} = {}) {
  const botName = name || config.BOT_NAME || "Tharun's WhatsApp Bot";
  const owner = ownerName || config.OWNER_NAME || 'Owner';
  const safeNumber = maskNumber(botNumber);
  const lines = [
    `╭━━━〔 ✨ *${botName}* ✨ 〕━━━╮`,
    '┃',
    '┃ 🟢 *System Status:* Online',
    `┃ ⏱️ *Uptime:* ${uptime || '0 seconds'}`,
    `┃ ⚙️ *Prefix:* ${prefix || '.'}`,
    `┃ 🧩 *Commands:* ${commandCount}`,
    version ? `┃ 🏷️ *Version:* v${version}` : '',
    '┃',
    `┃ 👑 *Owner:* ${owner}`,
    `┃ 👤 *Account:* ${accountId || 'default'}`,
    safeNumber ? `┃ 📱 *Bot Number:* ${safeNumber}` : '',
    '┃',
    '╰━━━━━━━━━━━━━━━━━━━━━━╯',
    '',
    `💡 ${prefix || '.'}menu — open the menu`,
    `📘 ${prefix || '.'}help <command> — usage instructions`,
  ].filter(line => line !== '');
  return { name: botName, text: lines.join('\n') };
}

module.exports = { botVersion, visibleCommandCount, maskNumber, buildAliveCard };
