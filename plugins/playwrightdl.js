'use strict';
/**
 * .pdl — owner-only download from a configured, allowlisted source.
 *
 * This is the manual entry point for lib/playwrightDownload.js. It is a
 * separate command on purpose: a Playwright download is expensive (a browser
 * tab + a full file), so it should not fire on every casual `.movie` lookup.
 *
 *   .pdl Sintel
 *   .pdl --source=my-catalogue Sintel
 *   .pdlsources
 *
 * Configure sources in data/download-sources.json. Only hosts listed in
 * `allowedHosts` are ever contacted; there is no shortlink/ad-gateway bypass.
 */

const fs = require('fs');
const { cmd } = require('../command');
const pdl = require('../lib/playwrightDownload');
const delivery = require('../lib/mediaDelivery');

const PREFIX = process.env.PREFIX || '.';

function parseArgs(raw) {
  const tokens = String(raw || '').trim().split(/\s+/).filter(Boolean);
  let source = '';
  const rest = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.startsWith('--source=')) source = t.slice('--source='.length);
    else if (t === '--source' || t === '-s') {
      source = tokens[i + 1] || '';
      i += 1;
    } else rest.push(t);
  }
  return { source, query: rest.join(' ') };
}

function formatError(code, message) {
  switch (code) {
    case 'DISABLED':
      return [
        '⚙️ *Playwright downloader is off*',
        '',
        `1. npm i playwright && npx playwright install chromium`,
        `2. cp data/download-sources.example.json data/download-sources.json`,
        `3. PLAYWRIGHT_DOWNLOAD_ENABLED=true, BROWSER_ENABLED=true`,
        '',
        `_Reason: ${message}_`,
      ].join('\n');
    case 'NO_SOURCE':
      return `⚙️ ${message}\n\nAvailable: ${pdl.listSources().map((s) => s.name).join(', ') || 'none'}`;
    case 'HOST_NOT_ALLOWED':
      return `🚫 *Blocked by the allowlist*\n${message}\n\n_Only hosts you added to allowedHosts are contacted._`;
    case 'NO_RESULTS':
      return `😕 *Source එකේ "${message.match(/"([^"]+)"/)?.[1] || 'movie'}" හමු වුණේ නැහැ.*`;
    case 'NO_DOWNLOAD_BUTTON':
      return `🔘 *Download control එක click කරන්න බැරි වුණා.*\nSelector එක වැරදි වෙන්න පුළුවන් — \`downloadSelector\` check කරන්න.`;
    case 'DOWNLOAD_TIMEOUT':
      return `⏱️ *Download එක start වුණේ නැහැ.*\n${message}\n\n_Site එකේ download button එක JS එකෙන් වෙනස් වෙනවා නම්, "downloadSelector" update කරන්න._`;
    case 'TOO_LARGE':
      return `📦 *File එක ලොකු වැඩියි.*\n${message}`;
    case 'TIMEOUT':
      return `⏱️ *Job එක timeout වුණා.*\n${message}`;
    case 'EMPTY_FILE':
    case 'DOWNLOAD_FAILED':
      return `❌ *Download එක අසාර්ථකයි.*\n${message}`;
    default:
      return `❌ *Download failed.*\n_${code}: ${message}_`;
  }
}

cmd(
  {
    pattern: 'pdl',
    alias: ['siteget', 'playwrightdl'],
    desc: 'Owner: download a file from a configured, allowlisted source',
    category: 'movie',
    fromMe: true,
    silent: true,
  },
  async (sock, _mek, _m, c) => {
    const { source, query } = parseArgs(c.q);

    if (!query) {
      return c.reply(
        [
          '📥 *Playwright download*',
          '',
          `${PREFIX}pdl <movie name>`,
          `${PREFIX}pdl --source=<name> <movie name>`,
          `${PREFIX}pdlsources`,
          '',
          '_Configure data/download-sources.json first._',
        ].join('\n')
      );
    }

    if (!pdl.isEnabled()) {
      return c.reply(
        formatError(
          'DISABLED',
          String(process.env.PLAYWRIGHT_DOWNLOAD_ENABLED || 'false') !== 'true'
            ? 'PLAYWRIGHT_DOWNLOAD_ENABLED is not true'
            : 'No enabled source in data/download-sources.json'
        )
      );
    }

    await c.reply(`⏳ *Source එකෙන් බාගන්නවා…*\n🎬 ${query}`).catch(() => {});

    let result = null;
    try {
      result = await pdl.downloadByQuery(query, { source: source || undefined });

      if (!result.ok) {
        console.warn('[pdl]', result.error.code, result.error.message);
        return c.reply(formatError(result.error.code, result.error.message));
      }

      const sent = await delivery.deliverLocalFile(sock, c.from, {
        file: result.file,
        dir: result.dir,
        title: result.title || query,
        quoted: c.quoted,
      });

      if (sent.ok) {
        console.log(`[pdl] sent ${sent.mode} ${(sent.size / 1024 / 1024).toFixed(1)}MB (${result.source})`);
        return;
      }

      // Directory is already removed by deliverLocalFile.
      return c.reply(
        `⚠️ File එක බාගත්තා, නමුත් යවන්න බැරි වුණා.\n📏 ${(result.size / 1024 / 1024).toFixed(1)} MB\n_${sent.message || sent.reason}_`
      );
    } catch (err) {
      console.error('[pdl] unhandled:', err.stack || err.message);
      if (result && result.ok && result.dir) fs.rmSync(result.dir, { recursive: true, force: true });
      return c.reply(formatError('ERROR', err.message));
    }
  }
);

cmd(
  {
    pattern: 'pdlsources',
    desc: 'List configured Playwright download sources',
    category: 'movie',
    fromMe: true,
    silent: true,
  },
  async (_sock, _mek, _m, c) => {
    const sources = pdl.listSources();
    const lines = ['📚 *Playwright sources*', '', `Enabled: ${pdl.isEnabled() ? 'yes' : 'no'}`];

    if (!sources.length) {
      lines.push('', '_None configured. Copy data/download-sources.example.json → data/download-sources.json._');
    } else {
      lines.push('');
      for (const s of sources) lines.push(`• *${s.name}* — ${s.label}`);
    }

    const st = pdl.stats();
    lines.push(
      '',
      `Active: ${st.active}/${st.maxConcurrent} · Queued: ${st.queued}`,
      `Max file: ${(st.maxBytes / 1024 ** 3).toFixed(2)} GB`,
      `Browser: ${st.browser.enabled ? 'ready' : 'off'}`
    );

    return c.reply(lines.join('\n'));
  }
);
