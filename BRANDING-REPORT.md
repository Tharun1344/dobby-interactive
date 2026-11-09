# Branding report — Tharun's WhatsApp Bot

Date: 2026-11-08
Project: `E:\opencode 2\dobby-interactive`

## 1. Goal

Replace the visible `Dobby-MD` / `Dobby Md` branding with **Tharun's WhatsApp Bot**
without touching the WhatsApp session, authentication data, package identity,
repository identity, database identifiers or Baileys version.

## 2. What changed

| File | Change | Why |
| --- | --- | --- |
| `config.js` | `BOT_NAME` default is now `Tharun's WhatsApp Bot`; `ALIVE_MSG` no longer mentions Dobby; added optional `OWNER_TELEGRAM` / `OWNER_YOUTUBE` | One configurable source of truth for the visible name and optional platforms |
| `plugins/alive.js` | Rebuilt on top of `lib/aliveCard.js`; links are delivered separately | Professional card and no raw URLs in the main message |
| `lib/aliveCard.js` | New pure builder for the status card, command count, version and masked bot number | Testable formatting; no socket required |
| `lib/ownerLinks.js` | Platform metadata (`GitHub`, `WhatsApp`, `Telegram`, `Instagram`, `Facebook`, `YouTube`, `Website`), URL validation, exact URL preservation | Recognisable names instead of long URL dumps; invalid protocols rejected |
| `lib/commandList.js` | Classic menu header uses `config.BOT_NAME` | Consistent branding in text menus |
| `lib/interactive/menus.js` | Interactive menu title uses `config.BOT_NAME` | Consistent branding in native menus |
| `lib/gemini.js` | AI system prompt uses `config.BOT_NAME` | AI answers identify the bot correctly |
| `index.js` | View-once notice and health endpoint use `config.BOT_NAME` | No stale visible/informational name |
| `plugins/general.js` | GitHub API `User-Agent` no longer says Dobby; `.getpp` copy improved | Clean branding and clearer profile-picture guidance |
| `plugins/menu.js` | Menu/help response text uses the configured name and prefix | Consistent help experience |
| `lib/browser.js` | Comment no longer names the old bot | Housekeeping only |

Internal identifiers were intentionally **not** renamed: `package.json` name
`danuwa-md`, repository/Docker names, `data/` files, Supabase table names and
session paths are unchanged.

## 3. Visible name configuration

```env
BOT_NAME=Tharun's WhatsApp Bot
```

Any value set in `config.env` / `.env` overrides the default. With an empty
override the code falls back to the default, never to the old name.

## 4. `.alive` layout

The main card contains **no raw URLs**:

```text
╭━━━〔 ✨ *Tharun's WhatsApp Bot* ✨ 〕━━━╮
┃
┃ 🟢 *System Status:* Online
┃ ⏱️ *Uptime:* 2h 30m
┃ ⚙️ *Prefix:* .
┃ 🧩 *Commands:* 47
┃ 🏷️ *Version:* v1.3.0
┃
┃ 👑 *Owner:* Tharun Prabashwara
┃ 👤 *Account:* default
┃ 📱 *Bot Number:* 947******58
┃
╰━━━━━━━━━━━━━━━━━━━━━━╯

💡 .menu — open the menu
📘 .help <command> — usage instructions
```

Notes:

- Uptime, version and command count come from the running process, `package.json`
  and the live command registry.
- The account ID is the safe multi-account identifier, never a credential.
- The linked bot number is masked. The full number is never printed.
- `ALIVE_IMG` still works; if the image send fails the card is sent as text.

## 5. Social links

Configured links are sent as a **second, clearly labelled message**:

```text
🔗 *Connect with us*

🐙 *GitHub:* https://github.com/…
💬 *WhatsApp:* https://wa.me/…
📸 *Instagram:* https://…
```

Rules enforced by `lib/ownerLinks.js`:

1. Only platforms actually configured are returned, in a fixed, recognisable
   order. No URL is invented.
2. The configured URL is preserved exactly. Only `http:` / `https:` URLs are
   accepted; `javascript:` and other schemes are dropped.
3. `OWNER_WHATSAPP` falls back to `https://wa.me/<BOT_OWNER digits>` when the
   explicit link is empty. The raw number is not printed in the summary.
4. The main `.alive` card never contains a URL; only the second message does.
5. `ownerLinkLines()` is shared by `.alive` and the classic menu.

### Native URL buttons

The installed Baileys line is 6.7.x. It does not officially support WhatsApp
native-flow `cta_url` buttons on every client, and unsupported payloads can be
dropped silently. Therefore:

- Default: a separate text-links message. This is **not** described as a native
  button anywhere in the bot output.
- Optional: `ALIVE_URL_BUTTONS=true` makes `.alive` attempt
  `lib/interactive/messages.sendUrlButtons()` with up to 3 links. If the send
  throws, the bot logs the failure and sends the text-links message instead.
- **Native URL buttons were not tested on a real Android/iOS/Web client.**
  Do not claim otherwise based on this project's offline tests.

## 6. Verification

- `npm run check` — 41 JavaScript files pass syntax checks.
- `npm run test:branding` — 16 offline checks, including “new branding is the
  default”, “alive card has no raw URLs” and “bot number is masked”.
- Repository search: the only remaining `Dobby` matches are the regression
  assertion in `scripts/test-branding.js` and this changelog line in `README.md`.
- Session baseline (37 files) matches; see `SESSION-PRESERVATION-REPORT.md`.

## 7. Limitations

- No live WhatsApp send, so the visual result on a real phone was not verified.
- Native `.alive` URL buttons remain opt-in and unverified on real devices.
- `.alive` shows only the configured owner links; missing platforms stay hidden
  rather than showing invented placeholders.
- Internal package/repository names still say `danuwa-md` on purpose.
