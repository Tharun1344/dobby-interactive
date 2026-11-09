'use strict';
/**
 * Pure menu renderers. They build plain specs ("buttons" or "list"), which the
 * engine sends either natively or as a numbered text menu. No socket calls here.
 */
const config = require('../../config');
const { ACTION_PREFIX, categoriesFor, featuresForCategory, getCategory, getFeature, SCOPE_LABELS } = require('./catalog');
const welcome = require('../welcome');
const sch = require('../scheduler');
const { commands } = require('../../command');

const id = (...parts) => `${ACTION_PREFIX}${parts.join(':')}`;
const CATEGORY_PAGE_SIZE = 6;
const SCHEDULE_PAGE_SIZE = 5;

function featureRow(feature) {
  return {
    id: id('feat', feature.id),
    title: `${feature.emoji || '•'} ${feature.label}`,
    description: feature.desc || '',
  };
}

function navRows({ back = true, home = true, close = true, prev = null, next = null } = {}) {
  const rows = [];
  if (prev) rows.push({ id: prev, title: '⬅️ Previous page', description: 'Go back one page' });
  if (next) rows.push({ id: next, title: '➡️ Next page', description: 'See more entries' });
  if (back) rows.push({ id: id('nav', 'back'), title: '↩️ Back', description: 'Previous menu' });
  if (home) rows.push({ id: id('nav', 'main'), title: '🏠 Main menu', description: 'Start again' });
  if (close) rows.push({ id: id('nav', 'close'), title: '✖️ Close menu', description: 'Hide the menu' });
  return rows;
}

function mainMenu(ctx) {
  const visible = categoriesFor(ctx);
  const commandCount = commands.filter(c => !c.dontAddCommandList && !c.hidden).length;
  return {
    kind: 'buttons',
    menuId: 'main',
    title: config.BOT_NAME || "Tharun's WhatsApp Bot",
    text: [
      '✨ *Interactive menu* ✨',
      '🇱🇰 Sinhala • Singlish • English',
      '',
      `📌 *Prefix:* ${ctx.prefix || '.'}`,
      `🧩 *Commands:* ${commandCount}`,
      `📚 *Categories:* ${visible.length}`,
      '',
      'Category එකක් තෝරන්න, නැත්නම් *All features* එකෙන් සියල්ල බලන්න.',
    ].join('\n'),
    footer: 'Buttons නොපෙනේ නම් .menu text යවන්න.',
    buttons: [
      { id: id('cat', 'downloads', 1), text: '📥 Downloads' },
      { id: id('cat', 'movies', 1), text: '🎬 Movies' },
      { id: id('all'), text: '📚 All features' },
    ],
  };
}

function allCategories(ctx) {
  const rows = categoriesFor(ctx).slice(0, 9).map(category => ({
    id: id('cat', category.id, 1),
    title: `${category.emoji} ${category.label}`,
    description: category.desc || '',
  }));
  rows.push({ id: id('nav', 'main'), title: '🏠 Main menu', description: 'Back to the home menu' });
  return {
    kind: 'list',
    menuId: 'all',
    title: '📚 All features',
    text: 'ඔබට භාවිත කළ හැකි categories. Group/owner tools එකේ scope එකට අනුව ලැබේ.',
    footer: 'Tip: .menu text = full command list • /cancel = close',
    buttonText: 'Categories',
    sections: [{ title: 'Categories', rows: rows.slice(0, 10) }],
  };
}

