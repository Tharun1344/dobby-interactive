# Test report — DANUWA-MD v1.3.0 + `.movie` / `.pdl` + interactive menus + branding

> **Historical report.** This was written for the release where `.movie` was
> still a catalogue/TMDB search. `.movie` / `.film` is now a CineSubz
> downloader. Use `npm run test:film` (35 checks) as the current film suite;
> `npm run test:movie` still covers the legacy provider/delivery modules
> (24 checks). Counts and behaviour below are kept for reference only.

## Verified in this environment (offline)

- `node scripts/check.js` — syntax checks passed for **41** JavaScript files
  (28 after the `.movie` feature; the interactive layer adds 8 more, and the
  branding/mode/help layer adds `lib/aliveCard.js`, `lib/getppTarget.js`,
  `lib/menuMode.js`, `lib/usage.js` and `plugins/uiMode.js`).
- `node scripts/test-branding.js` — **16 / 16** checks passed (see the branding
  section below).
- `node scripts/test-movie.js` — **27 / 27** checks passed:
  - `movieProvider`: title normalisation, fuzzy similarity, year parsing,
    catalogue lookup, `BAD_QUERY` handling.
  - `mediaDelivery`: byte/runtime formatting, offer picking, card rendering,
    every fallback code, no-offer short circuit, `deliverLocalFile()` send +
    temp-dir removal.
  - `browser`: disabled pool reports a reason instead of throwing.
  - `playwrightDownload`: disabled-by-default, host allowlist
    (exact / subdomain / evil suffix / non-http), fuzzy result pick,
    clean `DISABLED` error, never throws.
  - Integration: `.movie` registers via `cmd()`; searching notice → card;
    unknown title → fallback; empty args → usage; `1080p` hint; download
    notice + media-only path; failed delivery → card.
- `node scripts/test-interactive.js` — **21 / 21** checks passed:
  - Native quick replies build `viewOnceMessage → interactiveMessage →
    nativeFlowMessage`, use stable `ocm:` action IDs, and add the `biz` and
    private-chat `bot` nodes.
  - Native lists build `listMessage`, use the `biz > list` node, and omit the
    `bot` node in groups.
  - Every supported response shape is parsed: `buttonsResponseMessage`,
    `templateButtonReplyMessage`, `listResponseMessage`,
    `interactiveResponseMessage.nativeFlowResponseMessage` and single-select.
  - Permission-filtered categories; group/owner scopes; WhatsApp row/button
    limits.
  - Classic text command list remains complete.
  - Navigation: main → all features → category → back → main.
  - Prompt collection calls the original plugin with the expected `q`/`args`.
  - Destructive action requires confirmation, then calls the command with the
    resolved target.
  - Choice options apply and reload the category.
  - Media prompt accepts a direct image and passes it to the plugin.
  - Self-chat uses the numbered text fallback and numeric replies work.
  - Duplicate deliveries do not run twice.
  - Per-user state is isolated in the same group.
  - A prefix command clears a pending prompt.
  - Welcome/goodbye defaults, per-group overrides and templates.
  - Scheduler `get`/`update` persistence, schedule-message parsing and
    multi-page schedule pagination within the 10-row limit.
  - Unknown/unsafe action IDs are rejected; expired native-flow responses get a
    clear reply.
- `.alive`, `.menu`, downloader commands, owner-only `.autoreact`, and the
  auto-reaction event hook are present in source.
- Duplicate `const statusCode` in `index.js` fixed; duplicate auto-reaction
  insertion and duplicate owner command registration removed.
- Original uploaded ZIP remains untouched; this is a separate revision.

## Branding / mode / help upgrade — what was checked

`node scripts/test-branding.js` (offline, temp `STORAGE_DIR`, no WhatsApp
connection):

