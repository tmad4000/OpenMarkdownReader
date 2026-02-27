const test = require('node:test');
const assert = require('node:assert/strict');

const { moveFileInTree, findItemByPath } = require('../sidebar-tree-utils');

function buildTree() {
  return [
    {
      name: 'drafts',
      path: '/workspace/drafts',
      type: 'folder',
      children: []
    },
    {
      name: 'archive',
      path: '/workspace/archive',
      type: 'folder'
    },
    {
      name: 'note.md',
      path: '/workspace/note.md',
      type: 'file',
      isMarkdown: true,
      isTextFile: true
    }
  ];
}

test('moveFileInTree moves file into loaded folder children', () => {
  const tree = buildTree();

  const result = moveFileInTree(tree, {
    sourcePath: '/workspace/note.md',
    targetFolderPath: '/workspace/drafts',
    newPath: '/workspace/drafts/note.md',
    newName: 'note.md'
  });

  assert.equal(result.success, true);
  assert.equal(result.insertedIntoVisibleFolder, true);
  assert.equal(findItemByPath(tree, '/workspace/note.md'), null);
  assert.ok(findItemByPath(tree, '/workspace/drafts/note.md'));
});

test('moveFileInTree removes from source even when target folder children are not loaded', () => {
  const tree = buildTree();

  const result = moveFileInTree(tree, {
    sourcePath: '/workspace/note.md',
    targetFolderPath: '/workspace/archive',
    newPath: '/workspace/archive/note.md',
    newName: 'note.md'
  });

  assert.equal(result.success, true);
  assert.equal(result.insertedIntoVisibleFolder, false);
  assert.equal(findItemByPath(tree, '/workspace/note.md'), null);
  assert.equal(findItemByPath(tree, '/workspace/archive/note.md'), null);
});

test('moveFileInTree rejects missing target folder', () => {
  const tree = buildTree();

  const result = moveFileInTree(tree, {
    sourcePath: '/workspace/note.md',
    targetFolderPath: '/workspace/unknown',
    newPath: '/workspace/unknown/note.md',
    newName: 'note.md'
  });

  assert.equal(result.success, false);
  assert.match(result.error, /target folder/i);
  assert.ok(findItemByPath(tree, '/workspace/note.md'));
});
