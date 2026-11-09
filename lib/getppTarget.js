'use strict';
/**
 * Pure target resolution for `.getpp` (no socket, no Baileys).
 *
 * Priority:
 *   1. explicit mention (not the sender)
 *   2. literal "me"/"self"/"myself"  -> sender
 *   3. explicit WhatsApp JID or phone number
 *   4. no argument + a replied message  -> quoted sender
 *   5. no argument  -> sender
 *   6. anything else -> null (ask for a valid target)
 */
const JID_RE = /^(\d{7,15})(?::\d+)?@(s\.whatsapp\.net|lid|g\.us)$/i;
const PHONE_RE = /^\+?[\d\s()-]{7,20}$/;

function normalizeJid(jid) {
  const value = String(jid || '').trim();
  if (!value) return '';
  if (value.endsWith('@g.us') || value.endsWith('@s.whatsapp.net') || value.endsWith('@lid')) {
    return value.toLowerCase();
  }
  return value;
}

function resolveGetppTarget({ mentionUser = [], quotedSender = '', query = '', sender = '' } = {}) {
  const self = normalizeJid(sender);
  const mentions = (Array.isArray(mentionUser) ? mentionUser : [])
    .map(normalizeJid)
    .filter(jid => jid && jid !== self);
  if (mentions.length) return { jid: mentions[0], source: 'mention' };

  const q = String(query || '').trim();
  if (/^(me|self|myself)$/i.test(q)) return { jid: self, source: 'self' };

  // A bare `.getpp` (no argument) may be a reply: prefer the quoted sender so
  // replying to a message targets that person rather than the sender.
  if (!q) {
    if (quotedSender) return { jid: normalizeJid(quotedSender), source: 'reply' };
    return { jid: self, source: 'self' };
  }

  const jidMatch = q.match(JID_RE);
  if (jidMatch) return { jid: `${jidMatch[1]}@${jidMatch[2].toLowerCase()}`, source: 'jid' };

  if (PHONE_RE.test(q)) {
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) {
      return { jid: `${digits}@s.whatsapp.net`, source: 'number' };
    }
  }

  return { jid: null, source: 'unknown' };
}

module.exports = { JID_RE, PHONE_RE, normalizeJid, resolveGetppTarget };
