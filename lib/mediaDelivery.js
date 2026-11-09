'use strict';
/**
 * Media delivery helpers: probe -> download with a hard byte cap -> send as
 * video / document / text, and always clean up the temp directory.
 *
 * Byte caps matter: WhatsApp drops large media silently and a Railway
 * container will OOM long before it finishes streaming a 4 GB file. Every
 * download here is bounded, abortable and deleted in a finally block.
 *
 * Env:
 *   MOVIE_WA_VIDEO_LIMIT_BYTES=67108864     send inline video only below this
 *   MOVIE_WA_DOC_LIMIT_BYTES=1900000000     document ceiling (hard cap 2 GB)
 *   MOVIE_DOWNLOAD_TIMEOUT_MS=900000
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const USER_AGENT =
  process.env.MOVIE_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const HARD_DOC_CAP = 2 * 1000 * 1000 * 1000;
const DOC_LIMIT = Math.min(Number(process.env.MOVIE_WA_DOC_LIMIT_BYTES || process.env.MAX_DOWNLOAD_BYTES || 1900000000), HARD_DOC_CAP);
const VIDEO_LIMIT = Number(process.env.MOVIE_WA_VIDEO_LIMIT_BYTES || 64 * 1024 * 1024);
const DOWNLOAD_TIMEOUT_MS = Number(process.env.MOVIE_DOWNLOAD_TIMEOUT_MS || 900000);

const VIDEO_MIME_RE = /^video\//i;
const VIDEO_EXT_RE = /\.(mp4|m4v|mov|webm|mkv)$/i;

/* ── formatting ────────────────────────────────────────────────────────────── */
function humanBytes(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function humanCount(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
}

function formatRuntime(minutes) {
  const m = Number(minutes) || 0;
  if (!m) return '';
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return h ? `${h}h ${rest ? `${rest}m` : ''}`.trim() : `${rest}m`;
}

function safeFileName(name, fallback = 'movie.mp4') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
  return cleaned || fallback;
}

function truncate(text, max) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/* ── remote probing / downloading ──────────────────────────────────────────── */
/**
 * HEAD first, then a 1-byte ranged GET. Returns size + type when the server
 * exposes them. Never throws.
 */
async function probeRemote(url, { timeoutMs = 15000 } = {}) {
  const headers = { 'User-Agent': USER_AGENT, Accept: '*/*' };

  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const size = Number(res.headers.get('content-length') || 0);
    const type = String(res.headers.get('content-type') || '');
    if (res.ok && size) {
      return { ok: true, size, contentType: type, finalUrl: res.url, status: res.status };
    }
  } catch {
    /* fall through to ranged GET */
  }

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { ...headers, Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const contentRange = String(res.headers.get('content-range') || '');
    const total = Number(contentRange.split('/')[1]) || 0;
    const type = String(res.headers.get('content-type') || '');
    if (res.body && typeof res.body.cancel === 'function') await res.body.cancel().catch(() => {});
    if (res.ok || res.status === 206) {
      return { ok: true, size: total, contentType: type, finalUrl: res.url, status: res.status };
    }
    return { ok: false, status: res.status, message: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, message: err.name === 'TimeoutError' ? 'probe timeout' : err.message };
  }
}

/**
 * Stream a URL to a temp file with a hard byte ceiling.
 * On any failure the whole temp directory is removed before resolving.
 *
 * @returns {Promise<{ok:true,file:string,dir:string,size:number,contentType:string}|{ok:false,error:{code:string,message:string}}>}
 */
