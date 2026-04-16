const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeImage, clipboard, crashReporter } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const https = require('https');
const log = require('electron-log/main');
const { openInFinder } = require('./finder-actions');
const agentServer = require('./agent-server');

// Configure electron-log: writes to ~/Library/Logs/OpenMarkdownReader/
log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

// Redirect console to electron-log so all output is captured to file
Object.assign(console, log.functions);

// Native crash dumps for hard crashes (Electron itself dying, native code crashes,
// GPU/utility process hard crashes). These are minidumps written to:
//   ~/Library/Application Support/OpenMarkdownReader/Crashpad/completed/
// Without this, hard crashes leave nothing behind except whatever macOS captured
// to ~/Library/Logs/DiagnosticReports/.
// uploadToServer:false keeps everything local — no telemetry sent anywhere.
crashReporter.start({
  productName: 'OpenMarkdownReader',
  companyName: 'jacobcole',
  uploadToServer: false,
  ignoreSystemCrashHandler: false,
  rateLimit: false,
  compress: true
});

// Global error handlers — catch anything that would silently kill the app
process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT EXCEPTION]', error.stack || error);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

// ── Crash diagnostics ───────────────────────────────────────────────────
// Translates Electron's terse exit codes/reasons into something a human or
// support engineer can act on. Used by render-process-gone and child-process-gone.
const CRASH_REASON_MAP = {
  'clean-exit':         'Process exited cleanly',
  'abnormal-exit':      'Process exited abnormally',
  'killed':             'Process was killed (SIGTERM/SIGKILL — usually deliberate)',
  'crashed':            'Process crashed (segfault, JS uncaught exception, etc.)',
  'oom':                'Process ran out of memory',
  'launch-failed':      'Process failed to launch',
  'integrity-failure':  'Code signing integrity check failed'
};

const CRASH_EXIT_CODE_MAP = {
  0:   'Clean exit',
  9:   'SIGKILL (force-killed by OS or `kill -9`)',
  11:  'SIGSEGV (segmentation fault)',
  15:  'SIGTERM (deliberately stopped, e.g. `pkill`)',
  '-1': 'Unknown'
};

function describeCrash(processType, details) {
  const reasonText = CRASH_REASON_MAP[details.reason] || details.reason || 'unknown';
  const exitText = CRASH_EXIT_CODE_MAP[details.exitCode] != null
    ? CRASH_EXIT_CODE_MAP[details.exitCode]
    : `exit code ${details.exitCode}`;
  return `${processType} process: ${reasonText} (${exitText})`;
}

function handleProcessCrash(processType, details, win) {
  const summary = describeCrash(processType, details);
  console.error(`[${processType.toUpperCase()} CRASHED] reason=${details.reason} exitCode=${details.exitCode}`);

  // Build full diagnostic text the user can copy to a bug report
  const logPath = log.transports.file.getFile().path;
  const dumpDir = path.join(app.getPath('userData'), 'Crashpad', 'completed');
  const diagnosticText = [
    'OpenMarkdownReader crash report',
    '─────────────────────────────',
    `Time:        ${new Date().toISOString()}`,
    `Process:     ${processType}`,
    `Reason:      ${details.reason}`,
    `Exit code:   ${details.exitCode}`,
    `Description: ${summary}`,
    '',
    `App version: ${buildInfo.version} (build ${buildInfo.buildNumber}, ${buildInfo.gitHash})`,
    `Platform:    ${process.platform} ${os.release()}`,
    `Electron:    ${process.versions.electron}`,
    `Node:        ${process.versions.node}`,
    `Arch:        ${process.arch}`,
    '',
    `Log file:    ${logPath}`,
    `Crash dumps: ${dumpDir}`,
  ].join('\n');

  // Don't show a dialog for renderer 'killed' on app quit — that's expected
  // (the main process intentionally tears down renderers during shutdown).
  if (details.reason === 'killed' && app.isQuittingForReal) {
    return;
  }

  // Async dialog so we don't block the main thread; offers actionable buttons.
  const dialogOptions = {
    type: 'error',
    title: 'OpenMarkdownReader crashed',
    message: 'OpenMarkdownReader crashed',
    detail: `${summary}\n\nThe app may continue to work, but you should restart it. If this keeps happening, share the diagnostic info with the developer.`,
    buttons: ['Reload', 'Copy Diagnostics', 'Show Logs in Finder', 'Close'],
    defaultId: 0,
    cancelId: 3,
    noLink: true
  };

  const targetWin = (win && !win.isDestroyed()) ? win : null;
  const dialogPromise = targetWin
    ? dialog.showMessageBox(targetWin, dialogOptions)
    : dialog.showMessageBox(dialogOptions);

  dialogPromise.then(({ response }) => {
    if (response === 0 && targetWin && !targetWin.isDestroyed()) {
      // Reload — try to recover the renderer
      try {
        targetWin.webContents.reload();
      } catch (err) {
        console.error('Failed to reload after crash:', err);
      }
    } else if (response === 1) {
      clipboard.writeText(diagnosticText);
    } else if (response === 2) {
      shell.showItemInFolder(logPath);
    }
  }).catch(err => {
    console.error('Crash dialog error:', err);
  });
}

// Catch GPU/utility/plugin process crashes (separate from renderer crashes).
// Without this, GPU process crashes silently fall through to a black window
// or graphics glitches with no logging.
app.on('child-process-gone', (event, details) => {
  console.error(`[CHILD PROCESS GONE] type=${details.type} name=${details.name || 'n/a'} reason=${details.reason} exitCode=${details.exitCode}`);
  // Only show dialog for serious crashes — clean exit and 'killed' during shutdown are normal.
  if (details.reason === 'clean-exit' || details.reason === 'killed') return;
  handleProcessCrash(details.type || 'child', details, null);
});

const { getFileIdentity, detectFileMove } = require('./file-watch-utils');
const {
  findNameCollisionInDirectory
} = require('./file-creation-utils');
const {
  moveFileToDirectory
} = require('./file-move-utils');

// Load build info (generated by scripts/generate-build-info.js)
let buildInfo = { version: '0.0.0', buildNumber: 0, gitHash: 'dev', buildDate: '' };
try {
  const buildInfoPath = path.join(__dirname, 'build-info.json');
  if (fs.existsSync(buildInfoPath)) {
    buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
  }
} catch {
  // Fall back to package.json version
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    buildInfo.version = pkg.version;
  } catch {}
}

const devTag = buildInfo.isDev ? ' [DEV]' : (buildInfo.channel ? ` [${buildInfo.channel}]` : '');
log.info(`OpenMarkdownReader starting — v${buildInfo.version} (build ${buildInfo.buildNumber}, ${buildInfo.gitHash})${devTag}`);
log.info(`Platform: ${process.platform} ${os.release()} | Electron: ${process.versions.electron} | Node: ${process.versions.node} | Arch: ${process.arch}`);

// Detect if running as Mac App Store (sandboxed) build
// MAS apps have a receipt file in the app bundle
function isMASBuild() {
  if (process.platform !== 'darwin') return false;
  try {
    const receiptPath = path.join(app.getAppPath(), '..', '_MASReceipt', 'receipt');
    return fs.existsSync(receiptPath);
  } catch {
    return false;
  }
}

const windows = new Set();
let isReadOnlyMode = true; // Default to read-only
let watchFileMode = false; // Watch for external file changes
const fileWatchers = new Map(); // Track active file watchers
const fileWatchDebounceTimers = new Map(); // Track debounce timers per watcher
const fileWatchStates = new Map(); // Track watcher metadata (path/inode/search root)
// Track files received via open-file before app is ready (Finder double-click / Open With)
const pendingOpenFiles = [];

