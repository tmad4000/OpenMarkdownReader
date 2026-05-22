const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');

test('second instance dot argument resolves against the second instance working directory', () => {
  assert.match(main, /function parseArgs\(argv, baseDirectory = process\.cwd\(\)\)/);
  assert.match(main, /flags\.files\.push\(baseDirectory\)/);
  assert.match(main, /parseArgs\(argv, workingDirectory\)/);
});

test('recursive indexing refuses broad filesystem roots', () => {
  assert.match(main, /function isBroadRecursiveScanRoot\(dirPath\)/);
  assert.match(main, /BROAD_RECURSIVE_SCAN_DIRS/);
  assert.match(main, /Skipping recursive file scan for broad directory/);
  assert.match(renderer, /function canRecursivelyIndexDirectory\(dirPath\)/);
  assert.match(renderer, /!canRecursivelyIndexDirectory\(currentDirectory\)/);
});

test('hidden sidebar stops live filesystem polling', () => {
  const sidebarVisibility = renderer.match(/function setSidebarVisibility\(visible\) \{[\s\S]*?\n\}/);
  assert.ok(sidebarVisibility, 'setSidebarVisibility should exist');
  assert.match(sidebarVisibility[0], /startSidebarLiveWatcher\(\)/);
  assert.match(sidebarVisibility[0], /stopSidebarLiveWatcher\(\)/);
});

