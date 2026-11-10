#!/usr/bin/env node
'use strict';
/**
 * Regression test for the yt-dlp runner.
 *
 * Downloads now go through the `yt-dlp-exec` package so that every call carries `{ update: true }`
 * (`yt-dlp --update`): the standalone binary it ships is the only build that can self-update, and a stale
 * extractor is the usual reason YouTube downloads start failing. The old argv-based code still works as a
 * fallback, so the translator that bridges argv → yt-dlp-exec flags has to stay exact.
 */
const assert = require('assert');
const download = require('../plugins/download');

let passed = 0;
let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); passed++; }
  catch (err) { console.error(`  FAIL ${name}\n       ${err.message}`); failed++; }
};

const { toExecFlags, usesExec, autoUpdate } = download.__internals || {};
console.log('yt-dlp runner');

test('exposes its internals for testing', () => {
  assert.strictEqual(typeof toExecFlags, 'function', 'toExecFlags should be exported');
});

test('maps boolean switches, value flags and the URL target', () => {
  const { flags, target } = toExecFlags([
    '--no-warnings', '--js-runtimes', 'node:/usr/local/bin/node',
    '-f', 'bestaudio/best', '-o', '/tmp/out.%(ext)s',
    '--extractor-args', 'youtube:player_client=web;getpot_bgutil_script=/opt/pot/server/build/generate_once.js',
    'https://www.youtube.com/watch?v=abc',
  ]);
  assert.strictEqual(target, 'https://www.youtube.com/watch?v=abc');
  assert.strictEqual(flags.noWarnings, true);
  assert.strictEqual(flags.jsRuntimes, 'node:/usr/local/bin/node');
  assert.strictEqual(flags.format, 'bestaudio/best');
  assert.strictEqual(flags.output, '/tmp/out.%(ext)s');
  assert.match(flags.extractorArgs, /getpot_bgutil_script=/);
});

test('keeps repeated value flags (cookies + proxy + two extractor args)', () => {
  const { flags } = toExecFlags(['--cookies', '/tmp/c.txt', '--proxy', 'http://p:1', '--extractor-args', 'a', '--extractor-args', 'b', 'url']);
  assert.strictEqual(flags.cookies, '/tmp/c.txt');
  assert.strictEqual(flags.proxy, 'http://p:1');
  assert.deepStrictEqual(flags.extractorArgs, ['a', 'b']);
});

test('maps the json/flat-playlist shape used by search and the probes', () => {
  const { flags, target } = toExecFlags(['--dump-single-json', '--flat-playlist', '--no-warnings', 'ytsearch5:song name']);
  assert.strictEqual(flags.dumpSingleJson, true);
  assert.strictEqual(flags.flatPlaylist, true);
  assert.strictEqual(target, 'ytsearch5:song name');
});

test('unknown switches are dropped rather than silently mis-mapped', () => {
  const { flags, target, unknown } = toExecFlags(['--no-warnings', '--some-future-flag', 'url']);
  assert.deepStrictEqual(unknown, ['--some-future-flag']);
  assert.strictEqual(flags.someFutureFlag, undefined);
  assert.strictEqual(target, 'url');
});

test('the runner reports yt-dlp-exec with auto-update enabled', () => {
  assert.strictEqual(usesExec, true, 'yt-dlp-exec must be the runner (npm install it)');
  assert.strictEqual(autoUpdate, true, 'auto-update (--update) must be on by default');
});

test('the auto-update flag really is spelled --update for yt-dlp', () => {
  // yt-dlp-exec serialises flags with dargs: { update: true } -> --update
  const ytdlp = require('yt-dlp-exec');
  const argv = ytdlp.args('https://youtu.be/abc', { ...toExecFlags(['--no-warnings', 'https://youtu.be/abc']).flags, update: true });
  assert.ok(argv.includes('--update'), `expected --update in ${argv.join(' ')}`);
  assert.ok(argv.includes('--no-warnings'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
