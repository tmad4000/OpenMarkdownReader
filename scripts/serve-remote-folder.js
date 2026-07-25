#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const MAX_WRITE_BYTES = 15 * 1024 * 1024;
const TEXT_TYPES = new Map([
  ['.md', 'text/markdown; charset=utf-8'],
  ['.markdown', 'text/markdown; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.jsonl', 'application/json; charset=utf-8'],
  ['.yaml', 'application/yaml; charset=utf-8'],
  ['.yml', 'application/yaml; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8']
]);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function etagForBuffer(buffer) {
  return `"${crypto.createHash('sha256').update(buffer).digest('base64url')}"`;
}

function parseRequestPath(requestUrl) {
  const parsed = new URL(requestUrl, 'http://localhost');
  return decodeURIComponent(parsed.pathname);
}

function safeExistingPath(root, requestPath) {
  const candidate = path.resolve(root, `.${requestPath}`);
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw Object.assign(new Error('Path escapes shared folder'), { statusCode: 403 });
  }
  const real = fs.realpathSync(candidate);
  const realRelative = path.relative(root, real);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw Object.assign(new Error('Symlink escapes shared folder'), { statusCode: 403 });
  }
  return real;
}

function visibleDirectoryEntries(directoryPath, requestPath, writable) {
  return fs.readdirSync(directoryPath, { withFileTypes: true })
    .filter(entry => !entry.name.startsWith('.'))
    .map(entry => {
      const isFolder = entry.isDirectory();
      const encodedName = encodeURIComponent(entry.name);
      const base = requestPath.endsWith('/') ? requestPath : `${requestPath}/`;
      return {
        name: entry.name,
        type: isFolder ? 'folder' : 'file',
        path: `${base}${encodedName}${isFolder ? '/' : ''}`,
        writable
      };
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    ...extraHeaders
  });
  res.end(body);
}

function sendDirectory(req, res, directoryPath, requestPath, writable) {
  const entries = visibleDirectoryEntries(directoryPath, requestPath, writable);
  const headers = {
    'Allow': writable ? 'GET, HEAD, OPTIONS, PUT' : 'GET, HEAD, OPTIONS',
    'X-OpenMarkdownReader-Writable': writable ? 'true' : 'false'
  };

  if (String(req.headers.accept || '').includes('application/json')) {
    sendJson(res, 200, {
      name: path.basename(directoryPath) || path.basename(path.dirname(directoryPath)),
      capabilities: { write: writable },
      entries
    }, headers);
    return;
  }

  const links = entries.map(entry => (
    `<li><a href="${escapeHtml(entry.path)}">${escapeHtml(entry.name)}${entry.type === 'folder' ? '/' : ''}</a></li>`
  )).join('\n');
  const html = Buffer.from(
    '<!doctype html><meta charset="utf-8">' +
    `<title>${escapeHtml(path.basename(directoryPath))}</title>` +
    `<h1>${escapeHtml(path.basename(directoryPath))}</h1><ul>${links}</ul>`
  );
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': html.length,
    ...headers
  });
  res.end(req.method === 'HEAD' ? undefined : html);
}

