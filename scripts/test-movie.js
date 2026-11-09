'use strict';
/**
 * Offline smoke test for the .movie feature. No network, no WhatsApp.
 *   node scripts/test-movie.js
 *
 * `command.js` belongs to the bot, so the test injects a tiny stub with the
 * same contract (cmd() + commands[]) instead of copying the real file here.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const Module = require('module');

// Configure before requiring the modules (they read env at load time).
// Prefer the real catalogue, fall back to the shipped example.
const catalogCandidates = ['data/movies.json', 'data/movies.example.json']
  .map((p) => path.join(__dirname, '..', p))
  .filter((p) => fs.existsSync(p));
if (!catalogCandidates.length) throw new Error('No data/movies.json or data/movies.example.json found');
process.env.MOVIE_CATALOG_PATH = catalogCandidates[0];
process.env.MOVIE_PROVIDERS = 'catalog,tmdb';
process.env.MOVIE_COOLDOWN_MS = '0';
process.env.MOVIE_AUTO_SEND_MEDIA = 'false';
process.env.MOVIE_SEND_POSTER = 'false'; // keep the smoke test offline
process.env.PDL_CONFIG = path.join(__dirname, '..', 'data', 'download-sources.example.json');
delete process.env.PLAYWRIGHT_DOWNLOAD_ENABLED;
delete process.env.TMDB_API_KEY;
delete process.env.TMDB_ACCESS_TOKEN;
delete process.env.BROWSER_ENABLED;

/* ── tiny command.js stub ──────────────────────────────────────────────────── */
const registry = [];
const commandStub = {
  cmd(info, fn) {
    const data = { ...info, function: fn };
    registry.push(data);
    return data;
  },
  commands: registry,
  replyHandlers: [],
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '../command' && parent && /[\\/]plugins[\\/]/.test(parent.filename)) return commandStub;
  return originalLoad.call(this, request, parent, isMain);
};