async function downloadToTemp(url, { maxBytes = DOC_LIMIT, fileName, timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'danuwa-movie-'));
  const dest = path.join(dir, safeFileName(fileName, 'movie.bin'));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('DOWNLOAD_TIMEOUT')), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*', 'Accept-Encoding': 'identity' },
      signal: controller.signal,
    });

    if (!res.ok) throw Object.assign(new Error(`Server answered ${res.status}`), { code: `HTTP_${res.status}` });
    if (!res.body) throw Object.assign(new Error('Empty response body'), { code: 'EMPTY_BODY' });

    const declared = Number(res.headers.get('content-length') || 0);
    if (declared && declared > maxBytes) {
      throw Object.assign(new Error(`File is ${humanBytes(declared)}, limit is ${humanBytes(maxBytes)}`), {
        code: 'TOO_LARGE',
        size: declared,
      });
    }

    let written = 0;
    const limiter = new Transform({
      transform(chunk, _enc, cb) {
        written += chunk.length;
        if (written > maxBytes) {
          cb(Object.assign(new Error(`Exceeded ${humanBytes(maxBytes)} while downloading`), { code: 'TOO_LARGE' }));
          return;
        }
        cb(null, chunk);
      },
    });

    await pipeline(Readable.fromWeb(res.body), limiter, fs.createWriteStream(dest));

    if (!written) throw Object.assign(new Error('Downloaded file is empty'), { code: 'EMPTY_FILE' });
    return {
      ok: true,
      file: dest,
      dir,
      size: written,
      contentType: String(res.headers.get('content-type') || ''),
    };
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    const code = err.code || (err.name === 'AbortError' || /aborted|timeout/i.test(err.message) ? 'TIMEOUT' : 'DOWNLOAD_FAILED');
    return { ok: false, error: { code, message: err.message } };
  } finally {
    clearTimeout(timer);
  }
}

/* ── sending ───────────────────────────────────────────────────────────────── */
function videoCaption(movie, offer) {
  const bits = [`🎬 *${movie.title}${movie.year ? ` (${movie.year})` : ''}*`];
  const meta = [movie.rating ? `⭐ ${movie.rating}/10` : '', offer && offer.quality ? `📺 ${offer.quality}` : '']
    .filter(Boolean)
    .join('  •  ');
  if (meta) bits.push(meta);
  return bits.join('\n');
}

async function sendVideo(sock, jid, file, caption, quoted) {
  const base = {
    mimetype: 'video/mp4',
    fileName: safeFileName(path.basename(file)),
    caption,
    gifPlayback: false,
  };
  const attempts = [
    () => ({ video: { url: file } }),
    () => ({ video: { stream: fs.createReadStream(file) } }),
    () => ({ video: fs.readFileSync(file) }),
  ];
  let lastError;
  for (const make of attempts) {
    try {
      return await sock.sendMessage(jid, { ...make(), ...base }, { quoted });
    } catch (err) {
      lastError = err;
      console.error('[movie] video send attempt failed:', err.message);
    }
  }
  throw lastError || new Error('Could not send video');
}

async function sendDocument(sock, jid, file, caption, quoted) {
  const name = safeFileName(path.basename(file));
  const mime = VIDEO_EXT_RE.test(name) ? 'video/mp4' : 'application/octet-stream';
  return sock.sendMessage(jid, { document: { url: file }, mimetype: mime, fileName: name, caption }, { quoted });
}

/* ── offer selection ───────────────────────────────────────────────────────── */
/** Prefer the requested quality, then the largest known file, then order. */
function pickOffer(offers, preferredQuality) {
  const usable = (offers || []).filter((o) => o && o.url && o.type !== 'page');
  if (!usable.length) return null;

  const wanted = String(preferredQuality || '').replace(/[^\d]/g, '');
  if (wanted) {
    const exact = usable.find((o) => String(o.quality).replace(/[^\d]/g, '') === wanted);
    if (exact) return exact;
  }
  return [...usable].sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0))[0];
}

/**
 * Try to deliver a movie as real WhatsApp media.
 * Falls back gracefully: video -> document -> caller sends the text card.
 *
 * @returns {Promise<{ok:boolean, mode?:string, size?:number, reason?:string, message?:string}>}
 */
