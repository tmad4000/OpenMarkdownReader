// Static wiring checks for the Milkdown WYSIWYG engine (markdown-reader-r1r).
// Behavioural round-trip fidelity is checked with
// `npx electron scripts/milkdown-fidelity/run.js <out.json> <list.txt>`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('Milkdown is the default rich editor engine', () => {
  assert.match(read('renderer.js'), /editorEngine:\s*'milkdown'/);
  assert.match(read('main.js'), /editorEngine:\s*'milkdown'/);
});

test('bundle is committed and loaded by index.html', () => {
  assert.ok(fs.existsSync(path.join(root, 'milkdown-bundle.js')), 'run npm run build:milkdown');
  assert.match(read('index.html'), /<script src="milkdown-bundle\.js"><\/script>/);
});

test('settings menu offers both engines', () => {
  const main = read('main.js');
  assert.match(main, /label: 'Rich Editor Engine'/);
  assert.match(main, /setEditorEngine\('milkdown'\)/);
  assert.match(main, /setEditorEngine\('easymde'\)/);
});

test('Milkdown init failure falls back to EasyMDE', () => {
  assert.match(read('renderer.js'), /falling back to EasyMDE/);
});

test('entry preserves frontmatter and wikilinks', () => {
  const entry = read('milkdown-entry.js');
  assert.match(entry, /splitFrontmatter/);
  assert.match(entry, /wikiLink: \(node\) => `\[\[\$\{node\.value\}\]\]`/);
  assert.match(entry, /if \(baselineDoc && doc\.eq\(baselineDoc\)\) return original;/);
});
