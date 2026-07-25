const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');

test('Cmd+P URL entry offers remote files and folders in the app', () => {
  const urlBranch = renderer.match(/if \(isUrl\) \{[\s\S]*?\n  \} else if \(isPath\)/);
  assert.ok(urlBranch, 'URL branch should exist in command palette results');
  assert.match(urlBranch[0], /Open Remote File:/);
  assert.match(urlBranch[0], /Browse Remote Folder:/);
  assert.match(urlBranch[0], /window\.electronAPI\.openRemoteUrl\(inputVal\)/);
  assert.match(urlBranch[0], /window\.electronAPI\.openRemoteFolder\(inputVal\)/);
  assert.doesNotMatch(urlBranch[0], /openExternal\(inputVal\)/);
});

test('main process fetches remote URLs and emits file-loaded metadata', () => {
  assert.match(preload, /openRemoteUrl: \(url, options = \{\}\) => ipcRenderer\.invoke\('open-remote-url', url, options\)/);
  assert.match(main, /ipcMain\.handle\('open-remote-url'/);
  assert.match(main, /fetchRemoteTextFile\(remoteUrl, \{/);
  assert.match(main, /sourceUrl: remoteFile\.sourceUrl/);
  assert.match(main, /isRemote: true/);
  assert.match(main, /filePath: null/);
});
