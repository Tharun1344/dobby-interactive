# 🎬 `.movie` / `.film` — CineSubz film downloader (සිංහල)

මේ ලේඛනය අලුත් film downloader එක ගැනයි. පරණ catalogue/TMDB movie search එක
`.movie` එකෙන් අයින් කරලා තියෙනවා. දැන් `.movie <film name>` යැව්වම:

1. CineSubz එකේ film එක හොයනවා
2. search එක unclear නම් film page එක තෝරන්න buttons දෙනවා
3. quality දෙකකට වඩා තියෙනවා නම් **480p / 720p / 1080p** buttons දෙනවා
4. **bot එක run වෙන cloud/server එකේම** download කරනවා
5. download එක ඉවර වුණාම **WhatsApp document** එකක් විදිහට එවනවා (2GB වෙනකම්)
6. යැව්වට පස්සේ cloud file එක **delete** කරනවා

> ⚠️ CineSubz කියන්නේ third-party site එකක්. ඒකෙන් films download කරලා බෙදාහරින
> එකේ legal/ToS responsibility ඔබේ. Bot එකේ `FILM_SITE` setting එකෙන් source එක
> වෙනස් කරන්න පුළුවන්.

---

## 1. Commands

| Command | වැඩේ |
|---|---|
| `.movie Iru Mugan` | CineSubz search → film page → quality → download → document |
| `.film Iru Mugan` | `.movie` එකේ alias එක |
| `.movie 720p Iru Mugan` | quality එක කලින්ම කියලා quality question එක skip කරනවා |
| `.movie status` | දැනට download වෙන වේගය, %, ETA |
| `.movie cancel` | download එක නවත්තනවා |
| `.movie send` | upload fail වුණා නම් cloud එකේ තියෙන file එක ආයෙත් යවනවා |
| `.moviestatus` | owner-only diagnostics (disk, jobs, limits) |

**කවුරුත් use කරන්න පුළුවන්ද?** ඔව් — `.movie` / `.film` owner-only **නෙවෙයි**.
ඒත් bot එක `private` mode එකේ නම් ඉතින් එහි පරණ private-mode gate එක වැඩ කරනවා
(owner ගේ self-chat එකට විතරයි).

### Buttons වැඩ කරන විදිහ

- සාමාන්‍ය chat එකක: WhatsApp native quick-reply buttons 3ක් වෙනකම්.
- `INTERACTIVE_TEXT_ONLY=true`, `.text`, `INTERACTIVE_ENABLED=false`, නැත්නම්
  **self-chat** එකේදී: numbered text list එකක්. ඒකේ number එක reply කරන්නත් පුළුවන්.
- button එකක් ඔබන්න බැරි වුණොත් (පරණ WhatsApp client): bot එකම text list එකට fallback වෙනවා.
- selection එකක් **එවපු කෙනාට විතරයි**. Group එකක වෙන කෙනෙක් button එක ඔබන්න බෑ.

---

## 2. File එක යන තැන සහ delete කරන තැන

```
Cloud server (Railway / VPS)
  └─ <STORAGE_DIR>/data/films/
       ├─ Iru Mugan (2016)-720p-1a2b3c4d5e.mp4.part   ← download වෙන අතරේ
       └─ Iru Mugan (2016)-720p-1a2b3c4d5e.mp4        ← ඉවර වුණාම
```

- Download එක resume වෙනවා — network එක කැඩුණොත් `.part` එකෙන් ආයෙත් පටන් ගන්නවා.
- `FILM_DELETE_AFTER_SEND=true` (default) නම් WhatsApp එකට document එක **සාර්ථකව**
  යැව්වට පස්සේ file එක delete කරනවා.
- Upload එක fail වුණොත් file එක **delete කරන්නේ නෑ**. `.movie send` යවලා ආයෙත් try කරන්න.
- ඔබේ PC එකට මේකෙන් කිසිම file එකක් යන්නේ නෑ. PC bridge/PowerShell/Python ඕන නෑ.

---

## 3. Cloud (Railway) setup

### Volume එක

1. Railway → service → **Volumes** → volume එකක් attach කරන්න (`/data` වගේ).
2. `RAILWAY_VOLUME_MOUNT_PATH` හෝ `STORAGE_DIR` set වෙලා තියෙන්න ඕන. Bot එක
   `RAILWAY_VOLUME_MOUNT_PATH` තියෙනවා නම් ඒකම `STORAGE_DIR` විදිහට ගන්නවා.
