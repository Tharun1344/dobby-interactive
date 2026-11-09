'use strict';
/**
 * Central command usage metadata.
 *
 * Every registered command should have an entry here. The help command
 * (`.help <command>`) and interactive prompts read from this file, so the
 * instructions cannot drift away from the menu catalogue.
 *
 * `{p}` is replaced with the configured prefix at render time.
 */

const USAGE = {
  // ── Main / info ─────────────────────────────────────────────────────────────
  menu: {
    emoji: '📋', purpose: 'Open the bot menu or the classic command list.',
    usage: ['{p}menu', '{p}menu text', '{p}help <command>'],
    optional: 'text | classic | list = classic command list.',
    permission: 'Everyone', requires: 'Nothing.',
    example: '{p}menu', result: 'Interactive buttons/lists, or a numbered text menu.',
  },
  alive: {
    emoji: '🟢', purpose: 'Show bot status, uptime, version and owner links.',
    usage: ['{p}alive'],
    permission: 'Everyone', requires: 'Nothing.',
    example: '{p}alive', result: 'A status card and a separate social-links message.',
  },
  ping: {
    emoji: '🏓', purpose: 'Check that the bot is responding.',
    usage: ['{p}ping'],
    permission: 'Everyone', requires: 'Nothing.',
    example: '{p}ping', result: 'A short PONG reply with uptime.',
  },
  uptime: {
    emoji: '⏱️', purpose: 'Show how long the bot process has been running.',
    usage: ['{p}uptime'],
    permission: 'Everyone', requires: 'Nothing.',
    example: '{p}uptime', result: 'A human-readable uptime value.',
  },
  owner: {
    emoji: '👑', purpose: 'Send the owner contact card.',
    usage: ['{p}owner'],
    permission: 'Everyone', requires: 'Nothing.',
    example: '{p}owner', result: 'A WhatsApp contact card for the configured owner.',
  },
  github: {
    emoji: '🐙', purpose: 'Look up a GitHub user or repository.',
    usage: ['{p}github <username>', '{p}github <user>/<repo>'],
    permission: 'Everyone', requires: 'A GitHub username or user/repo.',
    example: '{p}github octocat', result: 'Profile or repository details from the GitHub API.',
  },
  accounts: {
    emoji: '🧩', purpose: 'Show the current account ID (never secrets).',
    usage: ['{p}accounts'],
    permission: 'Owner only', requires: 'Nothing.',
    example: '{p}accounts', result: 'The active account ID and multi-account hint.',
  },

  // ── Owner settings ──────────────────────────────────────────────────────────
  mode: {
    emoji: '🌐', purpose: 'Switch public/private access mode.',
    usage: ['{p}mode public', '{p}mode private'],
    permission: 'Owner only', requires: 'public or private.',
    example: '{p}mode public', result: 'Public = everyone; private = owner self-chat only.',
  },
  welcome: {
    emoji: '👋', purpose: 'Toggle the global group welcome messages.',
    usage: ['{p}welcome on', '{p}welcome off'],
    permission: 'Owner only', requires: 'on or off.',
    example: '{p}welcome on', result: 'Global welcome switch changes; per-group overrides win.',
  },
  goodbye: {
    emoji: '👋', purpose: 'Toggle the global group goodbye messages.',
    usage: ['{p}goodbye on', '{p}goodbye off'],
    permission: 'Owner only', requires: 'on or off.',
    example: '{p}goodbye on', result: 'Global goodbye switch changes; per-group overrides win.',
  },
  dmgreet: {
    emoji: '👋', purpose: 'Toggle the one-time greeting for new private chats.',
    usage: ['{p}dmgreet on', '{p}dmgreet off'],
    optional: 'Set GREETING_MSG to customise the text.',
    permission: 'Owner only', requires: 'on or off.',
    example: '{p}dmgreet on', result: 'New private chats receive one greeting on their first command.',
  },
  antidelete: {
    emoji: '🛡️', purpose: 'Toggle anti-delete / anti-edit owner notices.',
    usage: ['{p}antidelete on', '{p}antidelete off'],
    permission: 'Owner only', requires: 'on or off.',
    example: '{p}antidelete on', result: 'Deleted/edited messages observed while online are reported to self-chat.',
  },
  autoreact: {
    emoji: '💖', purpose: 'Configure automatic reactions to recognised commands.',
    usage: ['{p}autoreact on', '{p}autoreact off', '{p}autoreact set ❤️'],
    optional: 'The emoji can be any short emoji string (max 16 characters).',
    permission: 'Owner only', requires: 'on, off, or set <emoji>.',
    example: '{p}autoreact set ❤️', result: 'Auto-react is toggled or its emoji changed.',
  },
  online: {
    emoji: '🟢', purpose: 'Control whether the bot keeps the account marked online.',
    usage: ['{p}online', '{p}online on', '{p}online off'],
    optional: 'No arguments = show the current state.',
    permission: 'Owner only', requires: 'on or off.',
    example: '{p}online off', result: 'Presence is handed back to the phone (or forced back to always-online).',
  },
  autostatus: {
    emoji: '👁️', purpose: 'Automatically view (mark as read) every new WhatsApp status.',
    usage: ['{p}autostatus', '{p}autostatus on', '{p}autostatus off'],
    optional: 'No arguments = show the current state.',
    permission: 'Owner only', requires: 'on or off.',
    example: '{p}autostatus on', result: 'New status updates are marked as seen silently.',
  },
  autoreply: {
    emoji: '💬', purpose: 'Send an automatic reply to private chats when you are away.',
    usage: ['{p}autoreply', '{p}autoreply on', '{p}autoreply off', '{p}autoreply set <message>'],
    optional: 'One reply per chat per hour; groups are never answered.',
    permission: 'Owner only', requires: 'on, off, or set <message>.',
    example: '{p}autoreply set මම දැන් busy, පස්සේ කතා කරන්නම්',
    result: 'The auto-reply text is stored and enabled.',
  },
  buttons: {
    emoji: '🔘', purpose: 'Enable interactive button/list menus for this account.',
    usage: ['{p}buttons'],
    permission: 'Owner only', requires: 'Nothing.',
    example: '{p}buttons', result: 'Interactive Mode is saved and confirmed. Global safety switches still win.',
  },
  text: {
    emoji: '💬', purpose: 'Enable classic text menus for this account.',
    usage: ['{p}text'],
    permission: 'Owner only', requires: 'Nothing.',
    example: '{p}text', result: 'Classic Text Mode is saved; normal text commands keep working.',
  },

  // ── Downloads ───────────────────────────────────────────────────────────────
  ytvideo: {
    emoji: '🎬', purpose: 'Download a YouTube video by name or URL.',
    usage: ['{p}ytvideo <name or URL>', '{p}ytvideo <quality> <name or URL>'],
    optional: 'Quality: 144, 240, 360, 480 (default), 720.',
    permission: 'Everyone', requires: 'A video name or URL.',
    example: '{p}ytvideo 720 Shape of You', result: 'A playable video, or a document if it exceeds WhatsApp limits.',
  },
  song: {
    emoji: '🎵', purpose: 'Extract audio from YouTube as MP3.',
    usage: ['{p}song <name or URL>'],
    permission: 'Everyone', requires: 'A song name or YouTube URL.',
    example: '{p}song Shape of You', result: 'An audio message, or a document if very large.',
  },
  fbvideo: {
    emoji: '📘', purpose: 'Download a supported Facebook video.',
    usage: ['{p}fbvideo <URL>'],
    permission: 'Everyone', requires: 'A direct Facebook video URL.',
    example: '{p}fbvideo https://www.facebook.com/watch/?v=...', result: 'A video up to 720p where the source allows.',
  },
  ttvideo: {
    emoji: '🎵', purpose: 'Download a supported TikTok video.',
    usage: ['{p}ttvideo <URL>'],
    permission: 'Everyone', requires: 'A direct TikTok video URL.',
    example: '{p}ttvideo https://www.tiktok.com/@user/video/...', result: 'A video up to 720p where the source allows.',
  },
  download: {
    emoji: '📥', purpose: 'Download any supported public video by name or URL.',
    usage: ['{p}download <name or URL>'],
    optional: 'Quality hint such as 720.',
    permission: 'Everyone', requires: 'A name or supported URL.',
    example: '{p}download Sintel', result: 'A playable video or a document if it is too large.',
  },
  ytsearch: {
    emoji: '🔎', purpose: 'Search YouTube and return metadata only.',
    usage: ['{p}ytsearch <query>'],
    permission: 'Everyone', requires: 'A search query.',
    example: '{p}ytsearch Shape of You', result: 'The top 5 titles and links; nothing is downloaded.',
  },

  // ── Movies / Playwright ─────────────────────────────────────────────────────
  movie: {
    emoji: '🎬', purpose: 'Search CineSubz, choose a quality, and send the film as a WhatsApp document.',
    usage: [
      '{p}movie <film name>',
      '{p}film <film name>',
      '{p}movie <quality> <film name>',
      '{p}movie status | cancel | send',
    ],
    optional: 'A leading quality (480p/720p/1080p) skips the quality question.',
    permission: 'Everyone (bot private mode still limits who may use the bot)', requires: 'A film name.',
    example: '{p}movie Iru Mugan', result: 'Quality buttons, a download on the bot host, and the film as a document.',
  },
  pdl: {
    emoji: '🌐', purpose: 'Download from an allowlisted Playwright source.',
    usage: ['{p}pdl <file or movie name>', '{p}pdl --source=<name> <file or movie name>'],
    permission: 'Owner only', requires: 'A file/movie name.',
    example: '{p}pdl --source=my-catalogue Sintel', result: 'A file from a configured, allowlisted source.',
  },
  moviestatus: {
    emoji: '📊', purpose: 'Show film downloader settings, disk space and active jobs.',
    usage: ['{p}moviestatus'],
    permission: 'Owner only', requires: 'Nothing.',
    example: '{p}moviestatus', result: 'Diagnostic information without secrets.',
  },
  pdlsources: {
    emoji: '📚', purpose: 'List configured Playwright sources and stats.',
    usage: ['{p}pdlsources'],
    permission: 'Owner only', requires: 'Nothing.',
    example: '{p}pdlsources', result: 'Configured source names and concurrency information.',
  },

  // ── Media ───────────────────────────────────────────────────────────────────
  sticker: {
    emoji: '🖼️', purpose: 'Convert an image or short video into a WhatsApp sticker.',
    usage: ['Reply to an image/video with {p}sticker', 'Send media with the caption {p}sticker'],
    permission: 'Everyone', requires: 'An image or a video under 6 seconds.',
    example: 'Reply to a photo with {p}sticker', result: 'A WebP sticker.',
  },
  toimage: {
    emoji: '🧩', purpose: 'Convert a WhatsApp sticker to a PNG image.',
    usage: ['Reply to a sticker with {p}toimage'],
    permission: 'Everyone', requires: 'A reply to a sticker (direct send is not supported).',
    example: 'Reply to a sticker with {p}toimage', result: 'A PNG image.',
  },
  take: {
    emoji: '🎭', purpose: 'Re-pack a sticker with a different pack name.',
    usage: ['Reply to a sticker with {p}take', 'Reply to a sticker with {p}take <pack name>'],
    optional: 'Without a pack name the sender push name is used.',
    permission: 'Everyone', requires: 'A reply to a sticker.',
    example: 'Reply to a sticker with {p}take My Pack', result: 'The same sticker with a new pack name.',
  },
  qr: {
    emoji: '📷', purpose: 'Turn text or a link into a QR image.',
    usage: ['{p}qr <text or URL>'],
    permission: 'Everyone', requires: 'Text or a URL (max 1000 characters).',
    example: '{p}qr https://github.com', result: 'A PNG QR code image.',
  },
  getpp: {
    emoji: '👤', purpose: 'Download a WhatsApp profile picture.',
    usage: ['{p}getpp @user', 'Reply to a user with {p}getpp', '{p}getpp <number>', '{p}getpp me'],
    optional: 'In groups, mention or reply to the member. "me" targets yourself.',
    permission: 'Everyone', requires: 'A mention, reply, number, or "me".',
    example: '{p}getpp @user', result: 'The profile photo, or a privacy/unavailable explanation.',
  },
  ssweb: {
    emoji: '🖥️', purpose: 'Take a screenshot of a website.',
    usage: ['{p}ssweb <URL>'],
    permission: 'Everyone', requires: 'A full http(s) URL.',
    example: '{p}ssweb https://github.com', result: 'A website screenshot image.',
  },
  tts: {
    emoji: '🎙️', purpose: 'Convert text into a voice note.',
    usage: ['{p}tts <text>', '{p}tts <language> <text>'],
    optional: 'Languages: si, en, ta, hi, id, es, fr, de, pt, ar, ja, ko.',
    permission: 'Everyone', requires: 'Text (max 200 characters).',
    example: '{p}tts si ආයුබෝවන්', result: 'A WhatsApp voice note (fallback: MP3 audio).',
  },
  viewonce: {
    emoji: '👁️', purpose: 'Recover a view-once item received while the bot was online.',
    usage: ['Reply to a view-once photo/video/voice note with {p}viewonce'],
    optional: 'Alias: {p}vv.',
    permission: 'Owner only', requires: 'A reply to a view-once message in the short-lived memory cache.',
    example: 'Reply to a view-once photo with {p}viewonce', result: 'The media is sent only to the owner self-chat; privacy is not bypassed.',
  },

  // ── AI ──────────────────────────────────────────────────────────────────────
  ai: {
    emoji: '🤖', purpose: 'Ask Gemini a question with short per-chat memory.',
    usage: ['{p}ai <question>', 'Reply to a message with {p}ai', '{p}ai reset'],
    optional: 'Reply adds the quoted text to the question. "reset" clears chat history.',
    permission: 'Everyone', requires: 'A question or a replied message.',
    example: '{p}ai How does WhatsApp multi-device work?', result: 'A concise answer in the user\'s language.',
  },
  vision: {
    emoji: '👁️‍🗨️', purpose: 'Analyse a normal image with Gemini vision.',
    usage: ['Reply to an image with {p}vision [question]', 'Send an image with the caption {p}vision [question]'],
    optional: 'Default prompt asks for a Sinhala description.',
    permission: 'Everyone', requires: 'A normal image (max 15 MB). View-once is not processed.',
    example: 'Reply to an image with {p}vision What is this?', result: 'A description or answer about the image.',
  },
  translate: {
    emoji: '🌐', purpose: 'Translate text into a target language.',
    usage: ['{p}translate <language> <text>', 'Reply to a message with {p}translate <language>'],
    permission: 'Everyone', requires: 'A language code and text (or a replied message).',
    example: '{p}translate si Hello world', result: 'Only the translated text.',
  },

  // ── Group tools ─────────────────────────────────────────────────────────────
  groupinfo: {
    emoji: 'ℹ️', purpose: 'Show group name, JID, member and admin counts.',
    usage: ['{p}groupinfo'],
    permission: 'Group members', requires: 'Must be used inside a group.',
    example: '{p}groupinfo', result: 'Group metadata and an admin mention list.',
  },
  tagall: {
    emoji: '📢', purpose: 'Mention every group member.',
    usage: ['{p}tagall [message]'],
    optional: 'The message is optional.',
    permission: 'Group admin + bot admin', requires: 'Must be used inside a group.',
    example: '{p}tagall Meeting at 8 PM', result: 'One message mentioning all participants.',
  },
  kick: {
    emoji: '🚪', purpose: 'Remove a member from the group.',
    usage: ['Reply to the member with {p}kick', '{p}kick @member', '{p}kick <number>'],
    permission: 'Group admin + bot admin', requires: 'A target member.',
    example: 'Reply to a member with {p}kick', result: 'A remove request; the bot/owner cannot be removed.',
  },
  promote: {
    emoji: '⬆️', purpose: 'Promote a member to group admin.',
    usage: ['Reply to the member with {p}promote', '{p}promote @member', '{p}promote <number>'],
    permission: 'Group admin + bot admin', requires: 'A target member.',
    example: '{p}promote @member', result: 'A promote request.',
  },
  demote: {
    emoji: '⬇️', purpose: 'Remove admin rights from a group admin.',
    usage: ['Reply to the admin with {p}demote', '{p}demote @admin', '{p}demote <number>'],
    permission: 'Group admin + bot admin', requires: 'A target admin.',
    example: '{p}demote @admin', result: 'A demote request.',
  },
  grouplink: {
    emoji: '🔗', purpose: 'Get the current group invite link.',
    usage: ['{p}grouplink'],
    permission: 'Bot admin or owner', requires: 'Must be used inside a group.',
    example: '{p}grouplink', result: 'A chat.whatsapp.com invite link.',
  },
  revoke: {
    emoji: '♻️', purpose: 'Reset the group invite link.',
    usage: ['{p}revoke'],
    permission: 'Group admin + bot admin', requires: 'Must be used inside a group.',
    example: '{p}revoke', result: 'The old link stops working and a new one is generated.',
  },
  mute: {
    emoji: '🔇', purpose: 'Mute or unmute bot replies in this group.',
    usage: ['{p}mute on', '{p}mute off'],
    permission: 'Group admin or owner', requires: 'Must be used inside a group.',
    example: '{p}mute on', result: 'Muted groups skip normal commands except .mute.',
  },

  // ── Scheduler ───────────────────────────────────────────────────────────────
  schedule: {
    emoji: '⏰', purpose: 'Schedule a message for later.',
    usage: ['{p}schedule <time> | <message>', '{p}schedule <time> | <number> | <message>'],
    optional: 'Time: 10m, 2h, 1h30m, 1d, 18:30, 6:30pm, tomorrow 07:00, 2026-10-25 18:30.',
    permission: 'Owner only', requires: 'A time and a message. Target is optional.',
    example: '{p}schedule 18:30 | Hello', result: 'A saved schedule with an ID; Sri Lanka time by default.',
  },
  schedules: {
    emoji: '📋', purpose: 'List pending scheduled messages.',
    usage: ['{p}schedules'],
    permission: 'Owner only', requires: 'Nothing.',
    example: '{p}schedules', result: 'Pending IDs, times, targets and message previews.',
  },
  unschedule: {
    emoji: '🗑️', purpose: 'Cancel a scheduled message by ID.',
    usage: ['{p}unschedule <id>'],
    permission: 'Owner only', requires: 'A schedule ID from .schedules.',
    example: '{p}unschedule ab12', result: 'The schedule is removed, or a not-found message is returned.',
  },
};

