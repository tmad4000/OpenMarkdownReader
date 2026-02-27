const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePath,
  isActiveSidebarFilePath,
  findActiveTabFilePath,
  applyActiveSidebarFileHighlight
} = require('../sidebar-highlight');

function createMockFileTree(paths) {
  const items = paths.map((pathValue) => {
    const classSet = new Set();
    return {
      dataset: { path: pathValue },
      classList: {
        toggle: (className, enabled) => {
          if (enabled) {
            classSet.add(className);
          } else {
            classSet.delete(className);
          }
        },
        contains: (className) => classSet.has(className)
      }
    };
  });

  return {
    items,
    querySelectorAll: () => items
  };
}

test('normalizePath normalizes separators and duplicate slashes', () => {
  assert.equal(normalizePath('  C:\\notes\\\\today.md  '), 'C:/notes/today.md');
});

test('isActiveSidebarFilePath matches equivalent normalized paths', () => {
  assert.equal(isActiveSidebarFilePath('/Users/jc/notes.md', '/Users/jc//notes.md'), true);
  assert.equal(isActiveSidebarFilePath('/Users/jc/notes.md', '/Users/jc/other.md'), false);
});

test('findActiveTabFilePath returns active tab file path', () => {
  const tabs = [
    { id: 1, filePath: '/tmp/one.md' },
    { id: 2, filePath: '/tmp/two.md' }
  ];
  assert.equal(findActiveTabFilePath(tabs, 2), '/tmp/two.md');
  assert.equal(findActiveTabFilePath(tabs, 3), '');
});

test('applyActiveSidebarFileHighlight toggles active class for matching file only', () => {
  const fileTree = createMockFileTree(['/tmp/one.md', '/tmp/two.md', '/tmp/three.md']);
  applyActiveSidebarFileHighlight(fileTree, '/tmp/two.md');

  assert.equal(fileTree.items[0].classList.contains('active'), false);
  assert.equal(fileTree.items[1].classList.contains('active'), true);
  assert.equal(fileTree.items[2].classList.contains('active'), false);
});
