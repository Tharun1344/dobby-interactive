'use strict';
/**
 * .movie / .film — search CineSubz, pick a quality, download on the bot host
 * and send the film to this WhatsApp chat as a document.
 *
 * There is deliberately no PC bridge, PowerShell or Python dependency. The
 * bot host (a local machine or a cloud container with a volume) does all HTTP
 * work, so this also works on Railway.
 *
 * Flow:
 *   .movie <name>        -> CineSubz search
 *                        -> (only when the search is ambiguous) choose the page
 *                        -> (only when more than one quality exists) choose quality
 *                        -> download -> WhatsApp document -> delete cloud file
 *
 * Env:
 *   FILM_SITE                 default https://cinesubz.net
 *   FILM_DOWNLOAD_DIR         default <STORAGE_DIR>/data/films
 *   FILM_MAX_BYTES            default 1.9 GB (WhatsApp document ceiling)
 *   FILM_MAX_CONCURRENT       default 2
 *   FILM_DELETE_AFTER_SEND    default true
 *   FILM_COOLDOWN_MS          default 8000 (per sender, search only)
 *   FILM_PROMPT_TTL_MS        default 10 minutes
 *   FILM_STREAM_UPLOAD        on | off | auto (default auto)
 *                             on = push the HTTP stream straight into WhatsApp — the film never touches
 *                             the disk, so a 0.8-1.5 GB film works on a ~450 MB volume (Railway free).
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const fsp = fs.promises;
const { Readable, Transform } = require('stream');
const { cmd } = require('../command');
const source = require('../lib/filmSource');
const downloads = require('../lib/filmDownload');
const menuMode = require('../lib/menuMode');
const { sendButtons, readInteractiveReply, normalizeJid } = require('../lib/interactive/messages');

const PREFIX_FALLBACK = process.env.PREFIX || '.';
const PROMPT_TTL_MS = Math.max(60000, Number(process.env.FILM_PROMPT_TTL_MS || 10 * 60 * 1000));
const COOLDOWN_MS = Math.max(0, Number(process.env.FILM_COOLDOWN_MS || 8000));
const MAX_CHOICES = 3;
const MAX_LISTED_VARIANTS = 6;

/** chatId -> pending selection (one at a time per chat) */
const prompts = new Map();
/** sender -> last search time */
const cooldowns = new Map();

function prefixOf(c) {
  return c?.prefix || PREFIX_FALLBACK;
}

const USAGE = (prefix) => [
  '🎬 *Film download (CineSubz)*',
  '',
  `*${prefix}movie* <film name>`,
  `*${prefix}film* <film name>`,
  `*${prefix}movie* 720p <film name>`,
  '',
  `*${prefix}movie status*  — download progress`,
  `*${prefix}movie cancel*  — stop the download`,
  `*${prefix}movie send*    — retry sending the last downloaded file`,
  '',
  'උදා:',
  `${prefix}movie Iru Mugan`,
  `${prefix}movie 480p Sachein`,
].join('\n');

function makeToken() {
  return crypto.randomBytes(6).toString('hex');
}

function livePrompt(chatId) {
  const prompt = prompts.get(chatId);
  if (!prompt) return null;
  if (Date.now() - prompt.at > PROMPT_TTL_MS) {
    prompts.delete(chatId);
    return null;
  }
  return prompt;
}

function setPrompt(prompt) {
  // Bound the map: expired entries are dropped whenever a new prompt is made.
  for (const [chatId, existing] of prompts) {
    if (Date.now() - existing.at > PROMPT_TTL_MS) prompts.delete(chatId);
  }
  prompts.set(prompt.chatId, prompt);
  return prompt;
}

function takePrompt(chatId, token) {
  const prompt = livePrompt(chatId);
  if (!prompt) return null;
  if (token && prompt.token !== token) return null;
  prompts.delete(chatId);
  return prompt;
}

function checkCooldown(sender) {
  const id = String(sender || '');
  const now = Date.now();
  if (cooldowns.size > 500) {
    for (const [key, at] of cooldowns) if (now - at > COOLDOWN_MS * 4) cooldowns.delete(key);
  }
  const last = cooldowns.get(id) || 0;
  if (COOLDOWN_MS && now - last < COOLDOWN_MS) {
    return Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
  }
  cooldowns.set(id, now);
  return 0;
}

function selfJids(sock) {
  return [sock?.user?.id, sock?.user?.lid]
    .map(value => normalizeJid(value || ''))
    .filter(Boolean);
}

