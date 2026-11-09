'use strict';
/**
 * Movie metadata + media-offer provider layer.
 *
 * Design goal: the *sources* are pluggable, so the rest of the bot never
 * changes when you add a new catalogue.
 *
 *   catalogue  -> your own authorised/owned media manifest (data/movies.json)
 *   tmdb       -> TMDB metadata: title, year, rating, runtime, genres, poster,
 *                 trailer and "where to watch" (no download links, by design)
 *   site       -> optional headless-browser provider for a site you are allowed
 *                 to automate (see data/site-provider.example.json)
 *
 * Every function resolves to { ok: true, ... } or { ok: false, error }.
 * Nothing throws, so the command handler can always reply with something sane.
 *
 * No new npm dependency is required: Node 20+ has global fetch.
 */

const fs = require('fs');
const path = require('path');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const TMDB_BACKDROP = 'https://image.tmdb.org/t/p/w780';
const FETCH_TIMEOUT_MS = Number(process.env.MOVIE_FETCH_TIMEOUT_MS || 12000);
const CACHE_TTL_MS = Number(process.env.MOVIE_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const CACHE_MAX = Number(process.env.MOVIE_CACHE_MAX || 300);
const REGION = String(process.env.MOVIE_REGION || 'US').toUpperCase();
const CATALOG_PATH = process.env.MOVIE_CATALOG_PATH || path.join(__dirname, '..', 'data', 'movies.json');
const SITE_CONFIG_PATH = process.env.MOVIE_SITE_CONFIG || path.join(__dirname, '..', 'data', 'site-provider.json');
const USER_AGENT =
  process.env.MOVIE_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

/* ────────────────────────────────────────────────────────────────────────────
 *  Errors + tiny helpers
 * ──────────────────────────────────────────────────────────────────────────── */
class ProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

const fail = (err) => ({
  ok: false,
  error: {
    code: (err && err.code) || 'ERROR',
    message: (err && err.message) || String(err),
  },
});

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** Normalise a title for fuzzy comparison: lowercase, no accents, no year, no punctuation. */
function normalizeTitle(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b(sinhala|subtitles?|subs?|dubbed|hq|full movie|download|watch online)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Dice coefficient over token sets, 0..1, with an exact-match boost. */
function similarity(a, b) {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;

  const setA = new Set(x.split(' ').filter(Boolean));
  const setB = new Set(y.split(' ').filter(Boolean));
  let overlap = 0;
  for (const token of setA) if (setB.has(token)) overlap += 1;
  return (2 * overlap) / (setA.size + setB.size || 1);
}

/** "Dune Part Two 2024" -> { title: 'Dune Part Two', year: 2024 } */
function splitQuery(query) {
  const raw = clean(query);
  const m = raw.match(/\b(19|20)\d{2}\b/);
  return { title: m ? clean(raw.replace(m[0], ' ')) || raw : raw, year: m ? Number(m[0]) : null };
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Small TTL cache (bounded, so long-running bots do not leak)
 * ──────────────────────────────────────────────────────────────────────────── */
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Refresh LRU position.
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { at: Date.now(), value });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

/* ────────────────────────────────────────────────────────────────────────────
 *  TMDB
 * ──────────────────────────────────────────────────────────────────────────── */
function tmdbCredentials() {
  const token = clean(process.env.TMDB_ACCESS_TOKEN);
  const key = clean(process.env.TMDB_API_KEY);
  return { token, key };
}

async function tmdbGet(endpoint, params = {}) {
  const { token, key } = tmdbCredentials();
  if (!token && !key) throw new ProviderError('NO_API_KEY', 'TMDB_API_KEY / TMDB_ACCESS_TOKEN is not configured');

  const url = new URL(TMDB_BASE + endpoint);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, String(v));
  if (!token) url.searchParams.set('api_key', key);

  let lastError;
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (res.status === 401 || res.status === 403) throw new ProviderError('AUTH', 'TMDB rejected the API key');
      if (res.status === 429) throw new ProviderError('RATE_LIMIT', 'TMDB rate limit reached');
      if (res.status === 404) throw new ProviderError('NOT_FOUND', 'TMDB resource not found');
      if (res.status >= 500) throw new ProviderError('UPSTREAM', `TMDB answered ${res.status}`);
      if (!res.ok) throw new ProviderError('HTTP_' + res.status, `TMDB answered ${res.status}`);

      return await res.json();
    } catch (err) {
      lastError = err;
      const retryable = !(err instanceof ProviderError) || ['RATE_LIMIT', 'UPSTREAM'].includes(err.code);
      if (!retryable || attempt === 1) break;
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  if (lastError instanceof ProviderError) throw lastError;
  throw new ProviderError(lastError && lastError.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', (lastError && lastError.message) || 'TMDB request failed');
}

function mapTmdbMovie(detail, providerList, matchedTitle) {
  const providers = (providerList && providerList.results && providerList.results[REGION]) || {};
  const whereToWatch = [
    ...(providers.flatrate || []).map((p) => ({ name: p.provider_name, url: providers.link || '' })),
    ...(providers.free || []).map((p) => ({ name: p.provider_name, url: providers.link || '' })),
  ];
  const seen = new Set();
  const uniqueWatch = whereToWatch.filter((p) => {
    const k = p.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const trailer = ((detail.videos && detail.videos.results) || []).find(
    (v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser')
  );

  return {
    source: 'tmdb',
    title: clean(detail.title || detail.original_title || matchedTitle),
    originalTitle: clean(detail.original_title || ''),
    year: Number(String(detail.release_date || '').slice(0, 4)) || null,
    rating: detail.vote_average ? Number(detail.vote_average.toFixed(1)) : null,
    votes: Number(detail.vote_count || 0),
    runtimeMin: Number(detail.runtime || 0) || null,
    genres: (detail.genres || []).map((g) => g.name).slice(0, 4),
    synopsis: clean(detail.overview || ''),
    poster: detail.poster_path ? TMDB_IMG + detail.poster_path : '',
    backdrop: detail.backdrop_path ? TMDB_BACKDROP + detail.backdrop_path : '',
    imdbId: (detail.external_ids && detail.external_ids.imdb_id) || '',
    imdbUrl: detail.external_ids && detail.external_ids.imdb_id ? `https://www.imdb.com/title/${detail.external_ids.imdb_id}/` : '',
    tmdbUrl: `https://www.themoviedb.org/movie/${detail.id}`,
    trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : '',
    whereToWatch: uniqueWatch.slice(0, 4),
    offers: [],
    language: clean(detail.original_language || ''),
  };
}

async function searchTmdb(query) {
  const { title, year } = splitQuery(query);
  const searched = await tmdbGet('/search/movie', {
    query: title || query,
    include_adult: 'false',
    language: 'en-US',
    page: 1,
  });

  const results = (searched.results || []).slice(0, 12);
  if (!results.length) throw new ProviderError('NO_RESULTS', 'No TMDB match');

  const ranked = results
    .map((r) => {
      let score = similarity(title || query, r.title) + similarity(title || query, r.original_title) * 0.5;
      const releaseYear = Number(String(r.release_date || '').slice(0, 4)) || null;
      if (year && releaseYear === year) score += 0.4;
      if (!year && r.popularity) score += Math.min(0.15, r.popularity / 5000);
      return { r, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.score < 0.35) throw new ProviderError('NO_RESULTS', 'No confident TMDB match');

  const id = best.r.id;
  const cacheKey = `tmdb:${id}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const detail = await tmdbGet(`/movie/${id}`, {
    append_to_response: 'external_ids,videos,watch/providers',
    language: 'en-US',
  });

  const movie = mapTmdbMovie(detail, detail['watch/providers'], title || query);
  cacheSet(cacheKey, movie);
  return movie;
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Catalogue (your own authorised media)
 * ──────────────────────────────────────────────────────────────────────────── */
let catalogCache = { mtime: 0, movies: [] };

function loadCatalog() {
  let stat;
  try {
    stat = fs.statSync(CATALOG_PATH);
  } catch {
    return [];
  }
  if (stat.mtimeMs === catalogCache.mtime) return catalogCache.movies;

  try {
    const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    const list = Array.isArray(raw) ? raw : Array.isArray(raw.movies) ? raw.movies : [];
    const movies = list
      .map((m) => {
        if (!m || !m.title) return null;
        return {
          id: clean(m.id || m.title),
          title: clean(m.title),
          year: Number(m.year) || null,
          aliases: Array.isArray(m.aliases) ? m.aliases.map(clean).filter(Boolean) : [],
          imdbId: clean(m.imdbId || ''),
          poster: clean(m.poster || ''),
          synopsis: clean(m.synopsis || ''),
          rating: Number(m.rating) || null,
          runtimeMin: Number(m.runtimeMin || m.runtime) || null,
          genres: Array.isArray(m.genres) ? m.genres.map(clean).filter(Boolean) : [],
          offers: (Array.isArray(m.offers) ? m.offers : []).map(sanitizeOffer).filter(Boolean),
        };
      })
      .filter(Boolean);

    catalogCache = { mtime: stat.mtimeMs, movies };
    return movies;
  } catch (err) {
    console.error('[movieProvider] catalogue parse failed:', err.message);
    catalogCache = { mtime: stat.mtimeMs, movies: [] };
    return [];
  }
}

/** Only absolute http(s) URLs survive. Keeps user-editable JSON from injecting junk. */
function sanitizeOffer(offer) {
  if (!offer || typeof offer !== 'object') return null;
  let url;
  try {
    url = new URL(String(offer.url || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const quality = clean(offer.quality || offer.label || 'auto').slice(0, 24);
  const type = ['direct', 'stream', 'page'].includes(offer.type) ? offer.type : 'direct';

  return {
    quality,
    url: url.toString(),
    host: url.hostname.replace(/^www\./, ''),
    sizeBytes: Math.max(0, Number(offer.sizeBytes) || 0),
    type,
    label: clean(offer.label || '').slice(0, 80),
  };
}

function searchCatalog(query) {
  const movies = loadCatalog();
  if (!movies.length) throw new ProviderError('EMPTY_CATALOG', 'Catalogue is empty or missing');
  const { title, year } = splitQuery(query);

  const ranked = movies
    .map((m) => {
      const names = [m.title, ...m.aliases];
      let score = Math.max(...names.map((n) => similarity(title || query, n)));
      if (year && m.year === year) score += 0.4;
      return { m, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.score < 0.6) throw new ProviderError('NO_RESULTS', 'No catalogue match');
  return best.m;
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Optional headless-browser provider (config driven, owner-controlled site)
 * ──────────────────────────────────────────────────────────────────────────── */
function loadSiteConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(SITE_CONFIG_PATH, 'utf8'));
    if (!raw || raw.enabled !== true) return null;
    if (!raw.baseUrl || !raw.searchUrl) return null;
    return raw;
  } catch {
    return null;
  }
}

async function searchSite(query) {
  const cfg = loadSiteConfig();
  if (!cfg) throw new ProviderError('DISABLED', 'Site provider is not configured');
  if (String(process.env.BROWSER_ENABLED || 'false') !== 'true') {
    throw new ProviderError('DISABLED', 'BROWSER_ENABLED is not true');
  }

  const { withPage } = require('./browser');
  const searchUrl = cfg.searchUrl.includes('{q}')
    ? cfg.searchUrl.replace('{q}', encodeURIComponent(query))
    : cfg.searchUrl;

  return withPage(
    async (page) => {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

      // If the search page needs an explicit type + submit, do it.
      if (cfg.inputSelector && !cfg.searchUrl.includes('{q}')) {
        await page.fill(cfg.inputSelector, query);
        const submit = cfg.submitSelector
          ? page.click(cfg.submitSelector)
          : page.press(cfg.inputSelector, 'Enter');
        await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), submit.catch(() => {})]);
      }

      const resultSelector = cfg.resultSelector || 'a';
      await page.waitForSelector(resultSelector, { timeout: Number(cfg.searchTimeoutMs) || 15000 });

      const results = await page.$$eval(
        resultSelector,
        (els, base) =>
          els
            .slice(0, 20)
            .map((el) => ({
              title: (el.textContent || '').replace(/\s+/g, ' ').trim(),
              url: el.href || (base ? new URL(el.getAttribute('href') || '', base).toString() : ''),
            }))
            .filter((r) => r.url && /^https?:/i.test(r.url)),
        cfg.baseUrl
      );

      if (!results.length) throw new ProviderError('NO_RESULTS', 'Site search returned no results');

      const { title, year } = splitQuery(query);
      const best = results
        .map((r) => {
          let score = similarity(title || query, r.title);
          if (year && r.title.includes(String(year))) score += 0.35;
          return { r, score };
        })
        .sort((a, b) => b.score - a.score)[0];

      if (!best || best.score < 0.3) throw new ProviderError('NO_RESULTS', 'No confident site match');

      const detail = cfg.detail || {};
      await page.goto(best.r.url, { waitUntil: 'domcontentloaded' });

      const readText = async (selector) => {
        if (!selector) return '';
        try {
          return clean(await page.$eval(selector, (el) => el.textContent || ''));
        } catch {
          return '';
        }
      };

      const pageTitle = (await readText(detail.title)) || best.r.title || (await page.title());
      const synopsis = await readText(detail.synopsis);
      const ratingText = await readText(detail.rating);
      const ratingMatch = ratingText.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);

      let links = [];
      if (detail.links) {
        links = await page.$$eval(
          detail.links,
          (els, base) =>
            els
              .slice(0, 40)
              .map((el) => ({
                label: (el.textContent || '').replace(/\s+/g, ' ').trim(),
                url: el.href || (base ? new URL(el.getAttribute('href') || '', base).toString() : ''),
              }))
              .filter((l) => l.url && /^https?:/i.test(l.url)),
          best.r.url
        );
      }

      return {
        source: 'site',
        title: pageTitle,
        originalTitle: '',
        year: (pageTitle.match(/\b(19|20)\d{2}\b/) || [])[0] ? Number((pageTitle.match(/\b(19|20)\d{2}\b/) || [])[0]) : null,
        rating: ratingMatch ? Number(ratingMatch[1]) : null,
        votes: 0,
        runtimeMin: null,
        genres: [],
        synopsis,
        poster: '',
        backdrop: '',
        imdbId: '',
        imdbUrl: '',
        tmdbUrl: '',
        trailerUrl: '',
        whereToWatch: [],
        offers: links.map((l) =>
          sanitizeOffer({
            quality: l.label || 'link',
            label: l.label,
            url: l.url,
            type: /\.(mp4|mkv|webm)(\?|$)/i.test(l.url) ? 'direct' : 'page',
          })
        ).filter(Boolean),
        language: '',
      };
    },
    { label: 'movie-site-search' }
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Public API
 * ──────────────────────────────────────────────────────────────────────────── */
function enabledProviders() {
  const raw = clean(process.env.MOVIE_PROVIDERS);
  if (raw) return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const list = ['catalog', 'tmdb'];
  if (loadSiteConfig()) list.push('site');
  return list;
}

/**
 * Search one movie across the configured providers.
 *
 * Order matters: `catalog` supplies playable/authorised offers, `tmdb` supplies
 * rich metadata. When both match, TMDB metadata is merged onto the catalogue
 * entry so the card is pretty but the links are still yours.
 *
 * @param {string} query
 * @returns {Promise<{ok:true, movie:object, providers:string[]}|{ok:false,error:{code:string,message:string}}>}
 */
async function searchMovie(query) {
  const q = clean(query);
  if (!q) return fail(new ProviderError('BAD_QUERY', 'Empty query'));
  if (q.length > 160) return fail(new ProviderError('BAD_QUERY', 'Query too long'));

  const order = enabledProviders();
  const errors = [];
  let catalogHit = null;

  for (const name of order) {
    try {
      if (name === 'catalog') {
        const entry = searchCatalog(q);
        catalogHit = entry;
        if (entry.offers.length) break; // Enough to answer with real links.
      } else if (name === 'tmdb') {
        const movie = await searchTmdb(q);
        if (catalogHit) {
          const merged = {
            ...catalogHit,
            ...movie,
            // Catalogue is the source of truth for playable offers and any
            // fields TMDB cannot provide.
            offers: catalogHit.offers,
            source: 'catalog+tmdb',
            rating: movie.rating || catalogHit.rating,
            runtimeMin: movie.runtimeMin || catalogHit.runtimeMin,
            genres: movie.genres.length ? movie.genres : catalogHit.genres,
            synopsis: movie.synopsis || catalogHit.synopsis,
            poster: movie.poster || catalogHit.poster,
          };
          return { ok: true, movie: merged, providers: ['catalog', 'tmdb'] };
        }
        return { ok: true, movie, providers: ['tmdb'] };
      } else if (name === 'site') {
        const movie = await searchSite(q);
        return { ok: true, movie, providers: ['site'] };
      }
    } catch (err) {
      errors.push(err);
      // A missing key or an empty catalogue is not fatal if a later provider can answer.
      if (!['NO_RESULTS', 'EMPTY_CATALOG', 'NO_API_KEY', 'DISABLED', 'AUTH'].includes(err.code)) {
        console.error(`[movieProvider:${name}]`, err.code || '', err.message);
      }
    }
  }

  if (catalogHit) return { ok: true, movie: catalogHit, providers: ['catalog'] };

  const meaningful = errors.find((e) => !['NO_RESULTS', 'EMPTY_CATALOG'].includes(e.code));
  return fail(meaningful || new ProviderError('NO_RESULTS', `No match for "${q}"`));
}

module.exports = {
  searchMovie,
  searchTmdb,
  searchCatalog,
  loadCatalog,
  normalizeTitle,
  similarity,
  splitQuery,
  enabledProviders,
  ProviderError,
};
