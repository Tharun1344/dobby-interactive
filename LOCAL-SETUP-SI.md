# 🖥️ DANUWA-MD — Local (Windows) Setup එක

මේ ZIP එකේ **සම්පූර්ණ bot එක + `.movie` / `.film` CineSubz film downloader එක** එකට තියෙනවා.
මේ ලේඛනයේ තියෙන්නේ ඔබේ computer එකේ එකවර run කරන්න ඕන දේවල් විතරයි.

---

## 1. මුලින්ම install කරගන්න ඕන දේවල්

| අවශ්‍යතාව | Version | අත්‍යවශ්‍යද? |
|---|---|---|
| **Node.js** | **20 LTS හෝ 22 LTS** (`>=20 <23`) | ✅ ඔව් |
| npm | Node එකත් එක්කම එනවා | ✅ ඔව් |
| Playwright + Chromium | ~350 MB | ⚠️ `.pdl` / browser engine එකට විතරයි |
| yt-dlp | අලුත්ම | ⚠️ `.song` / `.ytvideo` වලට විතරයි |
| ffmpeg | — | ❌ අවශ්‍ය නැහැ (`ffmpeg-static` එකෙන් එනවා) |

### Node.js install

1. https://nodejs.org → **LTS** (20.x හෝ 22.x) බාගන්න
2. Install කරලා PowerShell එක අලුතින් open කරන්න
3. Check කරන්න:

```powershell
node -v     # v20.x හෝ v22.x
npm -v
```

> ⚠️ Node **23+** දාන්න එපා — bot එකේ `engines` එක `>=20 <23`.
> Node 18 හෝ 16 ද වැඩ කරන්නේ නැහැ (Baileys ^6.7 + built-in fetch).

---

## 2. ZIP එක extract කරන්න

```powershell
# උදාහරණය
Expand-Archive .\DANUWA-MD-movie.zip -DestinationPath C:\bots
cd C:\bots\dobby-mh-main
```

> Extract කරපු folder එක ඇතුලේ `package.json`, `index.js` තියෙනවා නම් හරි.

---

## 3. එකවර setup (recommended)

`scripts\setup-local.ps1` එකෙන් dependencies, config files, tests ඔක්කොම කරනවා.

```powershell
# Playwright නැතුව (lightweight)
powershell -ExecutionPolicy Bypass -File scripts\setup-local.ps1

# Playwright + Chromium එකත් එක්ක (.pdl ඕන නම්)
powershell -ExecutionPolicy Bypass -File scripts\setup-local.ps1 -WithPlaywright
```

Script එක කරන දේ:

1. Node version check
2. `npm install`
3. (optional) `npm install playwright` + `npx playwright install chromium`
4. `config.env` නැත්නම් `.env.example` එකෙන් හදනවා (**පවතින file එකක් overwrite කරන්නේ නැහැ**)
5. `data\films` download folder එක හදනවා
6. `node scripts/check.js` + `node scripts/test-film.js` run කරනවා

---

## 4. Manual setup (script එක use නොකරන්න ඕන නම්)

```powershell
# 1) dependencies
npm install

# 2) config
copy .env.example config.env

# 3) optional browser engine
npm install playwright
npx playwright install chromium
copy data\download-sources.example.json data\download-sources.json

# 4) tests
node scripts/check.js
node scripts/test-film.js
```

`package.json` එකේ scripts:

```powershell
npm run check        # syntax check (43 files)
npm run test:film    # 35 offline checks (CineSubz downloader)
npm run test:movie   # 24 offline checks (legacy providers)
```

> ℹ️ `npm install` use කරන්න — **`npm ci` use කරන්න එපා**.
> මේ repo එකේ `package-lock.json` එක පරණ නිසා (`node-webpmux`, `qrcode` lock එකේ
> නැහැ) `npm ci` fail වෙනවා. `npm install` එකෙන් lock එක automatic update වෙනවා.

