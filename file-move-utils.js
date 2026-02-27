const fs = require('fs');
const path = require('path');

function moveFileToDirectory(sourcePath, targetDirPath, deps = {}) {
  const fsModule = deps.fsModule || fs;
  const pathModule = deps.pathModule || path;

  if (!sourcePath || !targetDirPath) {
    return { success: false, error: 'Source path and target directory are required' };
  }

  const resolvedSource = pathModule.resolve(sourcePath);
  const resolvedTargetDir = pathModule.resolve(targetDirPath);

  try {
    if (!fsModule.existsSync(resolvedSource)) {
      return { success: false, error: 'Source file does not exist' };
    }

    const sourceStat = fsModule.statSync(resolvedSource);
    if (!sourceStat.isFile()) {
      return { success: false, error: 'Source path is not a file' };
    }

    if (!fsModule.existsSync(resolvedTargetDir)) {
      return { success: false, error: 'Target folder does not exist' };
    }

    const targetStat = fsModule.statSync(resolvedTargetDir);
    if (!targetStat.isDirectory()) {
      return { success: false, error: 'Target path is not a folder' };
    }

    const sourceDir = pathModule.dirname(resolvedSource);
    if (sourceDir === resolvedTargetDir) {
      return { success: false, error: 'File is already in that folder' };
    }

    const fileName = pathModule.basename(resolvedSource);
    const destinationPath = pathModule.join(resolvedTargetDir, fileName);

    if (fsModule.existsSync(destinationPath)) {
      return { success: false, error: 'A file with that name already exists in the destination folder' };
    }

    fsModule.renameSync(resolvedSource, destinationPath);

    return {
      success: true,
      sourcePath: resolvedSource,
      targetDirPath: resolvedTargetDir,
      fileName,
      newPath: destinationPath
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  moveFileToDirectory
};