function categoryMenu(ctx, categoryId, page = 1) {
  const category = getCategory(categoryId);
  if (!category) return null;

  if (category.custom === 'welcome') return welcomeMenu(ctx, ctx.isGroup ? 'group' : 'global');
  if (category.custom === 'schedule') return scheduleMenu(ctx, page);

  const items = featuresForCategory(categoryId, ctx).map(featureRow);
  if (category.extras?.includes('links')) {
    items.push({ id: id('info', 'links'), title: '🔗 Owner links', description: 'GitHub, website, WhatsApp and socials' });
  }
  if (category.extras?.includes('menutext')) {
    items.push({ id: id('info', 'text'), title: '📜 Text command list', description: 'Classic .menu output' });
  }
  if (!items.length) return null;

  const totalPages = Math.max(1, Math.ceil(items.length / CATEGORY_PAGE_SIZE));
  const current = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const slice = items.slice((current - 1) * CATEGORY_PAGE_SIZE, current * CATEGORY_PAGE_SIZE);
  const rows = [...slice, ...navRows({
    prev: current > 1 ? id('cat', categoryId, current - 1) : null,
    next: current < totalPages ? id('cat', categoryId, current + 1) : null,
    // Middle pages carry both arrows; drop the least essential row to stay <= 10.
    close: !(current > 1 && current < totalPages),
  })].slice(0, 10);

  return {
    kind: 'list',
    menuId: `cat:${categoryId}:${current}`,
    title: `${category.emoji} ${category.label}`,
    text: [
      category.desc || '',
      totalPages > 1 ? `📄 Page ${current}/${totalPages}` : '',
      'Feature එකක් තෝරන්න. Prompt එකක් ආවොත් උත්තරය යවන්න.',
    ].filter(Boolean).join('\n'),
    footer: 'Back/Home/Cancel: list එකේ පහළ rows.',
    buttonText: 'Select',
    sections: [
      { title: category.label, rows: rows.slice(0, slice.length) },
      { title: 'Navigation', rows: rows.slice(slice.length) },
    ].filter(section => section.rows.length),
  };
}

function toggleRow(key, textLabel, effectiveOn, scope, nextValue) {
  return {
    id: id('wset', scope, key, nextValue),
    title: `${textLabel}: ${effectiveOn ? 'ON' : 'OFF'}`,
    description: `Tap to turn ${effectiveOn ? 'OFF' : 'ON'}`,
  };
}

function welcomeMenu(ctx, scope) {
  const settings = ctx.settings || {};
  if (scope === 'global') {
    const rows = [
      toggleRow('welcome', '🌍 Global welcome', !!settings.welcome, 'global', settings.welcome ? 'off' : 'on'),
      toggleRow('goodbye', '🌍 Global goodbye', !!settings.goodbye, 'global', settings.goodbye ? 'off' : 'on'),
      { id: id('wtext', 'global', 'welcome'), title: '✏️ Global welcome text', description: settings.welcomeText ? 'Custom template set' : 'Using the original default' },
      { id: id('wtext', 'global', 'goodbye'), title: '✏️ Global goodbye text', description: settings.goodbyeText ? 'Custom template set' : 'Using the original default' },
      { id: id('wreset', 'global'), title: '♻️ Reset global texts', description: 'Back to the original default text' },
      ...navRows({ back: true, home: true, close: true }),
    ].slice(0, 10);
    return {
      kind: 'list',
      menuId: 'welcome:global',
      title: '🌍 Global welcome & goodbye',
      text: [
        `👋 Welcome: ${settings.welcome ? 'ON ✅' : 'OFF ❌'}`,
        `👋 Goodbye: ${settings.goodbye ? 'ON ✅' : 'OFF ❌'}`,
        '',
        'Templates: {mention} {name} {number} {group}',
        'Global settings apply to every group without its own override.',
      ].join('\n'),
      footer: 'Owner settings • per-group overrides win',
      buttonText: 'Settings',
      sections: [{ title: 'Global settings', rows }],
    };
  }

  const rows = [
    {
      id: id('wset', 'group', 'welcome', welcome.effective(settings, ctx.from, 'welcome') ? 'off' : 'on'),
      title: `👋 Welcome: ${welcome.effective(settings, ctx.from, 'welcome') ? 'ON' : 'OFF'}`,
      description: `Now: ${welcome.statusLine(settings, ctx.from, 'welcome')} • tap to switch`,
    },
    {
      id: id('wset', 'group', 'goodbye', welcome.effective(settings, ctx.from, 'goodbye') ? 'off' : 'on'),
      title: `👋 Goodbye: ${welcome.effective(settings, ctx.from, 'goodbye') ? 'ON' : 'OFF'}`,
      description: `Now: ${welcome.statusLine(settings, ctx.from, 'goodbye')} • tap to switch`,
    },
    { id: id('wtext', 'group', 'welcome'), title: '✏️ Set welcome text', description: welcome.templateFor(settings, ctx.from, 'welcome') ? 'Custom template set' : 'Using the original default' },
    { id: id('wtext', 'group', 'goodbye'), title: '✏️ Set goodbye text', description: welcome.templateFor(settings, ctx.from, 'goodbye') ? 'Custom template set' : 'Using the original default' },
    { id: id('wreset', 'group'), title: '♻️ Reset this group', description: 'Remove all overrides, follow global again' },
  ];
  if (ctx.isOwner) rows.push({ id: id('welcome', 'global'), title: '🌍 Global settings', description: 'Owner-only defaults for every group' });
  rows.push(...navRows({ back: true, home: true, close: true }));

  return {
    kind: 'list',
    menuId: 'welcome:group',
    title: '👋 Welcome & goodbye',
    text: [
      `👋 Welcome: ${welcome.statusLine(settings, ctx.from, 'welcome')}`,
      `👋 Goodbye: ${welcome.statusLine(settings, ctx.from, 'goodbye')}`,
      '',
      'මේ group එකට වෙනම settings. Global settings නොවෙනස්ව තබා ගැනේ.',
      'Templates: {mention} {name} {number} {group}',
    ].join('\n'),
    footer: 'Group admin settings • send - in a text prompt to reset',
    buttonText: 'Settings',
    sections: [{ title: 'This group', rows: rows.slice(0, 10) }],
  };
}

