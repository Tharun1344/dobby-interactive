'use strict';
const { cmd } = require('../command');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
let ffmpegStaticPath = null;
try { ffmpegStaticPath = require('ffmpeg-static'); } catch { ffmpegStaticPath = null; }
const MAX_BYTES = Math.max(10 * 1024 * 1024, Math.min(Number(process.env.MAX_DOWNLOAD_BYTES || 1900000000), 1900000000));
const URL_RE = /^https?:\/\//i;
const FFMPEG = process.env.FFMPEG_PATH || ffmpegStaticPath || 'ffmpeg';
// Videos are sent as real video messages up to this size (default = the 1.9 GB download limit); only anything bigger is shrunk.
const WA_VIDEO_LIMIT = Number(process.env.WA_VIDEO_LIMIT_BYTES || MAX_BYTES);
const FFMPEG_TIMEOUT = Number(process.env.FFMPEG_TIMEOUT_MS || 1800000);
const QUALITIES = new Set([144, 240, 360, 480, 720]);
const LIMIT_LABEL = `${(MAX_BYTES / (1024 ** 3)).toFixed(2)} GiB`;
// Extensions yt-dlp can produce with no video track at all. If a non-audio
// command ends up with one of these, the source only offered audio (or the
// video+audio merge silently failed) — report it instead of sending an
// audio file labeled as a video.
const AUDIO_ONLY_EXT = new Set(['mp3', 'm4a', 'aac', 'opus', 'ogg', 'wav', 'wma', 'weba']);
// Recent YouTube needs a JavaScript runtime for yt-dlp (node is in the Docker image). Old yt-dlp builds don't know
// the flag, so retry once without it instead of failing.
const JS_RUNTIME = process.env.YTDLP_JS_RUNTIME === undefined ? 'node' : process.env.YTDLP_JS_RUNTIME;

