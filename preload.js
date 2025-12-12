const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  onFileLoaded: (callback) => ipcRenderer.on('file-loaded', (event, data) => callback(data)),
  onNewTab: (callback) => ipcRenderer.on('new-tab', () => callback()),
  onNewFile: (callback) => ipcRenderer.on('new-file', () => callback()),
  onCloseTab: (callback) => ipcRenderer.on('close-tab', () => callback()),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openFileOrFolder: () => ipcRenderer.invoke('open-file-or-folder'),

  // Save operations
  saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
  renameFile: (oldPath, newName) => ipcRenderer.invoke('rename-file', oldPath, newName),
  saveFileAs: (content, defaultName) => ipcRenderer.invoke('save-file-as', content, defaultName),
  onSave: (callback) => ipcRenderer.on('save', () => callback()),
  onSaveAll: (callback) => ipcRenderer.on('save-all', () => callback()),
  showSaveDialog: (fileName) => ipcRenderer.invoke('show-save-dialog', fileName),

  // Print/Export
  exportPDF: (defaultName) => ipcRenderer.invoke('export-pdf', defaultName),
  onExportPDF: (callback) => ipcRenderer.on('export-pdf', () => callback()),

  // Edit mode
  onToggleEdit: (callback) => ipcRenderer.on('toggle-edit', () => callback()),
  onRevert: (callback) => ipcRenderer.on('revert', () => callback()),
  onSetReadOnly: (callback) => ipcRenderer.on('set-read-only', (event, isReadOnly) => callback(isReadOnly)),

  // File watching
  onSetWatchMode: (callback) => ipcRenderer.on('set-watch-mode', (event, watchMode) => callback(watchMode)),
  toggleWatchMode: () => ipcRenderer.invoke('toggle-watch-mode'),
  watchFile: (filePath) => ipcRenderer.invoke('watch-file', filePath),
  unwatchFile: (filePath) => ipcRenderer.invoke('unwatch-file', filePath),
  onFileChanged: (callback) => ipcRenderer.on('file-changed', (event, data) => callback(data)),

  // Folder/directory operations
  openFolder: () => ipcRenderer.invoke('open-folder'),
  openFileByPath: (filePath, options = {}) => ipcRenderer.invoke('open-file-by-path', filePath, options),
  getDirectoryContents: (dirPath) => ipcRenderer.invoke('get-directory-contents', dirPath),
  getAllFilesRecursive: (dirPath) => ipcRenderer.invoke('get-all-files-recursive', dirPath),
  onDirectoryLoaded: (callback) => ipcRenderer.on('directory-loaded', (event, data) => callback(data)),
  onToggleSidebar: (callback) => ipcRenderer.on('toggle-sidebar', () => callback()),

  // Window controls
  toggleMaximize: () => ipcRenderer.invoke('toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('close-window'),

  // Settings
  onSettingChanged: (callback) => ipcRenderer.on('setting-changed', (event, data) => callback(data)),
  onSetTheme: (callback) => ipcRenderer.on('set-theme', (event, theme) => callback(theme)),

  // Command palette
  onShowCommandPalette: (callback) => ipcRenderer.on('show-command-palette', () => callback()),
  
  // Find
  onFindInFile: (callback) => ipcRenderer.on('find-in-file', () => callback()),

  // Recent files
  getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),

  // Unsaved changes check
  onCheckUnsaved: (callback) => ipcRenderer.on('check-unsaved', () => callback()),
  reportUnsavedState: (hasUnsaved) => ipcRenderer.send('unsaved-state', hasUnsaved),

  // Session restore
  onGetSessionState: (callback) => ipcRenderer.on('get-session-state', () => callback()),
  reportSessionState: (sessionData) => ipcRenderer.send('session-state', sessionData),
  onRestoreSession: (callback) => ipcRenderer.on('restore-session', (event, data) => callback(data)),

  // External links
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
