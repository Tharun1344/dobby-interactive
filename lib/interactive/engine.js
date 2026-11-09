'use strict';
/**
 * Central interactive engine.
 *
 * Responsibilities:
 *   - send native WhatsApp button/list menus, or a numbered text menu fallback
 *   - validate every returned action id against the catalog (never display text)
 *   - keep independent navigation/prompt state per account + chat + user
 *   - collect missing input, then invoke the EXISTING plugin command
 *   - handle confirms, pagination, back/home/cancel, expiry and duplicates
 *
 * No feature logic is duplicated here. If a menu entry maps to a command, the
 * original plugin in plugins/*.js still performs the work.
 */
const crypto = require('crypto');
const { sendButtons, sendList, readInteractiveReply, normalizeJid } = require('./messages');
const states = require('./state');
const {
  ACTION_PREFIX, SCOPE_LABELS, getFeature, getCategory, isCategoryVisible, scopeAllowed,
} = require('./catalog');
const menus = require('./menus');
const welcome = require('../welcome');
const sch = require('../scheduler');
const menuMode = require('../menuMode');
const usage = require('../usage');
const { commands } = require('../../command');
const settingsStore = require('../settings');

const TEXT_MENU_TTL_MS = 15 * 60 * 1000;
const MEDIA_TYPES = new Set(['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage']);
const SCHEDULE_ID_RE = /^[a-z0-9]{2,16}$/i;

function enabled() {
  return String(process.env.INTERACTIVE_ENABLED || 'true').toLowerCase() !== 'false';
}

function ownerOnly(ctx) { return !!ctx.isOwner; }
function saveSettings(ctx) {
  try { settingsStore.save(ctx.settings); return true; }
  catch (err) { console.error('[interactive] settings save failed:', err.message); return false; }
}

function selfJids(sock) {
  return [sock?.user?.id, sock?.user?.lid].map(v => { try { return normalizeJid(v || ''); } catch { return ''; } }).filter(Boolean);
}

/** Self-chat disables native quick replies, so it always gets the text menu. */
function isSelfChat(sock, ctx, incoming) {
  if (ctx.isGroup) return false;
  const from = normalizeJid(ctx.from || '');
  if (selfJids(sock).includes(from)) return true;
  return !!incoming?.key?.fromMe && normalizeJid(ctx.sender || '') === normalizeJid(sock?.user?.id || '');
}

function textOnly(sock, ctx, incoming) {
  if (String(process.env.INTERACTIVE_TEXT_ONLY || '').toLowerCase() === 'true') return true;
  if (!menuMode.canUseInteractive(ctx.accountId)) return true;
  return isSelfChat(sock, ctx, incoming);
}

async function sendText(sock, ctx, incoming, text) {
  try {
    await sock.sendMessage(ctx.from, { text: String(text).slice(0, 60000) }, { quoted: incoming });
    return true;
  } catch (err) {
    console.error(`[interactive] text send failed to ${ctx.from}:`, err?.message || err);
    return false;
  }
}

function buildReply(sock, ctx, quoted) {
  return (text, options = {}) => {
    const content = { text: String(text), ...(options?.mentions ? { mentions: options.mentions } : {}) };
    return sock.sendMessage(ctx.from, content, { quoted }).catch(err => {
      console.error(`[interactive] reply failed to ${ctx.from}:`, err?.message || err);
      throw err;
    });
  };
}

function menuBaseId(menuId) {
  if (menuId === 'main' || menuId === 'all') return menuId;
  if (menuId.startsWith('cat:')) return menuId.split(':').slice(0, 2).join(':');
  if (menuId.startsWith('schedule:view:')) return menuId;
  if (menuId.startsWith('schedule:')) return 'schedule';
  if (menuId.startsWith('welcome:')) return menuId;
  return menuId;
}

function buildMenuSpec(ctx, menuId) {
  if (menuId === 'main') return menus.mainMenu(ctx);
  if (menuId === 'all') return menus.allCategories(ctx);
  if (menuId.startsWith('cat:')) {
    const [, categoryId, page] = menuId.split(':');
    return menus.categoryMenu(ctx, categoryId, Number(page) || 1);
  }
  if (menuId === 'welcome:group') return menus.welcomeMenu(ctx, 'group');
  if (menuId === 'welcome:global') return menus.welcomeMenu(ctx, 'global');
  if (menuId.startsWith('schedule:view:')) {
    const id = menuId.slice('schedule:view:'.length);
    if (!SCHEDULE_ID_RE.test(id)) return menus.scheduleMenu(ctx, 1);
    return menus.scheduleView(ctx, sch.get(ctx.accountId || 'default', id));
  }
  if (menuId.startsWith('schedule:')) {
    const page = Number(menuId.split(':')[1]) || 1;
    return menus.scheduleMenu(ctx, page);
  }
  return null;
}

async function sendTextSpec(sock, ctx, incoming, state, spec) {
  const { text, map } = menus.textMenu(spec);
  const sent = await sendText(sock, ctx, incoming, text);
  if (sent) state.textMenu = { at: Date.now(), map, menuId: spec.menuId || state.currentMenu || null };
  return sent;
}

