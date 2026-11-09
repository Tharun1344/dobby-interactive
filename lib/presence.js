'use strict';
/**
 * Presence switch — does the bot keep the account "online"?
 *
 * The bot runs on the owner's own WhatsApp number, so a bot that reports "available" makes the owner
 * look permanently online. ALWAYS_ONLINE=false (or `.online off`) stops that: the socket never
 * announces availability and sends "unavailable" instead, so the phone's own presence wins.
 */
let online = String(process.env.ALWAYS_ONLINE || 'true').toLowerCase() !== 'false';

module.exports = {
  get online() { return online; },
  set(value) { online = Boolean(value); },
  envDefault() { return String(process.env.ALWAYS_ONLINE || 'true').toLowerCase() !== 'false'; },
};