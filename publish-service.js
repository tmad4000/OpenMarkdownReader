/**
 * Publish Service — share-to-web for OpenMarkdownReader (main process only).
 *
 * Owns every network call and every secret involved in publishing a document
 * to globalbr.ai (Noos):
 *   - Ideaflow ID sign-in (Noos SSO code flow via the openmarkdownreader:// protocol)
 *   - access/refresh tokens (encrypted at rest with Electron safeStorage)
 *   - publish records keyed by absolute file path, including the anonymous
 *     delete token that lets this Mac unpublish an anonymous link later
 *
 * The renderer only ever sees sanitized status objects (no tokens). Nothing in
 * here touches the network until the user explicitly asks for it
 * (local-first rule in REQUIREMENTS.md).
 *
 * Dependencies are injected so the service can be unit-tested with a mocked
 * fetch and a temp directory (see tests/publish-service.test.js).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_BASE_URL = 'https://globalbr.ai';
const CLIENT_ID = 'openmarkdownreader';
const PROTOCOL = 'openmarkdownreader';
const REDIRECT_URI = `${PROTOCOL}://auth/callback`;
const SIGN_IN_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20 * 1000;

const AUTH_FILE = 'publish-auth.bin';
const RECORDS_FILE = 'publish-records.json';

const MESSAGES = {
  network: "Couldn't reach globalbr.ai. Check your internet connection — a network filter or firewall may be blocking the site.",
  intercepted: "Couldn't reach globalbr.ai — the request was redirected or intercepted (a network filter may be blocking the site).",
  timeout: "Couldn't reach globalbr.ai — the request timed out. Check your connection or network filter.",
  storage: 'globalbr.ai file storage is not configured right now, so publishing is unavailable. Try again later.',
  authRequired: 'Sign in with your Ideaflow ID to do that.',
  authExpired: 'Your Ideaflow ID session expired. Sign in again to continue.',
  wrongAccount: 'Sign in with the Ideaflow ID that published this document to update or unpublish it.',
  notPublished: 'This document is not published.',
  noDeleteToken: "This link can't be removed from the app — request removal on the page.",
  deleteForbidden: 'globalbr.ai rejected this Mac\'s removal key. You can still request removal on the page.',
  emptyContent: 'Nothing to publish — the document is empty.'
};

class PublishError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'PublishError';
    this.code = code;
    Object.assign(this, extra);
  }
}

function serializeError(err) {
  if (err instanceof PublishError) {
    const out = { code: err.code, message: err.message };
    if (err.status) out.status = err.status;
    if (err.detail) out.detail = err.detail;
    if (err.removalRequestUrl) out.removalRequestUrl = err.removalRequestUrl;
    return out;
  }
  return { code: 'unknown', message: (err && err.message) || String(err) };
}

/** Classify a thrown fetch error (Node undici or Electron net.fetch). */
function networkErrorFrom(err) {
  if (err instanceof PublishError) return err;
  const detail = [err && err.message, err && err.cause && (err.cause.code || err.cause.message)]
    .filter(Boolean).join(' / ');
  if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return new PublishError('network', MESSAGES.timeout, { detail });
  }
  return new PublishError('network', MESSAGES.network, { detail });
}