async function sendSpec(sock, ctx, incoming, state, spec) {
  if (!spec) return false;
  if (textOnly(sock, ctx, incoming)) return sendTextSpec(sock, ctx, incoming, state, spec);
  try {
    if (spec.kind === 'buttons') {
      await sendButtons(sock, ctx.from, {
        title: spec.title,
        text: spec.text,
        footer: spec.footer,
        buttons: spec.buttons,
        quoted: incoming,
      });
    } else if (spec.kind === 'list') {
      await sendList(sock, ctx.from, {
        title: spec.title,
        text: spec.text,
        footer: spec.footer,
        buttonText: spec.buttonText || 'Select',
        sections: spec.sections,
        quoted: incoming,
      });
    } else {
      return sendTextSpec(sock, ctx, incoming, state, spec);
    }
    state.textMenu = null;
    return true;
  } catch (err) {
    console.warn(`[interactive] native ${spec.kind} send failed, using text menu: ${err?.message || err}`);
    return sendTextSpec(sock, ctx, incoming, state, spec);
  }
}

async function renderMenu(sock, incoming, ctx, state, menuId, { push = false } = {}) {
  let spec = buildMenuSpec(ctx, menuId);
  if (!spec) {
    const categoryStem = menuId.startsWith('cat:') ? menuId.split(':').slice(0, 2).join(':') : '';
    spec = categoryStem ? menus.categoryMenu(ctx, categoryStem.split(':')[1], 1) : menus.mainMenu(ctx);
    menuId = spec?.menuId || 'main';
  }
  if (!spec) return false;
  const base = menuBaseId(menuId);
  if (push) states.pushMenu(state, base);
  state.currentMenu = spec.menuId || menuId;
  state.lastMenu = base;
  return sendSpec(sock, ctx, incoming, state, spec);
}

async function showMain(sock, incoming, ctx, state) {
  states.resetNavigation(state);
  state.stack = ['main'];
  state.currentMenu = 'main';
  state.lastMenu = 'main';
  return sendSpec(sock, ctx, incoming, state, menus.mainMenu(ctx));
}

async function showReturnMenu(sock, incoming, ctx, state, fallback = 'main') {
  const target = state.currentMenu || state.lastMenu || fallback;
  return renderMenu(sock, incoming, ctx, state, target, { push: false });
}

async function denied(sock, ctx, incoming, feature) {
  const scope = SCOPE_LABELS[feature?.scope] || 'restricted';
  await sendText(sock, ctx, incoming, `⛔ *${feature?.label || 'This feature'}* — ${scope}.\n\nමේ menu එක ඔබට භාවිත කළ නොහැක.`);
}

function findCommand(name) {
  const target = String(name || '').toLowerCase();
  return commands.find(c => String(c.pattern || '').toLowerCase() === target
    || (c.alias || []).map(a => String(a).toLowerCase()).includes(target)) || null;
}

function resolveTarget(m, text, sender) {
  const mentioned = (m?.mentionUser || []).find(j => j && normalizeJid(j) !== normalizeJid(sender));
  if (mentioned) return normalizeJid(mentioned);
  const digits = String(text || '').replace(/\D/g, '');
  if (digits.length >= 7 && digits.length <= 15) return `${digits}@s.whatsapp.net`;
  if (m?.quoted?.sender) return normalizeJid(m.quoted.sender);
  return null;
}

function mediaPromptMessage(m, feature) {
  const kinds = feature.prompt?.mediaKinds || [];
  if (!m || !kinds.length) return null;
  const direct = kinds.includes(m.type);
  const quoted = !!(m.quoted && kinds.includes(m.quoted.type));
  if (!direct && !quoted) return null;
  if (!direct) return m;
  // These plugins read m.quoted only; a direct upload has to be presented as
  // the quoted source. sticker/vision prefer a direct upload over a stale quote.
  if (feature.command === 'toimage' || feature.command === 'take') return { ...m, quoted: m };
  if (feature.command === 'sticker' || feature.command === 'vision') return { ...m, quoted: null };
  return m;
}

async function runFeature(sock, incoming, ctx, state, feature, payload = {}) {
  if (!feature) return { ok: false };
  if (!scopeAllowed(feature.scope || 'everyone', ctx)) {
    await denied(sock, ctx, incoming, feature);
    return { ok: false, denied: true };
  }
  const plugin = findCommand(feature.command);
  if (!plugin) {
    await sendText(sock, ctx, incoming, `❌ Command *${feature.command}* is not registered (plugin missing).`);
    return { ok: false };
  }
  if (plugin.fromMe && !ownerOnly(ctx)) {
    await sendText(sock, ctx, incoming, '⛔ Owner only feature.');
    return { ok: false, denied: true };
  }

  const q = String(payload.q == null ? '' : payload.q).trim();
  const args = Array.isArray(payload.args) ? payload.args : q.split(/\s+/).filter(Boolean);
  const target = payload.target || null;
  const answerIncoming = payload.incoming || incoming;
  const pluginMessage = payload.message || null;
  const pluginCtx = {
    ...ctx,
    command: feature.command,
    commandName: feature.command,
    args,
    q,
    body: `${ctx.prefix || '.'}${feature.command}${q ? ` ${q}` : ''}`,
    isCmd: true,
    interactive: true,
    reply: buildReply(sock, ctx, answerIncoming),
    getTargetJid: () => target || resolveTarget(payload.message, q, ctx.sender),
  };

  let ok = true;
  try {
    await plugin.function(sock, answerIncoming, pluginMessage, pluginCtx);
  } catch (err) {
    ok = false;
    console.error(`[interactive] .${feature.command} failed:`, err?.stack || err);
    await sendText(sock, ctx, incoming, `❌ *${feature.label}* failed. Check the bot logs.`);
  }
  if (payload.done !== false) {
    await sendSpec(sock, ctx, incoming, state, menus.featureDone(ctx, feature));
  }
  return { ok };
}

