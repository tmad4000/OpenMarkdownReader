const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const windows = new Set();
let isReadOnlyMode = true; // Default to read-only

function createWindow(filePath = null) {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 400,
    minHeight: 300,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
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
  if (filePath) {
    win.webContents.on('did-finish-load', () => {
      loadMarkdownFile(win, filePath);
    });
  }

  return win;
}

function setupMenu() {
  const template = [
    {
      label: 'Markdown Reader',
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
          click: () => openFile()
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

async function openFile(targetWindow = null) {
  const win = targetWindow || getFocusedWindow();

  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Markdown Files', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    // All files open as tabs in current window
    result.filePaths.forEach((filePath) => {
      if (win) {
        loadMarkdownFile(win, filePath);
      }
    });
  }
}

function loadMarkdownFile(win, filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath);
    win.webContents.send('file-loaded', { content, fileName, filePath });
    win.setTitle(`${fileName} - Markdown Reader`);
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
ipcMain.handle('open-file-dialog', () => openFile());

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
