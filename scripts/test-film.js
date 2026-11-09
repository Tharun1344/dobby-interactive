'use strict';
/**
 * Offline regression tests for the CineSubz film downloader (.movie / .film).
 *
 *   node scripts/test-film.js
 *
 * No network and no WhatsApp connection: global.fetch is replaced with a small
 * fixture server, and the socket is a fake that records what would be sent.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'danuwa-film-'));
process.env.STORAGE_DIR = tempRoot;
process.env.FILM_DOWNLOAD_DIR = path.join(tempRoot, 'data', 'films');
process.env.FILM_MAX_BYTES = '1900000000';
process.env.FILM_MAX_CONCURRENT = '2';
process.env.FILM_COOLDOWN_MS = '0';
process.env.FILM_DELETE_AFTER_SEND = 'true';
process.env.FILM_DELETE_PARTIAL_ON_CANCEL = 'true';
process.env.FILM_REQUEST_TIMEOUT_MS = '5000';
process.env.INTERACTIVE_ENABLED = 'true';
process.env.INTERACTIVE_TEXT_ONLY = 'false';
delete process.env.FILM_SITE;

const source = require('../lib/filmSource');
const downloads = require('../lib/filmDownload');
const { commands, replyHandlers } = require('../command');

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

/* ── fixture site ─────────────────────────────────────────────────────────── */

const SITE = 'https://cinesubz.net';
const PAGES = {
  '/movies/iru-mugan-2016/': {
    title: 'Iru Mugan (2016) – CineSubz',
    post: '1001',
    variants: [
      ['1080p', 2600000000],
      ['720p', 780000000],
      ['480p', 420000000],
    ],
  },
  '/movies/sachein-2005/': {
    title: 'Sachein (2005) – CineSubz',
    post: '1002',
    variants: [['480p', 300000000]],
  },
  '/movies/ahankara-adare-2019/': {
    title: 'Ahankara Adare (2019) – CineSubz',
    post: '1003',
    variants: [['720p', 900000000]],
  },
};

function html(body) {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function pageHtml(entry) {
  return `<html><head><title>${entry.title}</title></head><body>
    <div class="player-option" data-post='${entry.post}' data-nume='1'></div>
  </body></html>`;
}

function embedHtml(entry) {
  const lines = entry.variants.map(([quality, bytes]) => (
    `<source src="https://cdn.cinesubz.net/files/${entry.post}-${quality}.mp4?play=true" data-bytes="${bytes}">`
  ));
  return `<html><body><video>${lines.join('\n')}</video></body></html>`;
}

const searchResults = {
  'Iru Mugan': `
    <a href="https://cinesubz.net/movies/iru-mugan-2016/">Iru Mugan (2016)</a>`,
  'Mystery Film': `
    <a href="https://cinesubz.net/movies/sachein-2005/">Sachein (2005)</a>
    <a href="https://cinesubz.net/movies/ahankara-adare-2019/">Naan Mahaan Alla (2010)</a>`,
};

const realFetch = global.fetch;
let resumeRange = '';
let mp4Gets = 0;

global.fetch = async (url, options = {}) => {
  const raw = String(url);
  const parsed = new URL(raw);

  if (parsed.hostname === 'html.duckduckgo.com') return html('<html><body></body></html>');

  if (parsed.hostname === 'cinesubz.net' && parsed.pathname === '/' && parsed.searchParams.has('s')) {
    return html(searchResults[parsed.searchParams.get('s')] || '<html><body>No results</body></html>');
  }

  if (PAGES[parsed.pathname]) return html(pageHtml(PAGES[parsed.pathname]));

  if (parsed.pathname.startsWith('/wp-json/zetaplayer/v2/mv/')) {
    const post = parsed.pathname.split('/').pop();
    return json({ embed_url: `https://player.cinesubz.net/embed/${post}` });
  }

  if (parsed.hostname === 'player.cinesubz.net' && parsed.pathname.startsWith('/embed/')) {
    const post = parsed.pathname.split('/').pop();
    const entry = Object.values(PAGES).find(item => item.post === post);
    return html(embedHtml(entry));
  }

  if (/\.mp4$/.test(parsed.pathname)) {
    if (raw.includes('resume-480p')) {
      resumeRange = String(options.headers?.Range || '');
      return new Response('67890', {
        status: 206,
        headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 5-9/10', 'content-length': '5' },
      });
    }
    const match = parsed.pathname.match(/-(\d{3,4})p\.mp4$/);
    const quality = match ? `${match[1]}p` : '480p';
    const bytes = (Object.values(PAGES)
      .flatMap(item => item.variants)
      .find(([q]) => q === quality) || ['', 0])[1];
    if (options.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': String(bytes || 1234) },
      });
    }
    mp4Gets += 1;
    return new Response('fake-mp4-data', {
      status: 200,
      headers: { 'content-type': 'video/mp4', 'content-length': '13' },
    });
  }

  throw new Error(`unexpected fetch: ${raw}`);
};

