'use strict';
/**
 * Shared headless-browser pool for the bot.
 *
 * Why a pool and not "launch per command":
 *   - Chromium costs 100-200 MB RSS per instance. Launching one per request is
 *     how Railway containers hit OOM.
 *   - This module keeps ONE browser, one context per task, and closes the
 *     browser automatically after BROWSER_IDLE_MS of inactivity.
 *   - Every path (success, throw, timeout, disconnect) funnels through
 *     try/finally, so pages, contexts and the browser itself are always freed.
 *
 * Playwright is an *optional* dependency: if it is not installed the bot still
 * starts normally and only the commands that need a browser report an error.
 *
 *   npm i playwright
 *   npx playwright install --with-deps chromium
 *
 * Env:
 *   BROWSER_ENABLED=true            enable the pool
 *   BROWSER_IDLE_MS=60000           close Chromium after this much idle time
 *   BROWSER_MAX_CONCURRENCY=2       parallel pages
 *   BROWSER_TIMEOUT_MS=30000        navigation / selector default timeout
 *   BROWSER_BLOCK_MEDIA=true        abort images/fonts/media (saves RAM + data)
 *   BROWSER_NO_SANDBOX=false        set true only inside containers without userns
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
];

const DEFAULTS = {
  enabled: String(process.env.BROWSER_ENABLED || 'false') === 'true',
  idleMs: Number(process.env.BROWSER_IDLE_MS || 60000),
  maxConcurrency: Math.max(1, Number(process.env.BROWSER_MAX_CONCURRENCY || 2)),
  timeoutMs: Number(process.env.BROWSER_TIMEOUT_MS || 30000),
  blockMedia: String(process.env.BROWSER_BLOCK_MEDIA || 'true') === 'true',
  noSandbox: String(process.env.BROWSER_NO_SANDBOX || 'false') === 'true',
};

let playwright = null;
let playwrightLoadError = null;
try {
  // eslint-disable-next-line global-require
  playwright = require('playwright');
} catch (err) {
  playwrightLoadError = err;
}

let browserPromise = null;
let idleTimer = null;
let activeCount = 0;
const waiters = [];
let shuttingDown = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pickUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

function isEnabled() {
  return DEFAULTS.enabled && Boolean(playwright);
}

function unavailableReason() {
  if (!DEFAULTS.enabled) return 'BROWSER_ENABLED is not true';
  if (!playwright) return `playwright is not installed${playwrightLoadError ? ` (${playwrightLoadError.message})` : ''}`;
  return '';
}

/* ── Semaphore ─────────────────────────────────────────────────────────────── */
async function acquire() {
  if (activeCount < DEFAULTS.maxConcurrency) {
    activeCount += 1;
    return () => release();
  }
  await new Promise((resolve) => waiters.push(resolve));
  activeCount += 1;
  return () => release();
}

function release() {
  activeCount = Math.max(0, activeCount - 1);
  const next = waiters.shift();
  if (next) next();
  else scheduleIdleClose();
}

function scheduleIdleClose() {
  if (idleTimer) clearTimeout(idleTimer);
  if (activeCount > 0 || !browserPromise) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (activeCount === 0) closeBrowser().catch(() => {});
  }, DEFAULTS.idleMs);
  if (typeof idleTimer.unref === 'function') idleTimer.unref();
}

/* ── Browser lifecycle ─────────────────────────────────────────────────────── */
async function launch() {
  if (!playwright) throw new Error(unavailableReason() || 'playwright is not installed');
  const args = [
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
  ];
  if (DEFAULTS.noSandbox) args.push('--no-sandbox', '--disable-setuid-sandbox');

  const browser = await playwright.chromium.launch({ headless: true, args });
  browser.on('disconnected', () => {
    browserPromise = null;
    if (shuttingDown) return;
    console.warn('[browser] Chromium disconnected; it will be relaunched on demand');
  });
  return browser;
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = launch().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

/**
 * Close Chromium and free its memory. Safe to call any number of times.
 * @returns {Promise<boolean>} true when a browser was actually closed
 */
async function closeBrowser() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return false;
  shuttingDown = true;
  try {
    const browser = await pending;
    await Promise.race([
      browser.close(),
      sleep(10000).then(() => {
        throw new Error('browser close timed out');
      }),
    ]);
    return true;
  } catch (err) {
    console.error('[browser] close failed:', err.message);
    return false;
  } finally {
    shuttingDown = false;
  }
}

/* ── Per-task page ─────────────────────────────────────────────────────────── */
async function newContext(browser, options = {}) {
  const context = await browser.newContext({
    userAgent: pickUserAgent(),
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: process.env.BROWSER_TIMEZONE || 'Asia/Colombo',
    ignoreHTTPSErrors: false,
    javaScriptEnabled: true,
    // Downloads are opt-in per task; harmless when unused.
    acceptDownloads: options.acceptDownloads !== false,
  });
  context.setDefaultTimeout(DEFAULTS.timeoutMs);
  context.setDefaultNavigationTimeout(DEFAULTS.timeoutMs);
  return context;
}

async function applyBlocking(page, blockMedia) {
  if (!blockMedia) return;
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'media' || type === 'font') return route.abort();
    return route.continue();
  });
}

/**
 * Run a callback with a fresh page, then always release everything.
 *
 * @template T
 * @param {(page: import('playwright').Page, context: import('playwright').BrowserContext) => Promise<T>} fn
 * @param {{label?:string, blockMedia?:boolean, timeoutMs?:number, acceptDownloads?:boolean}} [options]
 * @returns {Promise<T>}
 */
async function withPage(fn, options = {}) {
  if (!isEnabled()) throw new Error(unavailableReason() || 'Browser is disabled');

  const releaseSlot = await acquire();
  let context = null;
  const timeoutMs = Number(options.timeoutMs) || DEFAULTS.timeoutMs;

  try {
    const browser = await getBrowser();
    context = await newContext(browser, options);
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);

    // Never let a page eat the whole event loop budget.
    const guard = setTimeout(() => {
      page.close().catch(() => {});
    }, Math.max(timeoutMs * 4, 60000));
    if (typeof guard.unref === 'function') guard.unref();

    try {
      await applyBlocking(page, options.blockMedia !== undefined ? options.blockMedia : DEFAULTS.blockMedia);
      return await fn(page, context);
    } finally {
      clearTimeout(guard);
    }
  } catch (err) {
    if (/Target closed|browser has been closed|Browser closed/i.test(err.message || '')) {
      browserPromise = null;
    }
    throw err;
  } finally {
    if (context) await context.close().catch(() => {});
    releaseSlot();
    scheduleIdleClose();
  }
}

/** Convenience: open a URL and return rendered HTML. */
async function fetchRenderedHtml(url, options = {}) {
  return withPage(
    async (page) => {
      const res = await page.goto(url, { waitUntil: options.waitUntil || 'domcontentloaded' });
      if (options.waitForSelector) await page.waitForSelector(options.waitForSelector, { timeout: options.timeoutMs });
      return {
        ok: true,
        status: res ? res.status() : 0,
        finalUrl: page.url(),
        html: await page.content(),
      };
    },
    options
  );
}

function stats() {
  return {
    enabled: isEnabled(),
    running: Boolean(browserPromise),
    activePages: activeCount,
    queued: waiters.length,
    maxConcurrency: DEFAULTS.maxConcurrency,
    idleMs: DEFAULTS.idleMs,
  };
}

module.exports = {
  withPage,
  closeBrowser,
  fetchRenderedHtml,
  isEnabled,
  unavailableReason,
  stats,
  USER_AGENTS,
};
