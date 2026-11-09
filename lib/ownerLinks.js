'use strict';
const config = require('../config');

/**
 * Single source of truth for the owner's contact/social links.
 *
 * Only platforms that are actually configured are returned. URLs are preserved
 * exactly as configured (after validating the protocol), never invented or
 * rewritten. This module is pure so it can be unit-tested without a socket.
 */

const PLATFORMS = [
  { id: 'github', emoji: '🐙', label: 'GitHub', key: 'OWNER_GITHUB' },
  { id: 'whatsapp', emoji: '💬', label: 'WhatsApp', key: 'OWNER_WHATSAPP' },
  { id: 'telegram', emoji: '✈️', label: 'Telegram', key: 'OWNER_TELEGRAM' },
  { id: 'instagram', emoji: '📸', label: 'Instagram', key: 'OWNER_INSTAGRAM' },
  { id: 'facebook', emoji: '📘', label: 'Facebook', key: 'OWNER_FACEBOOK' },
  { id: 'youtube', emoji: '▶️', label: 'YouTube', key: 'OWNER_YOUTUBE' },
  { id: 'website', emoji: '🌐', label: 'Website', key: 'OWNER_WEBSITE' },
];

function validUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(String(url));
    return ['http:', 'https:'].includes(u.protocol) ? String(url) : '';
  } catch {
    return '';
  }
}

function linksFromConfig(source = config) {
  const links = [];
  for (const platform of PLATFORMS) {
    let url = validUrl(source?.[platform.key]);
    // WhatsApp falls back to the configured owner number when no explicit
    // wa.me link is set. The number itself is never printed.
    if (!url && platform.id === 'whatsapp' && source?.BOT_OWNER) {
      const digits = String(source.BOT_OWNER).replace(/\D/g, '');
      if (digits) url = `https://wa.me/${digits}`;
    }
    if (url) links.push({ id: platform.id, emoji: platform.emoji, label: platform.label, url });
  }
  return links;
}

function getOwnerLinks() {
  return linksFromConfig(config);
}

/** Human-readable lines for text-only clients. */
function ownerLinkLines(links = getOwnerLinks()) {
  return links.map(l => `${l.emoji} *${l.label}:* ${l.url}`);
}

/** Short labels used above native URL buttons. No raw URLs in the main card. */
function linkSummary(links = getOwnerLinks()) {
  return links.map(l => `${l.emoji} ${l.label}`).join('  •  ');
}

/** Payload for lib/interactive/messages.sendUrlButtons (max 3). */
function linkButtons(links = getOwnerLinks()) {
  return links.slice(0, 3).map(l => ({ text: l.label, url: l.url }));
}

module.exports = {
  PLATFORMS,
  validUrl,
  linksFromConfig,
  getOwnerLinks,
  ownerLinkLines,
  linkSummary,
  linkButtons,
};
