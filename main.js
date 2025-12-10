const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const windows = new Set();
let isReadOnlyMode = true; // Default to read-only
let watchFileMode = false; // Watch for external file changes
const fileWatchers = new Map(); // Track active file watchers

// Configuration Management
const configPath = path.join(app.getPath('userData'), 'config.json');
let config = {
  theme: 'system' // 'system', 'light', 'dark'
};

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      config = { ...config, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('Error loading config:', err);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('Error saving config:', err);
  }
}

// Load config on startup
loadConfig();

function createWindow(filePath = null) {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 400,
    minHeight: 300,
    titleBarStyle: 'hiddenInset',
    // backgroundColor: '#ffffff', // Removed to respect system theme
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  windows.add(win);
  win.on('closed', () => windows.delete(win));

  win.loadFile('index.html');

  // Load file after window is ready
  win.webContents.on('did-finish-load', () => {
    // Apply theme
    win.webContents.send('set-theme', config.theme);
    // Apply watch mode
    win.webContents.send('set-watch-mode', watchFileMode);
    
    if (filePath) {
      loadMarkdownFile(win, filePath);
    }
  });

  return win;
}

function setTheme(theme) {
  config.theme = theme;
  saveConfig();
  windows.forEach(win => {
    win.webContents.send('set-theme', theme);
  });
  setupMenu(); // Rebuild menu to update checkmarks
}

function setupMenu() {
  const template = [
    {
      label: 'OpenMarkdownReader',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New File',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('new-file');
          }
        },
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('new-tab');
          }
        },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createWindow()
        },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: () => openFileOrFolder()
        },
        {
          label: 'Quick Open...',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('show-command-palette');
          }
        },
        { type: 'separator' },
        {
          label: 'Print...',
          accelerator: 'CmdOrCtrl+P',
          registerAccelerator: false, // Don't override Cmd+P (used for Quick Open)
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.print();
          }
        },
        {
          label: 'Export as PDF...',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('export-pdf');
          }
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            // Let renderer handle tab closing
          }
        },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Toggle Edit Mode',
          accelerator: 'CmdOrCtrl+E',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('toggle-edit');
          }
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('save');
          }
        },
        {
          label: 'Revert Changes',
          accelerator: 'Escape',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('revert');
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('toggle-sidebar');
          }
        },
        {
          label: 'Theme',
          submenu: [
            {
              label: 'System Default',
              type: 'radio',
              checked: config.theme === 'system',
              click: () => setTheme('system')
            },
            {
              label: 'Light',
              type: 'radio',
              checked: config.theme === 'light',
              click: () => setTheme('light')
            },
            {
              label: 'Dark',
              type: 'radio',
              checked: config.theme === 'dark',
              click: () => setTheme('dark')
            }
          ]
        },
        {
          label: 'Read-Only Mode',
          type: 'checkbox',
          checked: true,
          click: (menuItem) => {
            isReadOnlyMode = menuItem.checked;
            windows.forEach(win => {
              win.webContents.send('set-read-only', isReadOnlyMode);
            });
          }
        },
        {
          label: 'Watch for File Changes',
          id: 'watch-mode-item',
          type: 'checkbox',
          checked: false,
          click: (menuItem) => {
            watchFileMode = menuItem.checked;
            windows.forEach(win => {
              win.webContents.send('set-watch-mode', watchFileMode);
            });
          }
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Content Width',
          submenu: [
            {
              label: 'Narrow (700px)',
              type: 'radio',
              click: () => broadcastSetting('content-width', 700)
            },
            {
              label: 'Medium (900px)',
              type: 'radio',
              checked: true,
              click: () => broadcastSetting('content-width', 900)
            },
            {
              label: 'Wide (1100px)',
              type: 'radio',
              click: () => broadcastSetting('content-width', 1100)
            },
            {
              label: 'Full Width',
              type: 'radio',
              click: () => broadcastSetting('content-width', 'full')
            }
          ]
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function getFocusedWindow() {
  return BrowserWindow.getFocusedWindow() || [...windows][0];
}

function broadcastSetting(setting, value) {
  windows.forEach(win => {
    win.webContents.send('setting-changed', { setting, value });
  });
}

async function openFileOrFolder(targetWindow = null) {
  const win = targetWindow || getFocusedWindow();

  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [
      { name: 'Markdown Files', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    result.filePaths.forEach((filePath) => {
      if (win) {
        // Check if it's a directory or file
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          // Load as folder in sidebar
          const files = getDirectoryContents(filePath);
          win.webContents.send('directory-loaded', { dirPath: filePath, files });
        } else {
          // Load as file in tab
          loadMarkdownFile(win, filePath);
        }
      }
    });
  }
}

function loadMarkdownFile(win, filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath);
    win.webContents.send('file-loaded', { content, fileName, filePath });
    win.setTitle(`${fileName} - OpenMarkdownReader`);
  } catch (err) {
    dialog.showErrorBox('Error', `Could not read file: ${err.message}`);
  }
}

// Handle file open from Finder (drag to dock icon or Open With)
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (app.isReady()) {
    const win = getFocusedWindow();
    if (win) {
      loadMarkdownFile(win, filePath);
    } else {
      createWindow(filePath);
    }
  } else {
    app.whenReady().then(() => createWindow(filePath));
  }
});

app.whenReady().then(() => {
  setupMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (windows.size === 0) {
    createWindow();
  }
});

// IPC handlers
ipcMain.handle('open-file-dialog', () => openFileOrFolder());
ipcMain.handle('open-file-or-folder', () => openFileOrFolder());

