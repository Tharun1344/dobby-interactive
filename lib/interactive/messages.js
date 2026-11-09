'use strict';
/**
 * Native WhatsApp interactive message transport for Baileys 6.7.x.
 *
 * Baileys' normal sendMessage() path does not understand `interactiveMessage`,
 * so these helpers build the WAMessage directly and relay it with the binary
 * nodes WhatsApp expects. They use the same shapes as the official client:
 *
 *   quick replies / CTA buttons:
 *     viewOnceMessage -> messageContextInfo + interactiveMessage
 *     additionalNodes: biz > interactive(native_flow,v=1) > native_flow(v=9,mixed)
 *                      + bot(biz_bot=1) in private chats
 *
 *   classic lists:
 *     listMessage
 *     additionalNodes: biz > list(type=product_list,v=2)
 *
 * Classic ListMessage is used for menus because the native-flow single_select
 * variant does not render on iOS. Quick replies are used for small choices.
 *
 * Every caller must have a text fallback. This module never claims a message
 * rendered just because relayMessage resolved.
 */
const {
  proto,
  generateWAMessageFromContent,
  jidNormalizedUser,
} = require('@whiskeysockets/baileys');

const LIMITS = Object.freeze({
  HEADER: 60,
  BODY: 1024,
  FOOTER: 120,
  BUTTON_TEXT: 20,
  ROW_TITLE: 24,
  ROW_DESC: 72,
  SECTION_TITLE: 24,
  LIST_BUTTON: 20,
  MAX_BUTTONS: 3,
  MAX_LIST_ROWS: 10,
});

function clip(value, max) {
  const s = String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function normalizeJid(jid) {
  try { return jidNormalizedUser(String(jid || '')); } catch { return String(jid || ''); }
}

function isGroupJid(jid) { return String(jid).endsWith('@g.us'); }

function interactiveNodes(jid, { botNode = true } = {}) {
  const nodes = [{
    tag: 'biz',
    attrs: {},
    content: [{
      tag: 'interactive',
      attrs: { type: 'native_flow', v: '1' },
      content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
    }],
  }];
  // The bot node enables the AI badge and improves rendering in 1:1 chats.
  // It is not used in groups. Some operators prefer no badge; INTERACTIVE_BOT_NODE=false.
  const addBot = botNode && String(process.env.INTERACTIVE_BOT_NODE || 'true').toLowerCase() !== 'false';
  if (addBot && !isGroupJid(jid)) nodes.push({ tag: 'bot', attrs: { biz_bot: '1' } });
  return nodes;
}

function listNodes() {
  return [{
    tag: 'biz',
    attrs: {},
    content: [{ tag: 'list', attrs: { type: 'product_list', v: '2' } }],
  }];
}

function buildQuickReply(button) {
  return {
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({
      display_text: clip(button.text || button.displayText || 'Option', LIMITS.BUTTON_TEXT),
      id: String(button.id || '').slice(0, 220),
    }),
  };
}

function buildUrlButton(button) {
  const url = String(button.url || '');
  return {
    name: 'cta_url',
    buttonParamsJson: JSON.stringify({
      display_text: clip(button.text || button.displayText || 'Open', LIMITS.BUTTON_TEXT),
      url,
      merchant_url: url,
    }),
  };
}

/**
 * Send up to three quick-reply buttons.
 * @param {object} sock Baileys socket
 * @param {string} jid destination
 * @param {{title?:string,text:string,footer?:string,buttons:Array<{id:string,text:string}>,quoted?:object}} data
 */
async function sendButtons(sock, jid, data = {}) {
  const buttons = Array.isArray(data.buttons) ? data.buttons.filter(b => b && b.id && (b.text || b.displayText)) : [];
  if (!buttons.length) throw new Error('sendButtons: no buttons');
  if (buttons.length > LIMITS.MAX_BUTTONS) throw new Error('sendButtons: WhatsApp allows max 3 buttons');
  if (!data.text) throw new Error('sendButtons: text is required');

  const interactiveMessage = proto.Message.InteractiveMessage.create({
    header: proto.Message.InteractiveMessage.Header.create({
      title: clip(data.title || '', LIMITS.HEADER),
      hasMediaAttachment: false,
    }),
    body: proto.Message.InteractiveMessage.Body.create({ text: clip(data.text, LIMITS.BODY) }),
    footer: proto.Message.InteractiveMessage.Footer.create({ text: clip(data.footer || '', LIMITS.FOOTER) }),
    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
      messageVersion: 1,
      buttons: buttons.map(buildQuickReply),
    }),
  });

  const msg = generateWAMessageFromContent(jid, {
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage,
      },
    },
  }, { quoted: data.quoted, userJid: sock.user?.id });

  await sock.relayMessage(jid, msg.message, {
    messageId: msg.key.id,
    additionalNodes: interactiveNodes(jid),
  });
  return msg;
}

/**
 * Send up to three URL buttons (native cta_url). Falls back to text by throwing;
 * callers are expected to catch and send links as text.
 */
