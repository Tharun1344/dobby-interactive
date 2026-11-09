# DANUWA-MD / Tharun's WhatsApp Bot — complete feature inventory (audit)

Audit date: 2026-11-03
Audited source: `dobby-mh-main` archive plus the newer `.movie` / Playwright revision
(`DANUWA-MD-movie.zip`). The newer revision is used as the working base because it is a strict
superset of the attached archive: every shared file is byte-identical except `.env.example`,
`package.json` and `TEST-REPORT.md`, which only add the movie feature. Using the older archive
alone would delete the `.movie` / `.pdl` integration the task explicitly requires preserving.

## 1. Runtime and connection

| Item | Value |
| --- | --- |
| Language | CommonJS JavaScript, Node.js `>=20 <23` |
| Entry point | `index.js` |
| WhatsApp library | `@whiskeysockets/baileys` |
| Declared range | `^6.7.16` (`package.json`) |
| Lockfile / installed version | `6.7.24` (verified with `npm ci`/`npm install`) |
| Connection type | WhatsApp Web multi-device via Baileys, QR or pairing code |
| Official Cloud API | Not used |
| Account model | One process, one or more Baileys sockets (`BOT_ACCOUNTS`) |
| Auth storage | `sessions/<id>/` or legacy `auth_info_baileys/` under `STORAGE_DIR` |
| Persistent data | `data/settings.json`, `data/schedules.json`, `data/lid-map.json`, `data/run-state.json` |
| HTTP | Express on `PORT` (default 8000), `/` and `/health` |
| Deployment | Dockerfile on Railway (`railway.json`), `STORAGE_DIR=/data` volume recommended |

## 2. Dispatch and plugin system

- `command.js` registry: `cmd({ pattern, alias, desc, category, fromMe, silent, react }, fn)`.
- Auto-loaded `plugins/*.js` in alphabetical order.
- `index.js` parses the prefix (default `.`), builds the context, checks private mode/mute,
  then calls `plugin.function(sock, incoming, m, context)`.
- Reply handlers (`command.js` `replyHandlers`) are executed after command dispatch.
- `lib/msg.js` builds `m` (`body`, `quoted`, `download`, `reply`, ...).
- Per-account settings live in `data/settings.json`; `lib/settings.js` saves atomically.
- Multi-account, reconnect backoff, watchdog, anti-delete/anti-edit, LID mapping,
  Supabase audit logging, view-once memory cache, QR/pairing.

## 3. Every registered command

### Main / information (`plugins/menu.js`, `alive.js`, `general.js`)
| Command | Aliases | Purpose | Access |
| --- | --- | --- | --- |
| `.menu` | `.help`, `.commands` | Command list | everyone |
| `.alive` | — | Status card, optional image, owner links | everyone |
| `.ping` | — | Response/uptime check | everyone |
| `.uptime` | `.runtime` | Process uptime | everyone |
| `.owner` | `.creator`, `.dev` | Owner contact card | everyone |
| `.github` | `.git`, `.repo` | GitHub user/repo info | everyone |

### Downloads (`plugins/download.js`, yt-dlp)
| Command | Aliases | Purpose | Notes |
| --- | --- | --- | --- |
| `.ytvideo` | `.ytmp4` | YouTube video, name or URL | default 480p, optional `360`/`720` prefix |
| `.song` | `.ytmp3`, `.mp3` | Audio to MP3 | name or URL |
| `.fbvideo` | `.facebook` | Facebook video | URL only, up to 720p |
| `.ttvideo` | `.tiktok` | TikTok video | URL only, up to 720p |
| `.download` | `.media` | Generic supported video | name or URL, up to 720p |
| `.ytsearch` | `.musicsearch`, `.videosearch` | Metadata search, top 5 | no download |

All downloads use `yt-dlp`, optional embedded/env cookies, fallback extractor clients,
ffmpeg conversion, video/document/audio delivery, temp-dir cleanup and size limits.

### Films / Playwright (`plugins/movie.js`, `plugins/playwrightdl.js`)
| Command | Aliases | Purpose | Access |
| --- | --- | --- | --- |
| `.movie` | `.film` | CineSubz search → quality buttons → download on the bot host → WhatsApp document | everyone |
| `.moviestatus` | — | Film downloader diagnostics (disk, limits, active jobs) | owner (`fromMe`) |
| `.pdl` | `.siteget`, `.playwrightdl` | Allowlisted Playwright download | owner (`fromMe`) |
| `.pdlsources` | — | List Playwright sources/stats | owner (`fromMe`) |

