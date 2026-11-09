# Interactive menus for DANUWA-MD / Tharun's WhatsApp Bot

This document describes the additive button/list-menu layer. It is written for
the operators of this repository, not for end users.

The short version:

- `.menu` now opens native WhatsApp buttons/lists.
- `.menu text` (or `.menu classic`, `.menu list`) still prints the original
  command list.
- `.help <command>` explains any command; the interactive prompts include a
  short usage hint before calling the original plugin.
- Owners can switch the delivery mode per account with `.buttons` (interactive)
  and `.text` (classic). The choice is stored in `data/menu-mode.json` and
  survives restarts; it is never written into WhatsApp session files.
- Every original text command still works exactly as before.
- No download, movie, Playwright, group, AI, scheduler, owner, session,
  deployment, database or storage feature was removed or reimplemented.
- Native rendering was tested offline only. Real Android/iOS/Web rendering was
  not verified in this environment.

---

## 0. Per-account mode (`.buttons` / `.text`)

`lib/menuMode.js` stores `interactive` or `text` per account ID in
`data/menu-mode.json`. `plugins/uiMode.js` registers the owner-only commands.
Effective mode precedence is:

1. `INTERACTIVE_ENABLED=false` → `disabled` (global emergency switch; `.buttons`
   cannot override it)
2. `INTERACTIVE_TEXT_ONLY=true` → `text` (global override wins over the
   per-account preference)
3. otherwise → the account's saved mode (default `interactive`)

`.text` only changes how `.menu` is delivered. Ordinary commands stay
registered and usable. See `MODE-SWITCHING.md` for the operator guide.

---

## 1. What is interactive

`.menu` opens a small home screen with three buttons:

| Button | Action ID | Result |
| --- | --- | --- |
| `📥 Downloads` | `ocm:cat:downloads:1` | Download commands |
| `🎬 Movies` | `ocm:cat:movies:1` | Movie / Playwright commands |
| `📚 All features` | `ocm:all` | Every category allowed for this chat/user |

The `All features` list, and every category list, only shows entries allowed by
the current context. Scope rules are enforced twice: when the menu is built and
again when an action is executed.

### Converted features

These menu entries collect any missing input, then call the **original plugin
function**. The plugin still performs the work.

| Category | Interactive entries | Original commands used |
| --- | --- | --- |
| Downloads | YouTube Video, YouTube Audio, Facebook Video, TikTok Video, Generic Video, YouTube Search | `.ytvideo`, `.song`, `.fbvideo`, `.ttvideo`, `.download`, `.ytsearch` |
| Movies | Download Film, Source Download, Film Status, Playwright Sources | `.movie`, `.pdl`, `.moviestatus`, `.pdlsources` |
| Media | Image → Sticker, Sticker → Image, Re-pack Sticker, QR Code, Profile Picture, Website Screenshot, Text to Speech, View-once instructions | `.sticker`, `.toimage`, `.take`, `.qr`, `.getpp`, `.ssweb`, `.tts`, `.viewonce` |
| AI | Ask AI, Image Analysis, Translate | `.ai`, `.vision`, `.translate` |
| Group | Group Info, Tag Everyone, Kick Member, Promote Member, Demote Admin, Group Invite Link, Reset Invite Link, Bot Mute | `.groupinfo`, `.tagall`, `.kick`, `.promote`, `.demote`, `.grouplink`, `.revoke`, `.mute` |
| Welcome & Goodbye | Global and per-group menu screens | `.welcome`, `.goodbye` |
| Scheduled Messages | New, list, view, edit time, edit message, cancel | `.schedule`, `.schedules`, `.unschedule` |
| Bot Settings | Bot Mode, Anti-delete, Auto-react, Auto-react Emoji, DM Greeting, Accounts | `.mode`, `.antidelete`, `.autoreact`, `.autoreact set`, `.dmgreet`, `.accounts` |
| Help & Info | Bot Status, Ping, Uptime, Owner Contact, GitHub Info, Owner links, Text command list | `.alive`, `.ping`, `.uptime`, `.owner`, `.github`, owner links, classic menu |

