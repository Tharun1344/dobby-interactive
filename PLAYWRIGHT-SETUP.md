# 🎭 Playwright Download — ස්ථාපන හා භාවිත උපදෙස්

මේ ලේඛනය `.pdl` command එක සහ Playwright download engine එක ගැනයි.
සරල සිංහලෙන්, පියවරෙන් පියවර.

---

## 1. මේ මොකක්ද?

Browser එකක් (headless Chromium) open කරලා, **ඔබ configure කරන site එකක**
search කරලා, download button එක click කරලා, file එක temp folder එකට බාගෙන,
WhatsApp එකෙන් යවන module එකක්.

```
.pdl Sintel
   ↓
⏳ Source එකෙන් බාගන්නවා…
   ↓
[site එකේ search → result click → download click]
   ↓
📥 file save → size check → WhatsApp video / document → file delete
```

### ⚠️ මේක **නොකරන** දේවල් (හිතාමතාම)

| නොකරන දේ | හේතුව |
|---|---|
| Shortlink / redirect / ad-gateway bypass | copyright + අනවශ්‍ය අවදානම |
| Captcha විසඳීම | ඒක bypass එකක් |
| `allowedHosts` එකේ නැති host එකකට යාම | block වෙනවා (`HOST_NOT_ALLOWED`) |
| CineSubz වගේ sites වලට default config | ඒවා ඔබට අයිති නැහැ |

**රීතිය:** file එක download වෙන්නේ **ඔබේම** හෝ **ඔබට බෙදාහැරීමට අවසර ඇති**
site එකකින් පමණයි. ඒක තීරණය වන්නේ `data/download-sources.json` එකෙන්.

---

## 2. ස්ථාපනය (Local / VPS)

### පියවර 1 — Playwright install

```bash
npm i playwright
npx playwright install --with-deps chromium
```

> Windows එකේ `--with-deps` අවශ්‍ය නැහැ. Linux/Railway වලට ඕන.
> Install එකට ~300 MB ඉඩ අවශ්‍ය.

### පියවර 2 — Config file

```bash
cp data/download-sources.example.json data/download-sources.json
```

`enabled: true` කරන්න. ඊට පස්සේ ඔබේ site එකට අනුව වෙනස් කරන්න:

```json
{
  "enabled": true,
  "allowedHosts": ["media.mysite.com", "cdn.mysite.com"],
  "defaultSource": "my-catalogue",
  "sources": {
    "my-catalogue": {
      "label": "My catalogue",
      "enabled": true,
      "searchUrl": "https://media.mysite.com/search?q={q}",
      "inputSelector": "input[name='q']",
      "submitSelector": "button[type='submit']",
      "resultSelector": ".search-results a.result-title",
      "waitForSelector": ".download-panel",
      "detail": { "title": "h1.entry-title" },
      "downloadSelector": ".download-panel a.btn-download",
      "quality": "1080p"
    }
  }
}
```

### field එකේ තේරුම

| Field | අවශ්‍යද | තේරුම |
|---|---|---|
| `enabled` | ✅ | මුළු module එකේ switch එක |
| `allowedHosts` | ✅ | **අවසර ඇති domains**. මේවාට පිටින් යන්නේ නැහැ |
| `defaultSource` | ⭐ | source එකක් නම් නොදැම්මොත් භාවිත වන එක |
| `searchUrl` | ✅ | `{q}` තැනට search word එක යනවා |
| `inputSelector` | ❌ | `{q}` නැති නම් search box එකේ CSS |
| `submitSelector` | ❌ | Search button එක |
| `resultSelector` | ✅ | Result link එකේ CSS |
| `waitForSelector` | ❌ | Detail page එකේ download area එක load වෙනකම් ඉන්න |
| `downloadSelector` | ✅ | **Download button එකේ CSS** |
| `detail.title` | ❌ | Movie title එක ගන්න selector එක |
| `quality` | ❌ | Caption එකේ පෙන්නන quality label |

