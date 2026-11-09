'use strict';
/**
 * Per-user, per-chat interaction state.
 *
 * Nothing here is global UI state: two people pressing buttons in the same
 * group get independent stacks and prompts. Everything is bounded and expires,
 * so a reconnect or a long idle period cannot leak memory or revive stale
 * prompts unexpectedly.
 */
const MAX_STATES = Number(process.env.INTERACTIVE_STATE_MAX || 2000);
const TTL_MS = Math.max(60_000, Number(process.env.INTERACTIVE_STATE_TTL_MIN || 30) * 60_000);
const PENDING_TTL_MS = Math.max(60_000, Number(process.env.INTERACTIVE_PROMPT_TTL_MIN || 10) * 60_000);
const DEDUPE_TTL_MS = 120_000;
const MAX_DEDUPE = 4000;

const states = new Map();
const seen = new Map();
const queues = new Map();

function conversationKey(accountId, chat, sender) {
  return `${accountId || 'default'}:${chat || ''}:${sender || ''}`;
}

function prune(now = Date.now()) {
  for (const [key, state] of states) {
    if (now - state.at > TTL_MS) states.delete(key);
  }
  while (states.size > MAX_STATES) states.delete(states.keys().next().value);
  for (const [id, at] of seen) if (now - at > DEDUPE_TTL_MS) seen.delete(id);
  while (seen.size > MAX_DEDUPE) seen.delete(seen.keys().next().value);
}

function getState(key) {
  prune();
  let state = states.get(key);
  if (!state) {
    state = { key, at: Date.now(), stack: [], lastMenu: null, currentMenu: null, pending: null, confirm: null, textMenu: null };
    states.set(key, state);
  }
  state.at = Date.now();
  return state;
}

/** Read state without creating one for every ordinary chat message. */
function peekState(key) {
  prune();
  return states.get(key) || null;
}

function touch(state) { state.at = Date.now(); return state; }

function clearState(key) {
  states.delete(key);
}

function setPending(state, pending) {
  state.pending = pending ? { ...pending, at: Date.now() } : null;
  touch(state);
  return state.pending;
}

function getPending(state) {
  if (!state.pending) return null;
  if (Date.now() - state.pending.at > PENDING_TTL_MS) {
    state.pending = null;
    return null;
  }
  return state.pending;
}

function setConfirm(state, confirm) {
  state.confirm = confirm ? { ...confirm, at: Date.now() } : null;
  touch(state);
  return state.confirm;
}

function getConfirm(state) {
  if (!state.confirm) return null;
  if (Date.now() - state.confirm.at > PENDING_TTL_MS) {
    state.confirm = null;
    return null;
  }
  return state.confirm;
}

function pushMenu(state, menuId) {
  if (!menuId) return;
  if (state.stack[state.stack.length - 1] !== menuId) state.stack.push(menuId);
  if (state.stack.length > 20) state.stack.splice(0, state.stack.length - 20);
  state.lastMenu = menuId;
  touch(state);
}

function popMenu(state) {
  state.stack.pop();
  state.lastMenu = state.stack[state.stack.length - 1] || 'main';
  touch(state);
  return state.lastMenu;
}

function resetNavigation(state) {
  state.stack = [];
  state.lastMenu = 'main';
  state.pending = null;
  state.confirm = null;
  state.textMenu = null;
  touch(state);
}

/** Duplicate-suppression for a specific incoming message + action. */
function markSeen(messageId, action) {
  prune();
  const key = `${messageId || 'unknown'}|${action || ''}`;
  if (seen.has(key)) return false;
  seen.set(key, Date.now());
  return true;
}

/**
 * Serialize interaction handling per conversation. Without this, a fast
 * double-tap can start two prompts or two destructive actions for one user.
 */
function withLock(key, fn) {
  const previous = queues.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  // Store a settled-safe tail so a failed handler cannot break the next one.
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.finally(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

function stats() {
  return { states: states.size, dedupe: seen.size, locks: queues.size, ttlMin: Math.round(TTL_MS / 60000) };
}

module.exports = {
  TTL_MS,
  PENDING_TTL_MS,
  conversationKey,
  getState,
  peekState,
  clearState,
  touch,
  setPending,
  getPending,
  setConfirm,
  getConfirm,
  pushMenu,
  popMenu,
  resetNavigation,
  markSeen,
  withLock,
  stats,
};
