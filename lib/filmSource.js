'use strict';
/**
 * CineSubz film source (search → resolve → quality variants).
 *
 * This is a Node port of the `filmfetch.py` flow that used to live in the
 * standalone filmbot tool. It deliberately has no Python, no PC bridge and no
 * PowerShell dependency: the bot host (local or cloud) does the HTTP work.
 *
 * Only CineSubz pages and the media URLs returned by its own player API are
 * accepted. Private/loopback hosts are rejected so a compromised page cannot
 * turn this into an SSRF primitive.
 */

const DEFAULT_SITE = 'https://cinesubz.net';
// The site answers on BOTH hosts: the search page is cinesubz.net but every result link it returns is
// cinesubz.lk (verified 2026-11-09). Accepting only the configured host made every search return [] —
// which is why `.film`/`.movie` answered "no films found" for titles that exist.
const SITE_HOSTS = new Set(['cinesubz.net', 'www.cinesubz.net', 'cinesubz.lk', 'www.cinesubz.lk']);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const QUALITY_ORDER = ['1080p', '720p', '480p', '360p', '240p'];

function site() {
  return String(process.env.FILM_SITE || DEFAULT_SITE).replace(/\/+$/, '');
}

function timeoutMs() {
  return Math.max(5000, Number(process.env.FILM_REQUEST_TIMEOUT_MS || 45000));
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, '’');
}

function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === 'metadata.google.internal') return true;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
    if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;
  }
  return false;
}

/** Throw unless this is a public http(s) URL. */
function assertPublicHttpUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new Error('Invalid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http(s) URLs are allowed');
  if (isPrivateHost(parsed.hostname)) throw new Error('Private/loopback hosts are not allowed');
  return parsed;
}

function assertSourceUrl(url) {
  const parsed = assertPublicHttpUrl(url);
  const allowed = new URL(site()).hostname.toLowerCase();
  if (parsed.hostname.toLowerCase() !== allowed && !SITE_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(`Only ${allowed} / cinesubz.lk links are accepted`);
  }
  return parsed;
}

async function fetchText(url, { fetchImpl = global.fetch, timeout = timeoutMs() } = {}) {
  assertPublicHttpUrl(url);
  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`Request timed out: ${url}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The player API returned invalid JSON');
  }
}

// ── search ──────────────────────────────────────────────────────────────────

function parseSearchResults(html, base = site()) {
  let host = 'cinesubz.net', origin = 'https://cinesubz.net';
  try { const u = new URL(base); host = u.hostname.toLowerCase(); origin = u.origin; } catch { }
  const out = [];
  const seen = new Set();
  // Real result markup: <a href="https://cinesubz.lk/movies/<slug>/" data-url="<slug>"
  // data-ptype="movies" title="<Film> (2016) Sinhala Subtitle | …"></a> — the anchor has NO inner text,
  // the human title lives in the title attribute, and the host may be .lk or .net (or relative).
  const tagRe = /<a\b[^>]*href=["']([^"']*\/movies\/[^"'#?]+)["'][^>]*>/gi;
  let match;
  while ((match = tagRe.exec(String(html || '')))) {
    let abs;
    try { abs = new URL(decodeEntities(match[1]), origin).href.replace(/\?.*$/, ''); } catch { continue; }
    let candidate;
    try { candidate = new URL(abs); } catch { continue; }
    const candHost = candidate.hostname.toLowerCase();
    if (candHost !== host && !SITE_HOSTS.has(candHost)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);

    const tag = match[0];
    let text = decodeEntities((tag.match(/\btitle=["']([^"']{1,180})["']/i) || [])[1] || '').trim();
    if (!text) {   // some layouts put the name right after the anchor instead
      const after = String(html).slice(tagRe.lastIndex, tagRe.lastIndex + 160);
      text = decodeEntities((after.match(/^([^<]{1,140})/) || [])[1] || '').trim();
    }
    const slug = abs.replace(/\/+$/, '').split('/').pop() || abs;
    out.push({ url: abs, title: text || slug });
  }
  return out;
}

function queryTokens(query) {
  return String(query || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .map(token => token.trim())
    .filter(token => token.length >= 2);
}

function scoreCandidates(candidates, query) {
  const tokens = queryTokens(query);
  return [...candidates].sort((a, b) => {
    const hayA = `${a.url} ${a.title}`.toLowerCase();
    const hayB = `${b.url} ${b.title}`.toLowerCase();
    const scoreA = tokens.reduce((sum, token) => sum + (hayA.includes(token) ? 1 : 0), 0);
    const scoreB = tokens.reduce((sum, token) => sum + (hayB.includes(token) ? 1 : 0), 0);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.url.length - b.url.length;
  });
}

async function searchFilms(name, { fetchImpl = global.fetch } = {}) {
  const query = String(name || '').trim();
  if (!query) return [];
  const url = `${site()}/?s=${encodeURIComponent(query)}`;
  let candidates = [];
  try {
    candidates = parseSearchResults(await fetchText(url, { fetchImpl }), site());
  } catch {
    candidates = [];
  }

  // Best-effort fallback. It is still restricted to the configured site host.
  if (!candidates.length && String(process.env.FILM_DDG_FALLBACK || 'true').toLowerCase() !== 'false') {
    try {
      const ddg = await fetchText(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:${new URL(site()).hostname} ${query} sinhala subtitles`)}`,
        { fetchImpl, timeout: 20000 }
      );
      candidates = parseSearchResults(ddg, site());
    } catch {
      candidates = [];
    }
  }

  return scoreCandidates(candidates, query);
}

// ── resolve ─────────────────────────────────────────────────────────────────

function parsePlayerOptions(html) {
  const out = [];
  const seen = new Set();
  // Attributes on real pages can appear in either order, so inspect each tag
  // rather than betting on data-post coming first.
  const tagRe = /<[a-z][^>]*>/gi;
  let tag;
  while ((tag = tagRe.exec(String(html || '')))) {
    const raw = tag[0];
    if (!/data-post=/i.test(raw) || !/data-nume=/i.test(raw)) continue;
    const post = raw.match(/data-post=["'](\d+)["']/i);
    const nume = raw.match(/data-nume=["']([^"']+)["']/i);
    if (!post || !nume) continue;
    const key = `${post[1]}:${nume[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ postId: post[1], nume: nume[1] });
  }
  return out;
}

