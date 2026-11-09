#!/usr/bin/env node
'use strict';
/**
 * Regression test for the "self-chat message every ~10 minutes" bug.
 *
 * The old code announced on every successful connection and only suppressed notices sent in the previous
 * 10 minutes, so a container that Railway kept killing looked like a scheduled 10-minute message. The
 * policy must announce a pairing once and treat restarts as an instability signal, not as news.
 */
const assert = require('assert');
const { decideConnectNotice, pruneBoots, normalizePolicy, RESTART_ALERT_COUNT } = require('../lib/connectNotice');

let passed = 0;
let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); passed++; }
  catch (err) { console.error(`  FAIL ${name}\n       ${err.message}`); failed++; }
};

const now = Date.now();
console.log('connect-notice policy');

test('first: announces a fresh pairing', () => {
  const d = decideConnectNotice({ policy: 'first', state: {}, now, boots: [now] });
  assert.strictEqual(d.announce, true);
  assert.strictEqual(d.reason, 'first announcement for this pairing');
});

test('first: silent once the pairing was announced', () => {
  const d = decideConnectNotice({ policy: 'first', state: { announcedOnce: true }, now, boots: [now] });
  assert.strictEqual(d.announce, false);
});

test('regression: restarts do not re-announce (the 10-minute self-chat spam)', () => {
  const boots = [now - 40 * 60e3, now - 20 * 60e3, now];
  const d = decideConnectNotice({ policy: 'first', state: { announcedOnce: true, lastNoticeAt: now - 30 * 60e3 }, now, boots });
  assert.strictEqual(d.announce, false);
  assert.strictEqual(d.bootCount, RESTART_ALERT_COUNT);
  assert.strictEqual(d.restartAlert, true, 'three boots in an hour must raise the restart alert');
});

test('always: rate limited inside the 10 minute window', () => {
  const d = decideConnectNotice({ policy: 'always', state: { lastNoticeAt: now - 60e3 }, now, boots: [now] });
  assert.strictEqual(d.announce, false);
  assert.match(d.reason, /rate limited/);
});

test('always: announces after the window lapses', () => {
  const d = decideConnectNotice({ policy: 'always', state: { lastNoticeAt: now - 11 * 60e3 }, now, boots: [now] });
  assert.strictEqual(d.announce, true);
});

test('off: never announces', () => {
  const d = decideConnectNotice({ policy: 'off', state: {}, now, boots: [now] });
  assert.strictEqual(d.announce, false);
  assert.strictEqual(d.restartAlert, false);
});

test('an unknown policy falls back to first', () => {
  assert.strictEqual(normalizePolicy('banana'), 'first');
  assert.strictEqual(normalizePolicy(''), 'first');
  assert.strictEqual(normalizePolicy('ALWAYS'), 'always');
});

test('pruneBoots keeps the last hour, appends now, caps length', () => {
  const list = pruneBoots([now - 2 * 3600e3, now - 60e3], now);
  assert.deepStrictEqual(list, [now - 60e3, now]);
  const many = pruneBoots(Array.from({ length: 40 }, (_, i) => now - i * 1000), now);
  assert.ok(many.length <= 20, `expected <=20 stamps, got ${many.length}`);
});

test('boots outside the window do not trigger the restart alert', () => {
  const stale = [now - 5 * 3600e3, now - 2 * 3600e3, now];
  const d = decideConnectNotice({ policy: 'always', state: {}, now, boots: stale });
  assert.strictEqual(d.bootCount, 1);
  assert.strictEqual(d.restartAlert, false);
});

// The owner explicitly asked: does the `first` decision survive a restart? Prove it with a real file
// round-trip (settings.json is written exactly like this by lib/settings.js: tmp + rename).
test('first: the decision survives a restart through settings.json', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { pruneBoots: prune } = require('../lib/connectNotice');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notice-persist-'));
  const file = path.join(dir, 'settings.json');

  const save = (settings) => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
    fs.renameSync(tmp, file);
  };
  const load = () => JSON.parse(fs.readFileSync(file, 'utf8'));

  // boot 1 — fresh pairing: announce and persist the state
  const t0 = now;
  let settings = { bootTimes: prune([], t0), noticeAnnouncedOnce: false };
  let decision = decideConnectNotice({ policy: 'first', state: settings, now: t0, boots: settings.bootTimes });
  assert.strictEqual(decision.announce, true, 'first boot after pairing must announce');
  settings.noticeAnnouncedOnce = true;
  settings.lastConnectNotice = t0;
  save(settings);

  // restart 1 — 3 minutes later (same container, new process)
  const t1 = t0 + 3 * 60e3;
  const loaded1 = load();
  loaded1.bootTimes = prune(loaded1.bootTimes, t1);
  decision = decideConnectNotice({
    policy: 'first',
    state: { announcedOnce: loaded1.noticeAnnouncedOnce, lastNoticeAt: loaded1.lastConnectNotice },
    now: t1,
    boots: loaded1.bootTimes,
  });
  assert.strictEqual(decision.announce, false, 'a restart must not re-announce');
  save(loaded1);

  // restart 2 — 45 minutes later, still inside the pairing
  const t2 = t0 + 45 * 60e3;
  const loaded2 = load();
  loaded2.bootTimes = prune(loaded2.bootTimes, t2);
  decision = decideConnectNotice({
    policy: 'first',
    state: { announcedOnce: loaded2.noticeAnnouncedOnce, lastNoticeAt: loaded2.lastConnectNotice },
    now: t2,
    boots: loaded2.bootTimes,
  });
  assert.strictEqual(decision.announce, false, 'later restarts must stay silent too');
  save(loaded2);

  // the state really is on disk, so a re-pair (state wiped) is the only thing that re-announces
  assert.strictEqual(load().noticeAnnouncedOnce, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