// Embedded cookies base64 string so you don't need to set any environment variables!
const EMBEDDED_COOKIES_B64 = "IyBOZXRzY2FwZSBIVFRQIENvb2tpZSBGaWxlCiMgaHR0cHM6Ly9jdXJsLmhheHguc2UvcmZjL2Nvb2tpZV9zcGVjLmh0bWwKIyBUaGlzIGlzIGEgZ2VuZXJhdGVkIGZpbGUhIERvIG5vdCBlZGl0LgoKLnlvdXR1YmUuY29tCVRSVUUJLwFGQUxTRQkxODI3NDc4MDIwCUhTSUQJQXFKUHB2T1ZQRmpTMG1wa2wKLnlvdXR1YmUuY29tCVRSVUUJLwlUUlVFAkxODI3NDc4MDIwCVNTSUQJQUhEQmtkZzI4SEV4UnFrQkgKLnlvdXR1YmUuY29tCVRSVUUJLwFGQUxTRQkxODI3NDc4MDIwCkFQSVNJRABSbVBoV3dKQVNaVlJKSlkvQWNZUUFHUERsOENDUzhzVjAKLnlvdXR1YmUuY29tCVRSVUUJLwlUUlVFAkxODI3NDc4MDIwCVNBUElTSUQJbzlqTUNpZkFQaHQ0UEVDL0FQa3pNZlNrdHpjSEQxSGFIQgoueW91dHViZS5jb20JVFJVRQkvCVRSVUUJMTgyNzQ3ODAyMAlfX1NlY3VyZS0xUEFQSVNJRApvOWpNQ2lmQVBodDRQRTRDL0FQa3pNZlNrdHpjSEQxSGFIQgoueW91dHViZS5jb20JVFJVRQkvCVRSVUUJMTgyNzQ3ODAyMAlfX1NlY3VyZS0zUEFQSVNJRApvOWpNQ2lmQVBodDRQRTRDL0FQa3pNZlNrdHpjSEQxSGFIQgoueW91dHViZS5jb20JVFJVRQkvCVRSVUUJMTgyNzQ3ODAyMAlfX1NlY3VyZS0zUFNJRAJnLmEwMDBFQW1kYXMtbTVVoR0JQeEFHb25XOVBQQ0k5N1NLYWdXd0djeHZKcnhfVHJDakJoVllTcVFHd3dPb3lYTWpNV01FZTJXdUFBQ2dZS0FTQVNBUkFTRlFHSFgyTWlZSGFJMnhvLUI3VEVqTWYzeVJ5ZWdob1ZBVUY4WUtvYjZBRXlBbEhkOHZsblJfWlpFATh3MDA3NgoueW91dHViZS5jb20JVFJVRQkvCVRSVUUJMTgyNzQ3ODA4OQlQUkVGCWY2PTQwMDAwMDAwJnR6PUFzaWEuQ29sb21ibwoueW91dHViZS5jb20JVFJVRQkvCVRSVUUJMTgyNzQ3ODA3NwlMT0dJTl9JTkZPCkFGbW1GMnN3UlFJZ0tTVzZRaUd2RGdaRmhhc20yN1hDY1JfT3hDX1Y3V1ZBdC0tUzhzUlFWWllDSVFDVFdzWmpvVUlXb0FNWEJmZl84a3VWa2pQSWNZdndneVlIWUpVREZHWmp1QToJUVVRM0pqTnB3W2VMSkQ0ZEozZDFXRjRtY2VsOGhwYUxSdVg4MFFWODc1Sl9SZTVuVk9hNlloOE5fdGpucWJrbUpBRDVkSEhBRWo2WnYxaTZtRU1lbFNHcDV0S1JMdi1nMXlzVzRPQjBtaE4zUml6b2NUbFZqZmZvbG1Rc0RaV044VFhpNC1vem9ndngtdjFQYTZnSzRncDJjNkdYTVg5cVFBWktnCW91dHViZS5jb20JVFJVRQkvCVRSVUUJMTkyOTE4NjkwCkNPTlNJU1RFTkNZAEFJVWRuOGI5UVBSM1l2bTlYSVcyWktjaUh6ZFhVLWhSRVo1RzNvZFBkZUplWFdjem5WYmdZY3dxdGZlYbY2Vnb2hfMGJwSFFHc2FNUUJuRWJNN3RTX3hITmRhODBfcXZ5T0VBRWhhcUxWdkRyU25nQ0l3eFFsUl9VVGliaC1aUzVvNk1JTGJsanJpdnIxd1lENjRmCW5vdXR1YmUuY29tCVRSVUUJLwlUUlVFAkxODI0NDU0MDk2CV9fU2VjdXVyZS0xPSFQU0lEVFMJc2lkdHMtQ2pVQmtsZGpfendnM2tFaHN5YzBfVUhXRU9kcEtRMXFPOlBOaVBaTGpnUFZRbjhhNVBXQUVgRnFKNDdxWkhkMWNibHZjaXJJb3hBQQoueW91dHViZS5jb20JVFJVRQkvCVRSVUUJMTgyNDQ1NDA5NglfX1NlY3VyZS0zUFNJRElTSXN0cy1DbkpVS2xkal96Z1MzZ0Voc3ljMF9VSDdFT0RwS1ExcU85UE5pUFpMSmdQVlFuOGE1UFdBRTFGc0o0N3FaSGQxY2JsdmNpcklveEFBCi55b3V0dWJlLm1jb20JVFJVRQkvCVRSVUUJMAJZU0MJQTJJcVJEalNZUUUKLnlvdXR1YmUuY29tCVRSVUUJLwlUUlVFAkxODA4NDcwMDc4CVZJU0lUT1JfSU5GTzFMSUVEREluNk04b2ZEcjAKLnlvdXR1YmUuY29tCVRSVUUJLwlUUlVFAkxODA4NDcwMDc4CVZJU0lUT1JfUFJJVkFDWV9NRVRBREFUQQJDZ0pMU3hJRUdnQWdLQSUzRkIKLnlvdXR1YmUuY29tCVRSVUUJLwlUUlVFAkxODA4NDcwMDczCV9fU2VjdXJlLVlOSUQJQ3RvQkFVU2pBRUI4UVp1Wmc5cVJIa0xrbTN1dTNCNkExOWZuUHBKdWYzRC1LSENrdWpSaHNFMmduTHRweG51bWFnRlktUWI2djQ4cHFVRllGRVJDcl92STI5TUEyRTdvdWxFaFBpQWlLVjU2UmVkT2dVb0lqbXliTDF2QlVVUEd6MThrc3BBMkFRRXNjSjJvNVJBakxwRDhSZVRqV2o0ZEs2aXVrNVpDSmpuYWlYOWI4QmJNV01jZDd2dHp3eFhXV2ppdHRTZkFNayVCM3FtZFQza3FlYy0yajdpV285aUxWbzdETnRNajFFdGloV0gzc1RQNVpPTWc2eVBFQWhuZWF5VmZlOWk2RHd5RENUMDhZT1JJLXNXcGt1Mko3aGgxYVJYUUZRYw==";

