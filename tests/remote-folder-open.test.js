const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('main and preload expose remote directory browsing IPC', () => {
  assert.match(main, /ipcMain\.handle\('open-remote-folder'/);
  assert.match(main, /ipcMain\.handle\('get-remote-directory-contents'/);
  assert.match(main, /parseRemoteDirectoryListing/);
  assert.match(main, /remote-directory-loaded/);
  assert.match(preload, /openRemoteFolder: \(url\) => ipcRenderer\.invoke\('open-remote-folder', url\)/);
  assert.match(preload, /getRemoteDirectoryContents: \(url\) => ipcRenderer\.invoke\('get-remote-directory-contents', url\)/);
  assert.match(preload, /onRemoteDirectoryLoaded/);
});

test('sidebar has a dedicated remote-folder control and remote workspace state', () => {
  assert.match(index, /id="open-remote-folder-btn"/);
  assert.match(index, /id="sidebar-source-badge"/);
  assert.match(renderer, /function showRemoteFolderPalette\(\)/);
  assert.match(renderer, /currentDirectoryKind = 'remote'/);
  assert.match(renderer, /getDirectoryContentsForSidebar\(folderPath\)/);
  assert.match(renderer, /window\.electronAPI\.openRemoteUrl\(item\.path, options\)/);
  assert.match(renderer, /sidebarNewFileBtn\.disabled = remote/);
});

test('remote folders and tabs are included in session state', () => {
  assert.match(renderer, /directoryKind: currentDirectoryKind/);
  assert.match(renderer, /sourceUrl: t\.sourceUrl/);
  assert.match(renderer, /data\.directoryKind === 'remote'/);
  assert.match(renderer, /openRemoteUrl\(tabData\.sourceUrl/);
  assert.match(main, /windowData\.directoryKind !== 'remote'/);
});

test('remote documents resolve relative links, assets, and refreshes', () => {
  assert.match(renderer, /function resolveRemoteRelativeUrl\(href/);
  assert.match(renderer, /querySelectorAll\('img\[src\], source\[src\]'\)/);
  assert.match(renderer, /resolveRemoteRelativeUrl\(href, tab\.sourceUrl\)/);
  assert.match(renderer, /openRemoteUrl\(remoteTargetUrl, options\)/);
  assert.match(renderer, /openRemoteUrl\(tab\.sourceUrl, \{/);
});