function sendFile(req, res, filePath, writable) {
  const body = fs.readFileSync(filePath);
  const stats = fs.statSync(filePath);
  const headers = {
    'Content-Type': TEXT_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
    'Content-Length': body.length,
    'ETag': etagForBuffer(body),
    'Last-Modified': stats.mtime.toUTCString(),
    'Allow': writable ? 'GET, HEAD, OPTIONS, PUT' : 'GET, HEAD, OPTIONS',
    'X-OpenMarkdownReader-Writable': writable ? 'true' : 'false'
  };
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function receiveBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > MAX_WRITE_BYTES) {
        reject(Object.assign(new Error('File is larger than 15 MB'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function saveFile(req, res, filePath) {
  const current = fs.readFileSync(filePath);
  const stats = fs.statSync(filePath);
  const currentEtag = etagForBuffer(current);
  const ifMatch = req.headers['if-match'];
  const ifUnmodifiedSince = req.headers['if-unmodified-since'];

  if (ifMatch && ifMatch !== '*' && !String(ifMatch).split(',').map(value => value.trim()).includes(currentEtag)) {
    sendJson(res, 412, { error: 'Remote file changed', etag: currentEtag });
    return;
  }
  if (!ifMatch && ifUnmodifiedSince) {
    const expectedTime = Date.parse(ifUnmodifiedSince);
    if (Number.isFinite(expectedTime) && stats.mtimeMs > expectedTime + 999) {
      sendJson(res, 412, { error: 'Remote file changed', etag: currentEtag });
      return;
    }
  }

  const body = await receiveBody(req);
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.omr-${process.pid}-${Date.now()}.tmp`
  );
  try {
    fs.writeFileSync(tempPath, body, { flag: 'wx' });
    fs.renameSync(tempPath, filePath);
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
  }

  const updatedStats = fs.statSync(filePath);
  res.writeHead(204, {
    'ETag': etagForBuffer(body),
    'Last-Modified': updatedStats.mtime.toUTCString(),
    'Allow': 'GET, HEAD, OPTIONS, PUT',
    'X-OpenMarkdownReader-Writable': 'true'
  });
  res.end();
}

function createRemoteFolderServer(options = {}) {
  const root = fs.realpathSync(path.resolve(options.root || process.cwd()));
  const writable = options.writable !== false;

  return http.createServer(async (req, res) => {
    try {
      const requestPath = parseRequestPath(req.url || '/');
      const targetPath = safeExistingPath(root, requestPath);
      const stats = fs.statSync(targetPath);

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Allow': writable ? 'GET, HEAD, OPTIONS, PUT' : 'GET, HEAD, OPTIONS',
          'X-OpenMarkdownReader-Writable': writable ? 'true' : 'false'
        });
        res.end();
        return;
      }

      if (req.method === 'PUT') {
        if (!writable || !stats.isFile()) {
          res.writeHead(405, { 'Allow': 'GET, HEAD, OPTIONS' });
          res.end();
          return;
        }
        await saveFile(req, res, targetPath);
        return;
      }

      if (!['GET', 'HEAD'].includes(req.method || '')) {
        res.writeHead(405, {
          'Allow': writable ? 'GET, HEAD, OPTIONS, PUT' : 'GET, HEAD, OPTIONS'
        });
        res.end();
        return;
      }

      if (stats.isDirectory()) {
        sendDirectory(req, res, targetPath, requestPath, writable);
      } else if (stats.isFile()) {
        sendFile(req, res, targetPath, writable);
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch (error) {
      const statusCode = error.statusCode || (error.code === 'ENOENT' ? 404 : 500);
      if (!res.headersSent) sendJson(res, statusCode, { error: error.message });
      else res.destroy();
    }
  });
}

function parseCliArgs(argv) {
  const args = [...argv];
  let root = process.cwd();
  let host = '127.0.0.1';
  let port = 8847;
  let writable = true;

  while (args.length) {
    const arg = args.shift();
    if (arg === '--host') host = args.shift();
    else if (arg === '--port') port = Number(args.shift());
    else if (arg === '--read-only') writable = false;
    else if (!arg.startsWith('-')) root = arg;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('Port must be an integer from 0 to 65535');
  }
  return { root, host, port, writable };
}

if (require.main === module) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const server = createRemoteFolderServer(options);
    server.listen(options.port, options.host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      console.log(`OpenMarkdownReader remote folder: http://${options.host}:${port}/`);
      console.log(`Sharing: ${fs.realpathSync(path.resolve(options.root))}`);
      console.log(`Writes: ${options.writable ? 'enabled' : 'read-only'}`);
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  createRemoteFolderServer,
  etagForBuffer,
  parseCliArgs
};
