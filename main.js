const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

const windows = new Set();
let isReadOnlyMode = true; // Default to read-only
let watchFileMode = false; // Watch for external file changes
const fileWatchers = new Map(); // Track active file watchers
const fileWatchDebounceTimers = new Map(); // Track debounce timers per watcher

// Configuration Management
const configPath = path.join(app.getPath('userData'), 'config.json');
let config = {
  theme: 'system', // 'system', 'light', 'dark'
  recentFiles: [], // Array of { path, type: 'file' | 'folder', timestamp }
  maxRecentFiles: 10,
  contentWidth: 900,
  contentPadding: 20,
  restoreSession: true, // Whether to restore previous session on launch
  session: null, // Saved session state: { windows: [{ tabs: [{filePath, fileName}], directory: dirPath }] }
  cliCommandPath: null,
  watchMode: false // Watch for external file changes
};

const CLI_COMMAND_NAME = 'omr';
const APP_BUNDLE_ID = 'com.jacobcole.openmarkdownreader';

function getCliScriptContents() {
  return `#!/usr/bin/env bash
set -euo pipefail

APP_BUNDLE_ID="${APP_BUNDLE_ID}"
APP_NAME="OpenMarkdownReader"

if [[ "\${1:-}" == "--help" || "\${1:-}" == "-h" ]]; then
  echo "Usage: ${CLI_COMMAND_NAME} [path ...]"
  echo "Open files/folders in OpenMarkdownReader."
  exit 0
fi

if [[ $# -eq 0 ]]; then
  open -b "$APP_BUNDLE_ID" 2>/dev/null || open -a "$APP_NAME"
  exit 0
fi

open -b "$APP_BUNDLE_ID" "$@" 2>/dev/null || open -a "$APP_NAME" "$@"
`;
}

function getCliInstallCandidates() {
  const homeDir = os.homedir();
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(homeDir, '.local', 'bin'),
    path.join(homeDir, 'bin')
  ];
}

function isDirInPath(dirPath) {
  const envPath = process.env.PATH || '';
  return envPath.split(':').includes(dirPath);
}

