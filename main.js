const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const windows = new Set();

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
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow()
        },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: () => openFile()
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'copy' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
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
    // Open first file in current window, rest in new windows
    result.filePaths.forEach((filePath, index) => {
      if (index === 0 && win) {
        loadMarkdownFile(win, filePath);
      } else {
        createWindow(filePath);
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
    createWindow(filePath);
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