3. **අඩුම 5–6 GB free space** තියෙන්න ඕන. Film එක 1.9GB වුණොත්:
   - download file එක ~1.9GB
   - WhatsApp encrypt කරන temp copy තව ~1.9GB
   - ඉතුරු safety margin

Bot එක Linux/Railway එකේදී `TMPDIR` එක `<STORAGE_DIR>/tmp` ට auto set කරනවා.
ඒ නිසා encrypt temp copy එකත් volume එකේම තියෙනවා. ඔබට වෙනම `TMPDIR` එකක්
අවශ්‍ය නම් ඒක set කරන්න.

### Settings (`.env` / Railway Variables)

| Variable | Default | තේරුම |
|---|---|---|
| `FILM_SITE` | `https://cinesubz.net` | Source site එක |
| `FILM_DOWNLOAD_DIR` | `<STORAGE_DIR>/data/films` | Download folder එක |
| `FILM_MAX_BYTES` | `1900000000` | WhatsApp document limit එක (1.9GB) |
| `FILM_MAX_CONCURRENT` | `2` | එකවර downloads ගණන |
| `FILM_DELETE_AFTER_SEND` | `true` | යැව්වට පස්සේ delete |
| `FILM_DELETE_PARTIAL_ON_CANCEL` | `true` | cancel කරද්දී `.part` delete |
| `FILM_COOLDOWN_MS` | `8000` | එක user එකකට search cooldown |
| `FILM_PROMPT_TTL_MS` | `600000` | Quality selection එක valid වෙන වෙලාව |
| `FILM_REQUEST_TIMEOUT_MS` | `45000` | HTTP timeout |
| `FILM_DDG_FALLBACK` | `true` | Site search fail වුණොත් DuckDuckGo fallback |

`.env.example` එකේ මේ ඔක්කොම තියෙනවා.

---

## 4. Test

```bash
npm run check          # syntax
npm run test:film      # 35 checks (offline, fixture site)
npm run test:movie     # legacy provider/delivery tests
npm run test:branding
npm run test:interactive
```

`npm run test:film` එකට network හෝ WhatsApp connection ඕන නෑ. `global.fetch` එක
fixture site එකකින් replace කරලා search/resolve/quality/download/document flow
ඔක්කොම test කරනවා.

---

## 5. Troubleshooting

| අවුල | හේතුව / විසඳුම |
|---|---|
| `"X" හමු වුණේ නෑ` | Site search එකේ නෑ. English title එකකින් try කරන්න. |
| `Player එකෙන් download link එක ගන්න බැරි වුණා` | CineSubz page structure එක වෙනස් වෙලා. `lib/filmSource.js` parse rules බලන්න. |
| `WhatsApp limit එකට වඩා ලොකුයි` | 1080p file එක 1.9GB ට වැඩි. 720p/480p තෝරන්න හෝ `FILM_MAX_BYTES` වැඩි කරන්න (WhatsApp limit එකට යටින්). |
| `Cloud disk space මදි` | Volume එකේ free space මදි. පරණ films delete කරන්න, volume එක වැඩි කරන්න. |
| Upload fail: `.movie send` | File එක cloud එකේ තියෙනවා. Network/disk හදලා `.movie send` යවන්න. |
| Buttons පේන්නේ නෑ | `INTERACTIVE_TEXT_ONLY=true` ද? Self-chat ද? Number එක reply කරන්න. |
| Selection expire | විනාඩි 10ක් ඇතුළත තෝරන්න. Expire වුණොත් `.movie <name>` ආයෙත් යවන්න. |
| `.moviestatus` | Owner-only. Active jobs, disk, limits පෙන්නනවා. |

---

## 6. File map

| File | වැඩේ |
|---|---|
| `plugins/movie.js` | `.movie` / `.film`, buttons, document send, delete-after-send |
| `lib/filmSource.js` | CineSubz search, player API, quality variants, URL safety |
| `lib/filmDownload.js` | Resumable download jobs, progress, disk checks, cancel |
| `lib/interactive/messages.js` | Native quick replies (existing engine) |
| `scripts/test-film.js` | Offline tests |
| `.env.example` | `FILM_*` settings |

`auth_info_baileys/` සහ `sessions/` වලට මේ feature එකෙන් **කිසිම ලිවීමක්** නෑ.
