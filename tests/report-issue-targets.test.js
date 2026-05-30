const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');

test('help menu exposes separate Noos and World Issue Tracker report actions', () => {
  assert.match(main, /label:\s*'Report an Issue…'[\s\S]*?send\('show-report-issue', 'noos'\)/);
  assert.match(main, /label:\s*'Report in World Issue Tracker…'[\s\S]*?send\('show-report-issue', 'wit'\)/);
  assert.match(preload, /onShowReportIssue: \(callback\) => ipcRenderer\.on\('show-report-issue', \(event, target\) => callback\(target\)\)/);
});

test('report modal can submit to either Noos or World Issue Tracker', () => {
  assert.match(indexHtml, /connect-src 'self' https:\/\/globalbr\.ai https:\/\/sthqnyjniclvnflfkyio\.supabase\.co/);
  assert.match(indexHtml, /id="report-issue-heading"/);
  assert.match(renderer, /const WIT_API_URL = 'https:\/\/sthqnyjniclvnflfkyio\.supabase\.co\/functions\/v1'/);
  assert.match(renderer, /const WIT_TRACKER_SLUG = 'openmarkdownreader'/);
  assert.match(renderer, /reportIssueTarget === 'wit'/);
  assert.match(renderer, /fetch\(`\$\{WIT_API_URL\}\/create-issue`/);
  assert.match(renderer, /tracker_slug: WIT_TRACKER_SLUG/);
  assert.match(renderer, /fetch\(`\$\{NOOS_API_URL\}\/nodes\/anonymous-submit`/);
});