/** Native quick replies are the default; text-only/self-chat/disabled use text. */
function canUseButtons(sock, c) {
  if (String(process.env.INTERACTIVE_ENABLED || 'true').toLowerCase() === 'false') return false;
  if (String(process.env.INTERACTIVE_TEXT_ONLY || '').toLowerCase() === 'true') return false;
  if (!menuMode.canUseInteractive(c.accountId)) return false;
  const from = normalizeJid(c.from || '');
  if (!c.isGroup && selfJids(sock).includes(from)) return false;
  return true;
}

function compactBytes(bytes) {
  const value = Number(bytes) || 0;
  if (!value) return 'size ?';
  return source.formatBytes(value);
}

function qualityText(title, variants) {
  const shown = variants.slice(0, MAX_LISTED_VARIANTS);
  const lines = [
    `🎬 *${title}*`,
    '📁 Source: CineSubz',
    '',
    '📥 Quality එකක් තෝරන්න:',
    '',
  ];
  shown.forEach((variant, index) => {
    lines.push(`${index + 1}. *${variant.quality}* · ${compactBytes(variant.bytes)}`);
  });
  if (variants.length > shown.length) {
    lines.push('', `_තව ${variants.length - shown.length}ක් තියෙනවා — number එකකින් තෝරන්න._`);
  }
  lines.push('', '_Button එකක් ඔබන්න, නැත්නම් number එක reply කරන්න._');
  lines.push(`_Cancel: ${PREFIX_FALLBACK}movie cancel_`);
  return lines.join('\n');
}

function pickText(query, candidates) {
  const lines = [
    `🔎 *"${query}"* සඳහා හමු වූ films:`,
    '',
  ];
  candidates.forEach((candidate, index) => {
    lines.push(`${index + 1}. ${candidate.title}`);
  });
  lines.push('', '_ඔබට අවශ්‍ය film එක තෝරන්න._');
  return lines.join('\n');
}

async function sendPrompt(sock, c, { token, kind, text, items, title, footer }) {
  if (canUseButtons(sock, c)) {
    try {
      await sendButtons(sock, c.from, {
        title: title || '🎬 Film download',
        text,
        footer: footer || 'Number එකක් reply කරලත් තෝරන්න පුළුවන්',
        buttons: items.slice(0, MAX_CHOICES).map((item, index) => ({
          id: `film:${kind === 'quality' ? 'go' : 'pick'}:${token}:${index}`,
          text: item.label,
        })),
        quoted: c.quoted,
      });
      return true;
    } catch (err) {
      console.warn('[movie] native buttons failed, using text menu:', err?.message || err);
    }
  }
  await c.reply(text).catch(() => {});
  return false;
}

function startErrorText(err) {
  const code = err?.code;
  if (code === 'BUSY') {
    return '⏳ මේ chat එකේ දැනටමත් film download එකක් යනවා.\n\n📊 *.movie status* යවන්න.';
  }
  if (code === 'BUSY_GLOBAL') {
    return `🚦 දැනට downloads ${downloads.stats().active}/${downloads.maxConcurrent()}ක් යනවා. ටිකකින් නැවත try කරන්න.`;
  }
  if (code === 'TOO_LARGE') {
    return `⚠️ File එක WhatsApp document limit එකට වඩා ලොකුයි.\n📝 ${err.message}\n\n_වෙන quality එකක් තෝරන්න._`;
  }
  if (code === 'NO_SPACE') {
    return [
      '💾 *Cloud disk space මදි.*',
      '',
      err.message,
      '',
      'Cloud host එකේ volume/disk space එක check කරන්න. File එක delete කරලා නැවත try කරන්න.',
    ].join('\n');
  }
  return `❌ Download එක start කරන්න බැරි වුණා.\n📝 ${err?.message || err}`;
}

