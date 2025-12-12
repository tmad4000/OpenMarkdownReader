const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const windows = new Set();
let isReadOnlyMode = true; // Default to read-only
let watchFileMode = false; // Watch for external file changes
const fileWatchers = new Map(); // Track active file watchers

// Configuration Management
const configPath = path.join(app.getPath('userData'), 'config.json');
let config = {
  theme: 'system', // 'system', 'light', 'dark'
  recentFiles: [], // Array of { path, type: 'file' | 'folder', timestamp }
  maxRecentFiles: 10,
  contentWidth: 900,
  contentPadding: 20,
  restoreSession: true, // Whether to restore previous session on launch
  session: null // Saved session state: { windows: [{ tabs: [{filePath, fileName}], directory: dirPath }] }
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

// Review unsaved tabs one by one (standard macOS pattern)
// Shows a dialog for each unsaved document: Save / Don't Save / Cancel
// Returns 'close' if all documents were handled, 'cancel' if user cancelled
async function reviewUnsavedTabsOneByOne(win, unsavedTabs) {
  for (let i = 0; i < unsavedTabs.length; i++) {
    const tab = unsavedTabs[i];
    if (win.isDestroyed()) return 'cancel';

    const remaining = unsavedTabs.length - i;
    const message = `Do you want to save the changes you made to "${tab.fileName}"?`;
    const detail = remaining > 1
      ? `${remaining} documents with unsaved changes. Your changes will be lost if you don't save them.`
      : 'Your changes will be lost if you don\'t save them.';

    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: message,
      detail: detail
    });

    if (choice === 0) {
      // Save - tell renderer to save this specific tab
      const saved = await saveTabInRenderer(win, tab);
      if (!saved) {
        // Save was cancelled (e.g., user cancelled Save As dialog)
        return 'cancel';
      }
    } else if (choice === 1) {
      // Don't Save - continue to next tab
      continue;
    } else {
      // Cancel - abort the close operation
      return 'cancel';
    }
  }

  return 'close';
}

// Helper to save a specific tab via IPC
function saveTabInRenderer(win, tabInfo) {
  return new Promise((resolve) => {
    if (win.isDestroyed()) {
      resolve(false);
      return;
    }

    let timeoutId = null;

    const responseHandler = (event, data) => {
      if (event.sender !== win.webContents) return;

      if (timeoutId) clearTimeout(timeoutId);
      ipcMain.removeListener('review-decision', responseHandler);

      if (data.success) {
        resolve(true);
      } else if (data.cancelled) {
        resolve(false); // User cancelled Save As dialog
      } else {
        resolve(true); // Error but continue anyway
      }
    };

    ipcMain.on('review-decision', responseHandler);
    win.webContents.send('review-unsaved-tab', tabInfo);

    // Timeout in case renderer doesn't respond
    timeoutId = setTimeout(() => {
      ipcMain.removeListener('review-decision', responseHandler);
      resolve(true); // Assume saved on timeout
    }, 30000); // 30 second timeout for save operations
  });
}

// Add a file/folder to recent list
function addToRecent(filePath, type = 'file') {
  // Remove if already exists
  config.recentFiles = config.recentFiles.filter(item => item.path !== filePath);

  // Add to beginning
  config.recentFiles.unshift({
    path: filePath,
    type: type,
    timestamp: Date.now()
  });

  // Trim to max
  if (config.recentFiles.length > config.maxRecentFiles) {
    config.recentFiles = config.recentFiles.slice(0, config.maxRecentFiles);
  }

  saveConfig();
  setupMenu(); // Rebuild menu to update recent files list
}

