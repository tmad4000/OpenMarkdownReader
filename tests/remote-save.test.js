const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createRemoteFolderServer } = require('../scripts/serve-remote-folder');

async function startServer(options) {
  const server = createRemoteFolderServer(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}/`
  };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

test('writable remote folder server advertises, reads, saves, and rejects stale writes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omr-remote-save-'));
  const filePath = path.join(root, 'README.md');
  fs.writeFileSync(filePath, '# First\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { server, baseUrl } = await startServer({ root, writable: true });
  t.after(() => closeServer(server));

  const listingResponse = await fetch(baseUrl, {
    headers: { Accept: 'application/json' }
  });
  const listing = await listingResponse.json();
  assert.equal(listing.capabilities.write, true);
  assert.equal(listing.entries[0].writable, true);
  assert.equal(listingResponse.headers.get('x-openmarkdownreader-writable'), 'true');

  const fileUrl = new URL('README.md', baseUrl);
  const initialResponse = await fetch(fileUrl);
  const initialEtag = initialResponse.headers.get('etag');
  assert.equal(await initialResponse.text(), '# First\n');
  assert.ok(initialEtag);

  const saveResponse = await fetch(fileUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'If-Match': initialEtag
    },
    body: '# Saved remotely\n'
  });
  assert.equal(saveResponse.status, 204);
  assert.equal(fs.readFileSync(filePath, 'utf8'), '# Saved remotely\n');

  const staleResponse = await fetch(fileUrl, {
    method: 'PUT',
    headers: { 'If-Match': initialEtag },
    body: '# Must not overwrite\n'
  });
  assert.equal(staleResponse.status, 412);
  assert.equal(fs.readFileSync(filePath, 'utf8'), '# Saved remotely\n');
});

test('read-only remote folder server rejects PUT', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omr-remote-readonly-'));
  fs.writeFileSync(path.join(root, 'note.md'), '# Read only\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { server, baseUrl } = await startServer({ root, writable: false });
  t.after(() => closeServer(server));

  const response = await fetch(new URL('note.md', baseUrl), {
    method: 'PUT',
    body: '# Nope\n'
  });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD, OPTIONS');
});

test('renderer and preload keep remote save separate from Save a Copy', () => {
  const projectRoot = path.join(__dirname, '..');
  const renderer = fs.readFileSync(path.join(projectRoot, 'renderer.js'), 'utf8');
  const preload = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');

  assert.match(renderer, /async function writeRemoteTab/);
  assert.match(renderer, /async function saveRemoteCopy/);
  assert.match(renderer, /if \(tab\.sourceUrl\) \{\s+await saveRemoteCopy\(tab\)/);
  assert.match(renderer, /saveRemoteFile\(tab\.sourceUrl, tab\.content/);
  assert.match(renderer, /showRemoteSaveConflictDialog/);
  assert.match(preload, /saveRemoteFile: \(sourceUrl, content, validators = \{\}\)/);
  assert.match(main, /ipcMain\.handle\('save-remote-file'/);
  assert.match(main, /headers\['If-Match'\] = validators\.etag/);
});
