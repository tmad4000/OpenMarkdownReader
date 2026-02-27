const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeSidebarSortMode,
  getSidebarSortIndicatorState
} = require('../sidebar-sort-indicator.js');

test('normalizeSidebarSortMode falls back to name', () => {
  assert.equal(normalizeSidebarSortMode('name'), 'name');
  assert.equal(normalizeSidebarSortMode('date'), 'date');
  assert.equal(normalizeSidebarSortMode('unexpected'), 'name');
  assert.equal(normalizeSidebarSortMode(undefined), 'name');
});

test('name mode indicator copy is explicit and legible', () => {
  const state = getSidebarSortIndicatorState('name');
  assert.deepEqual(state, {
    mode: 'name',
    label: 'Sort: Name',
    indicator: 'A-Z',
    tooltip: 'Sorted alphabetically (A to Z)',
    buttonTitle: 'Sort mode: Name (A-Z) (click to switch to Recent first)'
  });
});

test('date mode indicator copy is explicit and legible', () => {
  const state = getSidebarSortIndicatorState('date');
  assert.deepEqual(state, {
    mode: 'date',
    label: 'Sort: Recent',
    indicator: 'NEW',
    tooltip: 'Sorted by most recently modified first',
    buttonTitle: 'Sort mode: Recent first (click to switch to Name)'
  });
});