---

## 5. `config.env` එකේ අඩුම තරමේ මේවා දාන්න

```ini
BOT_OWNER=94701234567        # ඔබේ number, + නැතුව, රට කේතය එක්ක
BOT_NAME=Tharun's WhatsApp Bot
PREFIX=.
BOT_MODE=public
```

`.movie` / `.film` downloader එකට අඩුම තරමේ මේවා (optional):

```ini
FILM_SITE=https://cinesubz.net
FILM_MAX_BYTES=1900000000
FILM_MAX_CONCURRENT=2
FILM_DELETE_AFTER_SEND=true
```

> Local Windows එකේ download වෙන්නේ `data\films\` එකට. යැව්වට පස්සේ file එක
> delete වෙනවා. Disk space අඩුම 5–6 GB තියෙන්න ඕන (1.9 GB film එකකට).

`.pdl` (Playwright downloader) ඕන නම් විතරයි:

```ini
BROWSER_ENABLED=true
BROWSER_NO_SANDBOX=false    # local Windows එකේ false
PLAYWRIGHT_DOWNLOAD_ENABLED=true
```

> `.movie` දැන් `.pdl` එකට සම්බන්ධ නැහැ — ඒක ස්වාධීන CineSubz downloader එකක්.
> `.pdl` වෙනම command එකක් විදිහට විතරයි වැඩ කරන්නේ.

> `data/download-sources.json` එකේ `enabled: true` කරලා **ඔබට අයිති** site එකේ
> selectors දාන්න. විස්තර: `PLAYWRIGHT-SETUP.md`.

---

## 6. Run කරන්න

```powershell
npm start
```

Terminal එකේ QR code එක එනවා:

1. WhatsApp → **Settings → Linked devices → Link a device**
2. QR එක scan කරන්න
3. Terminal එකේ `Tharun's WhatsApp Bot` online වුණා වගේ log එකක් එනවා

> Session එක `sessions/` හෝ `STORAGE_DIR` එකේ save වෙනවා. එහෙනම් ඊළඟ පාර
> QR scan කරන්න ඕන නැහැ.

---

## 7. Test කරන්න (WhatsApp එකෙන්)

ඔබේම number එකෙන් bot එකට message කරන්න:

| Command | බලාපොරොත්තු ප්‍රතිඵලය |
|---|---|
| `.menu` | Bot online + command list |
| `.movie Iru Mugan` | CineSubz search → quality buttons → download → document |
| `.film Sachein` | `.movie` alias එක |
| `.movie 480p Iru Mugan` | quality එක කලින්ම කියලා download |
| `.movie status` | දැනට download වෙන progress |
| `.movie cancel` | download එක නවත්තනවා |
| `.movie asdkjhaskd` | "හමු වුණේ නැහැ" message |
| `.moviestatus` | film downloader diagnostics (owner) |
| `.pdlsources` | sources + stats (Playwright on නම්) |
| `.pdl <name>` | source එකෙන් download (owner only) |

`npm run test:film` එකේ **35 checks** pass වෙනවා නම් code එක හරි.

---

## 8. Playwright install එකේ ගැටළු

| පණිවිඩය | විසඳුම |
|---|---|
| `Executable doesn't exist … chromium` | `npx playwright install chromium` |
| `npm install playwright` දිගටම fail | Node 20/22 LTS දාන්න, පස්සේ `npm cache clean --force` |
| `browserType.launch: Target page…` | `BROWSER_ENABLED=true` දාලා තියෙනවද බලන්න |
| Download ~350 MB දිගයි | එයා Playwright නැතුවත් bot එක run වෙනවා — `.pdl` විතරයි වැඩ කරන්නේ නැත්නම් |

Playwright install කරන්නේ නැතුව තිබ්බොත් bot එක **normal විදිහට start වෙනවා**;
`.pdl` විතරයි වැඩ කරන්නේ නැත්නම්. `.moviestatus` එකට Playwright ඕන නැහැ.

