const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  deriveRemoteMarkdownFileName,
  fetchRemoteMarkdown,
  isHttpUrl,
} = require('../remote-markdown-utils');

function withServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test('isHttpUrl accepts only HTTP(S) URLs', () => {
  assert.equal(isHttpUrl('https://example.com/doc.md'), true);
  assert.equal(isHttpUrl('http://example.com/doc.md'), true);
  assert.equal(isHttpUrl('file:///tmp/doc.md'), false);
  assert.equal(isHttpUrl('/tmp/doc.md'), false);
  assert.equal(isHttpUrl('not a url'), false);
});

test('deriveRemoteMarkdownFileName uses URL names and markdown content types', () => {
  assert.equal(deriveRemoteMarkdownFileName('https://example.com/docs/plan.md'), 'plan.md');
  assert.equal(deriveRemoteMarkdownFileName('https://example.com/docs/plan', 'text/markdown'), 'plan.md');
  assert.equal(deriveRemoteMarkdownFileName('https://example.com/'), 'example.com.md');
});

test('fetchRemoteMarkdown loads markdown from an HTTP URL', async () => {
  const server = await withServer((req, res) => {
    assert.equal(req.url, '/note.md');
    res.writeHead(200, { 'content-type': 'text/markdown' });
    res.end('# Remote note\n\nLoaded from a URL.\n');
  });

  try {
    const result = await fetchRemoteMarkdown(`${server.url}/note.md`);
    assert.equal(result.content, '# Remote note\n\nLoaded from a URL.\n');
    assert.equal(result.contentType, 'text/markdown');
    assert.equal(result.finalUrl, `${server.url}/note.md`);
  } finally {
    await server.close();
  }
});

test('fetchRemoteMarkdown follows redirects', async () => {
  const server = await withServer((req, res) => {
    if (req.url === '/start') {
      res.writeHead(302, { location: '/final.md' });
      res.end();
      return;
    }

    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('redirected markdown');
  });

  try {
    const result = await fetchRemoteMarkdown(`${server.url}/start`);
    assert.equal(result.content, 'redirected markdown');
    assert.equal(result.finalUrl, `${server.url}/final.md`);
  } finally {
    await server.close();
  }
});
