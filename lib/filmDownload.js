'use strict';
/**
 * Film download job manager.
 *
 * Downloads run on the bot host (local Windows or a cloud container/volume),
 * never through a PC bridge. The file is streamed to disk, optionally resumed
 * from a `.part` file, then handed to the WhatsApp plugin for document upload.
 *
 * Env:
 *   FILM_DOWNLOAD_DIR          default <STORAGE_DIR>/data/films
 *   FILM_MAX_BYTES             default 1.9 GB (WhatsApp's practical ceiling)
 *   FILM_MAX_CONCURRENT        default 2
 *   FILM_DELETE_AFTER_SEND     default true
 *   FILM_DELETE_PARTIAL_ON_CANCEL default true
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Readable } = require('stream');
const { once } = require('events');
const { formatBytes, parseContentRange } = require('./filmSource');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const jobs = new Map();       // active/queued/sending
const finished = new Map();   // terminal results for `.movie status`
let activeCount = 0;
let sequence = 0;

function rootDir() {
  return process.env.STORAGE_DIR || path.join(__dirname, '..');
}
function outDir() {
  return process.env.FILM_DOWNLOAD_DIR || path.join(rootDir(), 'data', 'films');
}
function maxBytes() {
  return Math.max(1024 * 1024, Number(process.env.FILM_MAX_BYTES || 1900000000));
}
function maxConcurrent() {
  return Math.max(1, Number(process.env.FILM_MAX_CONCURRENT || 2));
}
function deleteAfterSend() {
  return String(process.env.FILM_DELETE_AFTER_SEND || 'true').toLowerCase() !== 'false';
}
function deletePartialOnCancel() {
  return String(process.env.FILM_DELETE_PARTIAL_ON_CANCEL || 'true').toLowerCase() !== 'false';
}

function key(accountId, chatId) {
  return `${accountId || 'default'}:${chatId || ''}`;
}

function coded(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function safeFileName(title) {
  return String(title || 'film')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120) || 'film';
}

/** Stable per chat+title suffix: retries resume, different chats never collide. */
function fileKey(accountId, chatId) {
  return crypto.createHash('sha1')
    .update(`${accountId || 'default'}:${chatId || ''}`)
    .digest('hex')
    .slice(0, 10);
}

