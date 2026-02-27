const fs = require('fs');
const path = require('path');

function getFileIdentity(filePath, fsImpl = fs) {
  try {
    const stats = fsImpl.statSync(filePath);
    return {
      dev: stats.dev,
      ino: stats.ino
    };
  } catch {
    return null;
  }
}

function findPathByIdentity(searchRoot, targetIdentity, fsImpl = fs) {
  if (!searchRoot || !targetIdentity) return null;

  const stack = [searchRoot];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    let entries;
    try {
      entries = fsImpl.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const candidatePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(candidatePath);
        continue;
      }
      if (!entry.isFile()) continue;

      try {
        const stats = fsImpl.statSync(candidatePath);
        if (stats.ino === targetIdentity.ino && stats.dev === targetIdentity.dev) {
          return candidatePath;
        }
      } catch {
        // Ignore entries that disappear while scanning.
      }
    }
  }

  return null;
}

function detectFileMove({ oldPath, targetIdentity, searchRoots = [] }, fsImpl = fs) {
  if (!oldPath || !targetIdentity) return null;
  if (fsImpl.existsSync(oldPath)) return oldPath;

  const roots = [];
  for (const root of [...searchRoots, path.dirname(oldPath)]) {
    if (!root) continue;
    if (roots.includes(root)) continue;
    roots.push(root);
  }

  for (const root of roots) {
    const found = findPathByIdentity(root, targetIdentity, fsImpl);
    if (found && found !== oldPath) return found;
  }

  return null;
}

module.exports = {
  getFileIdentity,
  findPathByIdentity,
  detectFileMove
};