| Check | Result |
| --- | --- |
| Default bot name is `Tharun's WhatsApp Bot`; old name absent from `ALIVE_MSG` | Pass |
| Mode persists per account and survives `reload()` | Pass |
| Mode file is outside `auth_info_baileys` / `sessions` | Pass |
| `INTERACTIVE_ENABLED=false` beats `.buttons` and saved mode | Pass |
| `INTERACTIVE_TEXT_ONLY=true` beats `.buttons` | Pass |
| `.buttons` / `.text` are owner-only (`fromMe` + runtime check) | Pass |
| `.buttons` → interactive, `.text` → classic, normal commands intact | Pass |
| `.menu` uses classic list in text mode and when globally disabled | Pass |
| Social links validated, labelled, exact URLs preserved, invalid protocols rejected | Pass |
| WhatsApp fallback link never prints the raw owner number | Pass |
| `.alive` card has all required fields and no raw URLs | Pass |
| Every registered command has a complete usage entry | Pass |
| Aliases (`gp`, `ytmp4`, `help`) resolve to the right usage | Pass |
| `.getpp` resolves mention / reply / number / JID / `me` / invalid | Pass |
| Synthetic session fixtures untouched by branding and mode writes | Pass |
| Real session directories unchanged (names only, no writes) | Pass |

## Interactive upgrade — what was checked

| Check | Result |
| --- | --- |
| All original text commands still registered | Yes |
| `.menu text` / `.menu classic` / `.menu list` | Yes |
| `.menu` opens interactive menus when enabled | Yes (offline mock socket) |
| Existing plugin handlers are called, not duplicated | Yes |
| Download / movie / Playwright plugins untouched | Yes |
| Group / welcome / scheduler / owner logic preserved | Yes |
| Native payload shapes | Verified offline only |
| Self-chat fallback | Verified offline |
| Duplicate suppression / per-user isolation | Verified offline |
| New runtime dependencies | None |
| Baileys migration | None |

## Not verified / blockers

- No live WhatsApp pairing, no real message send, no group operation.
- **Native button/list rendering on real Android, iOS, WhatsApp Web or Desktop
  was not tested.** The offline tests build the payloads and simulate the
  documented response shapes. A client can still ignore or alter unofficial
  interactive messages.
- **`.alive` native URL buttons were not tested on a real device.** Baileys
  6.7.x does not officially support `cta_url` on every client, so the default is
  a separate labelled text-links message. `ALIVE_URL_BUTTONS=true` attempts
  native buttons and falls back to text if the send throws.
- **Live `.getpp` calls were not tested.** Target resolution, usage text and
  privacy-error handling are covered offline; actual profile-photo retrieval
  depends on the target's WhatsApp privacy settings.
- Real Android/iOS selection payloads were not captured. If a client shows a
  menu but never returns a selection, use `INTERACTIVE_TEXT_ONLY=true`.
- No live TMDB response (needs `TMDB_API_KEY`).
- Playwright was not installed in the test environment, so no real
  `npx playwright install chromium` / real download / `.pdl` run.
  The engine is covered offline only (allowlist, config, error paths).
- `npm install` was not run against the public registry from here, so runtime
  dependency loading is unverified; `scripts/setup-local.ps1` does this on your
  machine.
- `yt-dlp` is not installed here; the Dockerfile installs/upgrades it during
  image build.
- No Railway deployment, Supabase write, or AI API request was performed.
- WhatsApp/document size limits, Railway storage/memory limits, and platform
  download restrictions can still prevent very large files.

## Version pins that must stay in sync

| Thing | Value | Where |
|---|---|---|
| Node | `>=20 <23` | `package.json` → engines |
| Playwright (npm) | `1.47.0` | `Dockerfile.playwright` |
| Playwright (image tag) | `v1.47.0-jammy` | `Dockerfile.playwright` |
| Baileys declared | `^6.7.16` | `package.json` |
| Baileys installed for tests | `6.7.24` | `node_modules` / lockfile |

If you bump Playwright locally, bump both lines in `Dockerfile.playwright`.
