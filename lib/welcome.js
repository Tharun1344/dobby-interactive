'use strict';
/**
 * Welcome / goodbye policy and rendering.
 *
 * Backwards compatibility is deliberate:
 *   - settings.welcome / settings.goodbye remain the global switches.
 *   - with no overrides the exact original messages are produced.
 * New (optional) settings:
 *   settings.welcomeText       global welcome template (blank = original text)
 *   settings.goodbyeText       global goodbye template (blank = original text)
 *   settings.groupWelcome[g]   { welcome?, goodbye?, welcomeText?, goodbyeText? }
 *
 * Templates understand {mention}, {name}, {number} and {group}. A group
 * override only exists for that group; deleting it falls back to the globals.
 */

const MAX_TEMPLATE = 1000;

function groupConfig(settings, chat) {
  const map = settings?.groupWelcome;
  return (map && typeof map === 'object' && map[chat]) || {};
}

function effective(settings, chat, key) {
  const override = groupConfig(settings, chat);
  if (typeof override[key] === 'boolean') return override[key];
  return !!settings?.[key];
}

function templateFor(settings, chat, key) {
  const override = groupConfig(settings, chat);
  const textKey = `${key}Text`;
  if (typeof override[textKey] === 'string' && override[textKey].trim()) return override[textKey];
  return String(settings?.[textKey] || '');
}

function isOverridden(settings, chat, key) {
  const override = groupConfig(settings, chat);
  return typeof override[key] === 'boolean' || (typeof override[`${key}Text`] === 'string' && !!override[`${key}Text`].trim());
}

function defaultText(action, jid, meta) {
  const number = String(jid || '').split('@')[0];
  if (action === 'add') return `👋 Welcome @${number} to *${meta?.subject || 'the group'}*!`;
  return `👋 @${number} left the group.`;
}

function renderTemplate(template, { jid, meta, name } = {}) {
  const number = String(jid || '').split('@')[0];
  return String(template)
    .replace(/\{mention\}/gi, `@${number}`)
    .replace(/\{name\}/gi, name || number)
    .replace(/\{number\}/gi, number)
    .replace(/\{group\}/gi, meta?.subject || 'the group')
    .slice(0, 4000);
}

/**
 * Build the message for one participant event.
 * @returns {{text:string, mentions:string[]}|null} null means "do not send".
 */
function messageFor(action, jid, meta, settings) {
  const key = action === 'add' ? 'welcome' : action === 'remove' ? 'goodbye' : '';
  if (!key || !jid) return null;
  if (!effective(settings, meta?.id || '', key)) return null;
  const template = templateFor(settings, meta?.id || '', key);
  const text = template.trim()
    ? renderTemplate(template, { jid, meta })
    : defaultText(action, jid, meta);
  return { text, mentions: [jid] };
}

function setGroupOverride(settings, chat, patch) {
  if (!chat) throw new Error('A group JID is required.');
  if (!settings.groupWelcome || typeof settings.groupWelcome !== 'object') settings.groupWelcome = {};
  const current = settings.groupWelcome[chat] || {};
  const next = { ...current };
  for (const key of ['welcome', 'goodbye']) {
    if (patch[key] === 'inherit') delete next[key];
    else if (typeof patch[key] === 'boolean') next[key] = patch[key];
  }
  for (const key of ['welcomeText', 'goodbyeText']) {
    if (patch[key] === null) delete next[key];
    else if (typeof patch[key] === 'string') {
      const value = patch[key].trim().slice(0, MAX_TEMPLATE);
      if (value) next[key] = value;
      else delete next[key];
    }
  }
  if (Object.keys(next).length) settings.groupWelcome[chat] = next;
  else delete settings.groupWelcome[chat];
  return settings.groupWelcome[chat] || null;
}

function resetGroup(settings, chat) {
  if (settings?.groupWelcome && chat) delete settings.groupWelcome[chat];
}

function setGlobalText(settings, key, value) {
  if (!['welcomeText', 'goodbyeText'].includes(key)) throw new Error('Unknown welcome text key.');
  const text = String(value == null ? '' : value).trim().slice(0, MAX_TEMPLATE);
  if (text) settings[key] = text;
  else delete settings[key];
}

function resetGlobalTexts(settings) {
  delete settings.welcomeText;
  delete settings.goodbyeText;
}

function statusLine(settings, chat, key) {
  const on = effective(settings, chat, key);
  const scope = isOverridden(settings, chat, key) ? 'this group' : 'global';
  return `${on ? 'ON ✅' : 'OFF ❌'} (${scope})`;
}

module.exports = {
  MAX_TEMPLATE,
  groupConfig,
  effective,
  templateFor,
  isOverridden,
  defaultText,
  renderTemplate,
  messageFor,
  setGroupOverride,
  resetGroup,
  setGlobalText,
  resetGlobalTexts,
  statusLine,
};