async function sendUrlButtons(sock, jid, data = {}) {
  const links = (data.links || []).filter(l => l && /^https?:\/\//i.test(String(l.url || ''))).slice(0, LIMITS.MAX_BUTTONS);
  if (!links.length) throw new Error('sendUrlButtons: no links');
  if (!data.text) throw new Error('sendUrlButtons: text is required');

  const interactiveMessage = proto.Message.InteractiveMessage.create({
    header: proto.Message.InteractiveMessage.Header.create({
      title: clip(data.title || '', LIMITS.HEADER),
      hasMediaAttachment: false,
    }),
    body: proto.Message.InteractiveMessage.Body.create({ text: clip(data.text, LIMITS.BODY) }),
    footer: proto.Message.InteractiveMessage.Footer.create({ text: clip(data.footer || '', LIMITS.FOOTER) }),
    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
      messageVersion: 1,
      buttons: links.map(buildUrlButton),
    }),
  });

  const msg = generateWAMessageFromContent(jid, {
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage,
      },
    },
  }, { quoted: data.quoted, userJid: sock.user?.id });

  await sock.relayMessage(jid, msg.message, {
    messageId: msg.key.id,
    additionalNodes: interactiveNodes(jid),
  });
  return msg;
}

function normalizeSections(sections) {
  let total = 0;
  const out = [];
  for (const section of sections || []) {
    const rows = [];
    for (const row of section.rows || []) {
      if (total >= LIMITS.MAX_LIST_ROWS) break;
      if (!row || !row.id || !row.title) continue;
      rows.push({
        title: clip(row.title, LIMITS.ROW_TITLE),
        description: clip(row.description || '', LIMITS.ROW_DESC),
        rowId: String(row.id).slice(0, 220),
      });
      total += 1;
    }
    if (rows.length) out.push({ title: clip(section.title || '', LIMITS.SECTION_TITLE), rows });
    if (total >= LIMITS.MAX_LIST_ROWS) break;
  }
  return out;
}

/**
 * Send a classic single-select list.
 * @param {{title?:string,text:string,footer?:string,buttonText:string,sections:Array,quoted?:object}} data
 */
async function sendList(sock, jid, data = {}) {
  if (!data.text) throw new Error('sendList: text is required');
  if (!data.buttonText) throw new Error('sendList: buttonText is required');
  const sections = normalizeSections(data.sections);
  if (!sections.length) throw new Error('sendList: no rows');

  const listMessage = proto.Message.ListMessage.create({
    title: clip(data.title || '', LIMITS.HEADER),
    description: clip(data.text, LIMITS.BODY),
    buttonText: clip(data.buttonText, LIMITS.LIST_BUTTON),
    listType: proto.Message.ListMessage.ListType.SINGLE_SELECT,
    sections,
    footerText: clip(data.footer || '', LIMITS.FOOTER),
  });

  const msg = generateWAMessageFromContent(jid, { listMessage }, {
    quoted: data.quoted,
    userJid: sock.user?.id,
  });

  await sock.relayMessage(jid, msg.message, {
    messageId: msg.key.id,
    additionalNodes: listNodes(),
  });
  return msg;
}

/** Read a button/list selection from a raw incoming message, without using display text. */
function readInteractiveReply(message) {
  if (!message || typeof message !== 'object') return null;

  // Unwrap transport wrappers but never use visible display text as the action.
  let content = message;
  for (let i = 0; i < 4; i += 1) {
    if (content.ephemeralMessage?.message) { content = content.ephemeralMessage.message; continue; }
    if (content.viewOnceMessage?.message?.interactiveMessage || content.viewOnceMessage?.message?.interactiveResponseMessage) {
      content = content.viewOnceMessage.message; continue;
    }
    if (content.documentWithCaptionMessage?.message) { content = content.documentWithCaptionMessage.message; continue; }
    break;
  }

  const templateId = content.templateButtonReplyMessage?.selectedId;
  if (templateId) return { id: String(templateId), kind: 'template' };

  const buttonId = content.buttonsResponseMessage?.selectedButtonId;
  if (buttonId) return { id: String(buttonId), kind: 'button' };

  const listId = content.listResponseMessage?.singleSelectReply?.selectedRowId;
  if (listId) return { id: String(listId), kind: 'list' };

  const response = content.interactiveResponseMessage;
  if (response) {
    const paramsRaw = response.nativeFlowResponseMessage?.paramsJson;
    if (paramsRaw) {
      try {
        const params = JSON.parse(paramsRaw);
        if (params && params.id) return { id: String(params.id), kind: 'native_flow' };
      } catch { /* malformed, fall through */ }
    }
    const selected = response.singleSelectReply?.selectedRowId;
    if (selected) return { id: String(selected), kind: 'single_select' };
    return { id: '', kind: 'unknown_native_flow' };
  }

  return null;
}

module.exports = {
  LIMITS,
  clip,
  normalizeJid,
  isGroupJid,
  sendButtons,
  sendUrlButtons,
  sendList,
  readInteractiveReply,
  interactiveNodes,
  listNodes,
};