function freeBytes(dir) {
  try {
    if (typeof fs.statfsSync !== 'function') return null;
    const stats = fs.statfsSync(dir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

/** Throws NO_SPACE unless `dir` can hold `bytes` plus a safety margin. */
function ensureSpace(dir, bytes) {
  const free = freeBytes(dir);
  if (free == null) return;
  const need = (Number(bytes) || 0) + 200 * 1024 * 1024;
  if (free < need) {
    throw coded('NO_SPACE', `Not enough disk space in ${dir} (${formatBytes(free)} free, need ${formatBytes(need)})`);
  }
}

function checkDiskSpace(dir, expected) {
  // A film needs the download AND Baileys' encrypted temporary copy at the
  // same time, so reserve roughly twice the file size.
  ensureSpace(dir, (Number(expected) || 0) * 2);
}

function startJob({
  accountId = 'default', chatId, sender = '', query = '', title = '',
  quality = '', url, expectedBytes = 0, onComplete, onError, onProgress,
} = {}) {
  if (!chatId) throw coded('BAD_TARGET', 'chatId is required');
  if (!url) throw coded('BAD_URL', 'url is required');

  const k = key(accountId, chatId);
  const current = jobs.get(k);
  if (current && ['queued', 'downloading', 'sending'].includes(current.status)) {
    throw coded('BUSY', 'මේ chat එකේ දැනටමත් film download එකක් යනවා');
  }
  if (activeCount >= maxConcurrent()) {
    throw coded('BUSY_GLOBAL', `දැනට download ${activeCount}ක් යනවා. ටිකකින් try කරන්න`);
  }

  const expected = Number(expectedBytes) || 0;
  if (expected > maxBytes()) {
    throw coded('TOO_LARGE', `File එක WhatsApp limit එකට වඩා ලොකුයි (${formatBytes(expected)})`);
  }

  const dir = outDir();
  fs.mkdirSync(dir, { recursive: true });
  checkDiskSpace(dir, expected);
  // Baileys encrypts the outgoing document into os.tmpdir(), so that mount
  // needs room for one extra copy too.
  ensureSpace(os.tmpdir(), expected);

  const file = path.join(dir, `${safeFileName(title)}-${quality || 'film'}-${fileKey(accountId, chatId)}.mp4`);
  const job = {
    id: `${Date.now().toString(36)}-${(++sequence).toString(36)}`,
    accountId, chatId, sender, query, title, quality, url,
    expected, bytes: 0,
    file, partFile: `${file}.part`,
    status: 'queued', error: '',
    createdAt: Date.now(), startedAt: 0, updatedAt: Date.now(), completedAt: 0,
    abort: new AbortController(),
    onComplete, onError, onProgress,
  };

  jobs.set(k, job);
  activeCount += 1;
  setImmediate(() => run(job));
  return job;
}

async function finishFile(job) {
  await fsp.rm(job.file, { force: true }).catch(() => {});
  await fsp.rename(job.partFile, job.file);
  const stat = await fsp.stat(job.file);
  job.bytes = stat.size;
  job.expected = job.expected || stat.size;
}

async function download(job) {
  let have = 0;
  try { have = (await fsp.stat(job.partFile)).size; } catch { have = 0; }
  if (job.expected && have >= job.expected) {
    await finishFile(job);
    return;
  }

  const headers = { 'User-Agent': UA };
  if (have > 0) headers.Range = `bytes=${have}-`;

  const res = await fetch(job.url, { headers, redirect: 'follow', signal: job.abort.signal });
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} while downloading`);
  const type = res.headers.get('content-type') || '';
  if (/text\/html/i.test(type)) throw new Error('Server returned an HTML page instead of a video');

  let total = job.expected || parseContentRange(res.headers.get('content-range') || '') || 0;
  if (!total && res.status === 200) total = Number(res.headers.get('content-length') || 0) || 0;
  if (total > maxBytes()) throw coded('TOO_LARGE', `File too large (${formatBytes(total)})`);

  // Server ignored our Range request: start over instead of appending garbage.
  if (res.status === 200 && have > 0) have = 0;

  job.expected = total;
  job.bytes = have;

  const out = fs.createWriteStream(job.partFile, { flags: have > 0 ? 'a' : 'w' });
  let lastTick = 0;
  try {
    if (!res.body) throw new Error('Empty response body');
    const body = Readable.fromWeb(res.body);
    for await (const chunk of body) {
      if (job.abort.signal.aborted) throw new Error('Cancelled');
      if (!out.write(chunk)) await once(out, 'drain');
      job.bytes += chunk.length;
      job.updatedAt = Date.now();
      if (job.bytes > maxBytes()) throw coded('TOO_LARGE', 'File exceeded the configured limit');
      const now = Date.now();
      if (now - lastTick > 1000) {
        lastTick = now;
        if (typeof job.onProgress === 'function') {
          try { job.onProgress(job); } catch { /* ignore */ }
        }
      }
    }
    await new Promise((resolve, reject) => {
      out.end(resolve);
      out.on('error', reject);
    });
  } catch (err) {
    out.destroy();
    throw err;
  }

  const size = (await fsp.stat(job.partFile)).size;
  if (job.expected && size < job.expected) {
    throw new Error(`Download incomplete (${formatBytes(size)} / ${formatBytes(job.expected)})`);
  }
  await finishFile(job);
}

async function run(job) {
  try {
    job.status = 'downloading';
    job.startedAt = Date.now();
    await download(job);
    job.status = 'sending';
    job.updatedAt = Date.now();
    if (typeof job.onComplete === 'function') await job.onComplete(job);
    job.status = 'done';
    job.completedAt = Date.now();
  } catch (err) {
    if (job.abort.signal.aborted) {
      job.status = 'cancelled';
      job.error = 'Cancelled';
    } else {
      job.status = 'failed';
      job.error = err?.message || String(err);
    }
    try { if (typeof job.onError === 'function') await job.onError(job); } catch { /* ignore */ }
  } finally {
    job.updatedAt = Date.now();
    activeCount = Math.max(0, activeCount - 1);
    jobs.delete(key(job.accountId, job.chatId));
    remember(job);
  }
}

function remember(job) {
  const k = key(job.accountId, job.chatId);
  finished.set(k, job);
  if (finished.size <= 100) return;
  const oldest = [...finished.entries()]
    .sort((a, b) => (a[1].updatedAt || 0) - (b[1].updatedAt || 0))
    .slice(0, finished.size - 100);
  for (const [entry] of oldest) finished.delete(entry);
}

function status(accountId, chatId) {
  const k = key(accountId, chatId);
  return jobs.get(k) || finished.get(k) || null;
}

function getActive(accountId, chatId) {
  return jobs.get(key(accountId, chatId)) || null;
}

function cancel(accountId, chatId) {
  const job = getActive(accountId, chatId);
  if (!job) return null;
  if (job.status === 'sending') {
    const err = coded('SENDING', 'Document එක දැනටමත් WhatsApp එකට යවනවා; cancel කරන්න බෑ');
    err.job = job;
    throw err;
  }
  job.abort.abort();
  job.status = 'cancelled';
  job.updatedAt = Date.now();
  if (deletePartialOnCancel()) {
    fsp.rm(job.partFile, { force: true }).catch(() => {});
  }
  return job;
}

async function removeFile(job) {
  await fsp.rm(job.file, { force: true }).catch(() => {});
  await fsp.rm(job.partFile, { force: true }).catch(() => {});
  job.fileDeleted = true;
}

function speedBytesPerSecond(job) {
  const elapsed = Math.max(1, (Date.now() - (job.startedAt || Date.now())) / 1000);
  return Math.max(0, job.bytes / elapsed);
}

function describe(job) {
  if (!job) {
    return [
      '📊 *Film download status*',
      '',
      'දැනට active download එකක් නෑ.',
      'නව film එකක් සඳහා: *.movie <film name>*',
    ].join('\n');
  }

  const title = job.title || job.query || 'Film';
  if (job.status === 'queued') {
    return `🕒 *${title}*\n\nDownload එක queue එකේ තියෙනවා…`;
  }
  if (job.status === 'downloading') {
    const pct = job.expected ? Math.min(100, (job.bytes / job.expected) * 100) : null;
    const speed = speedBytesPerSecond(job);
    const eta = job.expected && speed > 0 ? Math.max(0, (job.expected - job.bytes) / speed) : 0;
    return [
      `⬇️ *${title}*`,
      `📺 ${job.quality || '?'}`,
      '',
      pct == null ? `📦 ${formatBytes(job.bytes)}` : `📊 ${pct.toFixed(1)}%`,
      job.expected
        ? `📦 ${formatBytes(job.bytes)} / ${formatBytes(job.expected)}`
        : `📦 ${formatBytes(job.bytes)}`,
      speed > 0 ? `⚡ ${formatBytes(speed)}/s` : '',
      eta > 0 ? `⏱️ තව ~${formatDuration(eta)}` : '',
      '',
      `❌ Cancel: *.movie cancel*`,
    ].filter(Boolean).join('\n');
  }
  if (job.status === 'sending') {
    return `📤 *${title}*\n\nDownload ඉවරයි. දැන් WhatsApp document එකක් විදිහට යවනවා…`;
  }
  if (job.status === 'done') {
    return [
      `✅ *${title}*`,
      `📺 ${job.quality || '?'} • 📦 ${formatBytes(job.bytes)}`,
      job.fileDeleted ? '🗑️ Cloud file එක delete කළා.' : '📁 Cloud file එක තියෙනවා.',
    ].join('\n');
  }
  if (job.status === 'failed') {
    if (job.sendError) {
      return [
        `⚠️ *${title}* download එක ඉවරයි, ඒත් WhatsApp document එක යැව්වේ නෑ.`,
        `📝 ${job.sendError}`,
        `📦 ${formatBytes(job.bytes)}`,
        '',
        'File එක cloud එකේ තියෙනවා. නැවත යවන්න: *.movie send*',
      ].join('\n');
    }
    return [
      `❌ *${title}* download එක fail වුණා.`,
      job.error ? `📝 ${job.error}` : '',
      '',
      'නැවත try කරන්න: *.movie <film name>*',
    ].filter(Boolean).join('\n');
  }
  if (job.status === 'cancelled') {
    return `⏹️ *${title}* download එක cancel කළා.`;
  }
  return `📊 ${title}: ${job.status}`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function stats() {
  return {
    active: activeCount,
    maxConcurrent: maxConcurrent(),
    activeJobs: [...jobs.values()].map(job => ({
      title: job.title, quality: job.quality, status: job.status,
      bytes: job.bytes, expected: job.expected,
    })),
    dir: outDir(),
    maxBytes: maxBytes(),
    deleteAfterSend: deleteAfterSend(),
  };
}

module.exports = {
  outDir,
  maxBytes,
  maxConcurrent,
  deleteAfterSend,
  safeFileName,
  fileKey,
  freeBytes,
  ensureSpace,
  startJob,
  status,
  getActive,
  cancel,
  removeFile,
  describe,
  formatDuration,
  speedBytesPerSecond,
  stats,
  _jobs: jobs,
  _finished: finished,
};