function scheduleMenu(ctx, page = 1) {
  const items = sch.list(ctx.accountId || 'default');
  const totalPages = Math.max(1, Math.ceil(items.length / SCHEDULE_PAGE_SIZE));
  const current = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const slice = items.slice((current - 1) * SCHEDULE_PAGE_SIZE, current * SCHEDULE_PAGE_SIZE);
  const rows = [
    { id: id('sch', 'new'), title: '➕ New scheduled message', description: 'Choose a time, then the message' },
    ...slice.map(item => ({
      id: id('sch', 'view', item.id),
      title: `🕒 ${sch.formatLocal(item.at)}`,
      description: `${item.jid.endsWith('@g.us') ? 'Group' : 'Chat'} ${item.jid.split('@')[0]} • ${item.text.slice(0, 40).replace(/\n/g, ' ')}`,
    })),
    ...navRows({
      prev: current > 1 ? id('sch', 'page', current - 1) : null,
      next: current < totalPages ? id('sch', 'page', current + 1) : null,
      close: !(current > 1 && current < totalPages),
    }),
  ].slice(0, 10);

  return {
    kind: 'list',
    menuId: `schedule:${current}`,
    title: '⏰ Scheduled messages',
    text: [
      items.length ? `${items.length} pending • Page ${current}/${totalPages}` : '📭 Pending scheduled messages නැහැ.',
      `🕒 Timezone: UTC${sch.TZ_OFFSET_MIN >= 0 ? '+' : '-'}${Math.floor(Math.abs(sch.TZ_OFFSET_MIN) / 60)}:${String(Math.abs(sch.TZ_OFFSET_MIN) % 60).padStart(2, '0')}`,
      'Existing .schedule / .schedules / .unschedule commands still work.',
    ].join('\n'),
    footer: 'Owner-only • live in data/schedules.json',
    buttonText: 'Schedules',
    sections: [{ title: 'Scheduled messages', rows: rows.slice(0, 1 + slice.length) }, { title: 'Navigation', rows: rows.slice(1 + slice.length) }].filter(s => s.rows.length),
  };
}

