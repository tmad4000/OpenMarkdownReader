const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveFinderAction, openInFinder } = require('../finder-actions');

test('resolveFinderAction returns none for missing or invalid path', () => {
  assert.equal(resolveFinderAction(''), 'none');
  assert.equal(resolveFinderAction('/tmp/missing', { existsSync: () => false }), 'none');
});

test('resolveFinderAction returns open for directories', () => {
  const action = resolveFinderAction('/tmp/folder', {
    existsSync: () => true,
    statSync: () => ({ isDirectory: () => true })
  });
  assert.equal(action, 'open');
});

test('resolveFinderAction returns reveal for files', () => {
  const action = resolveFinderAction('/tmp/file.md', {
    existsSync: () => true,
    statSync: () => ({ isDirectory: () => false })
  });
  assert.equal(action, 'reveal');
});

test('openInFinder opens directories with shell.openPath', async () => {
  const calls = [];
  const shell = {
    openPath: async (targetPath) => {
      calls.push(['openPath', targetPath]);
      return '';
    },
    showItemInFolder: () => {
      throw new Error('showItemInFolder should not be called');
    }
  };

  const result = await openInFinder('/tmp/folder', {
    shell,
    existsSync: () => true,
    statSync: () => ({ isDirectory: () => true })
  });

  assert.equal(result, true);
  assert.deepEqual(calls, [['openPath', '/tmp/folder']]);
});

test('openInFinder reveals files with shell.showItemInFolder', async () => {
  const calls = [];
  const shell = {
    openPath: async () => {
      throw new Error('openPath should not be called');
    },
    showItemInFolder: (targetPath) => {
      calls.push(['showItemInFolder', targetPath]);
    }
  };

  const result = await openInFinder('/tmp/file.md', {
    shell,
    existsSync: () => true,
    statSync: () => ({ isDirectory: () => false })
  });

  assert.equal(result, true);
  assert.deepEqual(calls, [['showItemInFolder', '/tmp/file.md']]);
});
