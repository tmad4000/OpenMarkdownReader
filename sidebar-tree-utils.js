(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.sidebarTreeUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function findItemByPath(items, targetPath) {
    for (const item of items || []) {
      if (item.path === targetPath) return item;
      if (item.children) {
        const found = findItemByPath(item.children, targetPath);
        if (found) return found;
      }
    }
    return null;
  }

  function detachItemByPath(items, targetPath) {
    if (!Array.isArray(items)) return null;

    const directIndex = items.findIndex(item => item.path === targetPath);
    if (directIndex !== -1) {
      return items.splice(directIndex, 1)[0];
    }

    for (const item of items) {
      if (!item.children) continue;
      const detached = detachItemByPath(item.children, targetPath);
      if (detached) return detached;
    }

    return null;
  }

  function moveFileInTree(items, options) {
    const sourcePath = options && options.sourcePath;
    const targetFolderPath = options && options.targetFolderPath;
    const newPath = options && options.newPath;
    const newName = options && options.newName;

    if (!sourcePath || !targetFolderPath || !newPath || !newName) {
      return { success: false, error: 'Invalid move arguments' };
    }

    const targetFolder = findItemByPath(items, targetFolderPath);
    if (!targetFolder || targetFolder.type !== 'folder') {
      return { success: false, error: 'Target folder not found in tree' };
    }

    const sourceItem = detachItemByPath(items, sourcePath);
    if (!sourceItem) {
      return { success: false, error: 'Source file not found in tree' };
    }

    if (sourceItem.type !== 'file') {
      return { success: false, error: 'Only files can be moved with drag and drop' };
    }

    sourceItem.path = newPath;
    sourceItem.name = newName;

    if (Array.isArray(targetFolder.children)) {
      targetFolder.children.push(sourceItem);
      return { success: true, insertedIntoVisibleFolder: true };
    }

    return { success: true, insertedIntoVisibleFolder: false };
  }

  return {
    findItemByPath,
    detachItemByPath,
    moveFileInTree
  };
});