function promptFingerprint(feature, q, target) {
  return [feature?.id || '', String(q || '').slice(0, 80), String(target || '')].join('|');
}

function newToken() { return crypto.randomBytes(5).toString('hex'); }

function clearPrompt(state) {
  state.pending = null;
  state.confirm = null;
  state.textMenu = null;
}

function usageHint(feature, prefix = '.') {
  const entry = usage.getUsage(feature?.command);
  if (!entry) return '';
  return [
    '',
    '',
    `📘 *How to use ${prefix}${entry.command}*`,
    `🎯 ${entry.purpose}`,
    ...(entry.usage || []).slice(0, 2).map(line => `• ${usage.replacePrefix(line, prefix)}`),
    `✅ ${entry.result}`,
  ].join('\n');
}

async function sendConfirm(sock, incoming, ctx, state, { kind, feature, title, text, details, returnMenu, ...extra }) {
  const token = newToken();
  states.setConfirm(state, {
    kind, token, featureId: feature?.id || null, title, returnMenu: returnMenu || state.currentMenu || 'main', ...extra,
  });
  const spec = {
    kind: 'buttons',
    menuId: null,
    title: title || '⚠️ Confirm',
    text: [text, details ? `\n${details}` : ''].filter(Boolean).join('\n'),
    footer: 'මෙය වහාම ක්‍රියාත්මක වේ. අවශ්‍ය නම් Cancel කරන්න.',
    buttons: [
      { id: `${ACTION_PREFIX}confirm:${token}`, text: '✅ Confirm' },
      { id: `${ACTION_PREFIX}cancel`, text: '✖️ Cancel' },
    ],
  };
  return sendSpec(sock, ctx, incoming, state, spec);
}

async function startFeature(sock, incoming, ctx, state, feature, currentMessage = null) {
  if (!scopeAllowed(feature.scope || 'everyone', ctx)) {
    await denied(sock, ctx, incoming, feature);
    return;
  }
  clearPrompt(state);
  if (feature.manual) {
    await sendText(sock, ctx, incoming, feature.manual);
    await sendSpec(sock, ctx, incoming, state, menus.featureDone(ctx, feature));
    return;
  }
  if (feature.choice) {
    const spec = menus.choiceMenu(ctx, feature);
    if (!spec.buttons.length) {
      await sendText(sock, ctx, incoming, '⚠️ No options configured for this feature.');
      return;
    }
    await sendSpec(sock, ctx, incoming, state, spec);
    return;
  }
  if (feature.prompt) {
    state.pending = states.setPending(state, {
      kind: 'feature',
      featureId: feature.id,
      returnMenu: state.currentMenu || `cat:${feature.category}:1`,
    });
    state.confirm = null;
    state.textMenu = null;
    const hint = feature.prompt.acceptMedia
      ? '\n\n📎 Image/video/sticker එකක් යවන්න. /cancel = cancel.'
      : '\n\n✖️ Cancel කරන්න */cancel* යවන්න.';
    await sendText(sock, ctx, incoming, `${feature.prompt.text}${hint}${usageHint(feature, ctx.prefix)}`);
    return;
  }
  await runFeature(sock, incoming, ctx, state, feature, { message: currentMessage });
}

function parseScheduleMessage(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const parts = raw.split('|').map(s => s.trim());
  let jid = null;
  let text = raw;
  if (parts.length >= 2 && /^\+?\d{7,15}$/.test(parts[0].replace(/[\s-]/g, ''))) {
    jid = `${parts[0].replace(/\D/g, '')}@s.whatsapp.net`;
    text = parts.slice(1).join(' | ').trim();
  }
  if (!text) return null;
  return { jid, text: text.slice(0, 4000) };
}

async function finishFeatureInput(sock, incoming, ctx, state, feature, { q, args, target, message }) {
  state.pending = null;
  state.textMenu = null;
  if (feature.confirm) {
    const details = [];
    if (target) details.push(`🎯 Target: @${String(target).split('@')[0]}`);
    if (q) details.push(`💬 ${String(q).slice(0, 220)}`);
    await sendConfirm(sock, incoming, ctx, state, {
      kind: 'feature',
      feature,
      title: `⚠️ ${feature.label}`,
      text: feature.confirm,
      details: details.join('\n'),
      returnMenu: state.currentMenu || `cat:${feature.category}:1`,
      q, args, target,
    });
    return;
  }
  await runFeature(sock, incoming, ctx, state, feature, { q, args, target, message, incoming });
}

