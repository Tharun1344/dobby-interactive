# Command usage guide — Tharun's WhatsApp Bot

Every command below is taken from the live command registry and the central
usage metadata in `lib/usage.js`. Examples use the default prefix `.`; replace
it if you changed `PREFIX`. Send `.help <command>` at any time to get the same
instructions inside WhatsApp.

Registered command patterns: **47**. Missing usage entries: **0**.

> Verified offline against the source. Live WhatsApp rendering, media
> delivery and third-party services were not tested in this environment.

---

## AI tools

### `.ai`

**Aliases:** `.ask`, `.gemini`, `.chatgpt`

**Purpose:** Ask Gemini a question with short per-chat memory.

**Usage:**

- .ai <question>
- Reply to a message with .ai
- .ai reset

**Needs:** A question or a replied message.

**Optional:** Reply adds the quoted text to the question. "reset" clears chat history.

**Permission:** Everyone

**Example:** .ai How does WhatsApp multi-device work?

**Expected result:** A concise answer in the user's language.

### `.translate`

**Aliases:** `.trans`, `.tr`

**Purpose:** Translate text into a target language.

**Usage:**

- .translate <language> <text>
- Reply to a message with .translate <language>

**Needs:** A language code and text (or a replied message).

**Permission:** Everyone

**Example:** .translate si Hello world

**Expected result:** Only the translated text.

### `.vision`

**Aliases:** `.describe`, `.whatinimage`, `.scan`, `.analyze`, `.analyse`

**Purpose:** Analyse a normal image with Gemini vision.

**Usage:**

- Reply to an image with .vision [question]
- Send an image with the caption .vision [question]

**Needs:** A normal image (max 15 MB). View-once is not processed.

**Optional:** Default prompt asks for a Sinhala description.

**Permission:** Everyone

**Example:** Reply to an image with .vision What is this?

**Expected result:** A description or answer about the image.

## Downloads

### `.download`

**Aliases:** `.media`

**Purpose:** Download any supported public video by name or URL.

**Usage:**

- .download <name or URL>

**Needs:** A name or supported URL.

**Optional:** Quality hint such as 720.

**Permission:** Everyone

**Example:** .download Sintel

**Expected result:** A playable video or a document if it is too large.

### `.fbvideo`

**Aliases:** `.facebook`

**Purpose:** Download a supported Facebook video.

**Usage:**

- .fbvideo <URL>

**Needs:** A direct Facebook video URL.

**Permission:** Everyone

**Example:** .fbvideo https://www.facebook.com/watch/?v=...

**Expected result:** A video up to 720p where the source allows.

### `.song`

**Aliases:** `.ytmp3`, `.mp3`

**Purpose:** Extract audio from YouTube as MP3.

**Usage:**

- .song <name or URL>

**Needs:** A song name or YouTube URL.

**Permission:** Everyone

**Example:** .song Shape of You

**Expected result:** An audio message, or a document if very large.

### `.ttvideo`

**Aliases:** `.tiktok`

**Purpose:** Download a supported TikTok video.

**Usage:**

- .ttvideo <URL>

**Needs:** A direct TikTok video URL.

**Permission:** Everyone

**Example:** .ttvideo https://www.tiktok.com/@user/video/...

**Expected result:** A video up to 720p where the source allows.

### `.ytsearch`

**Aliases:** `.musicsearch`, `.videosearch`

**Purpose:** Search YouTube and return metadata only.

**Usage:**

- .ytsearch <query>

**Needs:** A search query.

**Permission:** Everyone

**Example:** .ytsearch Shape of You

**Expected result:** The top 5 titles and links; nothing is downloaded.

### `.ytvideo`

**Aliases:** `.ytmp4`

**Purpose:** Download a YouTube video by name or URL.

**Usage:**

- .ytvideo <name or URL>
- .ytvideo <quality> <name or URL>

**Needs:** A video name or URL.

**Optional:** Quality: 144, 240, 360, 480 (default), 720.

**Permission:** Everyone

**Example:** .ytvideo 720 Shape of You

**Expected result:** A playable video, or a document if it exceeds WhatsApp limits.

## Group tools

### `.demote`

**Purpose:** Remove admin rights from a group admin.

**Usage:**

- Reply to the admin with .demote
- .demote @admin
- .demote <number>

**Needs:** A target admin.

**Permission:** Group admin + bot admin

**Example:** .demote @admin

**Expected result:** A demote request.

### `.groupinfo`

**Aliases:** `.ginfo`

**Purpose:** Show group name, JID, member and admin counts.

