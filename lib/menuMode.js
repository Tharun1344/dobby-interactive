'use strict';
/**
 * Per-account menu delivery mode.
 *
 * Stored in its own JSON file under the runtime data directory — never inside
 * WhatsApp authentication/session directories. Defaults to interactive, which
 * matches the existing behaviour when INTERACTIVE_ENABLED is unset/true.
 *
 * Effective mode:
 *   INTERACTIVE_ENABLED=false  -> 'disabled' (global emergency switch wins)
 *   INTERACTIVE_TEXT_ONLY=true -> 'text'     (global text-only override wins)
 *   otherwise                  -> the account's saved mode
 *
 * `.buttons` and `.text` are UI preferences, not the emergency switch. They
 * must never override the two environment variables above.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_MODE = 'interactive';
const MODES = new Set(['interactive', 'text']);
const ACCOUNT_RE = /^[a-zA-Z0-9_-]{1,40}$/;

let cache = null;

function rootDir() {
  return process.env.STORAGE_DIR || path.join(__dirname, '..');
}
function filePath() {
  return path.join(rootDir(), 'data', 'menu-mode.json');
}
function safeAccount(accountId) {
  const id = String(accountId || 'default');
  return ACCOUNT_RE.test(id) ? id : 'default';
}
function normalizeMode(mode) {
  const value = String(mode || '').toLowerCase();
  return MODES.has(value) ? value : DEFAULT_MODE;
}
function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    cache = {};
  }
  return cache;
}
function reload() {
  cache = null;
  return load();
}
function get(accountId) {
  const stored = load()[safeAccount(accountId)];
  return normalizeMode(stored);
}
function set(accountId, mode) {
  const id = safeAccount(accountId);
  const next = { ...load(), [id]: normalizeMode(mode) };
  const file = filePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file);
  cache = next;
  return next[id];
}
function envState() {
  return {
    enabled: String(process.env.INTERACTIVE_ENABLED || 'true').toLowerCase() !== 'false',
    textOnly: String(process.env.INTERACTIVE_TEXT_ONLY || '').toLowerCase() === 'true',
  };
}
/** The mode actually used for delivery, after global environment overrides. */
function effective(accountId) {
  const env = envState();
  if (!env.enabled) return 'disabled';
  if (env.textOnly) return 'text';
  return get(accountId);
}
function canUseInteractive(accountId) {
  return effective(accountId) === 'interactive';
}
function all() {
  return { ...load() };
}

module.exports = {
  DEFAULT_MODE,
  filePath,
  safeAccount,
  normalizeMode,
  load,
  reload,
  get,
  set,
  envState,
  effective,
  canUseInteractive,
  all,
};