/** Send the finished file, then delete it only after WhatsApp accepted it. */
async function sendFilm(sock, job) {
  const stat = await fsp.stat(job.file);
  if (!stat.size) {
    const err = new Error('Downloaded file is empty');
    err.code = 'EMPTY_FILE';
    throw err;
  }
  if (stat.size > downloads.maxBytes()) {
    const err = new Error(`File is ${source.formatBytes(stat.size)} — over the configured limit`);
    err.code = 'TOO_LARGE';
    throw err;
  }
  // Baileys writes an encrypted copy to os.tmpdir() before upload.
  downloads.ensureSpace(os.tmpdir(), stat.size);

  const baseName = downloads.safeFileName(job.title || job.query || 'film');
  const fileName = `${baseName}${job.quality ? ` ${job.quality}` : ''}.mp4`.replace(/\s+/g, ' ').trim();
  const caption = [
    `🎬 *${job.title || job.query || 'Film'}*`,
    `📺 ${job.quality || '?'} • 📦 ${source.formatBytes(stat.size)}`,
  ].join('\n');

  const content = {
    mimetype: 'video/mp4',
    fileName,
    caption,
  };

  try {
    await sock.sendMessage(job.chatId, { document: { url: job.file }, ...content });
  } catch (first) {
    console.warn('[movie] document url send failed, retrying with a stream:', first?.message || first);
    await sock.sendMessage(job.chatId, { document: { stream: fs.createReadStream(job.file) }, ...content });
  }

  if (downloads.deleteAfterSend()) {
    await downloads.removeFile(job);
  }
}

async function notifyJobError(sock, job) {
  if (job.status === 'cancelled' || job.abort?.signal?.aborted) return;
  const title = job.title || job.query || 'Film';
  const chat = job.chatId;
  if (job.sendError) {
    await sock.sendMessage(chat, {
      text: [
        `⚠️ *${title}* download එක ඉවරයි, ඒත් WhatsApp document එක යැව්වේ නෑ.`,
        `📝 ${job.sendError}`,
        '',
        'File එක cloud එකේ තියෙනවා. නැවත යවන්න: *.movie send*',
      ].join('\n'),
    }).catch(() => {});
    return;
  }
  await sock.sendMessage(chat, {
    text: [
      `❌ *${title}* download එක fail වුණා.`,
      job.error ? `📝 ${job.error}` : '',
      '',
      'නැවත try කරන්න: *.movie <film name>*',
      '📊 *.movie status*',
    ].filter(Boolean).join('\n'),
  }).catch(() => {});
}

/* ── stream upload: film → WhatsApp without ever writing it to disk ──────────
 * Railway's free volume is ~450 MB and a CineSubz film is 0.5-1.5 GB. Baileys would also need a
 * second encrypted copy in os.tmpdir(), so the disk path cannot work there. WhatsApp accepts a
 * stream + fileLength, so we pipe the HTTP body straight into the upload: no file, no copy, no
 * volume space — RAM stays flat because nothing is buffered.
 */
const FILM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

function streamMode() {
  return String(process.env.FILM_STREAM_UPLOAD || 'auto').toLowerCase();
}

function streamEnabled(bytes) {
  const mode = streamMode();
  if (['off', 'false', '0', 'no'].includes(mode)) return false;
  if (['on', 'true', '1', 'yes'].includes(mode)) return true;
  // auto: stream when the download dir cannot hold the film plus Baileys' encrypted copy
  try {
    if (typeof fs.statfsSync !== 'function') return true;
    const st = fs.statfsSync(downloads.outDir());
    const free = Number(st.bavail) * Number(st.bsize);
    return !free || free < (Number(bytes) || 0) * 2.2;
  } catch { return true; }
}

