'use strict';
/**
 * Playwright-driven download engine (config driven, host allowlisted).
 *
 * What it does
 *   1. opens a source you configured (data/download-sources.json)
 *   2. searches, picks the best matching result, opens the detail page
 *   3. clicks the download control and captures Playwright's `download` event
 *   4. streams the file into os.tmpdir() with a hard byte ceiling
 *
 * What it deliberately does NOT do
 *   - follow redirect/shortlink/ad-gateway chains to find a file
 *   - solve captchas, click ads, or read obfuscated JS payloads
 *   - talk to any host that is not in `allowedHosts`
 *
 * If the file does not start downloading from an allowlisted host, the module
 * reports a clear error instead of trying harder. That is the safety boundary:
 * it automates a site's own UI, nothing more.
 *
 * Env:
 *   PLAYWRIGHT_DOWNLOAD_ENABLED=true    master switch (default false)
 *   PDL_CONFIG=./data/download-sources.json
 *   PDL_SOURCE=my-catalogue            default source name
 *   PDL_MAX_BYTES=1900000000           hard ceiling per file
 *   PDL_MAX_CONCURRENT=2               parallel downloads
 *   PDL_DOWNLOAD_START_MS=30000        wait for the download event
 *   PDL_NAV_TIMEOUT_MS=30000
 *   PDL_TOTAL_TIMEOUT_MS=300000
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

const browser = require('./browser');
const { similarity } = require('./movieProvider');

const CONFIG_PATH = process.env.PDL_CONFIG || path.join(__dirname, '..', 'data', 'download-sources.json');
const MAX_BYTES = Math.min(Number(process.env.PDL_MAX_BYTES || 1900000000), 2 * 1000 * 1000 * 1000);
const MAX_CONCURRENT = Math.max(1, Number(process.env.PDL_MAX_CONCURRENT || 2));
const START_MS = Number(process.env.PDL_DOWNLOAD_START_MS || 30000);
const NAV_MS = Number(process.env.PDL_NAV_TIMEOUT_MS || 30000);
const TOTAL_MS = Number(process.env.PDL_TOTAL_TIMEOUT_MS || 300000);
const UA =
  process.env.MOVIE_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

class PdlError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PdlError';
    this.code = code;
  }
}

const fail = (err) => ({
  ok: false,
  error: { code: (err && err.code) || 'ERROR', message: (err && err.message) || String(err) },
});

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/* ── config ────────────────────────────────────────────────────────────────── */
let cached = { mtime: 0, config: null };

function loadConfig() {
  let stat;
  try {
    stat = fs.statSync(CONFIG_PATH);
  } catch {
    return null;
  }
  if (cached.config && cached.mtime === stat.mtimeMs) return cached.config;

  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!raw || raw.enabled !== true) {
      cached = { mtime: stat.mtimeMs, config: null };
      return null;
    }
    const hosts = (Array.isArray(raw.allowedHosts) ? raw.allowedHosts : [])
      .map((h) => String(h || '').trim().toLowerCase().replace(/^\./, ''))
      .filter((h) => /^[a-z0-9.-]+$/.test(h));
    if (!hosts.length) throw new Error('allowedHosts is empty');

    const sources = {};
    for (const [name, src] of Object.entries(raw.sources || {})) {
      if (!src || src.enabled === false) continue;
      if (!src.searchUrl || !src.resultSelector || !src.downloadSelector) continue;
      sources[name] = {
        name,
        label: clean(src.label || name),
        searchUrl: String(src.searchUrl),
        inputSelector: src.inputSelector || '',
        submitSelector: src.submitSelector || '',
        resultSelector: String(src.resultSelector),
        downloadSelector: String(src.downloadSelector),
        titleSelector: (src.detail && src.detail.title) || '',
        waitForSelector: src.waitForSelector || '',
        quality: clean(src.quality || ''),
      };
    }

    const config = { enabled: true, allowedHosts: hosts, sources, defaultSource: raw.defaultSource || null };
    cached = { mtime: stat.mtimeMs, config };
    return config;
  } catch (err) {
    console.error('[pdl] config error:', err.message);
    cached = { mtime: stat.mtimeMs, config: null };
    return null;
  }
}

function isEnabled() {
  return String(process.env.PLAYWRIGHT_DOWNLOAD_ENABLED || 'false') === 'true' && Boolean(loadConfig());
}

function listSources() {
  const cfg = loadConfig();
  return cfg ? Object.values(cfg.sources).map((s) => ({ name: s.name, label: s.label })) : [];
}

function defaultSourceName() {
  const cfg = loadConfig();
  if (!cfg) return null;
  if (process.env.PDL_SOURCE && cfg.sources[process.env.PDL_SOURCE]) return process.env.PDL_SOURCE;
  if (cfg.defaultSource && cfg.sources[cfg.defaultSource]) return cfg.defaultSource;
  const names = Object.keys(cfg.sources);
  return names.length === 1 ? names[0] : names[0] || null;
}

