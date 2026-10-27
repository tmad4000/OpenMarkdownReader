const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createPublishService, MESSAGES } = require('../publish-service');

const BASE = 'https://noos.test';

// Reversible stand-in for Electron safeStorage (NOT real encryption).
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`enc:${Buffer.from(s, 'utf8').toString('base64')}`, 'utf8'),
  decryptString: (buf) => Buffer.from(buf.toString('utf8').replace(/^enc:/, ''), 'base64').toString('utf8')
};

function jsonResponse(status, body) {
  const text = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  return {
    status,
    ok: status >= 200 && status < 300,
    type: 'basic',
    headers: { get: () => null },
    text: async () => text
  };
}

/** Mock fetch: routes is an array of handlers consumed in order. */
function mockFetch(routes) {
  const calls = [];
  const queue = [...routes];
  const fn = async (url, opts = {}) => {
    const call = {
      url,
      method: opts.method,
      headers: opts.headers || {},
      body: opts.body ? JSON.parse(opts.body) : undefined
    };
    calls.push(call);
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected fetch: ${opts.method} ${url}`);
    return next(call);
  };
  fn.calls = calls;
  return fn;
}

function makeDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omr-publish-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeService(t, fetch, extra = {}) {
  const storageDir = extra.storageDir || makeDir(t);
  const service = createPublishService({
    fetch,
    baseUrl: BASE,
    storageDir,
    safeStorage: fakeSafeStorage,
    log: { warn() {} },
    ...extra
  });
  return { service, storageDir };
}

async function signInService(t, service, fetchRoutes) {
  // drive a full sign-in through the callback
  const { authorizeUrl } = await service.signIn();
  const state = new URL(authorizeUrl).searchParams.get('state');
  await service.handleAuthCallback(`openmarkdownreader://auth/callback?code=abc&state=${state}`);
}

const DOC = '/Users/test/notes/hello.md';

test('anonymous publish stores the record and an encrypted delete token that survives restart', async (t) => {
  const fetch = mockFetch([
    (call) => {
      assert.equal(call.url, `${BASE}/api/files/anonymous`);
      assert.equal(call.method, 'POST');
      assert.deepEqual(call.body, { content: '# Hi', fileName: 'hello.md', contentType: 'text/markdown' });
      assert.equal(call.headers.Authorization, undefined);
      return jsonResponse(201, {
        id: 'f1', slug: 'hello', fileName: 'hello.md', url: '/f/hello',
        shareUrl: `${BASE}/f/hello`, deleteToken: 'secret-delete-token',
        removalRequestUrl: '/f/hello/request-removal'
      });
    }
  ]);
  const { service, storageDir } = makeService(t, fetch);

  const { record } = await service.publishAnonymous({ docKey: DOC, content: '# Hi', fileName: 'hello.md' });
  assert.equal(record.url, `${BASE}/f/hello`);
  assert.equal(record.mode, 'anonymous');
  assert.equal(record.canUnpublish, true);
  assert.equal(record.removalRequestUrl, `${BASE}/f/hello/request-removal`);
  assert.equal(record.deleteToken, undefined, 'public record must not expose the delete token');

  const onDisk = fs.readFileSync(path.join(storageDir, 'publish-records.json'), 'utf8');
  assert.ok(!onDisk.includes('secret-delete-token'), 'delete token must not be stored in plaintext');
  assert.ok(onDisk.includes('deleteTokenEnc'));
  assert.equal(fs.statSync(path.join(storageDir, 'publish-records.json')).mode & 0o777, 0o600);

  // Restart: a fresh service instance reads the record back.
  const { service: restarted } = makeService(t, mockFetch([]), { storageDir });
  const status = restarted.getStatus(DOC);
  assert.equal(status.record.url, `${BASE}/f/hello`);
  assert.equal(status.record.canUnpublish, true);
  assert.equal(restarted._getRecord(DOC).deleteToken, 'secret-delete-token');
});

test('unpublish of an anonymous link sends X-Delete-Token and clears the record', async (t) => {
  const fetch = mockFetch([
    () => jsonResponse(201, { id: 'f1', slug: 'hello', shareUrl: `${BASE}/f/hello`, deleteToken: 'tok-1' }),
    (call) => {
      assert.equal(call.method, 'DELETE');
      assert.equal(call.url, `${BASE}/api/files/anonymous/f1`);
      assert.equal(call.headers['X-Delete-Token'], 'tok-1');
      return jsonResponse(204);
    }
  ]);
  const { service } = makeService(t, fetch);
  await service.publishAnonymous({ docKey: DOC, content: 'x', fileName: 'hello.md' });
  const result = await service.unpublish({ docKey: DOC });
  assert.equal(result.unpublished, true);
  assert.equal(result.alreadyGone, false);
  assert.equal(service.getStatus(DOC).record, null);
});

test('404 on unpublish is treated as already unpublished and clears the record', async (t) => {
  const fetch = mockFetch([
    () => jsonResponse(201, { id: 'f1', slug: 'hello', shareUrl: `${BASE}/f/hello`, deleteToken: 'tok-1' }),
    () => jsonResponse(404, { error: 'Not found' })
  ]);
  const { service } = makeService(t, fetch);
  await service.publishAnonymous({ docKey: DOC, content: 'x', fileName: 'hello.md' });
  const result = await service.unpublish({ docKey: DOC });
  assert.equal(result.alreadyGone, true);
  assert.equal(service.getStatus(DOC).record, null);
});

test('403 on anonymous unpublish keeps the record and points to removal request', async (t) => {
  const fetch = mockFetch([
    () => jsonResponse(201, { id: 'f1', slug: 'hello', shareUrl: `${BASE}/f/hello`, deleteToken: 'tok-1' }),
    () => jsonResponse(403, { error: 'Invalid delete token' })
  ]);
  const { service } = makeService(t, fetch);
  await service.publishAnonymous({ docKey: DOC, content: 'x', fileName: 'hello.md' });
  await assert.rejects(service.unpublish({ docKey: DOC }), (err) => err.code === 'forbidden' && !!err.removalRequestUrl);
  assert.ok(service.getStatus(DOC).record);
});

test('older server without deleteToken: no in-app unpublish, explains removal request', async (t) => {
  const fetch = mockFetch([
    () => jsonResponse(201, { id: 'f1', slug: 'hello', url: '/f/hello' })
  ]);
  const { service } = makeService(t, fetch);
  const { record } = await service.publishAnonymous({ docKey: DOC, content: 'x', fileName: 'hello.md' });
  assert.equal(record.url, `${BASE}/f/hello`);
  assert.equal(record.canUnpublish, false);
  await assert.rejects(service.unpublish({ docKey: DOC }), (err) => {
    assert.equal(err.code, 'no-delete-token');
    assert.equal(err.message, MESSAGES.noDeleteToken);
    return true;
  });
  assert.equal(fetch.calls.length, 1, 'no DELETE request should be sent without a token');
});

test('sign-in callback verifies state, exchanges code, and persists encrypted tokens', async (t) => {
  const opened = [];
  const fetch = mockFetch([
    (call) => {
      assert.equal(call.url, `${BASE}/api/auth/sso-exchange`);
      assert.deepEqual(call.body, { code: 'the-code' });
      return jsonResponse(200, { user: { id: 'u1', email: 'a@b.co', name: 'A' }, accessToken: 'at-1', refreshToken: 'rt-1' });
    }
  ]);
  const { service, storageDir } = makeService(t, fetch, {
    openExternal: async (url) => opened.push(url),
    randomState: () => 'state-123'
  });

  await service.signIn();
  assert.equal(opened.length, 1);
  const authUrl = new URL(opened[0]);
  assert.equal(authUrl.origin + authUrl.pathname, `${BASE}/api/auth/authorize`);
  assert.equal(authUrl.searchParams.get('client_id'), 'openmarkdownreader');
  assert.equal(authUrl.searchParams.get('redirect_uri'), 'openmarkdownreader://auth/callback');
  assert.equal(authUrl.searchParams.get('response_type'), 'code');
  assert.equal(authUrl.searchParams.get('state'), 'state-123');
  assert.equal(service.getStatus().signInPending, true);

  // Wrong state is rejected and does not consume the pending sign-in.
  await assert.rejects(
    service.handleAuthCallback('openmarkdownreader://auth/callback?code=evil&state=nope'),
    (err) => err.code === 'auth-state-mismatch'
  );
  assert.equal(fetch.calls.length, 0, 'mismatched state must not hit the server');
  assert.ok(service._getPendingSignIn());

  const result = await service.handleAuthCallback('openmarkdownreader://auth/callback?code=the-code&state=state-123');
  assert.equal(result.user.email, 'a@b.co');
  const status = service.getStatus();
  assert.equal(status.signedIn, true);
  assert.equal(status.user.email, 'a@b.co');
  assert.equal(JSON.stringify(status).includes('at-1'), false, 'status must not leak tokens');

  // Replay of the same callback is rejected (single use).
  await assert.rejects(
    service.handleAuthCallback('openmarkdownreader://auth/callback?code=the-code&state=state-123'),
    (err) => err.code === 'auth-state-mismatch'
  );

  const authFile = fs.readFileSync(path.join(storageDir, 'publish-auth.bin'), 'utf8');
  assert.ok(!authFile.includes('at-1') && !authFile.includes('rt-1'));
  assert.equal(fs.statSync(path.join(storageDir, 'publish-auth.bin')).mode & 0o777, 0o600);

  const { service: restarted } = makeService(t, mockFetch([]), { storageDir });
  assert.equal(restarted.getStatus().signedIn, true);
});

test('expired sign-in state is rejected', async (t) => {
  let clock = 1_000_000;
  const { service } = makeService(t, mockFetch([]), { now: () => clock, randomState: () => 's1' });
  await service.signIn();
  clock += 11 * 60 * 1000;
  await assert.rejects(
    service.handleAuthCallback('openmarkdownreader://auth/callback?code=c&state=s1'),
    (err) => err.code === 'auth-expired-request'
  );
  assert.equal(service.getStatus().signedIn, false);
});

test('owned publish sends Bearer token and records the account', async (t) => {
  const fetch = mockFetch([
    () => jsonResponse(200, { user: { id: 'u1', email: 'a@b.co' }, accessToken: 'at-1', refreshToken: 'rt-1' }),
    (call) => {
      assert.equal(call.url, `${BASE}/api/files/create`);
      assert.equal(call.headers.Authorization, 'Bearer at-1');
      assert.deepEqual(call.body, { content: '# Doc', fileName: 'hello.md', contentType: 'text/markdown', visibility: 'unlisted' });
      return jsonResponse(201, { id: 'f9', slug: 'hello' });
    },
    (call) => {
      assert.equal(call.method, 'PUT');
      assert.equal(call.url, `${BASE}/api/files/f9/content`);
      assert.equal(call.headers.Authorization, 'Bearer at-1');
      assert.equal(call.body.content, '# Doc v2');
      return jsonResponse(200, { id: 'f9' });
    },
    (call) => {
      assert.equal(call.method, 'DELETE');
      assert.equal(call.url, `${BASE}/api/files/f9`);
      assert.equal(call.headers.Authorization, 'Bearer at-1');
      return jsonResponse(204);
    }
  ]);
  const { service } = makeService(t, fetch);
  await signInService(t, service);

  const { record } = await service.publishOwned({ docKey: DOC, content: '# Doc', fileName: 'hello.md' });
  assert.equal(record.mode, 'account');
  assert.equal(record.url, `${BASE}/f/hello`, 'falls back to /f/<slug> when server omits url');
  assert.equal(record.canUpdate, true);
  assert.equal(record.canUnpublish, true);

  const updated = await service.updatePublished({ docKey: DOC, content: '# Doc v2' });
  assert.ok(updated.record.updatedAt);

  await service.unpublish({ docKey: DOC });
  assert.equal(service.getStatus(DOC).record, null);
});

test('owned publish refreshes the access token on 401 and retries once', async (t) => {
  const fetch = mockFetch([
    () => jsonResponse(200, { user: { id: 'u1', email: 'a@b.co' }, accessToken: 'old-at', refreshToken: 'rt-1' }),
    (call) => {
      assert.equal(call.headers.Authorization, 'Bearer old-at');
      return jsonResponse(401, { error: 'Token expired' });
    },
    (call) => {
      assert.equal(call.url, `${BASE}/api/auth/refresh`);
      assert.deepEqual(call.body, { refreshToken: 'rt-1' });
      return jsonResponse(200, { accessToken: 'new-at', refreshToken: 'rt-2' });
    },
    (call) => {
      assert.equal(call.headers.Authorization, 'Bearer new-at');
      return jsonResponse(201, { id: 'f2', slug: 'hello', shareUrl: `${BASE}/f/hello` });
    }
  ]);
  const { service } = makeService(t, fetch);
  await signInService(t, service);
  const { record } = await service.publishOwned({ docKey: DOC, content: 'x', fileName: 'hello.md' });
  assert.equal(record.fileId, 'f2');
  assert.equal(fetch.calls.length, 4);
});

test('failed refresh signs the user out with a clear message', async (t) => {
  const fetch = mockFetch([
    () => jsonResponse(200, { user: { id: 'u1', email: 'a@b.co' }, accessToken: 'old-at', refreshToken: 'rt-1' }),
    () => jsonResponse(401, { error: 'Token expired' }),
    () => jsonResponse(401, { error: 'Invalid or expired refresh token' })
  ]);
  const { service } = makeService(t, fetch);
  await signInService(t, service);
  await assert.rejects(
    service.publishOwned({ docKey: DOC, content: 'x', fileName: 'hello.md' }),
    (err) => err.code === 'auth-expired' && err.message === MESSAGES.authExpired
  );
  const status = service.getStatus();
  assert.equal(status.signedIn, false);
  assert.equal(status.signInError, MESSAGES.authExpired);
});

test('network failure maps to a "couldn\'t reach globalbr.ai" message', async (t) => {
  const fetch = mockFetch([
    () => {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'ECONNRESET' };
      throw err;
    }
  ]);
  const { service } = makeService(t, fetch);
  await assert.rejects(
    service.publishAnonymous({ docKey: DOC, content: 'x', fileName: 'hello.md' }),
    (err) => {
      assert.equal(err.code, 'network');
      assert.equal(err.message, MESSAGES.network);
      assert.match(err.message, /Couldn't reach globalbr\.ai/);
      assert.match(err.detail, /ECONNRESET/);
      return true;
    }
  );
  assert.equal(service.getStatus(DOC).record, null);
});

test('filter redirect / HTML block page is reported as interception, not a server error', async (t) => {
  const fetch = mockFetch([
    () => ({ status: 302, ok: false, type: 'basic', headers: { get: () => 'https://safebrowse.io/blocked' }, text: async () => '' }),
    () => jsonResponse(200, '<html>Blocked by filter</html>')
  ]);
  const { service } = makeService(t, fetch);
  await assert.rejects(service.publishAnonymous({ docKey: DOC, content: 'x', fileName: 'a.md' }),
    (err) => err.code === 'network' && err.message === MESSAGES.intercepted);
  await assert.rejects(service.publishAnonymous({ docKey: DOC, content: 'x', fileName: 'a.md' }),
    (err) => err.code === 'network' && err.message === MESSAGES.intercepted);
});

test('server errors and storage-not-configured are distinguished', async (t) => {
  const fetch = mockFetch([
    () => jsonResponse(500, { error: 'Failed to upload file' }),
    () => jsonResponse(503, { error: 'File storage not configured' })
  ]);
  const { service } = makeService(t, fetch);
  await assert.rejects(service.publishAnonymous({ docKey: DOC, content: 'x', fileName: 'a.md' }),
    (err) => err.code === 'server' && /server error \(HTTP 500\)/.test(err.message));
  await assert.rejects(service.publishAnonymous({ docKey: DOC, content: 'x', fileName: 'a.md' }),
    (err) => err.code === 'storage-not-configured' && err.message === MESSAGES.storage);
});

test('untitled documents keep their record in memory only', async (t) => {
  const fetch = mockFetch([
    () => jsonResponse(201, { id: 'f1', slug: 'u', shareUrl: `${BASE}/f/u`, deleteToken: 't' })
  ]);
  const { service, storageDir } = makeService(t, fetch);
  await service.publishAnonymous({ docKey: 'untitled:1:7', content: 'x', fileName: 'Untitled.md' });
  assert.ok(service.getStatus('untitled:1:7').record);
  assert.equal(fs.existsSync(path.join(storageDir, 'publish-records.json')), false);
});

test('without safeStorage, tokens stay in memory and the status says so', async (t) => {
  const fetch = mockFetch([
    () => jsonResponse(201, { id: 'f1', slug: 'hello', shareUrl: `${BASE}/f/hello`, deleteToken: 'tok' })
  ]);
  const { service, storageDir } = makeService(t, fetch, {
    safeStorage: { isEncryptionAvailable: () => false }
  });
  await service.publishAnonymous({ docKey: DOC, content: 'x', fileName: 'hello.md' });
  const status = service.getStatus(DOC);
  assert.equal(status.secureStorage, false);
  assert.ok(status.secureStorageNote);
  assert.equal(status.record.canUnpublish, true);
  const onDisk = fs.readFileSync(path.join(storageDir, 'publish-records.json'), 'utf8');
  assert.ok(!onDisk.includes('tok'));
});

test('moveRecord keeps the publish record attached after a rename', async (t) => {
  const fetch = mockFetch([
    () => jsonResponse(201, { id: 'f1', slug: 'hello', shareUrl: `${BASE}/f/hello`, deleteToken: 'tok' })
  ]);
  const { service } = makeService(t, fetch);
  await service.publishAnonymous({ docKey: DOC, content: 'x', fileName: 'hello.md' });
  assert.equal(service.moveRecord(DOC, '/Users/test/notes/renamed.md'), true);
  assert.equal(service.getStatus(DOC).record, null);
  assert.equal(service.getStatus('/Users/test/notes/renamed.md').record.url, `${BASE}/f/hello`);
});

test('no network call happens on construction or status queries (local-first)', async (t) => {
  const fetch = mockFetch([]);
  const { service } = makeService(t, fetch);
  service.getStatus(DOC);
  service.getStatus();
  assert.equal(fetch.calls.length, 0);
});
