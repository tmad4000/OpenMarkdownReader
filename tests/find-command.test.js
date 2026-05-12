const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

test('Find command refocuses an already open find bar instead of toggling it closed', () => {
  const handlerMatch = renderer.match(/function handleFindCommand\(\) \{[\s\S]*?\n\}/);
  assert.ok(handlerMatch, 'handleFindCommand should exist');

  const handlerBody = handlerMatch[0];
  assert.match(handlerBody, /if \(findState\.isOpen\)/);
  assert.match(handlerBody, /focusFindInput\(\);/);
  assert.match(handlerBody, /updateFindResults\(\{ preserveInputFocus: true \}\);/);
  assert.doesNotMatch(handlerBody, /hideFindBar\(\)/);
});

test('Menu Find command uses idempotent find handler', () => {
  assert.match(renderer, /window\.electronAPI\.onFindInFile\(handleFindCommand\);/);
});

test('Cmd+F is captured before the rich editor can consume it', () => {
  assert.match(renderer, /e\.key\.toLowerCase\(\)\s*===\s*'f'/);
  assert.match(renderer, /handleFindCommand\(\);/);
  assert.match(renderer, /document\.addEventListener\('keydown', \([\s\S]*?\}, true\);/);
});
