# Menu mode switching — `.buttons` and `.text`

Date: 2026-11-08
Project: `E:\opencode 2\dobby-interactive`

## 1. Commands

| Command | Who | Effect |
| --- | --- | --- |
| `.buttons` | Owner only | Saves **Interactive Mode** for the current account, then confirms. Menus try native buttons/lists first. |
| `.text` | Owner only | Saves **Classic Text Mode** for the current account, then confirms. `.menu` prints the classic command list. |

Both commands are registered in `plugins/uiMode.js` with `fromMe: true`, and each
handler re-checks `c.isOwner` before saving. A non-owner gets `⛔ Owner only.`
and the stored preference is unchanged.

Example confirmations:

```text
✅ *Interactive Mode Enabled*
Your bot menus will now use WhatsApp buttons and lists.

👤 Account: default
ℹ️ If a client does not render them, use .text for classic menus.
```

```text
✅ *Classic Text Mode Enabled*
Your bot menus will now use the traditional text interface.

👤 Account: default
ℹ️ All normal text commands keep working. Use the menu’s numbered replies or send commands directly.
```

## 2. Where the preference lives

- File: `<STORAGE_DIR>/data/menu-mode.json` (default
  `E:\opencode 2\dobby-interactive\data\menu-mode.json`).
- Format:

```json
{
  "default": "interactive",
  "work": "text"
}
```

- Keys are account IDs from `BOT_ACCOUNTS` (or `default`). IDs are validated
  against `^[a-zA-Z0-9_-]{1,40}$`; anything else falls back to `default`.
- Writes are atomic (`*.tmp` then rename), so a crash cannot leave a half-written
  file.
- This file is **completely separate** from `auth_info_baileys/`, `sessions/`,
  `data/settings.json`, Supabase and any storage/database file. No session file
  is read or written by mode switching.
- If the file is missing or unreadable, the account uses `interactive`, which
  preserves the previous behaviour when `INTERACTIVE_ENABLED` was unset/true.

## 3. Effective mode and precedence

`lib/menuMode.js` computes the mode actually used for delivery:

| Priority | Condition | Effective mode | Who wins |
| --- | --- | --- | --- |
| 1 | `INTERACTIVE_ENABLED=false` | `disabled` | Global emergency switch |
| 2 | `INTERACTIVE_TEXT_ONLY=true` | `text` | Global text-only override |
| 3 | otherwise | `interactive` or `text` | Saved per-account preference (default `interactive`) |

Consequences:

- `.buttons` never overrides `INTERACTIVE_ENABLED=false`. It saves the preference
  and tells the owner that menus remain text-only because of the global switch.
- `.buttons` never overrides `INTERACTIVE_TEXT_ONLY=true` either; the reply
  explains that the global override is stronger.
- `.text` changes only how menus are delivered. Every command stays registered
  and callable directly; downloads, AI, group tools, schedules and owner commands
  are unaffected.
- `INTERACTIVE_ENABLED=false` makes `.menu` print the classic list immediately.
- `INTERACTIVE_TEXT_ONLY=true` keeps the existing interactive engine in
  numbered-text fallback mode, preserving the original environment-variable
  meaning (navigation by number still works).

## 4. How `.menu` behaves per state

| State | `.menu` result |
| --- | --- |
| Saved `interactive`, env enabled, text-only off | Native buttons/list (with automatic text fallback on send failure or self-chat) |
| Saved `text` | Classic command list (`lib/commandList.js`) |
| `INTERACTIVE_TEXT_ONLY=true` | Interactive engine in numbered-text mode |
| `INTERACTIVE_ENABLED=false` | Classic command list |
| Self-chat (regardless of mode) | Numbered text fallback, because native buttons are unreliable in self-chat |

`.menu text`, `.menu classic`, `.menu list` and `.help <command>` keep working in
every state.

## 5. Multiple accounts

Each account keeps its own preference in the same JSON file, keyed by
`account.id`. `BOT_ACCOUNTS` accounts such as `main` and `work` can use different
modes at the same time. No cross-account state is shared in memory; the file is
re-read through a small cache that is refreshed on every write.

Example:

```env
BOT_ACCOUNTS=[{"id":"main","ownerNumber":"9470…"},{"id":"work","ownerNumber":"9470…"}]
```

```json
{
  "main": "interactive",
  "work": "text"
}
```

## 6. Failure reporting

- If the mode file cannot be written, `.buttons` / `.text` replies
  `❌ Could not save menu mode: …` instead of pretending success.
- If a native menu send fails, the interactive engine falls back to text and says
  so. The bot never claims a native button was delivered when it was not.
- `.alive` native URL buttons are a separate opt-in (`ALIVE_URL_BUTTONS=true`);
  see `BRANDING-REPORT.md`.

## 7. Manual inspection and reset

Read the current preference:

```powershell
Get-Content .\data\menu-mode.json
```

Reset one account to the default (interactive):

```powershell
# Stop the bot first so the in-memory cache cannot overwrite the edit.
$path = '.\data\menu-mode.json'
$json = Get-Content $path -Raw | ConvertFrom-Json
$json.PSObject.Properties.Remove('work')
$json | ConvertTo-Json -Depth 3 | Set-Content $path -Encoding UTF8
```

Do **not** delete or edit `auth_info_baileys/` or `sessions/` to reset menu mode.
They are unrelated.

## 8. Tests

`npm run test:branding` covers:

- `.buttons` → interactive, `.text` → classic, normal commands remain registered.
- Owner-only enforcement for both commands.
- Persistence per account and across `reload()` (simulated restart).
- `INTERACTIVE_ENABLED=false` and `INTERACTIVE_TEXT_ONLY=true` precedence.
- The mode file path is outside the WhatsApp session directories.
- Real session directory names are unchanged after mode writes.

## 9. Limitations

- Native rendering on real Android/iOS/Web was not tested.
- A client may ignore unofficial interactive payloads even when the send
  succeeds; `.text` is the reliable fallback.
- The preference is per account, not per chat. Changing it affects that account's
  menus everywhere.
