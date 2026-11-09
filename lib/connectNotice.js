'use strict';
/**
 * Connect-notice policy — decides whether a *new WhatsApp connection* should announce itself in the
 * owner's self-chat.
 *
 * Historic bug: the bot announced on every successful `connection.update → open`, suppressing only
 * notices sent in the last 10 minutes (`settings.lastConnectNotice`). Railway kept killing the container
 * without warning (boot records showed "KILLED WITHOUT WARNING after ~4 min / ~51 min"), so each restart
 * produced a fresh connection and — once the 10-minute window had lapsed — another notice. The owner saw
 * one message "roughly every 10 minutes" that was really a restart loop, not a scheduled task.
 *
 * Policy (env CONNECT_NOTICE):
 *   first  (default) — announce once per pairing, then stay quiet across restarts/reconnects
 *   always           — announce on every open, but never more than once per NOTICE_MIN_GAP_MS
 *   off              — never announce
 *
 * A restart storm is reported separately and once: >= RESTART_ALERT_COUNT boots inside
 * RESTART_ALERT_WINDOW_MS turns into a single "unstable" alert instead of one notice per boot.
 */

const DEFAULT_POLICY = 'first';
const NOTICE_MIN_GAP_MS = 10 * 60 * 1000;      // floor shared by every policy
const RESTART_ALERT_COUNT = 3;                 // boots ...
const RESTART_ALERT_WINDOW_MS = 60 * 60 * 1000; // ... within this window = unstable

function normalizePolicy(value) {
  const policy = String(value || '').trim().toLowerCase();
  return ['first', 'always', 'off'].includes(policy) ? policy : DEFAULT_POLICY;
}

/** Drop boot stamps older than the alert window; returns the pruned list. */
function pruneBoots(boots, now, windowMs = RESTART_ALERT_WINDOW_MS) {
  const list = Array.isArray(boots) ? boots.filter(t => Number.isFinite(t) && now - t <= windowMs) : [];
  list.push(now);
  return list.slice(-20);
}

/**
 * @param {object} input
 * @param {'first'|'always'|'off'} input.policy
 * @param {object} input.state   persisted state (announcedOnce, lastNoticeAt)
 * @param {number} input.now
 * @param {number[]} [input.boots] boot stamps for this container **including the current boot**
 * @returns {{announce: boolean, restartAlert: boolean, bootCount: number, reason: string}}
 */
function decideConnectNotice({ policy, state = {}, now = Date.now(), boots = [] }) {
  const resolved = normalizePolicy(policy);
  const bootCount = boots.filter(t => Number.isFinite(t) && now - t <= RESTART_ALERT_WINDOW_MS).length;
  // Instability is worth one message even when normal announcements are suppressed, but at most once per
  // window — otherwise a crash loop turns the alert itself into the spam it is reporting.
  const alertCooledDown = now - Number(state.lastRestartAlertAt || 0) > RESTART_ALERT_WINDOW_MS;
  const restartAlert = bootCount >= RESTART_ALERT_COUNT && alertCooledDown;

  if (resolved === 'off') {
    return { announce: false, restartAlert: false, bootCount, reason: 'policy=off' };
  }
  if (resolved === 'first') {
    if (state.announcedOnce) {
      // The session is already known to the owner: silence is correct, restarts are not news.
      return { announce: false, restartAlert, bootCount, reason: 'already announced once for this pairing' };
    }
    return { announce: true, restartAlert, bootCount, reason: 'first announcement for this pairing' };
  }
  // policy=always — still rate-limited, and an unstable container gets one merged alert instead of spam
  const since = Number(state.lastNoticeAt || 0);
  if (now - since < NOTICE_MIN_GAP_MS) {
    return { announce: false, restartAlert, bootCount, reason: `rate limited (${Math.ceil((NOTICE_MIN_GAP_MS - (now - since)) / 60000)} min left)` };
  }
  return { announce: true, restartAlert, bootCount, reason: restartAlert ? `always + ${bootCount} restarts in 1h` : 'policy=always' };
}

module.exports = {
  decideConnectNotice, pruneBoots, normalizePolicy,
  DEFAULT_POLICY, NOTICE_MIN_GAP_MS, RESTART_ALERT_COUNT, RESTART_ALERT_WINDOW_MS,
};
