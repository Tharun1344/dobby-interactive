'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');

function collect(relativeDir) {
  const absolute = path.join(root, relativeDir);
  if (!fs.existsSync(absolute)) return [];
  const out = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) out.push(...collect(rel));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

const files = ['index.js', 'command.js', 'config.js', ...collect('lib'), ...collect('plugins')];
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) { failed = true; process.stderr.write(`FAIL ${file}\n${result.stderr || result.stdout}`); }
  else process.stdout.write(`OK   ${file}\n`);
}
if (failed) process.exit(1);
process.stdout.write(`\nSyntax checks passed for ${files.length} JavaScript files. This does not verify live WhatsApp or external services.\n`);
