const fs = require('fs');

function resolveFinderAction(targetPath, deps = {}) {
  const existsSync = deps.existsSync || fs.existsSync;
  const statSync = deps.statSync || fs.statSync;

  if (!targetPath || !existsSync(targetPath)) return 'none';

  try {
    return statSync(targetPath).isDirectory() ? 'open' : 'reveal';
  } catch {
    return 'none';
  }
}

async function openInFinder(targetPath, deps = {}) {
  const shell = deps.shell;
  if (!shell) throw new Error('shell dependency is required');

  const action = resolveFinderAction(targetPath, deps);
  if (action === 'none') return false;

  if (action === 'open') {
    const error = await shell.openPath(targetPath);
    return !error;
  }

  shell.showItemInFolder(targetPath);
  return true;
}

module.exports = {
  resolveFinderAction,
  openInFinder
};
