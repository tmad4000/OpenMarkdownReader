const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

test('session restore only disposes the startup placeholder tab', () => {
  const helperMatch = renderer.match(/function isDisposableStartupTab\(tab\) \{[\s\S]*?\n\}/);
  assert.ok(helperMatch, 'renderer should define isDisposableStartupTab');

  const helperBody = helperMatch[0];
  assert.match(helperBody, /tab\.isStartupPlaceholder/);
  assert.match(helperBody, /tab\.content === null/);
});

test('session restore preserves user-created New File tab focus', () => {
  const restoreMatch = renderer.match(/window\.electronAPI\.onRestoreSession\(\(data\) => \{[\s\S]*?\n\}\);/);
  assert.ok(restoreMatch, 'renderer should define restore-session handler');

  const restoreBody = restoreMatch[0];
  assert.match(restoreBody, /const shouldPreserveActiveTab = hasUserActiveTabDuringRestore\(activeTabAtRestoreStart\);/);
  assert.match(restoreBody, /if \(isDisposableStartupTab\(firstTab\)\)/);
  assert.doesNotMatch(restoreBody, /!firstTab\.content/);
  assert.match(restoreBody, /if \(shouldPreserveActiveTab\) \{\s*return;\s*\}\s*const activeSourcePath/);
});
