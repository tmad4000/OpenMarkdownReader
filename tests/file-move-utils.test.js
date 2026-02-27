const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { moveFileToDirectory } = require('../file-move-utils');

function setupTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-reader-move-'));
}

test('moveFileToDirectory moves file into target folder', () => {
  const root = setupTempDir();
  const sourceDir = path.join(root, 'source');
  const targetDir = path.join(root, 'target');
  fs.mkdirSync(sourceDir);
  fs.mkdirSync(targetDir);

  const sourcePath = path.join(sourceDir, 'note.md');
  fs.writeFileSync(sourcePath, '# hello\n', 'utf8');

  const result = moveFileToDirectory(sourcePath, targetDir);

  assert.equal(result.success, true);
  assert.equal(result.fileName, 'note.md');
  assert.equal(result.newPath, path.join(targetDir, 'note.md'));
  assert.equal(fs.existsSync(sourcePath), false);
  assert.equal(fs.existsSync(result.newPath), true);
});

test('moveFileToDirectory rejects move into same folder', () => {
  const root = setupTempDir();
  const sourcePath = path.join(root, 'note.md');
  fs.writeFileSync(sourcePath, '# hello\n', 'utf8');

  const result = moveFileToDirectory(sourcePath, root);

  assert.equal(result.success, false);
  assert.match(result.error, /already in that folder/i);
  assert.equal(fs.existsSync(sourcePath), true);
});

test('moveFileToDirectory rejects collisions in destination', () => {
  const root = setupTempDir();
  const sourceDir = path.join(root, 'source');
  const targetDir = path.join(root, 'target');
  fs.mkdirSync(sourceDir);
  fs.mkdirSync(targetDir);

  const sourcePath = path.join(sourceDir, 'note.md');
  const destinationPath = path.join(targetDir, 'note.md');

  fs.writeFileSync(sourcePath, '# hello\n', 'utf8');
  fs.writeFileSync(destinationPath, '# existing\n', 'utf8');

  const result = moveFileToDirectory(sourcePath, targetDir);

  assert.equal(result.success, false);
  assert.match(result.error, /already exists/i);
  assert.equal(fs.existsSync(sourcePath), true);
  assert.equal(fs.existsSync(destinationPath), true);
});

test('moveFileToDirectory rejects non-existent source', () => {
  const root = setupTempDir();
  const targetDir = path.join(root, 'target');
  fs.mkdirSync(targetDir);

  const result = moveFileToDirectory(path.join(root, 'missing.md'), targetDir);

  assert.equal(result.success, false);
  assert.match(result.error, /does not exist/i);
});