function ensureWritableDir(dirPath, { create } = { create: false }) {
  if (!fs.existsSync(dirPath)) {
    if (!create) return false;
    try {
      fs.mkdirSync(dirPath, { recursive: true });
    } catch {
      return false;
    }
  }
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function installCliCommand() {
  if (process.platform !== 'darwin') {
    dialog.showMessageBox({
      type: 'info',
      message: 'Terminal command install is currently macOS-only.'
    });
    return;
  }

  const preferredCandidates = getCliInstallCandidates();
  const candidatesInPath = preferredCandidates.filter(isDirInPath);
  const orderedCandidates = [...candidatesInPath, ...preferredCandidates.filter(d => !candidatesInPath.includes(d))];

  const script = getCliScriptContents();
  let installedPath = null;
  let lastError = null;

  for (const dir of orderedCandidates) {
    const isUserDir = dir.startsWith(os.homedir());
    const ok = ensureWritableDir(dir, { create: isUserDir });
    if (!ok) continue;

    const target = path.join(dir, CLI_COMMAND_NAME);

    try {
      if (fs.existsSync(target)) {
        const choice = dialog.showMessageBoxSync({
          type: 'question',
          buttons: ['Replace', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
          message: `A '${CLI_COMMAND_NAME}' command already exists at:\n${target}\n\nReplace it?`
        });
        if (choice !== 0) return;
      }

      fs.writeFileSync(target, script, { encoding: 'utf-8' });
      fs.chmodSync(target, 0o755);
      installedPath = target;
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!installedPath) {
    dialog.showErrorBox(
      'Install Failed',
      `Could not install '${CLI_COMMAND_NAME}' command.\n\n${lastError ? String(lastError.message || lastError) : 'No writable install location found.'}`
    );
    return;
  }

  config.cliCommandPath = installedPath;
  saveConfig();
  setupMenu();

  const dir = path.dirname(installedPath);
  const inPath = isDirInPath(dir);
  const nextSteps = inPath
    ? `Try it in Terminal:\n  ${CLI_COMMAND_NAME} README.md`
    : `Add this to your shell PATH (zsh):\n  echo 'export PATH=\"${dir}:$PATH\"' >> ~/.zshrc\n  source ~/.zshrc\n\nThen try:\n  ${CLI_COMMAND_NAME} README.md`;

  dialog.showMessageBox({
    type: 'info',
    message: `Installed '${CLI_COMMAND_NAME}' command`,
    detail: `${installedPath}\n\n${nextSteps}`
  });
}

async function uninstallCliCommand() {
  if (process.platform !== 'darwin') {
    dialog.showMessageBox({
      type: 'info',
      message: 'Terminal command uninstall is currently macOS-only.'
    });
    return;
  }

  const pathsToTry = [];
  if (config.cliCommandPath) {
    pathsToTry.push(config.cliCommandPath);
  }
  for (const dir of getCliInstallCandidates()) {
    const p = path.join(dir, CLI_COMMAND_NAME);
    if (!pathsToTry.includes(p)) pathsToTry.push(p);
  }

  const existing = pathsToTry.find(p => fs.existsSync(p));
  if (!existing) {
    dialog.showMessageBox({
      type: 'info',
      message: `No '${CLI_COMMAND_NAME}' command found to uninstall.`
    });
    return;
  }

  const choice = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['Uninstall', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: `Remove '${CLI_COMMAND_NAME}' from:\n${existing}?`
  });
  if (choice !== 0) return;

  try {
    fs.unlinkSync(existing);
    if (config.cliCommandPath === existing) {
      config.cliCommandPath = null;
      saveConfig();
      setupMenu();
    }
    dialog.showMessageBox({
      type: 'info',
      message: `Uninstalled '${CLI_COMMAND_NAME}' command`
    });
  } catch (err) {
    dialog.showErrorBox('Uninstall Failed', String(err.message || err));
  }
}

function openPathInWindow(win, targetPath, options = {}) {
  try {
    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      const files = getDirectoryContents(targetPath);
      win.webContents.send('directory-loaded', { dirPath: targetPath, files });
      addToRecent(targetPath, 'folder');
      return;
    }
    loadMarkdownFile(win, targetPath, options);
  } catch (err) {
    dialog.showErrorBox('Error', `Could not open path: ${err.message}`);
  }
}

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
watchFileMode = config.watchMode || false;

function cleanupFileWatchersForWindow(winId) {
  const prefix = `${winId}:`;
  for (const [watchKey, watcher] of fileWatchers) {
    if (!watchKey.startsWith(prefix)) continue;
    try {
      watcher.close();
    } catch {}
    fileWatchers.delete(watchKey);

    const timer = fileWatchDebounceTimers.get(watchKey);
    if (timer) clearTimeout(timer);
    fileWatchDebounceTimers.delete(watchKey);
  }
}

function createWindow(filePath = null) {
  const initialPath = filePath;
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

  const winId = win.id;
  windows.add(win);
  win.on('closed', () => {
    cleanupFileWatchersForWindow(winId);
    windows.delete(win);
  });

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

        if (hasUnsaved && unsavedTabs.length > 1) {
          // Multiple unsaved documents - show summary dialog first (standard macOS pattern)
          const fileList = unsavedTabs.map(t => t.fileName).join(', ');
          const choice = dialog.showMessageBoxSync(win, {
            type: 'warning',
            buttons: ['Save All', 'Review Changes...', 'Discard Changes', 'Cancel'],
            defaultId: 0,
            cancelId: 3,
            message: `You have ${unsavedTabs.length} documents with unsaved changes.`,
            detail: `${fileList}\n\nYour changes will be lost if you discard them.`
          });

          if (choice === 0) {
            // Save All - save all and close
            if (!win.isDestroyed()) {
              win.webContents.send('save-all');
              setTimeout(() => {
                forceClose = true;
                if (!win.isDestroyed()) {
                  win.close();
                }
              }, 1000);
            }
          } else if (choice === 1) {
            // Review Changes - go through one by one
            const result = await reviewUnsavedTabsOneByOne(win, unsavedTabs);
            if (result === 'close') {
              forceClose = true;
              if (!win.isDestroyed()) {
                win.close();
              }
            }
          } else if (choice === 2) {
            // Discard Changes - close without saving any
            forceClose = true;
            if (!win.isDestroyed()) {
              win.close();
            }
          }
          // Cancel (choice === 3) - do nothing, window stays open
        } else if (hasUnsaved && unsavedTabs.length === 1) {
          // Single unsaved document - show simple Save/Don't Save/Cancel
          const tab = unsavedTabs[0];
          const choice = dialog.showMessageBoxSync(win, {
            type: 'warning',
            buttons: ['Save', "Don't Save", 'Cancel'],
            defaultId: 0,
            cancelId: 2,
            message: `Do you want to save the changes you made to "${tab.fileName}"?`,
            detail: 'Your changes will be lost if you don\'t save them.'
          });

          if (choice === 0) {
            // Save
            const saved = await saveTabInRenderer(win, tab);
            if (saved) {
              forceClose = true;
              if (!win.isDestroyed()) {
                win.close();
              }
            }
          } else if (choice === 1) {
            // Don't Save
            forceClose = true;
            if (!win.isDestroyed()) {
              win.close();
            }
          }
          // Cancel - do nothing
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

    if (initialPath) {
      openPathInWindow(win, initialPath);
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
        {
          label: 'Refresh File',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('refresh-file');
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
          label: 'Reopen Closed Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('reopen-closed-tab');
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
        { type: 'separator' },
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
        },
        {
          label: 'Watch for External Changes',
          id: 'watch-mode-item',
          type: 'checkbox',
          checked: config.watchMode || false,
          click: (menuItem) => {
            config.watchMode = menuItem.checked;
            watchFileMode = menuItem.checked;
            saveConfig();
            windows.forEach(win => {
              win.webContents.send('set-watch-mode', menuItem.checked);
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
    },
    {
      label: 'Help',
      role: 'help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('show-keyboard-shortcuts');
          }
        },
        { type: 'separator' },
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://github.com/tmad4000/OpenMarkdownReader')
        },
        {
          label: 'Report an Issue…',
          click: () => shell.openExternal('https://github.com/tmad4000/OpenMarkdownReader/issues')
        },
        { type: 'separator' },
        {
          label: `Install '${CLI_COMMAND_NAME}' Command in PATH…`,
          enabled: process.platform === 'darwin',
          click: () => installCliCommand()
        },
        {
          label: `Uninstall '${CLI_COMMAND_NAME}' Command…`,
          enabled: process.platform === 'darwin',
          click: () => uninstallCliCommand()
        }
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
      if (!win) return;
      openPathInWindow(win, filePath);
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
      forceNewTab: options.newTab || false,
      reuseTab: options.reuseTab || null
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
      openPathInWindow(win, filePath);
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
    openPathInWindow(win, result.filePaths[0]);
  }
});

// Open file by path (from sidebar or recent palette)
ipcMain.handle('open-file-by-path', async (event, filePath, options = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  openPathInWindow(win, filePath, options);
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
    config.watchMode = item.checked;
    saveConfig();
    windows.forEach(win => {
      win.webContents.send('set-watch-mode', watchFileMode);
    });
  }
  return watchFileMode;
});

// Watch a file for changes
ipcMain.handle('watch-file', async (event, filePath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || !filePath) return;
  const watchKey = `${win.id}:${filePath}`;

  // Don't create duplicate watchers
  if (fileWatchers.has(watchKey)) return;

  try {
    const scheduleUpdate = () => {
      const existingTimer = fileWatchDebounceTimers.get(watchKey);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(() => {
        fileWatchDebounceTimers.delete(watchKey);
        if (win.isDestroyed()) return;
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          win.webContents.send('file-changed', { filePath, content });
        } catch (err) {
          console.error('Error reading changed file:', err);
        }
      }, 150);

      fileWatchDebounceTimers.set(watchKey, timer);
    };

    const startWatcher = () => {
      if (win.isDestroyed()) return;
      try {
        const watcher = fs.watch(filePath, (eventType) => {
          if (eventType !== 'change' && eventType !== 'rename') return;

          scheduleUpdate();

          if (eventType === 'rename') {
            const currentWatcher = fileWatchers.get(watchKey);
            if (currentWatcher) {
              try {
                currentWatcher.close();
              } catch {}
              fileWatchers.delete(watchKey);
            }
            setTimeout(() => {
              if (win.isDestroyed()) return;
              if (!fileWatchers.has(watchKey)) startWatcher();
            }, 50);
          }
        });
        fileWatchers.set(watchKey, watcher);
      } catch (err) {
        console.error('Error watching file:', err);
      }
    };

    startWatcher();
  } catch (err) {
    console.error('Error watching file:', err);
  }
});