### CSS selector එක හොයාගන්නේ කොහොමද?

1. Chrome එකේ site එක open කරන්න
2. Download button එක මත right-click → **Inspect**
3. Highlight වුණු element එකේ `class` එක බලන්න
4. DevTools Console එකේ test කරන්න:

```js
document.querySelectorAll('.download-panel a.btn-download').length
// 1 (හෝ ඊට වැඩි) ආවොත් selector එක හරි
```

### පියවර 3 — Environment

`config.env` එකට:

```ini
BROWSER_ENABLED=true
BROWSER_NO_SANDBOX=false        # Railway/Docker එකේ true
BROWSER_MAX_CONCURRENCY=1       # Railway Hobby
BROWSER_IDLE_MS=60000

PLAYWRIGHT_DOWNLOAD_ENABLED=true
PDL_SOURCE=my-catalogue
PDL_MAX_BYTES=1900000000
PDL_MAX_CONCURRENT=1
PDL_DOWNLOAD_START_MS=30000
PDL_NAV_TIMEOUT_MS=30000
PDL_TOTAL_TIMEOUT_MS=300000
```

### පියවර 4 — Test

```bash
node scripts/check.js
node scripts/test-film.js
npm start
```

WhatsApp එකෙන් (owner account එකෙන්):

```
.pdlsources
.pdl Sintel
```

`owner only` command එකක් නිසා ඔබේ number එකෙන් විතරයි වැඩ කරන්නේ.

---

## 3. Commands

| Command | කරන්නේ |
|---|---|
| `.pdl <name>` | default source එකෙන් search + download + send |
| `.pdl --source=<name> <name>` | අවශ්‍ය source එකෙන් |
| `.pdlsources` | configure කරලා තියෙන sources + stats |
| `.movie <name>` | CineSubz downloader (Playwright use කරන්නේ නැහැ) |

> `.movie` / `.film` දැන් ස්වාධීන CineSubz downloader එකක්. ඒක `.pdl` හෝ
> Playwright එකට සම්බන්ධ නැහැ. පරණ `PDL_ENABLE_IN_MOVIE` setting එක තවදුරටත්
> භාවිතා නොවේ.

---

## 4. Railway deploy

### ක්‍රමය A — නිල Playwright image (recommended)

`Dockerfile.playwright` file එක `Dockerfile` ලෙස rename කරන්න.

```dockerfile
FROM mcr.microsoft.com/playwright:v1.47.0-jammy
```

> ⚠️ **Tag එක ගැළපෙන්න ඕන:** `npm ls playwright` එකේ තියෙන version එකම
> (`1.47.0`) image tag එකට දාන්න. නැත්නම් browser launch fail වෙයි.

Railway → Settings:

| Setting | අගය |
|---|---|
| Builder | Dockerfile |
| Healthcheck Path | `/health` (දැනටමත් තියෙනවා) |
| Memory | අවම 1 GB (Chromium ~500 MB) |
| Volume | session සඳහා (දැනටමත්) |

Variables:

```ini
BROWSER_ENABLED=true
BROWSER_NO_SANDBOX=true
BROWSER_MAX_CONCURRENCY=1
PLAYWRIGHT_DOWNLOAD_ENABLED=true
PDL_MAX_CONCURRENT=1
```

### ක්‍රමය B — දැනට තියෙන image එකට install කරන්න

```dockerfile
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates python3 python3-pip \
 && python3 -m pip install --break-system-packages --no-cache-dir -U "yt-dlp[default]" \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund \
 && npx playwright install --with-deps chromium
COPY . .
ENV NODE_ENV=production BROWSER_ENABLED=true BROWSER_NO_SANDBOX=true
CMD ["npm","start"]
```

> මේක image එක ~1 GB විශාල කරයි. Build time දිගයි. ක්‍රමය A හොඳයි.

---

## 5. Memory / ක්‍රියාකාරී සීමා