function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/^[./]/, '').trim();
}

/** Resolve a canonical pattern or alias, using the live command registry. */
function getUsage(name) {
  const key = normalizeName(name);
  if (!key) return null;
  if (USAGE[key]) return { ...USAGE[key], command: key };
  try {
    const { commands } = require('../command');
    const found = commands.find(item => {
      if (String(item.pattern || '').toLowerCase() === key) return true;
      return (item.alias || []).some(alias => String(alias).toLowerCase() === key);
    });
    if (found && USAGE[found.pattern]) {
      return { ...USAGE[found.pattern], command: found.pattern, aliases: found.alias || [] };
    }
  } catch { /* registry not loaded yet */ }
  return null;
}

function replacePrefix(text, prefix) {
  return String(text || '').replace(/\{p\}/g, prefix || '.');
}

function formatUsage(entry, prefix = '.') {
  if (!entry) return '';
  const lines = [
    `╭─〔 ${entry.emoji || '📘'} *${prefix}${entry.command}* 〕`,
    `│ 🎯 *Purpose:* ${entry.purpose}`,
    '│ 📌 *Usage:*',
    ...(entry.usage || []).map(line => `│   • ${replacePrefix(line, prefix)}`),
    entry.requires ? `│ 📎 *Needs:* ${entry.requires}` : '',
    entry.optional ? `│ ➕ *Optional:* ${entry.optional}` : '',
    `│ ✅ *Example:* ${replacePrefix(entry.example, prefix)}`,
    `│ 📤 *Result:* ${entry.result}`,
    `│ 🔐 *Permission:* ${entry.permission}`,
    '╰──────────────────',
  ].filter(Boolean);
  if (entry.aliases?.length) lines.push(`🔁 Aliases: ${entry.aliases.map(a => `${prefix}${a}`).join(', ')}`);
  return lines.join('\n');
}

/** Commands that are registered but still lack detailed instructions. */
function missing(commands) {
  const list = commands || require('../command').commands;
  return list
    .filter(item => item.pattern && !USAGE[item.pattern])
    .map(item => item.pattern);
}

module.exports = {
  USAGE,
  normalizeName,
  getUsage,
  formatUsage,
  replacePrefix,
  missing,
};
