(function exposeMobileUtils(root, factory) {
  const utils = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = utils;
  }
  root.OpenMarkdownMobileUtils = utils;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const SUPPORTED_EXTENSIONS = new Set([
    'md',
    'markdown',
    'mdown',
    'mkd',
    'mdx',
    'txt',
    'text',
    'json',
    'jsonl',
    'yaml',
    'yml',
    'xml',
    'csv',
    'log'
  ]);

  function normalizeRemoteUrl(value) {
    const trimmed = String(value || '').trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      throw new Error('Enter an http:// or https:// URL');
    }
    return new URL(trimmed).toString();
  }

  function remoteFileName(value) {
    try {
      const parsed = new URL(value);
      const rawName = parsed.pathname.split('/').filter(Boolean).pop();
      return rawName ? decodeURIComponent(rawName) : parsed.hostname;
    } catch {
      return 'remote.md';
    }
  }

  function isSupportedFileName(value) {
    const name = String(value || '');
    const dotIndex = name.lastIndexOf('.');
    if (dotIndex < 0) return false;
    return SUPPORTED_EXTENSIONS.has(name.slice(dotIndex + 1).toLowerCase());
  }

  function isTextLikeContentType(value) {
    const mime = String(value || '').split(';')[0].trim().toLowerCase();
    return !mime
      || mime.startsWith('text/')
      || mime === 'application/json'
      || mime === 'application/xml'
      || mime === 'application/yaml'
      || mime === 'application/x-yaml';
  }

  function decodeBase64Utf8(value) {
    const binary = atob(String(value || ''));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  }

  function encodeBase64Utf8(value) {
    const bytes = new TextEncoder().encode(String(value || ''));
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function resolveRemoteUrl(value, baseUrl) {
    try {
      return new URL(value, baseUrl).toString();
    } catch {
      return value;
    }
  }

  function isMarkdownLikeUrl(value) {
    try {
      return isSupportedFileName(new URL(value).pathname);
    } catch {
      return false;
    }
  }

  return {
    decodeBase64Utf8,
    encodeBase64Utf8,
    isMarkdownLikeUrl,
    isSupportedFileName,
    isTextLikeContentType,
    normalizeRemoteUrl,
    remoteFileName,
    resolveRemoteUrl
  };
});