/* ── fake socket ──────────────────────────────────────────────────────────── */

const SELF = '94711111111@s.whatsapp.net';
const CHAT_A = '94722222222@s.whatsapp.net';
const CHAT_B = '94733333333@s.whatsapp.net';

const relayed = [];
const sent = [];
const sock = {
  user: { id: SELF, lid: '111111111111111@lid' },
  sendMessage: async (jid, content, options) => {
    sent.push({ jid, content, options });
    return { key: { id: `sent-${sent.length}` } };
  },
  relayMessage: async (jid, message, options) => {
    relayed.push({ jid, message, options });
    return 'relayed';
  },
};

function makeContext({ q = '', from = CHAT_A, sender = CHAT_A, accountId = 'test-account', isGroup = false, body = null } = {}) {
  const replies = [];
  return {
    from,
    sender,
    accountId,
    isGroup,
    q,
    body: body == null ? `.movie ${q}`.trim() : body,
    prefix: '.',
    quoted: {
      key: { id: 'quoted-1', remoteJid: from, fromMe: false },
      message: { conversation: 'film please' },
      pushName: 'Tester',
    },
    reply: async (text) => { replies.push(String(text)); return {}; },
    replies,
  };
}

function nativeReply(id) {
  return { interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: JSON.stringify({ id }) } } };
}

function lastButtonParams() {
  const entry = relayed[relayed.length - 1];
  const interactive = entry?.message?.viewOnceMessage?.message?.interactiveMessage;
  const buttons = interactive?.nativeFlowMessage?.buttons || [];
  return buttons.map(button => {
    try { return JSON.parse(button.buttonParamsJson); } catch { return {}; }
  });
}

function waitFor(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
  ]);
}