// Stop watching a file
ipcMain.handle('unwatch-file', async (event, filePath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !filePath) return;
  const watchKey = `${win.id}:${filePath}`;

  const watcher = fileWatchers.get(watchKey);
  if (watcher) {
    watcher.close();
    fileWatchers.delete(watchKey);
  }

  const timer = fileWatchDebounceTimers.get(watchKey);
  if (timer) clearTimeout(timer);
  fileWatchDebounceTimers.delete(watchKey);
});

// Tab context menu
ipcMain.handle('show-tab-context-menu', async (event, tabInfo) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { filePath, tabId, tabIndex, totalTabs } = tabInfo;

  const menuTemplate = [];

  if (filePath) {
    menuTemplate.push(
      {
        label: 'Reveal in Finder',
        click: () => shell.showItemInFolder(filePath)
      },
      {
        label: 'Copy Path',
        click: () => {
          require('electron').clipboard.writeText(filePath);
        }
      },
      {
        label: 'Copy Relative Path',
        click: () => {
          // Get relative path from current directory if available
          const relativePath = tabInfo.directory
            ? path.relative(tabInfo.directory, filePath)
            : path.basename(filePath);
          require('electron').clipboard.writeText(relativePath);
        }
      },
      { type: 'separator' }
    );
  }

  menuTemplate.push(
    {
      label: 'Close Tab',
      click: () => win.webContents.send('close-tab-by-id', tabId)
    },
    {
      label: 'Close Other Tabs',
      enabled: totalTabs > 1,
      click: () => win.webContents.send('close-other-tabs', tabId)
    },
    {
      label: 'Close Tabs to the Right',
      enabled: tabIndex < totalTabs - 1,
      click: () => win.webContents.send('close-tabs-to-right', tabId)
    }
  );

  const menu = Menu.buildFromTemplate(menuTemplate);
  menu.popup({ window: win });
});

// Reveal in Finder
ipcMain.handle('reveal-in-finder', async (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});

// Copy to clipboard
ipcMain.handle('copy-to-clipboard', async (event, text) => {
  require('electron').clipboard.writeText(text);
  return true;
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
