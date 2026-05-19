const http = require('http');
const https = require('https');
const path = require('path');

const MAX_REMOTE_MARKDOWN_BYTES = 2_000_000;

function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function deriveRemoteMarkdownFileName(url, contentType = '') {
  try {
    const parsed = new URL(url);
    const baseName = decodeURIComponent(path.posix.basename(parsed.pathname || '') || '').trim();
    if (baseName) {
      if (/\.(md|markdown|mdown|mkd|txt|text)$/i.test(baseName)) return baseName;
      if (/markdown|plain|text/i.test(contentType)) return `${baseName}.md`;
      return baseName;
    }
    return `${parsed.hostname || 'remote-markdown'}.md`;
  } catch {
    return 'remote-markdown.md';
  }
}

function fetchRemoteMarkdown(url, redirectCount = 0) {
  if (!isHttpUrl(url)) {
    return Promise.reject(new Error('Only http:// and https:// Markdown URLs can be opened'));
  }
  if (redirectCount > 5) {
    return Promise.reject(new Error('Too many redirects while loading Markdown URL'));
  }

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.get(parsed, {
      headers: {
        Accept: 'text/markdown,text/plain,text/*,*/*;q=0.8',
        'User-Agent': 'OpenMarkdownReader',
      },
    }, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;
      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        const nextUrl = new URL(location, parsed).toString();
        fetchRemoteMarkdown(nextUrl, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`Markdown URL returned HTTP ${statusCode}`));
        return;
      }

      let totalBytes = 0;
      const chunks = [];
      response.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_REMOTE_MARKDOWN_BYTES) {
          request.destroy(new Error('Remote Markdown file is too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const contentType = String(response.headers['content-type'] || '');
        resolve({
          content: Buffer.concat(chunks).toString('utf8'),
          contentType,
          finalUrl: url,
        });
      });
    });

    request.setTimeout(15_000, () => {
      request.destroy(new Error('Timed out loading Markdown URL'));
    });
    request.on('error', reject);
  });
}

module.exports = {
  MAX_REMOTE_MARKDOWN_BYTES,
  deriveRemoteMarkdownFileName,
  fetchRemoteMarkdown,
  isHttpUrl,
};