function scheduleView(ctx, item) {
  if (!item) return null;
  return {
    kind: 'list',
    menuId: `schedule:view:${item.id}`,
    title: `⏰ Schedule ${item.id}`,
    text: [
      `🆔 *${item.id}*`,
      `🕒 ${sch.formatLocal(item.at)}`,
      `📨 ${item.jid.endsWith('@g.us') ? 'Group' : 'Chat'}: ${item.jid.split('@')[0]}`,
      '',
      String(item.text || '').slice(0, 900),
    ].join('\n'),
    footer: 'Edit or cancel this scheduled message.',
    buttonText: 'Choose',
    sections: [{
      title: 'Actions',
      rows: [
        { id: id('sch', 'time', item.id), title: '✏️ Edit time', description: '10m, 18:30, tomorrow 07:00…' },
        { id: id('sch', 'text', item.id), title: '✏️ Edit message', description: 'Replace the message text' },
        { id: id('sch', 'cancel', item.id), title: '🗑️ Cancel schedule', description: 'Asks for confirmation' },
        { id: id('nav', 'back'), title: '↩️ Back', description: 'Back to scheduled messages' },
        { id: id('nav', 'main'), title: '🏠 Main menu', description: 'Start again' },
      ],
    }],
  };
}

function featureDone(ctx, feature) {
  const category = getCategory(feature?.category);
  const buttons = [{ id: id('nav', 'main'), text: '🏠 Main menu' }];
  if (category) buttons.push({ id: id('cat', category.id, 1), text: `↩️ ${category.label}`.slice(0, 24) });
  buttons.push({ id: id('nav', 'close'), text: '✖️ Close' });
  return {
    kind: 'buttons',
    menuId: null,
    title: '✅ Done',
    text: `${feature?.emoji || '✅'} *${feature?.label || 'Action'}*\n\nතව command එකක් තෝරන්න:`,
    footer: 'Menu නැවත open කරන්න .menu යවන්න.',
    buttons: buttons.slice(0, 3),
  };
}

function choiceMenu(ctx, feature) {
  const current = feature.choice?.current ? feature.choice.current(ctx) : '';
  const options = (feature.choice?.options || []).slice(0, 3);
  return {
    kind: 'buttons',
    menuId: `choice:${feature.id}`,
    title: `${feature.emoji || '•'} ${feature.label}`,
    text: [
      feature.choice?.text || feature.desc || '',
      current ? `\n📌 Current: *${current}*` : '',
      '',
      'Option එකක් තෝරන්න.',
    ].filter(Boolean).join('\n'),
    footer: 'Choice එක වහාම apply වේ.',
    buttons: options.map(option => ({ id: id('choice', feature.id, option.id), text: option.label })),
  };
}

/** Flatten a spec into numbered text options for self-chat / send failures. */
function textOptions(spec) {
  if (!spec) return [];
  if (spec.kind === 'buttons') return (spec.buttons || []).map(b => ({ id: b.id, text: b.text, description: '' }));
  const out = [];
  for (const section of spec.sections || []) {
    for (const row of section.rows || []) {
      out.push({ id: row.id, text: row.title, description: row.description || '' });
    }
  }
  return out;
}

function textMenu(spec) {
  const options = textOptions(spec).slice(0, 10);
  const map = {};
  const lines = [];
  options.forEach((option, index) => {
    const n = index + 1;
    map[String(n)] = option.id;
    const description = option.description ? ` — ${String(option.description).slice(0, 80)}` : '';
    lines.push(`${n}. ${option.text}${description}`);
  });
  const body = [
    spec.title ? `*${spec.title}*` : '',
    spec.text || '',
    lines.length ? `\n*Reply with a number:*\n${lines.join('\n')}` : '',
    spec.footer || '',
    '✖️ Cancel: /cancel',
  ].filter(Boolean).join('\n\n');
  return { text: body, map };
}

function infoText(ctx) {
  const { buildMenuText } = require('../commandList');
  return buildMenuText(ctx.prefix || '.');
}

module.exports = {
  id,
  CATEGORY_PAGE_SIZE,
  SCHEDULE_PAGE_SIZE,
  mainMenu,
  allCategories,
  categoryMenu,
  welcomeMenu,
  scheduleMenu,
  scheduleView,
  featureDone,
  choiceMenu,
  textOptions,
  textMenu,
  infoText,
  featureRow,
  navRows,
  getFeature,
  SCOPE_LABELS,
};