async function streamFilm(sock, c, { title, quality, variant }) {
  const fileName = `${downloads.safeFileName(title || 'film')}${quality ? ` ${quality}` : ''}.mp4`.replace(/\s+/g, ' ').trim();
  let res;
  try {
    res = await fetch(variant.url, { headers: { 'User-Agent': FILM_UA }, redirect: 'follow' });
  } catch (err) {
    console.warn('[movie] stream fetch failed:', err?.message || err);
    return false;
  }
  if (!res.ok || !res.body) return false;
  const type = res.headers.get('content-type') || '';
  if (/text\/html/i.test(type)) return false;
  const length = Number(res.headers.get('content-length') || variant.bytes || 0);
  if (!length) return false;                         // WhatsApp needs the size up front

  if (length > downloads.maxBytes()) {
    await c.reply([
      `⚠️ *${title}* file එක WhatsApp limit එකට වඩා ලොකුයි.`,
      `📦 ${source.formatBytes(length)} · 📏 ${source.formatBytes(downloads.maxBytes())}`,
      '', '_වෙන quality එකක් තෝරන්න._',
    ].join('\n')).catch(() => { });
    return true;                                     // handled: do not fall back to the disk path
  }

  await c.reply([
    '⬆️ *WhatsApp එකට යවනවා…*',
    `🎬 ${title}`,
    `📺 ${quality} • 📦 ${source.formatBytes(length)}`,
    '_Disk එකේ save වෙන්නේ නෑ — stream එකෙන් කෙලින්ම යනවා._',
  ].join('\n')).catch(() => { });

  let sent = 0; let last = Date.now();
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      sent += chunk.length;
      const now = Date.now();
      if (now - last > 25000 && length) {
        last = now;
        c.reply(`⬆️ ${Math.round((sent / length) * 100)}% • ${source.formatBytes(sent)} / ${source.formatBytes(length)}`).catch(() => { });
      }
      cb(null, chunk);
    },
  });

  try {
    await sock.sendMessage(c.from, {
      document: { stream: Readable.fromWeb(res.body).pipe(counter) },
      mimetype: 'video/mp4',
      fileName,
      caption: [`🎬 *${title}*`, `📺 ${quality} • 📦 ${source.formatBytes(length)}`].join('\n'),
      fileLength: length,
    });
    await sock.sendMessage(c.from, {
      text: `✅ *${title}* (${quality}) — ${source.formatBytes(length)} යැව්වා ✓`,
    }).catch(() => { });
    return true;
  } catch (err) {
    console.error('[movie] stream send failed:', err?.message || err);
    await c.reply(`⚠️ Stream එකෙන් යවන්න බැරි වුනා — disk ක්‍රමයෙන් උත්සාහ කරනවා…\n📝 ${err?.message || err}`).catch(() => { });
    return false;
  }
}

async function startDownload(sock, c, { title, quality, variant, query, page }) {
  try {
    source.assertPublicHttpUrl(variant.url);
  } catch (err) {
    return c.reply(`❌ Media link එක invalid: ${err.message}`).catch(() => { });
  }

  // no-disk path first when the host disk is too small for the film (Railway free volume)
  if (streamEnabled(variant.bytes)) {
    const streamed = await streamFilm(sock, c, { title, quality, variant });
    if (streamed) return null;
  }

  await c.reply([
    '⬇️ *Download start*',
    `🎬 ${title}`,
    `📺 ${quality} • 📦 ${compactBytes(variant.bytes)}`,
    '',
    `📊 Progress: *.movie status*`,
    `❌ Cancel: *.movie cancel*`,
  ].join('\n')).catch(() => {});

  let notified = 0;
  const onProgress = (job) => {
    if (!job.expected) return;
    const pct = (job.bytes / job.expected) * 100;
    const mark = pct >= 90 ? 90 : pct >= 50 ? 50 : pct >= 25 ? 25 : 0;
    if (!mark || mark <= notified) return;
    notified = mark;
    sock.sendMessage(job.chatId, {
      text: `⬇️ *${job.title}*\n📊 ${mark}% • ${source.formatBytes(job.bytes)} / ${source.formatBytes(job.expected)}`,
    }).catch(() => {});
  };

  try {
    const job = downloads.startJob({
      accountId: c.accountId || 'default',
      chatId: c.from,
      sender: c.sender,
      query,
      title,
      quality,
      url: variant.url,
      expectedBytes: variant.bytes || 0,
      onProgress,
      onComplete: async (finished) => {
        try {
          await sendFilm(sock, finished);
        } catch (err) {
          finished.sendError = err?.message || String(err);
          throw err;
        }
      },
      onError: async (failed) => notifyJobError(sock, failed),
    });
    return job;
  } catch (err) {
    await c.reply(startErrorText(err)).catch(() => {});
    return null;
  }
}