| Setting | අගය | හේතුව |
|---|---|---|
| `BROWSER_MAX_CONCURRENCY` | 1 (Hobby) / 2 (Pro) | tabs ගණන |
| `PDL_MAX_CONCURRENT` | 1 | එකවර downloads |
| `BROWSER_IDLE_MS` | 60000 | idle වුණාම Chromium close |
| `PDL_MAX_BYTES` | 1.9 GB | disk + memory |
| `PDL_TOTAL_TIMEOUT_MS` | 300000 | එක job එකට උපරිම 5 min |

Module එකේ තියෙන ආරක්ෂණ:

* Browser එක `finally` එකේ close වෙනවා + idle timer
* Download stream එකට byte limiter (disk පිරෙන්නේ නැහැ)
* `AbortController` / `download.cancel()` timeout එකේදී
* Temp dir එක success/fail දෙකේදීම delete
* Semaphore එකෙන් concurrent jobs පාලනය
* Host allowlist — වෙන host එකකට ගියොත් stop

---

## 6. Troubleshooting

| Error / ලක්ෂණය | හේතුව | විසඳුම |
|---|---|---|
| `playwright is not installed` | npm package නැහැ | `npm i playwright` |
| `Executable doesn't exist … chromium` | browser binary නැහැ | `npx playwright install chromium` |
| `Host system is missing dependencies` | Linux libs නැහැ | `npx playwright install --with-deps` හෝ image A |
| `BROWSER_ENABLED is not true` | env නැහැ | `BROWSER_ENABLED=true` |
| `No enabled source` | config file නැහැ/off | `enabled: true` + source `enabled: true` |
| `HOST_NOT_ALLOWED` | වෙන host එකකට ගියා | ඒක ඔබේ නම් `allowedHosts` එකට add කරන්න |
| `NO_DOWNLOAD_BUTTON` | selector වැරදි | DevTools එකෙන් `downloadSelector` හදන්න |
| `DOWNLOAD_TIMEOUT` | button එක JS එකෙන් වෙනස් වෙනවා / login ඕන | `waitForSelector` දාන්න; login ඕන නම් මේ module එක ගැළපෙන්නේ නැහැ |
| `TOO_LARGE` | file එක limit එකට වඩා ලොකු | `PDL_MAX_BYTES` වැඩි කරන්න (WhatsApp limit එකට වඩා වැඩි කරන්න එපා) |
| Bot restart වෙනවා | memory මදි | concurrency 1, memory 1 GB+ |
| `Timeout 30000ms exceeded` navigation | site slow / block | `PDL_NAV_TIMEOUT_MS=60000` |
| `403` / Cloudflare | bot block | **bypass නොකරයි** — ඒ site එකට මේක යොදන්න එපා |
| Download සාර්ථක, යැවීම fail | file > video limit | document විදිහට යයි; logs බලන්න |

**Logs:** Railway → Deployments → View Logs → `[pdl]` / `[movie:pdl]` / `[browser]`

---

## 7. ආරක්ෂාව

* `allowedHosts` **ඔබේ domains විතරයි** — wildcard නැහැ, subdomain පමණක් අවසර.
* Login/captcha ඕන pages වලට මේක යොදන්න එපා.
* `.pdl` owner-only command එකක් — සාමාන්‍ය users ට පාවිච්චි කරන්න බැහැ.
* ඔබට අයිතිය නැති content බාගන්න/බෙදාහරින්න එපා (copyright).

---

## 8. File එකට එකතු වන දේ

| File | මොකටද |
|---|---|
| `lib/playwrightDownload.js` | download engine (search → click → download event → save) |
| `plugins/playwrightdl.js` | `.pdl`, `.pdlsources` commands |
| `data/download-sources.example.json` | config template |
| `Dockerfile.playwright` | Railway image |
| `lib/browser.js` | browser pool (modified: `acceptDownloads`) |
| `plugins/movie.js` | CineSubz downloader (independent of Playwright) |
