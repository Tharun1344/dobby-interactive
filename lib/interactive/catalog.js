'use strict';
/**
 * The feature registry behind every interactive menu.
 *
 * Each entry maps a menu action to an EXISTING command in command.js. The
 * interactive UI never reimplements download, group, AI, scheduler or movie
 * logic; it collects input and calls the original plugin handler.
 */

const ACTION_PREFIX = 'ocm:';

const SCOPE_LABELS = {
  everyone: 'Everyone',
  owner: 'Owner only',
  group: 'Group only',
  groupAdmin: 'Group admin',
  groupAdminBot: 'Group admin + bot admin',
  groupBotAdmin: 'Bot admin',
  welcomeAdmin: 'Group admin or owner',
};

const FEATURES = {
  // ── Downloads ─────────────────────────────────────────────────────────────
  ytvideo: {
    id: 'ytvideo', label: 'YouTube Video', emoji: '🎬', command: 'ytvideo', category: 'downloads',
    desc: 'YouTube video · 480p default · MP3 use Audio',
    use: 'YouTube video name or URL. Optional quality: 360 / 480 / 720.',
    prompt: {
      text: '🎬 *YouTube Video*\n\nVideo එකේ නම හෝ URL එක යවන්න.\n\n💡 Quality එක ඉදිරියෙන් ලියන්න: 360, 480, 720\nඋදා: *720 Shape of You*',
      example: 'Shape of You',
      required: true,
    },
  },
  song: {
    id: 'song', label: 'YouTube Audio', emoji: '🎵', command: 'song', category: 'downloads',
    desc: 'Extract MP3 audio from YouTube',
    use: 'Song name or YouTube URL.',
    prompt: {
      text: '🎵 *YouTube Audio (MP3)*\n\nSong එකේ නම හෝ URL එක යවන්න.\nඋදා: *Shape of You*',
      example: 'Shape of You',
      required: true,
    },
  },
  fbvideo: {
    id: 'fbvideo', label: 'Facebook Video', emoji: '📘', command: 'fbvideo', category: 'downloads',
    desc: 'Facebook video · URL required · up to 720p',
    use: 'A direct Facebook video URL.',
    prompt: {
      text: '📘 *Facebook Video*\n\nFacebook video URL එක යවන්න (http/https).',
      example: 'https://www.facebook.com/watch/?v=...',
      required: true,
    },
  },
  ttvideo: {
    id: 'ttvideo', label: 'TikTok Video', emoji: '🎵', command: 'ttvideo', category: 'downloads',
    desc: 'TikTok video · URL required · up to 720p',
    use: 'A direct TikTok video URL.',
    prompt: {
      text: '🎵 *TikTok Video*\n\nTikTok video URL එක යවන්න (http/https).',
      example: 'https://www.tiktok.com/@user/video/...',
      required: true,
    },
  },
  download: {
    id: 'download', label: 'Generic Video', emoji: '📥', command: 'download', category: 'downloads',
    desc: 'Any yt-dlp-supported public source',
    use: 'A video name or supported URL.',
    prompt: {
      text: '📥 *Generic Download*\n\nVideo එකේ නම හෝ supported URL එක යවන්න.',
      example: 'https://...',
      required: true,
    },
  },
  ytsearch: {
    id: 'ytsearch', label: 'YouTube Search', emoji: '🔎', command: 'ytsearch', category: 'downloads',
    desc: 'Top 5 results · metadata only',
    use: 'A search query.',
    prompt: {
      text: '🔎 *YouTube Search*\n\nSearch කරන්න අවශ්‍ය නම යවන්න. Results 5ක් ලැබේ (download නොකරයි).',
      example: 'Shape of You',
      required: true,
    },
  },

  // ── Movies ────────────────────────────────────────────────────────────────
  movie: {
    id: 'movie', label: 'Download Film', emoji: '🎬', command: 'movie', category: 'movies',
    desc: 'CineSubz search · quality buttons · WhatsApp document',
    use: 'Film name; optional quality prefix.',
    prompt: {
      text: '🎬 *Film Download (CineSubz)*\n\nFilm එකේ නම යවන්න. තියෙන quality එකක් තෝරන්න පුළුවන්.\nඋදා: *Iru Mugan*\nඋදා: *720p Sachein*',
      example: 'Iru Mugan',
      required: true,
    },
  },
  pdl: {
    id: 'pdl', label: 'Source Download', emoji: '🌐', command: 'pdl', category: 'movies', scope: 'owner',
    desc: 'Owner-only allowlisted Playwright source',
    use: 'File name, optionally --source=<name>.',
    prompt: {
      text: '🌐 *Playwright Source Download*\n\nFile/movie name එක යවන්න.\nSource එකක් තෝරන්න: *--source=name file name*\n\n⚠️ Allowlisted sources only.',
      example: '--source=my-catalogue Sintel',
      required: true,
    },
  },
  moviestatus: {
    id: 'moviestatus', label: 'Movie Status', emoji: '📊', command: 'moviestatus', category: 'movies', scope: 'owner',
    desc: 'Providers, TMDB key presence, browser/ffmpeg',
  },
  pdlsources: {
    id: 'pdlsources', label: 'Playwright Sources', emoji: '📚', command: 'pdlsources', category: 'movies', scope: 'owner',
    desc: 'Configured sources and concurrency stats',
  },

  // ── Media ─────────────────────────────────────────────────────────────────
  sticker: {
    id: 'sticker', label: 'Image → Sticker', emoji: '🖼️', command: 'sticker', category: 'media',
    desc: 'Convert an image or short video to a sticker',
    use: 'Send an image/short video, or reply to one with .sticker.',
    prompt: {
      text: '🖼️ *Image → Sticker*\n\nImage එකක් හෝ කෙටි video එකක් දැන් යවන්න.\n(හෝ sticker command එකට reply කරන්න.)',
      acceptMedia: true,
      mediaKinds: ['imageMessage', 'videoMessage'],
      required: true,
    },
  },
  toimage: {
    id: 'toimage', label: 'Sticker → Image', emoji: '🧩', command: 'toimage', category: 'media',
    desc: 'Convert a sticker to PNG',
    use: 'Send a sticker now, or reply to one with .toimage.',
    prompt: {
      text: '🧩 *Sticker → Image*\n\nSticker එකක් දැන් යවන්න.\n(හෝ sticker එකකට reply කර .toimage යවන්න.)',
      acceptMedia: true,
      mediaKinds: ['stickerMessage'],
      required: true,
    },
  },
  take: {
    id: 'take', label: 'Re-pack Sticker', emoji: '🎭', command: 'take', category: 'media',
    desc: 'Replace sticker pack name',
    use: 'Send a sticker now, or reply to a sticker with .take pack name.',
    prompt: {
      text: '🎭 *Re-pack Sticker*\n\nSticker එකක් දැන් යවන්න. Pack name එක වෙනස් කරයි.\n(නැත්නම් sticker එකකට reply කර .take pack name යවන්න.)',
      acceptMedia: true,
      mediaKinds: ['stickerMessage'],
      required: true,
    },
  },
  qr: {
    id: 'qr', label: 'QR Code', emoji: '📷', command: 'qr', category: 'media',
    desc: 'Turn text or a link into a QR image',
    use: 'Text or URL.',
    prompt: {
      text: '📷 *QR Code*\n\nQR code එකක් කරන්න ඕන text/URL එක යවන්න.',
      example: 'https://github.com',
      required: true,
    },
  },
  getpp: {
    id: 'getpp', label: 'Profile Picture', emoji: '👤', command: 'getpp', category: 'media',
    desc: 'Get a WhatsApp profile photo (mention, reply, number or me)',
    use: 'Reply/mention a member, type a number, or type "me".',
    prompt: {
      text: '👤 *Profile Picture*\n\n• Group member එකකට reply/mention කරන්න\n• හෝ number එකක් යවන්න (උදා: 94771234567)\n• හෝ *me* යවන්න\n\n⚠️ Private/restricted profile pictures download කළ නොහැක.',
      example: 'me',
      required: true,
      buildArgs: input => (/^(me|self|myself)$/i.test(String(input || '').trim()) ? '' : input),
    },
  },
  ssweb: {
    id: 'ssweb', label: 'Website Screenshot', emoji: '🖥️', command: 'ssweb', category: 'media',
    desc: 'Screenshot a website via thum.io',
    use: 'A full http(s) URL.',
    prompt: {
      text: '🖥️ *Website Screenshot*\n\nWebsite URL එක යවන්න.',
      example: 'https://github.com',
      required: true,
    },
  },
  tts: {
    id: 'tts', label: 'Text to Speech', emoji: '🎙️', command: 'tts', category: 'media',
    desc: 'Voice note in Sinhala, English, Tamil and more',
    use: 'Optional language code then text.',
    prompt: {
      text: '🎙️ *Text to Speech*\n\nText එක යවන්න. Language code එකක් ඉදිරියෙන් දිය හැක.\nඋදා: *si ආයුබෝවන්*\nඋදා: *en hello how are you*',
      example: 'si ආයුබෝවන්',
      required: true,
    },
  },
  viewonce: {
    id: 'viewonce', label: 'View-once (Owner)', emoji: '👁️', command: 'viewonce', category: 'media', scope: 'owner',
    desc: 'Owner-only · reply to view-once · result only to self-chat',
    manual: [
      '👁️ *View-once (owner only)*',
      '',
      'Reply to a view-once photo, video or voice note with *.viewonce* (or *.vv*).',
      'The saved media is sent only to your own self-chat — nothing is posted in the chat where it arrived.',
      '',
      'ℹ️ Only media received while the bot was online and still in its short memory cache can be recovered.',
    ].join('\n'),
  },

  // ── AI ────────────────────────────────────────────────────────────────────
  ai: {
    id: 'ai', label: 'Ask AI', emoji: '🤖', command: 'ai', category: 'ai',
    desc: 'Gemini chat with short per-chat memory',
    use: 'A question; reply to a message to include it.',
    prompt: {
      text: '🤖 *Ask AI*\n\nඔබේ ප්‍රශ්නය යවන්න. Message එකකට reply කර .ai යැවීමෙන් එයද ඇතුළත් වේ.\nHistory clear කරන්න: *reset* යවන්න.',
      example: 'How does WhatsApp multi-device work?',
      required: true,
    },
  },
  vision: {
    id: 'vision', label: 'Image Analysis', emoji: '👁️‍🗨️', command: 'vision', category: 'ai',
    desc: 'Gemini vision on a normal image',
    use: 'Send an image now (or reply with .vision question).',
    prompt: {
      text: '👁️‍🗨️ *Image Analysis*\n\nImage එකක් දැන් යවන්න. Caption එකේ ප්‍රශ්නය ලියන්න.\n(හෝ image එකකට reply කර .vision [ප්‍රශ්නය] යවන්න.)',
      acceptMedia: true,
      mediaKinds: ['imageMessage'],
      required: true,
    },
  },
  translate: {
    id: 'translate', label: 'Translate', emoji: '🌐', command: 'translate', category: 'ai',
    desc: 'Translate text via Gemini',
    use: 'Language code then text.',
    prompt: {
      text: '🌐 *Translate*\n\nLanguage code එක සහ text එක යවන්න.\nඋදා: *si Hello world*\nඋදා: *en ආයුබෝවන්*',
      example: 'si Hello world',
      required: true,
    },
  },

  // ── Group ─────────────────────────────────────────────────────────────────
  groupinfo: {
    id: 'groupinfo', label: 'Group Info', emoji: 'ℹ️', command: 'groupinfo', category: 'groups', scope: 'group',
    desc: 'Group name, JID, member/admin counts',
  },
  tagall: {
    id: 'tagall', label: 'Tag Everyone', emoji: '📢', command: 'tagall', category: 'groups', scope: 'groupAdminBot',
    desc: 'Mention every member',
    use: 'Optional message; type - for none.',
    prompt: {
      text: '📢 *Tag Everyone*\n\nMessage එක යවන්න. Message එකක් අවශ්‍ය නැත්නම් *-* යවන්න.',
      example: 'Meeting at 8 PM',
      required: true,
      buildArgs: input => (String(input || '').trim() === '-' ? '' : input),
    },
  },
  kick: {
    id: 'kick', label: 'Kick Member', emoji: '🚪', command: 'kick', category: 'groups', scope: 'groupAdminBot',
    desc: 'Remove a member',
    use: 'Reply/mention the member or type their number.',
    prompt: {
      text: '🚪 *Kick Member*\n\nRemove කරන්න ඕන member ට reply/mention කරන්න, නැත්නම් number එක යවන්න.',
      required: true,
      target: true,
    },
    confirm: 'මේ member ව group එකෙන් remove කරන්නද?',
  },
  promote: {
    id: 'promote', label: 'Promote Member', emoji: '⬆️', command: 'promote', category: 'groups', scope: 'groupAdminBot',
    desc: 'Make a member an admin',
    use: 'Reply/mention the member or type their number.',
    prompt: {
      text: '⬆️ *Promote Member*\n\nAdmin කරන්න ඕන member ට reply/mention කරන්න, නැත්නම් number එක යවන්න.',
      required: true,
      target: true,
    },
  },
  demote: {
    id: 'demote', label: 'Demote Admin', emoji: '⬇️', command: 'demote', category: 'groups', scope: 'groupAdminBot',
    desc: 'Remove admin rights',
    use: 'Reply/mention the admin or type their number.',
    prompt: {
      text: '⬇️ *Demote Admin*\n\nDemote කරන්න ඕන admin ට reply/mention කරන්න, නැත්නම් number එක යවන්න.',
      required: true,
      target: true,
    },
    confirm: 'මේ admin ගේ admin rights remove කරන්නද?',
  },
  grouplink: {
    id: 'grouplink', label: 'Group Invite Link', emoji: '🔗', command: 'grouplink', category: 'groups', scope: 'groupBotAdmin',
    desc: 'Get the current invite link',
  },
  revoke: {
    id: 'revoke', label: 'Reset Invite Link', emoji: '♻️', command: 'revoke', category: 'groups', scope: 'groupAdminBot',
    desc: 'Revoke the old link and create a new one',
    confirm: 'Group invite link එක reset කරන්නද? පරණ link එක වැඩ නොකරනු ඇත.',
  },
  mute: {
    id: 'mute', label: 'Bot Mute', emoji: '🔇', command: 'mute', category: 'groups', scope: 'groupAdmin',
    desc: 'Mute or unmute bot replies in this group',
    choice: {
      current: ctx => (ctx.settings?.mutedGroups || []).includes(ctx.from) ? 'on' : 'off',
      options: [
        { id: 'on', label: '🔇 Mute ON', args: 'on' },
        { id: 'off', label: '🔊 Mute OFF', args: 'off' },
      ],
      text: 'මේ group එකේ bot replies mute/unmute කරන්න.',
    },
  },

  // ── Info ──────────────────────────────────────────────────────────────────
  alive: { id: 'alive', label: 'Bot Status', emoji: '🟢', command: 'alive', category: 'info', desc: 'Status, uptime and owner links' },
  ping: { id: 'ping', label: 'Ping', emoji: '🏓', command: 'ping', category: 'info', desc: 'Response and uptime check' },
  uptime: { id: 'uptime', label: 'Uptime', emoji: '⏱️', command: 'uptime', category: 'info', desc: 'How long the bot has been running' },
  owner: { id: 'owner', label: 'Owner Contact', emoji: '👑', command: 'owner', category: 'info', desc: 'Send the owner contact card' },
  github: {
    id: 'github', label: 'GitHub Info', emoji: '🐙', command: 'github', category: 'info',
    desc: 'Profile or repository information',
    use: 'Username or user/repo.',
    prompt: {
      text: '🐙 *GitHub Info*\n\nUsername එකක් හෝ user/repo යවන්න.\nඋදා: *octocat*  •  *octocat/Hello-World*',
      example: 'octocat',
      required: true,
    },
  },
  accounts: { id: 'accounts', label: 'Accounts', emoji: '🧩', command: 'accounts', category: 'settings', scope: 'owner', desc: 'Current account ID (no secrets)' },
  menu_buttons: {
    id: 'menu_buttons', label: 'Interactive Menus', emoji: '🔘', command: 'buttons', category: 'settings', scope: 'owner',
    desc: 'Enable WhatsApp buttons/lists for this account',
  },
  menu_text: {
    id: 'menu_text', label: 'Classic Text Menus', emoji: '💬', command: 'text', category: 'settings', scope: 'owner',
    desc: 'Use the traditional text interface for this account',
  },

  // ── Owner settings ────────────────────────────────────────────────────────
  mode: {
    id: 'mode', label: 'Bot Mode', emoji: '🌐', command: 'mode', category: 'settings', scope: 'owner',
    desc: 'Public or private (owner self-chat only)',
    choice: {
      current: ctx => ctx.settings?.mode || 'public',
      options: [
        { id: 'public', label: '🌍 Public', args: 'public' },
        { id: 'private', label: '🔒 Private', args: 'private' },
      ],
      text: 'Public = හැමෝටම. Private = owner self-chat only.',
    },
  },
  antidelete: {
    id: 'antidelete', label: 'Anti-delete', emoji: '🛡️', command: 'antidelete', category: 'settings', scope: 'owner',
    desc: 'Owner notices for deleted/edited messages',
    choice: {
      current: ctx => (ctx.settings?.antiDelete ? 'on' : 'off'),
      options: [
        { id: 'on', label: '🛡️ ON', args: 'on' },
        { id: 'off', label: '🛑 OFF', args: 'off' },
      ],
    },
  },
  autoreact: {
    id: 'autoreact', label: 'Auto-react', emoji: '💖', command: 'autoreact', category: 'settings', scope: 'owner',
    desc: 'React to recognized commands',
    choice: {
      current: ctx => (ctx.settings?.autoReact ? 'on' : 'off'),
      options: [
        { id: 'on', label: '💖 ON', args: 'on' },
        { id: 'off', label: '🛑 OFF', args: 'off' },
      ],
    },
  },
  autoreact_emoji: {
    id: 'autoreact_emoji', label: 'Auto-react Emoji', emoji: '🎭', command: 'autoreact', category: 'settings', scope: 'owner',
    desc: 'Set the reaction emoji',
    use: 'One emoji (max 16 characters).',
    prompt: {
      text: '🎭 *Auto-react Emoji*\n\nඔබට අවශ්‍ය emoji එක යවන්න (උදා: ❤️).',
      example: '❤️',
      required: true,
      buildArgs: input => `set ${String(input || '').trim()}`,
    },
  },
  dmgreet: {
    id: 'dmgreet', label: 'DM Greeting', emoji: '👋', command: 'dmgreet', category: 'settings', scope: 'owner',
    desc: 'One-time greeting for new private chats',
    choice: {
      current: ctx => (ctx.settings?.dmGreeting ? 'on' : 'off'),
      options: [
        { id: 'on', label: '👋 ON', args: 'on' },
        { id: 'off', label: '🛑 OFF', args: 'off' },
      ],
    },
  },
  welcome_global: {
    id: 'welcome_global', label: 'Global Welcome', emoji: '👋', command: 'welcome', category: 'welcome', scope: 'owner',
    desc: 'Default welcome for every group',
    choice: {
      current: ctx => (ctx.settings?.welcome ? 'on' : 'off'),
      options: [
        { id: 'on', label: '👋 ON', args: 'on' },
        { id: 'off', label: '🛑 OFF', args: 'off' },
      ],
    },
  },
  goodbye_global: {
    id: 'goodbye_global', label: 'Global Goodbye', emoji: '👋', command: 'goodbye', category: 'welcome', scope: 'owner',
    desc: 'Default goodbye for every group',
    choice: {
      current: ctx => (ctx.settings?.goodbye ? 'on' : 'off'),
      options: [
        { id: 'on', label: '👋 ON', args: 'on' },
        { id: 'off', label: '🛑 OFF', args: 'off' },
      ],
    },
  },
};

