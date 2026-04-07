const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pkg = require('../package.json');
const buildInfoPath = path.join(__dirname, '..', 'build-info.json');

let gitHash = 'dev';
let gitCount = 0;
try {
  gitHash = execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..') }).toString().trim();
  gitCount = parseInt(execSync('git rev-list --count HEAD', { cwd: path.join(__dirname, '..') }).toString().trim(), 10) || 0;
} catch {
  // Not a git repo or git not available
}

// Read existing build number to enforce monotonic increment.
// This way two builds of the same commit get different build numbers
// (the second one increments past the first).
let previousBuildNumber = 0;
try {
  const existing = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
  previousBuildNumber = parseInt(existing.buildNumber, 10) || 0;
} catch {
  // No existing build-info.json — start fresh from gitCount
}

// New build number = max(gitCount, previous+1). Always increases.
const buildNumber = Math.max(gitCount, previousBuildNumber + 1);

const buildInfo = {
  version: pkg.version,
  buildNumber,
  gitHash,
  buildDate: new Date().toISOString()
};

fs.writeFileSync(buildInfoPath, JSON.stringify(buildInfo, null, 2) + '\n');

console.log(`Build info: v${buildInfo.version} (Build ${buildInfo.buildNumber}, ${gitHash})`);