Film downloader files: `lib/filmSource.js` (CineSubz search/resolve/variants),
`lib/filmDownload.js` (resumable jobs, progress, disk checks, cancel),
`plugins/movie.js` (command, buttons, document send/delete).
Legacy movie metadata/Playwright files: `lib/movieProvider.js`, `lib/mediaDelivery.js`,
`lib/browser.js`, `lib/playwrightDownload.js`; catalogue `data/movies.json`;
optional `data/site-provider.json`, `data/download-sources.json`; Dockerfile.playwright.

### Media tools (`plugins/media.js`, `general.js`)
| Command | Aliases | Purpose | Input |
| --- | --- | --- | --- |
| `.sticker` | `.s`, `.stiker` | Image/video to sticker | reply or media message |
| `.toimage` | `.toimg` | Sticker to PNG | reply to sticker |
| `.take` | `.steal` | Re-pack sticker with pack name | reply to sticker |
| `.qr` | `.qrcode` | Generate QR image | text/URL |
| `.getpp` | `.gp`, `.getpic` | Profile picture | reply/mention/number/self |
| `.ssweb` | `.screenshot`, `.ss` | Website screenshot via thum.io | URL |
| `.tts` | `.speak`, `.say` | Google TTS, optional `si/en/ta/...` | text |

### AI (`plugins/ai.js`, `vision.js`)
| Command | Aliases | Purpose | Access |
| --- | --- | --- | --- |
| `.ai` | `.ask`, `.gemini`, `.chatgpt` | Gemini chat, per-chat history, `.ai reset` | everyone |
| `.vision` | `.describe`, `.whatinimage`, `.scan`, `.analyze`, `.analyse` | Gemini vision on a normal image | everyone |
| `.translate` | `.trans`, `.tr` | Translation via Gemini | everyone |

Requires `GEMINI_API_KEY`/`AI_API_KEY`; graceful setup error otherwise.

### Group tools (`plugins/group.js`)
| Command | Aliases | Purpose | Access |
| --- | --- | --- | --- |
| `.groupinfo` | `.ginfo` | Group name, JID, members, admins | group members |
| `.tagall` | `.everyone` | Mention everyone | group admin + bot admin |
| `.kick` | `.remove` | Remove member | group admin + bot admin |
| `.promote` | — | Promote member | group admin + bot admin |
| `.demote` | — | Demote admin | group admin + bot admin |
| `.grouplink` | `.link` | Get invite link | bot admin or owner |
| `.revoke` | — | Reset invite link | group admin + bot admin |
| `.mute` | — | Mute/unmute bot replies in group | group admin |

There is **no anti-link, anti-spam, anti-bot or word-filter feature** in the audited source.
None is invented by the interactive upgrade.

### Owner / settings (`plugins/owner.js`)
| Command | Purpose | Storage |
| --- | --- | --- |
| `.mode public/private` | Bot access mode | settings.json |
| `.welcome on/off` | Global group welcome toggle | settings.json |
| `.goodbye on/off` | Global group goodbye toggle | settings.json |
| `.dmgreet on/off` | One-time new-DM greeting | settings.json |
| `.antidelete on/off` | Anti-delete/edit owner notices | settings.json |
| `.autoreact on/off/set <emoji>` | React to recognized commands | settings.json |
| `.accounts` | Show current account ID (no secrets) | runtime |

All are `fromMe`; the handlers also check `isOwner`.

### Scheduled messages (`plugins/schedule.js`, `lib/scheduler.js`)
| Command | Aliases | Purpose | Access |
| --- | --- | --- | --- |
| `.schedule` | `.sch` | Create: `time | [number] | message` | owner |
| `.schedules` | `.schlist` | List pending | owner |
| `.unschedule` | `.schcancel` | Cancel by ID | owner |

Sri Lanka time (`TZ_OFFSET_MIN=330` by default), persisted in `data/schedules.json`,
15-second tick, 6-hour late window, 100 pending cap, three send retries.

### View-once / privacy (`plugins/general.js`, `lib/viewonce.js`)
| Command | Aliases | Purpose | Access |
| --- | --- | --- | --- |
| `.viewonce` | `.vv`, `.readvo`, `.readviewonce` | Reply to view-once; result goes only to owner self-chat | owner (`fromMe`) |

View-once media is never persisted to disk; only a bounded in-memory cache is used.

## 4. Non-command systems