(async () => {
  /* ── filmSource ────────────────────────────────────────────────────────── */

  console.log('\nfilmSource');

  await check('private/loopback hosts are rejected, public hosts allowed', () => {
    for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.1.5', '172.20.0.1', '169.254.1.1', '::1']) {
      assert.strictEqual(source.isPrivateHost(host), true, host);
    }
    assert.strictEqual(source.isPrivateHost('cinesubz.net'), false);
    assert.throws(() => source.assertPublicHttpUrl('http://127.0.0.1/a'), /Private/);
    assert.throws(() => source.assertPublicHttpUrl('file:///etc/passwd'), /http\(s\)/);
    assert.ok(source.assertPublicHttpUrl('https://cinesubz.net/a'));
  });

  await check('page links are restricted to the configured source host', () => {
    assert.ok(source.assertSourceUrl('https://cinesubz.net/movies/a/'));
    assert.throws(() => source.assertSourceUrl('https://evil.example/movies/a/'), /Only/);
  });

  await check('search parser reads absolute links, decodes entities and dedupes', () => {
    const page = `
      <a href="https://cinesubz.net/movies/iru-mugan-2016/">Iru Mugan &amp; Friends</a>
      <a href="https://cinesubz.net/movies/iru-mugan-2016/">Duplicate</a>
      <a href="https://evil.example/movies/nope/">Nope</a>`;
    const found = source.parseSearchResults(page, SITE);
    assert.strictEqual(found.length, 1);
    assert.ok(found[0].title.includes('& Friends'));
    assert.ok(found[0].url.endsWith('/movies/iru-mugan-2016/'));
  });

  await check('score prefers the candidate matching more query tokens', () => {
    const sorted = source.scoreCandidates([
      { url: 'https://cinesubz.net/movies/other/', title: 'Other' },
      { url: 'https://cinesubz.net/movies/iru-mugan/', title: 'Iru Mugan' },
    ], 'Iru Mugan');
    assert.ok(sorted[0].title.includes('Iru Mugan'));
  });

  await check('player options parse both quote styles and attributes', () => {
    const page = `
      <div class="player-option" data-post='1001' data-nume='1'></div>
      <div data-nume="2" data-post="1002"></div>`;
    const options = source.parsePlayerOptions(page);
    assert.strictEqual(options.length, 2);
    assert.deepStrictEqual(options[0], { postId: '1001', nume: '1' });
  });

  await check('embed parser finds mp4?play=true variants and encodes unsafe chars', () => {
    const page = `
      <source src="https://cdn.example.com/Film (2019) 720p.mp4?play=true">
      <source src="https://cdn.example.com/Film [2019] 480p.mp4?play=true">
      <source src="https://cdn.example.com/Film (2019) 720p.mp4?play=true">`;
    const urls = source.parseEmbedVariants(page);
    assert.strictEqual(urls.length, 2);
    assert.ok(urls.some(url => url.includes('Film%20(2019)%20720p')));
    assert.ok(urls.some(url => url.includes('%5B2019%5D')));
  });

  await check('quality detection, ordering and fallback selection', () => {
    assert.strictEqual(source.qualityOf('https://x/a-1080p.mp4'), '1080p');
    assert.strictEqual(source.qualityOf('https://x/a.mp4'), '?');
    const variants = source.sortVariants([
      'https://x/a-480p.mp4',
      'https://x/a-1080p.mp4',
      'https://x/a-720p.mp4',
    ]);
    assert.deepStrictEqual(variants.map(item => item.quality), ['1080p', '720p', '480p']);
    assert.strictEqual(source.pickVariant(variants, '720p').quality, '720p');
    assert.strictEqual(source.pickVariant(variants, '360p').quality, '480p');
    assert.strictEqual(source.pickVariant(variants, '4k').quality, '1080p');
  });

  await check('title matching tolerates punctuation but not unrelated titles', () => {
    assert.strictEqual(source.titleMatches('Iru Mugan', 'IRU MUGAN (2016) – CineSubz'), true);
    assert.strictEqual(source.titleMatches('Iru Mugan', 'Sachein (2005)'), false);
    assert.strictEqual(source.titleMatches('The Film', 'The Godfather (1972)'), false);
    assert.strictEqual(source.titleMatches('Iru Mugan 2016', 'Iru Mugan (2016)'), true);
  });

  await check('pageTitle removes the site suffix and decodes entities', () => {
    assert.strictEqual(source.pageTitle('<title>Iru Mugan &amp; Co. – CineSubz</title>'), 'Iru Mugan & Co.');
  });

  await check('content-range total is parsed', () => {
    assert.strictEqual(source.parseContentRange('bytes 0-1/12345'), 12345);
    assert.strictEqual(source.parseContentRange(''), 0);
  });

  const resolved = await source.resolveFilm(`${SITE}/movies/iru-mugan-2016/`, '720p', { withSizes: true });
  await check('resolveFilm lists every variant with size and picks the requested one', () => {
    assert.strictEqual(resolved.title, 'Iru Mugan (2016)');
    assert.strictEqual(resolved.variants.length, 3);
    assert.strictEqual(resolved.variants[0].quality, '1080p');
    assert.strictEqual(resolved.variants[0].bytes, 2600000000);
    assert.strictEqual(resolved.chosen.quality, '720p');
  });

  await check('headSize falls back when HEAD has no length', async () => {
    const info = await source.headSize('https://cdn.cinesubz.net/files/1001-480p.mp4?play=true', {
      fetchImpl: async () => new Response(null, { status: 200, headers: { 'content-type': 'video/mp4' } }),
    });
    assert.strictEqual(info.bytes, 0);
    assert.strictEqual(info.contentType, 'video/mp4');
  });

  /* ── filmDownload ──────────────────────────────────────────────────────── */

  console.log('\nfilmDownload');

  await check('safeFileName and fileKey are filesystem-safe and stable', () => {
    assert.strictEqual(downloads.safeFileName('..\\A/B:C*?'), '.. A B C');
    assert.strictEqual(downloads.fileKey('a', 'chat'), downloads.fileKey('a', 'chat'));
    assert.notStrictEqual(downloads.fileKey('a', 'chat'), downloads.fileKey('a', 'other'));
    assert.notStrictEqual(downloads.fileKey('a', 'chat'), downloads.fileKey('b', 'chat'));
  });

  await check('startJob rejects a file over the configured WhatsApp limit', () => {
    assert.throws(() => downloads.startJob({
      accountId: 'size', chatId: 'size-chat', title: 'Too Big', quality: '1080p',
      url: 'https://cdn.cinesubz.net/files/big-1080p.mp4?play=true',
      expectedBytes: downloads.maxBytes() + 1,
    }), err => err.code === 'TOO_LARGE');
  });

  await check('cancel returns null when this chat has no job', () => {
    assert.strictEqual(downloads.cancel('nobody', 'nothing'), null);
  });

  await check('a partial .part file resumes with a Range request', async () => {
    const accountId = 'resume-account';
    const chatId = 'resume-chat';
    const dir = downloads.outDir();
    fs.mkdirSync(dir, { recursive: true });
    const title = 'Resume Test';
    const quality = '480p';
    const file = path.join(dir, `${downloads.safeFileName(title)}-${quality}-${downloads.fileKey(accountId, chatId)}.mp4`);
    const part = `${file}.part`;
    fs.writeFileSync(part, '12345');

    let doneJob = null;
    const finished = new Promise((resolve) => {
      downloads.startJob({
        accountId,
        chatId,
        title,
        quality,
        url: 'https://cdn.cinesubz.net/files/resume-480p.mp4?play=true',
        expectedBytes: 10,
        onComplete: async (job) => { doneJob = job; resolve(job); },
      });
    });

    await waitFor(finished);
    assert.strictEqual(resumeRange, 'bytes=5-');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '1234567890');
    assert.strictEqual(fs.existsSync(part), false);
    assert.strictEqual(doneJob.bytes, 10);
    fs.rmSync(file, { force: true });
  });

  await check('describe explains every terminal state without leaking secrets', () => {
    assert.ok(/active download එකක් නෑ/.test(downloads.describe(null)));
    assert.ok(/50\.0%|📊/.test(downloads.describe({
      status: 'downloading', title: 'X', quality: '720p', bytes: 50, expected: 100, startedAt: Date.now() - 1000,
    })));
    assert.ok(/යැව්වේ නෑ/.test(downloads.describe({
      status: 'failed', title: 'X', quality: '480p', bytes: 10, sendError: 'upload failed',
    })));
    assert.ok(/delete කළා/.test(downloads.describe({ status: 'done', title: 'X', fileDeleted: true })));
  });

  /* ── plugin flow ───────────────────────────────────────────────────────── */

  console.log('\n.movie / .film flow');

  const pluginHooks = require('../plugins/movie');
  const movie = commands.find(item => item.pattern === 'movie');
  const status = commands.find(item => item.pattern === 'moviestatus');
  const replyHandler = replyHandlers.find(item => typeof item.filter === 'function');

  await check('registers .movie (alias .film), .moviestatus and one film reply handler', () => {
    assert.ok(movie && typeof movie.function === 'function');
    assert.deepStrictEqual(movie.alias, ['film']);
    assert.ok(status && status.fromMe);
    assert.ok(replyHandler);
    assert.strictEqual(typeof pluginHooks._filter, 'function');
  });

  const realStartJob = downloads.startJob;
  let captured = [];
  downloads.startJob = (options) => {
    captured.push(options);
    return { id: `fake-${captured.length}`, status: 'downloading', ...options };
  };

  await check('native quality buttons are sent with film: ids and sizes in the body', async () => {
    const ctx = makeContext({ q: 'Iru Mugan' });
    await movie.function(sock, { key: {} }, {}, ctx);
    assert.ok(ctx.replies.some(text => /CineSubz එකේ හොයනවා/.test(text)), ctx.replies.join('\n---\n'));
    assert.ok(ctx.replies.some(text => /Quality variants/.test(text)));
    const buttons = lastButtonParams();
    assert.strictEqual(buttons.length, 2);
    assert.ok(buttons.every(button => String(button.id).startsWith('film:go:')));
    assert.deepStrictEqual(buttons.map(button => button.display_text), ['720p', '480p']);
  });

  await check('the over-limit 1080p variant is hidden from the choice list', async () => {
    const prompt = pluginHooks._prompts.get(CHAT_A);
    assert.ok(prompt);
    assert.strictEqual(prompt.kind, 'quality');
    assert.deepStrictEqual(prompt.variants.map(variant => variant.quality), ['720p', '480p']);
  });

  await check('numbered text reply starts the matching quality download', async () => {
    const ctx = makeContext({ q: '2', body: '2' });
    await replyHandler.function(sock, { key: { remoteJid: CHAT_A } }, { body: '2' }, ctx);
    assert.strictEqual(captured.length, 1);
    assert.strictEqual(captured[0].quality, '480p');
    assert.ok(captured[0].url.includes('480p.mp4'));
    assert.strictEqual(captured[0].accountId, 'test-account');
    assert.strictEqual(pluginHooks._prompts.has(CHAT_A), false);
  });

  await check('native button reply id starts the matching quality download', async () => {
    const ctx = makeContext({ q: 'Iru Mugan' });
    await movie.function(sock, { key: {} }, {}, ctx);
    const prompt = pluginHooks._prompts.get(CHAT_A);
    assert.ok(prompt);
    const incoming = { key: { remoteJid: CHAT_A, id: 'btn-1' }, message: nativeReply(`film:go:${prompt.token}:0`) };
    assert.strictEqual(replyHandler.filter('', { sender: CHAT_A, message: incoming }), true);

    const buttonCtx = makeContext({ q: '', body: '', from: CHAT_A });
    await replyHandler.function(sock, incoming, { body: '' }, buttonCtx);
    assert.strictEqual(captured.length, 2);
    assert.strictEqual(captured[1].quality, '720p');
  });

  await check('ambiguous search asks the user to pick the film page first', async () => {
    const ctx = makeContext({ q: 'Mystery Film' });
    await movie.function(sock, { key: {} }, {}, ctx);
    const prompt = pluginHooks._prompts.get(CHAT_A);
    assert.ok(prompt);
    assert.strictEqual(prompt.kind, 'pick');
    assert.strictEqual(prompt.candidates.length, 2);
    assert.ok(ctx.replies.some(text => /Mystery Film/.test(text)));
  });

  await check('choosing the second search result resolves and downloads that page', async () => {
    const ctx = makeContext({ q: '2', body: '2' });
    await replyHandler.function(sock, { key: { remoteJid: CHAT_A } }, { body: '2' }, ctx);
    assert.strictEqual(captured.length, 3);
    assert.strictEqual(captured[2].quality, '720p');
    assert.ok(captured[2].title.includes('Ahankara Adare'));
  });

  await check('unmatched numeric chat messages are ignored when no prompt exists', () => {
    const message = { key: { remoteJid: CHAT_B, id: 'free-1' }, message: { conversation: '2' } };
    assert.strictEqual(replyHandler.filter('2', { sender: CHAT_B, message }), false);
  });

  await check('unknown title produces an honest not-found message', async () => {
    const ctx = makeContext({ q: 'Unknown Film 2099', from: CHAT_B, sender: CHAT_B });
    await movie.function(sock, { key: {} }, {}, ctx);
    assert.ok(ctx.replies.some(text => /හමු වුණේ නෑ/.test(text)), ctx.replies.join('\n---\n'));
  });

  await check('a prompt is owned by the sender; another group member cannot use it', async () => {
    const owner = '94744444444@s.whatsapp.net';
    const other = '94755555555@s.whatsapp.net';
    const group = '120363000000000000@g.us';
    const ctx = makeContext({ q: 'Iru Mugan', from: group, sender: owner, isGroup: true });
    await movie.function(sock, { key: {} }, {}, ctx);
    assert.ok(
      pluginHooks._prompts.get(group),
      `prompt missing; replies=${JSON.stringify(ctx.replies.slice(-3))}; keys=${[...pluginHooks._prompts.keys()].join(',')}`
    );

    const otherCtx = makeContext({ q: '1', body: '1', from: group, sender: other, isGroup: true });
    assert.strictEqual(
      replyHandler.filter('1', { sender: other, message: { key: { remoteJid: group }, message: { conversation: '1' } } }),
      false,
      'a stranger number must not consume the film reply handler'
    );
    const beforeCount = captured.length;
    await replyHandler.function(sock, { key: { remoteJid: group } }, { body: '1' }, otherCtx);
    assert.strictEqual(captured.length, beforeCount, 'a stranger must not start the download');
    assert.strictEqual(otherCtx.replies.length, 0, 'plain numbers from a stranger are ignored silently');
    assert.ok(pluginHooks._prompts.get(group), 'prompt must survive a stranger text reply');

    const prompt = pluginHooks._prompts.get(group);
    const forged = { key: { remoteJid: group, id: 'stranger-btn' }, message: nativeReply(`film:go:${prompt.token}:0`) };
    const buttonCtx = makeContext({ q: '', body: '', from: group, sender: other, isGroup: true });
    await replyHandler.function(sock, forged, { body: '' }, buttonCtx);
    assert.ok(buttonCtx.replies.some(text => /වෙන user/.test(text)), buttonCtx.replies.join('\n---\n'));
    assert.strictEqual(captured.length, beforeCount, 'a stranger button press must not start the download');
    assert.ok(pluginHooks._prompts.get(group), 'prompt must survive a stranger button press');
    pluginHooks._prompts.delete(group);
  });

  await check('self-chat falls back to a numbered text list instead of buttons', async () => {
    const before = relayed.length;
    const ctx = makeContext({ q: 'Iru Mugan', from: SELF, sender: SELF });
    await movie.function(sock, { key: {} }, {}, ctx);
    assert.strictEqual(relayed.length, before);
    const text = ctx.replies[ctx.replies.length - 1];
    assert.ok(/Quality එකක් තෝරන්න/.test(text), text);
    assert.ok(/1\. \*720p\*/.test(text), text);
    pluginHooks._prompts.clear();
  });

  await check('the quality prefix skips the quality question', async () => {
    captured = [];
    const ctx = makeContext({ q: '480p Iru Mugan' });
    await movie.function(sock, { key: {} }, {}, ctx);
    assert.strictEqual(captured.length, 1);
    assert.strictEqual(captured[0].quality, '480p');
  });

  await check('.movie status and .movie cancel answer without an active job', async () => {
    const sctx = makeContext({ q: 'status', from: CHAT_B, sender: CHAT_B });
    await movie.function(sock, { key: {} }, {}, sctx);
    assert.ok(sctx.replies.some(text => /active download එකක් නෑ/.test(text)), sctx.replies.join('\n'));

    const cctx = makeContext({ q: 'cancel', from: CHAT_B, sender: CHAT_B });
    await movie.function(sock, { key: {} }, {}, cctx);
    assert.ok(cctx.replies.some(text => /active download එකක් නෑ/.test(text)), cctx.replies.join('\n'));
  });

  await check('missing arguments show the new usage text', async () => {
    const ctx = makeContext({ q: '' });
    await movie.function(sock, { key: {} }, {}, ctx);
    assert.ok(/Film download \(CineSubz\)/.test(ctx.replies[0]));
  });

  downloads.startJob = realStartJob;

  /* ── document delivery ─────────────────────────────────────────────────── */

  console.log('\ndocument delivery');

  await check('sends the film as an mp4 document and deletes it after success', async () => {
    const dir = downloads.outDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'Unit Film 480p.mp4');
    fs.writeFileSync(file, Buffer.alloc(2048));
    const before = sent.length;
    process.env.FILM_DELETE_AFTER_SEND = 'true';

    await pluginHooks._sendFilm(sock, {
      file, title: 'Unit Film', quality: '480p', chatId: CHAT_B, query: 'unit',
    });

    const delivery = sent[before];
    assert.ok(delivery);
    assert.strictEqual(delivery.jid, CHAT_B);
    assert.strictEqual(delivery.content.mimetype, 'video/mp4');
    assert.ok(/Unit Film/.test(delivery.content.fileName));
    assert.ok(/480p/.test(delivery.content.caption));
    assert.strictEqual(fs.existsSync(file), false);
  });

  await check('keeps the file when delete-after-send is disabled', async () => {
    const dir = downloads.outDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'Keep Film 720p.mp4');
    fs.writeFileSync(file, Buffer.alloc(2048));
    process.env.FILM_DELETE_AFTER_SEND = 'false';

    await pluginHooks._sendFilm(sock, {
      file, title: 'Keep Film', quality: '720p', chatId: CHAT_B, query: 'keep',
    });

    assert.strictEqual(fs.existsSync(file), true);
    fs.rmSync(file, { force: true });
    process.env.FILM_DELETE_AFTER_SEND = 'true';
  });

  /* ── security / isolation ──────────────────────────────────────────────── */

  console.log('\nsecurity / isolation');

  await check('the downloader never writes inside WhatsApp session directories', () => {
    const dir = downloads.outDir().replace(/\\/g, '/').toLowerCase();
    assert.ok(dir.startsWith(tempRoot.replace(/\\/g, '/').toLowerCase()));
    assert.ok(!/auth_info_baileys|\/sessions\//.test(dir));
  });

  await check('session-like fixtures are untouched by the film tests', () => {
    const sessionDir = path.join(tempRoot, 'sessions', 'acct');
    fs.mkdirSync(sessionDir, { recursive: true });
    const creds = path.join(sessionDir, 'creds.json');
    fs.writeFileSync(creds, '{"fixture":true}');
    const before = fs.readFileSync(creds, 'utf8');
    pluginHooks._qualityText('Film', [{ quality: '480p', bytes: 1 }]);
    assert.strictEqual(fs.readFileSync(creds, 'utf8'), before);
  });

  global.fetch = realFetch;
  fs.rmSync(tempRoot, { recursive: true, force: true });

  console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}\n`);
})();
