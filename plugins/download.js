'use strict';
const { cmd } = require('../command');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let ffmpegStaticPath = null;
try { ffmpegStaticPath = require('ffmpeg-static'); } catch { ffmpegStaticPath = null; }

// ප්‍රශස්ත කළ Memory සහ Size සීමාවන් (Railway වැනි සර්වර් වලට ගැළපෙන ලෙස)
const MAX_BYTES = Math.max(10 * 1024 * 1024, Math.min(Number(process.env.MAX_DOWNLOAD_BYTES || 950000000), 950000000)); // ~950MB max to prevent heap crash
const URL_RE = /^https?:\/\//i;
const FFMPEG = process.env.FFMPEG_PATH || ffmpegStaticPath || 'ffmpeg';
const WA_VIDEO_LIMIT = Number(process.env.WA_VIDEO_LIMIT_BYTES || MAX_BYTES);
const FFMPEG_TIMEOUT = Number(process.env.FFMPEG_TIMEOUT_MS || 1800000);
const QUALITIES = new Set([144, 240, 360, 480, 720]);
const LIMIT_LABEL = `${(MAX_BYTES / (1024 ** 3)).toFixed(2)} GiB`;
const AUDIO_ONLY_EXT = new Set(['mp3', 'm4a', 'aac', 'opus', 'ogg', 'wav', 'wma', 'weba']);
const JS_RUNTIME = process.env.YTDLP_JS_RUNTIME === undefined ? 'node' : process.env.YTDLP_JS_RUNTIME;