// Clear recent files
function clearRecentFiles() {
  config.recentFiles = [];
  saveConfig();
  setupMenu();
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

  // Handle close with unsaved changes check
  let forceClose = false;
  win.on('close', async (e) => {
    if (forceClose) return;
    if (win.isDestroyed()) return;

    e.preventDefault();

    // Ask renderer if there are unsaved changes
    return new Promise((resolve) => {
      let responded = false;
      let timeoutId = null;

      const responseHandler = async (event, data) => {
        if (win.isDestroyed()) {
          ipcMain.removeListener('unsaved-state', responseHandler);
          resolve();
          return;
        }
        if (event.sender !== win.webContents) return;

        responded = true;
        if (timeoutId) clearTimeout(timeoutId);
        ipcMain.removeListener('unsaved-state', responseHandler);

        // Handle both boolean (legacy) and object responses
        let hasUnsaved = false;
        let unsavedTabs = [];
        let sessionData = null;
        if (typeof data === 'boolean') {
          hasUnsaved = data;
        } else if (typeof data === 'object' && data !== null) {
          hasUnsaved = data.hasUnsaved;
          unsavedTabs = data.unsavedTabs || [];
          sessionData = data.sessionData;
        }

        // Save session state if available (keep schema consistent with restore)
        if (config.restoreSession && sessionData) {
          config.session = { windows: [sessionData] };
          saveConfig();
        }

        if (hasUnsaved && unsavedTabs.length > 0) {
          // Review each unsaved tab one by one (standard macOS pattern)
          const result = await reviewUnsavedTabsOneByOne(win, unsavedTabs);

          if (result === 'close') {
            // All tabs handled (saved or discarded), close the window
            forceClose = true;
            if (!win.isDestroyed()) {
              win.close();
            }
          }
          // result === 'cancel' means user cancelled, window stays open
        } else if (hasUnsaved) {
          // Legacy path - show the old dialog if we don't have unsavedTabs list
          const choice = dialog.showMessageBoxSync(win, {
            type: 'warning',
            buttons: ['Save All', "Don't Save", 'Cancel'],
            defaultId: 0,
            cancelId: 2,
            message: 'You have unsaved changes.',
            detail: 'Do you want to save your changes before closing?'
          });

          if (choice === 0) {
            // Save All - tell renderer to save all tabs, then close
            if (!win.isDestroyed()) {
              win.webContents.send('save-all');
              // Give it a moment to save all
              setTimeout(() => {
                forceClose = true;
                if (!win.isDestroyed()) {
                  win.close();
                }
              }, 1000);
            }
          } else if (choice === 1) {
            // Don't Save - close without saving
            forceClose = true;
            if (!win.isDestroyed()) {
              win.close();
            }
          }
          // Cancel (choice === 2) - do nothing, window stays open
        } else {
          forceClose = true;
          if (!win.isDestroyed()) {
            win.close();
          }
        }
        resolve();
      };

      ipcMain.on('unsaved-state', responseHandler);
      if (!win.isDestroyed()) {
        win.webContents.send('check-unsaved');
      }

      // Timeout in case renderer doesn't respond
      timeoutId = setTimeout(() => {
        if (responded) return; // Already handled
        ipcMain.removeListener('unsaved-state', responseHandler);
        forceClose = true;
        // Check if window still exists before trying to close
        if (!win.isDestroyed()) {
          win.close();
        }
        resolve();
      }, 2000);
    });
  });

  win.loadFile('index.html');

  // Load file after window is ready
  win.webContents.on('did-finish-load', () => {
    // Apply theme
    win.webContents.send('set-theme', config.theme);
    // Apply watch mode
    win.webContents.send('set-watch-mode', watchFileMode);
    // Apply auto-save setting
    win.webContents.send('set-auto-save', config.autoSave || false);
    // Apply content layout settings
    win.webContents.send('setting-changed', { setting: 'content-width', value: config.contentWidth });
    win.webContents.send('setting-changed', { setting: 'content-padding', value: config.contentPadding });

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

// Build the recent files submenu
function buildRecentFilesMenu() {
  const recentItems = [];

  if (config.recentFiles && config.recentFiles.length > 0) {
    // Filter out files/folders that no longer exist
    const validRecent = config.recentFiles.filter(item => {
      try {
        return fs.existsSync(item.path);
      } catch {
        return false;
      }
    });

    validRecent.forEach(item => {
      const icon = item.type === 'folder' ? '📁 ' : '';
      const displayName = path.basename(item.path);
      const displayPath = item.path.replace(process.env.HOME, '~');

      recentItems.push({
        label: `${icon}${displayName}`,
        sublabel: displayPath,
        click: () => {
          const win = getFocusedWindow();
          if (item.type === 'folder') {
            // Open folder in sidebar
            if (win) {
              const files = getDirectoryContents(item.path);
              win.webContents.send('directory-loaded', { dirPath: item.path, files });
              addToRecent(item.path, 'folder');
            }
          } else {
            // Open file
            if (win) {
              loadMarkdownFile(win, item.path);
            } else {
              createWindow(item.path);
            }
          }
        }
      });
    });

    recentItems.push({ type: 'separator' });
  }

  recentItems.push({
    label: 'Clear Recent',
    enabled: config.recentFiles && config.recentFiles.length > 0,
    click: () => clearRecentFiles()
  });

  return recentItems;
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
            if (win) {
              win.webContents.send('new-file');
            } else {
              // No windows open, create one
              createWindow();
            }
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
          label: 'Open Recent',
          submenu: buildRecentFilesMenu()
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
            const win = getFocusedWindow();
            if (win) win.webContents.send('close-tab');
          }
        },
        {
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.close();
          }
        }
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
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('find-in-file');
          }
        },
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
              checked: config.contentWidth === 700,
              click: () => {
                config.contentWidth = 700;
                saveConfig();
                broadcastSetting('content-width', 700);
              }
            },
            {
              label: 'Medium (900px)',
              type: 'radio',
              checked: config.contentWidth === 900,
              click: () => {
                config.contentWidth = 900;
                saveConfig();
                broadcastSetting('content-width', 900);
              }
            },
            {
              label: 'Wide (1100px)',
              type: 'radio',
              checked: config.contentWidth === 1100,
              click: () => {
                config.contentWidth = 1100;
                saveConfig();
                broadcastSetting('content-width', 1100);
              }
            },
            {
              label: 'Full Width',
              type: 'radio',
              checked: config.contentWidth === 'full',
              click: () => {
                config.contentWidth = 'full';
                saveConfig();
                broadcastSetting('content-width', 'full');
              }
            }
          ]
        },
        {
          label: 'Content Margins',
          submenu: [
            {
              label: 'Compact',
              type: 'radio',
              checked: config.contentPadding === 16,
              click: () => {
                config.contentPadding = 16;
                saveConfig();
                broadcastSetting('content-padding', 16);
              }
            },
            {
              label: 'Comfortable',
              type: 'radio',
              checked: config.contentPadding === 20,
              click: () => {
                config.contentPadding = 20;
                saveConfig();
                broadcastSetting('content-padding', 20);
              }
            },
            {
              label: 'Spacious',
              type: 'radio',
              checked: config.contentPadding === 28,
              click: () => {
                config.contentPadding = 28;
                saveConfig();
                broadcastSetting('content-padding', 28);
              }
            }
          ]
        },
        { type: 'separator' },
        {
          label: 'Restore Previous Session on Launch',
          type: 'checkbox',
          checked: config.restoreSession,
          click: (menuItem) => {
            config.restoreSession = menuItem.checked;
            saveConfig();
          }
        },
        { type: 'separator' },
        {
          label: 'Auto Save',
          type: 'checkbox',
          checked: config.autoSave || false,
          click: (menuItem) => {
            config.autoSave = menuItem.checked;
            saveConfig();
            windows.forEach(win => {
              win.webContents.send('set-auto-save', menuItem.checked);
            });
          }
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

// Text file extensions that can be opened
const textFileExtensions = [
  'md', 'markdown', 'mdown', 'mkd',
  'txt', 'text',
  'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'toml',
  'conf', 'config', 'ini', 'cfg', 'env', 'properties',
  'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'php', 'java', 'c', 'cpp', 'h', 'hpp',
  'cs', 'go', 'rs', 'swift', 'kt', 'scala',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'sql', 'graphql', 'gql',
  'html', 'htm', 'css', 'scss', 'sass', 'less',
  'svg',
  'rst', 'adoc', 'asciidoc', 'org', 'tex', 'latex',
  'log',
  'gitignore', 'dockerignore', 'editorconfig',
  'eslintrc', 'prettierrc', 'babelrc',
  'htaccess', 'npmrc', 'nvmrc'
];

async function openFileOrFolder(targetWindow = null) {
  const win = targetWindow || getFocusedWindow();

  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [
      { name: 'Text Files', extensions: textFileExtensions },
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
          addToRecent(filePath, 'folder');
        } else {
          // Load as file in tab
          loadMarkdownFile(win, filePath);
        }
      }
    });
  }
}