// Argument Parsing
function parseArgs(argv) {
  const flags = {
    watch: false,
    edit: false,
    theme: null,
    noSession: false,
    scratch: false,
    ref: false,
    monospace: null,
    newFile: false,
    files: []
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--watch' || arg === '-w') {
      flags.watch = true;
    } else if (arg === '--edit' || arg === '-e') {
      flags.edit = true;
    } else if (arg === '--scratch' || arg === '-s') {
      flags.scratch = true;
    } else if (arg === '--ref' || arg === '-r') {
      flags.ref = true;
    } else if (arg === '--new' || arg === '-n') {
      flags.newFile = true;
    } else if (arg === '--no-session') {
      flags.noSession = true;
    } else if (arg === '--monospace') {
      flags.monospace = true;
    } else if (arg === '--no-monospace') {
      flags.monospace = false;
    } else if (arg === '--theme' || arg === '-t') {
      const next = argv[i + 1];
      if (next && ['light', 'dark', 'system'].includes(next)) {
        flags.theme = next;
        i++;
      }
    } else if (arg === '--debug') {
      flags.debug = true;
    } else if (arg === '.') {
      flags.files.push(process.cwd());
    } else if (!arg.startsWith('-')) {
      if (arg.includes('node_modules') || 
          arg.includes('OpenMarkdownReader.app') || 
          arg === 'main.js' ||
          arg === '.') continue;
          
      if (path.isAbsolute(arg) || arg.includes('/') || arg.includes('\\') || arg.endsWith('.md')) {
        flags.files.push(arg);
      }
    }
  }

  return flags;
}

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    const win = getFocusedWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      
      const args = parseArgs(argv);
      
      // Apply flags to session
      if (args.watch) {
        watchFileMode = true;
        windows.forEach(w => w.webContents.send('set-watch-mode', true));
      }
      
      if (args.theme) {
        setTheme(args.theme);
      }

      if (args.monospace !== null) {
        config.editorMonospace = args.monospace;
        saveConfig();
        broadcastSetting('editor-monospace', args.monospace);
      }
      
      // Open daily notes if requested
      if (args.scratch) {
        createDailyNote(win, 'scratch');
      }
      if (args.ref) {
        createDailyNote(win, 'ref');
      }

      // Create new file if requested
      if (args.newFile) {
        win.webContents.send('new-file');
      }

      // Open any files passed
      args.files.forEach(file => {
        const fullPath = path.isAbsolute(file) ? file : path.join(workingDirectory, file);
        openPathInWindow(win, fullPath, { forceEdit: args.edit });
      });

      setupMenu(); // Update menu checkmarks
    }
  });
}

// Configuration Management
const configPath = path.join(app.getPath('userData'), 'config.json');
let config = {
  theme: 'system', // 'system', 'light', 'dark'
  recentFiles: [], // Array of { path, type: 'file' | 'folder', timestamp }
  maxRecentFiles: 10,
  contentWidth: 900,
  contentPadding: 20,
  editorMonospace: false, // Use monospace font in editor
  compactTables: false, // Compact table cells (nowrap + horizontal scroll)
  restoreSession: true, // Whether to restore previous session on launch
  session: null, // Saved session state: { windows: [{ tabs: [{filePath, fileName}], directory: dirPath }] }
  cliCommandPath: null,
  watchMode: false, // Watch for external file changes
  dailyNotesFolder: null, // Path to folder for daily notes
  dailyNotesFormat: 'YYYY-MM-DD', // Date format for filenames
  dailyNotesTemplate: '', // Optional template for new daily notes
  askedAboutDefaultApp: false // Whether we've asked to set as default
};

const CLI_COMMAND_NAMES = ['omr', 'openmd'];
const APP_BUNDLE_ID = 'com.jacobcole.openmarkdownreader';

// The CLI script is a thin wrapper that calls the main script inside the app bundle
// This way, CLI updates automatically when the app updates
function getCliScriptContents(commandName) {
  return `#!/usr/bin/env bash
# OpenMarkdownReader CLI wrapper
# This script delegates to the CLI inside the app bundle for auto-updates

APP_PATH="/Applications/OpenMarkdownReader.app"
BUNDLED_CLI="$APP_PATH/Contents/Resources/cli.sh"

if [[ -x "$BUNDLED_CLI" ]]; then
  exec "$BUNDLED_CLI" "$@"
else
  # Fallback if app not in /Applications or cli.sh missing
  APP_BUNDLE_ID="${APP_BUNDLE_ID}"
  if [[ $# -eq 0 ]]; then
    open -b "$APP_BUNDLE_ID" 2>/dev/null || open -a "OpenMarkdownReader"
  else
    open -b "$APP_BUNDLE_ID" --args "$@" 2>/dev/null || open -a "OpenMarkdownReader" --args "$@"
  fi
fi
`;
}

