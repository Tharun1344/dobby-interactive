# Final test report — branding, mode switching, help and `.getpp`

> **Historical (2026-11-08).** This predates the CineSubz film downloader.
> Current suites: `npm run check` (43 files), `npm run test:film` (35 checks),
> `npm run test:movie` (24 checks), `npm run test:branding` (16 checks),
> `npm run test:interactive` (21 checks). Counts below are from that date.

Date: 2026-11-08
Project: `E:\opencode 2\dobby-interactive`
Environment: Windows, Node.js installed, offline (no live WhatsApp connection)

## 1. Commands run and results

| Command | Result |
| --- | --- |
| `npm run check` | **41 / 41** JavaScript files pass `node --check` |
| `npm run test:branding` | **16 / 16** checks pass |
| `npm run test:interactive` | **21 / 21** checks pass |
| `npm run test:movie` | **27 / 27** checks pass |

Totals: **64 offline checks pass**, syntax clean for 41 files.

## 2. Branding test coverage (`scripts/test-branding.js`)

1. Default name is `Tharun's WhatsApp Bot`; `ALIVE_MSG` has no old name.
2. Per-account mode saves, reloads and survives a simulated restart.
3. Mode file lives outside `auth_info_baileys/` and `sessions/`.
4. `INTERACTIVE_ENABLED=false` beats `.buttons` and the saved mode.
5. `INTERACTIVE_TEXT_ONLY=true` beats `.buttons`.
6. `.buttons` / `.text` reject non-owners and do not change their preference.
7. `.buttons` enables interactive; `.text` enables classic; normal commands stay registered.
8. `.menu` uses the classic list in text mode and when globally disabled.
9. Social links are labelled, validated, order-stable and preserve exact URLs.
10. WhatsApp falls back to `BOT_OWNER` without printing the raw number.
11. `.alive` card has status/uptime/prefix/commands/version/owner/account, no raw URLs, and a masked bot number.
12. Every one of the 47 registered command patterns has complete usage metadata.
13. Aliases (`gp`, `ytmp4`, `help`) resolve to the correct usage entry.
14. `.getpp` resolves mention, reply, number, formatted number, JID, `me` and invalid input.
15. Synthetic `auth_info_baileys` / `sessions` fixtures are byte-identical after branding/mode operations.
16. Real session directory names are unchanged after mode writes.

## 3. Existing suites

- `test:interactive` still covers native payload shapes, navigation, prompts,
  confirmations, pagination, permissions, duplicate suppression, per-user
  isolation, self-chat numbered fallback, welcome/goodbye and scheduler.
- `test:movie` still covers title normalisation, catalogue/TMDB search, offer
  picking, card rendering, every fallback code, browser disabled path,
  Playwright allowlist and downloader integration.

No existing check was removed or weakened.

## 4. Session preservation verification

```text
baseline files=37 missing=0 changed=0
current auth_info_baileys files=37
```

- Baseline: `E:\opencode 2\session-baseline-2026-11-08.json` (SHA-256 per file).
- Source-only backup: `E:\opencode 2\backup-pre-branding-2026-11-08`.
- No session/auth file was created, deleted, renamed or overwritten.
- No QR pairing was attempted; the bot was not run against the live account.
- See `SESSION-PRESERVATION-REPORT.md`.

## 5. Acceptance checklist

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Existing WhatsApp sessions preserved | ✅ | 37/37 hashes match; no session writes |
| 2 | Existing commands registered and functional | ✅ | 47 patterns registered; all suites pass |
| 3 | New branding consistent | ✅ | `BOT_NAME` used by alive/menu/help/AI/health; no user-facing `Dobby` strings |
| 4 | `.alive` professional layout | ✅ | `lib/aliveCard.js`; card test |
| 5 | Social links as buttons or documented alternative | ✅ (alternative documented) | Separate labelled text links by default; native buttons opt-in and unverified on real devices |
| 6 | `.buttons` enables Interactive Mode for owners | ✅ (offline) | `plugins/uiMode.js`; owner test |
| 7 | `.text` restores Classic Text Mode for owners | ✅ (offline) | Same test; normal commands unaffected |
| 8 | Mode preferences survive restart | ✅ | File persistence + `reload()` test |
| 9 | Every command has accurate usage | ✅ | 47 entries in `lib/usage.js`; coverage test |
| 10 | `.getpp` instructions and target handling | ✅ (offline) | `lib/getppTarget.js` + plugin usage/error text |
| 11 | Existing tests pass | ✅ | check + 3 suites |
| 12 | No QR re-pairing required | ✅ | No session modification, no live run |