| System | Location | Behaviour |
| --- | --- | --- |
| Welcome / goodbye | `index.js` `group-participants.update` | Global `settings.welcome`/`settings.goodbye`; hardcoded text; no per-group config before this upgrade |
| DM greeting | `index.js` first recognized command in a private chat | One-time, `settings.dmGreeting`, `GREETING_MSG` override |
| Anti-delete / anti-edit | `index.js` `messages.update` | Reports to bot self-chat; bounded in-memory cache; optional Supabase audit |
| Auto-react | `index.js` command dispatch | Only recognized commands; settings toggle/emoji |
| View-once notice | `index.js` early message check | Owner notice; no saving/bypassing |
| Group mute | `index.js` dispatch + `.mute` | Muted groups skip commands except `.mute` |
| Scheduler | `lib/scheduler.js` | Persistent timed sends per account |
| LID mapping | `index.js`, `data/lid-map.json` | Maps `@lid` to phone JIDs |
| Run-state/watchdog | `index.js` | Restart diagnostics, memory heartbeat, 10-min disconnect restart |
| Supabase audit | `index.js` | Optional anti-delete event inserts |
| View-once cache | `lib/viewonce.js` | Memory only, TTL and size caps |

## 5. Configuration and deployment

- `.env.example`, `config.env` (dotenv), Railway Variables.
- Key env: `BOT_OWNER`, `BOT_NAME`, `PREFIX`, `STORAGE_DIR`, `BOT_MODE`, `BOT_ACCOUNTS`,
  `SESSION_ID`, `PAIRING_NUMBER`, `GEMINI_API_KEY`, `TMDB_API_KEY`, download limits,
  `TZ_OFFSET_MIN`, Playwright flags.
- `Dockerfile`: Node 20 slim + ffmpeg + yt-dlp.
- `Dockerfile.playwright` for optional Chromium.
- `railway.json`: Docker builder, `/health`, restart on failure.
- Sessions/settings/schedules must live on the persistent volume; no migration is needed.
- `package-lock.json` was out of sync with the declared `qrcode`/`node-webpmux` dependencies
  and had to be refreshed once for `npm ci` to work; no new runtime dependency is added.

## 6. Known gaps found in the original

These are preserved as-is or handled in the upgrade, not silently removed:

1. Welcome text was hardcoded and the add event sent even when global `welcome` was off
   (it only required welcome **or** goodbye to be on). The upgrade resolves per-group policy
   and defaults to the original text.
2. `.png`/`.jpeg` document extension parsing in `lib/msg.js` assumes a dot in the filename.
3. `lib/scraper.js` requires `cheerio`, which is not in `package.json`; it is currently unused.
4. `lib/buttons.js` sent a bare `interactiveMessage` without the binary wrapper nodes; that is
   why its link buttons were never reliable. It is retained but now unused.
5. No group-specific welcome/goodbye settings existed; the upgrade adds optional overrides
   while keeping the global toggles and exact default messages.
6. The scheduler had no edit operation; the upgrade adds an update method used only by the
   interactive UI.

## 7. Interactive menu upgrade (additive)

This revision adds a button/list-menu layer on top of the existing bot. It does not remove or
rewrite any command.

- `.menu` opens native WhatsApp buttons/lists. `.menu text|classic|list` keeps the classic
  command list, and the classic list is also the automatic fallback.
- `lib/interactive/catalog.js` maps menu entries to the existing commands. The engine collects
  missing input and calls the original plugin function; download, movie, Playwright, group,
  AI, media, owner and scheduler logic is not duplicated.
- Categories: Downloads, Movies, Media Tools, AI Tools, Group Tools, Welcome & Goodbye,
  Scheduled Messages, Bot Settings, Help & Info. Visibility and execution both enforce the
  original owner/group-admin/bot-admin rules.
- Menus support back/home/close, pagination, prompts, media prompts, confirmations with
  short-lived tokens, duplicate suppression, per-account/chat/user state, TTL expiry and
  numbered text fallback. Action IDs use the `ocm:` prefix and are validated; visible labels
  are never used as actions.
- Welcome/goodbye: global `settings.welcome`/`settings.goodbye` and the original message text
  are preserved. Optional `welcomeText`, `goodbyeText` and `settings.groupWelcome[groupJid]`
  overrides were added, plus owner/group-admin menu screens.
- Scheduler: `lib/scheduler.js` gained `get()` and `update()`. The existing `.schedule`,
  `.schedules` and `.unschedule` commands, file format, 15-second tick, retry and late-window
  behaviour are unchanged. The interactive screens add create/list/view/edit time/edit
  message/cancel.
- No new runtime dependency was added and no Baileys migration was performed.
- Native rendering on real WhatsApp clients was not verified in this environment. See
  `INTERACTIVE-MENUS.md` and `TEST-REPORT.md` for the exact limits.

The original gaps above are unchanged except that gaps 1, 5 and 6 now have optional handling:
welcome events use the correct per-event policy, per-group overrides exist, and the scheduler
can be edited. The global toggles, default text and text commands remain compatible.