async function resolveAndOffer(sock, c, { query, page, candidateTitle, preferredQuality }) {
  const label = candidateTitle || query;
  await c.reply(`🎞️ *${label}* හමු වුණා.\n📥 Quality variants බලනවා…`).catch(() => {});

  let info;
  try {
    info = await source.resolveFilm(page, preferredQuality || '480p', { withSizes: true });
  } catch (err) {
    await c.reply([
      '❌ Player එකෙන් download link එක ගන්න බැරි වුණා.',
      `📝 ${err.message}`,
      '',
      `_නැවත try කරන්න: ${prefixOf(c)}movie ${query}_`,
    ].join('\n')).catch(() => {});
    return;
  }

  const limit = downloads.maxBytes();
  const usable = info.variants.filter(variant => !variant.bytes || variant.bytes <= limit);
  const tooLarge = info.variants.filter(variant => variant.bytes && variant.bytes > limit);
  const title = info.title || label;

  if (!usable.length) {
    const biggest = tooLarge[0];
    await c.reply([
      `⚠️ *${title}* හමු වුණා, ඒත් file එක WhatsApp limit එකට වඩා ලොකුයි.`,
      biggest ? `📦 ${biggest.quality} • ${compactBytes(biggest.bytes)}` : '',
      `📏 Limit: ${source.formatBytes(limit)}`,
      '',
      '_Bot host එකේ FILM_MAX_BYTES setting එකෙන් limit එක වැඩි කළ හැක._',
    ].filter(Boolean).join('\n')).catch(() => {});
    return;
  }

  if (preferredQuality) {
    const chosen = source.pickVariant(usable, preferredQuality);
    if (chosen) {
      return startDownload(sock, c, {
        title, quality: chosen.quality, variant: chosen, query, page,
      });
    }
  }

  if (usable.length === 1) {
    const chosen = usable[0];
    return startDownload(sock, c, {
      title, quality: chosen.quality, variant: chosen, query, page,
    });
  }

  const token = makeToken();
  setPrompt({
    kind: 'quality',
    token,
    accountId: c.accountId || 'default',
    chatId: c.from,
    sender: normalizeJid(c.sender || ''),
    at: Date.now(),
    query,
    page,
    title,
    variants: usable,
  });

  const text = qualityText(title, usable);
  if (tooLarge.length) {
    // Keep the message short; details are only useful when the user asks again.
    console.log(`[movie] ${tooLarge.length} variant(s) skipped over ${source.formatBytes(limit)} for "${title}"`);
  }
  return sendPrompt(sock, c, {
    token,
    kind: 'quality',
    text,
    items: usable.map(variant => ({ label: variant.quality })),
    title: '🎬 Quality',
  });
}

async function separateSearch(sock, c, query, preferredQuality) {
  const wait = checkCooldown(c.sender || c.from);
  if (wait) {
    return c.reply(`⏳ තව ${wait} තත්පරයක් ඉන්න.`).catch(() => {});
  }

  await c.reply(`🔎 *CineSubz එකේ හොයනවා:* ${query}\n_තත්පර කිහිපයක් රැඳී සිටින්න…_`).catch(() => {});

  let candidates = [];
  try {
    candidates = await source.searchFilms(query);
  } catch (err) {
    console.error('[movie] search failed:', err?.message || err);
  }

  if (!candidates.length) {
    return c.reply([
      `😕 *"${query}"* CineSubz එකේ හමු වුණේ නෑ.`,
      '',
      'Try:',
      '• English title එකෙන් උත්සාහ කරන්න',
      '• Spelling එක පරීක්ෂා කරන්න',
      '• Year එකත් එකතු කරන්න',
      '',
      `_උදා: ${prefixOf(c)}movie Iru Mugan_`,
    ].join('\n')).catch(() => {});
  }

  const top = candidates[0];
  if (candidates.length > 1 && !source.titleMatches(query, top.title)) {
    const items = candidates.slice(0, MAX_CHOICES);
    const token = makeToken();
    setPrompt({
      kind: 'pick',
      token,
      accountId: c.accountId || 'default',
      chatId: c.from,
      sender: normalizeJid(c.sender || ''),
      at: Date.now(),
      query,
      candidates: items,
    });
    return sendPrompt(sock, c, {
      token,
      kind: 'pick',
      text: pickText(query, items),
      items: items.map(item => ({ label: item.title })),
      title: '🔎 Film එක තෝරන්න',
    });
  }

  return resolveAndOffer(sock, c, {
    query,
    page: top.url,
    candidateTitle: top.title,
    preferredQuality,
  });
}