**Usage:**

- .groupinfo

**Needs:** Must be used inside a group.

**Permission:** Group members

**Example:** .groupinfo

**Expected result:** Group metadata and an admin mention list.

### `.grouplink`

**Aliases:** `.link`

**Purpose:** Get the current group invite link.

**Usage:**

- .grouplink

**Needs:** Must be used inside a group.

**Permission:** Bot admin or owner

**Example:** .grouplink

**Expected result:** A chat.whatsapp.com invite link.

### `.kick`

**Aliases:** `.remove`

**Purpose:** Remove a member from the group.

**Usage:**

- Reply to the member with .kick
- .kick @member
- .kick <number>

**Needs:** A target member.

**Permission:** Group admin + bot admin

**Example:** Reply to a member with .kick

**Expected result:** A remove request; the bot/owner cannot be removed.

### `.mute`

**Purpose:** Mute or unmute bot replies in this group.

**Usage:**

- .mute on
- .mute off

**Needs:** Must be used inside a group.

**Permission:** Group admin or owner

**Example:** .mute on

**Expected result:** Muted groups skip normal commands except .mute.

### `.promote`

**Purpose:** Promote a member to group admin.

**Usage:**

- Reply to the member with .promote
- .promote @member
- .promote <number>

**Needs:** A target member.

**Permission:** Group admin + bot admin

**Example:** .promote @member

**Expected result:** A promote request.

### `.revoke`

**Purpose:** Reset the group invite link.

**Usage:**

- .revoke

**Needs:** Must be used inside a group.

**Permission:** Group admin + bot admin

**Example:** .revoke

**Expected result:** The old link stops working and a new one is generated.

### `.tagall`

**Aliases:** `.everyone`

**Purpose:** Mention every group member.

**Usage:**

- .tagall [message]

**Needs:** Must be used inside a group.

**Optional:** The message is optional.

**Permission:** Group admin + bot admin

**Example:** .tagall Meeting at 8 PM

**Expected result:** One message mentioning all participants.

## Main and information

### `.alive`

**Purpose:** Show bot status, uptime, version and owner links.

**Usage:**

- .alive

**Needs:** Nothing.

**Permission:** Everyone

**Example:** .alive

**Expected result:** A status card and a separate social-links message.

### `.menu`

**Aliases:** `.help`, `.commands`

**Purpose:** Open the bot menu or the classic command list.

**Usage:**

- .menu
- .menu text
- .help <command>

**Needs:** Nothing.

**Optional:** text | classic | list = classic command list.

**Permission:** Everyone

**Example:** .menu

**Expected result:** Interactive buttons/lists, or a numbered text menu.

### `.owner`

**Aliases:** `.creator`, `.dev`

**Purpose:** Send the owner contact card.

**Usage:**

- .owner

**Needs:** Nothing.

**Permission:** Everyone

**Example:** .owner

**Expected result:** A WhatsApp contact card for the configured owner.

### `.ping`

**Purpose:** Check that the bot is responding.

**Usage:**

- .ping

**Needs:** Nothing.

**Permission:** Everyone

**Example:** .ping

**Expected result:** A short PONG reply with uptime.

### `.uptime`

**Aliases:** `.runtime`

**Purpose:** Show how long the bot process has been running.

**Usage:**

- .uptime

**Needs:** Nothing.

**Permission:** Everyone

**Example:** .uptime

**Expected result:** A human-readable uptime value.

## Media tools

### `.getpp`

**Aliases:** `.gp`, `.getpic`

**Purpose:** Download a WhatsApp profile picture.

**Usage:**

- .getpp @user
- Reply to a user with .getpp
- .getpp <number>
- .getpp me

**Needs:** A mention, reply, number, or "me".

**Optional:** In groups, mention or reply to the member. "me" targets yourself.

**Permission:** Everyone

**Example:** .getpp @user

**Expected result:** The profile photo, or a privacy/unavailable explanation.

### `.qr`

**Aliases:** `.qrcode`

**Purpose:** Turn text or a link into a QR image.

**Usage:**

- .qr <text or URL>

**Needs:** Text or a URL (max 1000 characters).

**Permission:** Everyone

**Example:** .qr https://github.com

**Expected result:** A PNG QR code image.

### `.ssweb`

**Aliases:** `.screenshot`, `.ss`

**Purpose:** Take a screenshot of a website.

**Usage:**

- .ssweb <URL>

**Needs:** A full http(s) URL.

**Permission:** Everyone

**Example:** .ssweb https://github.com

**Expected result:** A website screenshot image.

### `.sticker`