async function deliverMovie(sock, jid, movie, { quoted, quality } = {}) {
  const offer = pickOffer(movie.offers, quality);
  if (!offer) return { ok: false, reason: 'NO_OFFER' };

  const probe = await probeRemote(offer.url);
  const size = offer.sizeBytes || (probe.ok ? probe.size : 0);
  const contentType = probe.ok ? probe.contentType : '';

  if (size && size > DOC_LIMIT) {
    return { ok: false, reason: 'TOO_LARGE', size, message: `${humanBytes(size)} > ${humanBytes(DOC_LIMIT)}` };
  }

  // Containers WhatsApp can actually stream. Anything else (mkv, avi, ts …)
  // is delivered as a document so it still plays after downloading.
  const ext = (offer.url.split('?')[0].match(/\.([a-z0-9]{2,5})$/i) || [])[1] || '';
  const streamableExt = ['mp4', 'm4v', 'webm', 'mov'].includes(ext.toLowerCase());
  const looksVideo = streamableExt || (VIDEO_MIME_RE.test(contentType) && !/^(mkv|avi|flv|ts|wmv)$/i.test(ext));

  const fileName = safeFileName(
    `${movie.title}${movie.year ? ` ${movie.year}` : ''}${offer.quality ? ` ${offer.quality}` : ''}.${ext || (looksVideo ? 'mp4' : 'bin')}`
  );

  // Decide before downloading: inline video when it looks streamable and we
  // already know it fits. Unknown sizes are attempted up to the video cap.
  const inlineVideo = looksVideo && (!size || size <= VIDEO_LIMIT);
  const maxBytes = inlineVideo ? VIDEO_LIMIT : DOC_LIMIT;
  const download = await downloadToTemp(offer.url, { maxBytes, fileName });

  if (!download.ok) {
    if (download.error.code === 'TOO_LARGE') {
      return { ok: false, reason: 'NEEDS_DOCUMENT', size, message: download.error.message };
    }
    return { ok: false, reason: 'DOWNLOAD_FAILED', message: download.error.message };
  }

  try {
    const caption = videoCaption(movie, offer);

    if (inlineVideo && download.size <= VIDEO_LIMIT) {
      await sendVideo(sock, jid, download.file, caption, quoted);
      return { ok: true, mode: 'video', size: download.size };
    }

    await sendDocument(sock, jid, download.file, caption, quoted);
    return { ok: true, mode: 'document', size: download.size };
  } catch (err) {
    return { ok: false, reason: 'SEND_FAILED', message: err.message };
  } finally {
    fs.rmSync(download.dir, { recursive: true, force: true });
  }
}

/* ── local file delivery (Playwright download, uploads, …) ─────────────────── */
/**
 * Send a file that already exists on disk, then always delete its temp dir.
 * Used by the Playwright downloader and by any "download from an authorized
 * source" flow.
 *
 * @returns {Promise<{ok:boolean, mode?:string, size?:number, reason?:string, message?:string}>}
 */