function loadMarkdownFile(win, filePath, options = {}) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath);
    win.webContents.send('file-loaded', {
      content,
      fileName,
      filePath,
      openInBackground: options.background || false,
      forceNewTab: options.newTab || false
    });
    if (!options.background) {
      win.setTitle(`${fileName} - OpenMarkdownReader`);
    }
    addToRecent(filePath, 'file');
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

// Save session state from all windows before quit
async function saveSession() {
  if (!config.restoreSession) return;

  const sessionWindows = [];

  for (const win of windows) {
    try {
      const sessionData = await new Promise((resolve) => {
        const responseHandler = (event, data) => {
          if (event.sender !== win.webContents) return;
          ipcMain.removeListener('session-state', responseHandler);
          resolve(data);
        };

        ipcMain.on('session-state', responseHandler);
        win.webContents.send('get-session-state');

        // Timeout fallback
        setTimeout(() => {
          ipcMain.removeListener('session-state', responseHandler);
          resolve(null);
        }, 1000);
      });

      if (sessionData && (sessionData.tabs.length > 0 || sessionData.directory)) {
        sessionWindows.push(sessionData);
      }
    } catch (err) {
      console.error('Error getting session state from window:', err);
    }
  }

  config.session = sessionWindows.length > 0 ? { windows: sessionWindows } : null;
  saveConfig();
}

// Restore previous session
function restoreSession() {
  if (!config.restoreSession || !config.session || !config.session.windows) {
    return false;
  }

  const sessionWindows = config.session.windows;
  if (sessionWindows.length === 0) return false;

  // Create windows and restore their state
  sessionWindows.forEach((windowData, index) => {
    const win = createWindow();

    win.webContents.on('did-finish-load', () => {
      // Wait a bit for renderer to initialize
      setTimeout(() => {
        win.webContents.send('restore-session', windowData);
      }, 100);
    });
  });

  return true;
}

