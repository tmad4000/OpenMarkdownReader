const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

// Jacob: "when I create a new page it should focus." Every new-file path
// (Cmd+N, welcome-screen New File, sidebar inline-create with forceEdit)
// funnels through showEditor. The per-tab showEditor override used to focus
// only the plain-mode textarea; in rich mode (the default) the underlying
// textarea is hidden inside the EasyMDE wrapper, so focusing it was a no-op
// and keyboard focus never reached the editor.

test('focusActiveEditor focuses CodeMirror in rich mode and the textarea in plain mode', () => {
  const helperMatch = renderer.match(/function focusActiveEditor\(tab\) \{[\s\S]*?\n\}/);
  assert.ok(helperMatch, 'renderer should define focusActiveEditor');

  const helperBody = helperMatch[0];
  assert.match(helperBody, /settings\.richEditorMode && tab\.easyMDE/,
    'rich-mode focus must check the mode, not just instance presence (tab.easyMDE survives leaveRichMode)');
  assert.match(helperBody, /tab\.easyMDE\.codemirror\.focus\(\)/);
  assert.match(helperBody, /tab\.editorEl\.focus\(\)/);
});

test('showEditor override ends by focusing the active editing surface', () => {
  const overrideMatch = renderer.match(/showEditor = function\(content\) \{[\s\S]*?\n\};/);
  assert.ok(overrideMatch, 'per-tab showEditor override should exist');
  assert.match(overrideMatch[0], /focusActiveEditor\(tab\);/,
    'showEditor must hand keyboard focus to the editor in both rich and plain mode');
});

test('new-file entry points enter edit mode through showEditor', () => {
  const newFileHandler = renderer.match(/window\.electronAPI\.onNewFile\(\(\) => \{[\s\S]*?\n\}\);/);
  assert.ok(newFileHandler, 'renderer should handle the New File menu request');
  assert.match(newFileHandler[0], /showEditor\(''\)/);
});

test('rich/plain mode toggle refocuses the editor', () => {
  const toggleMatch = renderer.match(/richModeBtn\.addEventListener\('click', \(\) => \{[\s\S]*?\n\}\);/);
  assert.ok(toggleMatch, 'rich mode toggle handler should exist');
  assert.match(toggleMatch[0], /focusActiveEditor\(tab\);/);
});