async function processPending(sock, incoming, ctx, state, m, body) {
  const pending = states.getPending(state);
  if (!pending) return false;
  if (!states.markSeen(incoming?.key?.id, `pending:${pending.kind}`)) return true;
  const raw = String(body || '').trim();
  if (/^\/cancel$/i.test(raw) || /^cancel$/i.test(raw)) {
    state.pending = null;
    state.textMenu = null;
    await sendText(sock, ctx, incoming, '✖️ Cancelled.');
    await showReturnMenu(sock, incoming, ctx, state, pending.returnMenu);
    return true;
  }

  if (pending.kind === 'feature') {
    const feature = getFeature(pending.featureId);
    if (!feature || !feature.prompt) { state.pending = null; await sendText(sock, ctx, incoming, '⚠️ This prompt is no longer available.'); return true; }

    if (feature.prompt.acceptMedia) {
      const pluginMessage = mediaPromptMessage(m, feature);
      if (!pluginMessage) {
        const kinds = (feature.prompt.mediaKinds || []).map(k => k.replace('Message', '')).join(', ');
        await sendText(sock, ctx, incoming, `📎 ${feature.label}: ${kinds || 'media'} එකක් අවශ්‍යයි.\nනැවත යවන්න, නැත්නම් /cancel යවන්න.`);
        return true;
      }
      const q = String(m?.body || '').trim();
      const args = q ? q.split(/\s+/) : [];
      await finishFeatureInput(sock, incoming, ctx, state, feature, { q, args, target: null, message: pluginMessage });
      return true;
    }

    if (!raw) {
      await sendText(sock, ctx, incoming, `✏️ ${feature.label}: පිළිතුරක් යවන්න. /cancel = cancel.`);
      return true;
    }
    const q = feature.prompt.buildArgs ? String(feature.prompt.buildArgs(raw) || '') : raw;
    const args = q ? q.split(/\s+/) : [];
    const target = feature.prompt.target ? resolveTarget(m, raw, ctx.sender) : null;
    if (feature.prompt.target && !target) {
      await sendText(sock, ctx, incoming, '🎯 Member එකකට reply/mention කරන්න, නැත්නම් phone number එකක් යවන්න. /cancel = cancel.');
      return true;
    }
    await finishFeatureInput(sock, incoming, ctx, state, feature, { q, args, target, message: m });
    return true;
  }

  if (pending.kind === 'welcomeText') {
    const value = raw === '-' ? null : raw;
    if (value === null) {
      if (pending.scope === 'global') welcome.setGlobalText(ctx.settings, `${pending.key}Text`, '');
      else welcome.setGroupOverride(ctx.settings, ctx.from, { [`${pending.key}Text`]: null });
    } else {
      if (!value) { await sendText(sock, ctx, incoming, '✏️ Text එකක් යවන්න, නැත්නම් - = reset. /cancel = cancel.'); return true; }
      if (pending.scope === 'global') welcome.setGlobalText(ctx.settings, `${pending.key}Text`, value);
      else welcome.setGroupOverride(ctx.settings, ctx.from, { [`${pending.key}Text`]: value });
    }
    if (!saveSettings(ctx)) { await sendText(sock, ctx, incoming, '❌ Settings save failed.'); return true; }
    state.pending = null;
    await sendText(sock, ctx, incoming, value === null ? '♻️ Text reset to the original default.' : '✅ Text saved.');
    await renderMenu(sock, incoming, ctx, state, pending.scope === 'global' ? 'welcome:global' : 'welcome:group', { push: false });
    return true;
  }

  if (pending.kind === 'scheduleNew') {
    if (pending.step === 'when') {
      const at = sch.parseWhen(raw);
      if (!at) {
        await sendText(sock, ctx, incoming, '❓ වෙලාව තේරුණේ නැහැ.\n\n• 10m / 2h / 1h30m / 1d\n• 18:30 / 6:30pm\n• tomorrow 07:00\n• 2026-10-25 18:30\n\n/cancel = cancel');
        return true;
      }
      state.pending = states.setPending(state, { ...pending, step: 'message', whenAt: at });
      await sendText(sock, ctx, incoming, [
        '⏰ *Step 2/2 — message*',
        '',
        `🕒 ${sch.formatLocal(at)}`,
        'යවන්න ඕන message එක යවන්න.',
        'වෙන chat එකකට යවන්න නම්: *94771234567 | message*',
        '',
        '✖️ /cancel = cancel',
      ].join('\n'));
      return true;
    }
    const parsed = parseScheduleMessage(raw);
    if (!parsed) { await sendText(sock, ctx, incoming, '✏️ Message එකක් යවන්න. /cancel = cancel'); return true; }
    try {
      const item = sch.add({ accountId: ctx.accountId || 'default', jid: parsed.jid || ctx.from, text: parsed.text, at: pending.whenAt });
      state.pending = null;
      await sendText(sock, ctx, incoming, `✅ Schedule කළා!\n🆔 ${item.id}\n🕒 ${sch.formatLocal(item.at)}\n📨 ${item.jid.split('@')[0]}`);
      await renderMenu(sock, incoming, ctx, state, 'schedule:1', { push: false });
    } catch (err) {
      await sendText(sock, ctx, incoming, `❌ ${err.message}`);
    }
    return true;
  }

  if (pending.kind === 'scheduleTime') {
    const at = sch.parseWhen(raw);
    if (!at || at <= Date.now()) {
      await sendText(sock, ctx, incoming, '❓ ඊළඟ වෙලාවක් යවන්න. උදා: 10m, 18:30, tomorrow 07:00.\n/cancel = cancel');
      return true;
    }
    if (!sch.update(ctx.accountId || 'default', pending.scheduleId, { at })) {
      state.pending = null;
      await sendText(sock, ctx, incoming, '❓ මේ schedule එක හමු නොවීය (already sent/cancelled).');
      await renderMenu(sock, incoming, ctx, state, 'schedule:1', { push: false });
      return true;
    }
    state.pending = null;
    await sendText(sock, ctx, incoming, `✅ Time updated: ${sch.formatLocal(at)}`);
    await renderMenu(sock, incoming, ctx, state, `schedule:view:${pending.scheduleId}`, { push: false });
    return true;
  }

  if (pending.kind === 'scheduleText') {
    const parsed = parseScheduleMessage(raw);
    if (!parsed) { await sendText(sock, ctx, incoming, '✏️ Message එකක් යවන්න. /cancel = cancel'); return true; }
    const patch = { text: parsed.text };
    if (parsed.jid) patch.jid = parsed.jid;
    if (!sch.update(ctx.accountId || 'default', pending.scheduleId, patch)) {
      state.pending = null;
      await sendText(sock, ctx, incoming, '❓ මේ schedule එක හමු නොවීය (already sent/cancelled).');
      await renderMenu(sock, incoming, ctx, state, 'schedule:1', { push: false });
      return true;
    }
    state.pending = null;
    await sendText(sock, ctx, incoming, '✅ Message updated.');
    await renderMenu(sock, incoming, ctx, state, `schedule:view:${pending.scheduleId}`, { push: false });
    return true;
  }

  state.pending = null;
  return false;
}