async function deliverLocalFile(sock, jid, { file, dir, title, quality, quoted } = {}) {
  try {
    if (!file || !fs.existsSync(file)) return { ok: false, reason: 'MISSING_FILE' };

    const size = fs.statSync(file).size;
    if (!size) return { ok: false, reason: 'EMPTY_FILE' };
    if (size > DOC_LIMIT) {
      return { ok: false, reason: 'TOO_LARGE', size, message: `${humanBytes(size)} > ${humanBytes(DOC_LIMIT)}` };
    }

    const ext = path.extname(file).slice(1).toLowerCase();
    const streamable = ['mp4', 'm4v', 'webm', 'mov'].includes(ext);
    const caption = [`🎬 *${title || path.basename(file)}*`, quality ? `📺 ${quality}` : ''].filter(Boolean).join('\n');

    if (streamable && size <= VIDEO_LIMIT) {
      await sendVideo(sock, jid, file, caption, quoted);
      return { ok: true, mode: 'video', size };
    }

    await sendDocument(sock, jid, file, caption, quoted);
    return { ok: true, mode: 'document', size };
  } catch (err) {
    return { ok: false, reason: 'SEND_FAILED', message: err.message };
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ── text card ─────────────────────────────────────────────────────────────── */
const DIVIDER = '━━━━━━━━━━━━━━━━';

/**
 * Build the WhatsApp text card. WhatsApp supports *bold*, _italic_ and
 * monospace; markdown headings/links are sent literally, so avoid them.
 */
function formatMovieCard(movie, { prefix = '.', requested = '' } = {}) {
  const m = movie || {};
  const lines = [];

  lines.push(`🎬 *${m.title || 'Unknown title'}*${m.year ? ` _(${m.year})_` : ''}`);

  const meta = [];
  if (m.rating) meta.push(`⭐ *${m.rating}/10*${m.votes ? ` (${humanCount(m.votes)} votes)` : ''}`);
  if (m.runtimeMin) meta.push(`⏱️ ${formatRuntime(m.runtimeMin)}`);
  if (m.genres && m.genres.length) meta.push(`🎭 ${m.genres.slice(0, 3).join(', ')}`);
  for (const line of meta) lines.push(line);

  if (m.synopsis) lines.push('', `📝 ${truncate(m.synopsis, 520)}`);

  lines.push('', DIVIDER);

  if (m.offers && m.offers.length) {
    lines.push('📥 *Download / Stream*');
    m.offers.slice(0, 8).forEach((o, i) => {
      const bits = [o.quality || 'Link'];
      if (o.sizeBytes) bits.push(humanBytes(o.sizeBytes));
      if (o.host) bits.push(o.host);
      lines.push(`${i + 1}. ${bits.join(' · ')}`);
      lines.push(`   ${o.url}`);
    });
  } else {
    lines.push('⚠️ *No direct download available*');
    lines.push('_This title is not in the bot\'s licensed catalogue._');
    if (m.whereToWatch && m.whereToWatch.length) {
      lines.push('', `🎟️ *Stream it legally on:* ${m.whereToWatch.map((p) => p.name).join(', ')}`);
      const link = m.whereToWatch.find((p) => p.url);
      if (link) lines.push(link.url);
    } else if (m.tmdbUrl) {
      lines.push('', `🔎 Details & availability: ${m.tmdbUrl}`);
    }
  }

  if (m.trailerUrl) lines.push('', `▶️ *Trailer:* ${m.trailerUrl}`);
  if (m.imdbUrl) lines.push(`⭐ *IMDb:* ${m.imdbUrl}`);

  lines.push('', DIVIDER);
  lines.push(`_Requested: ${truncate(requested || m.title || '', 60)}_`);
  if (prefix) lines.push(`_Tip: ${prefix}movie <name> 2024  — add a year for exact matches._`);

  return truncate(lines.join('\n'), 3800);
}

/** User-facing explanation for every failure mode the provider layer can emit. */
function formatFallback(error, { query = '', prefix = '.' } = {}) {
  const code = (error && error.code) || 'ERROR';
  const shown = truncate(query, 60);

  switch (code) {
    case 'BAD_QUERY':
      return `🎬 *Movie search*\n\nUsage: ${prefix}movie <movie name> [year]\n\nඋදා: ${prefix}movie Dune 2021`;
    case 'NO_RESULTS':
      return [
        `😕 *"${shown}" හමු වුණේ නැහැ.*`,
        '',
        'Try:',
        '• Spelling එක පරීක්ෂා කරන්න',
        '• English title එකෙන් උත්සාහ කරන්න',
        `• Year එක එකතු කරන්න — ${prefix}movie ${shown || 'Movie'} 2024`,
        '',
        `⚠️ Bot එකේ catalogue එකේ ඇති titles පමණක් direct download කළ හැක.`,
      ].join('\n');
    case 'NO_API_KEY':
      return [
        '⚙️ *Movie metadata not configured*',
        '',
        'Add to config.env:',
        'TMDB_API_KEY=your_key   (free: themoviedb.org/settings/api)',
        '',
        `Catalogue එකේ ඇති titles සඳහා ${prefix}movie තවම වැඩ කරයි.`,
      ].join('\n');
    case 'AUTH':
      return '🔑 *TMDB rejected the API key.* Get a fresh key at themoviedb.org/settings/api and update config.env.';
    case 'RATE_LIMIT':
      return '⏳ *Too many requests right now.* තත්පර කිහිපයකින් නැවත උත්සාහ කරන්න.';
    case 'TIMEOUT':
    case 'NETWORK':
      return '🌐 *Network problem* — metadata service එකට connect වෙන්න බැරි වුණා. නැවත උත්සාහ කරන්න.';
    case 'BLOCKED':
    case 'FORBIDDEN':
      return '🚫 *Source blocked the request.* පසුව නැවත උත්සාහ කරන්න, හෝ වෙනත් title එකක් try කරන්න.';
    case 'BUSY':
      return '⏳ *ඉතා දිගු පෝලිමක්.* තත්පර 30කින් නැවත උත්සාහ කරන්න.';
    case 'COOLDOWN':
      return '🐢 *Slow down a little.* තත්පර කිහිපයකින් නැවත උත්සාහ කරන්න.';
    default:
      return [
        '❌ *Movie search failed.*',
        '',
        'පසුව නැවත උත්සාහ කරන්න. දිගටම fail වෙනවා නම් bot logs පරීක්ෂා කරන්න.',
        `_code: ${code}_`,
      ].join('\n');
  }
}

module.exports = {
  deliverMovie,
  deliverLocalFile,
  downloadToTemp,
  probeRemote,
  pickOffer,
  formatMovieCard,
  formatFallback,
  humanBytes,
  humanCount,
  formatRuntime,
  safeFileName,
  LIMITS: { DOC_LIMIT, VIDEO_LIMIT },
};