const CATEGORIES = [
  { id: 'downloads', label: 'Downloads', emoji: '📥', desc: 'YouTube, Facebook, TikTok, audio and search', features: ['ytvideo', 'song', 'fbvideo', 'ttvideo', 'download', 'ytsearch'] },
  { id: 'movies', label: 'Movies', emoji: '🎬', desc: 'CineSubz film download, Playwright sources', features: ['movie', 'pdl', 'moviestatus', 'pdlsources'] },
  { id: 'media', label: 'Media Tools', emoji: '🖼️', desc: 'Stickers, QR, profile pictures, TTS, screenshots', features: ['sticker', 'toimage', 'take', 'qr', 'getpp', 'ssweb', 'tts', 'viewonce'] },
  { id: 'ai', label: 'AI Tools', emoji: '🤖', desc: 'Gemini chat, image analysis, translation', features: ['ai', 'vision', 'translate'] },
  { id: 'groups', label: 'Group Tools', emoji: '👥', desc: 'Info, members, invite links, moderation', features: ['groupinfo', 'tagall', 'kick', 'promote', 'demote', 'grouplink', 'revoke', 'mute'] },
  { id: 'welcome', label: 'Welcome & Goodbye', emoji: '👋', desc: 'Global and per-group welcome/goodbye settings', custom: 'welcome' },
  { id: 'schedule', label: 'Scheduled Messages', emoji: '⏰', desc: 'Create, view, edit and cancel scheduled sends', custom: 'schedule', scope: 'owner' },
  { id: 'settings', label: 'Bot Settings', emoji: '⚙️', desc: 'Mode, anti-delete, auto-react, DM greeting', features: ['mode', 'antidelete', 'autoreact', 'autoreact_emoji', 'dmgreet', 'accounts', 'menu_buttons', 'menu_text'], scope: 'owner' },
  { id: 'info', label: 'Help & Info', emoji: 'ℹ️', desc: 'Status, uptime, owner, links and command list', features: ['alive', 'ping', 'uptime', 'owner', 'github'], extras: ['links', 'menutext'] },
];

