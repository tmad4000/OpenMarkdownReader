const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  findNameCollisionInDirectory,
  resolveSidebarCreateTargetDirectory
} = require('../file-creation-utils');

test('findNameCollisionInDirectory detects case-insensitive collisions', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omr-collision-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'Readme.md'), '');
    assert.equal(findNameCollisionInDirectory(tmpDir, 'readme.md'), 'Readme.md');
    assert.equal(findNameCollisionInDirectory(tmpDir, 'README.MD'), 'Readme.md');
    assert.equal(findNameCollisionInDirectory(tmpDir, 'notes.md'), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveSidebarCreateTargetDirectory keeps selected folder when inside current root', () => {
  const current = '/tmp/workspace';
  const selected = '/tmp/workspace/docs';
  assert.equal(resolveSidebarCreateTargetDirectory(current, selected), selected);
});

test('resolveSidebarCreateTargetDirectory falls back to current root when selected folder is outside root', () => {
  const current = '/tmp/workspace';
  const selected = '/tmp/other';
  assert.equal(resolveSidebarCreateTargetDirectory(current, selected), current);
});