// The actual CLI implementation that lives inside the app bundle
function getCliImplementation() {
  return `#!/usr/bin/env bash
set -euo pipefail

APP_BUNDLE_ID="${APP_BUNDLE_ID}"
APP_NAME="OpenMarkdownReader"
APP_PATH="/Applications/OpenMarkdownReader.app"
VERSION="1.0.0"

# Get version from app's package.json if available
if [[ -f "$APP_PATH/Contents/Resources/app/package.json" ]]; then
  DETECTED_VERSION=$(grep '"version"' "$APP_PATH/Contents/Resources/app/package.json" 2>/dev/null | head -1 | sed 's/.*"version": *"\\([^"]*\\)".*/\\1/' || echo "$VERSION")
  VERSION="\${DETECTED_VERSION:-$VERSION}"
fi

if [[ "\${1:-}" == "--help" || "\${1:-}" == "-h" ]]; then
  echo "OpenMarkdownReader v$VERSION - A beautiful Markdown reader and editor"
  echo ""
  echo "Usage: omr [options] [path ...]"
  echo ""
  echo "Options:"
  echo "  -e, --edit           Open file(s) in edit mode"
  echo "  -w, --watch          Watch for external file changes"
  echo "  -s, --scratch        Open today's scratch note"
  echo "  -r, --ref            Open today's reference note"
  echo "  -t, --theme <mode>   Set theme (light, dark, system)"
  echo "      --monospace      Use monospace font in editor"
  echo "      --no-monospace   Use proportional font in editor"
  echo "      --no-session     Don't restore previous session"
  echo "  -n, --new            Create a new untitled file"
  echo "  -v, --version        Show version"
  echo "  -h, --help           Show this help message"
  echo ""
  echo "Examples:"
  echo "  omr                    Open app (restores last session)"
  echo "  omr .                  Open current directory in sidebar"
  echo "  omr README.md          Open a specific file"
  echo "  omr -e README.md       Open file in edit mode"
  echo "  omr -w README.md       Open and watch for changes"
  echo "  omr -s                 Open today's scratch note"
  echo "  omr --theme dark       Open with dark theme"
  echo "  omr -n                 Create new untitled file"
  exit 0
fi

if [[ "\${1:-}" == "--version" || "\${1:-}" == "-v" ]]; then
  echo "OpenMarkdownReader $VERSION"
  exit 0
fi

if [[ $# -eq 0 ]]; then
  open -b "$APP_BUNDLE_ID" 2>/dev/null || open -a "$APP_NAME"
  exit 0
fi

# Use --args to pass flags to the Electron app
open -b "$APP_BUNDLE_ID" --args "$@" 2>/dev/null || open -a "$APP_NAME" --args "$@"
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

  let installedPaths = [];
  let lastError = null;

  // Find a suitable directory for all commands
  let selectedDir = null;
  for (const dir of orderedCandidates) {
    const isUserDir = dir.startsWith(os.homedir());
    const ok = ensureWritableDir(dir, { create: isUserDir });
    if (ok) {
      selectedDir = dir;
      break;
    }
  }

  if (!selectedDir) {
    dialog.showErrorBox('Install Failed', 'No writable install location found in your PATH.');
    return;
  }

  for (const commandName of CLI_COMMAND_NAMES) {
    const target = path.join(selectedDir, commandName);
    const script = getCliScriptContents(commandName);

    try {
      if (fs.existsSync(target)) {
        const choice = dialog.showMessageBoxSync({
          type: 'question',
          buttons: ['Replace', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
          message: `A '${commandName}' command already exists at:\n${target}\n\nReplace it?`
        });
        if (choice !== 0) continue;
      }

      fs.writeFileSync(target, script, { encoding: 'utf-8' });
      fs.chmodSync(target, 0o755);
      installedPaths.push(target);
    } catch (err) {
      lastError = err;
    }
  }

  if (installedPaths.length === 0) {
    dialog.showErrorBox(
      'Install Failed',
      `Could not install terminal commands.\n\n${lastError ? String(lastError.message || lastError) : ''}`
    );
    return;
  }

  config.cliCommandPath = installedPaths[0]; // Store one for reference
  saveConfig();
  setupMenu();

  const inPath = isDirInPath(selectedDir);
  const nextSteps = inPath
    ? `Try it in Terminal:\n  ${CLI_COMMAND_NAMES[1]} README.md`
    : `Add this to your shell PATH (zsh):\n  echo 'export PATH=\"${selectedDir}:$PATH\"' >> ~/.zshrc\n  source ~/.zshrc\n\nThen try:\n  ${CLI_COMMAND_NAMES[1]} README.md`;

  dialog.showMessageBox({
    type: 'info',
    message: `Installed terminal commands`,
    detail: `Commands installed to: ${selectedDir}\n\nCommands: ${CLI_COMMAND_NAMES.join(', ')}\n\n${nextSteps}`
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

  const existingPaths = [];
  const candidates = getCliInstallCandidates();
  
  for (const dir of candidates) {
    for (const name of CLI_COMMAND_NAMES) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) existingPaths.push(p);
    }
  }

  if (existingPaths.length === 0) {
    dialog.showMessageBox({
      type: 'info',
      message: `No terminal commands found to uninstall.`
    });
    return;
  }

  const choice = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['Uninstall', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: `Found terminal commands at:\n${existingPaths.join('\n')}\n\nUninstall them?`
  });

  if (choice === 0) {
    let count = 0;
    for (const p of existingPaths) {
      try {
        fs.unlinkSync(p);
        count++;
      } catch (err) {
        console.error(`Failed to uninstall ${p}:`, err);
      }
    }

    config.cliCommandPath = null;
    saveConfig();
    setupMenu();

    dialog.showMessageBox({
      type: 'info',
      message: `Uninstalled ${count} command(s).`
    });
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
    fileWatchStates.delete(watchKey);
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
      sandbox: false, // Allow preload to use Node modules like 'path'
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const winId = win.id;
  windows.add(win);
  agentServer.emitEvent('window-created', { windowId: winId });
  win.on('closed', () => {
    cleanupFileWatchersForWindow(winId);
    windows.delete(win);
    agentServer.emitEvent('window-closed', { windowId: winId });
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

  // ── White-screen / crash diagnostics ──
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[LOAD FAIL] code=${errorCode} desc="${errorDescription}" url=${validatedURL}`);
  });

  win.webContents.on('render-process-gone', (event, details) => {
    handleProcessCrash('renderer', details, win);
  });

  win.webContents.on('unresponsive', () => {
    console.error('[UNRESPONSIVE] Window became unresponsive');
  });

  win.webContents.on('responsive', () => {
    console.log('[RESPONSIVE] Window recovered');
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 2) { // errors only
      console.error(`[Renderer ERROR] ${message} (${sourceId}:${line})`);
    }
  });

  // Native text/edit context menu parity (Copy/Paste/Look Up/Speech, etc.).
  win.webContents.on('context-menu', (event, params) => {
    const template = [];
    const hasSelection = Boolean(params.selectionText && params.selectionText.trim());
    const canPaste = Boolean(params.editFlags && params.editFlags.canPaste);

    if (params.isEditable) {
      template.push(
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste', enabled: canPaste },
        { role: 'selectAll' }
      );
    } else if (hasSelection) {
      template.push({ role: 'copy' });
    }

    if (hasSelection && process.platform === 'darwin') {
      if (template.length > 0) template.push({ type: 'separator' });
      template.push(
        { role: 'lookUpSelection' },
        { role: 'startSpeaking' },
        { role: 'stopSpeaking' }
      );
    }

    if (template.length === 0) return;
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: win });
  });

  // Open DevTools in development mode
  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

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
    win.webContents.send('setting-changed', { setting: 'editor-monospace', value: config.editorMonospace || false });
    win.webContents.send('setting-changed', { setting: 'compact-tables', value: config.compactTables || false });
    win.webContents.send('setting-changed', { key: 'noos-widget', value: config.noosWidget === true });

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
  agentServer.emitEvent('setting-changed', { key: 'theme', value: theme });
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
        {
          label: getUpdateStatusLabel(),
          enabled: false
        },
        {
          label: 'Check for Updates...',
          enabled: !isMASBuild(),
          click: () => checkForUpdates({ manual: true })
        },
        ...(latestRelease
          ? [{
              label: `Download Update (${latestRelease.version})...`,
              click: () => shell.openExternal(latestRelease.url)
            }]
          : []),
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        {
          label: 'Restart',
          accelerator: 'CmdOrCtrl+Alt+R',
          click: () => {
            app.relaunch();
            app.exit(0);
          }
        },
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
        { type: 'separator' },
        {
          label: 'New Daily Note (Scratch)',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: async () => {
            const win = getFocusedWindow();
            if (win) await createDailyNote(win, 'scratch', true);
          }
        },
        {
          label: 'New Daily Note (Reference)',
          accelerator: 'CmdOrCtrl+Alt+D',
          click: async () => {
            const win = getFocusedWindow();
            if (win) await createDailyNote(win, 'ref', true);
          }
        },
        {
          label: 'Browse Daily Notes Folder',
          click: async () => {
            const win = getFocusedWindow();
            if (win) await browseDailyNotesFolder(win);
          }
        },
        {
          label: 'Show Daily Notes Folder in Finder',
          click: async () => {
            const win = getFocusedWindow();
            if (win) await openDailyNotesFolder(win);
          }
        },
        { type: 'separator' },
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
        {
          label: 'Reveal in Finder',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('reveal-active-file-in-finder');
          }
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('save');
          }
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('save-as');
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
        {
          label: 'Search in Files',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('show-global-search');
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
          label: 'Revert Changes',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('revert');
          }
        }
      ]
    },
    {
      label: 'Go',
      submenu: [
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+[',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('nav-back');
          }
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('nav-forward');
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
          label: 'Terminal View',
          type: 'checkbox',
          checked: false,
          accelerator: 'CmdOrCtrl+Shift+T',
          click: (menuItem) => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('toggle-terminal-view', menuItem.checked);
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
              label: 'Extra Wide (1300px)',
              type: 'radio',
              checked: config.contentWidth === 1300,
              click: () => {
                config.contentWidth = 1300;
                saveConfig();
                broadcastSetting('content-width', 1300);
              }
            },
            {
              label: 'Ultra Wide (1500px)',
              type: 'radio',
              checked: config.contentWidth === 1500,
              click: () => {
                config.contentWidth = 1500;
                saveConfig();
                broadcastSetting('content-width', 1500);
              }
            },
            {
              label: 'Super Wide (1800px)',
              type: 'radio',
              checked: config.contentWidth === 1800,
              click: () => {
                config.contentWidth = 1800;
                saveConfig();
                broadcastSetting('content-width', 1800);
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
            },
            { type: 'separator' },
            {
              label: typeof config.contentWidth === 'number' && ![700, 900, 1100, 1300, 1500, 1800].includes(config.contentWidth)
                ? `Custom (${config.contentWidth}px)`
                : 'Custom...',
              type: 'radio',
              checked: typeof config.contentWidth === 'number' && ![700, 900, 1100, 1300, 1500, 1800].includes(config.contentWidth),
              click: async () => {
                const win = getFocusedWindow();
                if (win) win.webContents.send('show-custom-width-dialog');
              }
            }
          ]
        },
        {
          label: 'Content Margins',
          submenu: [
            {
              label: 'Minimal',
              type: 'radio',
              checked: config.contentPadding === 8,
              click: () => {
                config.contentPadding = 8;
                saveConfig();
                broadcastSetting('content-padding', 8);
              }
            },
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
            },
            {
              label: 'Extra Spacious',
              type: 'radio',
              checked: config.contentPadding === 40,
              click: () => {
                config.contentPadding = 40;
                saveConfig();
                broadcastSetting('content-padding', 40);
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
          id: 'auto-save-item',
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
          label: 'Monospace Editor Font',
          type: 'checkbox',
          checked: config.editorMonospace || false,
          click: (menuItem) => {
            config.editorMonospace = menuItem.checked;
            saveConfig();
            broadcastSetting('editor-monospace', menuItem.checked);
          }
        },
        {
          label: 'Compact Tables',
          type: 'checkbox',
          checked: config.compactTables || false,
          click: (menuItem) => {
            config.compactTables = menuItem.checked;
            saveConfig();
            broadcastSetting('compact-tables', menuItem.checked);
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
        },
        {
          label: 'Noos Feedback Widget',
          id: 'noos-widget-item',
          type: 'checkbox',
          checked: config.noosWidget === true, // default off
          click: (menuItem) => {
            config.noosWidget = menuItem.checked;
            saveConfig();
            windows.forEach(win => {
              win.webContents.send('setting-changed', { key: 'noos-widget', value: menuItem.checked });
            });
          }
        },
        { type: 'separator' },
        {
          label: 'Set Daily Notes Folder...',
          click: async () => {
            const win = getFocusedWindow();
            if (win) {
              await getDailyNotesFolder(win);
            }
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
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            const win = getFocusedWindow();
            if (win) win.webContents.send('show-report-issue');
          }
        },
        {
          label: 'GitHub Issues',
          click: () => shell.openExternal('https://github.com/tmad4000/OpenMarkdownReader/issues')
        },
        { type: 'separator' },
        {
          label: 'Set as Default Markdown App…',
          enabled: process.platform === 'darwin',
          click: async () => {
            const win = getFocusedWindow();
            dialog.showMessageBox(win, {
              type: 'info',
              buttons: ['OK'],
              title: 'Set Default App',
              message: 'To set OpenMarkdownReader as your default:',
              detail: '1. Find any .md file in Finder\n2. Right-click → Get Info (or ⌘I)\n3. Under "Open with:", select OpenMarkdownReader\n4. Click "Change All..." to apply to all .md files'
            });
          }
        },
        { type: 'separator' },
        {
          label: 'Copy Diagnostic Info',
          click: () => {
            const diagInfo = [
              `OpenMarkdownReader v${buildInfo.version} (build ${buildInfo.buildNumber}, ${buildInfo.gitHash})`,
              `Build date: ${buildInfo.buildDate}`,
              `Platform: ${process.platform} ${os.release()}`,
              `Arch: ${process.arch}`,
              `Electron: ${process.versions.electron}`,
              `Node: ${process.versions.node}`,
              `Chrome: ${process.versions.chrome}`,
              `MAS build: ${isMASBuild()}`,
              `Log path: ${log.transports.file.getFile().path}`,
            ].join('\n');
            clipboard.writeText(diagInfo);
            const win = getFocusedWindow();
            if (win) win.webContents.send('show-toast', 'Diagnostic info copied to clipboard', 'success');
          }
        },
        {
          label: 'Open Log File…',
          click: () => {
            const logPath = log.transports.file.getFile().path;
            shell.showItemInFolder(logPath);
          }
        },
        {
          label: 'Show Crash Dumps…',
          click: () => {
            const dumpDir = path.join(app.getPath('userData'), 'Crashpad', 'completed');
            // Make sure the directory exists so showItemInFolder doesn't no-op
            try { fs.mkdirSync(dumpDir, { recursive: true }); } catch {}
            shell.openPath(dumpDir);
          }
        },
        { type: 'separator' },
        {
          label: `Install '${CLI_COMMAND_NAMES.join("' and '")}' Commands in PATH…`,
          visible: process.platform === 'darwin' && !isMASBuild(),
          click: () => installCliCommand()
        },
        {
          label: `Uninstall '${CLI_COMMAND_NAMES.join("' and '")}' Commands…`,
          visible: process.platform === 'darwin' && !isMASBuild(),
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

  // Don't use filters on macOS - they can gray out files unexpectedly
  // The app can open any text file, so let users see everything
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'openDirectory', 'multiSelections', 'treatPackageAsDirectory']
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
    const stats = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath);
    win.webContents.send('file-loaded', {
      content,
      fileName,
      filePath,
      mtime: stats.mtimeMs,
      openInBackground: options.background || false,
      forceNewTab: options.newTab || false,
      reuseTab: options.reuseTab || null,
      forceEdit: options.forceEdit || false
    });
    if (!options.background) {
      win.setTitle(`${fileName} - OpenMarkdownReader`);
    }
    addToRecent(filePath, 'file');
    agentServer.emitEvent('file-opened', { filePath, fileName });
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
      // Bring window to foreground when opened from Finder
      win.show();
      win.focus();
      app.focus({ steal: true });
    } else {
      createWindow(filePath);
    }
  } else {
    // Queue the file - whenReady handler will process it instead of creating a blank window
    pendingOpenFiles.push(filePath);
  }
});

