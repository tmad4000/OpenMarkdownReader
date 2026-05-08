const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('sidebar header keeps action icons in explicit groups', () => {
  const headerMatch = indexHtml.match(/<div class="sidebar-header">[\s\S]*?<div id="sidebar-path"/);
  assert.ok(headerMatch, 'sidebar header markup should exist');

  const headerHtml = headerMatch[0];
  const groupCount = (headerHtml.match(/class="sidebar-btn-group"/g) || []).length;

  assert.equal(groupCount, 3);
  assert.match(headerHtml, /class="sidebar-header-buttons" aria-label="File sidebar actions"/);
});

test('sidebar sort state is a menu control, not a separate icon toggle', () => {
  const headerMatch = indexHtml.match(/<div class="sidebar-header">[\s\S]*?<div id="sidebar-path"/);
  assert.ok(headerMatch, 'sidebar header markup should exist');

  const headerHtml = headerMatch[0];
  assert.match(headerHtml, /id="sidebar-sort-status"[\s\S]*aria-haspopup="menu"/);
  assert.match(headerHtml, /id="sidebar-sort-menu"[\s\S]*data-sort-mode="name"[\s\S]*data-sort-mode="date"/);
  assert.doesNotMatch(headerHtml, /id="sidebar-sort-btn"/);
});

test('sidebar header layout prevents sort controls from overflowing action icons', () => {
  assert.match(styles, /\.sidebar-header\s*{[\s\S]*?display:\s*grid;/);
  assert.match(styles, /\.sidebar-header-meta\s*{[\s\S]*?justify-content:\s*space-between;/);
  assert.match(styles, /\.sidebar-header-buttons\s*{[\s\S]*?flex-wrap:\s*wrap;/);
  assert.match(styles, /\.sidebar-sort-status-label\s*{[\s\S]*?text-overflow:\s*ellipsis;/);
});