async function deliverLast(sock, c) {
  const job = downloads.status(c.accountId, c.from);
  if (!job) {
    return c.reply([
      '📭 මේ chat එකේ කලින් download එකක් නෑ.',
      '',
      `*.movie <film name>* යවන්න.`,
    ].join('\n')).catch(() => {});
  }
  if (job.status === 'queued' || job.status === 'downloading' || job.status === 'sending') {
    return c.reply('⏳ Download එක තාම යනවා. *.movie status* යවන්න.').catch(() => {});
  }
  if (!fs.existsSync(job.file)) {
    return c.reply([
      '🗑️ File එක cloud එකේ නෑ (යැව්වට පස්සේ delete කරලා).',
      '',
      `නැවත download කරන්න: *.movie ${job.query || job.title || '<film name>'}*`,
    ].join('\n')).catch(() => {});
  }

  job.status = 'sending';
  job.updatedAt = Date.now();
  try {
    await sendFilm(sock, job);
    job.status = 'done';
    job.sendError = '';
    job.completedAt = Date.now();
    await c.reply(`✅ *${job.title}* document එක නැවත යැව්වා.`).catch(() => {});
  } catch (err) {
    job.status = 'failed';
    job.sendError = err?.message || String(err);
    await c.reply([
      `❌ Document එක යවන්න බැරි වුණා: ${job.sendError}`,
      '',
      '_File එක cloud එකේ තියෙනවා. ආයෙත් try කරන්න: *.movie send*_',
    ].join('\n')).catch(() => {});
  }
}

async function showStatus(sock, c) {
  const job = downloads.status(c.accountId, c.from);
  return c.reply(downloads.describe(job)).catch(() => {});
}

async function cancelJob(sock, c) {
  try {
    const job = downloads.cancel(c.accountId, c.from);
    if (!job) {
      return c.reply('📭 Cancel කරන්න active download එකක් නෑ.').catch(() => {});
    }
    return c.reply(`⏹️ *${job.title || job.query || 'Film'}* download එක cancel කළා.`).catch(() => {});
  } catch (err) {
    return c.reply(`⚠️ ${err.message}`).catch(() => {});
  }
}

/* ── buttons + numbered text replies ──────────────────────────────────────── */

function parseFilmButton(value) {
  const match = String(value || '').match(/^film:(pick|go):([a-f0-9]{6,32}):(\d{1,2})$/i);
  if (!match) return null;
  return { kind: match[1].toLowerCase(), token: match[2], index: Number(match[3]) };
}

function filmReplyFilter(body, { sender, message } = {}) {
  const reply = readInteractiveReply(message?.message || message);
  if (reply && String(reply.id || '').startsWith('film:')) return true;
  if (String(body || '').startsWith('film:')) return true;

  const chatId = message?.key?.remoteJid;
  if (!chatId) return false;
  const prompt = livePrompt(chatId);
  if (!prompt) return false;
  // Only the sender who started the search may consume a plain number or
  // quality text. Button/`film:` ids above still reach the handler so it can
  // explain ownership to a stranger instead of silently ignoring them.
  if (normalizeJid(prompt.sender || '') !== normalizeJid(sender || '')) return false;

  const text = String(body || '').trim();
  if (/^\d{1,2}$/.test(text)) return true;
  if (prompt.kind === 'quality' && /^\d{3,4}p$/i.test(text)) return true;
  return false;
}

function senderMismatch(prompt, c) {
  return normalizeJid(prompt.sender || '') !== normalizeJid(c.sender || '');
}

async function chooseItem(sock, c, prompt, index) {
  const items = prompt.kind === 'pick' ? prompt.candidates : prompt.variants;
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    return c.reply(`1 සිට ${items.length} දක්වා number එකක් තෝරන්න.`).catch(() => {});
  }

  if (prompt.kind === 'pick') {
    const candidate = prompt.candidates[index];
    return resolveAndOffer(sock, c, {
      query: prompt.query,
      page: candidate.url,
      candidateTitle: candidate.title,
    });
  }

  const variant = prompt.variants[index];
  return startDownload(sock, c, {
    title: prompt.title,
    quality: variant.quality,
    variant,
    query: prompt.query,
    page: prompt.page,
  });
}