## 6. What was not tested (honest limitations)

- **No live WhatsApp connection or real message send.** Pairing, group actions,
  media upload and real profile-picture retrieval are unverified here.
- **Native button/list rendering on real Android, iOS, WhatsApp Web or Desktop
  was not tested.** Offline tests only build payloads and simulate responses.
- **`.alive` native URL buttons** (`ALIVE_URL_BUTTONS=true`) were not tested on a
  device. Baileys 6.7.x does not officially support `cta_url` everywhere, so the
  default remains a separate text-links message; a failed native send falls back
  to text and logs the failure.
- **`.getpp` privacy errors** are implemented from documented status codes
  (401/403/404 and generic failures), not from live restricted accounts.
- Third-party services (YouTube, Facebook, TikTok, TMDB, Gemini, Playwright,
  Supabase, `yt-dlp`) were not exercised. The offline suites cover their error
  paths and formatting only.
- No Railway deployment or volume test.

## 7. Exact files

### New files

| File | Purpose |
| --- | --- |
| `lib/aliveCard.js` | Pure `.alive` card builder (masked number, command count, version) |
| `lib/getppTarget.js` | Pure `.getpp` target resolver (mention/reply/number/JID/self) |
| `lib/menuMode.js` | Per-account mode storage and environment precedence |
| `lib/usage.js` | Usage metadata for all 47 command patterns + formatter |
| `plugins/uiMode.js` | Owner-only `.buttons` and `.text` |
| `scripts/test-branding.js` | 16 offline regression tests |
| `BRANDING-REPORT.md` | Branding and `.alive`/social-link report |
| `COMMAND-USAGE-GUIDE.md` | Generated guide for all 47 commands |
| `MODE-SWITCHING.md` | Operator guide for `.buttons` / `.text` |
| `SESSION-PRESERVATION-REPORT.md` | Session audit, baseline and verification |
| `FINAL-TEST-REPORT.md` | This report |

### Modified files

| File | Change |
| --- | --- |
| `config.js` | New `BOT_NAME`/`ALIVE_MSG` defaults; optional Telegram/YouTube links |
| `index.js` | Branded view-once notice and health endpoint name |
| `package.json` | Added `test:branding` script |
| `.env.example` | Branding, Telegram/YouTube, `ALIVE_URL_BUTTONS`, mode notes |
| `lib/ownerLinks.js` | Platform metadata, URL validation, exact preservation, helpers |
| `lib/commandList.js` | Configured bot name in the classic menu |
| `lib/gemini.js` | Configured bot name in the AI system prompt |
| `lib/browser.js` | Comment branding cleanup |
| `lib/interactive/catalog.js` | Menu entries for `.buttons`/`.text`; improved `.getpp` prompt |
| `lib/interactive/engine.js` | Respects per-account text mode; appends usage hints |
| `lib/interactive/menus.js` | Configured bot name as menu title |
| `plugins/alive.js` | Redesigned card + separate links + opt-in native buttons |
| `plugins/menu.js` | Mode routing, `.help <command>`, `.menu text` preserved |
| `plugins/general.js` | Improved `.getpp`; branding cleanup; configurable GitHub UA |
| `README.md` | v1.7 section and command list updates |
| `README-SI.md` | `.buttons`/`.text`/`.help` notes |
| `INTERACTIVE-MENUS.md` | Per-account mode section and precedence notes |
| `LOCAL-SETUP-SI.md` | New default name in setup examples |
| `FEATURE-INVENTORY.md` | Branding in the title |
| `TEST-REPORT.md` | Branding test results and limitations |

### Unchanged on purpose

- `auth_info_baileys/` (37 files, hashes match)
- `sessions/` (still empty)
- `data/` (no real `menu-mode.json` written during tests)
- `package-lock.json` (no new dependencies)
- Baileys version (`^6.7.16`, installed 6.7.24)
- Package/repository/database identifiers
- Original archive and unrelated project copies

## 8. Result

The requested branding, `.alive`, `.buttons`/`.text`, help, and `.getpp`
improvements are implemented and covered by offline regression tests. The
existing WhatsApp session is intact, and no re-pairing is required. Remaining
unknowns are limited to live WhatsApp rendering and third-party runtime
behaviour listed in section 6.