async function handleWelcomeAction(sock, incoming, ctx, state, action) {
  if (action.type === 'welcome') {
    if (action.scope === 'global' && !ownerOnly(ctx)) return denied(sock, ctx, incoming, { label: 'Global welcome', scope: 'owner' });
    clearPrompt(state);
    await renderMenu(sock, incoming, ctx, state, action.scope === 'global' ? 'welcome:global' : 'welcome:group', { push: true });
    return;
  }

  const scope = action.scope;
  const key = action.key;
  const global = scope === 'global';
  const allowed = global ? ownerOnly(ctx) : (ctx.isGroup && (ctx.isAdmins || ctx.isOwner));
  if (!allowed) return denied(sock, ctx, incoming, { label: 'Welcome settings', scope: global ? 'owner' : 'welcomeAdmin' });
  clearPrompt(state);

  if (action.type === 'wset') {
    if (global) {
      if (!['welcome', 'goodbye'].includes(key) || !['on', 'off'].includes(action.value)) return;
      ctx.settings[key] = action.value === 'on';
    } else {
      if (!['welcome', 'goodbye'].includes(key) || !['on', 'off', 'inherit'].includes(action.value)) return;
      welcome.setGroupOverride(ctx.settings, ctx.from, { [key]: action.value === 'inherit' ? 'inherit' : action.value === 'on' });
    }
    if (!saveSettings(ctx)) return sendText(sock, ctx, incoming, '❌ Settings save failed.');
    await renderMenu(sock, incoming, ctx, state, global ? 'welcome:global' : 'welcome:group', { push: false });
    return;
  }

  if (action.type === 'wtext') {
    if (!['welcome', 'goodbye'].includes(key)) return;
    const current = global ? String(ctx.settings[`${key}Text`] || '') : welcome.templateFor(ctx.settings, ctx.from, key);
    state.pending = states.setPending(state, { kind: 'welcomeText', scope, key, returnMenu: global ? 'welcome:global' : 'welcome:group' });
    state.confirm = null;
    state.textMenu = null;
    await sendText(sock, ctx, incoming, [
      `${key === 'welcome' ? '👋 Welcome' : '👋 Goodbye'} text — ${global ? 'global' : 'this group'}`,
      '',
      current ? `📌 Current:\n${current}` : '📌 Current: original default text',
      '',
      'New text එක යවන්න. Placeholders: {mention} {name} {number} {group}',
      '♻️ - = reset to default',
      '✖️ /cancel = cancel',
    ].join('\n'));
    return;
  }

  if (action.type === 'wreset') {
    await sendConfirm(sock, incoming, ctx, state, {
      kind: 'welcomeReset',
      title: global ? '♻️ Reset global texts' : '♻️ Reset group settings',
      text: global
        ? 'Global welcome/goodbye texts original default වලට reset කරන්නද? Toggles වෙනස් නොවේ.'
        : 'මේ group එකේ welcome/goodbye overrides ඔක්කොම remove කරන්නද? Global settings නැවත භාවිත වේ.',
      returnMenu: global ? 'welcome:global' : 'welcome:group',
      scope,
    });
  }
}

