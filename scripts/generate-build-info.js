const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pkg = require('../package.json');

let gitHash = 'dev';
let gitCount = '0';
try {
  gitHash = execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..') }).toString().trim();
  gitCount = execSync('git rev-list --count HEAD', { cwd: path.join(__dirname, '..') }).toString().trim();
} catch {
  // Not a git repo or git not available
}

const buildInfo = {
  version: pkg.version,
  buildNumber: parseInt(gitCount, 10),
  gitHash,
  buildDate: new Date().toISOString()
};

fs.writeFileSync(
  path.join(__dirname, '..', 'build-info.json'),
  JSON.stringify(buildInfo, null, 2) + '\n'
);

console.log(`Build info: v${buildInfo.version} (Build ${buildInfo.buildNumber}, ${gitHash})`);
