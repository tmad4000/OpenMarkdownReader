#!/usr/bin/env node
/**
 * CLI client for the OpenMarkdownReader agent socket.
 * Sends a JSON command and waits for the response.
 *
 * Usage: node cli-client.js '{"command":"list-tabs","args":{}}'
 *   or:  echo '{"command":"help"}' | node cli-client.js
 */

const net = require('net');
const path = require('path');
const os = require('os');

const SOCK_PATH = path.join(
  os.homedir(),
  'Library', 'Application Support', 'OpenMarkdownReader', 'omr.sock'
);

// Get request from argv or stdin
let request;
if (process.argv[2]) {
  request = process.argv[2];
} else {
  // Read from stdin
  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => {
    request = Buffer.concat(chunks).toString().trim();
    sendRequest(request);
  });
  // If stdin has data, wait for it
  if (!process.stdin.isTTY) {
    // Will be handled by 'end' event above
  } else {
    console.error('Usage: cli-client.js \'{"command":"help"}\'');
    process.exit(1);
  }
  return;
}

sendRequest(request);

function sendRequest(req) {
  // Parse to check for watch command
  let parsed;
  try {
    parsed = JSON.parse(req);
  } catch {
    console.error('Invalid JSON');
    process.exit(1);
  }

  const isWatch = parsed.command === 'watch';
  const socket = net.createConnection(SOCK_PATH);
  let responded = false;

  socket.on('connect', () => {
    socket.write(req + '\n');
  });

  let buffer = '';
  socket.on('data', (data) => {
    if (isWatch) {
      // Stream mode: print each line as it arrives
      process.stdout.write(data.toString());
      return;
    }

    buffer += data.toString();
    const newlineIndex = buffer.indexOf('\n');
    if (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      process.stdout.write(line + '\n');
      responded = true;
      socket.end();
    }
  });

  socket.on('end', () => {
    if (!responded && buffer.trim()) {
      process.stdout.write(buffer.trim() + '\n');
    }
  });

  socket.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error(JSON.stringify({ error: 'App is not running. Start OpenMarkdownReader first.' }));
    } else if (err.code === 'ECONNREFUSED') {
      console.error(JSON.stringify({ error: 'Connection refused. App may be starting up.' }));
    } else {
      console.error(JSON.stringify({ error: err.message }));
    }
    process.exit(1);
  });

  // Timeout for non-watch commands
  if (!isWatch) {
    setTimeout(() => {
      if (!responded) {
        console.error(JSON.stringify({ error: 'Timeout waiting for response' }));
        socket.destroy();
        process.exit(1);
      }
    }, 5000);
  }
}
