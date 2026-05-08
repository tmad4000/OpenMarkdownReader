const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rendererPath = path.resolve(__dirname, '..', 'renderer.js');

test('sidebar live refresh keeps command palette cache in sync', () => {
  const renderer = fs.readFileSync(rendererPath, 'utf8');

  const refreshFunction = renderer.match(/async function refreshSidebarFromFilesystem[\s\S]*?\n}\n\nfunction startSidebarLiveWatcher/);
  assert.ok(refreshFunction, 'refreshSidebarFromFilesystem should exist');
  assert.match(refreshFunction[0], /computeSidebarLiveSnapshot\(refreshDirectory\)/);
  assert.match(refreshFunction[0], /setAllFilesCache\(allFiles\)/);
  assert.match(refreshFunction[0], /updateCommandPaletteResults\(\)/);
});

test('sidebar live refresh reloads children for expanded folders', () => {
  const renderer = fs.readFileSync(rendererPath, 'utf8');

  const hydrateFunction = renderer.match(/async function hydrateExpandedSidebarFolders[\s\S]*?\n}\n\nasync function refreshSidebarFromFilesystem/);
  assert.ok(hydrateFunction, 'hydrateExpandedSidebarFolders should exist');
  assert.match(hydrateFunction[0], /expandedFolders\.has\(item\.path\)/);
  assert.match(hydrateFunction[0], /getDirectoryContents\(item\.path\)/);
  assert.match(hydrateFunction[0], /item\.children = children/);
});