/* ── safety: host allowlist ────────────────────────────────────────────────── */
function hostAllowed(rawUrl, allowedHosts) {
  let u;
  try {
    u = new URL(String(rawUrl));
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
}

function assertAllowed(rawUrl, allowedHosts, what = 'URL') {
  if (!hostAllowed(rawUrl, allowedHosts)) {
    let host = '';
    try {
      host = new URL(String(rawUrl)).hostname;
    } catch {
      host = String(rawUrl).slice(0, 80);
    }
    throw new PdlError('HOST_NOT_ALLOWED', `${what} leaves the allowlist (${host}). Add it to allowedHosts if it is yours.`);
  }
  return rawUrl;
}

/* ── fuzzy result picking ──────────────────────────────────────────────────── */
function pickResult(results, query) {
  if (!Array.isArray(results) || !results.length) return null;
  const ranked = results
    .map((r) => ({ r, score: similarity(query, r.title || '') }))
    .sort((a, b) => b.score - a.score);
  return ranked[0] && ranked[0].score >= 0.3 ? ranked[0].r : null;
}

/* ── concurrency ───────────────────────────────────────────────────────────── */
let active = 0;
const waiters = [];

async function acquire() {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return () => release();
  }
  await new Promise((resolve) => waiters.push(resolve));
  active += 1;
  return () => release();
}

function release() {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

/* ── helpers ───────────────────────────────────────────────────────────────── */
function safeFileName(name, fallback = 'download.bin') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
  return cleaned || fallback;
}

function extensionOf(name) {
  const m = String(name || '').match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : '';
}

/** Stream a Playwright download to disk with a hard byte ceiling. */
async function saveDownload(download, dir, fileName, timeoutMs, onCancelRef) {
  const dest = path.join(dir, fileName);
  let written = 0;

  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      written += chunk.length;
      if (written > MAX_BYTES) {
        cb(new PdlError('TOO_LARGE', `Download exceeded ${(MAX_BYTES / 1024 ** 3).toFixed(2)} GiB`));
        return;
      }
      cb(null, chunk);
    },
  });

  const timer = setTimeout(() => {
    download.cancel().catch(() => {});
  }, timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  if (onCancelRef) onCancelRef.cancel = () => download.cancel().catch(() => {});

  try {
    let stream;
    try {
      stream = await download.createReadStream();
    } catch {
      stream = null;
    }

    if (stream) {
      await pipeline(stream, limiter, fs.createWriteStream(dest));
    } else {
      // Older Playwright: no read stream. Save first, then enforce the cap.
      await download.saveAs(dest);
      written = fs.statSync(dest).size;
      if (written > MAX_BYTES) {
        fs.rmSync(dest, { force: true });
        throw new PdlError('TOO_LARGE', `File is larger than ${(MAX_BYTES / 1024 ** 3).toFixed(2)} GiB`);
      }
    }

    const failure = await download.failure();
    if (failure) throw new PdlError('DOWNLOAD_FAILED', `Browser reported: ${failure}`);
    if (!written) throw new PdlError('EMPTY_FILE', 'The browser saved an empty file');

    return { file: dest, size: written };
  } finally {
    clearTimeout(timer);
    if (onCancelRef) delete onCancelRef.cancel;
  }
}

/* ── main entry ────────────────────────────────────────────────────────────── */
/**
 * Search a configured source and download the best match through its own UI.
 *
 * @param {string} query
 * @param {{source?:string, fileName?:string, quality?:string}} [options]
 * @returns {Promise<{ok:true,file:string,dir:string,size:number,source:string,title:string,finalUrl:string}
 *                  |{ok:false,error:{code:string,message:string}}>}
 */
