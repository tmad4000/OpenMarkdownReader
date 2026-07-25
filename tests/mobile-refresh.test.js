const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const utils = require(path.join(root, 'ios-app', 'www', 'mobile-utils.js'));
const mobileRenderer = fs.readFileSync(
  path.join(root, 'ios-app', 'www', 'renderer-mobile.js'),
  'utf8'
);
const capacitorConfig = fs.readFileSync(
  path.join(root, 'ios-app', 'capacitor.config.ts'),
  'utf8'
);
const privacyManifest = fs.readFileSync(
  path.join(root, 'ios-app', 'ios', 'App', 'App', 'PrivacyInfo.xcprivacy'),
  'utf8'
);
const infoPlist = fs.readFileSync(
  path.join(root, 'ios-app', 'ios', 'App', 'App', 'Info.plist'),
  'utf8'
);

test('mobile URL helpers validate and resolve remote Markdown sources', () => {
  assert.equal(
    utils.normalizeRemoteUrl(' https://m3.example.ts.net/notes/readme.md '),
    'https://m3.example.ts.net/notes/readme.md'
  );
  assert.equal(
    utils.resolveRemoteUrl('../image.png', 'https://example.com/notes/readme.md'),
    'https://example.com/image.png'
  );
  assert.equal(utils.remoteFileName('https://example.com/notes/My%20File.md'), 'My File.md');
  assert.equal(utils.isMarkdownLikeUrl('https://example.com/readme.md'), true);
  assert.throws(() => utils.normalizeRemoteUrl('file:///tmp/readme.md'));
});

test('mobile file helpers support the reader formats and preserve Unicode', () => {
  const markdown = '# Héllo 🌎\n\n中文 and emoji survive.';
  assert.equal(utils.decodeBase64Utf8(utils.encodeBase64Utf8(markdown)), markdown);
  assert.equal(utils.isSupportedFileName('notes.md'), true);
  assert.equal(utils.isSupportedFileName('events.jsonl'), true);
  assert.equal(utils.isSupportedFileName('photo.png'), false);
  assert.equal(utils.isTextLikeContentType('text/markdown; charset=utf-8'), true);
  assert.equal(utils.isTextLikeContentType('image/png'), false);
});

test('mobile app exposes native remote URL and folder flows', () => {
  assert.match(capacitorConfig, /CapacitorHttp:\s*\{[\s\S]*?enabled:\s*true/);
  assert.match(mobileRenderer, /FilePicker\.pickDirectory\(\)/);
  assert.match(mobileRenderer, /Filesystem\.readdir\(\{ path: folderPath \}\)/);
  assert.match(mobileRenderer, /openRemoteUrl\(value/);
  assert.match(mobileRenderer, /MAX_REMOTE_FILE_BYTES/);
  assert.match(mobileRenderer, /saveCurrentLocalFile/);
});

test('iOS privacy manifest declares Filesystem timestamp access', () => {
  assert.match(privacyManifest, /NSPrivacyAccessedAPICategoryFileTimestamp/);
  assert.match(privacyManifest, /C617\.1/);
  assert.match(privacyManifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(infoPlist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
});