app.whenReady().then(() => {
  setupMenu();

  // Try to restore session, otherwise create empty window
  if (!restoreSession()) {
    createWindow();
  }

  // Auto-save session periodically (survives crashes/force-kills)
  // We use a short interval since saveSession is lightweight
  setInterval(() => {
    if (windows.size > 0) {
      saveSession();
    }
  }, 5000); // Every 5 seconds
});

// Save session before quitting
app.on('before-quit', async (e) => {
  // Only save on normal quit (not file-triggered launch)
  if (windows.size > 0) {
    e.preventDefault();
    await saveSession();
    app.exit(0);
  }
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

// Create file in directory
ipcMain.handle('create-file-in-directory', async (event, dirPath, fileName) => {
  try {
    const filePath = path.join(dirPath, fileName);

    // Check if file already exists
    if (fs.existsSync(filePath)) {
      return { success: false, error: 'A file with that name already exists' };
    }

    // Create empty file
    fs.writeFileSync(filePath, '', 'utf-8');
    return { success: true, filePath, fileName };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Rename file
ipcMain.handle('rename-file', async (event, oldPath, newName) => {
  try {
    const dir = path.dirname(oldPath);
    const newPath = path.join(dir, newName);

    // Check if file already exists
    if (fs.existsSync(newPath)) {
      return { success: false, error: 'A file with that name already exists' };
    }

    fs.renameSync(oldPath, newPath);
    return { success: true, newPath };
  } catch (err) {
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
    addToRecent(dirPath, 'folder');
  }
});

// Open file by path (from sidebar or recent palette)
ipcMain.handle('open-file-by-path', async (event, filePath, options = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);

  try {
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      // Open as folder in sidebar
      const files = getDirectoryContents(filePath);
      win.webContents.send('directory-loaded', { dirPath: filePath, files });
      addToRecent(filePath, 'folder');
    } else {
      // Open as file in tab
      loadMarkdownFile(win, filePath, options);
    }
  } catch (err) {
    console.error('Error opening path:', err);
    // Try loading as file anyway
    loadMarkdownFile(win, filePath, options);
  }
});

// Get directory contents (for expanding folders in sidebar)
ipcMain.handle('get-directory-contents', async (event, dirPath) => {
  return getDirectoryContents(dirPath);
});

// Get all files recursively (for command palette search)
ipcMain.handle('get-all-files-recursive', async (event, dirPath) => {
  return getAllFilesRecursive(dirPath);
});

// Check if a file is a text file we can open
function isTextFileExt(filename) {
  const ext = path.extname(filename).toLowerCase().slice(1);
  return textFileExtensions.includes(ext);
}

// Check if a file is markdown
function isMarkdownFileExt(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ['.md', '.markdown', '.mdown', '.mkd'].includes(ext);
}

// Recursively get all files in directory
function getAllFilesRecursive(dirPath, maxDepth = 5) {
  const files = [];
  const ignoredDirs = new Set([
    'node_modules',
    'dist',
    'build',
    'out',
    'coverage',
    'target',
    'vendor',
    '.git' // extra safety if ever passed through
  ]);

  function scan(currentPath, depth) {
    if (depth > maxDepth) return;

    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        // Skip hidden files/folders
        if (entry.name.startsWith('.')) continue;
        if (entry.isSymbolicLink && entry.isSymbolicLink()) continue;

        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          if (ignoredDirs.has(entry.name)) continue;
          scan(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const isMarkdown = isMarkdownFileExt(entry.name);
          const isTextFile = isTextFileExt(entry.name);
          files.push({
            name: entry.name,
            path: fullPath,
            type: 'file',
            isMarkdown,
            isTextFile
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

// Close the current window (called when last tab is closed)
ipcMain.handle('close-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.close();
  }
});

// Get recent files for welcome screen
ipcMain.handle('get-recent-files', async () => {
  // Filter out files that no longer exist
  const validRecent = (config.recentFiles || []).filter(item => {
    try {
      return fs.existsSync(item.path);
    } catch {
      return false;
    }
  });
  return validRecent;
});

// Open external URL in default browser
ipcMain.handle('open-external', async (event, url) => {
  // Only open http/https URLs for security
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

// Toggle watch mode from renderer
ipcMain.handle('toggle-watch-mode', async () => {
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
        const isMarkdown = isMarkdownFileExt(entry.name);
        const isTextFile = isTextFileExt(entry.name);
        files.push({
          name: entry.name,
          path: fullPath,
          type: 'file',
          isMarkdown,
          isTextFile
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
