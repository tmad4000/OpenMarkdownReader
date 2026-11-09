#!/usr/bin/env node
// Bundles milkdown-entry.js -> milkdown-bundle.js (IIFE exposing window.Milkdown).
// The bundle is committed so `npm start` and packaging don't need a build step.
const path = require('path');
require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, '..', 'milkdown-entry.js')],
  outfile: path.join(__dirname, '..', 'milkdown-bundle.js'),
  bundle: true,
  format: 'iife',
  globalName: 'Milkdown',
  platform: 'browser',
  target: 'chrome120',
  minify: true,
  legalComments: 'none',
});
console.log('Built milkdown-bundle.js');
