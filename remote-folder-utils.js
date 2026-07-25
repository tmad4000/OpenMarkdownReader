'use strict';

const path = require('node:path');

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd']);
const TEXT_EXTENSIONS = new Set([
  ...MARKDOWN_EXTENSIONS,
  'txt', 'text', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'csv',
  'log', 'rst', 'org', 'adoc', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'css', 'scss', 'less', 'html', 'htm', 'sh', 'bash', 'zsh', 'fish',
  'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'swift',
  'sql', 'graphql', 'ini', 'conf', 'env'
]);

function normalizeRemoteUrl(input) {
  const parsed = new URL(String(input || '').trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are supported');
  }
  parsed.hash = '';
  return parsed;
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function stripTags(value) {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]*>/g, '')).trim();
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function remoteDirectoryName(remoteUrl) {
  const parsed = normalizeRemoteUrl(remoteUrl);
  const segments = parsed.pathname.split('/').filter(Boolean);
  return safeDecodeURIComponent(segments.at(-1) || parsed.hostname);
}

function classifyRemoteEntry(name, typeHint = '') {
  const normalizedType = String(typeHint || '').toLowerCase();
  const ext = path.posix.extname(String(name || '')).toLowerCase().slice(1);
  const isFolder = normalizedType === 'folder' || normalizedType === 'directory';
  return {
    type: isFolder ? 'folder' : 'file',
    isMarkdown: !isFolder && MARKDOWN_EXTENSIONS.has(ext),
    isTextFile: !isFolder && TEXT_EXTENSIONS.has(ext)
  };
}

function normalizeMtime(value) {
  if (value == null || value === '') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildRemoteEntry(rawEntry, baseUrl, options = {}) {
  const raw = typeof rawEntry === 'string' ? { href: rawEntry } : (rawEntry || {});
  const href = raw.url || raw.href || raw.path;
  if (!href || typeof href !== 'string') return null;

  let resolved;
  try {
    resolved = normalizeRemoteUrl(new URL(href, baseUrl).toString());
  } catch {
    return null;
  }

  const base = normalizeRemoteUrl(baseUrl);
  const enforceChild = options.enforceChild !== false;
  if (enforceChild) {
    const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
    if (resolved.origin !== base.origin || !resolved.pathname.startsWith(basePath)) {
      return null;
    }

    const relative = resolved.pathname.slice(basePath.length);
    if (!relative) return null;
    const withoutTrailingSlash = relative.replace(/\/+$/, '');
    if (!withoutTrailingSlash || withoutTrailingSlash.includes('/')) return null;
  }

  if (
    resolved.pathname === base.pathname &&
    (resolved.search || resolved.hash)
  ) {
    return null;
  }

  resolved.hash = '';
  const trailingSlash = resolved.pathname.endsWith('/');
  const typeHint = raw.type || (trailingSlash ? 'folder' : 'file');
  const pathname = resolved.pathname.replace(/\/+$/, '');
  const pathName = safeDecodeURIComponent(path.posix.basename(pathname));
  const suppliedName = stripTags(raw.name || raw.label || '').replace(/\/+$/, '');
  const name = suppliedName || pathName;
  if (!name || name === '..' || name === '.' || name.startsWith('.')) return null;

  const classification = classifyRemoteEntry(name, typeHint);
  if (classification.type === 'folder' && !resolved.pathname.endsWith('/')) {
    resolved.pathname = `${resolved.pathname}/`;
  }

  const entry = {
    name,
    path: resolved.toString(),
    url: resolved.toString(),
    isRemote: true,
    ...classification,
    mtime: normalizeMtime(raw.mtime || raw.modified || raw.lastModified)
  };

  if (classification.type === 'folder' && Array.isArray(raw.children)) {
    entry.children = raw.children
      .map(child => buildRemoteEntry(child, entry.url, { enforceChild: false }))
      .filter(Boolean);
    entry.isEmpty = entry.children.length === 0;
  }

  return entry;
}

function parseHtmlDirectoryListing(html, sourceUrl) {
  const entries = [];
  const seen = new Set();
  const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(String(html || ''))) !== null) {
    const href = decodeHtmlEntities(match[1] || match[2] || match[3] || '');
    if (!href || href.startsWith('#') || href.startsWith('?')) continue;
    const entry = buildRemoteEntry({
      href,
      name: stripTags(match[4])
    }, sourceUrl, { enforceChild: true });
    if (!entry || seen.has(entry.url)) continue;
    seen.add(entry.url);
    entries.push(entry);
  }

  return entries;
}

function parseJsonDirectoryListing(body, sourceUrl) {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error('Remote folder returned invalid JSON');
  }

  const rawEntries = Array.isArray(payload) ? payload : payload.entries;
  if (!Array.isArray(rawEntries)) {
    throw new Error('Remote folder JSON must be an array or contain an entries array');
  }

  return {
    name: !Array.isArray(payload) && payload.name ? String(payload.name) : null,
    entries: rawEntries
      .map(entry => buildRemoteEntry(entry, sourceUrl, { enforceChild: false }))
      .filter(Boolean)
  };
}

function parseRemoteDirectoryListing({ body, contentType = '', sourceUrl }) {
  const mime = String(contentType).split(';')[0].trim().toLowerCase();
  const trimmed = String(body || '').trim();
  let entries;
  let name = null;
  let format;

  if (mime === 'application/json' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = parseJsonDirectoryListing(trimmed, sourceUrl);
    entries = parsed.entries;
    name = parsed.name;
    format = 'json';
  } else {
    entries = parseHtmlDirectoryListing(trimmed, sourceUrl);
    format = 'html';
  }

  if (!entries.length && trimmed) {
    throw new Error('No browseable files or folders were found at this URL');
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const normalizedSource = normalizeRemoteUrl(sourceUrl).toString();
  return {
    name: name || remoteDirectoryName(normalizedSource),
    sourceUrl: normalizedSource,
    format,
    entries
  };
}

module.exports = {
  buildRemoteEntry,
  classifyRemoteEntry,
  decodeHtmlEntities,
  normalizeRemoteUrl,
  parseHtmlDirectoryListing,
  parseJsonDirectoryListing,
  parseRemoteDirectoryListing,
  remoteDirectoryName
};
