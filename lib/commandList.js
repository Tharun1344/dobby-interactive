'use strict';
/**
 * Classic text command list, shared by `.menu text` and the interactive
 * "Text command list" entry. Keeping one builder means both paths can never
 * drift apart or lose a command.
 */
const config = require('../config');
const { getOwnerLinks, ownerLinkLines } = require('./ownerLinks');

const CATEGORY = {
  main: '🌟 MAIN',
  download: '🎬 DOWNLOADS',
  group: '👥 GROUP TOOLS',
  media: '🖼️ MEDIA TOOLS',
  owner: '👑 OWNER CONTROLS',
  ai: '🤖 AI TOOLS',
  misc: '🧰 OTHER TOOLS',
};

function buildMenuText(prefix = '.', allCommands) {
  // Loaded lazily so tests and plugins can register commands first.
  const commands = allCommands || require('../command').commands;
  const groups = new Map();
  for (const item of commands) {
    if (item.dontAddCommandList || item.hidden) continue;
    const key = String(item.category || 'misc').toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    const aliases = item.alias?.length ? ` _(${item.alias.map(a => `${prefix}${a}`).join(', ')})_` : '';
    groups.get(key).push(`│  ▫️ *${prefix}${item.pattern}*${aliases}${item.desc ? `\n│     ↳ ${item.desc}` : ''}`);
  }
  const out = [
    '╭━━━━━━━━━━━━━━━━━━━━━━╮',
    '┃  ✨ *' + (config.BOT_NAME || "Tharun's WhatsApp Bot") + ' MENU* ✨',
    '┃  🇱🇰 Sinhala • Singlish • English',
    '╰━━━━━━━━━━━━━━━━━━━━━━╯',
    `📌 *Prefix:* ${prefix}`,
    '💬 Command එකක් තෝරලා අවශ්‍ය විදිහට භාවිත කරන්න.',
  ];
  for (const [key, items] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.push('', `╭─〔 ${CATEGORY[key] || `🧩 ${key.toUpperCase()}`} 〕`, ...items, '╰──────────────────');
  }
  const links = getOwnerLinks();
  out.push('', '🛡️ Group admin commands සඳහා bot එකටත් admin privileges අවශ්‍ය වෙන්න පුළුවන්.');
  if (links.length) out.push('', '📲 *Developer & Links*', ...ownerLinkLines(links));
  out.push('', `📌 Made by ${config.OWNER_NAME}`);
  return out.join('\n');
}

module.exports = { buildMenuText, CATEGORY };