cmd(
  {
    filter: filmReplyFilter,
    desc: 'Handle film quality/page buttons and numbered text replies',
    category: 'movie',
    dontAddCommandList: true,
    silent: true,
  },
  async (sock, incoming, m, c) => {
    const chatId = c.from;
    const reply = readInteractiveReply(incoming?.message);
    const raw = reply?.id || (String(m?.body || '').startsWith('film:') ? String(m.body) : '');
    const prompt = livePrompt(chatId);

    if (raw.startsWith('film:')) {
      const parsed = parseFilmButton(raw);
      if (!parsed) return;
      if (!prompt || prompt.token !== parsed.token) {
        return c.reply(`⌛ Selection එක expire වුණා.\n\n*.movie <film name>* නැවත යවන්න.`).catch(() => {});
      }
      if (prompt.accountId !== (c.accountId || 'default')) return;
      if (senderMismatch(prompt, c)) {
        return c.reply('⚠️ මේ selection එක වෙන user කෙනෙකුට අයිති. ඔයා *.movie <film name>* යවන්න.').catch(() => {});
      }
      takePrompt(chatId, parsed.token);
      return chooseItem(sock, c, prompt, parsed.index);
    }

    if (!prompt) return;
    if (prompt.accountId !== (c.accountId || 'default')) return;
    if (senderMismatch(prompt, c)) return;

    const text = String(c.body || m?.body || '').trim();
    let index = -1;
    if (/^\d{1,2}$/.test(text)) {
      index = Number(text) - 1;
    } else if (prompt.kind === 'quality' && /^\d{3,4}p$/i.test(text)) {
      index = prompt.variants.findIndex(variant => String(variant.quality).toLowerCase() === text.toLowerCase());
    }
    if (index < 0) return;

    takePrompt(chatId, prompt.token);
    return chooseItem(sock, c, prompt, index);
  }
);

/* ── .movie / .film ────────────────────────────────────────────────────────── */

cmd(
  {
    pattern: 'movie',
    alias: ['film'],
    desc: 'Search CineSubz, choose quality, download the film and send it as a document',
    category: 'movie',
    react: '🎬',
  },
  async (sock, _incoming, _m, c) => {
    const prefix = prefixOf(c);
    let query = String(c.q || '').trim();

    if (!query) return c.reply(USAGE(prefix));
    if (query.length > 160) {
      return c.reply(`❌ Film name එක දිග වැඩියි (160 characters max).\n\n${USAGE(prefix)}`).catch(() => {});
    }

    if (/^(status|progress)$/i.test(query)) return showStatus(sock, c);
    if (/^cancel$/i.test(query)) return cancelJob(sock, c);
    if (/^(send|resend)$/i.test(query)) return deliverLast(sock, c);
    if (/^(help|usage)$/i.test(query)) return c.reply(USAGE(prefix));

    let preferredQuality = '';
    const qualityMatch = query.match(/^(\d{3,4})p\s+(.+)$/i);
    if (qualityMatch) {
      preferredQuality = `${qualityMatch[1]}p`;
      query = qualityMatch[2].trim();
    }
    if (!query) return c.reply(USAGE(prefix));

    return separateSearch(sock, c, query, preferredQuality);
  }
);

/* ── .moviestatus (owner diagnostics) ──────────────────────────────────────── */

cmd(
  {
    pattern: 'moviestatus',
    desc: 'Show film downloader configuration, disk space and active jobs',
    category: 'movie',
    fromMe: true,
    silent: true,
  },
  async (_sock, _incoming, _m, c) => {
    const stats = downloads.stats();
    let disk = 'unknown';
    try {
      if (typeof fs.statfsSync === 'function') {
        const info = fs.statfsSync(stats.dir);
        disk = `${source.formatBytes(Number(info.bavail) * Number(info.bsize))} free`;
      }
    } catch { /* statfs is not supported on every mount */ }

    const lines = [
      '🎬 *Film downloader status*',
      '',
      `Source: ${source.site()}`,
      `Downloads: ${stats.active}/${stats.maxConcurrent} active`,
      `Directory: ${stats.dir}`,
      `Max document size: ${source.formatBytes(stats.maxBytes)}`,
      `Delete after send: ${stats.deleteAfterSend ? 'on' : 'off'}`,
      `Disk: ${disk}`,
      `Buttons: ${canUseButtons({}, { accountId: c.accountId, from: c.from, isGroup: c.isGroup }) ? 'interactive' : 'text fallback'}`,
    ];

    if (stats.activeJobs.length) {
      lines.push('', '📥 *Active jobs*');
      for (const job of stats.activeJobs) {
        const size = job.expected
          ? `${source.formatBytes(job.bytes)} / ${source.formatBytes(job.expected)}`
          : source.formatBytes(job.bytes);
        lines.push(`• ${job.title || 'Film'} (${job.quality || '?'}) — ${job.status} — ${size}`);
      }
    }

    return c.reply(lines.join('\n')).catch(() => {});
  }
);

// Test/debug hooks only. No production code reads these.
module.exports = {
  _prompts: prompts,
  _cooldowns: cooldowns,
  _parseFilmButton: parseFilmButton,
  _filter: filmReplyFilter,
  _canUseButtons: canUseButtons,
  _qualityText: qualityText,
  _sendFilm: sendFilm,
};
