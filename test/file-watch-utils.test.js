const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getFileIdentity, findPathByIdentity, detectFileMove } = require('../file-watch-utils');

function withTempDir(run) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omr-watch-'));
  try {
    run(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('findPathByIdentity locates file after rename in same directory', () => {
  withTempDir((root) => {
    const originalPath = path.join(root, 'note.md');
    const renamedPath = path.join(root, 'renamed.md');

    fs.writeFileSync(originalPath, '# hello');
    const identity = getFileIdentity(originalPath);
    fs.renameSync(originalPath, renamedPath);

    const detectedPath = findPathByIdentity(root, identity);
    assert.equal(detectedPath, renamedPath);
  });
});

test('detectFileMove locates file moved to nested directory', () => {
  withTempDir((root) => {
    const oldPath = path.join(root, 'draft.md');
    const nestedDir = path.join(root, 'archive', '2026');
    const newPath = path.join(nestedDir, 'draft.md');

    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(oldPath, 'content');

    const identity = getFileIdentity(oldPath);
    fs.renameSync(oldPath, newPath);

    const detectedPath = detectFileMove({
      oldPath,
      targetIdentity: identity,
      searchRoots: [root]
    });

    assert.equal(detectedPath, newPath);
  });
});

test('detectFileMove returns null when inode cannot be found', () => {
  withTempDir((root) => {
    const oldPath = path.join(root, 'missing.md');
    fs.writeFileSync(oldPath, 'x');

    const identity = getFileIdentity(oldPath);
    fs.unlinkSync(oldPath);

    const detectedPath = detectFileMove({
      oldPath,
      targetIdentity: identity,
      searchRoots: [root]
    });

    assert.equal(detectedPath, null);
  });
});