// කූකීස් බෝධි ආරක්ෂාව (Dynamic handling)
const EMBEDDED_COOKIES_B64 = "IyBOZXRzY2FwZSBIVFRQIENvb2tpZSBGaWxlCiMgaHR0cHM6Ly9jdXJsLmhheHguc2UvcmZjL2Nvb2tpZV9zcGVjLmh0bWwKIyBUaGlzIGlzIGEgZ2VuZXJhdGVkIGZpbGUhIERvIG5vdCBlZGl0LgoKLnlvdXR1YmUuY29tCVRSVUUJLwFGQUxTRQkxODI3NDc4MDIwCUhTSUQJQXFKUHB2T1ZQRmpTMG1wa2wKLnlvdXR1YmUuY29tCVRSVUUJLwlUUlVFAkxODI3NDc4MDIwCVNTSUQJQUhEQmtkZzI4SEV4UnFrQkgKLnlvdXR1YmUuY29tCVRSVUUJLwFGQUxTRQkxODI3NDc4MDIwCkFQSVNJRABSbVBoV3dKQVNaVlJKSlkvQWNZUUFHUERsOENDUzhzVjAKLnlvdXR1YmUuY29tCVRSVUUJLwlUUlVFAkxODI3NDc4MDIwCVNBUElTSUQJbzlqTUNpZkFQaHQ0UEVDL0FQa3pNZlNrdHpjSEQxSGFIQgoueW91dHViZS5jb20JVFJVRQkvCVRSVUUJMTgyNzQ3ODAyMAlfX1NlY3VyZS0xUEFQSVNJRApvOWpNQ2lmQVBodDRQRTRDL0FQa3pNZlNrdHpjSEQxSGFIQgoueW91dHViZS5jb20JVFJVRQkvCVRSVUUJMTgyNzQ3ODAyMAlfX1NlY3VyZS0zUEFQSVNJRApvOWpNQ2lmQVBodDRQRTRDL0FQa3pNZlNrdHpjSEQxSGFIQgoueW91dHViZS5jb20JVFJVRQkvCVRSVUUJMTgyNzQ3ODAyMAlfX1NlY3VyZS0zUFNJRAJnLmEwMDBFQW1kYXMtbTVVoR0JQeEFHb25XOVBQQ0k5N1NLYWdXd0djeHZKcnhfVHJDakJoVllTcVFHd3dPb3lYTWpNV01FZTJXdUFBQ2dZS0FTQVNBUkFTRlFHSFgyTWlZSGFJMnhvLUI3VEVqTWYzeVJ5ZWdob1ZBVUY4WUtvYjZBRXlBbEhkOHZsblJfWlpFATh3MDA3NgoueW91dHViZS5jb20JVFJVRQkvCVRSVUUJMTgyNzQ3ODA4OQlQUkVGCWY2PTQwMDAwMDAwJnR6PUFzaWEuQ29sb21ibwoueW91dHViZS5jb20JVFJVRQkvCVRSVUUJMTgyNzQ3ODA3NwlMT0dJTl9JTkZPCkFGbW1GMnN3UlFJZ0tTVzZRaUd2RGdaRmhhc20yN1hDY1JfT3hDX1Y3V1ZBdC0tUzhzUlFWWllDSVFDVFdzWmpvVUlXb0FNWEJmZl84a3VWa2pQSWNZdndneVlIWUpVREZHWmp1QToJUVVRM0pqTnB3W2VMSkQ0ZEozZDFXRjRtY2VsOGhwYUxSdVg4MFFWODc1Sl9SZTVuVk9hNlloOE5fdGpucWJrbUpBRDVkSEhBRWo2WnYxaTZtRU1lbFNHcDV0K1JMdi1nMXlzVzRPQjBtaHgzUmVsb2NMVmpmZm9sbVFzRFpXTjhUWHA0LW96b2d2eC12MVBhNmdLNGdwMmM2R1hNWDlxUUFaS2cJb3V0dWJlLmNvbQlUUlVFAkvCVRSVUUJMTkyOTE4NjkwCkNPTlNJU1RFTkNZAEFJVWRuOGI5UVBSM1l2bTlYSVcyWktjaUh6ZFhVLWhSRVo1RzNvZFBkZUplWFdjem5WYmdZY3dxdGZlYbY2Vnb2hfMGJwSFFHc2FNUUJuRWJNN3RTX3hITmRhODBfcXZ5T0VBRWhhcUxWdkRyU25nQ0l3eFFsUl9VVGliaC1aUzVvNk1JTGJsanJpdnIxd1lENjRmCW5vdXR1YmUuY29tCVRSVUUJLwlUUlVFAkxODI0NDU0MDk2CV9fU2VjdXVyZS0xPSFQU0lEVFMJc2lkdHMtQ2pVQmtsZGpfendnM2tFaHN5YzBfVUhXRU9kcEtRMXFPOlBOaVBaTGpnUFZRbjhhNVBXQUVgRnFKNDdxWkhkMWNibHZjaXJJb3hBQQoueW91dHViZS5jb20JVFJVRQkvCVRSVUUJMTgyNDQ1NDA5NglfX1NlY3VyZS0zUFNJRElTSXN0cy1DbkpVS2xkal96Z1MzZ0Voc3ljMF9VSDdFT0RwS1ExcU85UE5pUFpMSmdQVlFuOGE1UFdBRTFGc0o0N3FaSGQxY2JsdmNpcklveEFBCi55b3V0dWJlLm1jb20JVFJVRQkvCVRSVUUJMAJZU0MJQTJJcVJEalNZUUUKLnlvdXR1YmUuY29tCVRSVUUJLwlUUlVFAkxODA4NDcwMDc4CVZJU0lUT1JfSU5GTzFMSUVEREluNk04b2ZEcjAKLnlvdXR1YmUuY29tCVRSVUUJLwlUUlVFAkxODA4NDcwMDc4CVZJU0lUT1JfUFJJVkFDWV9NRVRBREFUQQJDZ0pMU3hJRUdnQWdLQSUzRkIKLnlvdXR1YmUuY29tCVRSVUUJLwlUUlVFAkxODA4NDcwMDczCV9fU2VjdXJlLVlOSUQJQ3RvQkFVU2pBRUI4UVp1Wmc5cVJIa0xrbTN1dTNCNkExOWZuUHBKdWYzRC1LSENrdWpSaHNFMmduTHRweG51bWFnRlktUWI2djQ4cHFVRllGRVJDcl92STI5TUEyRTdvdWxFaFBpQWlLVjU2UmVkT2dVb0lqbXliTDF2QlVVUEd6MThrc3BBMkFRRXNjSjJvNVJBakxwRDhSZVRqV2o0ZEs2aXVrNVpDSmpuYWlYOWI4QmJNV01jZDd2dHp3eFhXV2ppdHRTZkFNayVCM3FtZFQza3FlYy0yajdpV285aUxWbzdETnRNajFFdGloV0gzc1RQNVpPTWc2eVBFQWhuZWF5VmZlOWk2RHd5RENUMDhZT1JJLXNXcGt1Mko3aGgxYVJYUUZRYw==";

function cookieArgs() {
  const rawEnv = String(process.env.YTDLP_COOKIES_B64 || process.env.YTDLP_COOKIES || EMBEDDED_COOKIES_B64).trim();
  if (!rawEnv || /^(off|none|no|0|false)$/i.test(rawEnv)) {
    try { fs.rmSync(path.join(os.tmpdir(), 'ytdlp-cookies.txt'), { force: true }); } catch { }
    return [];
  }
  let raw = rawEnv;
  if (!/# Netscape|\.youtube\.com/.test(raw)) {
    try {
      const decoded = Buffer.from(raw, 'base64').toString('utf8');
      if (/# Netscape|\.youtube\.com/.test(decoded)) raw = decoded;
    } catch { }
  }
  if (!raw.trim()) return [];
  const file = path.join(os.tmpdir(), 'ytdlp-cookies.txt');
  try { 
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, raw.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n'), { mode: 0o600 }); 
    }
  } catch (e) { 
    console.error('[cookies]', e.message); 
    return []; 
  }
  return ['--cookies', file];
}

