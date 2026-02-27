const fs = require('fs');
const path = require('path');

function normalizeNameForComparison(name) {
  return String(name || '').trim().toLowerCase();
}

function findNameCollisionInDirectory(dirPath, candidateName) {
  const target = normalizeNameForComparison(candidateName);
  if (!target) return null;

  let entries = [];
  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (normalizeNameForComparison(entry) === target) {
      return entry;
    }
  }
  return null;
}

function resolveSidebarCreateTargetDirectory(currentDirectory, selectedFolderPath) {
  if (!currentDirectory) return null;
  if (!selectedFolderPath) return currentDirectory;

  const normalizedCurrent = path.resolve(currentDirectory);
  const normalizedSelected = path.resolve(selectedFolderPath);

  if (
    normalizedSelected === normalizedCurrent ||
    normalizedSelected.startsWith(normalizedCurrent + path.sep)
  ) {
    return normalizedSelected;
  }

  return normalizedCurrent;
}

module.exports = {
  normalizeNameForComparison,
  findNameCollisionInDirectory,
  resolveSidebarCreateTargetDirectory
};
