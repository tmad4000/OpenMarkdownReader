const test = require('node:test');
const assert = require('node:assert/strict');
const { countWords } = require('../word-count');

test('countWords returns 0 for empty or non-string inputs', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords(null), 0);
  assert.equal(countWords(undefined), 0);
});

test('countWords handles markdown-like text', () => {
  const text = '# Hello world\n\nThis is **markdown** text.';
  assert.equal(countWords(text), 6);
});

test('countWords treats contractions and hyphenated words as one word', () => {
  const text = "Don't stop re-reading long-term plans.";
  assert.equal(countWords(text), 5);
});

test('countWords handles unicode letters and numbers', () => {
  const text = 'naive café 2026 año';
  assert.equal(countWords(text), 4);
});
