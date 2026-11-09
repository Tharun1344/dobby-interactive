'use strict';
/**
 * Offline regression tests for branding, mode switching, help metadata,
 * `.getpp` target resolution and session preservation.
 *
 * No WhatsApp connection is used. Synthetic session fixtures live under a temp
 * directory; real session directories are only listed (never written).
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'danuwa-branding-'));
process.env.STORAGE_DIR = tempRoot;
process.env.INTERACTIVE_ENABLED = 'true';
delete process.env.INTERACTIVE_TEXT_ONLY;
delete process.env.BOT_NAME;
delete process.env.ALIVE_MSG;

const config = require('../config');
const menuMode = require('../lib/menuMode');
const usage = require('../lib/usage');
const ownerLinks = require('../lib/ownerLinks');
const aliveCard = require('../lib/aliveCard');
const getpp = require('../lib/getppTarget');
const { commands } = require('../command');

// Register every real command so coverage can be asserted.
const pluginsDir = path.join(__dirname, '..', 'plugins');
for (const file of fs.readdirSync(pluginsDir).filter(name => name.endsWith('.js')).sort()) {
  require(path.join(pluginsDir, file));
}

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function snapshot(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = snapshot(full);
      for (const [key, value] of Object.entries(nested)) out[path.join(entry.name, key)] = value;
    } else if (entry.isFile()) {
      out[entry.name] = hash(full);
    }
  }
  return out;
}
function listNames(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    out.push(entry.name);
    if (entry.isDirectory()) for (const name of listNames(full)) out.push(path.join(entry.name, name));
  }
  return out.sort();
}
function findCommand(pattern) {
  return commands.find(item => item.pattern === pattern);
}
function fakeContext({ accountId = 'test', isOwner = true, prefix = '.', command = 'menu', args = [] } = {}) {
  const replies = [];
  return {
    accountId, isOwner, prefix, command, args, q: args.join(' '), body: `${prefix}${command} ${args.join(' ')}`.trim(),
    settings: { mode: 'public', welcome: true, goodbye: true, mutedGroups: [] },
    sender: '94770000000@s.whatsapp.net', from: '94770000000@s.whatsapp.net',
    reply: async text => { replies.push(String(text)); return {}; },
    replies,
  };
}

async function main() {
  console.log('Branding / mode / help tests');

  await check('new branding is the default and remains configurable', async () => {
    assert.strictEqual(config.BOT_NAME, "Tharun's WhatsApp Bot");
    assert.ok(!/Dobby/i.test(config.ALIVE_MSG));
  });

  await check('menu mode persists per account and survives reload', async () => {
    menuMode.set('acct-a', 'text');
    menuMode.set('acct-b', 'interactive');
    assert.strictEqual(menuMode.get('acct-a'), 'text');
    assert.strictEqual(menuMode.get('acct-b'), 'interactive');
    menuMode.reload();
    assert.strictEqual(menuMode.get('acct-a'), 'text');
    assert.strictEqual(menuMode.get('acct-b'), 'interactive');
    const saved = JSON.parse(fs.readFileSync(menuMode.filePath(), 'utf8'));
    assert.strictEqual(saved['acct-a'], 'text');
    assert.strictEqual(saved['acct-b'], 'interactive');
  });

  await check('mode file is outside WhatsApp session directories', async () => {
    const file = menuMode.filePath().replace(/\\/g, '/');
    assert.ok(file.startsWith(tempRoot.replace(/\\/g, '/')));
    assert.ok(!/auth_info_baileys|\/sessions\//.test(file));
  });

  await check('INTERACTIVE_ENABLED=false wins over .buttons and persisted mode', async () => {
    process.env.INTERACTIVE_ENABLED = 'false';
    process.env.INTERACTIVE_TEXT_ONLY = 'false';
    menuMode.set('safety', 'interactive');
    assert.strictEqual(menuMode.effective('safety'), 'disabled');
    assert.strictEqual(menuMode.canUseInteractive('safety'), false);

    const plugin = findCommand('buttons');
    assert.ok(plugin, '.buttons is registered');
    const ctx = fakeContext({ accountId: 'safety' });
    await plugin.function(null, null, null, ctx);
    assert.ok(ctx.replies.join('\n').includes('INTERACTIVE_ENABLED=false'));
    assert.strictEqual(menuMode.get('safety'), 'interactive');
    process.env.INTERACTIVE_ENABLED = 'true';
  });

  await check('INTERACTIVE_TEXT_ONLY=true wins over .buttons', async () => {
    process.env.INTERACTIVE_ENABLED = 'true';
    process.env.INTERACTIVE_TEXT_ONLY = 'true';
    menuMode.set('textonly', 'interactive');
    assert.strictEqual(menuMode.effective('textonly'), 'text');
    const plugin = findCommand('buttons');
    const ctx = fakeContext({ accountId: 'textonly' });
    await plugin.function(null, null, null, ctx);
    assert.ok(ctx.replies.join('\n').includes('INTERACTIVE_TEXT_ONLY=true'));
    delete process.env.INTERACTIVE_TEXT_ONLY;
  });

  await check('.buttons and .text are owner-only commands', async () => {
    const buttons = findCommand('buttons');
    const text = findCommand('text');
    assert.ok(buttons && text);
    assert.strictEqual(buttons.fromMe, true);
    assert.strictEqual(text.fromMe, true);

    menuMode.set('nonowner', 'interactive');
    const ctx = fakeContext({ accountId: 'nonowner', isOwner: false });
    await buttons.function(null, null, null, ctx);
    await text.function(null, null, null, ctx);
    assert.strictEqual(ctx.replies.filter(textValue => textValue.includes('Owner only')).length, 2);
    assert.strictEqual(menuMode.get('nonowner'), 'interactive');
  });

  await check('.buttons enables interactive mode; .text enables classic mode', async () => {
    process.env.INTERACTIVE_ENABLED = 'true';
    delete process.env.INTERACTIVE_TEXT_ONLY;
    const buttons = findCommand('buttons');
    const text = findCommand('text');
    const ctx = fakeContext({ accountId: 'switch' });
    await buttons.function(null, null, null, ctx);
    assert.strictEqual(menuMode.get('switch'), 'interactive');
    assert.ok(ctx.replies[ctx.replies.length - 1].includes('Interactive Mode Enabled'));
    await text.function(null, null, null, ctx);
    assert.strictEqual(menuMode.get('switch'), 'text');
    assert.ok(ctx.replies[ctx.replies.length - 1].includes('Classic Text Mode Enabled'));
    // Ordinary commands are not disabled by text mode.
    assert.ok(findCommand('ping') && findCommand('song'));
  });

  await check('.menu uses the classic list in text mode and when interactive is disabled', async () => {
    const menu = findCommand('menu');
    const ctxText = fakeContext({ accountId: 'switch', command: 'menu' });
    menuMode.set('switch', 'text');
    await menu.function(null, {}, {}, ctxText);
    assert.ok(ctxText.replies.join('\n').includes('MENU'));
    assert.ok(ctxText.replies.join('\n').includes('COMMANDS') || ctxText.replies.join('\n').includes('DOWNLOADS'));

    process.env.INTERACTIVE_ENABLED = 'false';
    const ctxDisabled = fakeContext({ accountId: 'enabled-off', command: 'menu' });
    await menu.function(null, {}, {}, ctxDisabled);
    assert.ok(ctxDisabled.replies.join('\n').includes('MENU'));
    process.env.INTERACTIVE_ENABLED = 'true';
  });

  await check('social links are labelled, validated and preserve exact URLs', async () => {
    const links = ownerLinks.linksFromConfig({
      OWNER_GITHUB: 'https://github.com/example',
      OWNER_WHATSAPP: 'https://wa.me/94770000000',
      OWNER_TELEGRAM: 'https://t.me/example',
      OWNER_INSTAGRAM: '',
      OWNER_FACEBOOK: 'https://facebook.com/example',
      OWNER_YOUTUBE: 'https://youtube.com/@example',
      OWNER_WEBSITE: 'javascript:alert(1)',
      BOT_OWNER: '',
    });
    assert.deepStrictEqual(links.map(link => link.id), ['github', 'whatsapp', 'telegram', 'facebook', 'youtube']);
    assert.strictEqual(links.find(link => link.id === 'github').url, 'https://github.com/example');
    assert.strictEqual(links.find(link => link.id === 'telegram').label, 'Telegram');
    assert.ok(!links.some(link => link.id === 'website'), 'invalid protocol is rejected');
    assert.ok(ownerLinks.linkButtons(links).length <= 3);
  });

  await check('WhatsApp link falls back to BOT_OWNER without printing the number', async () => {
    const links = ownerLinks.linksFromConfig({ BOT_OWNER: '94 770 000 000' });
    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0].url, 'https://wa.me/94770000000');
    assert.ok(!ownerLinks.linkSummary(links).includes('94770000000'));
  });

  await check('.alive card is branded, complete and contains no raw URLs', async () => {
    const card = aliveCard.buildAliveCard({
      accountId: 'test-account', prefix: '.', botNumber: '94770000000',
      name: "Tharun's WhatsApp Bot", ownerName: 'Owner Name',
      uptime: '2h 30m', version: '1.3.0', commandCount: 47,
    });
    for (const expected of ["Tharun's WhatsApp Bot", 'System Status', 'Online', 'Uptime', '2h 30m', 'Prefix', 'Commands', '47', 'Version', '1.3.0', 'Owner', 'Account', 'test-account']) {
      assert.ok(card.text.includes(expected), `alive card missing ${expected}`);
    }
    assert.ok(!/https?:\/\//i.test(card.text), 'main card must not contain raw URLs');
    assert.ok(card.text.includes('947******00'), 'bot number is masked');
    assert.ok(!card.text.includes('94770000000'), 'full bot number is never shown');
  });

  await check('every registered command has usage instructions', async () => {
    const missing = usage.missing(commands);
    assert.deepStrictEqual(missing, [], `missing usage: ${missing.join(', ')}`);
    for (const item of commands.filter(command => command.pattern)) {
      const entry = usage.getUsage(item.pattern);
      assert.ok(entry, `no usage for ${item.pattern}`);
      assert.ok(entry.purpose && entry.usage?.length && entry.example && entry.result && entry.permission, `incomplete usage for ${item.pattern}`);
    }
  });

  await check('aliases resolve to the same usage entry', async () => {
    assert.strictEqual(usage.getUsage('gp').command, 'getpp');
    assert.strictEqual(usage.getUsage('ytmp4').command, 'ytvideo');
    assert.strictEqual(usage.getUsage('help').command, 'menu');
    assert.ok(usage.formatUsage(usage.getUsage('getpp'), '.').includes('Reply to a user'));
  });

  await check('.getpp resolves mention, reply, number, JID and self targets', async () => {
    const sender = '94771111111@s.whatsapp.net';
    assert.deepStrictEqual(getpp.resolveGetppTarget({ mentionUser: ['94772222222@s.whatsapp.net'], sender }), { jid: '94772222222@s.whatsapp.net', source: 'mention' });
    assert.deepStrictEqual(getpp.resolveGetppTarget({ sender, query: 'me' }), { jid: sender, source: 'self' });
    assert.deepStrictEqual(getpp.resolveGetppTarget({ sender, query: '94773333333' }), { jid: '94773333333@s.whatsapp.net', source: 'number' });
    assert.deepStrictEqual(getpp.resolveGetppTarget({ sender, query: '+94 77 333 3333' }), { jid: '94773333333@s.whatsapp.net', source: 'number' });
    assert.deepStrictEqual(getpp.resolveGetppTarget({ sender, query: '94774444444@s.whatsapp.net' }), { jid: '94774444444@s.whatsapp.net', source: 'jid' });
    assert.deepStrictEqual(getpp.resolveGetppTarget({ sender, quotedSender: '94775555555@s.whatsapp.net' }), { jid: '94775555555@s.whatsapp.net', source: 'reply' });
    assert.deepStrictEqual(getpp.resolveGetppTarget({ sender, query: 'not a target' }), { jid: null, source: 'unknown' });
  });

  await check('synthetic session fixtures are untouched by branding/mode operations', async () => {
    const legacy = path.join(tempRoot, 'auth_info_baileys');
    const multi = path.join(tempRoot, 'sessions', 'main');
    fs.mkdirSync(legacy, { recursive: true });
    fs.mkdirSync(multi, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'creds.json'), '{"fixture":"legacy"}');
    fs.writeFileSync(path.join(multi, 'creds.json'), '{"fixture":"multi"}');
    const before = { legacy: snapshot(legacy), multi: snapshot(multi) };

    menuMode.set('fixture-account', 'text');
    menuMode.set('fixture-account', 'interactive');
    usage.formatUsage(usage.getUsage('alive'), '.');
    ownerLinks.linksFromConfig({ OWNER_GITHUB: 'https://github.com/example' });
    aliveCard.buildAliveCard({ accountId: 'fixture-account' });

    assert.deepStrictEqual(snapshot(legacy), before.legacy);
    assert.deepStrictEqual(snapshot(multi), before.multi);
  });

  await check('real session directories are not written by this test run', async () => {
    const root = path.join(__dirname, '..');
    const dirs = [path.join(root, 'auth_info_baileys'), path.join(root, 'sessions')];
    const before = dirs.map(dir => listNames(dir));
    menuMode.set('real-root-check', 'text');
    menuMode.set('real-root-check', 'interactive');
    const after = dirs.map(dir => listNames(dir));
    assert.deepStrictEqual(after, before);
  });

  console.log(`\n${passed} branding/mode/help tests passed. Offline only: native WhatsApp rendering was not tested.`);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

main().catch(err => {
  console.error('\nBranding tests failed:');
  console.error(err?.stack || err);
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(1);
});
