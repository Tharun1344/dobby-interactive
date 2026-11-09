# scripts/setup-local.ps1
#
# One-shot local setup for DANUWA-MD on Windows.
# Never overwrites an existing config.env / data\movies.json / node_modules.
#
#   powershell -ExecutionPolicy Bypass -File scripts\setup-local.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\setup-local.ps1 -WithPlaywright
#
# -WithPlaywright also installs the Chromium browser used by .pdl / .moviestatus.

param(
  [switch]$WithPlaywright,
  [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "    ok  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    !   $text" -ForegroundColor Yellow }

# ── 1. Node version ─────────────────────────────────────────────────────────
Step 'Checking Node.js'
try {
  $nodeVersion = (node -v).TrimStart('v')
} catch {
  throw 'Node.js is not installed. Install Node 20 LTS from https://nodejs.org'
}
$major = [int]($nodeVersion.Split('.')[0])
if ($major -lt 20 -or $major -ge 23) {
  Warn "Node $nodeVersion detected. This bot supports Node >=20 <23 (20 or 22 LTS)."
} else {
  Ok "Node $nodeVersion"
}
Ok "npm $((npm -v))"

# ── 2. Dependencies ─────────────────────────────────────────────────────────
Step 'Installing bot dependencies (npm install)'
if (Test-Path (Join-Path $root 'node_modules')) {
  Warn 'node_modules already exists - running npm install to top it up'
}
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm install failed. See the output above.' }
Ok 'dependencies installed'

# ── 3. Optional browser engine ──────────────────────────────────────────────
if ($WithPlaywright) {
  Step 'Installing Playwright + Chromium (optional, ~350 MB)'
  npm install playwright --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm install playwright failed.' }
  npx playwright install chromium
  if ($LASTEXITCODE -ne 0) { throw 'Chromium download failed. Check your connection.' }
  Ok 'Playwright ready'
} else {
  Warn 'Skipped Playwright. Re-run with -WithPlaywright if you want .pdl / .moviestatus.'
}

# ── 4. Config files (never overwrite) ───────────────────────────────────────
Step 'Preparing config files'

if (-not (Test-Path 'config.env')) {
  Copy-Item '.env.example' 'config.env'
  Ok 'created config.env from .env.example'
  Warn 'open config.env and set BOT_OWNER (your number, international format, no +)'
} else {
  Warn 'config.env already exists - left untouched'
}

if (-not (Test-Path 'data')) { New-Item -ItemType Directory 'data' | Out-Null }

if (-not (Test-Path 'data\movies.json')) {
  Copy-Item 'data\movies.example.json' 'data\movies.json'
  Ok 'created data\movies.json (Sintel + Tears of Steel, CC-BY)'
} else {
  Warn 'data\movies.json already exists - left untouched'
}

if ($WithPlaywright -and -not (Test-Path 'data\download-sources.json')) {
  Copy-Item 'data\download-sources.example.json' 'data\download-sources.json'
  Ok 'created data\download-sources.json (enabled:false until you edit it)'
}

# ── 5. Tests ────────────────────────────────────────────────────────────────
if (-not $SkipTests) {
  Step 'Running offline tests'
  node scripts/check.js
  if ($LASTEXITCODE -ne 0) { throw 'scripts/check.js reported errors.' }
  node scripts/test-movie.js
  if ($LASTEXITCODE -ne 0) { throw 'scripts/test-movie.js reported errors.' }
}

Step 'Done'
Write-Host @'
Next steps:
  1. Edit config.env  -> BOT_OWNER, BOT_NAME, (optional) GEMINI_API_KEY / TMDB_API_KEY
  2. npm start        -> scan the QR with WhatsApp (Linked devices)
  3. In WhatsApp (your own number):  .menu   then   .movie Sintel
  4. Optional downloader:  .pdlsources   /   .pdl <name>   (needs -WithPlaywright)
'@ -ForegroundColor Gray