function cookieArgs() {
  // Cookies are a trap on today's YouTube: a logged-in session only gets a SABR-only format list
  // (measured: 0 downloadable formats with the account's cookies vs 44 anonymous), which surfaces as
  // "Requested format is not available". So cookies are opt-in: YTDLP_COOKIES_B64 / YTDLP_COOKIES must
  // hold real Netscape cookie text (plain or base64) and "off"/"none"/empty means no cookie file at all.
  const rawEnv = String(process.env.YTDLP_COOKIES_B64 || process.env.YTDLP_COOKIES || '').trim();
  if (!rawEnv || /^(off|none|no|0|false)$/i.test(rawEnv)) {
    // a cookie file written by an earlier boot would otherwise stay behind and keep breaking downloads
    try { fs.rmSync(path.join(os.tmpdir(), 'ytdlp-cookies.txt'), { force: true }); } catch { }
    return [];
  }
  let raw = rawEnv;
  if (!/# Netscape|\.youtube\.com/.test(raw)) {
    try {
      const decoded = Buffer.from(raw, 'base64').toString('utf8');
      if (/# Netscape|\.youtube\.com/.test(decoded)) raw = decoded;   // the *_B64 name actually means base64
    } catch { }
  }
  if (!raw.trim()) return [];
  const file = path.join(os.tmpdir(), 'ytdlp-cookies.txt');
  try { if (!fs.existsSync(file)) fs.writeFileSync(file, raw.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n'), { mode: 0o600 }); } catch (e) { console.error('[cookies]', e.message); return []; }
  return ['--cookies', file];
}

const BLOCKED_RE = /Sign in to confirm|not a bot|Requested format is not available|HTTP Error 403|Precondition check failed|nsig|n challenge/i;
const FALLBACK_CLIENTS = (process.env.YTDLP_CLIENTS || 'web,android,ios').split(',').map(x => x.trim()).filter(Boolean);
// 429 = IP-wide rate limit. Retrying other player clients multiplies the requests and makes it worse,
// so a hit parks YouTube for a cooldown window and every caller fails fast with a readable message.
const YT_RATE_LIMIT_RE = /429|Too Many Requests|rate.?limit/i;
const YT_COOLDOWN_MS = Number(process.env.YTDLP_COOLDOWN_MS || 10 * 60 * 1000);
let YT_BLOCKED_UNTIL = 0;

// yt-dlp stdout is not always pure JSON — the PO-token plugin and yt-dlp itself can print noise (e.g.
// "wf=1&hl=en") before the payload, which made JSON.parse throw and the command report a false failure.
function parseYtJson(text) {
  const s = String(text || '');
  const from = Math.min(...[s.indexOf('{'), s.indexOf('[')].filter(i => i >= 0));
  if (!Number.isFinite(from)) throw new Error(`yt-dlp returned no JSON (got: ${s.slice(0, 160)})`);
  const to = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  return JSON.parse(s.slice(from, to + 1));
}

async function runYtDlp(args, timeoutMs = 240000) {
  // A 429 is IP-wide: hammering the remaining clients only extends the ban, so fail fast and sit out a
  // cooldown instead. This is what keeps the bot usable long-term without touching anything by hand.
  if (Date.now() < YT_BLOCKED_UNTIL) {
    const mins = Math.max(1, Math.ceil((YT_BLOCKED_UNTIL - Date.now()) / 60000));
    throw new Error(`YouTube තාම rate-limit කරලා (${
      mins} min) — ඒ නිසා දැන් උත්සාහ කළේ නෑ. ටිකකින් ආයෙ එවන්න.`);
  }
  const proxy = process.env.YTDLP_PROXY ? ['--proxy', process.env.YTDLP_PROXY] : [];
  const withCookies = [...proxy, ...cookieArgs(), ...args];
  // PO token provider (baked into the image): without it YouTube refuses a datacenter IP with
  // "Sign in to confirm you're not a bot" on most videos, no matter which player client is used.
  const potScript = process.env.YTDLP_POT_SCRIPT || '/opt/pot/server/build/generate_once.js';
  const potArg = fs.existsSync(potScript) ? `getpot_bgutil_script=${potScript}` : '';
  // bgutil 2.x reads its own extractor namespace; the youtube-scoped key above is the legacy alias.
  // Both are passed because the provider only marks itself "available" when the one it knows is present.
  const potArgs = fs.existsSync(potScript)
    ? ['--extractor-args', `youtubepot-bgutilscript:script_path=${potScript}`]
    : [];
  let firstErr;
  for (const client of ['', ...FALLBACK_CLIENTS]) {
    try {
      const ytArgs = [client ? `player_client=${client}` : '', potArg].filter(Boolean).join(';');
      const clientArgs = ytArgs ? [...potArgs, '--extractor-args', `youtube:${ytArgs}`, ...withCookies] : [...potArgs, ...withCookies];
      return await runYtDlpJs(clientArgs, timeoutMs);
    } catch (err) {
      const message = String(err.message || err);
      if (YT_RATE_LIMIT_RE.test(message)) {
        YT_BLOCKED_UNTIL = Date.now() + YT_COOLDOWN_MS;
        throw err;                       // no further clients: every retry deepens the same IP ban
      }
      if (!firstErr) firstErr = err;
      console.error(`[yt-dlp client ${client || 'default'}]`, String(err.message).split('\n')[0].slice(0, 200));
      if (!BLOCKED_RE.test(err.message) && !/Requested format is not available/i.test(err.message)) throw err;
    }
  }
  throw firstErr || new Error('All YouTube client extractors failed');
}

async function runYtDlpJs(args, timeoutMs = 240000) {
  if (!JS_RUNTIME) return runYtDlpRaw(args, timeoutMs);
  // yt-dlp has to *find* the JS runtime or every JS challenge fails ("node (unavailable)"), and in a
  // slim image the plain name is not enough — pass the explicit interpreter path, then the bare name.
  const nodePath = process.env.YTDLP_NODE_PATH || '/usr/local/bin/node';
  const specs = [`${JS_RUNTIME}:${nodePath}`, JS_RUNTIME];
  let lastErr;
  for (const spec of specs) {
    try { return await runYtDlpRaw(['--js-runtimes', spec, ...args], timeoutMs); }
    catch (e) {
      lastErr = e;
      if (/js-runtimes|no such option|unrecognized arguments/i.test(e.message)) return runYtDlpRaw(args, timeoutMs);
    }
  }
  throw lastErr;
}

// ── yt-dlp runner ──────────────────────────────────────────────────────────────────────────────────
// The runner is the `yt-dlp-exec` package: it owns the official standalone binary (so `--update` really
// works, unlike a pip install) and we ask it to refresh yt-dlp before every call — YouTube changes its
// API constantly and a stale extractor is the usual reason downloads start failing.
const YTDLP_EXEC = (() => { try { return require('yt-dlp-exec'); } catch { return null; } })();
const AUTO_UPDATE = String(process.env.YTDLP_AUTO_UPDATE || 'true').toLowerCase() !== 'false';

// The image installs dependencies with --ignore-scripts (deterministic builds), so yt-dlp-exec's own
// downloader never ran. Fetch the official standalone binary on first boot: it is the only build that can
// self-update, which is exactly what `ytdlp(url, { update: true })` relies on.
const YTDLP_BIN_PATH = (() => {
  try { return require('yt-dlp-exec/src/constants').YOUTUBE_DL_PATH; } catch { return ''; }
})();
(function ensureYtDlpBinary() {
  if (!YTDLP_EXEC || !YTDLP_BIN_PATH) return;
  try {
    if (fs.existsSync(YTDLP_BIN_PATH)) return;
    const script = path.join(path.dirname(require.resolve('yt-dlp-exec')), '..', 'scripts', 'postinstall.js');
    if (!fs.existsSync(script)) { console.warn('[ytdlp] postinstall script missing; using the pip yt-dlp'); return; }
    require('child_process').execFileSync(process.execPath, [script], { stdio: 'ignore', timeout: 180000 });
    console.log(`[ytdlp] fetched the standalone yt-dlp binary -> ${YTDLP_BIN_PATH}`);
  } catch (err) { console.warn('[ytdlp] could not fetch the standalone binary, falling back to pip yt-dlp:', err.message); }
})();

// The standalone binary cannot see pip-installed plugins, so point it at the directory that holds them
// (the parent of yt_dlp_plugins = python's dist/site-packages). Without this the PO-token provider never
// loads and YouTube refuses the datacenter IP. A filesystem scan is used first because `python3` is not
// guaranteed to be on PATH under every supervisor, and a silent '' here costs every download.
const YTDLP_PLUGIN_PATH = (() => {
  if (process.env.YTDLP_PLUGIN_DIRS) return process.env.YTDLP_PLUGIN_DIRS;
  const hasPlugin = dir => { try { return fs.existsSync(path.join(dir, 'yt_dlp_plugins')); } catch { return false; } };
  const roots = [];
  for (const base of ['/usr/local/lib', '/usr/lib']) {
    let entries = [];
    try { entries = fs.readdirSync(base); } catch { continue; }
    for (const name of entries) if (/^python3(\.\d+)?$/.test(name)) roots.push(path.join(base, name));
  }
  const dirs = [];
  for (const root of roots) for (const sub of ['dist-packages', 'site-packages']) dirs.push(path.join(root, sub));
  dirs.push('/usr/lib/python3/dist-packages', '/usr/local/lib/python3/dist-packages');
  const hit = dirs.find(hasPlugin);
  if (hit) return hit;
  try {
    return require('child_process').execFileSync('python3', ['-c',
      'import yt_dlp_plugins,os;print(os.path.dirname(os.path.dirname(yt_dlp_plugins.__file__)))'],
      { encoding: 'utf8', timeout: 20000 }).trim();
  } catch (err) {
    console.warn('[ytdlp] PO-token plugin directory not found:', err.message);
    return '';
  }
})();
const USE_EXEC = Boolean(YTDLP_EXEC) && (Boolean(process.env.YTDLP_BIN) || (Boolean(YTDLP_BIN_PATH) && fs.existsSync(YTDLP_BIN_PATH)));
console.log(`[ytdlp] cookies: ${cookieArgs().length ? 'LOADED (Embedded/Env)' : 'not set'} | proxy: ${process.env.YTDLP_PROXY ? 'set' : 'not set'} | runner: ${USE_EXEC ? 'yt-dlp-exec' : 'spawn'} | auto-update: ${AUTO_UPDATE ? 'on' : 'off'} | plugins: ${YTDLP_PLUGIN_PATH || 'none'}`);

// Our code builds yt-dlp argv arrays; yt-dlp-exec wants flag objects (dargs turns them back into argv).
const EXEC_FLAGS = {
  '--no-warnings': 'noWarnings', '--dump-single-json': 'dumpSingleJson', '--dump-json': 'dumpJson',
  '--flat-playlist': 'flatPlaylist', '--no-playlist': 'noPlaylist', '--verbose': 'verbose', '-v': 'verbose',
  '-F': 'listFormats', '--list-formats': 'listFormats', '--no-check-certificates': 'noCheckCertificates',
};
const EXEC_VALUES = {
  '--js-runtimes': 'jsRuntimes', '--extractor-args': 'extractorArgs', '--cookies': 'cookies',
  '--proxy': 'proxy', '-f': 'format', '--format': 'format', '-o': 'output', '--output': 'output',
  '--retries': 'retries', '--socket-timeout': 'socketTimeout', '--max-filesize': 'maxFilesize',
  '--user-agent': 'userAgent', '--referer': 'referer', '--sleep-requests': 'sleepRequests',
  '--plugin-dirs': 'pluginDirs',
};

function toExecFlags(argv) {
  const flags = {};
  const unknown = [];
  let target;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (EXEC_VALUES[token]) {
      const value = argv[++i];
      if (value !== undefined) {
        const key = EXEC_VALUES[token];
        flags[key] = flags[key] === undefined ? value : [].concat(flags[key], value);
      }
      continue;
    }
    if (EXEC_FLAGS[token]) { flags[EXEC_FLAGS[token]] = true; continue; }
    if (token.startsWith('-')) { unknown.push(token); continue; }
    target = target === undefined ? token : [].concat(target, token);
  }
  if (unknown.length) console.warn('[ytdlp] unmapped flags passed through as-is:', unknown.join(' '));
  return { flags, target, unknown };
}

function runYtDlpRaw(args, timeoutMs = 240000) {
  if (USE_EXEC) {
    const { flags, target } = toExecFlags(args);
    if (AUTO_UPDATE) flags.update = true;      // ytdlp(url, { update: true }) — refresh before the download
    if (YTDLP_PLUGIN_PATH && !flags.pluginDirs) flags.pluginDirs = YTDLP_PLUGIN_PATH;
    return YTDLP_EXEC.exec(target, flags, { timeout: timeoutMs })
      .then(res => ({ stdout: res.stdout || '', stderr: res.stderr || '' }))
      .catch(err => {
        const stderr = String(err.stderr || '');
        const stdout = String(err.stdout || '');
        // Keep the old error contract: the message carries yt-dlp's own output so BLOCKED_RE still matches.
        const wrapped = new Error(stderr.trim() || err.shortMessage || err.message);
        wrapped.stdout = stdout;
        wrapped.stderr = stderr;
        wrapped.exitCode = err.exitCode;
        throw wrapped;
      });
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.YTDLP_BIN || 'yt-dlp', args, { stdio: ['ignore','pipe','pipe'] });
    let stdout = '', stderr = '', settled = false;
    const done = (err, value) => { if (settled) return; settled = true; clearTimeout(timer); err ? reject(err) : resolve(value); };
    child.stdout.on('data', x => { stdout += x.toString(); if (stdout.length > 300000) stdout = stdout.slice(-300000); });
    child.stderr.on('data', x => { stderr += x.toString(); if (stderr.length > 300000) stderr = stderr.slice(-300000); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); done(new Error('Download timed out')); }, timeoutMs);
    child.on('error', err => done(new Error(`Could not start yt-dlp: ${err.message}`)));
    child.on('close', code => code === 0 ? done(null, { stdout, stderr }) : done(new Error(stderr.slice(-1800) || `yt-dlp exited ${code}`)));
  });
}