const BLOCKED_RE = /Sign in to confirm|not a bot|Requested format is not available|HTTP Error 403|Precondition check failed|nsig|n challenge/i;
const FALLBACK_CLIENTS = (process.env.YTDLP_CLIENTS || 'web,android,ios').split(',').map(x => x.trim()).filter(Boolean);
const YT_RATE_LIMIT_RE = /429|Too Many Requests|rate.?limit/i;
const YT_COOLDOWN_MS = Number(process.env.YTDLP_COOLDOWN_MS || 5 * 60 * 1000); // 5 minutes optimized cooldown
let YT_BLOCKED_UNTIL = 0;

function parseYtJson(text) {
  const s = String(text || '');
  const from = Math.min(...[s.indexOf('{'), s.indexOf('[')].filter(i => i >= 0));
  if (!Number.isFinite(from)) throw new Error(`yt-dlp returned no JSON (got: ${s.slice(0, 160)})`);
  const to = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  return JSON.parse(s.slice(from, to + 1));
}

async function runYtDlp(args, timeoutMs = 240000) {
  if (Date.now() < YT_BLOCKED_UNTIL) {
    const mins = Math.max(1, Math.ceil((YT_BLOCKED_UNTIL - Date.now()) / 60000));
    throw new Error(`YouTube තාම rate-limit කරලා (${mins} min) — කරුණාකර ටිකකින් උත්සාහ කරන්න.`);
  }
  const proxy = process.env.YTDLP_PROXY ? ['--proxy', process.env.YTDLP_PROXY] : [];
  const withCookies = [...proxy, ...cookieArgs(), ...args];
  const potScript = process.env.YTDLP_POT_SCRIPT || '/opt/pot/server/build/generate_once.js';
  const potArg = fs.existsSync(potScript) ? `getpot_bgutil_script=${potScript}` : '';
  const potArgs = fs.existsSync(potScript) ? ['--extractor-args', `youtubepot-bgutilscript:script_path=${potScript}`] : [];

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
        throw err;
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

function runYtDlpRaw(args, timeoutMs = 240000) {
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
    await c.reply(`⏳ *${mode.label}* සූදානම් කරනවා…\n🔎 නමක් හෝ URL එකක් සෙවීම සිදුකෙරේ.`);
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
    
    const { stdout } = await runYtDlp(args, Number(process.env.DOWNLOAD_TIMEOUT_MS || 1800000));
    const printed = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    let file = printed && fs.existsSync(printed) ? printed : null;
    if (!file) {
      const candidates = fs.readdirSync(dir).map(n => path.join(dir,n)).filter(p => fs.existsSync(p) && fs.statSync(p).isFile());
      file = candidates.sort((a,b) => fs.statSync(b).size - fs.statSync(a).size)[0] || null;
    }
    if (!file) throw new Error('ဖိုင် එක සාර්ථකව ඩවුන්ලෝඩ් වුණේ නැත.');
    
    const stat = fs.statSync(file);
    if (stat.size > MAX_BYTES) throw new Error(`File too large: ${(stat.size / (1024 ** 3)).toFixed(2)} GiB; limit ${LIMIT_LABEL}`);
    
    const ext = path.extname(file).slice(1).toLowerCase() || (mode.audio ? 'mp3' : 'mp4');
    if (!mode.audio && AUDIO_ONLY_EXT.has(ext)) {
      throw new Error(`AUDIO_ONLY_RESULT: මෙම ලින්ක් එකෙන් වීඩියෝවක් ලබාගත නොහැක (ප්‍රතිඵලය audio පමණි).`);
    }
    
    const title = path.basename(file, path.extname(file));
    if (mode.audio) {
      if (stat.size > 100 * 1024 * 1024) await sendAsDocument(sock, c, file, title, ext, 'audio/mpeg', '📦 ෆိုင် එක විශාල වැඩි නිසා Document එකක් ලෙස එවන ලදී.');
      else await sendAsAudio(sock, c, file, title);
      return;
    }
    
    const codecs = await probeCodecs(file);
    if (!codecs.video) throw new Error('AUDIO_ONLY_RESULT: වීඩියෝ ට්‍රැක් එකක් හමු වුණේ නැත.');
    
    let playable = await makePlayableMp4(file, dir, codecs);
    let note = '';
    if (fs.statSync(playable).size > WA_VIDEO_LIMIT) {
      await c.reply('🗜️ වීඩියෝව විශාල වැඩි නිසා WhatsApp ප්‍රමාණයට කුඩා කරමින් පවතී (360p)…').catch(() => {});
      playable = await shrinkToFit(playable, dir);
      note = '360p';
    }
    
    const finalSize = fs.statSync(playable).size;
    if (finalSize <= WA_VIDEO_LIMIT) {
      const thumb = await makeThumb(playable, dir);
      await sendAsVideo(sock, c, playable, title, thumb, note || (height ? `${height}p` : ''));
    } else {
      await sendAsDocument(sock, c, playable, title, 'mp4', 'video/mp4', '📦 වීඩියෝ සීමාව ඉක්මවා ගිය බැවින් File එකක් ලෙස අමුණන ලදී.');
    }
  } catch (e) {
    console.error(`[${mode.command}]`, e.message);
    let message = '❌ ඩවුන්ලෝඩ් කිරීම අසාර්ථකයි.';
    if (/AUDIO_ONLY_RESULT/i.test(e.message)) message = '⚠️ මෙම ලින්ක් එකෙන් වීඩියෝවක් ලබාගත නොහැක (Audio track පමණි).\n🔁 වෙනත් ලින්ක් එකක් උත්සාහ කරන්න.';
    else if (/max-filesize|file is larger|too large/i.test(e.message)) message += `\n📏 File size limit: ${LIMIT_LABEL}.`;
    else if (/Sign in to confirm|not a bot/i.test(e.message)) message += '\n🍪 YouTube ආරක්ෂක පද්ධතිය මඟින් තාවකාලිකව වළකා ඇත.';
    else if (/timed out/i.test(e.message)) message += '\n⏱️ ඩවුන්ලෝඩ් කාලය ඉක්මවා ගියේය (Timeout).';
    else message += `\n🌐 දෝෂය: ${e.message.slice(0, 150)}`;
    
    await c.reply(message);
  } finally { 
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} 
  }
}