### Deliberately left text-first

These remain available as text commands and are not forced into a prompt:

- `.menu text|classic|list` — explicit classic list.
- `.viewonce` / `.vv` — must be used as a reply to the view-once message. The
  menu shows instructions instead of pretending it can collect it.
- `.take <pack name>` — the interactive prompt sends a sticker and uses the
  caption (or the sender's push name) as the pack name. For an explicit pack
  name, the text command is clearer.
- `.ai reset` — works through the interactive prompt, but typing it directly is
  faster.
- `.schedule` / `.schedules` / `.unschedule` — still fully supported as text.
  The interactive schedule screens are an additional path, including edit time
  and edit message, which were not previously available.
- `.welcome on/off` and `.goodbye on/off` — still fully supported as text. The
  menu adds per-group overrides and custom templates.

No anti-link, anti-spam, anti-bot or word-filter feature was added. None existed
in the audited source.

---

## 2. How the menus behave

### Navigation

- **Back** pops the previous menu.
- **Main menu** resets navigation to the home screen.
- **Close** clears navigation and stops the interaction.
- `/cancel` (or `.cancel` while a prompt is pending) clears the prompt.
- Category pages contain at most 6 feature rows plus navigation rows, and are
  hard-capped at WhatsApp's 10-row list limit.
- A new prefix command clears any pending prompt for that user, so normal
  command use cannot be swallowed by an old menu.

### Prompts

When a feature needs input, the menu sends a prompt and stores a pending action
for that account + chat + sender. The next text or supported media message is
used as the answer. Prompts expire after `INTERACTIVE_PROMPT_TTL_MIN` minutes.

Media prompts accept:

- a directly sent image/video/sticker/document, or
- a reply to one of those message types.

The existing plugin receives the message in the shape it already expects
(`m.quoted` for sticker/toimage/take, a direct image for vision, and so on).

### Confirmations

Destructive actions ask first:

- Kick member
- Demote admin
- Revoke invite link
- Cancel a scheduled message
- Reset welcome/goodbye settings

The confirmation button contains a short-lived random token. The action only
runs when the returned token matches the stored confirmation. Pressing an old
confirmation twice does not run twice.

### Pagination

- Categories: 6 entries per page, with previous/next rows.
- Scheduled messages: 5 entries per page, with previous/next rows.
- Navigation rows are included in the same 10-row budget.

### Expiry, duplicates and concurrency

- Menu/navigation state expires after `INTERACTIVE_STATE_TTL_MIN` minutes.
- Pending prompts and confirmations expire after `INTERACTIVE_PROMPT_TTL_MIN`.
- A duplicate delivery of the same message + action is ignored.
- Actions for one conversation are serialized, so a fast double-tap cannot run
  two prompts or two destructive actions at once.
- State is keyed by `accountId:chat:sender`, so two people in the same group
  never share a prompt or navigation stack.
- The number of live menu states is capped by `INTERACTIVE_STATE_MAX`.

### Permissions

Scope is checked before rendering and before executing:

| Scope | Rule |
| --- | --- |
| `everyone` | Any chat |
| `owner` | Bot owner / `fromMe` |
| `group` | Group chats only |
| `groupAdmin` | Group + sender is admin or owner |
| `groupAdminBot` | Group + sender admin/owner + bot is admin |
| `groupBotAdmin` | Group + bot is admin or owner |
| `welcomeAdmin` | Owner, or group admin in a group |

Owner-only plugin flags (`fromMe`) are also checked, so the interactive layer
cannot bypass an existing owner restriction.

---

## 3. Action IDs and safety

Action IDs are opaque and stable. The visible label is never used to decide what
to do.

```text
ocm:nav:main | back | close
ocm:all
ocm:cat:<category>:<page>
ocm:feat:<feature>
ocm:choice:<feature>:<option>
ocm:confirm:<random-token>
ocm:cancel
ocm:welcome:<group|global>
ocm:wset:<scope>:<key>:<on|off|inherit>
ocm:wtext:<scope>:<key>
ocm:wreset:<scope>
ocm:sch:new | page:<n> | view:<id> | time:<id> | text:<id> | cancel:<id>
ocm:info:links | text
```

Validation rules:

1. The ID must start with `ocm:`.
2. The category, feature, choice option or schedule ID must exist in the
   registry/state; unknown IDs are rejected with a friendly "expired or invalid"
   message.
3. Schedule IDs must match a conservative `[a-z0-9]{2,16}` pattern.
4. Confirmation tokens must match the stored token.
5. Scope and owner checks run again at execution time.
6. The original command is located by its registered pattern/alias. If the
   plugin is missing, the bot says so instead of silently doing nothing.

---

## 4. Transport and fallback

### Native quick replies

Built with Baileys `proto.Message.InteractiveMessage` and sent through
`relayMessage` as:

```text
viewOnceMessage
└─ message
   ├─ messageContextInfo
   └─ interactiveMessage
      └─ nativeFlowMessage (v1)
         └─ quick_reply buttons
additionalNodes:
  biz > interactive(type=native_flow, v=1) > native_flow(v=9, name=mixed)
  bot(biz_bot=1)            ← private chats only, unless disabled
```

Up to 3 buttons are used. Button text is clipped to WhatsApp's practical limit.

### Native lists

Built with `proto.Message.ListMessage` (`SINGLE_SELECT`) and sent with:

```text
additionalNodes:
  biz > list(type=product_list, v=2)
```

Classic `listMessage` is used for menus because the native-flow single-select
variant does not render reliably on iOS. Lists are capped at 10 rows.

### Automatic text fallback

A numbered text menu is sent instead when:

- the chat is the bot's own self-chat (WhatsApp disables quick replies there),
- `INTERACTIVE_TEXT_ONLY=true`,
- native construction/sending throws,
- a message with no usable configuration is requested.

The text fallback lists up to 10 options, stores a number → action-ID map for
15 minutes, and validates replies through the same `parseAction` path. Numbers
are not treated as command input when no text menu is active.

### View-once correctness

The transport uses a `viewOnceMessage` wrapper because that is what WhatsApp
clients expect for native flows. `index.js` explicitly unwraps this wrapper only
when the inner content is an interactive message/response. Real view-once media
is still detected, reported to the owner, and not downloaded or bypassed.

---

## 5. Additive welcome/goodbye improvements

Original behaviour was preserved:

- `settings.welcome` and `settings.goodbye` remain the global switches.
- With no overrides, the exact original messages are produced:
  - `👋 Welcome @<number> to *<group>*!`
  - `👋 @<number> left the group.`
- The event now respects the correct switch per event. Before, an add event could
  be sent when only goodbye was enabled.

New optional settings, used only when configured:

- `settings.welcomeText` — global welcome template.
- `settings.goodbyeText` — global goodbye template.
- `settings.groupWelcome[<groupJid>]` — per-group `welcome`, `goodbye`,
  `welcomeText`, `goodbyeText` overrides.

Templates support `{mention}`, `{name}`, `{number}` and `{group}`. Sending `-`
in a text prompt resets that text to the original default. Resetting a group
removes all overrides and falls back to the global settings.

The interactive screens enforce:

- Global toggles/text: owner only.
- Per-group toggles/text: group admin or owner, only inside a group.
- Reset actions: confirmation first.

The original text commands `.welcome on/off` and `.goodbye on/off` still work.

---

## 6. Scheduler additions

`lib/scheduler.js` gained `get(accountId, id)` and `update(accountId, id, patch)`.
The existing behaviour is unchanged: same file, same 15-second tick, same retry
and late-window rules, same `add`/`list`/`remove` functions.

The interactive schedule screens add:

- create (two steps: time, then message),
- list with pagination,
- view one schedule,
- edit time,
- edit message (and optionally target with `number | message`),
- cancel with confirmation.

The original `.schedule`, `.schedules` and `.unschedule` commands are untouched
and still work.

---

## 7. Configuration

All settings are optional. Defaults shown.

```env
# true = .menu opens native buttons/lists; false = classic text list.
INTERACTIVE_ENABLED=true

# true = always use numbered text menus (normal chats included).
INTERACTIVE_TEXT_ONLY=false

# Add the WhatsApp "bot" node to native quick replies in private chats.
INTERACTIVE_BOT_NODE=true

# Menu/navigation lifetime in minutes (minimum 1).
INTERACTIVE_STATE_TTL_MIN=30

# Pending prompt/confirmation lifetime in minutes (minimum 1).
INTERACTIVE_PROMPT_TTL_MIN=10

# Maximum live per-user menu states in memory.
INTERACTIVE_STATE_MAX=2000
```

Notes:

- `INTERACTIVE_STATE_TTL_MIN` and `INTERACTIVE_PROMPT_TTL_MIN` are clamped to at
  least 1 minute.
- `INTERACTIVE_TEXT_ONLY=true` is the safest choice if a client shows buttons
  but never returns a selection. It overrides `.buttons` for every account.
- `INTERACTIVE_ENABLED=false` is the emergency switch and overrides both
  `INTERACTIVE_TEXT_ONLY` and `.buttons`. `.menu` then goes straight to the
  classic list.
- `INTERACTIVE_BOT_NODE=false` removes the AI/bot badge from private-chat quick
  replies. It has no effect in groups.
- `.buttons` / `.text` are owner-only UI preferences stored per account in
  `data/menu-mode.json`. They are not a replacement for the two environment
  switches above and never touch WhatsApp auth/session files.

---

## 8. Deployment

No migration and no new runtime dependency are required.

1. Deploy the updated files to the existing service.
2. Keep the same persistent volume (`STORAGE_DIR=/data`) so sessions, settings
   and schedules are retained.
3. Add any `INTERACTIVE_*` variables you want to change. Leaving them unset uses
   the safe defaults.
4. Restart the service.
5. Send `.menu` from a normal private chat and from a group.
6. If native rendering is unreliable, set `INTERACTIVE_TEXT_ONLY=true` and
   restart. All functionality remains available through numbered replies.
7. `.menu text` is always available for the classic command list.

The Dockerfiles, `railway.json`, health endpoints and account/session handling
were not changed by this upgrade.

---

## 9. Files changed

### New files

| File | Purpose |
| --- | --- |
| `lib/interactive/catalog.js` | Feature registry, categories, scopes |
| `lib/interactive/messages.js` | Native button/list transport and reply parsing |
| `lib/interactive/menus.js` | Pure menu specs, pagination, text rendering |
| `lib/interactive/engine.js` | Action parsing, prompts, confirms, navigation, execution |
| `lib/interactive/state.js` | Per-user state, TTL, dedupe, locks |
| `lib/interactive/index.js` | Module entry point |
| `lib/commandList.js` | Shared classic command-list builder |
| `lib/welcome.js` | Welcome/goodbye policy, templates, per-group overrides |
| `scripts/test-interactive.js` | 21 offline interactive tests |
| `INTERACTIVE-MENUS.md` | This document |

### Modified files

| File | Change |
| --- | --- |
| `index.js` | Interactive dispatch hook; interactive view-once unwrapping; welcome policy; settings defaults |
| `plugins/menu.js` | `.menu` opens the interactive menu; `.menu text` keeps the classic list |
| `lib/scheduler.js` | Added `get()` and `update()` only |
| `package.json` | Added `test:interactive` script |
| `scripts/check.js` | Recursively checks `lib/**` and `plugins/**` |
| `.env.example` | Documented `INTERACTIVE_*` settings |
| `TEST-REPORT.md` | Added interactive test results |
| `FEATURE-INVENTORY.md` | Added upgrade notes |
| `README.md` | Added a short v1.6 section |

No existing plugin file was rewritten to add buttons. The only plugin change is
the `.menu` entry point.

---

## 10. Dependencies

- No new dependency.
- Baileys remains `^6.7.16` in `package.json`; the installed version used for
  testing is `6.7.24`.
- No Baileys migration to a different library or major version.
- `node-webpmux`, `qrcode`, `yt-dlp`, Playwright, FFmpeg, Supabase and Gemini
  usage are unchanged.
- `lib/buttons.js` is retained but still unused. `lib/scraper.js` still requires
  the missing `cheerio` and is still unused; neither is part of this upgrade.

The lockfile was refreshed once because the declared `node-webpmux` and `qrcode`
dependencies were missing from it. That is a lockfile correction, not a new
runtime dependency.

---

## 11. Tests

Run:

```sh
npm run check            # syntax check, 43 files
npm run test:film        # 35/35 (CineSubz downloader)
npm run test:movie       # 24/24 (legacy providers + registration)
npm run test:interactive # 21/21
```

`test:interactive` is fully offline and covers:

1. Native quick-reply payload, stable IDs, `biz`/`bot` nodes.
2. Native list payload and group node rules.
3. Every supported response shape (button, template, list, native flow,
   single-select).
4. Permission-filtered categories and scopes.
5. WhatsApp row/button limits.
6. Classic text menu completeness.
7. Open → all features → category page → back navigation.
8. Prompt collection and original-command invocation.
9. Destructive confirmation and target resolution.
10. Choice application and category reload.
11. Media prompt with a direct image.
12. Self-chat numbered text fallback and numeric replies.
13. Duplicate delivery suppression.
14. Per-user state isolation in one group.
15. Prefix command clears a pending prompt.
16. Welcome/goodbye defaults, overrides and templates.
17. Scheduler update persistence.
18. Schedule prompt target parsing.
19. Multi-page schedule navigation stays within 10 rows.
20. Invalid/unknown action IDs.
21. Expired native-flow response handling.

### Not tested

- Real WhatsApp pairing or message delivery.
- Native button/list rendering on Android, iOS, WhatsApp Web or Desktop.
- Real Android/iOS selection payloads (the offline tests simulate the documented
  Baileys shapes).
- Group admin/kick/promote operations against a real group.
- Live CineSubz/TMDB, yt-dlp, Playwright, FFmpeg, Gemini or Supabase calls.

Those limitations are the same as the rest of the project. Use a test account
and a test group before relying on destructive actions.

---

## 12. Compatibility and limits

- Native interactive messages are an unofficial WhatsApp Web/Baileys feature.
  Meta can change or restrict them without notice.
- Some clients may show a button/list but not return the selected ID. The
  automatic text fallback covers construction/send failures, not a client that
  silently drops the response. If that happens, set
  `INTERACTIVE_TEXT_ONLY=true`.
- The self-chat always uses text menus because WhatsApp disables quick replies
  there.
- Lists are limited to 10 rows and quick replies to 3 buttons. The menu layer
  paginates instead of exceeding those limits.
- Menu text is clipped to WhatsApp limits; very long feature descriptions are
  shortened.
- In-memory menu state is lost on restart. Persistent settings and schedules are
  not.
- Multi-account state is separated by `accountId`.
- The welcome event still depends on WhatsApp delivering
  `group-participants.update`; missed events cannot be replayed.

---

## 13. Preservation checklist

| Area | Status |
| --- | --- |
| All original text commands | Preserved; still registered and dispatched |
| `.movie` / `.film` | Replaced with the CineSubz downloader in `plugins/movie.js` (search → quality → document) |
| Playwright `.pdl` / `.pdlsources` | Preserved; plugin untouched |
| `.moviestatus` | Kept for owner diagnostics; now reports film-downloader state |
| Downloads (YouTube/Facebook/TikTok/generic) | Preserved; plugin untouched |
| Group tools and admin checks | Preserved; plugin untouched |
| AI / vision / translate | Preserved; plugin untouched |
| Scheduler | Preserved; extended with `get`/`update` |
| Owner settings | Preserved; exposed through menus as an additive path |
| Welcome/goodbye | Original defaults preserved; optional overrides added |
| Sessions / multi-account / LID mapping | Untouched |
| Anti-delete / anti-edit / view-once notice | Untouched |
| Supabase audit | Untouched |
| Docker / Railway / health endpoints | Untouched |
| Storage layout and files | Untouched |
| Dependencies | No new runtime dependency; no Baileys migration |

If a menu ever behaves incorrectly, the original text command remains the
fallback. Nothing was removed to make the menus work.