const provider = require('../lib/movieProvider');
const delivery = require('../lib/mediaDelivery');
const browser = require('../lib/browser');

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(` FAIL ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  console.log('\nmovieProvider');

  await check('normalizeTitle strips year, punctuation and noise', () => {
    assert.strictEqual(provider.normalizeTitle('Dune: Part Two (2024) Sinhala Subtitles'), 'dune part two');
  });

  await check('similarity ranks exact above partial', () => {
    const exact = provider.similarity('Dune Part Two', 'Dune Part Two');
    const partial = provider.similarity('Dune Part Two', 'Dune');
    assert.ok(exact > partial, `${exact} should exceed ${partial}`);
  });

  await check('splitQuery extracts the year', () => {
    assert.deepStrictEqual(provider.splitQuery('Dune 2021'), { title: 'Dune', year: 2021 });
    assert.strictEqual(provider.splitQuery('Dune').year, null);
  });

  await check('catalogue loads and matches an alias', () => {
    const movies = provider.loadCatalog();
    assert.strictEqual(movies.length, 2);
    const hit = provider.searchCatalog('sintel');
    assert.strictEqual(hit.title, 'Sintel');
  });

  await check('catalogue rejects unknown titles', () => {
    assert.throws(() => provider.searchCatalog('a title that is not in the catalogue'), /No catalogue match/);
  });

  const ok = await provider.searchMovie('Sintel');
  await check('searchMovie returns a catalogue hit without a TMDB key', () => {
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.movie.title, 'Sintel');
    assert.ok(ok.movie.offers.length >= 1);
    assert.strictEqual(ok.movie.offers[0].type, 'direct');
  });

  const empty = await provider.searchMovie('   ');
  await check('empty query fails with BAD_QUERY', () => {
    assert.strictEqual(empty.ok, false);
    assert.strictEqual(empty.error.code, 'BAD_QUERY');
  });

  console.log('\nmediaDelivery');

  await check('humanBytes / formatRuntime', () => {
    assert.strictEqual(delivery.humanBytes(158008374), '151 MB');
    assert.strictEqual(delivery.formatRuntime(132), '2h 12m');
    assert.strictEqual(delivery.formatRuntime(9), '9m');
  });

  await check('pickOffer prefers the requested quality', () => {
    const offers = [
      { quality: '720p', url: 'https://a/720.mp4', sizeBytes: 100, type: 'direct' },
      { quality: '1080p', url: 'https://a/1080.mp4', sizeBytes: 200, type: 'direct' },
      { quality: '4k', url: 'https://a/page', type: 'page' },
    ];
    assert.strictEqual(delivery.pickOffer(offers, '720p').quality, '720p');
    assert.strictEqual(delivery.pickOffer(offers, '').quality, '1080p');
    assert.strictEqual(delivery.pickOffer([offers[2]], ''), null);
  });

  await check('formatMovieCard renders title, quality, link and rating', () => {
    const card = delivery.formatMovieCard(ok.movie, { prefix: '.', requested: 'sintel' });
    assert.ok(card.includes('Sintel'));
    assert.ok(card.includes('1080p'));
    assert.ok(card.includes('https://download.blender.org'));
    assert.ok(!card.includes('undefined'));
    assert.ok(card.length < 4000);
  });

  await check('formatMovieCard explains when no offer exists', () => {
    const card = delivery.formatMovieCard(
      {
        title: 'Some Film',
        year: 2024,
        rating: 7.1,
        synopsis: 'x',
        offers: [],
        whereToWatch: [{ name: 'Netflix', url: 'https://netflix.com' }],
      },
      { prefix: '.' }
    );
    assert.ok(card.includes('No direct download'));
    assert.ok(card.includes('Netflix'));
  });

  await check('every fallback code produces a non-empty message', () => {
    const codes = ['BAD_QUERY', 'NO_RESULTS', 'NO_API_KEY', 'AUTH', 'RATE_LIMIT', 'TIMEOUT', 'NETWORK', 'BLOCKED', 'BUSY', 'COOLDOWN', 'WHATEVER'];
    for (const code of codes) {
      const msg = delivery.formatFallback({ code }, { query: 'Dune' });
      assert.ok(typeof msg === 'string' && msg.length > 10, code);
    }
  });

  const noOffer = await delivery.deliverMovie({ sendMessage: async () => {} }, 'jid', { title: 'x', offers: [] });
  await check('deliverMovie short-circuits when there is no offer', () => {
    assert.deepStrictEqual({ ok: noOffer.ok, reason: noOffer.reason }, { ok: false, reason: 'NO_OFFER' });
  });

  console.log('\nbrowser');

  await check('browser pool is disabled without BROWSER_ENABLED', () => {
    assert.strictEqual(browser.isEnabled(), false);
    assert.ok(browser.unavailableReason().length > 0);
  });

  let rejected = false;
  try {
    await browser.withPage(async () => {});
  } catch {
    rejected = true;
  }
  await check('withPage rejects instead of crashing when disabled', () => assert.ok(rejected));

  // ---------------------------------------------------------------- integration
  console.log('\nintegration (fake socket)');

  const replies = [];
  const ctx = {
    from: '94700000000@s.whatsapp.net',
    sender: '94700000000@s.whatsapp.net',
    accountId: 'test',
    isGroup: false,
    q: '',
    body: '.movie',
    prefix: '.',
    quoted: { key: { id: 'q' } },
    reply: async (text) => {
      replies.push(text);
    },
  };
  const sock = { user: { id: '94700000000@s.whatsapp.net' }, sendMessage: async () => ({ key: { id: 'x' } }) };

  require('../plugins/movie');
  const plugin = registry.find((p) => p.pattern === 'movie');
  const replyHandler = registry.find((p) => typeof p.filter === 'function');
  const currentUsage = require('../lib/usage');

  await check('plugin registers .movie with .film as an alias', () => {
    assert.ok(plugin && typeof plugin.function === 'function');
    assert.deepStrictEqual(plugin.alias, ['film']);
    assert.ok(replyHandler, 'film reply handler should be registered');
  });

  await plugin.function(sock, { key: {} }, {}, ctx);
  await check('missing args produces the new film-download usage text', () => {
    const last = replies[replies.length - 1];
    assert.ok(/Film download \(CineSubz\)/.test(last), last);
    assert.ok(!/Movie search/i.test(last), last);
  });

  await check('.movie usage documents quality, status, cancel and send', () => {
    const entry = currentUsage.getUsage('movie');
    assert.ok(entry);
    assert.ok(entry.usage.some((line) => /status/.test(line)));
    assert.ok(entry.usage.some((line) => /cancel/.test(line)));
    assert.ok(entry.usage.some((line) => /send/.test(line)));
    assert.ok(/CineSubz/.test(entry.purpose));
  });

  await check('reply filter ignores unrelated numeric chat messages when no prompt exists', () => {
    const message = { key: { remoteJid: '94700000000@s.whatsapp.net', id: 'r1' }, message: { conversation: '2' } };
    assert.strictEqual(replyHandler.filter('2', { sender: ctx.sender, message }), false);
  });

  // ---- Playwright download engine (offline) ----
  console.log('\nplaywrightDownload');
  const pdl = require('../lib/playwrightDownload');

  await check('pdl is disabled unless enabled in config + env', () => {
    assert.strictEqual(pdl.isEnabled(), false);
    assert.strictEqual(pdl.loadConfig(), null); // example ships enabled:false
  });

  await check('host allowlist accepts exact host + subdomains only', () => {
    const hosts = ['media.example.com'];
    assert.strictEqual(pdl.hostAllowed('https://media.example.com/a', hosts), true);
    assert.strictEqual(pdl.hostAllowed('https://cdn.media.example.com/a', hosts), true);
    assert.strictEqual(pdl.hostAllowed('https://evil.com/a', hosts), false);
    assert.strictEqual(pdl.hostAllowed('https://media.example.com.evil.com/a', hosts), false);
    assert.strictEqual(pdl.hostAllowed('javascript:alert(1)', hosts), false);
    assert.strictEqual(pdl.hostAllowed('ftp://media.example.com/a', hosts), false);
  });

  await check('pickResult chooses the closest title and rejects junk', () => {
    const results = [
      { title: 'Sintel (2010) 720p', url: 'https://a/1' },
      { title: 'Something Else', url: 'https://a/2' },
    ];
    assert.strictEqual(pdl.pickResult(results, 'sintel').url, 'https://a/1');
    assert.strictEqual(pdl.pickResult([], 'sintel'), null);
    assert.strictEqual(pdl.pickResult(results, 'zzzzz'), null);
  });

  const pdlFail = await pdl.downloadByQuery('sintel');
  await check('downloadByQuery fails cleanly when disabled (never throws)', () => {
    assert.strictEqual(pdlFail.ok, false);
    assert.strictEqual(pdlFail.error.code, 'DISABLED');
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlfile-'));
  const tmpFile = path.join(tmpDir, 'clip.mp4');
  fs.writeFileSync(tmpFile, Buffer.alloc(4096));
  const localSent = await delivery.deliverLocalFile(
    { sendMessage: async () => ({ key: { id: 'ok' } }) },
    'jid',
    { file: tmpFile, dir: tmpDir, title: 'Clip' }
  );
  await check('deliverLocalFile sends the file and deletes the temp dir', () => {
    assert.strictEqual(localSent.ok, true);
    assert.strictEqual(localSent.mode, 'video');
    assert.strictEqual(fs.existsSync(tmpDir), false);
  });

  console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}\n`);
})();
