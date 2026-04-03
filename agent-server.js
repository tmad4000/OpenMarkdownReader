/**
 * Agent Control Server — Unix domain socket for programmatic control
 *
 * Allows external tools (CLI, AI agents, scripts) to query and control
 * the running OpenMarkdownReader instance.
 *
 * Socket: ~/Library/Application Support/OpenMarkdownReader/omr.sock
 * Protocol: newline-delimited JSON request/response
 */

const net = require('net');
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

let server = null;
let socketPath = null;

// Command handlers registered by main.js
const commandHandlers = {};

function getSocketPath() {
  return path.join(app.getPath('userData'), 'omr.sock');
}

/**
 * Register a command handler
 * @param {string} name - Command name (e.g., 'list-tabs')
 * @param {function} handler - Async function(args) => result
 */
function registerCommand(name, handler) {
  commandHandlers[name] = handler;
}

/**
 * Handle a single JSON command from a client
 */
async function handleCommand(request) {
  const { command, args } = request;

  if (!command) {
    return { error: 'Missing "command" field' };
  }

  if (command === 'help') {
    return {
      commands: Object.keys(commandHandlers).sort(),
      version: app.getVersion(),
      pid: process.pid
    };
  }

  const handler = commandHandlers[command];
  if (!handler) {
    return { error: `Unknown command: ${command}`, available: Object.keys(commandHandlers).sort() };
  }

  try {
    const result = await handler(args || {});
    return { ok: true, ...result };
  } catch (err) {
    return { error: err.message, stack: err.stack };
  }
}

/**
 * Handle an incoming socket connection
 */
function handleConnection(socket) {
  let buffer = '';

  socket.on('data', async (data) => {
    buffer += data.toString();

    // Process complete lines (newline-delimited JSON)
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (!line) continue;

      let request;
      try {
        request = JSON.parse(line);
      } catch {
        socket.write(JSON.stringify({ error: 'Invalid JSON' }) + '\n');
        continue;
      }

      // Handle watch/subscribe mode
      if (request.command === 'watch') {
        handleWatch(socket, request.args || {});
        continue;
      }

      const response = await handleCommand(request);
      try {
        socket.write(JSON.stringify(response) + '\n');
      } catch {
        // Client disconnected
      }
    }
  });

  socket.on('error', () => {
    // Client disconnected, remove from watchers
    removeWatcher(socket);
  });

  socket.on('close', () => {
    removeWatcher(socket);
  });
}

// Event watchers (for `omr --cmd watch`)
const watchers = new Set();

function handleWatch(socket, args) {
  const watcher = { socket, filters: args.events || null };
  watchers.add(watcher);
  socket.write(JSON.stringify({ ok: true, watching: true }) + '\n');
}

function removeWatcher(socket) {
  for (const w of watchers) {
    if (w.socket === socket) {
      watchers.delete(w);
      break;
    }
  }
}

/**
 * Emit an event to all watchers
 * @param {string} event - Event name
 * @param {object} data - Event data
 */
function emitEvent(event, data = {}) {
  const message = JSON.stringify({ event, ...data, timestamp: Date.now() }) + '\n';
  for (const watcher of watchers) {
    if (watcher.filters && !watcher.filters.includes(event)) continue;
    try {
      watcher.socket.write(message);
    } catch {
      watchers.delete(watcher);
    }
  }
}

/**
 * Start the agent server
 */
function startServer() {
  socketPath = getSocketPath();

  // Clean up stale socket
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // Doesn't exist, that's fine
  }

  server = net.createServer(handleConnection);

  server.on('error', (err) => {
    console.error('[Agent Server] Error:', err.message);
  });

  server.listen(socketPath, () => {
    console.log(`[Agent Server] Listening on ${socketPath}`);
    // Make socket accessible
    try {
      fs.chmodSync(socketPath, 0o600);
    } catch {}
  });
}

/**
 * Stop the agent server
 */
function stopServer() {
  if (server) {
    server.close();
    server = null;
  }
  if (socketPath) {
    try {
      fs.unlinkSync(socketPath);
    } catch {}
    socketPath = null;
  }
  watchers.clear();
}

module.exports = {
  startServer,
  stopServer,
  registerCommand,
  emitEvent,
  getSocketPath
};