// Show save confirmation dialog (Save/Don't Save/Cancel)
ipcMain.handle('show-save-dialog', async (event, fileName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: `Do you want to save the changes you made to "${fileName}"?`,
    detail: "Your changes will be lost if you don't save them."
  });

  // result.response: 0 = Save, 1 = Don't Save, 2 = Cancel
  if (result.response === 0) return 'save';
  if (result.response === 1) return 'discard';
  return 'cancel';
});

// Toggle maximize/restore window (macOS zoom behavior)
ipcMain.handle('toggle-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
});

// Save file to existing path
ipcMain.handle('save-file', async (event, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (err) {
    dialog.showErrorBox('Save Error', `Could not save file: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// Export to PDF
ipcMain.handle('export-pdf', async (event, defaultName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, {
    defaultPath: defaultName.replace(/\.[^/.]+$/, '.pdf'),
    filters: [
      { name: 'PDF Documents', extensions: ['pdf'] }
    ]
  });

  if (!result.canceled && result.filePath) {
    try {
      const pdfData = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'Letter',
        margins: {
          top: 0.75,
          bottom: 0.75,
          left: 0.75,
          right: 0.75
        }
      });
      fs.writeFileSync(result.filePath, pdfData);
      return { success: true, filePath: result.filePath };
    } catch (err) {
      dialog.showErrorBox('Export Error', `Could not export PDF: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
  return null;
});

// Save file as (with dialog)
ipcMain.handle('save-file-as', async (event, content, defaultName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: [
      { name: 'Markdown Files', extensions: ['md', 'markdown'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePath) {
    try {
      fs.writeFileSync(result.filePath, content, 'utf-8');
      return {
        filePath: result.filePath,
        fileName: path.basename(result.filePath)
      };
    } catch (err) {
      dialog.showErrorBox('Save Error', `Could not save file: ${err.message}`);
      return null;
    }
  }
  return null;
});

// Open folder
ipcMain.handle('open-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const dirPath = result.filePaths[0];
    const files = getMarkdownFilesInDirectory(dirPath);
    win.webContents.send('directory-loaded', { dirPath, files });
  }
});

// Open file by path (from sidebar)
ipcMain.handle('open-file-by-path', async (event, filePath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  loadMarkdownFile(win, filePath);
});

// Get directory contents (for expanding folders in sidebar)
ipcMain.handle('get-directory-contents', async (event, dirPath) => {
  return getDirectoryContents(dirPath);
});

// Get all files recursively (for command palette search)
ipcMain.handle('get-all-files-recursive', async (event, dirPath) => {
  return getAllFilesRecursive(dirPath);
});

// Recursively get all files in directory
function getAllFilesRecursive(dirPath, maxDepth = 5) {
  const markdownExtensions = ['.md', '.markdown', '.mdown', '.mkd', '.txt'];
  const files = [];

  function scan(currentPath, depth) {
    if (depth > maxDepth) return;

    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        // Skip hidden files/folders
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          scan(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const isMarkdown = markdownExtensions.includes(ext);
          files.push({
            name: entry.name,
            path: fullPath,
            type: 'file',
            isMarkdown
          });
        }
      }
    } catch (err) {
      console.error('Error scanning directory:', err);
    }
  }

  scan(dirPath, 0);
  return files;
}

// Toggle watch mode from renderer
ipcMain.handle('toggle-watch-mode', () => {
  const menu = Menu.getApplicationMenu();
  const item = menu.getMenuItemById('watch-mode-item');
  if (item) {
    item.checked = !item.checked;
    watchFileMode = item.checked;
    windows.forEach(win => {
      win.webContents.send('set-watch-mode', watchFileMode);
    });
  }
  return watchFileMode;
});

// Watch a file for changes
ipcMain.handle('watch-file', async (event, filePath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const watchKey = `${win.id}:${filePath}`;

  // Don't create duplicate watchers
  if (fileWatchers.has(watchKey)) return;

  try {
    const watcher = fs.watch(filePath, (eventType) => {
      if (eventType === 'change') {
        // Debounce: wait a bit for write to complete
        setTimeout(() => {
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            win.webContents.send('file-changed', { filePath, content });
          } catch (err) {
            console.error('Error reading changed file:', err);
          }
        }, 100);
      }
    });
    fileWatchers.set(watchKey, watcher);
  } catch (err) {
    console.error('Error watching file:', err);
  }
});

// Stop watching a file
ipcMain.handle('unwatch-file', async (event, filePath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const watchKey = `${win.id}:${filePath}`;

  const watcher = fileWatchers.get(watchKey);
  if (watcher) {
    watcher.close();
    fileWatchers.delete(watchKey);
  }
});

// Get all files and folders in directory
function getDirectoryContents(dirPath) {
  const markdownExtensions = ['.md', '.markdown', '.mdown', '.mkd', '.txt'];
  const folders = [];
  const files = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden files/folders
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        folders.push({
          name: entry.name,
          path: fullPath,
          type: 'folder'
        });
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const isMarkdown = markdownExtensions.includes(ext);
        files.push({
          name: entry.name,
          path: fullPath,
          type: 'file',
          isMarkdown
        });
      }
    }
    // Sort: folders first (alphabetically), then files (alphabetically)
    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.error('Error reading directory:', err);
  }

  return [...folders, ...files];
}

// Legacy function for backwards compatibility
function getMarkdownFilesInDirectory(dirPath) {
  return getDirectoryContents(dirPath);
}
