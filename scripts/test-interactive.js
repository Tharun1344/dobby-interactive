'use strict';
/**
 * Offline tests for the interactive menu layer. No network, no WhatsApp.
 *   node scripts/test-interactive.js
 *
 * The tests build native payloads with a mock socket, feed simulated
 * button/list responses back through the same handler index.js uses, and
 * verify that the original plugin command is called with the right input.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'danuwa-interactive-'));
process.env.STORAGE_DIR = tempRoot;
process.env.INTERACTIVE_ENABLED = 'true';
process.env.INTERACTIVE_BOT_NODE = 'true';
delete process.env.INTERACTIVE_TEXT_ONLY;
delete process.env.INTERACTIVE_STATE_TTL_MIN;
delete process.env.INTERACTIVE_PROMPT_TTL_MIN;

const { cmd } = require('../command');
const messages = require('../lib/interactive/messages');
const engine = require('../lib/interactive');
const menus = require('../lib/interactive/menus');
const catalog = require('../lib/interactive/catalog');
const states = require('../lib/interactive/state');
const welcome = require('../lib/welcome');
const sch = require('../lib/scheduler');
const { buildMenuText } = require('../lib/commandList');

const BOT_ID = '94770000000:1@s.whatsapp.net';
const BOT_JID = '94770000000@s.whatsapp.net';
const OTHER = '94771111111@s.whatsapp.net';
const GROUP = '120363000000000000@g.us';
const GROUP_MEMBER = '94772222222@s.whatsapp.net';

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

function createSock() {
  const sock = {
    user: { id: BOT_ID, lid: '100000000000001@lid' },
    sent: [],
    relayed: [],
    sendMessage: async (jid, content, options) => {
      sock.sent.push({ jid, content, options });
      return { key: { id: `out-${sock.sent.length}`, remoteJid: jid, fromMe: true } };
    },
    relayMessage: async (jid, message, options) => {
      sock.relayed.push({ jid, message, options });
      return {};
    },
  };
  return sock;
}

function nativeButtons(relay) {
  return relay?.message?.viewOnceMessage?.message?.interactiveMessage?.nativeFlowMessage?.buttons || [];
}

function buttonAction(relay, index = 0) {
  const button = nativeButtons(relay)[index];
  if (!button) return '';
  return JSON.parse(button.buttonParamsJson).id;
}

function listRows(relay) {
  const sections = relay?.message?.listMessage?.sections || [];
  return sections.flatMap(section => section.rows || []);
}

function makeContext({ sock, chat = OTHER, sender = OTHER, isGroup = false, isOwner = false, isAdmins = false, isBotAdmins = false, settings } = {}) {
  return {
    from: chat,
    quoted: null,
    body: '',
    isCmd: false,
    command: '',
    args: [],
    q: '',
    isGroup,
    sender,
    prefix: '.',
    senderNumber: sender.split('@')[0],
    botNumber: '94770000000',
    botNumber2: BOT_JID,
    botIds: [BOT_JID, '100000000000001@lid'],
    pushname: 'Tester',
    isMe: false,
    isOwner,
    groupMetadata: isGroup ? { id: chat, subject: 'Test Group', participants: [] } : null,
    groupName: isGroup ? 'Test Group' : '',
    participants: [],
    groupAdmins: [],
    isBotAdmins,
    isAdmins,
    reply: async () => {},
    accountId: 'test',
    settings: settings || { mode: 'public', welcome: true, goodbye: true, mutedGroups: [], groupWelcome: {}, antiDelete: true, autoReact: false, dmGreeting: true, welcomedUsers: [] },
    getTargetJid: () => null,
  };
}

function textIncoming({ id, chat = OTHER, sender = OTHER, body = '', fromMe = false, isGroup = false, quoted = null } = {}) {
  const incoming = {
    key: { id: id || Math.random().toString(36).slice(2), remoteJid: chat, fromMe, ...(isGroup ? { participant: sender } : {}) },
    message: { conversation: body },
    pushName: 'Tester',
  };
  const m = {
    key: incoming.key,
    id: incoming.key.id,
    chat,
    fromMe,
    isGroup,
    sender,
    type: 'conversation',
    msg: body,
    body,
    quoted,
    reply: async () => {},
    download: async () => Buffer.from('media'),
  };
  return { incoming, m };
}

function responseIncoming({ id, chat = OTHER, sender = OTHER, actionId = '', fromMe = false, kind = 'button', native = false } = {}) {
  const message = native
    ? { interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: JSON.stringify({ id: actionId }) } } }
    : { buttonsResponseMessage: { selectedButtonId: actionId, contextInfo: {} } };
  const incoming = {
    key: { id: id || Math.random().toString(36).slice(2), remoteJid: chat, fromMe, participant: chat.endsWith('@g.us') ? sender : undefined },
    message,
    pushName: 'Tester',
  };
  const m = {
    key: incoming.key,
    id: incoming.key.id,
    chat,
    fromMe,
    isGroup: chat.endsWith('@g.us'),
    sender,
    type: native ? 'interactiveResponseMessage' : 'buttonsResponseMessage',
    msg: message,
    body: '',
    quoted: null,
    reply: async () => {},
    download: async () => Buffer.from('media'),
  };
  return { incoming, m };
}

const calls = [];
cmd({ pattern: 'testecho', desc: 'test echo', category: 'misc' }, async (_s, _mek, _m, c) => {
  calls.push({ command: 'testecho', q: c.q, args: c.args, target: c.getTargetJid ? c.getTargetJid() : '' });
  await c.reply(`echo:${c.q}`);
});
cmd({ pattern: 'testkill', desc: 'test destructive command', category: 'misc' }, async (_s, _mek, _m, c) => {
  calls.push({ command: 'testkill', q: c.q, args: c.args, target: c.getTargetJid ? c.getTargetJid() : '' });
  await c.reply('kill-ok');
});
cmd({ pattern: 'testchoice', desc: 'test choice', category: 'misc' }, async (_s, _mek, _m, c) => {
  calls.push({ command: 'testchoice', q: c.q, args: c.args, target: '' });
  await c.reply('choice-ok');
});
cmd({ pattern: 'testmedia', desc: 'test media', category: 'misc' }, async (_s, _mek, m, c) => {
  calls.push({ command: 'testmedia', q: c.q, type: m?.type, hasQuoted: !!m?.quoted });
  await c.reply('media-ok');
});

catalog.FEATURES.testecho = {
  id: 'testecho', label: 'Test Echo', emoji: '🧪', command: 'testecho', category: 'info',
  desc: 'Echo test input', prompt: { text: 'Send text for testecho.', required: true },
};
catalog.FEATURES.testkill = {
  id: 'testkill', label: 'Test Confirm', emoji: '☠️', command: 'testkill', category: 'info',
  desc: 'Confirmation test', prompt: { text: 'Send a target.', required: true, target: true },
  confirm: 'Really run the test action?',
};
catalog.FEATURES.testchoice = {
  id: 'testchoice', label: 'Test Choice', emoji: '🎛️', command: 'testchoice', category: 'info',
  desc: 'Choice test',
  choice: { current: () => 'a', options: [{ id: 'a', label: 'Option A', args: 'a' }, { id: 'b', label: 'Option B', args: 'b' }] },
};
catalog.FEATURES.testmedia = {
  id: 'testmedia', label: 'Test Media', emoji: '📎', command: 'testmedia', category: 'info',
  desc: 'Media prompt test',
  prompt: { text: 'Send an image.', acceptMedia: true, mediaKinds: ['imageMessage'], required: true },
};

async function main() {
  console.log('Interactive menu tests');

  await check('native quick replies include interactive nodes and stable ids', async () => {
    const sock = createSock();
    await messages.sendButtons(sock, OTHER, {
      title: 'Title', text: 'Body', footer: 'Footer',
      buttons: [{ id: 'ocm:nav:main', text: 'Main' }],
    });
    assert.strictEqual(sock.relayed.length, 1);
    const inner = sock.relayed[0].message.viewOnceMessage.message;
    assert.ok(inner.messageContextInfo);
    const buttons = nativeButtons(sock.relayed[0]);
    assert.strictEqual(buttons.length, 1);
    assert.strictEqual(JSON.parse(buttons[0].buttonParamsJson).id, 'ocm:nav:main');
    const tags = (sock.relayed[0].options.additionalNodes || []).map(n => n.tag);
    assert.ok(tags.includes('biz'));
    assert.ok(tags.includes('bot'), 'bot node is used in private chats');
    const biz = sock.relayed[0].options.additionalNodes.find(n => n.tag === 'biz');
    assert.strictEqual(biz.content[0].attrs.type, 'native_flow');
  });

  await check('native lists use listMessage and list nodes without bot node in groups', async () => {
    const sock = createSock();
    await messages.sendList(sock, GROUP, {
      title: 'Title', text: 'Body', buttonText: 'Open',
      sections: [{ title: 'S', rows: [{ id: 'ocm:nav:main', title: 'Main', description: 'Home' }] }],
    });
    const list = sock.relayed[0].message.listMessage;
    assert.ok(list);
    assert.strictEqual(list.sections[0].rows[0].rowId, 'ocm:nav:main');
    const tags = (sock.relayed[0].options.additionalNodes || []).map(n => n.tag);
    assert.ok(tags.includes('biz'));
    assert.ok(!tags.includes('bot'));
  });

  await check('readInteractiveReply understands every supported response shape', async () => {
    assert.deepStrictEqual(messages.readInteractiveReply({ buttonsResponseMessage: { selectedButtonId: 'ocm:all' } }), { id: 'ocm:all', kind: 'button' });
    assert.deepStrictEqual(messages.readInteractiveReply({ templateButtonReplyMessage: { selectedId: 'ocm:nav:main' } }), { id: 'ocm:nav:main', kind: 'template' });
    assert.deepStrictEqual(messages.readInteractiveReply({ listResponseMessage: { singleSelectReply: { selectedRowId: 'ocm:cat:media:1' } } }), { id: 'ocm:cat:media:1', kind: 'list' });
    assert.deepStrictEqual(messages.readInteractiveReply({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{"id":"ocm:nav:back"}' } } }), { id: 'ocm:nav:back', kind: 'native_flow' });
    assert.deepStrictEqual(messages.readInteractiveReply({ interactiveResponseMessage: { singleSelectReply: { selectedRowId: 'ocm:nav:close' } } }), { id: 'ocm:nav:close', kind: 'single_select' });
  });

  await check('permission-filtered categories and scopes', async () => {
    const privateUser = { isGroup: false, isOwner: false, isAdmins: false, isBotAdmins: false };
    const ids = catalog.categoriesFor(privateUser).map(c => c.id);
    assert.ok(ids.includes('downloads'));
    assert.ok(ids.includes('info'));
    assert.ok(!ids.includes('groups'));
    assert.ok(!ids.includes('settings'));
    assert.ok(!ids.includes('schedule'));
    const groupUser = { isGroup: true, isOwner: false, isAdmins: true, isBotAdmins: true };
    assert.ok(catalog.categoriesFor(groupUser).some(c => c.id === 'groups'));
    assert.ok(!catalog.categoriesFor(groupUser).some(c => c.id === 'settings'));
    assert.ok(catalog.categoriesFor({ isGroup: true, isOwner: true, isAdmins: true, isBotAdmins: true }).some(c => c.id === 'settings'));
  });

  await check('menu specs stay within WhatsApp row/button limits', async () => {
    const ctx = makeContext({ sock: createSock(), chat: GROUP, sender: GROUP_MEMBER, isGroup: true, isOwner: true, isAdmins: true, isBotAdmins: true });
    const main = menus.mainMenu(ctx);
    assert.strictEqual(main.buttons.length, 3);
    for (const category of catalog.CATEGORIES) {
      const spec = menus.categoryMenu(ctx, category.id, 1);
      if (!spec) continue;
      const count = spec.kind === 'buttons' ? spec.buttons.length : (spec.sections || []).reduce((n, s) => n + s.rows.length, 0);
      assert.ok(count <= 10, `${category.id} has ${count} rows/buttons`);
    }
    const all = menus.allCategories(ctx);
    assert.ok(all.sections[0].rows.length <= 10);
  });

  await check('classic text menu remains complete', async () => {
    const text = buildMenuText('.');
    assert.ok(text.includes('* .testecho*') || text.includes('*.testecho*'));
    assert.ok(text.includes('COMMANDS') || text.includes('MENU'));
    assert.ok(text.includes('Made by'));
  });

  await check('open menu, navigate to all categories, category page, and back', async () => {
    const sock = createSock();
    const ctx = makeContext({ sock });
    const { incoming, m } = textIncoming({ chat: OTHER, sender: OTHER, body: '.menu' });
    assert.strictEqual(await engine.openMenu({ sock, incoming, m, context: ctx }), true);
    assert.strictEqual(sock.relayed.length, 1);
    assert.strictEqual(buttonAction(sock.relayed[0], 0), 'ocm:cat:downloads:1');

    const all = responseIncoming({ chat: OTHER, sender: OTHER, actionId: 'ocm:all' });
    await engine.handle({ sock, incoming: all.incoming, m: all.m, context: ctx });
    assert.ok(sock.relayed[1].message.listMessage);
    const categories = listRows(sock.relayed[1]).map(r => r.rowId);
    assert.ok(categories.includes('ocm:cat:downloads:1'));

    const media = responseIncoming({ chat: OTHER, sender: OTHER, actionId: 'ocm:cat:media:1' });
    await engine.handle({ sock, incoming: media.incoming, m: media.m, context: ctx });
    assert.ok(sock.relayed[2].message.listMessage);
    assert.ok(listRows(sock.relayed[2]).some(r => r.rowId === 'ocm:feat:sticker'));

    const back = responseIncoming({ chat: OTHER, sender: OTHER, actionId: 'ocm:nav:back' });
    await engine.handle({ sock, incoming: back.incoming, m: back.m, context: ctx });
    assert.ok(sock.relayed[3].message.listMessage, 'back returns to the All features list');
    assert.ok(listRows(sock.relayed[3]).some(r => r.rowId === 'ocm:nav:main'));

    const backAgain = responseIncoming({ chat: OTHER, sender: OTHER, actionId: 'ocm:nav:back' });
    await engine.handle({ sock, incoming: backAgain.incoming, m: backAgain.m, context: ctx });
    assert.ok(sock.relayed[4].message.viewOnceMessage, 'second back returns to the main buttons');
  });

  await check('prompt collects text and invokes the original command', async () => {
    const sock = createSock();
    const ctx = makeContext({ sock });
    const open = textIncoming({ chat: OTHER, sender: OTHER, body: '.menu' });
    await engine.openMenu({ sock, incoming: open.incoming, m: open.m, context: ctx });

    calls.length = 0;
    const feature = responseIncoming({ chat: OTHER, sender: OTHER, actionId: 'ocm:feat:testecho' });
    await engine.handle({ sock, incoming: feature.incoming, m: feature.m, context: ctx });
    assert.ok(sock.sent.some(s => String(s.content.text || '').includes('Send text for testecho')));

    const answer = textIncoming({ chat: OTHER, sender: OTHER, body: 'hello world' });
    await engine.handle({ sock, incoming: answer.incoming, m: answer.m, context: ctx });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].q, 'hello world');
    assert.deepStrictEqual(calls[0].args, ['hello', 'world']);
    assert.ok(sock.sent.some(s => String(s.content.text || '').includes('echo:hello world')));
    assert.ok(sock.relayed.some(r => nativeButtons(r).some(b => JSON.parse(b.buttonParamsJson).id === 'ocm:nav:main')));
  });

  await check('destructive action asks for confirmation, then invokes command with target', async () => {
    const sock = createSock();
    const ctx = makeContext({ sock, chat: GROUP, sender: GROUP_MEMBER, isGroup: true, isOwner: true, isAdmins: true, isBotAdmins: true });
    const open = textIncoming({ chat: GROUP, sender: GROUP_MEMBER, body: '.menu', isGroup: true });
    await engine.openMenu({ sock, incoming: open.incoming, m: open.m, context: ctx });

    calls.length = 0;
    const feature = responseIncoming({ chat: GROUP, sender: GROUP_MEMBER, actionId: 'ocm:feat:testkill' });
    await engine.handle({ sock, incoming: feature.incoming, m: feature.m, context: ctx });
    const answer = textIncoming({ chat: GROUP, sender: GROUP_MEMBER, body: '94773333333', isGroup: true });
    await engine.handle({ sock, incoming: answer.incoming, m: answer.m, context: ctx });

    const confirmRelay = [...sock.relayed].reverse().find(r => nativeButtons(r).length === 2 && String(nativeButtons(r)[1].buttonParamsJson).includes('Cancel'));
    assert.ok(confirmRelay, 'confirmation buttons were sent');
    const confirmAction = buttonAction(confirmRelay, 0);
    assert.strictEqual(calls.length, 0, 'command must not run before confirmation');

    const confirm = responseIncoming({ chat: GROUP, sender: GROUP_MEMBER, actionId: confirmAction, native: true });
    await engine.handle({ sock, incoming: confirm.incoming, m: confirm.m, context: ctx });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].command, 'testkill');
    assert.strictEqual(calls[0].target, '94773333333@s.whatsapp.net');
  });

  await check('choice applies the selected option and reloads the category', async () => {
    const sock = createSock();
    const ctx = makeContext({ sock });
    const open = textIncoming({ chat: OTHER, sender: OTHER, body: '.menu' });
    await engine.openMenu({ sock, incoming: open.incoming, m: open.m, context: ctx });

    calls.length = 0;
    const feature = responseIncoming({ chat: OTHER, sender: OTHER, actionId: 'ocm:feat:testchoice' });
    await engine.handle({ sock, incoming: feature.incoming, m: feature.m, context: ctx });
    assert.ok(nativeButtons(sock.relayed[sock.relayed.length - 1]).some(b => String(b.buttonParamsJson).includes('ocm:choice:testchoice:b')));

    const choice = responseIncoming({ chat: OTHER, sender: OTHER, actionId: 'ocm:choice:testchoice:b' });
    await engine.handle({ sock, incoming: choice.incoming, m: choice.m, context: ctx });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].q, 'b');
    assert.ok(sock.relayed[sock.relayed.length - 1].message.listMessage, 'category list is shown again');
  });

  await check('media prompt accepts a direct image and passes it to the plugin', async () => {
    const sock = createSock();
    const ctx = makeContext({ sock });
    const open = textIncoming({ chat: OTHER, sender: OTHER, body: '.menu' });
    await engine.openMenu({ sock, incoming: open.incoming, m: open.m, context: ctx });

    const feature = responseIncoming({ chat: OTHER, sender: OTHER, actionId: 'ocm:feat:testmedia' });
    await engine.handle({ sock, incoming: feature.incoming, m: feature.m, context: ctx });

    const incoming = {
      key: { id: 'img1', remoteJid: OTHER, fromMe: false },
      message: { imageMessage: { caption: 'a photo', mimetype: 'image/jpeg' } },
      pushName: 'Tester',
    };
    const m = {
      key: incoming.key, id: 'img1', chat: OTHER, fromMe: false, isGroup: false, sender: OTHER,
      type: 'imageMessage', msg: incoming.message.imageMessage, body: 'a photo', quoted: null,
      reply: async () => {}, download: async () => Buffer.from('image-bytes'),
    };
    calls.length = 0;
    await engine.handle({ sock, incoming, m, context: ctx });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].command, 'testmedia');
    assert.strictEqual(calls[0].type, 'imageMessage');
    assert.strictEqual(calls[0].hasQuoted, false);
  });

  await check('self-chat uses numbered text fallback and number replies work', async () => {
    const sock = createSock();
    const ctx = makeContext({ sock, chat: BOT_JID, sender: BOT_JID, isOwner: true });
    const open = textIncoming({ chat: BOT_JID, sender: BOT_JID, body: '.menu', fromMe: true });
    await engine.openMenu({ sock, incoming: open.incoming, m: open.m, context: ctx });
    const firstText = sock.sent[sock.sent.length - 1]?.content?.text || '';
    assert.ok(firstText.includes('Reply with a number'));
    assert.ok(firstText.includes('1. 📥 Downloads'));
    assert.strictEqual(sock.relayed.length, 0, 'no native menu is attempted in self-chat');

    const reply = textIncoming({ chat: BOT_JID, sender: BOT_JID, body: '1', fromMe: true });
    await engine.handle({ sock, incoming: reply.incoming, m: reply.m, context: ctx });
    const secondText = sock.sent[sock.sent.length - 1]?.content?.text || '';
    assert.ok(secondText.includes('YouTube Video') || secondText.includes('Downloads'));
  });

  await check('duplicate deliveries do not run an action twice', async () => {
    const sock = createSock();
    const ctx = makeContext({ sock });
    const open = textIncoming({ chat: OTHER, sender: OTHER, body: '.menu' });
    await engine.openMenu({ sock, incoming: open.incoming, m: open.m, context: ctx });
    const before = sock.relayed.length;
    const action = responseIncoming({ id: 'duplicate-1', chat: OTHER, sender: OTHER, actionId: 'ocm:all' });
    await engine.handle({ sock, incoming: action.incoming, m: action.m, context: ctx });
    const afterFirst = sock.relayed.length;
    await engine.handle({ sock, incoming: action.incoming, m: action.m, context: ctx });
    assert.strictEqual(sock.relayed.length, afterFirst);
    assert.ok(afterFirst > before);
  });

  await check('per-user state is isolated in the same chat', async () => {
    const sock = createSock();
    const chat = GROUP;
    const alice = '94774444444@s.whatsapp.net';
    const bob = '94775555555@s.whatsapp.net';
    const aliceCtx = makeContext({ sock, chat, sender: alice, isGroup: true, isOwner: true, isAdmins: true, isBotAdmins: true });
    const bobCtx = makeContext({ sock, chat, sender: bob, isGroup: true, isOwner: true, isAdmins: true, isBotAdmins: true });
    const open = textIncoming({ chat, sender: alice, body: '.menu', isGroup: true });
    await engine.openMenu({ sock, incoming: open.incoming, m: open.m, context: aliceCtx });

    calls.length = 0;
    const feature = responseIncoming({ chat, sender: alice, actionId: 'ocm:feat:testecho' });
    await engine.handle({ sock, incoming: feature.incoming, m: feature.m, context: aliceCtx });

    const bobText = textIncoming({ chat, sender: bob, body: 'bob message', isGroup: true });
    const consumed = await engine.handle({ sock, incoming: bobText.incoming, m: bobText.m, context: bobCtx });
    assert.strictEqual(consumed, false, "Bob's ordinary message is not Alice's prompt answer");
    assert.strictEqual(calls.length, 0);

    const aliceText = textIncoming({ chat, sender: alice, body: 'alice answer', isGroup: true });
    await engine.handle({ sock, incoming: aliceText.incoming, m: aliceText.m, context: aliceCtx });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].q, 'alice answer');
  });

  await check('prefix command clears a pending prompt', async () => {
    const sock = createSock();
    const ctx = makeContext({ sock });
    const open = textIncoming({ chat: OTHER, sender: OTHER, body: '.menu' });
    await engine.openMenu({ sock, incoming: open.incoming, m: open.m, context: ctx });
    const feature = responseIncoming({ chat: OTHER, sender: OTHER, actionId: 'ocm:feat:testecho' });
    await engine.handle({ sock, incoming: feature.incoming, m: feature.m, context: ctx });

    const key = states.conversationKey('test', OTHER, OTHER);
    assert.ok(states.peekState(key)?.pending);
    const command = textIncoming({ chat: OTHER, sender: OTHER, body: '.ping' });
    const consumed = await engine.handle({ sock, incoming: command.incoming, m: command.m, context: ctx });
    assert.strictEqual(consumed, false);
    assert.strictEqual(states.peekState(key)?.pending, null);
  });

  await check('welcome/goodbye defaults, overrides and templates', async () => {
    const group = { id: '120@g.us', subject: 'Demo Group' };
    const jid = '94776666666@s.whatsapp.net';
    const base = { welcome: true, goodbye: false, groupWelcome: {} };
    const add = welcome.messageFor('add', jid, group, base);
    assert.strictEqual(add.text, '👋 Welcome @94776666666 to *Demo Group*!');
    assert.deepStrictEqual(add.mentions, [jid]);
    assert.strictEqual(welcome.messageFor('remove', jid, group, base), null);

    const off = { ...base, welcome: false };
    assert.strictEqual(welcome.messageFor('add', jid, group, off), null);
    welcome.setGroupOverride(off, group.id, { welcome: true, goodbye: true });
    assert.ok(welcome.messageFor('add', jid, group, off).text.includes('Welcome'));
    assert.ok(welcome.messageFor('remove', jid, group, off).text.includes('left the group'));

    welcome.setGroupOverride(off, group.id, { welcomeText: 'Hi {mention} — {group} ({number})' });
    assert.strictEqual(welcome.messageFor('add', jid, group, off).text, 'Hi @94776666666 — Demo Group (94776666666)');
    welcome.resetGroup(off, group.id);
    assert.strictEqual(welcome.messageFor('add', jid, group, off), null);
  });

  await check('scheduler update persists text and time', async () => {
    const at = Date.now() + 3600000;
    const item = sch.add({ accountId: 'test', jid: OTHER, text: 'first', at });
    assert.ok(item.id);
    const nextAt = at + 60000;
    const updated = sch.update('test', item.id, { text: 'second', at: nextAt });
    assert.strictEqual(updated.text, 'second');
    assert.strictEqual(updated.at, nextAt);
    assert.strictEqual(sch.get('test', item.id).text, 'second');
    assert.ok(sch.list('test').some(i => i.id === item.id));
    assert.strictEqual(sch.remove('test', item.id), true);
    assert.strictEqual(sch.get('test', item.id), null);
    assert.ok(sch.parseWhen('10m') > Date.now());
  });

  await check('schedule prompt helper parses an optional target', async () => {
    const parsed = engine.parseScheduleMessage('94771234567 | hello there');
    assert.strictEqual(parsed.jid, '94771234567@s.whatsapp.net');
    assert.strictEqual(parsed.text, 'hello there');
    const plain = engine.parseScheduleMessage('just a message');
    assert.strictEqual(plain.jid, null);
    assert.strictEqual(plain.text, 'just a message');
  });

  await check('schedule pagination exposes every page within the row limit', async () => {
    const accountId = 'pagetest';
    const made = [];
    for (let i = 0; i < 11; i += 1) {
      made.push(sch.add({ accountId, jid: OTHER, text: `page message ${i}`, at: Date.now() + 3600000 + i * 1000 }));
    }
    const ctx = makeContext({ sock: createSock(), isOwner: true });
    ctx.accountId = accountId;
    const ids = (spec) => spec.sections.flatMap(s => s.rows.map(r => r.id));
    const page1 = menus.scheduleMenu(ctx, 1);
    const page2 = menus.scheduleMenu(ctx, 2);
    const page3 = menus.scheduleMenu(ctx, 3);
    assert.ok(ids(page1).includes('ocm:sch:page:2'));
    assert.ok(!ids(page1).includes('ocm:sch:page:0'));
    assert.ok(ids(page2).includes('ocm:sch:page:1'));
    assert.ok(ids(page2).includes('ocm:sch:page:3'));
    assert.ok(ids(page3).includes('ocm:sch:page:2'));
    assert.ok(!ids(page3).includes('ocm:sch:page:4'));
    for (const spec of [page1, page2, page3]) {
      const rows = spec.sections.reduce((n, s) => n + s.rows.length, 0);
      assert.ok(rows <= 10, `schedule page has ${rows} rows`);
    }
    for (const item of made) sch.remove(accountId, item.id);
  });

  await check('action parser rejects unknown/unsafe ids', async () => {
    assert.deepStrictEqual(engine.parseAction('ocm:nav:main'), { type: 'main' });
    assert.deepStrictEqual(engine.parseAction('ocm:cat:downloads:2'), { type: 'category', id: 'downloads', page: 2 });
    assert.deepStrictEqual(engine.parseAction('ocm:feat:qr'), { type: 'feature', id: 'qr' });
    assert.strictEqual(engine.parseAction('ocm:feat:does_not_exist'), null);
    assert.strictEqual(engine.parseAction('hello'), null);
  });

  await check('expired/invalid native flow gets a clear reply', async () => {
    const sock = createSock();
    const ctx = makeContext({ sock });
    const bad = { interactiveResponseMessage: {} };
    const incoming = { key: { id: 'bad1', remoteJid: OTHER, fromMe: false }, message: bad, pushName: 'Tester' };
    const m = { key: incoming.key, id: 'bad1', chat: OTHER, sender: OTHER, isGroup: false, type: 'interactiveResponseMessage', msg: bad, body: '', reply: async () => {} };
    const consumed = await engine.handle({ sock, incoming, m, context: ctx });
    assert.strictEqual(consumed, true);
    assert.ok(sock.sent.some(s => String(s.content.text || '').includes('expired')));
  });

  console.log(`\n${passed} interactive tests passed. Offline only: native rendering on real WhatsApp clients was not tested.`);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

main().catch(err => {
  console.error('\nInteractive tests failed:');
  console.error(err?.stack || err);
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(1);
});
