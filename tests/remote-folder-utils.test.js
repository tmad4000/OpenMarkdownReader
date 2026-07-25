const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRemoteEntry,
  parseHtmlDirectoryListing,
  parseRemoteDirectoryListing,
  remoteDirectoryName
} = require('../remote-folder-utils');

test('parses a Python http.server directory listing into immediate children', () => {
  const html = `
    <!doctype html>
    <title>Directory listing for /OpenMarkdownReader%20Demo/</title>
    <a href="../">../</a>
    <a href="notes/">notes/</a>
    <a href="README.md">README.md</a>
    <a href="feature-matrix.md">feature-matrix.md</a>
    <a href="sample-data.json">sample-data.json</a>
    <a href="?C=N;O=D">sort</a>
    <a href="https://example.com/elsewhere.md">elsewhere</a>
  `;

  const entries = parseHtmlDirectoryListing(
    html,
    'https://m3-laptop-server.example:8847/OpenMarkdownReader%20Demo/'
  );

  assert.deepEqual(entries.map(entry => [entry.name, entry.type]), [
    ['notes', 'folder'],
    ['README.md', 'file'],
    ['feature-matrix.md', 'file'],
    ['sample-data.json', 'file']
  ]);
  assert.equal(entries[1].isMarkdown, true);
  assert.equal(entries[3].isTextFile, true);
  assert.equal(entries[0].url, 'https://m3-laptop-server.example:8847/OpenMarkdownReader%20Demo/notes/');
});

test('parses JSON manifests with nested and cross-origin entries', () => {
  const listing = parseRemoteDirectoryListing({
    sourceUrl: 'https://docs.example.com/project/',
    contentType: 'application/json',
    body: JSON.stringify({
      name: 'Project Notes',
      entries: [
        {
          name: 'Guide',
          type: 'folder',
          path: 'guide/',
          children: [
            { name: 'Start.md', path: 'start.md' }
          ]
        },
        {
          name: 'Release notes.md',
          url: 'https://cdn.example.com/releases/latest.md',
          modified: '2026-07-24T12:00:00Z'
        }
      ]
    })
  });

  assert.equal(listing.name, 'Project Notes');
  assert.equal(listing.format, 'json');
  assert.equal(listing.entries[0].children[0].url, 'https://docs.example.com/project/guide/start.md');
  assert.equal(listing.entries[1].url, 'https://cdn.example.com/releases/latest.md');
  assert.ok(listing.entries[1].mtime > 0);
});

test('rejects non-http entries and hidden files', () => {
  assert.equal(buildRemoteEntry('file:///tmp/secret.md', 'https://docs.example.com/'), null);
  assert.equal(buildRemoteEntry('.private.md', 'https://docs.example.com/'), null);
});

test('derives a readable remote folder name from the URL', () => {
  assert.equal(remoteDirectoryName('https://example.com/notes/Project%20One/'), 'Project One');
  assert.equal(remoteDirectoryName('https://example.com/'), 'example.com');
});