const CATEGORY_MAP = new Map(CATEGORIES.map(c => [c.id, c]));

function scopeAllowed(scope, ctx) {
  switch (scope || 'everyone') {
    case 'everyone': return true;
    case 'owner': return !!ctx.isOwner;
    case 'group': return !!ctx.isGroup;
    case 'groupAdmin': return !!ctx.isGroup && (!!ctx.isAdmins || !!ctx.isOwner);
    case 'groupAdminBot': return !!ctx.isGroup && (!!ctx.isAdmins || !!ctx.isOwner) && !!ctx.isBotAdmins;
    case 'groupBotAdmin': return !!ctx.isGroup && (!!ctx.isBotAdmins || !!ctx.isOwner);
    case 'welcomeAdmin': return !!ctx.isOwner || (!!ctx.isGroup && !!ctx.isAdmins);
    default: return false;
  }
}

function isCategoryVisible(category, ctx) {
  if (!category) return false;
  if (category.id === 'groups' && !ctx.isGroup) return false;
  if (category.scope && !scopeAllowed(category.scope, ctx)) return false;
  if (category.custom === 'welcome') return scopeAllowed('welcomeAdmin', ctx);
  const features = (category.features || []).map(id => FEATURES[id]).filter(Boolean);
  if (category.extras?.length) return true;
  if (!features.length) return false;
  return features.some(f => scopeAllowed(f.scope, ctx));
}

function categoriesFor(ctx) {
  return CATEGORIES.filter(c => isCategoryVisible(c, ctx));
}

function getFeature(id) { return FEATURES[id] || null; }
function getCategory(id) { return CATEGORY_MAP.get(id) || null; }

function featuresForCategory(id, ctx) {
  const category = getCategory(id);
  if (!category || !category.features) return [];
  return category.features
    .map(fid => FEATURES[fid])
    .filter(f => f && scopeAllowed(f.scope, ctx));
}

function title(feature) { return `${feature.emoji || '•'} ${feature.label}`; }

module.exports = {
  ACTION_PREFIX,
  SCOPE_LABELS,
  FEATURES,
  CATEGORIES,
  CATEGORY_MAP,
  scopeAllowed,
  isCategoryVisible,
  categoriesFor,
  featuresForCategory,
  getFeature,
  getCategory,
  title,
};
