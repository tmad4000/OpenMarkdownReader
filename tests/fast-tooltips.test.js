const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const tooltipScript = fs.readFileSync(path.join(root, 'fast-tooltips.js'), 'utf8');

test('fast tooltip layer is loaded before renderer creates dynamic controls', () => {
  const tooltipIndex = indexHtml.indexOf('<script src="fast-tooltips.js"></script>');
  const rendererIndex = indexHtml.indexOf('<script src="renderer.js"></script>');

  assert.ok(tooltipIndex > -1, 'fast tooltip script should be included');
  assert.ok(rendererIndex > -1, 'renderer script should be included');
  assert.ok(tooltipIndex < rendererIndex, 'fast tooltip script should load before renderer');
});

test('fast tooltip layer shows quickly and suppresses native title delay', () => {
  assert.match(tooltipScript, /SHOW_DELAY_MS\s*=\s*120/);
  assert.match(tooltipScript, /removeAttribute\('title'\)/);
  assert.match(tooltipScript, /closest\('\[title\], \[data-fast-tooltip-title\], \[data-tooltip\], \[aria-label\]'\)/);
});

test('fast tooltip layer updates immediately between adjacent targets', () => {
  assert.match(tooltipScript, /tooltipEl\?\.classList\.contains\('visible'\)/);
  assert.match(tooltipScript, /showTooltip\(target\);\s*return;/);
  assert.match(tooltipScript, /nextTooltipTarget && nextTooltipTarget !== activeTarget/);
});

test('fast tooltip styling stays above app chrome without taking pointer events', () => {
  assert.match(styles, /\.fast-tooltip\s*{[\s\S]*?z-index:\s*10000;/);
  assert.match(styles, /\.fast-tooltip\s*{[\s\S]*?pointer-events:\s*none;/);
  assert.match(styles, /\.fast-tooltip\.visible\s*{[\s\S]*?opacity:\s*1;/);
});