// Save session state from all windows before quit
async function saveSession() {
  if (!config.restoreSession) return;

  const sessionWindows = [];

  for (const win of windows) {
    // Skip windows whose webContents have been destroyed (e.g. crashed renderer
    // before we cleaned up the BrowserWindow). Otherwise win.webContents.send()
    // throws "Render frame was disposed before WebFrameMain could be accessed".
    if (win.isDestroyed() || !win.webContents || win.webContents.isDestroyed() || win.webContents.isCrashed()) {
      continue;
    }

    try {
      const sessionData = await new Promise((resolve) => {
        const responseHandler = (event, data) => {
          if (event.sender !== win.webContents) return;
          ipcMain.removeListener('session-state', responseHandler);
          resolve(data);
        };

        ipcMain.on('session-state', responseHandler);
        try {
          win.webContents.send('get-session-state');
        } catch (sendErr) {
          // Renderer was destroyed between the check above and the send call
          ipcMain.removeListener('session-state', responseHandler);
          resolve(null);
          return;
        }

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

// Check if we should prompt to set as default markdown app
async function promptSetAsDefaultApp() {
  if (process.platform !== 'darwin') return;
  if (config.askedAboutDefaultApp) return;

  // Wait a moment for the window to be ready
  await new Promise(resolve => setTimeout(resolve, 1500));

  const win = getFocusedWindow();
  if (!win) return;

  const result = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Set as Default', 'Not Now', "Don't Ask Again"],
    defaultId: 0,
    cancelId: 1,
    title: 'Default Markdown Reader',
    message: 'Would you like to set OpenMarkdownReader as your default app for Markdown files?',
    detail: 'This will open .md files in this app when you double-click them in Finder.'
  });

  if (result.response === 0) {
    // Set as Default - open System Settings
    // On macOS Ventura+, this is the path to change default apps
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');

    // Also show instructions
    dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['OK'],
      title: 'Set Default App',
      message: 'To set OpenMarkdownReader as your default:',
      detail: '1. Find any .md file in Finder\n2. Right-click → Get Info (or ⌘I)\n3. Under "Open with:", select OpenMarkdownReader\n4. Click "Change All..." to apply to all .md files'
    });

    config.askedAboutDefaultApp = true;
    saveConfig();
  } else if (result.response === 2) {
    // Don't Ask Again
    config.askedAboutDefaultApp = true;
    saveConfig();
  }
  // "Not Now" doesn't save - will ask again next launch
}

// Check GitHub for updates
let latestRelease = null;
let updateCheckStatus = 'idle'; // idle | checking | available | up_to_date | error

// Compare semver strings: returns true if remote is newer than local
function isNewerVersion(remote, local) {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}
let updateCheckError = '';
let updateLastCheckedAt = null;

function getUpdateStatusLabel() {
  if (isMASBuild()) return 'Updates are managed by the Mac App Store';
  if (updateCheckStatus === 'checking') return 'Update Status: Checking...';
  if (updateCheckStatus === 'available' && latestRelease) {
    return `Update Status: ${latestRelease.version} available`;
  }
  if (updateCheckStatus === 'up_to_date') {
    return `Update Status: Up to date${updateLastCheckedAt ? ` (checked ${new Date(updateLastCheckedAt).toLocaleTimeString()})` : ''}`;
  }
  if (updateCheckStatus === 'error') return `Update Status: Check failed${updateCheckError ? ` (${updateCheckError})` : ''}`;
  return 'Update Status: Not checked yet';
}

function checkForUpdates(options = {}) {
  const manual = Boolean(options.manual);
  if (isMASBuild()) return;
  updateCheckStatus = 'checking';
  updateCheckError = '';
  updateLastCheckedAt = Date.now();
  setupMenu();

  const repo = 'tmad4000/OpenMarkdownReader';
  const requestOptions = {
    hostname: 'api.github.com',
    path: `/repos/${repo}/releases/latest`,
    headers: { 'User-Agent': 'OpenMarkdownReader' }
  };

  const req = https.get(requestOptions, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const release = JSON.parse(data);
        if (release.tag_name) {
          const remoteVersion = release.tag_name.replace(/^v/, '');
          if (isNewerVersion(remoteVersion, buildInfo.version)) {
            latestRelease = {
              version: remoteVersion,
              url: release.html_url,
              name: release.name || release.tag_name
            };
            updateCheckStatus = 'available';
            // Notify all windows
            for (const win of windows) {
              if (!win.isDestroyed()) {
                win.webContents.send('update-available', latestRelease);
              }
            }
          } else {
            latestRelease = null;
            updateCheckStatus = 'up_to_date';
            if (manual) {
              const win = getFocusedWindow();
              if (win && !win.isDestroyed()) {
                dialog.showMessageBox(win, {
                  type: 'info',
                  buttons: ['OK'],
                  title: 'No Updates Available',
                  message: `You are up to date (v${buildInfo.version}).`
                });
              }
            }
          }
        }
      } catch (err) {
        updateCheckStatus = 'error';
        updateCheckError = (err && err.message) ? err.message : 'parse error';
      }
      setupMenu();
    });
  });
  req.on('error', (err) => {
    updateCheckStatus = 'error';
    updateCheckError = (err && err.message) ? err.message : 'network error';
    setupMenu();
  });
  req.end();
}

