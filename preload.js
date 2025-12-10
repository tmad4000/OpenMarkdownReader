const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onFileLoaded: (callback) => ipcRenderer.on('file-loaded', (event, data) => callback(data)),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog')
});