function createPublishService(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const storageDir = options.storageDir;
  const safeStorage = options.safeStorage || null;
  const openExternal = options.openExternal || (async () => {});
  const now = options.now || (() => Date.now());
  const randomState = options.randomState || (() => crypto.randomBytes(24).toString('hex'));
  const onChange = options.onChange || (() => {});
  const log = options.log || console;
  const requestTimeoutMs = options.requestTimeoutMs || REQUEST_TIMEOUT_MS;
  const baseUrl = String(options.baseUrl || process.env.OMR_PUBLISH_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const baseHost = (() => { try { return new URL(baseUrl).host; } catch { return 'globalbr.ai'; } })();

  // ── Secure storage helpers ──
  function secureStorageAvailable() {
    try {
      return !!(safeStorage && safeStorage.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  function encrypt(text) {
    return safeStorage.encryptString(text).toString('base64');
  }

  function decrypt(b64) {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'));
  }

  function writePrivateFile(fileName, data) {
    if (!storageDir) return;
    fs.mkdirSync(storageDir, { recursive: true });
    const target = path.join(storageDir, fileName);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    fs.renameSync(tmp, target);
    try { fs.chmodSync(target, 0o600); } catch {}
  }

  function removePrivateFile(fileName) {
    if (!storageDir) return;
    try { fs.unlinkSync(path.join(storageDir, fileName)); } catch {}
  }

  // ── State ──
  let auth = null; // { user: {id,email,name}, accessToken, refreshToken }
  let pendingSignIn = null; // { state, expiresAt }
  let signInError = null;
  // Persisted records (absolute file paths). deleteToken kept decrypted in memory.
  const records = new Map();
  // Records for untitled/unsaved tabs, never persisted.
  const memoryRecords = new Map();

  function loadState() {
    if (!storageDir) return;
    const canDecrypt = secureStorageAvailable();
    try {
      const authPath = path.join(storageDir, AUTH_FILE);
      if (canDecrypt && fs.existsSync(authPath)) {
        const parsed = JSON.parse(decrypt(fs.readFileSync(authPath, 'utf8')));
        if (parsed && parsed.accessToken && parsed.user) auth = parsed;
      }
    } catch (err) {
      log.warn('[publish] Could not load saved sign-in:', err.message);
    }
    try {
      const recordsPath = path.join(storageDir, RECORDS_FILE);
      if (fs.existsSync(recordsPath)) {
        const parsed = JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
        for (const [key, rec] of Object.entries(parsed.records || {})) {
          const restored = { ...rec };
          delete restored.deleteTokenEnc;
          if (rec.deleteTokenEnc && canDecrypt) {
            try {
              restored.deleteToken = decrypt(rec.deleteTokenEnc);
            } catch {}
          }
          records.set(key, restored);
        }
      }
    } catch (err) {
      log.warn('[publish] Could not load publish records:', err.message);
    }
  }

  function saveAuth() {
    if (!auth) {
      removePrivateFile(AUTH_FILE);
      return;
    }
    if (!secureStorageAvailable()) return; // memory only
    try {
      writePrivateFile(AUTH_FILE, encrypt(JSON.stringify(auth)));
    } catch (err) {
      log.warn('[publish] Could not save sign-in:', err.message);
    }
  }

  function saveRecords() {
    const canEncrypt = secureStorageAvailable();
    const out = {};
    for (const [key, rec] of records) {
      const stored = { ...rec };
      delete stored.deleteToken;
      // Without safeStorage, the delete token is kept in memory only.
      if (rec.deleteToken && canEncrypt) stored.deleteTokenEnc = encrypt(rec.deleteToken);
      out[key] = stored;
    }
    try {
      writePrivateFile(RECORDS_FILE, JSON.stringify({ version: 1, records: out }, null, 2));
    } catch (err) {
      log.warn('[publish] Could not save publish records:', err.message);
    }
  }

  function isPersistableKey(key) {
    return typeof key === 'string' && path.isAbsolute(key);
  }

  function getRecord(key) {
    if (!key) return null;
    return records.get(key) || memoryRecords.get(key) || null;
  }

  function setRecord(key, rec) {
    if (isPersistableKey(key)) {
      records.set(key, rec);
      saveRecords();
    } else {
      memoryRecords.set(key, rec);
    }
  }

  function deleteRecord(key) {
    if (records.delete(key)) saveRecords();
    memoryRecords.delete(key);
  }

  function emitChange(docKey = null) {
    try { onChange({ docKey }); } catch {}
  }

  // ── HTTP ──
  async function request(method, urlPath, { body, headers = {} } = {}) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), requestTimeoutMs) : null;
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${urlPath}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: 'manual',
        signal: controller ? controller.signal : undefined
      });
    } catch (err) {
      throw networkErrorFrom(err);
    } finally {
      if (timer) clearTimeout(timer);
    }

    // An API call should never redirect. A redirect (or an opaque manual
    // redirect, status 0) means something on the network intercepted it.
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      throw new PublishError('network', MESSAGES.intercepted, {
        detail: `HTTP ${res.status}${res.headers && res.headers.get ? ` → ${res.headers.get('location') || ''}` : ''}`
      });
    }

    let text = '';
    try { text = await res.text(); } catch {}
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    // A non-JSON 2xx body (e.g. a filter's HTML block page) is not our server.
    if (res.ok && text && data === null) {
      throw new PublishError('network', MESSAGES.intercepted, { detail: `HTTP ${res.status} non-JSON response` });
    }

    return { status: res.status, ok: res.ok, data: data || {}, nonJson: !!text && data === null };
  }

  /** Map a non-2xx API response to a PublishError. */
  function serverError(res, fallbackAction) {
    const serverMsg = res.data && (res.data.error || res.data.message);
    // Our API answers errors with JSON. A non-JSON 4xx (other than 404) is
    // almost always a block page from a network filter or captive portal.
    if (res.nonJson && res.status < 500 && res.status !== 404) {
      return new PublishError('network', MESSAGES.intercepted, { status: res.status, detail: `HTTP ${res.status} non-JSON response` });
    }
    if (res.status === 503 && /storage/i.test(serverMsg || '')) {
      return new PublishError('storage-not-configured', MESSAGES.storage, { status: res.status, detail: serverMsg });
    }
    if (res.status >= 500) {
      return new PublishError('server', `${baseHost} had a server error (HTTP ${res.status}) while ${fallbackAction}. Try again in a bit.`, {
        status: res.status,
        detail: serverMsg
      });
    }
    return new PublishError('server', `${baseHost} couldn't complete ${fallbackAction}: ${serverMsg || `HTTP ${res.status}`}`, {
      status: res.status,
      detail: serverMsg
    });
  }

  function absoluteUrl(maybePath) {
    if (!maybePath) return null;
    if (/^https?:\/\//i.test(maybePath)) return maybePath;
    return `${baseUrl}${maybePath.startsWith('/') ? '' : '/'}${maybePath}`;
  }

  function shareUrlFrom(data) {
    return data.shareUrl || absoluteUrl(data.url) || (data.slug ? `${baseUrl}/f/${data.slug}` : null);
  }

  // ── Auth ──

  /**
   * Refresh the access token. Isolated so the request/response shape is easy
   * to adjust: POST /api/auth/refresh {refreshToken} → {accessToken, refreshToken?}.
   * Returns true on success; clears auth and returns false if the server
   * rejected the refresh token. Network errors propagate (stay signed in).
   */
  async function refreshAccessToken() {
    if (!auth || !auth.refreshToken) return false;
    const res = await request('POST', '/api/auth/refresh', { body: { refreshToken: auth.refreshToken } });
    if (res.ok && res.data.accessToken) {
      auth = {
        ...auth,
        accessToken: res.data.accessToken,
        refreshToken: res.data.refreshToken || auth.refreshToken
      };
      saveAuth();
      return true;
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      auth = null;
      saveAuth();
      signInError = MESSAGES.authExpired;
      emitChange();
      return false;
    }
    throw serverError(res, 'refreshing your sign-in');
  }

  async function authedRequest(method, urlPath, opts = {}) {
    if (!auth) throw new PublishError('auth-required', MESSAGES.authRequired);
    const send = () => request(method, urlPath, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${auth.accessToken}` }
    });
    let res = await send();
    if (res.status === 401) {
      const refreshed = await refreshAccessToken();
      if (!refreshed) throw new PublishError('auth-expired', MESSAGES.authExpired, { status: 401 });
      res = await send();
      if (res.status === 401) {
        auth = null;
        saveAuth();
        emitChange();
        throw new PublishError('auth-expired', MESSAGES.authExpired, { status: 401 });
      }
    }
    return res;
  }

  function buildAuthorizeUrl(state) {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      state
    });
    return `${baseUrl}/api/auth/authorize?${params.toString()}`;
  }

  /** Start sign-in: open the system browser at the Noos authorize page. */
  async function signIn() {
    const state = randomState();
    pendingSignIn = { state, expiresAt: now() + SIGN_IN_TTL_MS };
    signInError = null;
    const url = buildAuthorizeUrl(state);
    await openExternal(url);
    emitChange();
    return { started: true, authorizeUrl: url };
  }

  function cancelSignIn() {
    pendingSignIn = null;
    emitChange();
    return { cancelled: true };
  }

  function isAuthCallbackUrl(rawUrl) {
    return typeof rawUrl === 'string' && rawUrl.toLowerCase().startsWith(`${PROTOCOL}://`);
  }

  /**
   * Handle openmarkdownreader://auth/callback?code=…&state=…
   * Verifies the single pending state (short expiry, single use), then
   * exchanges the code for tokens.
   */
  async function handleAuthCallback(rawUrl) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new PublishError('auth-invalid', 'Ignored an invalid sign-in link.');
    }
    if (parsed.protocol !== `${PROTOCOL}:` || parsed.host !== 'auth' || parsed.pathname.replace(/\/+$/, '') !== '/callback') {
      throw new PublishError('auth-invalid', 'Ignored an unrecognized openmarkdownreader:// link.');
    }

    const state = parsed.searchParams.get('state');
    const code = parsed.searchParams.get('code');
    const oauthError = parsed.searchParams.get('error');
    const pending = pendingSignIn;

    const fail = (codeName, message) => {
      signInError = message;
      emitChange();
      return new PublishError(codeName, message);
    };

    if (!pending || !state || state !== pending.state) {
      // Leave a genuine pending sign-in in place: a stray/forged link must not cancel it.
      throw fail('auth-state-mismatch', 'Sign-in could not be verified (it may have been started from another window or expired). Please try again.');
    }
    pendingSignIn = null; // single use
    if (now() > pending.expiresAt) {
      throw fail('auth-expired-request', 'Sign-in took too long and expired. Please try again.');
    }
    if (oauthError) {
      throw fail('auth-denied', `Sign-in was not completed (${oauthError}).`);
    }
    if (!code) {
      throw fail('auth-invalid', 'Sign-in link was missing its code. Please try again.');
    }

    let res;
    try {
      res = await request('POST', '/api/auth/sso-exchange', { body: { code } });
    } catch (err) {
      signInError = err.message;
      emitChange();
      throw err;
    }
    if (!res.ok || !res.data.accessToken || !res.data.user) {
      const err = res.ok ? new PublishError('server', `${baseHost} returned an incomplete sign-in response.`) : serverError(res, 'signing in');
      throw fail(err.code, err.message);
    }
    auth = {
      user: {
        id: res.data.user.id,
        email: res.data.user.email || null,
        name: res.data.user.name || null
      },
      accessToken: res.data.accessToken,
      refreshToken: res.data.refreshToken || null
    };
    signInError = null;
    saveAuth();
    emitChange();
    return { signedIn: true, user: { ...auth.user } };
  }

  async function signOut() {
    const previous = auth;
    auth = null;
    pendingSignIn = null;
    signInError = null;
    saveAuth();
    emitChange();
    // Best-effort server-side revoke; user explicitly asked, so network is OK.
    if (previous && previous.refreshToken) {
      try {
        await request('POST', '/api/auth/logout', {
          body: { refreshToken: previous.refreshToken },
          headers: { Authorization: `Bearer ${previous.accessToken}` }
        });
      } catch {}
    }
    return { signedIn: false };
  }

  // ── Status ──
  function publicRecord(rec) {
    if (!rec) return null;
    const ownedByCurrentUser = rec.mode === 'account' && !!auth && auth.user.id === rec.accountUserId;
    return {
      fileId: rec.fileId,
      slug: rec.slug || null,
      url: rec.url,
      mode: rec.mode,
      accountUserId: rec.accountUserId || null,
      accountEmail: rec.accountEmail || null,
      publishedAt: rec.publishedAt,
      updatedAt: rec.updatedAt || null,
      removalRequestUrl: rec.removalRequestUrl || null,
      canUpdate: ownedByCurrentUser,
      canUnpublish: rec.mode === 'account' ? ownedByCurrentUser : !!rec.deleteToken,
      needsSignIn: rec.mode === 'account' && !ownedByCurrentUser
    };
  }

  function getStatus(docKey) {
    const secure = secureStorageAvailable();
    return {
      baseUrl,
      signedIn: !!auth,
      user: auth ? { ...auth.user } : null,
      signInPending: !!(pendingSignIn && now() <= pendingSignIn.expiresAt),
      signInError,
      secureStorage: secure,
      secureStorageNote: secure ? null : 'Secure storage is unavailable, so sign-in and removal keys are kept in memory only and will be lost when the app quits.',
      record: docKey ? publicRecord(getRecord(docKey)) : null
    };
  }

  function requireContent(content) {
    if (typeof content !== 'string' || content.length === 0) {
      throw new PublishError('bad-request', MESSAGES.emptyContent);
    }
  }

  // ── Publish operations ──
  async function publishAnonymous({ docKey, content, fileName }) {
    requireContent(content);
    const res = await request('POST', '/api/files/anonymous', {
      body: { content, fileName: fileName || 'untitled.md', contentType: 'text/markdown' }
    });
    if (!res.ok) throw serverError(res, 'publishing');
    const url = shareUrlFrom(res.data);
    if (!res.data.id || !url) throw new PublishError('server', `${baseHost} returned an incomplete publish response.`);
    const rec = {
      fileId: res.data.id,
      slug: res.data.slug || null,
      url,
      mode: 'anonymous',
      deleteToken: res.data.deleteToken || null,
      removalRequestUrl: absoluteUrl(res.data.removalRequestUrl) || null,
      publishedAt: new Date(now()).toISOString()
    };
    if (docKey) setRecord(docKey, rec);
    emitChange(docKey);
    return { record: publicRecord(rec) };
  }

  async function publishOwned({ docKey, content, fileName }) {
    requireContent(content);
    const res = await authedRequest('POST', '/api/files/create', {
      body: { content, fileName: fileName || 'untitled.md', contentType: 'text/markdown', visibility: 'unlisted' }
    });
    if (!res.ok) throw serverError(res, 'publishing');
    const url = shareUrlFrom(res.data);
    if (!res.data.id || !url) throw new PublishError('server', `${baseHost} returned an incomplete publish response.`);
    const rec = {
      fileId: res.data.id,
      slug: res.data.slug || null,
      url,
      mode: 'account',
      accountUserId: auth.user.id,
      accountEmail: auth.user.email || null,
      publishedAt: new Date(now()).toISOString()
    };
    if (docKey) setRecord(docKey, rec);
    emitChange(docKey);
    return { record: publicRecord(rec) };
  }

  function requireOwnedRecord(docKey) {
    const rec = getRecord(docKey);
    if (!rec) throw new PublishError('not-published', MESSAGES.notPublished);
    if (rec.mode === 'account') {
      if (!auth) throw new PublishError('auth-required', MESSAGES.wrongAccount);
      if (auth.user.id !== rec.accountUserId) throw new PublishError('wrong-account', MESSAGES.wrongAccount);
    }
    return rec;
  }

  async function updatePublished({ docKey, content }) {
    requireContent(content);
    const rec = requireOwnedRecord(docKey);
    if (rec.mode !== 'account') {
      throw new PublishError('bad-request', 'Anonymous links cannot be updated. Unpublish and publish again, or sign in with an Ideaflow ID.');
    }
    const res = await authedRequest('PUT', `/api/files/${encodeURIComponent(rec.fileId)}/content`, {
      body: { content, contentType: 'text/markdown' }
    });
    if (res.status === 404) {
      deleteRecord(docKey);
      emitChange(docKey);
      throw new PublishError('not-published', 'This page no longer exists on globalbr.ai (it may have been removed). Publish again to create a new link.', { status: 404 });
    }
    if (!res.ok) throw serverError(res, 'updating');
    const updated = { ...rec, updatedAt: new Date(now()).toISOString() };
    setRecord(docKey, updated);
    emitChange(docKey);
    return { record: publicRecord(updated) };
  }

  async function unpublish({ docKey }) {
    const rec = requireOwnedRecord(docKey);
    let res;
    if (rec.mode === 'account') {
      res = await authedRequest('DELETE', `/api/files/${encodeURIComponent(rec.fileId)}`);
    } else {
      if (!rec.deleteToken) {
        throw new PublishError('no-delete-token', MESSAGES.noDeleteToken, { removalRequestUrl: rec.removalRequestUrl || rec.url });
      }
      res = await request('DELETE', `/api/files/anonymous/${encodeURIComponent(rec.fileId)}`, {
        headers: { 'X-Delete-Token': rec.deleteToken }
      });
      if (res.status === 403) {
        throw new PublishError('forbidden', MESSAGES.deleteForbidden, { status: 403, removalRequestUrl: rec.removalRequestUrl || rec.url });
      }
    }
    if (!res.ok && res.status !== 404) throw serverError(res, 'unpublishing');
    deleteRecord(docKey);
    emitChange(docKey);
    return { unpublished: true, alreadyGone: res.status === 404, url: rec.url };
  }

  /** Keep a record attached to a file after it is renamed or moved. */
  function moveRecord(oldKey, newKey) {
    if (!oldKey || !newKey || oldKey === newKey) return false;
    const rec = getRecord(oldKey);
    if (!rec) return false;
    deleteRecord(oldKey);
    setRecord(newKey, rec);
    emitChange(newKey);
    return true;
  }

  loadState();

  return {
    baseUrl,
    redirectUri: REDIRECT_URI,
    protocol: PROTOCOL,
    getStatus,
    signIn,
    cancelSignIn,
    signOut,
    isAuthCallbackUrl,
    handleAuthCallback,
    refreshAccessToken,
    publishAnonymous,
    publishOwned,
    updatePublished,
    unpublish,
    moveRecord,
    // test/debug helpers
    _getRecord: getRecord,
    _getPendingSignIn: () => pendingSignIn
  };
}

module.exports = {
  createPublishService,
  PublishError,
  serializeError,
  MESSAGES,
  PROTOCOL,
  REDIRECT_URI,
  CLIENT_ID,
  DEFAULT_BASE_URL
};