app.whenReady().then(() => {
  const args = parseArgs(process.argv);

  if (args.watch) {
    watchFileMode = true;
  }

  if (args.theme) {
    config.theme = args.theme;
  }

  if (args.monospace !== null) {
    config.editorMonospace = args.monospace;
  }

  setupMenu();

  // Set About panel with build info
  const buildSuffix = buildInfo.buildNumber ? ` (Build ${buildInfo.buildNumber})` : '';
  app.setAboutPanelOptions({
    applicationName: 'OpenMarkdownReader',
    applicationVersion: `${buildInfo.version}${buildSuffix}`,
    version: buildInfo.gitHash !== 'dev' ? buildInfo.gitHash : '',
    copyright: 'Jacob Cole'
  });

  // Set dev dock icon when running unpackaged
  // Picks the right variant based on edition (standard vs local-only)
  if (!app.isPackaged && process.platform === 'darwin') {
    try {
      // Detect local-only edition via env var (set by build:mas-local-only script).
      // When the dual-edition system lands (ticket markdown-reader-xwc), this
      // should read from build-edition.js instead.
      const isLocalOnly = process.env.OMR_EDITION === 'local-only';
      const devIconName = isLocalOnly ? 'icon-local-only-dev.png' : 'icon-dev.png';
      const iconPath = path.join(__dirname, 'build', devIconName);
      if (fs.existsSync(iconPath)) {
        app.dock.setIcon(iconPath);
      }
    } catch {}
  }

  // Check for updates (non-blocking, after short delay)
  if (!isMASBuild()) {
    setTimeout(checkForUpdates, 3000);
  }

  // Prompt to set as default app (after a delay)
  promptSetAsDefaultApp();

  // Merge any files received via open-file event (Finder double-click / Open With)
  // These arrive before ready and are queued in pendingOpenFiles
  if (pendingOpenFiles.length > 0) {
    pendingOpenFiles.forEach(f => {
      if (!args.files.includes(f)) args.files.push(f);
    });
    pendingOpenFiles.length = 0;
  }

  // Handle files, daily notes, or new file passed via CLI or Finder on launch
  if (args.files.length > 0 || args.scratch || args.ref || args.newFile) {
    const win = createWindow();
    win.webContents.on('did-finish-load', () => {
      if (args.scratch) createDailyNote(win, 'scratch');
      if (args.ref) createDailyNote(win, 'ref');
      if (args.newFile) win.webContents.send('new-file');

      args.files.forEach(file => {
        const fullPath = path.isAbsolute(file) ? file : path.resolve(file);
        openPathInWindow(win, fullPath, { forceEdit: args.edit });
      });
    });
  } else if (args.noSession || !restoreSession()) {
    createWindow();
  }

  // Auto-save session periodically (survives crashes/force-kills)
  // We use a short interval since saveSession is lightweight
  setInterval(() => {
    if (windows.size > 0) {
      saveSession();
    }
  }, 5000); // Every 5 seconds

  // Start agent control server (Unix socket for CLI/agent access)
  agentServer.startServer();
  registerAgentCommands();
});

// Save session before quitting
app.on('before-quit', async (e) => {
  app.isQuittingForReal = true;
  agentServer.stopServer();
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

// ─── Agent Command Registration ───────────────────────────────────────
// Register all commands available via the Unix socket (omr --cmd ...)

function queryRendererState(win, channel) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 2000);
    const handler = (event, data) => {
      if (event.sender === win.webContents) {
        clearTimeout(timeout);
        ipcMain.removeListener(channel, handler);
        resolve(data);
      }
    };
    ipcMain.on(channel, handler);
    win.webContents.send(channel.replace('-result', '').replace('app-state', 'get-app-state').replace('tab-content', 'get-tab-content'));
  });
}

function getRendererAppState(win) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 2000);
    const handler = (event, data) => {
      if (event.sender === win.webContents) {
        clearTimeout(timeout);
        ipcMain.removeListener('app-state', handler);
        resolve(data);
      }
    };
    ipcMain.on('app-state', handler);
    win.webContents.send('get-app-state');
  });
}

function getRendererTabContent(win, tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 2000);
    const handler = (event, data) => {
      if (event.sender === win.webContents) {
        clearTimeout(timeout);
        ipcMain.removeListener('tab-content', handler);
        resolve(data);
      }
    };
    ipcMain.on('tab-content', handler);
    win.webContents.send('get-tab-content', tabId);
  });
}

function sendRendererCommand(win, cmd) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ error: 'Renderer timeout' }), 2000);
    const handler = (event, data) => {
      if (event.sender === win.webContents) {
        clearTimeout(timeout);
        ipcMain.removeListener('agent-command-result', handler);
        resolve(data);
      }
    };
    ipcMain.on('agent-command-result', handler);
    win.webContents.send('agent-command', cmd);
  });
}

