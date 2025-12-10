const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  onFileLoaded: (callback) => ipcRenderer.on('file-loaded', (event, data) => callback(data)),
  onNewTab: (callback) => ipcRenderer.on('new-tab', () => callback()),
  onNewFile: (callback) => ipcRenderer.on('new-file', () => callback()),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),

  // Save operations
  saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
  saveFileAs: (content, defaultName) => ipcRenderer.invoke('save-file-as', content, defaultName),
  onSave: (callback) => ipcRenderer.on('save', () => callback()),

  // Print/Export
  exportPDF: (defaultName) => ipcRenderer.invoke('export-pdf', defaultName),
  onExportPDF: (callback) => ipcRenderer.on('export-pdf', () => callback()),

  // Edit mode
  onToggleEdit: (callback) => ipcRenderer.on('toggle-edit', () => callback()),
  onRevert: (callback) => ipcRenderer.on('revert', () => callback()),
  onSetReadOnly: (callback) => ipcRenderer.on('set-read-only', (event, isReadOnly) => callback(isReadOnly)),

  // File watching
  onSetWatchMode: (callback) => ipcRenderer.on('set-watch-mode', (event, watchMode) => callback(watchMode)),
  watchFile: (filePath) => ipcRenderer.invoke('watch-file', filePath),
  unwatchFile: (filePath) => ipcRenderer.invoke('unwatch-file', filePath),
  onFileChanged: (callback) => ipcRenderer.on('file-changed', (event, data) => callback(data)),

  // Folder/directory operations
  openFolder: () => ipcRenderer.invoke('open-folder'),
  onOpenFolderDialog: (callback) => ipcRenderer.on('open-folder-dialog', () => callback()),
  openFileByPath: (filePath) => ipcRenderer.invoke('open-file-by-path', filePath),
  getDirectoryContents: (dirPath) => ipcRenderer.invoke('get-directory-contents', dirPath),
  getAllFilesRecursive: (dirPath) => ipcRenderer.invoke('get-all-files-recursive', dirPath),
  onDirectoryLoaded: (callback) => ipcRenderer.on('directory-loaded', (event, data) => callback(data)),
  onToggleSidebar: (callback) => ipcRenderer.on('toggle-sidebar', () => callback()),

  // Window controls
  toggleMaximize: () => ipcRenderer.invoke('toggle-maximize'),

  // Settings
  onSettingChanged: (callback) => ipcRenderer.on('setting-changed', (event, data) => callback(data)),

  // Command palette
  onShowCommandPalette: (callback) => ipcRenderer.on('show-command-palette', () => callback())
});
