# 🎬 `.movie` / `.film` — integration guide (CineSubz downloader)

This is the current integration guide. The old catalogue/TMDB movie search has
been removed from `.movie`; `.movie` now downloads the film on the bot host and
sends it to WhatsApp as a document.

> 🇱🇰 සිංහල උපදෙස්: **`README-SI.md`**.

---

## 1. What was added / replaced

| Piece | File | Role |
|---|---|---|
| Command | `plugins/movie.js` | `.movie`, `.film`, quality/choice buttons, `.movie status/cancel/send`, `.moviestatus` |
| Source | `lib/filmSource.js` | CineSubz search, player API, `.mp4` variants, sizes, URL safety |
| Downloader | `lib/filmDownload.js` | Resumable jobs, progress, disk checks, cancel, delete-after-send helpers |
| Tests | `scripts/test-film.js` | Offline fixture site + fake socket |
| Config | `.env.example` | `FILM_*` settings |

The old `lib/movieProvider.js`, `lib/mediaDelivery.js` and
`lib/playwrightDownload.js` remain for `.pdl` / historical tests, but
`.movie` no longer calls them.

**No `index.js` plugin registration is needed** — `plugins/*.js` loads itself.
`index.js` has one small cloud-specific change: on Linux it points `TMPDIR` at
`<STORAGE_DIR>/tmp`, because Baileys encrypts outgoing media there and a small
`/tmp` would otherwise make large film uploads fail with ENOSPC.

WhatsApp session/auth files (`auth_info_baileys/`, `sessions/`) are never read
or written by this feature.

---

## 2. Flow

```
.movie Iru Mugan
   │
   ├─ CineSubz search (?s=...)
   ├─ one matching page?  ──► resolve it
   ├─ ambiguous results?  ──► up to 3 page buttons (or numbered text)
   │
   ├─ movie page -> zetaplayer API -> embed page
   ├─ HEAD each .mp4 variant -> quality + bytes
   ├─ drop variants over FILM_MAX_BYTES
   │
   ├─ one quality? ──► start download
   ├─ many?        ──► 480p/720p/1080p buttons (or numbered text)
   │
   ├─ download to <STORAGE_DIR>/data/films (resume .part)
   ├─ WhatsApp document upload (video/mp4, <= ~1.9 GB)
   └─ delete cloud file after a successful send
```

Failures are honest and specific:

- title not found / search failed
- player/API structure changed
- file over the WhatsApp limit
- cloud disk/temp space too low
- download interrupted (`.part` is kept so a retry resumes)
- document upload failed (file is kept; `.movie send` retries)

---

## 3. Why there is no PC bridge

The original `filmbot.zip` needed `/data/pc-bridge/bridge.py`,
`filmfetch.ps1` and `curl.exe` on a Windows PC. That cannot work from Railway
without exposing the PC. This port does the same HTTP work inside the bot
process:

- no Python
- no PowerShell
- no PC bridge
- no Playwright/Chrome CDP
- no play/fullscreen feature

The bot host (local or cloud) is the download target, and WhatsApp is the
delivery target.

---

## 4. Configuration

```ini
FILM_SITE=https://cinesubz.net
FILM_DOWNLOAD_DIR=                 # empty = <STORAGE_DIR>/data/films
FILM_MAX_BYTES=1900000000
FILM_MAX_CONCURRENT=2
FILM_DELETE_AFTER_SEND=true
FILM_DELETE_PARTIAL_ON_CANCEL=true
FILM_COOLDOWN_MS=8000
FILM_PROMPT_TTL_MS=600000
FILM_REQUEST_TIMEOUT_MS=45000
FILM_DDG_FALLBACK=true
```

### Disk / volume

A 1.9 GB film needs **two** large writes that overlap:

1. the downloaded file, and
2. Baileys' encrypted temporary copy during upload.

Budget **5–6 GB free** for one 1.9 GB film, more for concurrent downloads.
`FILM_MAX_CONCURRENT=2` therefore wants roughly 10 GB free.

`filmDownload.js` refuses a job when there is not enough room, instead of
filling the volume and crashing the bot.

---

## 5. Buttons and text fallback

`plugins/movie.js` uses the existing `lib/interactive/messages.js` transport:

- native quick replies (`film:pick:<token>:<index>` /
  `film:go:<token>:<index>`)
- max 3 buttons per message
- numbered text list when:
  - `INTERACTIVE_ENABLED=false`
  - `INTERACTIVE_TEXT_ONLY=true`
  - the account is in text mode (`.text`)
  - the chat is the bot's own self-chat
  - the native send throws
- numbers or `480p`/`720p`/`1080p` typed as text are accepted
- prompts expire after `FILM_PROMPT_TTL_MS`, are scoped to one chat, and are
  owned by the sender who started the search

The interactive engine only consumes `ocm:` ids, so `film:` ids fall through
to the plugin's reply handler.

---

## 6. Security boundaries

- Only pages on `FILM_SITE` are accepted as source pages.
- Media URLs must be public `http(s)`; loopback/private/link-local hosts are
  rejected, so a compromised page cannot turn this into SSRF.
- File names are sanitised; downloads live under one folder.
- Per-chat and global concurrency limits prevent a user from filling the
  volume.
- No shell commands are executed.

---

## 7. Testing

```bash
npm run check
npm run test:film
npm run test:movie
npm run test:branding
npm run test:interactive
```

`test:film` replaces `global.fetch` with a fixture CineSubz site and uses a fake
socket. It covers:

- search parsing, player options, embed variants, quality order/fallback
- SSRF/private-host rejection and source-host restriction
- variant size lookup
- partial-file resume (`Range: bytes=…`)
- too-large rejection
- native button IDs and numbered text selection
- ambiguous page choice
- sender isolation in groups and self-chat fallback
- document send and delete-after-send
- session-directory isolation

Live WhatsApp rendering/upload of a 1.9 GB document still needs one real test
on the deployment; offline tests cannot prove WhatsApp's server behaviour.

---

## 8. Legal note

CineSubz is a third-party site. Downloading and redistributing copyrighted
films may violate its terms and local copyright law. The owner of the bot and
the WhatsApp account is responsible for how this feature is used. `FILM_SITE`
is configurable so the same code can point at a source you are allowed to use.