function registerAgentCommands() {
  // ── State Queries ──

  agentServer.registerCommand('get-state', async () => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    const state = await getRendererAppState(win);
    if (!state) return { error: 'Renderer did not respond' };
    // Add main-process info
    state.window = {
      id: win.id,
      bounds: win.getBounds(),
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen(),
      isFocused: win.isFocused()
    };
    state.config = {
      theme: config.theme,
      contentWidth: config.contentWidth,
      contentPadding: config.contentPadding,
      editorMonospace: config.editorMonospace,
      compactTables: config.compactTables,
      restoreSession: config.restoreSession,
      watchMode: config.watchMode,
      autoSave: config.autoSave,
      dailyNotesFolder: config.dailyNotesFolder
    };
    state.app = {
      version: buildInfo.version,
      buildNumber: buildInfo.buildNumber,
      gitHash: buildInfo.gitHash,
      buildDate: buildInfo.buildDate,
      channel: buildInfo.channel,
      isDev: buildInfo.isDev === true,
      pid: process.pid,
      isPackaged: app.isPackaged
    };
    state.windowCount = windows.size;
    return state;
  });

  agentServer.registerCommand('list-tabs', async () => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    const state = await getRendererAppState(win);
    if (!state) return { error: 'Renderer did not respond' };
    return { tabs: state.tabs };
  });

  agentServer.registerCommand('get-content', async (args) => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    const tabId = args.tab || args.path || args.filePath;
    if (!tabId && tabId !== 0) return { error: 'Specify tab (index, id, or path)' };
    const content = await getRendererTabContent(win, tabId);
    if (!content) return { error: 'Renderer did not respond' };
    return content;
  });

  agentServer.registerCommand('list-windows', async () => {
    const result = [];
    for (const win of windows) {
      result.push({
        id: win.id,
        bounds: win.getBounds(),
        isMaximized: win.isMaximized(),
        isFullScreen: win.isFullScreen(),
        isFocused: win.isFocused(),
        title: win.getTitle()
      });
    }
    return { windows: result };
  });

  // ── Tab Operations ──

  agentServer.registerCommand('switch-tab', async (args) => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    return sendRendererCommand(win, { action: 'switch-tab', tab: args.tab ?? args.index ?? args.path });
  });

  agentServer.registerCommand('close-tab', async (args) => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    return sendRendererCommand(win, { action: 'close-tab', tab: args.tab ?? args.index ?? args.path });
  });

  agentServer.registerCommand('new-tab', async () => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    win.webContents.send('new-file');
    return {};
  });

  // ── File Operations ──

  agentServer.registerCommand('open', async (args) => {
    const filePath = args.path || args.file;
    if (!filePath) return { error: 'Specify path' };
    const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
    // --new-window opens the path in a freshly created window (good for folders
    // when you don't want to disturb the current workspace).
    if (args.newWindow || args['new-window']) {
      const newWin = createWindow(fullPath);
      return { opened: fullPath, window: 'new' };
    }
    const win = getFocusedWindow() || createWindow();
    openPathInWindow(win, fullPath, { forceEdit: args.edit || false, background: args.background || false });
    return { opened: fullPath };
  });

  agentServer.registerCommand('save', async () => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    return sendRendererCommand(win, { action: 'save' });
  });

  agentServer.registerCommand('save-all', async () => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    return sendRendererCommand(win, { action: 'save-all' });
  });

  // ── Edit Operations ──

  agentServer.registerCommand('toggle-edit', async () => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    return sendRendererCommand(win, { action: 'toggle-edit' });
  });

  agentServer.registerCommand('set-content', async (args) => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    if (args.content === undefined) return { error: 'Specify content' };
    return sendRendererCommand(win, { action: 'set-content', content: args.content });
  });

  agentServer.registerCommand('insert', async (args) => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    if (!args.text) return { error: 'Specify text' };
    return sendRendererCommand(win, { action: 'insert', text: args.text, position: args.position || 'cursor' });
  });

  // Internal debug command — exposes per-tab editor DOM state for testing
  agentServer.registerCommand('_debug-editor-state', async () => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    return sendRendererCommand(win, { action: '_debug-editor-state' });
  });

  // ── View Operations ──

  agentServer.registerCommand('toggle-sidebar', async () => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    return sendRendererCommand(win, { action: 'toggle-sidebar' });
  });

  agentServer.registerCommand('set-sidebar', async (args) => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    return sendRendererCommand(win, { action: 'set-sidebar', visible: args.visible !== false });
  });

  agentServer.registerCommand('scroll-to', async (args) => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    return sendRendererCommand(win, { action: 'scroll-to', line: args.line, top: args.top });
  });

  agentServer.registerCommand('find', async (args) => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    return sendRendererCommand(win, { action: 'find', query: args.query });
  });

  // ── Navigation ──

  agentServer.registerCommand('nav-back', async () => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    return sendRendererCommand(win, { action: 'nav-back' });
  });

  agentServer.registerCommand('nav-forward', async () => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    return sendRendererCommand(win, { action: 'nav-forward' });
  });

  // ── Settings ──

  agentServer.registerCommand('set', async (args) => {
    const key = args.key || args.setting;
    const value = args.value;
    if (!key) return { error: 'Specify key' };

    switch (key) {
      case 'theme':
        if (['light', 'dark', 'system'].includes(value)) {
          setTheme(value);
          return { theme: value };
        }
        return { error: 'Theme must be light, dark, or system' };
      case 'content-width':
      case 'contentWidth':
        config.contentWidth = parseInt(value) || 900;
        saveConfig();
        broadcastSetting('content-width', config.contentWidth);
        return { contentWidth: config.contentWidth };
      case 'monospace':
      case 'editorMonospace':
        config.editorMonospace = !!value;
        saveConfig();
        broadcastSetting('editor-monospace', config.editorMonospace);
        return { editorMonospace: config.editorMonospace };
      case 'read-only':
      case 'readOnly': {
        const win = getFocusedWindow();
        if (win) {
          isReadOnlyMode = !!value;
          win.webContents.send('set-read-only', isReadOnlyMode);
          setupMenu();
        }
        return { readOnly: isReadOnlyMode };
      }
      case 'watch-mode':
      case 'watchMode':
        watchFileMode = !!value;
        config.watchMode = watchFileMode;
        saveConfig();
        windows.forEach(w => w.webContents.send('set-watch-mode', watchFileMode));
        setupMenu();
        return { watchMode: watchFileMode };
      default:
        return { error: `Unknown setting: ${key}` };
    }
  });

  agentServer.registerCommand('get-config', async () => {
    return {
      theme: config.theme,
      contentWidth: config.contentWidth,
      contentPadding: config.contentPadding,
      editorMonospace: config.editorMonospace,
      compactTables: config.compactTables,
      restoreSession: config.restoreSession,
      watchMode: config.watchMode,
      autoSave: config.autoSave,
      dailyNotesFolder: config.dailyNotesFolder,
      readOnly: isReadOnlyMode
    };
  });

  // ── Daily Notes ──

  agentServer.registerCommand('daily-note', async (args) => {
    const win = getFocusedWindow() || createWindow();
    const type = args.type || 'scratch';
    const result = await createDailyNote(win, type);
    return result || {};
  });

  // ── Window Operations ──

  agentServer.registerCommand('new-window', async () => {
    createWindow();
    return {};
  });

  agentServer.registerCommand('focus', async () => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    win.show();
    win.focus();
    return {};
  });

  // ── Search ──

  agentServer.registerCommand('search', async (args) => {
    if (!args.query) return { error: 'Specify query' };
    const win = getFocusedWindow();
    const dir = args.dir || args.directory;
    let searchDir = dir;
    if (!searchDir && win) {
      const state = await getRendererAppState(win);
      searchDir = state && state.sidebar && state.sidebar.directory;
    }
    if (!searchDir) return { error: 'No directory open. Specify --dir' };
    const results = searchInDirectorySync(searchDir, args.query, {
      maxResults: args.maxResults || 100,
      caseSensitive: args.caseSensitive || false
    });
    return { results, totalFiles: results.length };
  });

  // ── Export ──

  agentServer.registerCommand('export-pdf', async (args) => {
    const win = getFocusedWindow();
    if (!win) return { error: 'No window open' };
    const outPath = args.output || args.path;
    if (outPath) {
      // Non-interactive PDF export
      try {
        const pdfData = await win.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4'
        });
        fs.writeFileSync(outPath, pdfData);
        return { exported: outPath };
      } catch (err) {
        return { error: err.message };
      }
    } else {
      // Interactive (dialog)
      win.webContents.send('export-pdf');
      return { prompted: true };
    }
  });
}

// Synchronous (blocking) search for agent use
function searchInDirectorySync(dirPath, query, options = {}) {
  const results = [];
  const maxResults = options.maxResults || 100;
  const caseSensitive = options.caseSensitive || false;
  const searchQuery = caseSensitive ? query : query.toLowerCase();

  function searchDir(dir) {
    if (results.length >= maxResults) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build' || entry.name === 'vendor') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        searchDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        if (!textFileExtensions.includes(ext) && ext !== '') continue;
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const lines = content.split('\n');
          const matches = [];
          for (let i = 0; i < lines.length; i++) {
            const line = caseSensitive ? lines[i] : lines[i].toLowerCase();
            if (line.includes(searchQuery)) {
              matches.push({ line: i + 1, text: lines[i].trim().slice(0, 200) });
            }
          }
          if (matches.length > 0) {
            results.push({ file: fullPath, matches });
          }
        } catch {}
      }
    }
  }
  searchDir(dirPath);
  return results;
}

// IPC handlers
ipcMain.handle('get-build-info', () => ({ ...buildInfo, isPackaged: app.isPackaged }));
ipcMain.handle('get-update-info', () => latestRelease);
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
    const stats = fs.statSync(filePath);
    agentServer.emitEvent('file-saved', { filePath, fileName: path.basename(filePath) });
    return { success: true, mtime: stats.mtimeMs };
  } catch (err) {
    dialog.showErrorBox('Save Error', `Could not save file: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// Create file in directory
ipcMain.handle('create-file-in-directory', async (event, dirPath, fileName) => {
  try {
    const filePath = path.join(dirPath, fileName);

    // Check if file already exists (including case-insensitive collisions)
    if (findNameCollisionInDirectory(dirPath, fileName)) {
      return { success: false, error: 'A file with that name already exists' };
    }

    // Create empty file
    fs.writeFileSync(filePath, '', 'utf-8');
    return { success: true, filePath, fileName };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Create folder in directory
ipcMain.handle('create-folder-in-directory', async (event, dirPath, folderName) => {
  try {
    const folderPath = path.join(dirPath, folderName);

    // Check if folder already exists (including case-insensitive collisions)
    if (findNameCollisionInDirectory(dirPath, folderName)) {
      return { success: false, error: 'A folder with that name already exists' };
    }

    // Create folder
    fs.mkdirSync(folderPath);
    return { success: true, folderPath, folderName };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Move file into directory (sidebar drag and drop)
ipcMain.handle('move-file-to-directory', async (event, sourcePath, targetDirPath) => {
  return moveFileToDirectory(sourcePath, targetDirPath);
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
      const stats = fs.statSync(result.filePath);
      return {
        filePath: result.filePath,
        fileName: path.basename(result.filePath),
        mtime: stats.mtimeMs
      };
    } catch (err) {
      dialog.showErrorBox('Save Error', `Could not save file: ${err.message}`);
      return null;
    }
  }
  return null;
});

// Get file modification time
ipcMain.handle('get-file-mtime', async (event, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return stats.mtimeMs;
  } catch (err) {
    return null;
  }
});

async function getDailyNotesFolder(win) {
  // If not set, try a smart default
  if (!config.dailyNotesFolder) {
    const defaultPath = path.join(os.homedir(), 'Documents', 'Daily Notes');
    if (!fs.existsSync(defaultPath)) {
      try {
        fs.mkdirSync(defaultPath, { recursive: true });
      } catch (err) {
        console.error('Failed to create default daily notes folder:', err);
      }
    }
    if (fs.existsSync(defaultPath)) {
      config.dailyNotesFolder = defaultPath;
      saveConfig();
    }
  }

  // If still not set or doesn't exist, prompt
  if (!config.dailyNotesFolder || !fs.existsSync(config.dailyNotesFolder)) {
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Daily Notes Folder',
      properties: ['openDirectory', 'createDirectory']
    });
    
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    
    config.dailyNotesFolder = result.filePaths[0];
    saveConfig();
  }
  
  return config.dailyNotesFolder;
}

async function openDailyNotesFolder(win) {
  const folder = await getDailyNotesFolder(win);
  if (folder) {
    shell.openPath(folder);
  }
}

async function browseDailyNotesFolder(win) {
  const folder = await getDailyNotesFolder(win);
  if (folder) {
    openPathInWindow(win, folder);
  }
}

async function createDailyNote(win, type, forceNew = false) {
  // 1. Ensure folder exists
  let folder = await getDailyNotesFolder(win);
  if (!folder) return null;
  let createdNewFile = false;
  
  // 2. Generate filename
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let fileName = `${dateStr}-${type}.md`;
  let filePath = path.join(folder, fileName);
  
  // If forceNew is requested and file exists, find a unique name
  if (forceNew && fs.existsSync(filePath)) {
    let counter = 1;
    while (fs.existsSync(filePath)) {
      fileName = `${dateStr}-${type}-${counter}.md`;
      filePath = path.join(folder, fileName);
      counter++;
    }
  }
  
  // 3. Create if doesn't exist
  if (!fs.existsSync(filePath)) {
    try {
      const initialContent = config.dailyNotesTemplate || `# Daily Note (${type.toUpperCase()}) - ${dateStr}\n\n`;
      fs.writeFileSync(filePath, initialContent, 'utf-8');
      createdNewFile = true;
    } catch (err) {
      dialog.showErrorBox('Error', `Could not create daily note: ${err.message}`);
      return null;
    }
  }
  
  // 4. Open the file
  // New files should open in edit mode so users can start typing immediately.
  loadMarkdownFile(win, filePath, { forceEdit: createdNewFile });
  return { filePath, fileName };
}

