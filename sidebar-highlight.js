(function(globalScope) {
  'use strict';

  function normalizePath(inputPath) {
    if (typeof inputPath !== 'string') return '';
    return inputPath.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  }

  function isActiveSidebarFilePath(itemPath, activeFilePath) {
    const normalizedItemPath = normalizePath(itemPath);
    const normalizedActivePath = normalizePath(activeFilePath);
    return !!normalizedItemPath && normalizedItemPath === normalizedActivePath;
  }

  function findActiveTabFilePath(tabs, activeTabId) {
    if (!Array.isArray(tabs)) return '';
    const activeTab = tabs.find((tab) => tab && tab.id === activeTabId);
    return activeTab && typeof activeTab.filePath === 'string' ? activeTab.filePath : '';
  }

  function applyActiveSidebarFileHighlight(fileTreeElement, activeFilePath) {
    if (!fileTreeElement || typeof fileTreeElement.querySelectorAll !== 'function') return;
    const fileItems = fileTreeElement.querySelectorAll('.file-tree-item.file-tree-file[data-path]');
    fileItems.forEach((fileItem) => {
      const itemPath = fileItem && fileItem.dataset ? fileItem.dataset.path : '';
      const isActive = isActiveSidebarFilePath(itemPath, activeFilePath);
      fileItem.classList.toggle('active', isActive);
    });
  }

  const api = {
    normalizePath,
    isActiveSidebarFilePath,
    findActiveTabFilePath,
    applyActiveSidebarFileHighlight
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.SidebarHighlight = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