/**
 * Encode characters that a URL path may legally contain on the page but that
 * fetch() rejects (spaces, brackets). Existing %XX escapes are left untouched.
 */
function encodeMediaUrl(value) {
  return String(value || '')
    .replace(/ /g, '%20')
    .replace(/\[/g, '%5B')
    .replace(/\]/g, '%5D')
    .replace(/\{/g, '%7B')
    .replace(/\}/g, '%7D');
}

function parseEmbedVariants(html) {
  const out = [];
  const seen = new Set();
  const re = /(https?:\/\/[^"'<>]+?\.mp4(?:\?|&(?:amp;)?)play=true)/gi;
  let match;
  while ((match = re.exec(String(html || '')))) {
    const url = encodeMediaUrl(decodeEntities(match[0]));
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function qualityOf(url) {
  const match = String(url || '').match(/(?:^|[-_/])(\d{3,4})p(?:[-_.?&/]|$)/i)
    || String(url || '').match(/(\d{3,4})p/i);
  return match ? `${match[1]}p` : '?';
}

function sortVariants(urls) {
  const unique = [...new Set((urls || []).map(String))];
  return unique
    .map(url => ({ url, quality: qualityOf(url) }))
    .sort((a, b) => {
      const ai = QUALITY_ORDER.indexOf(a.quality);
      const bi = QUALITY_ORDER.indexOf(b.quality);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
}

function pickVariant(variants, quality = '480p') {
  const list = Array.isArray(variants) ? variants : [];
  if (!list.length) return null;
  const wanted = String(quality || '').toLowerCase();
  const exact = list.find(variant => String(variant.quality).toLowerCase() === wanted);
  if (exact) return exact;

  const wantedText = String(wanted).toLowerCase();
  let wantedNumber = Number(wantedText.replace(/\D/g, '')) || 0;
  if (/k$/.test(wantedText) && wantedNumber) wantedNumber *= 1000;
  const numeric = list
    .map(variant => ({ variant, number: Number(String(variant.quality).replace(/\D/g, '')) || 0 }))
    .filter(item => item.number > 0);

  const below = numeric
    .filter(item => item.number <= wantedNumber)
    .sort((a, b) => b.number - a.number)[0];
  if (below) return below.variant;

  // A quality above every available variant means "best", not "lowest".
  const ascending = [...numeric].sort((a, b) => a.number - b.number);
  if (wantedNumber && ascending.length && wantedNumber > ascending[ascending.length - 1].number) {
    return ascending[ascending.length - 1].variant;
  }
  return ascending.length ? ascending[0].variant : list[0];
}

function pageTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = decodeEntities(match ? match[1] : '').replace(/\s+/g, ' ').trim();
  title = title.replace(/\s*\|\s*.*$/, '');
  title = title.replace(/\s+[-–]\s+CineSubz.*$/i, '');
  return title.trim();
}

function titleMatches(query, title) {
  const q = String(query || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const t = String(title || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!q || !t) return false;
  if (q === t || t.includes(q) || q.includes(t)) return true;
  const tokens = queryTokens(query);
  if (!tokens.length) return false;
  // Require most tokens to match, otherwise a common word like "the" would
  // auto-select an unrelated film instead of showing the choice list.
  const matched = tokens.filter(token => t.includes(token)).length;
  return matched === tokens.length || matched / tokens.length >= 0.75;
}

function parseContentRange(value) {
  const match = String(value || '').match(/bytes\s+\d+-\d+\/(\d+)/i);
  return match ? Number(match[1]) : 0;
}

async function headSize(url, { fetchImpl = global.fetch, timeout = timeoutMs() } = {}) {
  assertPublicHttpUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    let res = await fetchImpl(url, {
      method: 'HEAD',
      headers: { 'User-Agent': UA },
      redirect: 'follow',
      signal: controller.signal,
    });
    const type = res?.headers?.get?.('content-type') || '';
    const length = Number(res?.headers?.get?.('content-length') || 0);
    if (res?.ok && length > 0) return { bytes: length, contentType: type };

    res = await fetchImpl(url, {
      headers: { 'User-Agent': UA, Range: 'bytes=0-0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const rangeType = res?.headers?.get?.('content-type') || type;
    const total = parseContentRange(res?.headers?.get?.('content-range') || '');
    try { await res?.body?.cancel?.(); } catch { /* ignore */ }
    if (total > 0) return { bytes: total, contentType: rangeType };
    return { bytes: 0, contentType: rangeType };
  } catch {
    return { bytes: 0, contentType: '' };
  } finally {
    clearTimeout(timer);
  }
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return 'size නොදනී';
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} GB`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)} KB`;
  return `${value} B`;
}

async function resolveFilm(pageUrl, quality = '480p', { fetchImpl = global.fetch, withSizes = false } = {}) {
  assertSourceUrl(pageUrl);
  const page = await fetchText(pageUrl, { fetchImpl });
  const options = parsePlayerOptions(page);
  if (!options.length) throw new Error('මේ page එකේ player options හමු වුණේ නෑ');

  const { postId, nume } = options[0];
  let api = `${site()}/wp-json/zetaplayer/v2/mv/${postId}`;
  if (nume && nume !== '1') api += `?nume=${encodeURIComponent(nume)}`;
  const meta = await fetchJson(api, { fetchImpl });
  const embed = String(meta?.embed_url || '');
  if (!embed) throw new Error('Player API එකෙන් embed URL එකක් ලැබුණේ නෑ');

  let rawVariants;
  if (embed.toLowerCase().split('?')[0].endsWith('.mp4')) {
    const base = encodeMediaUrl(embed);
    rawVariants = [`${base}${base.includes('?') ? '&' : '?'}play=true`];
  } else {
    const embedPage = await fetchText(embed, { fetchImpl, timeout: Math.max(timeoutMs(), 60000) });
    rawVariants = parseEmbedVariants(embedPage);
  }

  const variants = sortVariants(rawVariants);
  if (!variants.length) throw new Error('Playable .mp4 variant එකක් හමු වුණේ නෑ');

  let table = variants;
  if (withSizes) {
    const capped = variants.slice(0, 8);
    const sizes = await Promise.allSettled(
      capped.map(variant => headSize(variant.url, { fetchImpl }))
    );
    table = capped.map((variant, index) => {
      const info = sizes[index]?.status === 'fulfilled' ? sizes[index].value : { bytes: 0, contentType: '' };
      return { ...variant, bytes: info.bytes, contentType: info.contentType };
    });
  }

  const chosen = pickVariant(table, quality);
  return {
    title: pageTitle(page) || pageUrl.replace(/\/+$/, '').split('/').pop(),
    page: pageUrl,
    postId,
    nume,
    embedUrl: embed,
    variants: table,
    chosen,
  };
}

module.exports = {
  DEFAULT_SITE,
  QUALITY_ORDER,
  site,
  timeoutMs,
  decodeEntities,
  isPrivateHost,
  assertPublicHttpUrl,
  assertSourceUrl,
  fetchText,
  fetchJson,
  parseSearchResults,
  queryTokens,
  scoreCandidates,
  searchFilms,
  parsePlayerOptions,
  parseEmbedVariants,
  encodeMediaUrl,
  qualityOf,
  sortVariants,
  pickVariant,
  pageTitle,
  titleMatches,
  parseContentRange,
  headSize,
  formatBytes,
  resolveFilm,
};