async function downloadByQuery(query, options = {}) {
  const q = clean(query);
  if (!q) return fail(new PdlError('BAD_QUERY', 'Empty query'));

  if (!isEnabled()) {
    return fail(
      new PdlError(
        'DISABLED',
        String(process.env.PLAYWRIGHT_DOWNLOAD_ENABLED || 'false') !== 'true'
          ? 'PLAYWRIGHT_DOWNLOAD_ENABLED is not true'
          : `No enabled source in ${path.basename(CONFIG_PATH)}`
      )
    );
  }
  if (!browser.isEnabled()) return fail(new PdlError('DISABLED', browser.unavailableReason() || 'Browser unavailable'));

  const cfg = loadConfig();
  const sourceName = options.source || defaultSourceName();
  const source = sourceName && cfg.sources[sourceName];
  if (!source) return fail(new PdlError('NO_SOURCE', `Unknown source "${sourceName || '(none)'}"`));

  const releaseSlot = await acquire();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'danuwa-pdl-'));
  const cancelRef = {};
  let settled = false;
  let work = null;

  try {
    assertAllowed(source.searchUrl, cfg.allowedHosts, 'searchUrl');

    work = (async () => {
      let download = null;

      const result = await browser.withPage(
        async (page, context) => {
          page.setDefaultTimeout(NAV_MS);
          page.setDefaultNavigationTimeout(NAV_MS);

          const searchUrl = source.searchUrl.includes('{q}')
            ? source.searchUrl.replace('{q}', encodeURIComponent(q))
            : source.searchUrl;

          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: NAV_MS });

          if (source.inputSelector && !source.searchUrl.includes('{q}')) {
            await page.fill(source.inputSelector, q);
            const submitted = source.submitSelector
              ? page.click(source.submitSelector)
              : page.press(source.inputSelector, 'Enter');
            await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), submitted]);
          }

          await page.waitForSelector(source.resultSelector, { timeout: NAV_MS });

          const results = await page.$$eval(
            source.resultSelector,
            (els, base) =>
              els
                .slice(0, 25)
                .map((el) => ({
                  title: (el.textContent || '').replace(/\s+/g, ' ').trim(),
                  url: el.href || (base ? new URL(el.getAttribute('href') || '', base).toString() : ''),
                }))
                .filter((r) => r.url && /^https?:/i.test(r.url)),
            source.searchUrl
          );

          const best = pickResult(results, q);
          if (!best) throw new PdlError('NO_RESULTS', `No result matched "${q}" on ${source.name}`);

          assertAllowed(best.url, cfg.allowedHosts, 'result URL');
          await page.goto(best.url, { waitUntil: 'domcontentloaded', timeout: NAV_MS });

          if (source.waitForSelector) {
            await page.waitForSelector(source.waitForSelector, { timeout: NAV_MS }).catch(() => {});
          }

          let title = best.title;
          if (source.titleSelector) {
            title = clean(await page.$eval(source.titleSelector, (el) => el.textContent || '').catch(() => '')) || title;
          }

          // Attach the listener before clicking: the download may start instantly.
          const downloadPromise = new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new PdlError('DOWNLOAD_TIMEOUT', `No download started within ${START_MS}ms`)),
              START_MS
            );
            if (typeof timer.unref === 'function') timer.unref();
            const onDownload = (d) => {
              clearTimeout(timer);
              resolve(d);
            };
            page.once('download', onDownload);
            // Some sites open the file in a popup/tab instead of the same page.
            context.on('page', (p) => p.once('download', onDownload));
          });

          let clickError = null;
          await page.click(source.downloadSelector, { timeout: NAV_MS }).catch((err) => {
            // A click can legitimately throw after the download already began.
            if (!/Target closed|navigation/i.test(err.message || '')) {
              clickError = new PdlError('NO_DOWNLOAD_BUTTON', `Could not click download control: ${err.message}`);
            }
          });
          if (clickError) {
            downloadPromise.catch(() => {});
            throw clickError;
          }

          download = await downloadPromise;

          // A blob:/data: download has no http URL of its own; verify the page
          // that triggered it instead.
          const dlUrl = download.url();
          if (/^https?:/i.test(dlUrl)) assertAllowed(dlUrl, cfg.allowedHosts, 'download URL');
          else assertAllowed(page.url(), cfg.allowedHosts, 'page URL');

          const suggested = safeFileName(
            options.fileName || download.suggestedFilename() || `${q}.${extensionOf(best.url) || 'bin'}`,
            `${q}.bin`
          );

          const saved = await saveDownload(download, dir, suggested, TOTAL_MS, cancelRef);
          return { title, finalUrl: best.url, saved, suggested, pageUrl: page.url() };
        },
        { acceptDownloads: true, blockMedia: true, timeoutMs: NAV_MS, label: 'pdl' }
      );

      settled = true;
      return {
        ok: true,
        file: result.saved.file,
        dir,
        size: result.saved.size,
        source: source.name,
        title: result.title,
        finalUrl: result.pageUrl || result.finalUrl,
      };
    })();

    // Overall watchdog: cancel the download if the whole job stalls.
    let timer;
    const watchdog = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (typeof cancelRef.cancel === 'function') cancelRef.cancel();
        reject(new PdlError('TIMEOUT', `Job exceeded ${Math.round(TOTAL_MS / 1000)}s`));
      }, TOTAL_MS);
      if (typeof timer.unref === 'function') timer.unref();
    });

    try {
      return await Promise.race([work, watchdog]);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (!(err instanceof PdlError)) console.error('[pdl]', err.stack || err.message);
    return fail(err);
  } finally {
    releaseSlot();
    // Success: the caller owns `dir` and deletes it after sending.
    // Failure/timeout: clean up once the worker has actually stopped, so we
    // never delete a directory a still-unwinding stream is writing into.
    if (!settled && work) workCleanup(work, dir);
  }
}

function workCleanup(work, dir) {
  work
    .catch(() => {})
    .finally(() => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    });
}

function stats() {
  return {
    enabled: isEnabled(),
    active,
    queued: waiters.length,
    maxConcurrent: MAX_CONCURRENT,
    maxBytes: MAX_BYTES,
    sources: listSources().map((s) => s.name),
    browser: browser.stats(),
  };
}

module.exports = {
  downloadByQuery,
  isEnabled,
  listSources,
  defaultSourceName,
  loadConfig,
  hostAllowed,
  pickResult,
  stats,
  PdlError,
  LIMITS: { MAX_BYTES, MAX_CONCURRENT, START_MS, NAV_MS, TOTAL_MS },
};
