const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

test('edit mode toggle exits through exitEditMode while the tab is still editing', () => {
  const overrideMatch = renderer.match(/toggleEditMode = function\(\) \{[\s\S]*?\n\};/);
  assert.ok(overrideMatch, 'toggleEditMode override should exist');

  const toggleBody = overrideMatch[0];
  const exitIndex = toggleBody.indexOf('exitEditMode({ scrollPercent });');
  assert.ok(exitIndex > -1, 'toggleEditMode should call exitEditMode when leaving edit mode');

  const beforeExit = toggleBody.slice(0, exitIndex);
  assert.doesNotMatch(beforeExit, /tab\.isEditing\s*=\s*!tab\.isEditing/);
});

test('Cmd+E keyboard shortcut is case-insensitive', () => {
  assert.match(renderer, /e\.key\.toLowerCase\(\)\s*===\s*'e'/);
});