function runFfmpeg(args, timeoutMs = FFMPEG_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ['-hide_banner', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '', settled = false;
    const done = (err, v) => { if (settled) return; settled = true; clearTimeout(timer); err ? reject(err) : resolve(v); };
    child.stderr.on('data', x => { stderr += x.toString(); if (stderr.length > 200000) stderr = stderr.slice(-200000); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); done(new Error('ffmpeg timed out')); }, timeoutMs);
    child.on('error', err => done(new Error(`Could not start ffmpeg: ${err.message}`)));
    child.on('close', code => code === 0 ? done(null, stderr) : done(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`)));
  });
}

async function probeCodecs(file) {
  const info = await new Promise(resolve => {
    const child = spawn(FFMPEG, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; child.stderr.on('data', x => { err += x.toString(); });
    child.on('error', () => resolve('')); child.on('close', () => resolve(err));
  });
  return { video: (info.match(/Video: ([a-z0-9_]+)/i) || [])[1] || '', audio: (info.match(/Audio: ([a-z0-9_]+)/i) || [])[1] || '' };
}

async function makePlayableMp4(src, dir, codecs) {
  const out = path.join(dir, 'playable.mp4');
  const isMp4 = path.extname(src).toLowerCase() === '.mp4';
  if (isMp4 && codecs.video === 'h264' && (!codecs.audio || codecs.audio === 'aac')) {
    await runFfmpeg(['-i', src, '-c', 'copy', '-movflags', '+faststart', out]);
  } else {
    const big = fs.statSync(src).size > 150 * 1024 * 1024;
    await runFfmpeg(['-i', src, '-c:v', 'libx264', '-preset', big ? 'ultrafast' : 'veryfast', '-crf', big ? '28' : '26', '-pix_fmt', 'yuv420p',
      '-vf', "scale='min(1280,iw)':-2", '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]);
  }
  return out;
}

async function shrinkToFit(src, dir) {
  const out = path.join(dir, 'small.mp4');
  await runFfmpeg(['-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-vf', "scale=-2:'min(360,ih)'", '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out]);
  return out;
}

async function makeThumb(src, dir) {
  try {
    const out = path.join(dir, 'thumb.jpg');
    await runFfmpeg(['-ss', '1', '-i', src, '-frames:v', '1', '-vf', 'scale=320:-2', out], 30000)
      .catch(() => runFfmpeg(['-i', src, '-frames:v', '1', '-vf', 'scale=320:-2', out], 30000));
    return fs.readFileSync(out);
  } catch { return undefined; }
}

function safeName(name, fallback) { return String(name || fallback).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 160) || fallback; }

function inputTarget(q, searchPrefix = 'ytsearch1:') {
  const raw = String(q || '').trim();
  if (!raw) throw new Error('Give a video/song name or URL.');
  if (URL_RE.test(raw)) {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only HTTP(S) URLs are allowed.');
    return u.toString();
  }
  return searchPrefix + raw;
}

async function sendAsDocument(sock, c, file, title, ext, mime, note = '') {
  const stat = fs.statSync(file);
  if (stat.size > MAX_BYTES) throw new Error(`File is larger than configured limit ${LIMIT_LABEL}`);
  await sock.sendMessage(c.from, {
    document: { url: file }, mimetype: mime, fileName: safeName(`${title}.${ext}`, `download.${ext}`),
    caption: `✅ *Download complete*\n📏 ${(stat.size / (1024 * 1024)).toFixed(1)} MB${note ? `\n${note}` : ''}`
  }, { quoted: c.quoted });
}

async function sendAsVideo(sock, c, file, title, thumb, qualityLabel) {
  const size = fs.statSync(file).size;
  const caption = `🎬 *${title}*\n📏 ${(size / (1024 * 1024)).toFixed(1)} MB${qualityLabel ? ` • ${qualityLabel}` : ''}`;
  const base = { mimetype: 'video/mp4', fileName: safeName(`${title}.mp4`, 'video.mp4'), caption, gifPlayback: false, ...(thumb ? { jpegThumbnail: thumb } : {}) };
  const attempts = [() => ({ video: { url: file } }), () => ({ video: { stream: fs.createReadStream(file) } }), () => ({ video: fs.readFileSync(file) })];
  let lastErr;
  for (const make of attempts) {
    try { return await sock.sendMessage(c.from, { ...make(), ...base }, { quoted: c.quoted }); }
    catch (e) { lastErr = e; console.error('[video send attempt failed]', e.message); }
  }
  throw lastErr || new Error('Could not send video');
}

async function sendAsAudio(sock, c, file, title) {
  const size = fs.statSync(file).size;
  await sock.sendMessage(c.from, { audio: { url: file }, mimetype: 'audio/mpeg', fileName: safeName(`${title}.mp3`, 'song.mp3') }, { quoted: c.quoted });
  await sock.sendMessage(c.from, { text: `🎵 *${title}*\n📏 ${(size / (1024 * 1024)).toFixed(1)} MB` }, { quoted: c.quoted }).catch(() => {});
}

async function downloadCommand(sock, mek, _msg, c, mode) {
  let target;
  let height = mode.height;
  const qMatch = String(c.q || '').trim().match(/^(\d{3})p?\s+(.+)$/s);
  if (!mode.audio && qMatch && QUALITIES.has(Number(qMatch[1]))) { height = Number(qMatch[1]); c = { ...c, q: qMatch[2] }; }
  try {
    if (mode.urlOnly && !URL_RE.test(String(c.q || '').trim())) throw new Error('This platform command requires a direct video URL.');
    target = inputTarget(c.q, 'ytsearch1:');
  }
  catch (e) { return c.reply(`📥 *භාවිතය*\n${c.prefix}${mode.command} video/song name OR URL\n\nඋදා: ${c.prefix}${mode.command} Shape of You\nඋදා: ${c.prefix}${mode.command} https://...`); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'danuwa-dl-'));
  try {
    await c.reply(`⏳ *${mode.label}* සූදානම් කරනවා…\n🔎 Name එකක් හෝ URL එකක් දෙන්න පුළුවන්.\n🎬 ${mode.audio ? 'Audio' : 'Video (play කරන්න පුළුවන් mp4)'} එකක් විදිහට යවනවා.`);
    const out = path.join(dir, '%(title).150B.%(ext)s');
    const common = ['--no-playlist','--no-warnings','--newline','--socket-timeout','30','--retries','3','--fragment-retries','3','--no-part','--geo-bypass','--no-check-certificates','--max-filesize',String(MAX_BYTES),'-o',out,'--print','after_move:filepath'];
    if (ffmpegStaticPath) common.push('--ffmpeg-location', ffmpegStaticPath);
    let args;
    if (mode.audio) {
      args = [...common, '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0', target];
    } else {
      const format = `bv*[height<=${height}]+ba/b[height<=${height}]/b/best`;
      args = [...common, '-f', format, '--merge-output-format', 'mp4', target];
    }
    const { stdout, stderr } = await runYtDlp(args, Number(process.env.DOWNLOAD_TIMEOUT_MS || 1800000));
    const printed = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    let file = printed && fs.existsSync(printed) ? printed : null;
    if (!file) {
      const candidates = fs.readdirSync(dir).map(n => path.join(dir,n)).filter(p => fs.existsSync(p) && fs.statSync(p).isFile());
      file = candidates.sort((a,b) => fs.statSync(b).size - fs.statSync(a).size)[0] || null;
    }
    if (!file) throw new Error(`No file created. ${stderr.slice(-500)}`);
    const stat = fs.statSync(file);
    if (stat.size > MAX_BYTES) throw new Error(`File too large: ${(stat.size / (1024 ** 3)).toFixed(2)} GiB; limit ${LIMIT_LABEL}`);
    const ext = path.extname(file).slice(1).toLowerCase() || (mode.audio ? 'mp3' : 'mp4');
    if (!mode.audio && AUDIO_ONLY_EXT.has(ext)) {
      throw new Error(`AUDIO_ONLY_RESULT: this link only yielded an audio track (ext=${ext}), no video.`);
    }
    const title = path.basename(file, path.extname(file));
    if (mode.audio) {
      if (stat.size > 100 * 1024 * 1024) await sendAsDocument(sock, c, file, title, ext, 'audio/mpeg', '📦 Too large for an audio message, sent as file');
      else await sendAsAudio(sock, c, file, title);
      return;
    }
    const codecs = await probeCodecs(file);
    if (!codecs.video) throw new Error(`AUDIO_ONLY_RESULT: no video stream found (audio=${codecs.audio || 'none'}).`);
    let playable = await makePlayableMp4(file, dir, codecs);
    let note = '';
    if (fs.statSync(playable).size > WA_VIDEO_LIMIT) {
      await c.reply('🗜️ Video එක ලොකුයි — WhatsApp video එකක් විදිහට යවන්න පුංචි කරනවා (360p)…').catch(() => {});
      playable = await shrinkToFit(playable, dir);
      note = '360p';
    }
    const finalSize = fs.statSync(playable).size;
    if (finalSize <= WA_VIDEO_LIMIT) {
      const thumb = await makeThumb(playable, dir);
      await sendAsVideo(sock, c, playable, title, thumb, note || (height ? `${height}p` : ''));
    } else {
      await sendAsDocument(sock, c, playable, title, 'mp4', 'video/mp4', '📦 මේක ඉතා දිගයි — WhatsApp video limit ඉක්මවූ නිසා file එකක් විදිහට යැව්වා.');
    }
  } catch (e) {
    console.error(`[${mode.command}]`, e.message);
    let message = '❌ Download එක අසාර්ථකයි.';
    if (/AUDIO_ONLY_RESULT/i.test(e.message)) message = '⚠️ මේ link එකට *video stream එකක් නැහැ* — audio track එකක් විතරයි හම්බුණේ, ඒ නිසා video file එක යැව්වේ නැහැ.\n🔁 වෙනත් post/link එකක් try කරන්න, හෝ video එක login/age/geo restricted වෙලා තියෙනවද බලන්න.';
    else if (/max-filesize|file is larger|too large/i.test(e.message)) message += `\n📏 File size limit: ${LIMIT_LABEL}. Railway memory/storage limits නිසා ඉතා විශාල files fail වෙන්න පුළුවන්.`;
    else if (/Could not start yt-dlp|ENOENT/i.test(e.message)) message += '\n🧰 yt-dlp install වෙලා නැහැ (Railway: Dockerfile එකෙන් rebuild කරන්න).';
    else if (/Sign in to confirm|not a bot/i.test(e.message)) message += '\n🍪 Cookies embedded කරලා තියෙනවා, ඒත් YouTube එකෙන් අලුත් block එකක් දාලා තියෙනවා නම් cookies update කරන්න වෙයි.';
    else if (/Requested format is not available|nsig|n challenge/i.test(e.message)) message += '\n🧩 YouTube format/challenge error එකක් — yt-dlp update කරන්න (Railway redeploy).';
    else if (/Video unavailable|Private video|members-only|has been removed|age/i.test(e.message)) message += '\n🚫 Video එක unavailable / private / age-restricted වෙන්න පුළුවන්.';
    else if (/timed out/i.test(e.message)) message += '\n⏱️ Download timeout වුණා; පොඩි video එකක් හෝ පසුව නැවත try කරන්න.';
    else message += '\n🌐 Link availability, login/age/geo restrictions සහ source platform changes පරීක්ෂා කරන්න.';
    message += '\n⚠️ ඔබට download කිරීමට අයිතිය ඇති content පමණක් භාවිත කරන්න.';
    await c.reply(message);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

cmd({ pattern: 'ytsearch', alias: ['musicsearch','videosearch'], desc: 'Search YouTube results (metadata only)', category: 'download' }, async (_s,_m,_msg,c) => {
  if (!c.q) return c.reply(`🔎 භාවිතය: ${c.prefix}ytsearch song/video name`);
  try {
    const { stdout } = await runYtDlp(['--dump-single-json','--flat-playlist','--no-warnings',`ytsearch5:${c.q}`], 60000);
    const data = parseYtJson(stdout);
    const entries = (data.entries || []).slice(0,5);
    if (!entries.length) return c.reply('😕 ප්‍රතිඵල හමු වුණේ නැහැ.');
    return c.reply('╭─〔 🔎 *YOUTUBE SEARCH* 〕\n' + entries.map((v,i)=>`│ ${i+1}. *${v.title || 'Untitled'}*\n│ 🔗 https://www.youtube.com/watch?v=${v.id}`).join('\n│\n') + '\n╰────────────────\n\n⬇️ Video: .ytvideo song name\n🎵 MP3: .song song name');
  } catch (e) { console.error('[ytsearch]',e.message); return c.reply('❌ Search අසාර්ථකයි. yt-dlp update/network එක පරීක්ෂා කරන්න.'); }
});
cmd({ pattern: 'ytvideo', alias: ['ytmp4'], desc: 'Download YouTube video up to 480p by name or URL', category: 'download' }, async (s,m,msg,c) => downloadCommand(s,m,msg,c,{command:'ytvideo',label:'YouTube video (480p)',height:480}));
cmd({ pattern: 'song', alias: ['ytmp3','mp3'], desc: 'Download permitted audio as MP3 by name or URL', category: 'download' }, async (s,m,msg,c) => downloadCommand(s,m,msg,c,{command:'song',label:'Song MP3',audio:true}));
cmd({ pattern: 'fbvideo', alias: ['facebook'], desc: 'Download supported Facebook video up to 720p', category: 'download' }, async (s,m,msg,c) => downloadCommand(s,m,msg,c,{command:'fbvideo',label:'Facebook video (up to 720p)',height:720,urlOnly:true}));
cmd({ pattern: 'ttvideo', alias: ['tiktok'], desc: 'Download supported TikTok video up to 720p', category: 'download' }, async (s,m,msg,c) => downloadCommand(s,m,msg,c,{command:'ttvideo',label:'TikTok video (up to 720p)',height:720,urlOnly:true}));
cmd({ pattern: 'download', alias: ['media'], desc: 'Download supported public video by name or URL (up to 720p)', category: 'download' }, async (s,m,msg,c) => downloadCommand(s,m,msg,c,{command:'download',label:'Video download (up to 720p)',height:720}));

// Diagnostic used by GET /api/yt-test (TEST_TOKEN-protected) so the YouTube path can be verified from
// outside the container without sending a WhatsApp message: it runs the same extraction pipeline the
// .song/.ytvideo commands use and reports which formats came back (0 formats == still blocked).
async function probeYouTube(videoId) {
  const started = Date.now();
  const potScript = process.env.YTDLP_POT_SCRIPT || '/opt/pot/server/build/generate_once.js';
  const diag = { potScript, potScriptExists: fs.existsSync(potScript) };
  try {
    diag.site = require('child_process').execSync(
      `python3 -c 'import sysconfig;print(sysconfig.get_paths()["purelib"])'`,
      { timeout: 20000, encoding: 'utf8' }).toString().trim();
  } catch (e) { diag.site = 'err ' + String(e.stderr || e.message).slice(0, 200); }
  try {
    diag.installed = String(require('child_process').execSync(
      `sh -c 'ls /usr/local/lib/python3*/dist-packages 2>/dev/null | grep -i -E "yt_dlp|bgutil" | head -5'`,
      { timeout: 20000, encoding: 'utf8' }).trim()).slice(0, 300);
  } catch (e) { diag.installed = 'err'; }
  try {
    diag.plugin = String(require('child_process').execSync('python3 -c "import yt_dlp_plugins" 2>&1', { timeout: 20000, encoding: 'utf8' }).trim()).slice(0, 300);
  } catch (e) { diag.plugin = ('ERR ' + String(e.stdout || '') + String(e.stderr || e.message)).slice(0, 400); }
  try {
    diag.ytdlp = String(require('child_process').execSync('python3 -m yt_dlp --version', { timeout: 20000, encoding: 'utf8' }).trim());
  } catch { }
  // -v so the "PO Token Providers" line shows whether the plugin actually loaded
  try {
    const { stderr } = await runYtDlp(['-v', '--dump-single-json', '--no-warnings', `https://www.youtube.com/watch?v=${videoId}`], 150000);
    diag.verbose = String(stderr || '').split('\n').filter(l => /pot|PO Token|plugin/i.test(l)).slice(-8).join(' | ').slice(0, 700);
  } catch (e) {
    diag.verbose = String(e.stderr || e.message || '').split('\n').filter(l => /pot|PO Token|plugin/i.test(l)).slice(-8).join(' | ').slice(0, 700);
  }
  try {
    const { stdout } = await runYtDlp(['--dump-single-json', '--no-warnings', `https://www.youtube.com/watch?v=${videoId}`], 150000);
    const data = parseYtJson(stdout);
    const formats = (data.formats || []).filter(f => f.url || f.fragments);
    return {
      ok: true, title: data.title, duration: data.duration,
      formats: formats.length, sample: formats.slice(-3).map(f => `${f.format_id}:${f.ext}${f.height ? '@' + f.height : ''}`),
      diag, ms: Date.now() - started,
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 600), diag, ms: Date.now() - started };
  }
}

module.exports = {
  probeYouTube, probeRaw, probeDownload, runYtDlp,
  __internals: { toExecFlags, usesExec: USE_EXEC, autoUpdate: AUTO_UPDATE, pluginPath: YTDLP_PLUGIN_PATH },
};

// Real download proof (not just extraction): pulls one audio stream to /tmp and reports the bytes, using
// the same yt-dlp binary the .song command uses. Proves the whole chain short of the WhatsApp send.
async function probeDownload(videoId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl-check-'));
  try {
    await runYtDlp(['-f', 'bestaudio/best', '--no-playlist', '-o', path.join(dir, 'test.%(ext)s'),
      `https://www.youtube.com/watch?v=${videoId}`], 200000);
    const files = fs.readdirSync(dir).map(f => ({ name: f, mb: +(fs.statSync(path.join(dir, f)).size / 1e6).toFixed(2) }));
    return { ok: files.length > 0, files };
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 300) };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { } }
}

// Raw one-shot yt-dlp run (no client fallback loop) so the probe can show the real verbose output:
// whether the PO-token plugin loaded and what the provider said.
async function probeRaw(videoId) {
  const potScript = process.env.YTDLP_POT_SCRIPT || '/opt/pot/server/build/generate_once.js';
  const nodePath = process.env.YTDLP_NODE_PATH || '/usr/local/bin/node';
  const args = ['-v', '-F', '--no-warnings', '--js-runtimes', `node:${nodePath}`,
    '--extractor-args', `youtubepot-bgutilscript:script_path=${potScript}`,
    '--extractor-args', `youtube:getpot_bgutil_script=${potScript}`,
    `https://www.youtube.com/watch?v=${videoId}`];
  let out, err;
  try { out = await runYtDlpRaw(args, 150000); }
  catch (e) { out = { stdout: e.stdout, stderr: e.stderr || e.message }; err = true; }
  const interesting = String(out.stderr || '').split('\n')
    .filter(l => /pot|PO Token|plugin|js runtimes|JS Challenge|ERROR|WARNING|node/i.test(l))
    .slice(0, 14).map(l => l.slice(0, 220)).join('\n');
  return { ok: !err, interesting, formats: String(out.stdout || '').split('\n').filter(l => /^\d+\s/.test(l)).length };
}
