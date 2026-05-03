const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

test('file tree reserves disclosure space for file rows', () => {
  const renderer = fs.readFileSync(path.join(rootDir, 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');

  assert.match(renderer, /class="file-tree-spacer" aria-hidden="true"/);
  assert.match(styles, /\.file-tree-spacer\s*\{[^}]*flex:\s*0 0 12px;/s);

  const basePadding = 12;
  const depthStep = 16;
  const chevron = 12;
  const icon = 14;
  const gap = 6;

  const parentFolderLabelX = basePadding + chevron + gap + icon + gap;
  const childFileLabelX = basePadding + depthStep + chevron + gap + icon + gap;

  assert.equal(childFileLabelX - parentFolderLabelX, depthStep);
});