**Aliases:** `.s`, `.stiker`

**Purpose:** Convert an image or short video into a WhatsApp sticker.

**Usage:**

- Reply to an image/video with .sticker
- Send media with the caption .sticker

**Needs:** An image or a video under 6 seconds.

**Permission:** Everyone

**Example:** Reply to a photo with .sticker

**Expected result:** A WebP sticker.

### `.take`

**Aliases:** `.steal`

**Purpose:** Re-pack a sticker with a different pack name.

**Usage:**

- Reply to a sticker with .take
- Reply to a sticker with .take <pack name>

**Needs:** A reply to a sticker.

**Optional:** Without a pack name the sender push name is used.

**Permission:** Everyone

**Example:** Reply to a sticker with .take My Pack

**Expected result:** The same sticker with a new pack name.

### `.toimage`

**Aliases:** `.toimg`

**Purpose:** Convert a WhatsApp sticker to a PNG image.

**Usage:**

- Reply to a sticker with .toimage

**Needs:** A reply to a sticker (direct send is not supported).

**Permission:** Everyone

**Example:** Reply to a sticker with .toimage

**Expected result:** A PNG image.

### `.tts`

**Aliases:** `.speak`, `.say`

**Purpose:** Convert text into a voice note.

**Usage:**

- .tts <text>
- .tts <language> <text>

**Needs:** Text (max 200 characters).

**Optional:** Languages: si, en, ta, hi, id, es, fr, de, pt, ar, ja, ko.

**Permission:** Everyone

**Example:** .tts si ආයුබෝවන්

**Expected result:** A WhatsApp voice note (fallback: MP3 audio).

### `.viewonce`

**Aliases:** `.vv`, `.readvo`, `.readviewonce`

**Purpose:** Recover a view-once item received while the bot was online.

**Usage:**

- Reply to a view-once photo/video/voice note with .viewonce

**Needs:** A reply to a view-once message in the short-lived memory cache.

**Optional:** Alias: {p}vv.

**Permission:** Owner only

**Example:** Reply to a view-once photo with .viewonce

**Expected result:** The media is sent only to the owner self-chat; privacy is not bypassed.

## Other tools

### `.github`

**Aliases:** `.git`, `.repo`

**Purpose:** Look up a GitHub user or repository.

**Usage:**

- .github <username>
- .github <user>/<repo>

**Needs:** A GitHub username or user/repo.

**Permission:** Everyone

**Example:** .github octocat

**Expected result:** Profile or repository details from the GitHub API.

## Movies and Playwright downloader

### `.movie`

**Aliases:** `.film`

**Purpose:** Search CineSubz, choose a quality, and send the film as a WhatsApp document.

**Usage:**

- .movie <film name>
- .film <film name>
- .movie <quality> <film name>
- .movie status
- .movie cancel
- .movie send

**Needs:** A film name.

**Optional:** A leading quality (480p/720p/1080p) skips the quality question.

**Permission:** Everyone (bot private mode still limits who may use the bot)

**Example:** .movie Iru Mugan

**Expected result:** Quality buttons, a download on the bot host, and the film as a document.

### `.moviestatus`

**Purpose:** Show film downloader settings, disk space and active jobs.

**Usage:**

- .moviestatus

**Needs:** Nothing.

**Permission:** Owner only

**Example:** .moviestatus

**Expected result:** Diagnostic information without secrets.

### `.pdl`

**Aliases:** `.siteget`, `.playwrightdl`

**Purpose:** Download from an allowlisted Playwright source.

**Usage:**

- .pdl <file or movie name>
- .pdl --source=<name> <file or movie name>

**Needs:** A file/movie name.

**Permission:** Owner only

**Example:** .pdl --source=my-catalogue Sintel

**Expected result:** A file from a configured, allowlisted source.

### `.pdlsources`

**Purpose:** List configured Playwright sources and stats.

**Usage:**

- .pdlsources

**Needs:** Nothing.

**Permission:** Owner only

**Example:** .pdlsources

**Expected result:** Configured source names and concurrency information.

## Owner controls

### `.accounts`

**Purpose:** Show the current account ID (never secrets).

**Usage:**

- .accounts

**Needs:** Nothing.

**Permission:** Owner only

**Example:** .accounts

**Expected result:** The active account ID and multi-account hint.

### `.antidelete`

**Purpose:** Toggle anti-delete / anti-edit owner notices.

**Usage:**

- .antidelete on
- .antidelete off

**Needs:** on or off.

**Permission:** Owner only

**Example:** .antidelete on