async function handleScheduleAction(sock, incoming, ctx, state, action) {
  if (!ownerOnly(ctx)) return denied(sock, ctx, incoming, { label: 'Scheduled messages', scope: 'owner' });
  const accountId = ctx.accountId || 'default';

  if (action.type === 'schPage') {
    clearPrompt(state);
    await renderMenu(sock, incoming, ctx, state, `schedule:${action.page}`, { push: false });
    return;
  }
  if (action.type === 'schNew') {
    clearPrompt(state);
    state.pending = states.setPending(state, { kind: 'scheduleNew', step: 'when', returnMenu: 'schedule:1' });
    state.confirm = null;
    state.textMenu = null;
    await sendText(sock, ctx, incoming, [
      '⏰ *New scheduled message — Step 1/2*',
      '',
      'වෙලාව යවන්න:',
      '• 10m / 2h / 1h30m / 1d',
      '• 18:30 / 6:30pm',
      '• tomorrow 07:00',
      '• 2026-10-25 18:30',
      '',
      `🕒 Timezone: UTC${sch.TZ_OFFSET_MIN >= 0 ? '+' : '-'}${Math.floor(Math.abs(sch.TZ_OFFSET_MIN) / 60)}:${String(Math.abs(sch.TZ_OFFSET_MIN) % 60).padStart(2, '0')}`,
      '✖️ /cancel = cancel',
    ].join('\n'));
    return;
  }
  if (action.type === 'schView') {
    if (!SCHEDULE_ID_RE.test(action.id)) return;
    const item = sch.get(accountId, action.id);
    if (!item) {
      await sendText(sock, ctx, incoming, '❓ මේ schedule එක හමු නොවීය (already sent/cancelled).');
      await renderMenu(sock, incoming, ctx, state, 'schedule:1', { push: false });
      return;
    }
    clearPrompt(state);
    await renderMenu(sock, incoming, ctx, state, `schedule:view:${item.id}`, { push: true });
    return;
  }
  if (action.type === 'schTime' || action.type === 'schText') {
    if (!SCHEDULE_ID_RE.test(action.id)) return;
    const item = sch.get(accountId, action.id);
    if (!item) {
      await sendText(sock, ctx, incoming, '❓ මේ schedule එක හමු නොවීය.');
      await renderMenu(sock, incoming, ctx, state, 'schedule:1', { push: false });
      return;
    }
    clearPrompt(state);
    const time = action.type === 'schTime';
    state.pending = states.setPending(state, {
      kind: time ? 'scheduleTime' : 'scheduleText',
      scheduleId: item.id,
      returnMenu: `schedule:view:${item.id}`,
    });
    state.confirm = null;
    state.textMenu = null;
    await sendText(sock, ctx, incoming, time
      ? `✏️ *Edit time* — ${item.id}\n\nNew time එක යවන්න: 10m, 18:30, tomorrow 07:00…\n\n✖️ /cancel = cancel`
      : `✏️ *Edit message* — ${item.id}\n\nNew message එක යවන්න.\nTarget එකත් වෙනස් කරන්න නම්: *94771234567 | message*\n\n✖️ /cancel = cancel`);
    return;
  }
  if (action.type === 'schCancel') {
    if (!SCHEDULE_ID_RE.test(action.id)) return;
    const item = sch.get(accountId, action.id);
    if (!item) {
      await sendText(sock, ctx, incoming, '❓ මේ schedule එක හමු නොවීය.');
      await renderMenu(sock, incoming, ctx, state, 'schedule:1', { push: false });
      return;
    }
    clearPrompt(state);
    await sendConfirm(sock, incoming, ctx, state, {
      kind: 'scheduleCancel',
      title: `🗑️ Cancel schedule ${item.id}`,
      text: `🕒 ${sch.formatLocal(item.at)}\n💬 ${String(item.text).slice(0, 220)}`,
      returnMenu: `schedule:view:${item.id}`,
      scheduleId: item.id,
    });
  }
}