---

## 9. WhatsApp file size සීමා

| Setting | Default | තේරුම |
|---|---|---|
| `FILM_MAX_BYTES` | 1.9 GB | `.movie` / `.film` document limit (1.9 GB = WhatsApp ~2 GB ට යටින්) |
| `PDL_MAX_BYTES` | 1.9 GB | `.pdl` download ceiling (disk protection) |

`.movie` හැම විටම film එක **document** එකක් විදිහට යවනවා. ඒ නිසා වෙනම
video/document toggle එකක් නැහැ. `FILM_MAX_BYTES` ට වැඩි variants quality list
එකෙන් ඉවත් වෙනවා. `.movie` දැන් `MOVIE_AUTO_SEND_MEDIA` use කරන්නේ නැහැ.

---

## 10. ⚠️ නීතිමය සීමාව

* `.movie` / `.film` films එන්නේ **CineSubz** (`FILM_SITE`) එකෙන්.
* CineSubz කියන්නේ third-party site එකක් — ඔබට එයට අයිතියක් නැහැ.
* `.pdl` work කරන්නේ **`allowedHosts`** එකේ තියෙන sites සමඟ විතරයි.
* Shortlink / captcha / ad-gateway bypass **නැහැ** — ඒ code එක ලියලා නැහැ.
* ඔබට අයිතිය නැති films බාගන්න/බෙදාහරින්න එපා (copyright).

---

## 11. ZIP එකේ මොනවද තියෙන්නේ

```
dobby-mh-main/
├── index.js, command.js, config.js       # bot core (වෙනස් කරලා නැහැ)
├── plugins/
│   ├── movie.js                          # .movie, .film, .moviestatus  ← අලුත්
│   ├── playwrightdl.js                   # .pdl, .pdlsources            ← අලුත්
│   └── (original 10 plugins)
├── lib/
│   ├── filmSource.js                     # CineSubz search + variants   ← අලුත්
│   ├── filmDownload.js                   # resumable downloads          ← අලුත්
│   ├── movieProvider.js                  # legacy catalogue + TMDB
│   ├── mediaDelivery.js                  # legacy download + send
│   ├── browser.js                        # Playwright pool
│   ├── playwrightDownload.js             # .pdl engine
│   └── (original libs)
├── data/
│   ├── movies.json                       # legacy catalogue (CC-BY 2 films)
│   ├── movies.example.json
│   ├── site-provider.example.json
│   └── download-sources.example.json
├── scripts/
│   ├── check.js                          # original
│   ├── test-film.js                      # 35 checks (CineSubz)         ← අලුත්
│   ├── test-movie.js                     # 24 checks (legacy)           ← අලුත්
│   └── setup-local.ps1                   # one-shot setup               ← අලුත්
├── Dockerfile                            # original (Playwright නැහැ)
├── Dockerfile.playwright                 # Railway + Chromium           ← අලුත්
├── .env.example                          # FILM_* + movie vars
├── env.movie.example
├── INTEGRATION.md                        # English reference
├── PLAYWRIGHT-SETUP.md                   # .pdl සිංහල උපදෙස්
├── README-SI.md                          # .movie / .film සිංහල උපදෙස්
└── LOCAL-SETUP-SI.md                     # මේ file එක
```

---

## 12. ඊළඟට කරන්න

1. `.movie Iru Mugan` වැඩ කරනවද බලන්න → quality buttons → document එක ආවා නම් හරි.
2. `FILM_MAX_BYTES` ඔබේ volume එකට ගැළපෙන විදිහට set කරන්න (5–6 GB free නම් 1.9 GB හරි).
3. Railway deploy ඕන නම් `Dockerfile.playwright` → `Dockerfile` ලෙස rename කරන්න,
   image tag එක `npm ls playwright` version එකට ගළපන්න.