// Get daily notes folder, prompt if not set
ipcMain.handle('get-daily-notes-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return await getDailyNotesFolder(win);
});

// Open daily notes folder in OS
ipcMain.handle('open-daily-notes-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return await openDailyNotesFolder(win);
});

// Browse daily notes folder in app
ipcMain.handle('browse-daily-notes-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return await browseDailyNotesFolder(win);
});

// Create or open a daily note
ipcMain.handle('create-daily-note', async (event, type, forceNew = true) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return await createDailyNote(win, type, forceNew);
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

// Open a folder as the workspace of a new window (markdown-reader-7qf).
// This is the safer alternative to replacing the current workspace —
// matches VS Code's "Open Folder in New Window" behavior.
ipcMain.handle('open-folder-in-new-window', async (event, folderPath) => {
  if (!folderPath) return;
  // Expand ~ if present
  if (folderPath === '~' || folderPath === '~/') {
    folderPath = os.homedir();
  } else if (typeof folderPath === 'string' && folderPath.startsWith('~/')) {
    folderPath = path.join(os.homedir(), folderPath.slice(2));
  }
  createWindow(folderPath);
});

// Open file by path (from sidebar or recent palette)
ipcMain.handle('open-file-by-path', async (event, filePath, options = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  // Expand ~ and ~/... to the user's home directory (mainly for Cmd+P input)
  if (filePath === '~' || filePath === '~/') {
    filePath = os.homedir();
  } else if (typeof filePath === 'string' && filePath.startsWith('~/')) {
    filePath = path.join(os.homedir(), filePath.slice(2));
  }
  openPathInWindow(win, filePath, options);
});

// Get directory contents (for expanding folders in sidebar)
ipcMain.handle('get-directory-contents', async (event, dirPath) => {
  return getDirectoryContents(dirPath);
});

// Get all files (and folders) recursively (for command palette search).
// Cmd+P needs folders so users can pick a folder and "open as project".
ipcMain.handle('get-all-files-recursive', async (event, dirPath) => {
  return getAllFilesRecursive(dirPath, 5, { includeDirs: true });
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
function getAllFilesRecursive(dirPath, maxDepth = 5, options = {}) {
  const includeDirs = options.includeDirs || false;
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
          if (includeDirs) {
            // Add the folder itself as a result so Cmd+P can match it
            let mtime = 0;
            try { mtime = fs.statSync(fullPath).mtimeMs; } catch {}
            files.push({
              name: entry.name,
              path: fullPath,
              type: 'folder',
              isMarkdown: false,
              isTextFile: false,
              mtime
            });
          }
          scan(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const isMarkdown = isMarkdownFileExt(entry.name);
          const isTextFile = isTextFileExt(entry.name);
          let mtime = 0;
          try {
            mtime = fs.statSync(fullPath).mtimeMs;
          } catch (e) {}

          files.push({
            name: entry.name,
            path: fullPath,
            type: 'file',
            isMarkdown,
            isTextFile,
            mtime
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

// Toggle auto-save from renderer
ipcMain.handle('toggle-auto-save', async () => {
  const menu = Menu.getApplicationMenu();
  const item = menu.getMenuItemById('auto-save-item');
  if (item) {
    item.checked = !item.checked;
    config.autoSave = item.checked;
    saveConfig();
    windows.forEach(win => {
      win.webContents.send('set-auto-save', item.checked);
    });
  }
  return config.autoSave;
});

// Set custom content width
ipcMain.handle('set-custom-width', async (event, width) => {
  const numWidth = parseInt(width, 10);
  if (numWidth >= 300 && numWidth <= 3000) {
    config.contentWidth = numWidth;
    saveConfig();
    broadcastSetting('content-width', numWidth);
    // Rebuild menu to show custom width in label
    Menu.setApplicationMenu(createMenu());
    return true;
  }
  return false;
});

// Watch a file for changes
ipcMain.handle('watch-file', async (event, filePath, options = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || !filePath) return;
  const searchRoot = options.searchRoot || path.dirname(filePath);
  const watchKey = `${win.id}:${filePath}`;

  // Don't create duplicate watchers
  if (fileWatchers.has(watchKey)) return;

  try {
    const scheduleUpdate = (key) => {
      const state = fileWatchStates.get(key);
      if (!state) return;

      const existingTimer = fileWatchDebounceTimers.get(key);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(() => {
        fileWatchDebounceTimers.delete(key);
        const currentState = fileWatchStates.get(key);
        if (!currentState) return;
        if (win.isDestroyed()) return;
        try {
          const stats = fs.statSync(currentState.filePath);
          const content = fs.readFileSync(currentState.filePath, 'utf-8');
          currentState.identity = { dev: stats.dev, ino: stats.ino };
          win.webContents.send('file-changed', { filePath: currentState.filePath, content, mtime: stats.mtimeMs });
        } catch (err) {
          console.error('Error reading changed file:', err);
        }
      }, 150);

      fileWatchDebounceTimers.set(key, timer);
    };

    const startWatcher = (key) => {
      const state = fileWatchStates.get(key);
      if (!state) return;
      if (win.isDestroyed()) return;
      try {
        const watcher = fs.watch(state.filePath, (eventType) => {
          if (eventType !== 'change' && eventType !== 'rename') return;

          scheduleUpdate(key);

          if (eventType === 'rename') {
            const currentWatcher = fileWatchers.get(key);
            if (currentWatcher) {
              try {
                currentWatcher.close();
              } catch {}
              fileWatchers.delete(key);
            }

            const currentState = fileWatchStates.get(key);
            const movedPath = currentState
              ? detectFileMove({
                  oldPath: currentState.filePath,
                  targetIdentity: currentState.identity,
                  searchRoots: [currentState.searchRoot]
                })
              : null;

            if (currentState && movedPath && movedPath !== currentState.filePath) {
              const oldPath = currentState.filePath;
              const newWatchKey = `${win.id}:${movedPath}`;
              currentState.filePath = movedPath;
              currentState.identity = getFileIdentity(movedPath);

              const timer = fileWatchDebounceTimers.get(key);
              if (timer) {
                clearTimeout(timer);
                fileWatchDebounceTimers.delete(key);
              }

              fileWatchStates.delete(key);
              fileWatchStates.set(newWatchKey, currentState);
              win.webContents.send('file-path-changed', { oldPath, newPath: movedPath });
              scheduleUpdate(newWatchKey);

              setTimeout(() => {
                if (win.isDestroyed()) return;
                if (!fileWatchers.has(newWatchKey)) startWatcher(newWatchKey);
              }, 50);
              return;
            }

            setTimeout(() => {
              if (win.isDestroyed()) return;
              if (!fileWatchers.has(key)) startWatcher(key);
            }, 50);
          }
        });
        fileWatchers.set(key, watcher);
      } catch (err) {
        console.error('Error watching file:', err);
      }
    };

    fileWatchStates.set(watchKey, {
      filePath,
      searchRoot,
      identity: getFileIdentity(filePath)
    });

    startWatcher(watchKey);

    // Immediately check for changes when watch mode is enabled
    try {
      const stats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf-8');
      const state = fileWatchStates.get(watchKey);
      if (state) state.identity = { dev: stats.dev, ino: stats.ino };
      win.webContents.send('file-changed', { filePath, content, mtime: stats.mtimeMs });
    } catch (err) {
      console.error('Error reading file on watch start:', err);
    }
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
  fileWatchStates.delete(watchKey);
});

// Tab context menu
ipcMain.handle('show-tab-context-menu', async (event, tabInfo) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { filePath, tabId, tabIndex, totalTabs } = tabInfo;

  const menuTemplate = [];

  if (filePath) {
    menuTemplate.push(
      {
        label: 'Rename...',
        click: () => win.webContents.send('rename-tab-file-request', tabId)
      },
      { type: 'separator' },
      {
        label: 'Open in Finder',
        click: () => {
          openInFinder(filePath, { shell }).catch(() => {});
        }
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

// Folder path context menu (for sidebar path)
ipcMain.handle('show-folder-context-menu', async (event, folderPath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!folderPath) return;

  const menuTemplate = [
    {
      label: 'Open in New Window',
      click: () => createWindow(folderPath)
    },
    { type: 'separator' },
    {
      label: 'Open in Finder',
      click: () => {
        openInFinder(folderPath, { shell }).catch(() => {});
      }
    },
    {
      label: 'Reveal in Finder',
      click: () => shell.showItemInFolder(folderPath)
    },
    {
      label: 'Copy Path',
      click: () => {
        require('electron').clipboard.writeText(folderPath);
      }
    },
    {
      label: 'Copy Name',
      click: () => {
        require('electron').clipboard.writeText(path.basename(folderPath));
      }
    },
    { type: 'separator' },
    {
      label: 'Open in Terminal',
      click: () => {
        const { exec } = require('child_process');
        exec(`open -a Terminal "${folderPath}"`);
      }
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  menu.popup({ window: win });
});

// Sidebar folder item context menu
ipcMain.handle('show-sidebar-folder-item-context-menu', async (event, folderPath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!folderPath) return;

  const menuTemplate = [
      {
        label: 'Open in New Window',
        click: () => createWindow(folderPath)
      },
      { type: 'separator' },
      {
        label: 'New File Here',
        click: () => win.webContents.send('create-file-in-folder-request', folderPath)
      },
      {
        label: 'Rename...',
        click: () => win.webContents.send('rename-sidebar-item-request', folderPath)
      },
      { type: 'separator' },
      {
        label: 'Reveal in Finder',
        click: () => shell.showItemInFolder(folderPath)
    },
    {
      label: 'Copy Path',
      click: () => {
        require('electron').clipboard.writeText(folderPath);
      }
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  menu.popup({ window: win });
});

// File path context menu (for sidebar files)
ipcMain.handle('show-file-context-menu', async (event, filePath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!filePath) return;

  const menuTemplate = [
    {
      label: 'Rename...',
      click: () => win.webContents.send('rename-sidebar-item-request', filePath)
    },
    { type: 'separator' },
    {
      label: 'Open in Finder',
      click: () => {
        openInFinder(filePath, { shell }).catch(() => {});
      }
    },
    {
      label: 'Copy Path',
      click: () => {
        require('electron').clipboard.writeText(filePath);
      }
    },
    {
      label: 'Copy Name',
      click: () => {
        require('electron').clipboard.writeText(path.basename(filePath));
      }
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  menu.popup({ window: win });
});

// Reveal in Finder
ipcMain.handle('reveal-in-finder', async (event, filePath) => {
  return openInFinder(filePath, { shell });
});

// Open in Finder (folder opens, file reveals)
ipcMain.handle('open-in-finder', async (event, filePath) => {
  return openInFinder(filePath, { shell });
});

// Copy to clipboard
ipcMain.handle('copy-to-clipboard', async (event, text) => {
  require('electron').clipboard.writeText(text);
  return true;
});

// Global search: search content in all files within a directory
ipcMain.handle('search-in-files', async (event, dirPath, query, options = {}) => {
  if (!dirPath || !query) return { results: [], totalMatches: 0 };

  const results = [];
  let totalMatches = 0;
  const maxResults = options.maxResults || 500;
  const caseSensitive = options.caseSensitive || false;
  const searchQuery = caseSensitive ? query : query.toLowerCase();

  // Get all text files recursively
  const files = getAllFilesRecursive(dirPath, 10);
  const textFiles = files.filter(f => f.isMarkdown || f.isTextFile);

  for (const file of textFiles) {
    if (totalMatches >= maxResults) break;

    try {
      const content = fs.readFileSync(file.path, 'utf-8');
      const lines = content.split('\n');
      const matches = [];

      for (let i = 0; i < lines.length; i++) {
        if (totalMatches >= maxResults) break;

        const line = lines[i];
        const searchLine = caseSensitive ? line : line.toLowerCase();

        if (searchLine.includes(searchQuery)) {
          matches.push({
            lineNum: i + 1,
            content: line.slice(0, 200), // Truncate long lines
            matchStart: searchLine.indexOf(searchQuery),
            matchLength: query.length
          });
          totalMatches++;
        }
      }

      if (matches.length > 0) {
        // Get relative path from directory
        const relativePath = path.relative(dirPath, file.path);
        results.push({
          filePath: file.path,
          fileName: file.name,
          relativePath,
          matches
        });
      }
    } catch (err) {
      // Skip files that can't be read
      console.error(`Error reading ${file.path}:`, err.message);
    }
  }

  return {
    results,
    totalMatches,
    truncated: totalMatches >= maxResults
  };
});

// Cheap emptiness check: returns true if dirPath contains no visible
// (non-dotfile) entries. Short-circuits on first visible entry.
function isFolderEmpty(folderPath) {
  let dir;
  try {
    dir = fs.opendirSync(folderPath);
    let entry;
    while ((entry = dir.readSync()) !== null) {
      if (!entry.name.startsWith('.')) return false;
    }
    return true;
  } catch (err) {
    return false; // permission denied / unreadable — don't mislabel as empty
  } finally {
    if (dir) { try { dir.closeSync(); } catch (e) {} }
  }
}

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
          type: 'folder',
          isEmpty: isFolderEmpty(fullPath)
        });
      } else if (entry.isFile()) {
        const isMarkdown = isMarkdownFileExt(entry.name);
        const isTextFile = isTextFileExt(entry.name);
        let mtime = 0;
        try {
          mtime = fs.statSync(fullPath).mtimeMs;
        } catch (e) {}
        
        files.push({
          name: entry.name,
          path: fullPath,
          type: 'file',
          isMarkdown,
          isTextFile,
          mtime
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

// Dev Helper: Watch for source file changes
// Distinguishes between main-process files (need full restart) and
// renderer-only files (can be soft-reloaded via webContents.reload(),
// which is much faster and preserves the BrowserWindow + main state).
if (!app.isPackaged) {
  // Files that require a full app restart — main process is stale otherwise.
  const mainProcessFiles = new Set(['main.js', 'preload.js', 'build-info.json']);
  // Files that only need a renderer reload.
  const rendererFiles = new Set(['renderer.js', 'index.html', 'styles.css']);
  let debounceTimer = null;
  let pendingChangeKind = null; // 'restart' wins over 'reload' if both fired in the debounce window

  try {
    fs.watch(__dirname, (eventType, filename) => {
      if (!filename) return;
      let kind = null;
      if (mainProcessFiles.has(filename)) {
        kind = 'restart';
      } else if (rendererFiles.has(filename)) {
        kind = 'reload';
      }
      if (!kind) return;

      // Restart trumps reload if multiple files change inside the debounce window.
      if (kind === 'restart' || pendingChangeKind === null) {
        pendingChangeKind = kind;
      }

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const eventName = pendingChangeKind === 'restart' ? 'source-code-changed' : 'renderer-changed';
        windows.forEach(win => {
          if (!win.isDestroyed()) {
            win.webContents.send(eventName, { filename });
          }
        });
        pendingChangeKind = null;
      }, 500); // Debounce for 500ms
    });
  } catch (err) {
    console.error('Failed to setup dev file watcher:', err);
  }
}

// Restart app (for dev mode or manual restart)
ipcMain.on('restart-app', () => {
  app.relaunch();
  app.exit(0);
});

// Soft-reload the focused window's renderer process (dev mode quick iteration).
// Preserves main process state and the BrowserWindow itself; only re-runs
// the renderer JS/HTML/CSS. Much faster than a full restart.
ipcMain.on('reload-renderer', () => {
  const win = getFocusedWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.reloadIgnoringCache();
  }
});

// Log to main process (for terminal visibility)
ipcMain.on('log-to-main', (event, level, ...args) => {
  console[level]('[Renderer]', ...args);
});