async function handleAction(sock, incoming, ctx, state, action, currentMessage = null) {
  if (!action) {
    await sendText(sock, ctx, incoming, '⚠️ මේ menu එක expired හෝ invalid. නැවත *.menu* යවන්න.');
    return;
  }

  if (action.type === 'main') return showMain(sock, incoming, ctx, state);
  if (action.type === 'back') {
    clearPrompt(state);
    const previous = states.popMenu(state);
    if (!previous || previous === 'main' || !state.stack.length) return showMain(sock, incoming, ctx, state);
    return renderMenu(sock, incoming, ctx, state, previous, { push: false });
  }
  if (action.type === 'close') {
    states.resetNavigation(state);
    await sendText(sock, ctx, incoming, '✖️ Menu closed. නැවත open කරන්න *.menu* යවන්න.');
    return;
  }
  if (action.type === 'cancel') {
    const returnMenu = state.confirm?.returnMenu || state.currentMenu || 'main';
    clearPrompt(state);
    await sendText(sock, ctx, incoming, '✖️ Cancelled.');
    return renderMenu(sock, incoming, ctx, state, returnMenu, { push: false });
  }
  if (action.type === 'all') {
    clearPrompt(state);
    return renderMenu(sock, incoming, ctx, state, 'all', { push: true });
  }
  if (action.type === 'category') {
    const category = getCategory(action.id);
    if (!category || !isCategoryVisible(category, ctx)) {
      await sendText(sock, ctx, incoming, '⛔ මේ category එක මේ chat/account එකට නොගැලපේ.');
      return;
    }
    clearPrompt(state);
    return renderMenu(sock, incoming, ctx, state, `cat:${category.id}:${action.page || 1}`, { push: true });
  }
  if (action.type === 'feature') {
    const feature = getFeature(action.id);
    if (!feature) return sendText(sock, ctx, incoming, '⚠️ Unknown feature.');
    return startFeature(sock, incoming, ctx, state, feature, currentMessage);
  }
  if (action.type === 'choice') {
    const feature = getFeature(action.featureId);
    if (!feature || !feature.choice) return sendText(sock, ctx, incoming, '⚠️ Unknown choice.');
    if (!scopeAllowed(feature.scope || 'everyone', ctx)) return denied(sock, ctx, incoming, feature);
    const option = (feature.choice.options || []).find(o => o.id === action.optionId);
    if (!option) return sendText(sock, ctx, incoming, '⚠️ Unknown option.');
    clearPrompt(state);
    const q = String(option.args == null ? '' : option.args).trim();
    const args = q ? q.split(/\s+/) : [];
    await runFeature(sock, incoming, ctx, state, feature, { q, args, done: false, message: currentMessage });
    const current = state.currentMenu || '';
    let target = `cat:${feature.category}:1`;
    if (current.startsWith('welcome:')) target = current;
    else if (current.startsWith('cat:welcome')) target = 'cat:welcome';
    return renderMenu(sock, incoming, ctx, state, target, { push: false });
  }
  if (action.type === 'confirm') {
    const confirm = states.getConfirm(state);
    if (!confirm || confirm.token !== action.token) {
      state.confirm = null;
      await sendText(sock, ctx, incoming, '⚠️ මේ confirmation එක expired. නැවත try කරන්න.');
      return showReturnMenu(sock, incoming, ctx, state, 'main');
    }
    state.confirm = null;
    if (confirm.kind === 'feature') {
      const feature = getFeature(confirm.featureId);
      if (!feature) return sendText(sock, ctx, incoming, '⚠️ Feature no longer available.');
      return runFeature(sock, incoming, ctx, state, feature, { q: confirm.q, args: confirm.args, target: confirm.target, message: currentMessage });
    }
    if (confirm.kind === 'scheduleCancel') {
      if (!ownerOnly(ctx)) return denied(sock, ctx, incoming, { label: 'Scheduled messages', scope: 'owner' });
      const removed = sch.remove(ctx.accountId || 'default', confirm.scheduleId);
      await sendText(sock, ctx, incoming, removed ? `🗑️ ${confirm.scheduleId} cancel කළා.` : '❓ Schedule එක හමු නොවීය.');
      return renderMenu(sock, incoming, ctx, state, 'schedule:1', { push: false });
    }
    if (confirm.kind === 'welcomeReset') {
      const allowed = confirm.scope === 'global' ? ownerOnly(ctx) : (ctx.isGroup && (ctx.isAdmins || ctx.isOwner));
      if (!allowed) return denied(sock, ctx, incoming, { label: 'Welcome settings', scope: confirm.scope === 'global' ? 'owner' : 'welcomeAdmin' });
      if (confirm.scope === 'global') welcome.resetGlobalTexts(ctx.settings);
      else welcome.resetGroup(ctx.settings, ctx.from);
      if (!saveSettings(ctx)) return sendText(sock, ctx, incoming, '❌ Settings save failed.');
      await sendText(sock, ctx, incoming, '♻️ Reset කළා.');
      return renderMenu(sock, incoming, ctx, state, confirm.scope === 'global' ? 'welcome:global' : 'welcome:group', { push: false });
    }
    return;
  }
  if (['welcome', 'wset', 'wtext', 'wreset'].includes(action.type)) {
    return handleWelcomeAction(sock, incoming, ctx, state, action);
  }
  if (['schPage', 'schNew', 'schView', 'schTime', 'schText', 'schCancel'].includes(action.type)) {
    return handleScheduleAction(sock, incoming, ctx, state, action);
  }
  if (action.type === 'infoLinks') {
    clearPrompt(state);
    const { getOwnerLinks, ownerLinkLines } = require('../ownerLinks');
    const links = getOwnerLinks();
    await sendText(sock, ctx, incoming, links.length
      ? `📲 *Developer & Links*\n\n${ownerLinkLines(links).join('\n')}`
      : '📲 Owner links are not configured.');
    return sendSpec(sock, ctx, incoming, state, menus.featureDone(ctx, { label: 'Owner links', emoji: '🔗', category: 'info' }));
  }
  if (action.type === 'infoText') {
    clearPrompt(state);
    await sendText(sock, ctx, incoming, menus.infoText(ctx));
    return sendSpec(sock, ctx, incoming, state, menus.featureDone(ctx, { label: 'Text command list', emoji: '📜', category: 'info' }));
  }
  await sendText(sock, ctx, incoming, '⚠️ Unknown menu action.');
}

function parseAction(raw) {
  const value = String(raw || '');
  if (!value.startsWith(ACTION_PREFIX)) return null;
  const parts = value.slice(ACTION_PREFIX.length).split(':');
  const head = parts[0];

  if (head === 'nav') {
    if (parts[1] === 'main') return { type: 'main' };
    if (parts[1] === 'back') return { type: 'back' };
    if (parts[1] === 'close') return { type: 'close' };
    return null;
  }
  if (head === 'all') return { type: 'all' };
  if (head === 'cat' && getCategory(parts[1])) return { type: 'category', id: parts[1], page: Number(parts[2]) || 1 };
  if (head === 'feat' && getFeature(parts[1])) return { type: 'feature', id: parts[1] };
  if (head === 'choice' && getFeature(parts[1])) return { type: 'choice', featureId: parts[1], optionId: parts[2] };
  if (head === 'confirm' && parts[1]) return { type: 'confirm', token: parts[1] };
  if (head === 'cancel') return { type: 'cancel' };
  if (head === 'welcome' && ['group', 'global'].includes(parts[1])) return { type: 'welcome', scope: parts[1] };
  if (head === 'wset' && ['group', 'global'].includes(parts[1])) {
    return { type: 'wset', scope: parts[1], key: parts[2], value: parts[3] };
  }
  if (head === 'wtext' && ['group', 'global'].includes(parts[1])) {
    return { type: 'wtext', scope: parts[1], key: parts[2] };
  }
  if (head === 'wreset' && ['group', 'global'].includes(parts[1])) return { type: 'wreset', scope: parts[1] };
  if (head === 'sch') {
    if (parts[1] === 'new') return { type: 'schNew' };
    if (parts[1] === 'page') return { type: 'schPage', page: Math.max(1, Number(parts[2]) || 1) };
    if (['view', 'time', 'text', 'cancel'].includes(parts[1]) && parts[2]) {
      return { type: `sch${parts[1][0].toUpperCase()}${parts[1].slice(1)}`, id: parts[2] };
    }
  }
  if (head === 'info' && parts[1] === 'links') return { type: 'infoLinks' };
  if (head === 'info' && parts[1] === 'text') return { type: 'infoText' };
  return null;
}