**Expected result:** Deleted/edited messages observed while online are reported to self-chat.

### `.autoreact`

**Purpose:** Configure automatic reactions to recognised commands.

**Usage:**

- .autoreact on
- .autoreact off
- .autoreact set ❤️

**Needs:** on, off, or set <emoji>.

**Optional:** The emoji can be any short emoji string (max 16 characters).

**Permission:** Owner only

**Example:** .autoreact set ❤️

**Expected result:** Auto-react is toggled or its emoji changed.

### `.buttons`

**Purpose:** Enable interactive button/list menus for this account.

**Usage:**

- .buttons

**Needs:** Nothing.

**Permission:** Owner only

**Example:** .buttons

**Expected result:** Interactive Mode is saved and confirmed. Global safety switches still win.

### `.dmgreet`

**Purpose:** Toggle the one-time greeting for new private chats.

**Usage:**

- .dmgreet on
- .dmgreet off

**Needs:** on or off.

**Optional:** Set GREETING_MSG to customise the text.

**Permission:** Owner only

**Example:** .dmgreet on

**Expected result:** New private chats receive one greeting on their first command.

### `.goodbye`

**Purpose:** Toggle the global group goodbye messages.

**Usage:**

- .goodbye on
- .goodbye off

**Needs:** on or off.

**Permission:** Owner only

**Example:** .goodbye on

**Expected result:** Global goodbye switch changes; per-group overrides win.

### `.mode`

**Purpose:** Switch public/private access mode.

**Usage:**

- .mode public
- .mode private

**Needs:** public or private.

**Permission:** Owner only

**Example:** .mode public

**Expected result:** Public = everyone; private = owner self-chat only.

### `.schedule`

**Aliases:** `.sch`

**Purpose:** Schedule a message for later.

**Usage:**

- .schedule <time> | <message>
- .schedule <time> | <number> | <message>

**Needs:** A time and a message. Target is optional.

**Optional:** Time: 10m, 2h, 1h30m, 1d, 18:30, 6:30pm, tomorrow 07:00, 2026-10-25 18:30.

**Permission:** Owner only

**Example:** .schedule 18:30 | Hello

**Expected result:** A saved schedule with an ID; Sri Lanka time by default.

### `.schedules`

**Aliases:** `.schlist`

**Purpose:** List pending scheduled messages.

**Usage:**

- .schedules

**Needs:** Nothing.

**Permission:** Owner only

**Example:** .schedules

**Expected result:** Pending IDs, times, targets and message previews.

### `.text`

**Purpose:** Enable classic text menus for this account.

**Usage:**

- .text

**Needs:** Nothing.

**Permission:** Owner only

**Example:** .text

**Expected result:** Classic Text Mode is saved; normal text commands keep working.

### `.unschedule`

**Aliases:** `.schcancel`

**Purpose:** Cancel a scheduled message by ID.

**Usage:**

- .unschedule <id>

**Needs:** A schedule ID from .schedules.

**Permission:** Owner only

**Example:** .unschedule ab12

**Expected result:** The schedule is removed, or a not-found message is returned.

### `.welcome`

**Purpose:** Toggle the global group welcome messages.

**Usage:**

- .welcome on
- .welcome off

**Needs:** on or off.

**Permission:** Owner only

**Example:** .welcome on

**Expected result:** Global welcome switch changes; per-group overrides win.

---

## Notes on reply, mention and media commands

- **Reply required**: `.sticker`, `.toimage`, `.take`, `.vision`, `.viewonce` operate on the quoted message. `.ai` and `.translate` also accept a reply as optional input.
- **Mention or reply**: group actions (`.kick`, `.promote`, `.demote`) accept `@mention`, a number or a reply. `.getpp` accepts `@mention`, a reply, a number, a JID or `me`.
- **Media required**: `.sticker` needs an image or a short video; `.toimage` and `.take` need a sticker; `.vision` needs a normal image (not view-once).
- **URL required**: `.fbvideo`, `.ttvideo`, `.ssweb` require a valid `http(s)` URL. `.ytvideo`, `.song`, `.download` and `.ytsearch` accept a name or a URL.
- **Permissions**: owner-only commands are enforced before the handler (`.buttons`, `.text`, `.mode`, `.schedule`, `.pdl`, `.accounts`, `.viewonce`, …). Group-changing commands need group-admin rights and usually bot-admin rights.
- **Privacy**: `.getpp` and `.viewonce` respect WhatsApp privacy. A restricted profile photo is reported, never bypassed; view-once media is only recoverable while it is in the short-lived in-memory cache.