// Commands
cmd({ pattern: 'ytsearch', alias: ['musicsearch','videosearch'], desc: 'Search YouTube results', category: 'download' }, async (_s,_m,_msg,c) => {
  if (!c.q) return c.reply(`🔎 භාවිතය: ${c.prefix}ytsearch song/video name`);
  try {
    const { stdout } = await runYtDlp(['--dump-single-json','--flat-playlist','--no-warnings',`ytsearch5:${c.q}`], 60000);
    const data = parseYtJson(stdout);
    const entries = (data.entries || []).slice(0,5);
    if (!entries.length) return c.reply('😕 ප්‍රතිඵල හමු වුණේ නැහැ.');
    return c.reply('╭─〔 🔎 *YOUTUBE SEARCH* 〕\n' + entries.map((v,i)=>`│ ${i+1}. *${v.title || 'Untitled'}*\n│ 🔗 https://www.youtube.com/watch?v=${v.id}`).join('\n│\n') + '\n╰────────────────\n\n⬇️ Video: .ytvideo song name\n🎵 MP3: .song song name');
  } catch (e) { console.error('[ytsearch]',e.message); return c.reply('❌ සෙවීම අසාර්ථකයි.'); }
});

cmd({ pattern: 'ytvideo', alias: ['ytmp4'], desc: 'Download YouTube video', category: 'download' }, async (s,m,msg,c) => downloadCommand(s,m,msg,c,{command:'ytvideo',label:'YouTube video (480p)',height:480}));
cmd({ pattern: 'song', alias: ['ytmp3','mp3'], desc: 'Download MP3', category: 'download' }, async (s,m,msg,c) => downloadCommand(s,m,msg,c,{command:'song',label:'Song MP3',audio:true}));
cmd({ pattern: 'fbvideo', alias: ['facebook'], desc: 'Download Facebook video', category: 'download' }, async (s,m,msg,c) => downloadCommand(s,m,msg,c,{command:'fbvideo',label:'Facebook video',height:720,urlOnly:true}));
cmd({ pattern: 'ttvideo', alias: ['tiktok'], desc: 'Download TikTok video', category: 'download' }, async (s,m,msg,c) => downloadCommand(s,m,msg,c,{command:'ttvideo',label:'TikTok video',height:720,urlOnly:true}));
cmd({ pattern: 'download', alias: ['media'], desc: 'Download media', category: 'download' }, async (s,m,msg,c) => downloadCommand(s,m,msg,c,{command:'download',label:'Media download',height:720}));

module.exports = { runYtDlp };