async function processTextChoice(sock, incoming, ctx, state, m, body) {
  const map = state.textMenu?.map || {};
  const actionId = map[String(body)];
  if (!actionId) {
    const max = Math.max(0, ...Object.keys(map).map(Number));
    await sendText(sock, ctx, incoming, `❓ 1${max > 1 ? `-${max}` : ''} අතර අංකයක් යවන්න. නැවත open කරන්න .menu.`);
    return true;
  }
  if (!states.markSeen(incoming?.key?.id, `text:${body}`)) return true;
  state.textMenu = null;
  const action = parseAction(actionId);
  await handleAction(sock, incoming, ctx, state, action, m);
  return true;
}

async function handleLocked(sock, account, incoming, m, ctx, kind, payload) {
  const key = states.conversationKey(ctx.accountId, ctx.from, ctx.sender);
  const state = states.getState(key);
  if (kind === 'action') {
    if (!states.markSeen(incoming?.key?.id, payload.action.id)) return true;
    await handleAction(sock, incoming, ctx, state, payload.action, m);
    return true;
  }
  if (kind === 'text') return processTextChoice(sock, incoming, ctx, state, m, payload.body);
  if (kind === 'pending') return processPending(sock, incoming, ctx, state, m, payload.body);
  return false;
}

/**
 * Entry point used by index.js for every incoming message. Returns true when
 * the message was consumed by the interactive layer.
 */
async function handle({ sock, incoming, m, context }) {
  if (!enabled()) return false;
  const ctx = context;
  const key = states.conversationKey(ctx.accountId, ctx.from, ctx.sender);
  const body = String(m?.body || '').trim();
  const prefix = String(ctx.prefix || '.');
  const isCmd = body.startsWith(prefix);
  const commandName = isCmd ? body.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase() : '';
  const response = readInteractiveReply(incoming?.message);
  const peek = states.peekState(key);
  const pending = peek ? states.getPending(peek) : null;
  const confirm = peek ? states.getConfirm(peek) : null;
  let textMenu = peek?.textMenu || null;
  if (textMenu && Date.now() - textMenu.at > TEXT_MENU_TTL_MS) {
    peek.textMenu = null;
    textMenu = null;
  }

  try {
    if (response) {
      if (!response.id) {
        await sendText(sock, ctx, incoming, '⚠️ මේ menu එක expired හෝ invalid. නැවත *.menu* යවන්න.');
        return true;
      }
      if (!String(response.id).startsWith(ACTION_PREFIX)) return false;
      const action = parseAction(response.id);
      if (!action) {
        await sendText(sock, ctx, incoming, '⚠️ මේ menu එක expired හෝ invalid. නැවත *.menu* යවන්න.');
        return true;
      }
      return await states.withLock(key, () => handleLocked(sock, null, incoming, m, ctx, 'action', { action }));
    }

    if (isCmd) {
      if (peek && (pending || confirm || textMenu)) {
        peek.pending = null;
        peek.confirm = null;
        peek.textMenu = null;
      }
      if (commandName === 'cancel' && (pending || confirm || textMenu)) {
        await sendText(sock, ctx, incoming, '✖️ Cancelled.');
        if (peek) await showReturnMenu(sock, incoming, ctx, peek, 'main');
        return true;
      }
      return false;
    }

    if (/^\/(cancel|close)$/i.test(body)) {
      if (peek && (pending || confirm || textMenu)) {
        peek.pending = null;
        peek.confirm = null;
        peek.textMenu = null;
        await sendText(sock, ctx, incoming, '✖️ Cancelled.');
        await showReturnMenu(sock, incoming, ctx, peek, 'main');
        return true;
      }
    }

    if (pending) {
      const hasMedia = MEDIA_TYPES.has(m?.type) || !!(m?.quoted && MEDIA_TYPES.has(m.quoted.type));
      if (!body && !hasMedia) return false;
      return await states.withLock(key, () => handleLocked(sock, null, incoming, m, ctx, 'pending', { body }));
    }

    if (textMenu && /^\d{1,2}$/.test(body)) {
      return await states.withLock(key, () => handleLocked(sock, null, incoming, m, ctx, 'text', { body }));
    }

    if (textMenu && body) peek.textMenu = null;
    return false;
  } catch (err) {
    console.error('[interactive] handler failed:', err?.stack || err);
    await sendText(sock, ctx, incoming, '❌ Interactive menu error. නැවත *.menu* යවන්න.');
    return true;
  }
}

/** Open the main menu from the .menu plugin. Returns false when disabled. */
async function openMenu({ sock, incoming, m, context }) {
  if (!enabled()) return false;
  const ctx = context;
  const key = states.conversationKey(ctx.accountId, ctx.from, ctx.sender);
  const state = states.getState(key);
  try {
    return await showMain(sock, incoming, ctx, state);
  } catch (err) {
    console.error('[interactive] openMenu failed:', err?.stack || err);
    return false;
  }
}

module.exports = {
  enabled,
  handle,
  openMenu,
  parseAction,
  buildMenuSpec,
  menuBaseId,
  resolveTarget,
  parseScheduleMessage,
  isSelfChat,
};
