console.log(`[RENDERER] Starting at ${new Date().toISOString()}`);

// Startup health check — detect missing dependencies and show error instead of blank screen
(function startupHealthCheck() {
  const missing = [];
  if (typeof marked === 'undefined') missing.push('marked (Markdown parser)');
  if (typeof hljs === 'undefined') missing.push('highlight.js (syntax highlighter)');
  if (typeof EasyMDE === 'undefined') missing.push('EasyMDE (editor)');

  if (missing.length > 0) {
    const msg = `Startup Error: Missing dependencies — ${missing.join(', ')}. ` +
      `The app may show a blank screen. Check Help > Open Log File for details.`;
    // Log to main process if available
    if (window.electronAPI && window.electronAPI.logToMain) {
      window.electronAPI.logToMain('error', msg);
    }
    // Show visible error instead of blank screen
    document.body.innerHTML = `
      <div style="padding: 40px; font-family: -apple-system, sans-serif; color: #c00; max-width: 600px; margin: 40px auto;">
        <h2 style="margin-bottom: 16px;">OpenMarkdownReader failed to start</h2>
        <p>Some required libraries could not be loaded:</p>
        <ul style="margin: 12px 0;">${missing.map(m => `<li>${m}</li>`).join('')}</ul>
        <p style="color: #666; margin-top: 20px;">This is a packaging error. Please report it at:<br>
          <a href="https://github.com/tmad4000/OpenMarkdownReader/issues" style="color: #0066cc;">
            github.com/tmad4000/OpenMarkdownReader/issues</a></p>
        <p style="color: #888; font-size: 12px; margin-top: 16px;">
          Diagnostic logs: Help menu → Open Log File</p>
      </div>`;
    return;
  }
  console.log('Startup health check passed — all dependencies loaded');
})();

// Global renderer error handlers — catch and log anything that could cause white screen
function showErrorOverlay(title, detail) {
  let overlay = document.getElementById('error-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'error-overlay';
    overlay.style.cssText = 'position:fixed;bottom:12px;right:12px;max-width:420px;max-height:300px;overflow:auto;' +
      'background:#1a1a2e;color:#e0e0e0;border:1px solid #c0392b;border-radius:8px;padding:12px 16px;' +
      'font-family:-apple-system,monospace;font-size:12px;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u00d7';
    closeBtn.style.cssText = 'position:absolute;top:4px;right:8px;background:none;border:none;color:#888;font-size:18px;cursor:pointer;';
    closeBtn.onclick = () => overlay.remove();
    overlay.appendChild(closeBtn);
    const content = document.createElement('div');
    content.id = 'error-overlay-content';
    overlay.appendChild(content);
    document.body.appendChild(overlay);
  }
  const content = overlay.querySelector('#error-overlay-content');
  const entry = document.createElement('div');
  entry.style.cssText = 'margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #333;';
  entry.innerHTML = `<div style="color:#e74c3c;font-weight:600;margin-bottom:4px;">${title}</div>` +
    `<div style="color:#aaa;white-space:pre-wrap;word-break:break-all;">${detail}</div>`;
  content.appendChild(entry);
}

window.onerror = (message, source, lineno, colno, error) => {
  const detail = `${message}\n${source}:${lineno}:${colno}${error?.stack ? '\n' + error.stack : ''}`;
  console.error(`[RENDERER UNCAUGHT] ${detail}`);
  showErrorOverlay('Uncaught Error', detail);
  return false;
};
window.addEventListener('unhandledrejection', (event) => {
  const detail = event.reason?.stack || String(event.reason);
  console.error('[RENDERER UNHANDLED PROMISE]', detail);
  showErrorOverlay('Unhandled Promise Rejection', detail);
});

// Forward logs to main process for terminal debugging
if (window.electronAPI && window.electronAPI.logToMain) {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...args) => {
    originalLog(...args);
    window.electronAPI.logToMain('log', ...args);
  };

  console.error = (...args) => {
    originalError(...args);
    window.electronAPI.logToMain('error', ...args);
  };
  
  console.warn = (...args) => {
    originalWarn(...args);
    window.electronAPI.logToMain('warn', ...args);
  };
}

// Settings
let settings = {
  readOnlyMode: false,
  sidebarVisible: false,
  contentWidth: 900,
  contentPadding: 20,
  editorMonospace: false,
  compactTables: false,
  watchFileMode: false,
  tocVisible: false,
  csvViewAsTable: true, // Default to showing CSV as table
  richEditorMode: true, // Default to Rich
  richToolbarVisible: false, // Default toolbar closed
  terminalView: false, // Terminal display mode
  sidebarViewMode: 'tree', // 'tree' or 'recent'
  sidebarSortMode: 'name', // 'name' or 'date'
  sidebarWidth: 240
};

// `easyMDE` points to the active tab's EasyMDE instance, or null if the active
// tab isn't editing in rich mode. Each tab has its own EasyMDE in `tab.easyMDE`
// (lazy-created on first rich edit) so that tab switches and rich/plain toggles
// preserve undo history.
let easyMDE = null;

// Toast notification system
const toastContainer = document.getElementById('toast-container');

function showToast(message, type = 'success', duration = 4000) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 16A8 8 0 108 0a8 8 0 000 16zm3.78-9.72a.75.75 0 00-1.06-1.06L6.75 9.19 5.28 7.72a.75.75 0 00-1.06 1.06l2 2a.75.75 0 001.06 0l4.5-4.5z"/></svg>',
    error: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2.343 13.657A8 8 0 1113.657 2.343 8 8 0 012.343 13.657zM6.03 4.97a.75.75 0 00-1.06 1.06L6.94 8 4.97 9.97a.75.75 0 101.06 1.06L8 9.06l1.97 1.97a.75.75 0 101.06-1.06L9.06 8l1.97-1.97a.75.75 0 10-1.06-1.06L8 6.94 6.03 4.97z"/></svg>',
    warning: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0114.082 15H1.918a1.75 1.75 0 01-1.543-2.575L6.457 1.047zM8 5a.75.75 0 00-.75.75v2.5a.75.75 0 001.5 0v-2.5A.75.75 0 008 5zm1 6a1 1 0 11-2 0 1 1 0 012 0z"/></svg>'
  };
  const icon = icons[type] || icons.success;

  toast.innerHTML = `
    ${icon}
    <span class="toast-message">${message}</span>
    <button class="toast-close" title="Dismiss">
      <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
        <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
      </svg>
    </button>
  `;

  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => dismissToast(toast));

  toastContainer.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => dismissToast(toast), duration);
  }

  return toast;
}

function dismissToast(toast) {
  if (!toast || toast.classList.contains('hiding')) return;
  toast.classList.add('hiding');
  setTimeout(() => toast.remove(), 200);
}

// Platform helpers
const isMac = typeof navigator !== 'undefined' &&
  typeof navigator.platform === 'string' &&
  navigator.platform.toUpperCase().includes('MAC');

// Text file extensions that can be opened
const textFileExtensions = [
  // Markdown
  '.md', '.markdown', '.mdown', '.mkd',
  // Plain text
  '.txt', '.text',
  // Data formats
  '.csv', '.tsv', '.json', '.jsonl', '.xml', '.yaml', '.yml', '.toml',
  // Config files
  '.conf', '.config', '.ini', '.cfg', '.env', '.properties',
  // Code/Script files
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.php', '.java', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.go', '.rs', '.swift', '.kt', '.scala',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.sql', '.graphql', '.gql',
  // Web files
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.svg',
  // Documentation
  '.rst', '.adoc', '.asciidoc', '.org', '.tex', '.latex',
  // Log files
  '.log',
  // Other common text files
  '.gitignore', '.dockerignore', '.editorconfig',
  '.eslintrc', '.prettierrc', '.babelrc',
  'Makefile', 'Dockerfile', 'Vagrantfile', 'Gemfile', 'Rakefile',
  '.htaccess', '.npmrc', '.nvmrc'
];

// Tab management
let tabs = [];
let activeTabId = null;
let tabIdCounter = 0;
let closedTabs = []; // Stack of recently closed tabs for Cmd+Shift+T
const MAX_CLOSED_TABS = 50;

// Navigation history (browser-style back/forward)
let navHistory = []; // Stack of { tabId, filePath }
let navHistoryIndex = -1; // Current position in history
let navIsNavigating = false; // Flag to prevent adding to history during back/forward

// Directory state
let currentDirectory = null;
let directoryFiles = [];
let selectedSidebarFolderPath = null;
let pendingNewTreeItemId = 0;
let sidebarLiveWatchTimer = null;
let sidebarLiveWatchSignature = '';
// Command palette file cache (prefetched per directory)
let allFilesCache = null;
let allFilesCachePromise = null;

// Wiki link indices:
// - wikiLinkByPath: maps relative paths (folder/filename without .md) to full paths
// - wikiLinkByName: maps base names (filename without .md) to full paths
let wikiLinkByPath = new Map();
let wikiLinkByName = new Map();
let wikiLinkConflicts = new Set(); // Base names with multiple matches
let shownWikiConflictWarnings = new Set();

// Build wiki link indices from allFilesCache
function buildWikiLinkIndex() {
  wikiLinkByPath.clear();
  wikiLinkByName.clear();
  wikiLinkConflicts.clear();

  if (!allFilesCache || !currentDirectory) return;

  // Index all markdown files by both relative path and base name
  allFilesCache.forEach(file => {
    if (!file.isMarkdown) return;

    // Get relative path from directory root (without .md extension)
    const relativePath = file.path
      .replace(currentDirectory + '/', '')
      .replace(/\.md$/i, '')
      .toLowerCase();

    // Get base name without .md extension
    const baseName = file.name.replace(/\.md$/i, '').toLowerCase();

    // Index by relative path (unique, no conflicts)
    wikiLinkByPath.set(relativePath, file.path);

    // Index by base name (may have conflicts)
    if (wikiLinkByName.has(baseName)) {
      wikiLinkConflicts.add(baseName);
    } else {
      wikiLinkByName.set(baseName, file.path);
    }
  });

  // Log conflicts if any
  if (wikiLinkConflicts.size > 0) {
    console.log('Wiki link name conflicts detected:', Array.from(wikiLinkConflicts));
  }
}

// Centralized setter for allFilesCache that also (re)builds the wiki link index
// and re-renders the active preview tab if it was rendered before the index was ready.
// Use this instead of assigning to allFilesCache directly for any "happy path"
// population — reset/error paths that set null or [] should still assign directly.
function setAllFilesCache(files) {
  allFilesCache = files;
  buildWikiLinkIndex();

  // If the active tab is currently showing a rendered markdown preview, re-render
  // it so any [[wikilinks]] that rendered as raw text (because the index was empty
  // at first-paint) get resolved now that the index is populated.
  try {
    const tab = tabs.find(t => t.id === activeTabId);
    if (
      tab &&
      !tab.isEditing &&
      tab.content != null &&
      markdownBody &&
      !markdownBody.classList.contains('hidden')
    ) {
      renderContent(tab.content, tab.fileName);
    }
  } catch (err) {
    console.error('Error re-rendering active tab after wiki link index build:', err);
  }
}

function canResolveWikiLinks() {
  return !!currentDirectory && (wikiLinkByPath.size > 0 || wikiLinkByName.size > 0);
}

function parseWikiLinkMarkup(innerText) {
  const raw = typeof innerText === 'string' ? innerText.trim() : '';
  const pipeIndex = raw.indexOf('|');
  const targetPart = (pipeIndex >= 0 ? raw.slice(0, pipeIndex) : raw).trim();
  const displayText = (pipeIndex >= 0 ? raw.slice(pipeIndex + 1) : '').trim();
  const hashIndex = targetPart.indexOf('#');
  const pathPart = (hashIndex >= 0 ? targetPart.slice(0, hashIndex) : targetPart).trim();
  const headingPart = (hashIndex >= 0 ? targetPart.slice(hashIndex + 1) : '').trim();

  return {
    raw,
    targetPart,
    displayText,
    pathPart,
    headingPart,
    display: displayText || targetPart
  };
}

function resolveWikiLinkTarget(targetPart) {
  const parsed = parseWikiLinkMarkup(targetPart);

  if (!parsed.pathPart) {
    if (parsed.headingPart) {
      return {
        type: 'anchor',
        href: `#${slugifyHeadingText(parsed.headingPart)}`,
        headingPart: parsed.headingPart,
        headingSlug: slugifyHeadingText(parsed.headingPart)
      };
    }
    return { type: 'missing' };
  }

  if (!canResolveWikiLinks()) {
    return { type: 'unresolved' };
  }

  const lookupName = parsed.pathPart.toLowerCase();
  let targetPath = wikiLinkByPath.get(lookupName);

  if (!targetPath) {
    const justName = lookupName.includes('/')
      ? lookupName.split('/').pop()
      : lookupName;

    targetPath = wikiLinkByName.get(justName);

    if (targetPath && wikiLinkConflicts.has(justName) && !shownWikiConflictWarnings.has(justName)) {
      shownWikiConflictWarnings.add(justName);
      showToast(`Multiple files match "${justName}" - using first match`, 'warning', 5000);
    }
  }

  if (!targetPath) {
    return { type: 'missing' };
  }

  return {
    type: 'file',
    href: targetPath,
    targetPath,
    headingPart: parsed.headingPart || '',
    headingSlug: parsed.headingPart ? slugifyHeadingText(parsed.headingPart) : ''
  };
}

function renderWikiLinkToken(token, parser) {
  const innerHtml = parser.parseInline(token.tokens || []);

  if (token.href) {
    const attrs = [
      'class="wiki-link"',
      `href="${escapeHtml(token.href)}"`
    ];

    if (token.headingSlug) {
      attrs.push(`data-wiki-heading="${escapeHtml(token.headingSlug)}"`);
    }

    if (token.pageName) {
      attrs.push(`data-wiki-target="${escapeHtml(token.pageName)}"`);
    }

    return `<a ${attrs.join(' ')}>${innerHtml}</a>`;
  }

  return `<span class="wiki-link-broken" title="Page not found: ${escapeHtml(token.pageName || '')}">${innerHtml}</span>`;
}

function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Update tab display (title text and tooltip)
function updateTabDisplay(tabId, fileName, filePath) {
  const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (tabEl) {
    const titleEl = tabEl.querySelector('.tab-title');
    const tooltip = filePath || fileName;
    if (titleEl) {
      titleEl.textContent = fileName;
      titleEl.title = tooltip;
    }
    tabEl.title = tooltip;
  }
}

// DOM Elements
const tabBar = document.getElementById('tab-bar');
const newTabBtn = document.getElementById('new-tab-btn');
const dropZone = document.getElementById('drop-zone');
const content = document.getElementById('content');
const markdownBody = document.getElementById('markdown-body');
const openBtn = document.getElementById('open-btn');
const sidebar = document.getElementById('sidebar');
const sidebarResizer = document.getElementById('sidebar-resizer');
const sidebarToggle = document.getElementById('sidebar-toggle');
const navBackBtn = document.getElementById('nav-back-btn');
const navForwardBtn = document.getElementById('nav-forward-btn');
const openFolderBtn = document.getElementById('open-folder-btn');
const sidebarNewFileBtn = document.getElementById('sidebar-new-file-btn');
const sidebarNewFolderBtn = document.getElementById('sidebar-new-folder-btn');
const sidebarSortBtn = document.getElementById('sidebar-sort-btn');
const sidebarSortStatus = document.getElementById('sidebar-sort-status');
const sidebarSortStatusLabel = document.getElementById('sidebar-sort-status-label');
const sidebarSortStatusIndicator = document.getElementById('sidebar-sort-status-indicator');
const sidebarRecentBtn = document.getElementById('sidebar-recent-btn');
const sidebarCollapseAllBtn = document.getElementById('sidebar-collapse-all-btn');
const sidebarPath = document.getElementById('sidebar-path');
const devRestartBtn = document.getElementById('dev-restart-btn');
const sidebarPathText = document.getElementById('sidebar-path-text');
const fileTree = document.getElementById('file-tree');
const editorContainer = document.getElementById('editor-container');
// `editor` points to the active tab's textarea. It's reassigned on tab switch
// so that all the existing `editor.value` / `editor.focus()` callsites keep
// working without needing to know which tab they're operating on.
//
// The original textarea in the HTML serves as a fallback when no tab is active
// (e.g. on first launch before any file is opened) and as a template for the
// per-tab textareas that get cloned from it on demand.
let editor = document.getElementById('editor');
const fallbackEditor = editor; // never removed; used when no tab is active
const editToggleBtn = document.getElementById('edit-toggle-btn');
// Share popover elements
const shareBtn = document.getElementById('share-btn');
const sharePopover = document.getElementById('share-popover');
const shareUnpublished = document.getElementById('share-unpublished');
const sharePublished = document.getElementById('share-published');
const sharePublishing = document.getElementById('share-publishing');
const sharePublishBtn = document.getElementById('share-publish-btn');
const shareUrlInput = document.getElementById('share-url-input');
const shareCopyBtn = document.getElementById('share-copy-btn');
const shareOpenBtn = document.getElementById('share-open-btn');
const commandPalette = document.getElementById('command-palette');
const commandPaletteInput = document.getElementById('command-palette-input');
const commandPaletteResults = document.getElementById('command-palette-results');
const saveBtn = document.getElementById('save-btn');
const wordCountIndicator = document.getElementById('word-count-indicator');
const tocPanel = document.getElementById('toc-panel');
const tocContent = document.getElementById('toc-content');
const tocToggleBtn = document.getElementById('toc-toggle-btn');
const tocCloseBtn = document.getElementById('toc-close');
const csvView = document.getElementById('csv-view');
const csvTableContainer = document.getElementById('csv-table-container');
const csvToggleRawBtn = document.getElementById('csv-toggle-raw');
const titlebar = document.getElementById('titlebar');
const titlebarDragSpacer = document.querySelector('.titlebar-drag-spacer');
const tabBarWrapper = document.querySelector('.tab-bar-wrapper');
const sidebarHighlight = window.SidebarHighlight || null;
const sidebarSortIndicator = window.SidebarSortIndicator || null;
const sidebarTreeUtils = window.sidebarTreeUtils || null;
let draggedSidebarFilePath = null;

function getSidebarSortIndicatorState(mode) {
  if (sidebarSortIndicator && typeof sidebarSortIndicator.getSidebarSortIndicatorState === 'function') {
    return sidebarSortIndicator.getSidebarSortIndicatorState(mode);
  }

  const normalizedMode = mode === 'date' ? 'date' : 'name';
  if (normalizedMode === 'date') {
    return {
      mode: 'date',
      label: 'Sort: Recent',
      indicator: 'NEW',
      tooltip: 'Sorted by most recently modified first',
      buttonTitle: 'Sort mode: Recent first (click to switch to Name)'
    };
  }

  return {
    mode: 'name',
    label: 'Sort: Name',
    indicator: 'A-Z',
    tooltip: 'Sorted alphabetically (A to Z)',
    buttonTitle: 'Sort mode: Name (A-Z) (click to switch to Recent first)'
  };
}

fileTree.addEventListener('dragover', (e) => {
  if (!draggedSidebarFilePath || settings.sidebarViewMode !== 'tree') return;
  e.preventDefault();
});

fileTree.addEventListener('drop', (e) => {
  if (!draggedSidebarFilePath || settings.sidebarViewMode !== 'tree') return;
  e.preventDefault();
  clearSidebarDropTargetHighlight();
  draggedSidebarFilePath = null;
});

function updateSidebarSortUI() {
  const sortState = getSidebarSortIndicatorState(settings.sidebarSortMode);
  settings.sidebarSortMode = sortState.mode;

  sidebarSortBtn.classList.toggle('active', sortState.mode === 'date');
  sidebarSortBtn.style.color = sortState.mode === 'date' ? 'var(--link-color)' : '';
  sidebarSortBtn.title = sortState.buttonTitle;

  if (!sidebarSortStatus || !sidebarSortStatusLabel || !sidebarSortStatusIndicator) return;

  sidebarSortStatus.dataset.mode = sortState.mode;
  sidebarSortStatus.title = sortState.tooltip;
  sidebarSortStatus.setAttribute('aria-label', sortState.tooltip);
  sidebarSortStatusLabel.textContent = sortState.label;
  sidebarSortStatusIndicator.textContent = sortState.indicator;
}

function clampSidebarWidth(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 240;
  return Math.max(200, Math.min(520, Math.round(n)));
}

function applySidebarWidth(width) {
  settings.sidebarWidth = clampSidebarWidth(width);
  if (sidebar) {
    sidebar.style.width = `${settings.sidebarWidth}px`;
  }
}

function setSidebarVisibility(visible) {
  settings.sidebarVisible = Boolean(visible);
  sidebar.classList.toggle('hidden', !settings.sidebarVisible);
  sidebarToggle.classList.toggle('active', settings.sidebarVisible);
  if (sidebarResizer) {
    sidebarResizer.classList.toggle('hidden', !settings.sidebarVisible);
  }
}

function initSidebarResizer() {
  if (!sidebar || !sidebarResizer) return;

  let isResizing = false;

  const onMouseMove = (e) => {
    if (!isResizing) return;
    applySidebarWidth(e.clientX);
  };

  const onMouseUp = () => {
    if (!isResizing) return;
    isResizing = false;
    sidebarResizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };

  sidebarResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (!settings.sidebarVisible) return;
    isResizing = true;
    sidebarResizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

function getActiveSidebarFilePath() {
  if (sidebarHighlight && typeof sidebarHighlight.findActiveTabFilePath === 'function') {
    return sidebarHighlight.findActiveTabFilePath(tabs, activeTabId);
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  return activeTab && activeTab.filePath ? activeTab.filePath : '';
}

function isActiveSidebarFilePath(itemPath, activeFilePath) {
  if (sidebarHighlight && typeof sidebarHighlight.isActiveSidebarFilePath === 'function') {
    return sidebarHighlight.isActiveSidebarFilePath(itemPath, activeFilePath);
  }

  return !!itemPath && !!activeFilePath && itemPath === activeFilePath;
}

function syncActiveSidebarFileHighlight() {
  if (!fileTree) return;

  const activeFilePath = getActiveSidebarFilePath();
  if (sidebarHighlight && typeof sidebarHighlight.applyActiveSidebarFileHighlight === 'function') {
    sidebarHighlight.applyActiveSidebarFileHighlight(fileTree, activeFilePath);
    return;
  }

  fileTree.querySelectorAll('.file-tree-item.file-tree-file[data-path]').forEach((el) => {
    const isActive = isActiveSidebarFilePath(el.dataset.path, activeFilePath);
    el.classList.toggle('active', isActive);
  });
}
const countWords = (window.WordCountUtils && typeof window.WordCountUtils.countWords === 'function')
  ? window.WordCountUtils.countWords
  : (text) => {
    if (typeof text !== 'string' || text.length === 0) return 0;
    const matches = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
    return matches ? matches.length : 0;
  };

function getActiveTabWordCountContent(tab) {
  if (!tab) return null;
  if (tab.id === activeTabId && tab.isEditing) {
    if (easyMDE) return easyMDE.value();
    return editor.value;
  }
  return typeof tab.content === 'string' ? tab.content : '';
}

function updateDocumentWordCount(tab = tabs.find(t => t.id === activeTabId)) {
  if (!wordCountIndicator) return;
  if (!tab) {
    wordCountIndicator.classList.add('hidden');
    return;
  }

  const source = getActiveTabWordCountContent(tab);
  const total = countWords(source);
  wordCountIndicator.textContent = `${total.toLocaleString()} word${total === 1 ? '' : 's'}`;
  wordCountIndicator.classList.remove('hidden');
}

// Create a new tab
function createTab(fileName = 'New Tab', mdContent = null, filePath = null, switchTo = true, mtime = null) {
  const tabId = ++tabIdCounter;
  const tab = {
    id: tabId,
    fileName,
    filePath,
    content: mdContent,
    lastKnownMtime: mtime,
    scrollPos: 0,
    isEditing: false,
    isModified: false,
    externalChangePending: false,
    publishedUrl: null,  // URL if published to globalbr.ai
    // Per-tab editor state — created lazily by ensureTabEditor / initRichEditor
    // when this tab first enters edit mode. Kept alive across tab switches and
    // preview toggles so undo history survives. See markdown-reader-a4h.
    editorEl: null,
    easyMDE: null
  };
  tabs.push(tab);

  // Create tab element
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.tabId = tabId;
  tabEl.draggable = true;
  tabEl.title = filePath || fileName; // Show full path on hover
  tabEl.innerHTML = `
    <span class="tab-title">${escapeHtml(fileName)}</span>
    <span class="tab-close">×</span>
  `;
  const tabTitleEl = tabEl.querySelector('.tab-title');
  if (tabTitleEl) tabTitleEl.title = filePath || fileName;

  // Append to tab bar
  tabBar.appendChild(tabEl);

  // Tab click handler
  tabEl.addEventListener('click', (e) => {
    if (!e.target.classList.contains('tab-close')) {
      switchToTab(tabId);
    }
  });

  // Close button handler
  tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(tabId);
  });

  // Double-click to rename
  tabEl.querySelector('.tab-title').addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startTabRename(tabId);
  });

  // Drag handlers for reordering
  tabEl.addEventListener('dragstart', handleTabDragStart);
  tabEl.addEventListener('dragover', handleTabDragOver);
  tabEl.addEventListener('dragenter', handleTabDragEnter);
  tabEl.addEventListener('dragleave', handleTabDragLeave);
  tabEl.addEventListener('drop', handleTabDrop);
  tabEl.addEventListener('dragend', handleTabDragEnd);

  // Right-click context menu
  tabEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const tabIndex = tabs.findIndex(t => t.id === tabId);
    window.electronAPI.showTabContextMenu({
      tabId,
      filePath: tab.filePath,
      tabIndex,
      totalTabs: tabs.length,
      directory: currentDirectory
    });
  });

  if (switchTo) {
    switchToTab(tabId);
  }
  return tabId;
}

// Create tab in background (doesn't switch to it)
function createTabBackground(fileName, mdContent, filePath, mtime = null) {
  return createTab(fileName, mdContent, filePath, false, mtime);
}

// Tab drag-to-reorder
let draggedTab = null;

function handleTabDragStart(e) {
  draggedTab = this;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.dataset.tabId);
}

function handleTabDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  
  if (this === draggedTab) return;

  const rect = this.getBoundingClientRect();
  const midpoint = rect.x + rect.width / 2;
  
  if (e.clientX < midpoint) {
    this.classList.add('drag-over-left');
    this.classList.remove('drag-over-right');
  } else {
    this.classList.add('drag-over-right');
    this.classList.remove('drag-over-left');
  }
}

function handleTabDragEnter(e) {
  e.preventDefault();
}

function handleTabDragLeave(e) {
  // Avoid flickering when entering children
  const relatedTarget = e.relatedTarget;
  if (this.contains(relatedTarget)) return;

  this.classList.remove('drag-over-left');
  this.classList.remove('drag-over-right');
}

function handleTabDrop(e) {
  e.preventDefault();
  e.stopPropagation();

  if (draggedTab && this !== draggedTab) {
    // Determine insertion based on visual feedback
    const insertAfter = this.classList.contains('drag-over-right');

    // Reorder DOM
    if (insertAfter) {
      this.parentNode.insertBefore(draggedTab, this.nextSibling);
    } else {
      this.parentNode.insertBefore(draggedTab, this);
    }

    // Reorder tabs array
    const draggedTabId = parseInt(draggedTab.dataset.tabId);
    const draggedTabData = tabs.find(t => t.id === draggedTabId);
    
    // Remove from old position
    const oldIndex = tabs.indexOf(draggedTabData);
    if (oldIndex > -1) tabs.splice(oldIndex, 1);
    
    // Calculate new index
    const newAllTabs = Array.from(tabBar.querySelectorAll('.tab'));
    const newIndex = newAllTabs.indexOf(draggedTab);
    
    // Insert at new position
    tabs.splice(newIndex, 0, draggedTabData);
  }

  this.classList.remove('drag-over-left');
  this.classList.remove('drag-over-right');
}

function handleTabDragEnd(e) {
  this.classList.remove('dragging');
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.remove('drag-over-left');
    tab.classList.remove('drag-over-right');
  });
  draggedTab = null;
}

// Global drop handler for the tab bar to allow appending to the end
if (tabBar) {
  tabBar.addEventListener('dragover', (e) => {
    if (draggedTab && e.target === tabBar) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  });

  tabBar.addEventListener('drop', (e) => {
    if (draggedTab && e.target === tabBar) {
      e.preventDefault();
      
      const children = Array.from(tabBar.querySelectorAll('.tab:not(.dragging)'));
      
      // Find closest tab
      let closestTab = null;
      let minDist = Infinity;
      
      children.forEach(child => {
        const rect = child.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        const dist = Math.abs(e.clientX - center);
        if (dist < minDist) {
          minDist = dist;
          closestTab = child;
        }
      });
      
      if (closestTab) {
        const rect = closestTab.getBoundingClientRect();
        if (e.clientX < rect.left + rect.width / 2) {
          tabBar.insertBefore(draggedTab, closestTab);
        } else {
          tabBar.insertBefore(draggedTab, closestTab.nextSibling);
        }
      } else {
        tabBar.appendChild(draggedTab);
      }
      
      // Update tabs array
      const draggedTabId = parseInt(draggedTab.dataset.tabId);
      const draggedTabData = tabs.find(t => t.id === draggedTabId);
      
      const oldIndex = tabs.indexOf(draggedTabData);
      if (oldIndex > -1) tabs.splice(oldIndex, 1);
      
      // Find new position based on DOM order
      const newAllTabs = Array.from(tabBar.querySelectorAll('.tab'));
      const newIndex = newAllTabs.indexOf(draggedTab);
      
      tabs.splice(newIndex, 0, draggedTabData);
    }
  });

  // Scroll wheel navigation for tabs - convert vertical scroll to horizontal
  tabBar.addEventListener('wheel', (e) => {
    // Use deltaX if available (horizontal scroll), otherwise convert deltaY
    const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
    if (delta !== 0) {
      e.preventDefault();
      tabBar.scrollLeft += delta;
    }
  }, { passive: false });
}

// Right-click on titlebar empty space shows active tab context menu
function showActiveTabContextMenu(e) {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;

  e.preventDefault();
  const tabIndex = tabs.findIndex(t => t.id === activeTabId);
  window.electronAPI.showTabContextMenu({
    tabId: activeTabId,
    filePath: tab.filePath,
    tabIndex,
    totalTabs: tabs.length,
    directory: currentDirectory
  });
}

// Add context menu to titlebar drag spacer (empty space on right)
if (titlebarDragSpacer) {
  titlebarDragSpacer.addEventListener('contextmenu', showActiveTabContextMenu);
}

// Add context menu to tab bar wrapper (clicks on empty space between/around tabs)
if (tabBarWrapper) {
  tabBarWrapper.addEventListener('contextmenu', (e) => {
    // Only trigger if clicking directly on wrapper, not on tabs or buttons
    if (e.target === tabBarWrapper || e.target === tabBar) {
      showActiveTabContextMenu(e);
    }
  });
}

// Tab rename functionality
function startTabRename(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (!tabEl || !tab) return;

  const titleEl = tabEl.querySelector('.tab-title');
  const currentName = tab.fileName;

  // Create input element
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tab-rename-input';
  input.value = currentName;
  input.style.width = `${Math.max(titleEl.offsetWidth, 60)}px`;

  // Replace title with input
  titleEl.style.display = 'none';
  tabEl.insertBefore(input, titleEl);
  input.focus();

  // Select filename without extension
  const dotIndex = currentName.lastIndexOf('.');
  if (dotIndex > 0) {
    input.setSelectionRange(0, dotIndex);
  } else {
    input.select();
  }

  // Handle completion
  const finishRename = async (save) => {
    if (save && input.value && input.value !== currentName) {
      const newName = input.value.trim();

      if (tab.filePath) {
        // Rename actual file
        const result = await window.electronAPI.renameFile(tab.filePath, newName);
        if (result.success) {
          tab.filePath = result.newPath;
          tab.fileName = newName;
          titleEl.textContent = newName;
          tabEl.title = result.newPath;
          titleEl.title = result.newPath;
        } else {
          alert(`Could not rename file: ${result.error}`);
        }
      } else {
        // Just update the tab name for unsaved files
        tab.fileName = newName;
        titleEl.textContent = newName;
        tabEl.title = newName;
        titleEl.title = newName;
      }
    }

    input.remove();
    titleEl.style.display = '';
  };

  input.addEventListener('blur', () => finishRename(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finishRename(false);
    }
  });

  // Prevent drag while renaming
  input.addEventListener('mousedown', (e) => e.stopPropagation());
}

// Navigation history functions
function pushNavHistory(tabId, filePath) {
  // Don't push during back/forward navigation
  if (navIsNavigating) return;

  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  // Don't push if same as current position
  if (navHistoryIndex >= 0 && navHistory[navHistoryIndex]) {
    const current = navHistory[navHistoryIndex];
    if (current.tabId === tabId && current.filePath === filePath) return;
  }

  // Clear forward history when navigating to new location
  if (navHistoryIndex < navHistory.length - 1) {
    navHistory = navHistory.slice(0, navHistoryIndex + 1);
  }

  // Push new entry
  navHistory.push({ tabId, filePath: filePath || tab.filePath });
  navHistoryIndex = navHistory.length - 1;

  // Limit history size
  if (navHistory.length > 100) {
    navHistory.shift();
    navHistoryIndex--;
  }

  updateNavButtons();
}

function navGoBack() {
  if (navHistoryIndex <= 0) return;

  navIsNavigating = true;
  navHistoryIndex--;
  const entry = navHistory[navHistoryIndex];

  // Find the tab or open the file
  const tab = tabs.find(t => t.id === entry.tabId);
  if (tab) {
    switchToTab(entry.tabId);
  } else if (entry.filePath) {
    // Tab was closed, reopen the file
    window.electronAPI.openFileByPath(entry.filePath);
  }

  navIsNavigating = false;
  updateNavButtons();
}

function navGoForward() {
  if (navHistoryIndex >= navHistory.length - 1) return;

  navIsNavigating = true;
  navHistoryIndex++;
  const entry = navHistory[navHistoryIndex];

  // Find the tab or open the file
  const tab = tabs.find(t => t.id === entry.tabId);
  if (tab) {
    switchToTab(entry.tabId);
  } else if (entry.filePath) {
    // Tab was closed, reopen the file
    window.electronAPI.openFileByPath(entry.filePath);
  }

  navIsNavigating = false;
  updateNavButtons();
}

function updateNavButtons() {
  navBackBtn.disabled = navHistoryIndex <= 0;
  navForwardBtn.disabled = navHistoryIndex >= navHistory.length - 1;
}

// Switch to a tab
function switchToTab(tabId) {
  // Save current tab state
  if (activeTabId !== null) {
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (currentTab) {
      currentTab.scrollPos = window.scrollY;
      if (currentTab.isEditing) {
        currentTab.content = editor.value;
      }
    }
  }

  // Update active tab
  activeTabId = tabId;
  const tab = tabs.find(t => t.id === tabId);

  // Update tab UI
  document.querySelectorAll('.tab').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.tabId) === tabId);
  });

  // Show content
  if (tab && tab.content !== null && tab.content !== undefined) {
    if (tab.isEditing) {
      showEditor(tab.content);
    } else {
      hideEditor();
      renderContent(tab.content, tab.fileName);
    }
    updateDocumentWordCount(tab);
    document.title = `${tab.fileName}${tab.isModified ? ' *' : ''} - OpenMarkdownReader`;
    setTimeout(() => window.scrollTo(0, tab.scrollPos), 0);
  } else {
    // Show welcome screen
    hideEditor();
    hideCSVView();
    dropZone.classList.remove('hidden');
    content.classList.add('hidden');
    document.title = 'OpenMarkdownReader';
    updateDocumentWordCount(null);
  }

  // Add to navigation history
  if (tab) {
    pushNavHistory(tabId, tab.filePath);
  }

  updateTabUI(tabId);
  syncActiveSidebarFileHighlight();
}

// Show save dialog with Save/Don't Save/Cancel options
async function showSaveDialog(fileName) {
  return await window.electronAPI.showSaveDialog(fileName);
}

// Update tab UI state
function updateTabUI(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (tab && tabEl) {
    tabEl.classList.toggle('editing', tab.isEditing);
    tabEl.classList.toggle('modified', tab.isModified);
  }
	  // Update edit button and save button state
	  if (tab && tabId === activeTabId) {
	    editToggleBtn.classList.toggle('active', tab.isEditing);
	    // Show save button whenever in edit mode; disable when no changes
	    saveBtn.classList.toggle('hidden', !tab.isEditing);
	    saveBtn.disabled = !tab.isModified;
	    saveBtn.classList.toggle('disabled', !tab.isModified);
	            // Show share button when there's content
    // Show share button when there's content
    shareBtn.classList.toggle('hidden', !tab.content);
    // Update share button state based on publication status
    shareBtn.classList.toggle('published', !!tab.publishedUrl);
    shareBtn.title = tab.publishedUrl ? 'Document is live' : 'Share to web';
    updateDocumentWordCount(tab);
  }
}

// Close a tab
async function closeTab(tabId, silent = false) {
  const tab = tabs.find(t => t.id === tabId);
  const tabIndex = tabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return;

  // Check for unsaved changes - offer Save/Don't Save/Cancel
  if (!silent && tab && tab.isModified) {
    const result = await showSaveDialog(tab.fileName);
    if (result === 'cancel') {
      return; // User cancelled, don't close
    }
    if (result === 'save') {
      // Save the file first
      if (tab.isEditing) {
        tab.content = editor.value;
      }
      if (tab.filePath) {
        const saveResult = await writeTabToDisk(tab);
        if (!saveResult || !saveResult.success) {
          return; // Save cancelled or failed
        }
        tab.isModified = false;
        if (tab.isEditing) {
          tab.originalContent = tab.content;
        }
        updateTabUI(tab.id);
      } else {
        const saveResult = await window.electronAPI.saveFileAs(tab.content, tab.fileName);
        if (!saveResult) {
          return; // Save was cancelled, don't close
        }
      }
    }
    // 'discard' falls through to close the tab
  }

  // Stop watching the file if we were watching it
  if (tab && tab.filePath) {
    window.electronAPI.unwatchFile(tab.filePath);
  }

  // Save tab info for reopening (Cmd+Shift+T)
  if (tab && (tab.filePath || tab.content)) {
    closedTabs.push({
      fileName: tab.fileName,
      filePath: tab.filePath,
      content: tab.content,
      scrollPos: tab.scrollPos
    });
    // Limit the stack size
    if (closedTabs.length > MAX_CLOSED_TABS) {
      closedTabs.shift();
    }
  }

  // Free per-tab editor resources before removing the tab
  releaseTabEditor(tab);

  // Remove tab data
  tabs.splice(tabIndex, 1);

  // Remove tab element
  const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (tabEl) tabEl.remove();

  // If closing active tab, switch to another or close window
  if (activeTabId === tabId) {
    if (tabs.length > 0) {
      const newIndex = Math.min(tabIndex, tabs.length - 1);
      switchToTab(tabs[newIndex].id);
    } else {
      // Last tab closed - close the window
      window.electronAPI.closeWindow();
    }
  }
}

// Update tab content
function updateTab(tabId, fileName, mdContent, filePath, mtime = null) {
  const tab = tabs.find(t => t.id === tabId);
  if (tab) {
    tab.fileName = fileName;
    tab.content = mdContent;
    tab.filePath = filePath;
    tab.lastKnownMtime = mtime;
    tab.scrollPos = 0;
    tab.isModified = false;
    tab.externalChangePending = false;

    updateTabDisplay(tabId, fileName, filePath);
    updateTabUI(tabId);
    if (tabId === activeTabId) {
      syncActiveSidebarFileHighlight();
    }
  }
}

// Toggle edit mode
function toggleEditMode() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;

  // If blank tab (no content), create a new file instead
  if (!tab.content && tab.content !== '') {
    tab.fileName = 'Untitled.md';
    tab.content = '';
    tab.isEditing = true;
    tab.originalContent = '';
    updateTabDisplay(activeTabId, tab.fileName, tab.filePath);
    showEditor('');
    updateTabUI(activeTabId);
    return;
  }

  if (settings.readOnlyMode) {
    alert('Read-only mode is enabled. Disable it in the View menu to edit.');
    return;
  }

  tab.isEditing = !tab.isEditing;

  if (tab.isEditing) {
    // Store original content for potential revert
    tab.originalContent = tab.content;
    showEditor(tab.content);
  } else {
    tab.content = editor.value;
    hideEditor();
    renderContent(tab.content, tab.fileName);
  }

  updateTabUI(activeTabId);
}

// Cancel/revert edits
function revertChanges() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab || !tab.isEditing) return;

  if (tab.isModified) {
    if (!confirm('Discard all changes since last save?')) {
      return;
    }
  }

  // Revert to original content (before editing started)
  if (tab.originalContent !== undefined) {
    tab.content = tab.originalContent;
  }
  tab.isEditing = false;
  tab.isModified = false;
  hideEditor();
  renderContent(tab.content, tab.fileName);
  updateTabUI(activeTabId);
  document.title = `${tab.fileName} - OpenMarkdownReader`;
}

// ─── Per-tab editor lifecycle ─────────────────────────────────────────
// Each tab keeps its own textarea (and optional EasyMDE wrapper) so that the
// browser's native undo history survives tab switches and rich/plain toggles.
//
// Before this refactor, there was a single global textarea reused across tabs
// via `editor.value = content`. Reassigning a textarea's .value resets the
// browser's undo stack — meaning a tab switch or even a preview-toggle wiped
// every undo step the user had built up. Same for EasyMDE: `easyMDE.toTextArea()`
// destroyed the entire CodeMirror instance and its history. See bd ticket
// markdown-reader-a4h.

// Attach the input listeners (modified flag, autosave) to a textarea. Because
// each tab has its own textarea, listeners get attached when the textarea is
// created (in ensureTabEditor) rather than once at startup against a single
// global element.
function attachEditorListeners(textareaEl) {
  textareaEl.addEventListener('input', () => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab && tab.isEditing) {
      tab.isModified = true;
      updateTabUI(activeTabId);
      document.title = `${tab.fileName} * - OpenMarkdownReader`;
      updateDocumentWordCount(tab);
    }
  });
  // The autosave listener is attached later (see "Redefine initRichEditor"
  // section) once triggerAutoSave is defined. We re-attach there for each new
  // textarea via attachAutosaveListener if available.
  if (typeof triggerAutoSave === 'function') {
    textareaEl.addEventListener('input', triggerAutoSave);
  }
}

// Create (lazily) the per-tab textarea for a given tab. The textarea inherits
// the same id-less class structure as the original #editor template so all
// existing CSS keeps working. Returns the textarea element.
function ensureTabEditor(tab) {
  if (tab.editorEl) return tab.editorEl;
  const ta = document.createElement('textarea');
  ta.className = 'editor';
  ta.spellcheck = false;
  ta.dataset.tabId = String(tab.id);
  ta.style.display = 'none'; // hidden until setActiveEditor shows it
  // Seed with content (no undo history yet — first edits start fresh history)
  ta.value = tab.content || '';
  editorContainer.appendChild(ta);
  attachEditorListeners(ta);
  tab.editorEl = ta;
  return ta;
}

// Get the visible "wrapper" element for a tab's editor. When the tab has an
// EasyMDE instance, EasyMDE wraps the textarea in a `.EasyMDEContainer` div
// and the textarea itself becomes hidden — so the wrapper is what we toggle
// for visibility. When there's no EasyMDE, the wrapper IS the textarea.
function getTabEditorWrapper(tab) {
  if (!tab || !tab.editorEl) return null;
  if (tab.easyMDE) {
    return tab.editorEl.closest('.EasyMDEContainer') || tab.editorEl;
  }
  return tab.editorEl;
}

// Make `tab`'s editor the visible/active one. Hides whatever was previously
// visible (without destroying it) and reassigns the global `editor` and
// `easyMDE` refs so all existing call sites that use `editor.value` etc.
// transparently target the new active tab's editor.
function setActiveEditor(tab) {
  // Hide every per-tab editor wrapper first
  for (const t of tabs) {
    const wrapper = getTabEditorWrapper(t);
    if (wrapper) wrapper.style.display = 'none';
    // Also hide the bare textarea in case it's not wrapped yet
    if (t.editorEl) t.editorEl.style.display = 'none';
  }
  // Hide the fallback too
  if (fallbackEditor) fallbackEditor.style.display = 'none';

  if (tab) {
    const ta = ensureTabEditor(tab);
    if (tab.easyMDE) {
      // Rich mode: show the EasyMDE wrapper (textarea stays hidden inside it)
      const wrapper = getTabEditorWrapper(tab);
      if (wrapper) wrapper.style.display = '';
    } else {
      // Plain mode: show the textarea
      ta.style.display = '';
    }
    editor = ta;
    easyMDE = tab.easyMDE || null;
  } else {
    // No active tab — fall back to the placeholder textarea so global `editor`
    // is never null and code that accesses it doesn't crash.
    if (fallbackEditor) {
      fallbackEditor.style.display = '';
      editor = fallbackEditor;
    }
    easyMDE = null;
  }
}

// Free a tab's editor resources (called on tab close).
function releaseTabEditor(tab) {
  if (tab.easyMDE) {
    try { tab.easyMDE.toTextArea(); } catch {}
    tab.easyMDE = null;
  }
  if (tab.editorEl && tab.editorEl.parentNode) {
    tab.editorEl.parentNode.removeChild(tab.editorEl);
  }
  tab.editorEl = null;
}

function showEditor(content) {
  // Find the current tab and make sure its textarea is the active one
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) {
    setActiveEditor(tab);
    // Only seed value when content differs — preserves the textarea's undo
    // history when re-entering edit mode after a preview toggle.
    if (typeof content === 'string' && editor.value !== content) {
      editor.value = content;
    }
  } else if (typeof content === 'string') {
    editor.value = content;
  }
  editorContainer.classList.remove('hidden');
  markdownBody.classList.add('hidden');
  dropZone.classList.add('hidden');
  document.getElementById('content').classList.remove('hidden');
  editor.focus();
}

function hideEditor() {
  editorContainer.classList.add('hidden');
  markdownBody.classList.remove('hidden');
}

async function writeTabToDisk(tab, { fromAutoSave = false } = {}) {
  if (!tab || !tab.filePath) {
    return { success: false, error: 'missing-path' };
  }

  const currentMtime = await window.electronAPI.getFileMtime(tab.filePath);
  const hasExternalChange = !!tab.externalChangePending
    || (currentMtime && tab.lastKnownMtime && currentMtime > tab.lastKnownMtime);

  if (hasExternalChange) {
    if (fromAutoSave) {
      tab.externalChangePending = true;
      if (currentMtime) {
        tab.lastKnownMtime = currentMtime;
      }
      return { success: false, conflict: true };
    }

    const overwrite = confirm(`File "${tab.fileName}" has been modified externally since you opened or last saved it. Overwrite anyway?`);
    if (!overwrite) {
      tab.externalChangePending = true;
      if (currentMtime) {
        tab.lastKnownMtime = currentMtime;
      }
      return { success: false, conflict: true, cancelled: true };
    }

    tab.externalChangePending = false;
  }

  const result = await window.electronAPI.saveFile(tab.filePath, tab.content);
  if (result && result.success) {
    tab.lastKnownMtime = result.mtime;
    tab.externalChangePending = false;
  }
  return result || { success: false, error: 'save-failed' };
}

// Save file
async function saveFile() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;

  if (tab.isEditing) {
    tab.content = easyMDE ? easyMDE.value() : editor.value;
  }

  if (tab.filePath) {
    const result = await writeTabToDisk(tab);
    if (result && result.success) {
      tab.isModified = false;
      // Update original content to match saved content, so 'Revert' goes back to this save
      if (tab.isEditing) {
        tab.originalContent = tab.content;
      }
      updateTabUI(activeTabId);
      document.title = `${tab.fileName} - OpenMarkdownReader`;
    }
  } else {
    // No file path, use save as
    const result = await window.electronAPI.saveFileAs(tab.content, tab.fileName);
    if (result) {
      tab.filePath = result.filePath;
      tab.fileName = result.fileName;
      tab.lastKnownMtime = result.mtime;
      tab.isModified = false;
      tab.externalChangePending = false;
      // Update original content here too
      if (tab.isEditing) {
        tab.originalContent = tab.content;
      }
      updateTabDisplay(activeTabId, tab.fileName, tab.filePath);
      updateTabUI(activeTabId);
      syncActiveSidebarFileHighlight();
      document.title = `${tab.fileName} - OpenMarkdownReader`;
    }
  }
}

// Save file with dialog (always prompts for path)
async function saveFileAs() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;

  if (tab.isEditing) {
    tab.content = easyMDE ? easyMDE.value() : editor.value;
  }

  const previousPath = tab.filePath;
  const defaultPath = tab.filePath || tab.fileName;
  const result = await window.electronAPI.saveFileAs(tab.content, defaultPath);
  if (!result) return;

  if (settings.watchFileMode && previousPath && previousPath !== result.filePath) {
    window.electronAPI.unwatchFile(previousPath);
  }

  tab.filePath = result.filePath;
  tab.fileName = result.fileName;
  tab.lastKnownMtime = result.mtime;
  tab.isModified = false;
  tab.externalChangePending = false;
  if (tab.isEditing) tab.originalContent = tab.content;

  updateTabDisplay(activeTabId, tab.fileName, tab.filePath);
  updateTabUI(activeTabId);
  syncActiveSidebarFileHighlight();
  document.title = `${tab.fileName} - OpenMarkdownReader`;

  if (settings.watchFileMode) {
    window.electronAPI.watchFile(tab.filePath, getWatcherOptions());
  }
}

// Sidebar toggle
sidebarToggle.addEventListener('click', () => {
  setSidebarVisibility(!settings.sidebarVisible);
});

// Open folder
openFolderBtn.addEventListener('click', () => {
  window.electronAPI.openFolder();
});

// Toggle sort mode
sidebarSortBtn.addEventListener('click', () => {
  settings.sidebarSortMode = settings.sidebarSortMode === 'name' ? 'date' : 'name';
  updateSidebarSortUI();
  
  // Sort and re-render
  if (directoryFiles) {
    sortDirectoryFiles(directoryFiles);
    renderFileTree();
  }
});

updateSidebarSortUI();
applySidebarWidth(settings.sidebarWidth);
initSidebarResizer();
setSidebarVisibility(settings.sidebarVisible);

// Collapse all expanded folders in the sidebar tree
function collapseAllFolders() {
  if (expandedFolders.size === 0) return;
  expandedFolders.clear();
  // Re-render the file tree from scratch (cheaper and simpler than walking the DOM)
  if (settings.sidebarViewMode === 'tree') {
    renderFileTree();
  }
}

if (sidebarCollapseAllBtn) {
  sidebarCollapseAllBtn.addEventListener('click', () => {
    collapseAllFolders();
  });
}

// Toggle recent files view
sidebarRecentBtn.addEventListener('click', () => {
  if (settings.sidebarViewMode === 'tree') {
    settings.sidebarViewMode = 'recent';
    sidebarRecentBtn.classList.add('active');
    sidebarRecentBtn.style.color = 'var(--link-color)';
    sidebarRecentBtn.title = 'View: Recent by Folder (Click for Timeline)';
  } else if (settings.sidebarViewMode === 'recent') {
    settings.sidebarViewMode = 'timeline';
    sidebarRecentBtn.classList.add('active');
    sidebarRecentBtn.style.color = '#8250df'; // Purple for timeline
    sidebarRecentBtn.title = 'View: Timeline (Click for File Tree)';
  } else {
    settings.sidebarViewMode = 'tree';
    sidebarRecentBtn.classList.remove('active');
    sidebarRecentBtn.style.color = '';
    sidebarRecentBtn.title = 'Show Recently Modified';
  }
  renderFileTree();
});

// Dev restart button — handles two modes:
//   - 'restart' (main.js / preload.js changed) → full app.relaunch()
//   - 'reload'  (renderer.js / index.html / styles.css changed) → soft reload, much faster
// Restart wins over reload if both kinds of files are pending — main process must
// be the freshest copy.
let devRestartMode = 'restart'; // 'restart' | 'reload'
const devRestartLabel = devRestartBtn ? devRestartBtn.querySelector('.dev-restart-btn-label') : null;

function setDevRestartMode(mode, filename) {
  if (!devRestartBtn) return;
  // Don't downgrade restart→reload if a restart is already pending
  if (devRestartMode === 'restart' && mode === 'reload' && !devRestartBtn.classList.contains('hidden')) {
    return;
  }
  devRestartMode = mode;
  devRestartBtn.classList.remove('hidden');
  if (devRestartLabel) {
    devRestartLabel.textContent = mode === 'reload' ? 'Reload' : 'Restart';
  }
  const action = mode === 'reload' ? 'Reload' : 'Restart';
  const fname = filename ? ` (${filename})` : '';
  devRestartBtn.title = `Source code changed${fname}. Click to ${action.toLowerCase()}.`;
  const verb = mode === 'reload' ? 'Reload' : 'Restart';
  showToast(`Source code changed${fname}. ${verb} required.`, 'warning', 4000);
}

if (devRestartBtn) {
  devRestartBtn.addEventListener('click', () => {
    if (devRestartMode === 'reload') {
      window.electronAPI.reloadRenderer();
    } else {
      window.electronAPI.restartApp();
    }
  });

  window.electronAPI.onSourceCodeChanged((payload) => {
    setDevRestartMode('restart', payload && payload.filename);
  });

  if (window.electronAPI.onRendererChanged) {
    window.electronAPI.onRendererChanged((payload) => {
      setDevRestartMode('reload', payload && payload.filename);
    });
  }
}

// Listen for toast messages from main process (e.g. diagnostic info copied)
if (window.electronAPI && window.electronAPI.onShowToast) {
  window.electronAPI.onShowToast((message, type) => showToast(message, type));
}

// Update sidebar path display
function updateSidebarPath(dirPath) {
  if (!dirPath) {
    sidebarPath.classList.add('hidden');
    stopSidebarLiveWatcher();
    return;
  }

  // Show the path, with home directory abbreviated
  const homePath = dirPath.replace(/^\/Users\/[^/]+/, '~');
  const folderName = dirPath.split('/').pop();

  sidebarPathText.textContent = folderName;
  sidebarPathText.title = dirPath; // Full path on hover
  sidebarPath.classList.remove('hidden');
}

function stopSidebarLiveWatcher() {
  if (sidebarLiveWatchTimer) {
    clearInterval(sidebarLiveWatchTimer);
    sidebarLiveWatchTimer = null;
  }
}

async function computeSidebarLiveSignature(dirPath) {
  if (!dirPath) return '';
  try {
    const allFiles = await window.electronAPI.getAllFilesRecursive(dirPath);
    const signatures = allFiles
      .map(item => `${item.path || ''}:${item.mtime || ''}`)
      .sort();
    return signatures.join('|');
  } catch {
    return '';
  }
}

async function refreshSidebarFromFilesystem(force = false) {
  if (!currentDirectory) return;
  try {
    const signature = await computeSidebarLiveSignature(currentDirectory);
    if (!force && signature && signature === sidebarLiveWatchSignature) return;
    sidebarLiveWatchSignature = signature;
    const freshTree = await window.electronAPI.getDirectoryContents(currentDirectory);
    directoryFiles = freshTree;
    sortDirectoryFiles(directoryFiles);
    renderFileTree();
    if (selectedSidebarFolderPath) {
      setSelectedSidebarFolder(selectedSidebarFolderPath);
    }
    syncActiveSidebarFileHighlight();
  } catch (err) {
    console.error('Error refreshing sidebar from filesystem watcher:', err);
  }
}

function startSidebarLiveWatcher() {
  stopSidebarLiveWatcher();
  sidebarLiveWatchSignature = '';
  if (!currentDirectory) return;
  refreshSidebarFromFilesystem(true);
  sidebarLiveWatchTimer = setInterval(() => {
    refreshSidebarFromFilesystem(false);
  }, 1500);
}

function setSelectedSidebarFolder(folderPath) {
  selectedSidebarFolderPath = folderPath || null;
  fileTree.querySelectorAll('.file-tree-folder.selected').forEach(el => {
    el.classList.remove('selected');
  });
  if (!selectedSidebarFolderPath) return;
  const selectedEl = findFolderElementByPath(selectedSidebarFolderPath);
  if (selectedEl) {
    selectedEl.classList.add('selected');
  }
}

function getSelectedFolderTargetDirectory() {
  if (!currentDirectory) return null;
  if (!selectedSidebarFolderPath) return currentDirectory;
  if (
    selectedSidebarFolderPath === currentDirectory ||
    selectedSidebarFolderPath.startsWith(currentDirectory + window.electronAPI.pathSep)
  ) {
    return selectedSidebarFolderPath;
  }
  return currentDirectory;
}

function getTargetItemsForDirectory(dirPath) {
  if (!dirPath || !currentDirectory) return null;
  if (dirPath === currentDirectory) return directoryFiles;

  const folderItem = findItemByPath(directoryFiles, dirPath);
  if (!folderItem) return null;
  if (!Array.isArray(folderItem.children)) folderItem.children = [];
  return folderItem.children;
}

function findFolderElementByPath(folderPath) {
  return Array.from(fileTree.querySelectorAll('.file-tree-folder'))
    .find(el => el.dataset.path === folderPath) || null;
}

async function ensureFolderLoadedForNewItem(dirPath) {
  if (!dirPath || dirPath === currentDirectory) return;

  const folderItem = findItemByPath(directoryFiles, dirPath);
  if (!folderItem) return;

  const folderEl = findFolderElementByPath(dirPath);
  if (!Array.isArray(folderItem.children)) {
    try {
      const contents = await window.electronAPI.getDirectoryContents(dirPath);
      sortDirectoryFiles(contents);
      folderItem.children = contents;
    } catch (err) {
      console.error('Failed to load selected folder contents for new item:', err);
      if (!Array.isArray(folderItem.children)) folderItem.children = [];
    }
  }

  if (folderEl && !expandedFolders.has(dirPath)) {
    expandedFolders.add(dirPath);
  }
}

// Click on path to open in Finder
sidebarPathText.addEventListener('click', () => {
  if (currentDirectory) {
    setSelectedSidebarFolder(currentDirectory);
    window.electronAPI.openInFinder(currentDirectory);
  }
});

// Right-click on path to show context menu
sidebarPathText.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (currentDirectory) {
    setSelectedSidebarFolder(currentDirectory);
    window.electronAPI.showFolderContextMenu(currentDirectory);
  }
});

// New folder from sidebar
sidebarNewFolderBtn.addEventListener('click', () => {
  if (currentDirectory) {
    createNewFolderInDirectory(currentDirectory);
  }
});

// Create a new folder in the directory with inline editing
async function createNewFolderInDirectory(dirPath) {
  // Generate a unique default name
  let defaultName = 'New Folder';
  let counter = 1;
  const existingNames = new Set();

  // Collect existing names
  directoryFiles.forEach(item => existingNames.add(item.name));

  while (existingNames.has(defaultName)) {
    defaultName = `New Folder ${counter++}`;
  }

  // Create a temporary item in the tree
  const tempItem = {
    name: defaultName,
    path: null,
    type: 'folder',
    isNew: true
  };

  // Add to beginning of directory files (folders first)
  directoryFiles.unshift(tempItem);
  renderFileTree();

  // Find the new element and start inline editing
  const newEl = fileTree.querySelector('.file-tree-folder.new-folder');
  if (newEl) {
    startNewFolderRename(newEl, tempItem, dirPath, defaultName);
  }
}

// Rename new folder inline
function startNewFolderRename(el, tempItem, dirPath, defaultName) {
  const span = el.querySelector('span');
  const input = document.createElement('input');
  input.type = 'text';
  input.value = defaultName;
  input.className = 'file-tree-rename-input';
  span.replaceWith(input);
  el.classList.add('renaming');

  input.focus();
  input.select();

  async function finishRename() {
    const newName = input.value.trim();

    if (!newName) {
      // Cancel - remove temp item
      const idx = directoryFiles.indexOf(tempItem);
      if (idx >= 0) directoryFiles.splice(idx, 1);
      renderFileTree();
      return;
    }

    // Create the folder
    const result = await window.electronAPI.createFolderInDirectory(dirPath, newName);

    if (result.success) {
      // Update temp item with real data
      tempItem.name = result.folderName;
      tempItem.path = result.folderPath;
      tempItem.isNew = false;
      renderFileTree();
    } else {
      alert(`Could not create folder: ${result.error}`);
      const idx = directoryFiles.indexOf(tempItem);
      if (idx >= 0) directoryFiles.splice(idx, 1);
      renderFileTree();
    }
  }

  input.addEventListener('blur', finishRename);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      const idx = directoryFiles.indexOf(tempItem);
      if (idx >= 0) directoryFiles.splice(idx, 1);
      renderFileTree();
    }
  });
}

// New file from sidebar
sidebarNewFileBtn.addEventListener('click', async () => {
  if (currentDirectory) {
    const targetDirectory = getSelectedFolderTargetDirectory();
    if (targetDirectory) {
      await createNewFileInDirectory(targetDirectory);
    }
  } else {
    // No directory open, create untitled tab
    const tabId = createTab('Untitled.md', '', null);
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      tab.isEditing = true;
      tab.originalContent = '';
      showEditor('');
      updateTabUI(tabId);
    }
  }
});

// Create a new file in the directory with inline editing
async function createNewFileInDirectory(dirPath) {
  await ensureFolderLoadedForNewItem(dirPath);

  const targetItems = getTargetItemsForDirectory(dirPath);
  if (!targetItems) return;

  // Generate a unique default name
  let defaultName = 'Untitled.md';
  let counter = 1;
  const existingNames = new Set();

  // Collect existing file names in target directory
  for (const item of targetItems) {
    if (item.type === 'file') {
      existingNames.add(item.name.toLowerCase());
    }
  }

  while (existingNames.has(defaultName.toLowerCase())) {
    defaultName = `Untitled ${counter}.md`;
    counter++;
  }

  // Create a temporary item in the file tree for editing
  const tempItem = {
    name: defaultName,
    path: null, // Will be set after creation
    type: 'file',
    isNew: true,
    tempId: `new-file-${++pendingNewTreeItemId}`,
    isMarkdown: true,
    isTextFile: true
  };

  // Add to beginning of target folder temporarily
  targetItems.unshift(tempItem);

  // Re-render the file tree
  renderFileTree();

  // Find the new file element and start editing
  const newFileEl = fileTree.querySelector(`.file-tree-file.new-file[data-temp-id="${tempItem.tempId}"]`);
  if (newFileEl) {
    // Scroll into view
    newFileEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Start inline editing
    startNewFileRename(newFileEl, tempItem, dirPath, defaultName, targetItems);
  }
}

// Listen for directory loaded
window.electronAPI.onDirectoryLoaded((data) => {
  console.log('Directory loaded:', data);
  currentDirectory = data.dirPath;
  directoryFiles = data.files;

  try {
    // Apply current sort
    sortDirectoryFiles(directoryFiles);
  } catch (err) {
    console.error('Error sorting files:', err);
  }

  // Update sidebar path display
  updateSidebarPath(currentDirectory);
  setSelectedSidebarFolder(currentDirectory);

  // Pre-fetch all files for command palette and wiki links
  allFilesCache = null;
  wikiLinkByPath.clear();
  wikiLinkByName.clear();
  allFilesCachePromise = window.electronAPI.getAllFilesRecursive(currentDirectory)
    .then(files => {
      // setAllFilesCache builds the wiki link index AND re-renders the active
      // preview tab so any [[wikilinks]] that rendered before the index was
      // ready get resolved.
      setAllFilesCache(files);
      // If palette is open, update results immediately
      if (!commandPalette.classList.contains('hidden')) {
        updateCommandPaletteResults();
      }
      return files;
    })
    .catch(err => {
      console.error('Error prefetching files for command palette:', err);
      allFilesCache = [];
      return [];
    })
    .finally(() => {
      allFilesCachePromise = null;
    });

  // Show sidebar and render the file tree
  setSidebarVisibility(true);
  renderFileTree();
  startSidebarLiveWatcher();
});

// Track expanded folders
// Sort directory files recursively
function sortDirectoryFiles(items) {
  if (!items) return;

  items.sort((a, b) => {
    // Always keep folders on top
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1;
    }

    if (settings.sidebarSortMode === 'date') {
      // Sort by mtime descending (newest first)
      // Use 0 as fallback if mtime is missing
      const mtimeA = a.mtime || 0;
      const mtimeB = b.mtime || 0;
      if (mtimeA !== mtimeB) {
        return mtimeB - mtimeA;
      }
    }

    // Fallback to name sort (A-Z)
    return (a.name || '').localeCompare(b.name || '');
  });

  // Recurse into children
  items.forEach(item => {
    if (item.type === 'folder' && item.children) {
      sortDirectoryFiles(item.children);
    }
  });
}

const expandedFolders = new Set();

function renderFileTree() {
  console.log('Rendering file tree. Mode:', settings.sidebarViewMode, 'Files:', directoryFiles.length);
  fileTree.innerHTML = '';

  if (settings.sidebarViewMode === 'recent') {
    renderRecentFilesTree();
    return;
  }

  if (settings.sidebarViewMode === 'timeline') {
    renderRecentFilesTimeline();
    return;
  }

  if (!directoryFiles.length) {
    fileTree.innerHTML = '<div class="file-tree-item file-tree-empty">No files</div>';
    return;
  }

  renderFileTreeItems(directoryFiles, fileTree, 0);
  syncActiveSidebarFileHighlight();
  console.log(`[Renderer] fileTree now has ${fileTree.children.length} children`);
}

async function renderRecentFilesTree() {
  console.log('renderRecentFilesTree called. Cache:', allFilesCache ? allFilesCache.length : 'null');
  // Use cached files if available, otherwise fetch
  let files = allFilesCache;
  if (!files) {
    fileTree.innerHTML = '<div class="file-tree-item file-tree-empty">Loading...</div>';
    try {
      console.log('Fetching all files recursively...');
      files = await window.electronAPI.getAllFilesRecursive(currentDirectory);
      console.log('Fetched files:', files.length);
      setAllFilesCache(files);
    } catch (e) {
      console.error('Error loading recursive files:', e);
      fileTree.innerHTML = '<div class="file-tree-item file-tree-empty">Error loading files</div>';
      return;
    }
  }

  const now = Date.now();
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
  
  // Filter for files modified in last week (and only files, not folders)
  const recentFiles = files.filter(f => 
    f.type === 'file' && 
    f.mtime && 
    (now - f.mtime < ONE_WEEK)
  );

  if (recentFiles.length === 0) {
    fileTree.innerHTML = '<div class="file-tree-item file-tree-empty">No recently modified files</div>';
    return;
  }

  // Sort by mtime desc
  recentFiles.sort((a, b) => b.mtime - a.mtime);

  // Group by parent folder
  const grouped = new Map();
  recentFiles.forEach(file => {
    const relativePath = file.path.replace(currentDirectory, '');
    const parentFolder = relativePath.split('/').slice(0, -1).join('/') || '/'; // Root is /
    
    if (!grouped.has(parentFolder)) {
      grouped.set(parentFolder, []);
    }
    grouped.get(parentFolder).push(file);
  });

  // Render groups
  // We sort groups by the mtime of their most recent file
  const sortedGroups = Array.from(grouped.entries()).sort((a, b) => {
    const maxMtimeA = Math.max(...a[1].map(f => f.mtime));
    const maxMtimeB = Math.max(...b[1].map(f => f.mtime));
    return maxMtimeB - maxMtimeA;
  });

  fileTree.innerHTML = '';

  sortedGroups.forEach(([folderPath, groupFiles]) => {
    // Render folder header
    const folderEl = document.createElement('div');
    folderEl.className = 'file-tree-item file-tree-folder expanded';
    folderEl.style.paddingLeft = '12px';
    folderEl.style.opacity = '0.7';
    folderEl.style.marginTop = '4px';
    folderEl.style.cursor = 'pointer';
    folderEl.title = 'Click to reveal in file tree';
    folderEl.innerHTML = `
      <svg class="folder-icon" viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
        <path d="M1.75 2.5a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25v-8.5a.25.25 0 00-.25-.25H7.5c-.55 0-1.07-.26-1.4-.7l-.9-1.2a.25.25 0 00-.2-.1H1.75z"/>
      </svg>
      <span style="font-size: 11px; font-weight: 600;">${folderPath === '/' ? '(root)' : folderPath.replace(/^\//, '')}</span>
    `;
    
    // Click to reveal
    const fullFolderPath = folderPath === '/' ? currentDirectory : window.electronAPI.pathJoin(currentDirectory, folderPath);
    folderEl.addEventListener('click', () => {
      revealFolderInTree(fullFolderPath);
    });

    fileTree.appendChild(folderEl);

    // Render files
    groupFiles.forEach(file => {
      const el = document.createElement('div');
      el.className = 'file-tree-item file-tree-file';
      el.dataset.path = file.path;
      el.title = file.path;
      if (isActiveSidebarFilePath(file.path, getActiveSidebarFilePath())) {
        el.classList.add('active');
      }
      // Indent slightly more for list view feel
      el.style.paddingLeft = '28px'; 
      el.style.height = 'auto'; // Allow variable height
      el.style.paddingTop = '6px';
      el.style.paddingBottom = '6px';
      
      const isTextFile = file.isMarkdown || file.isTextFile;
      if (!isTextFile) el.classList.add('non-markdown');
      
      // Calculate relative time string
      const date = new Date(file.mtime);
      const timeString = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      el.innerHTML = `
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" style="margin-top: 2px;">
          <path d="M3.75 1.5a.25.25 0 00-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V4.664a.25.25 0 00-.073-.177l-2.914-2.914a.25.25 0 00-.177-.073H3.75zM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v8.586A1.75 1.75 0 0112.25 15h-8.5A1.75 1.75 0 012 13.25V1.75z"/>
        </svg>
        <div style="display: flex; flex-direction: column; min-width: 0;">
          <span style="line-height: 1.2;">${escapeHtml(file.name)}</span>
          <span style="font-size: 10px; color: var(--text-secondary); opacity: 0.8;">${timeString}</span>
        </div>
      `;
      
      el.addEventListener('click', (e) => {
        const options = {};
        if (e.metaKey) {
          options.newTab = true;
          options.background = !e.shiftKey;
        }
        window.electronAPI.openFileByPath(file.path, options);
      });

      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        window.electronAPI.showFileContextMenu(file.path);
      });
      
      fileTree.appendChild(el);
    });
  });

  syncActiveSidebarFileHighlight();
}

async function renderRecentFilesTimeline() {
  let files = allFilesCache;
  if (!files) {
    fileTree.innerHTML = '<div class="file-tree-item file-tree-empty">Loading...</div>';
    try {
      files = await window.electronAPI.getAllFilesRecursive(currentDirectory);
      setAllFilesCache(files);
    } catch (e) {
      fileTree.innerHTML = '<div class="file-tree-item file-tree-empty">Error loading files</div>';
      return;
    }
  }

  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const ONE_WEEK = 7 * ONE_DAY;
  
  const recentFiles = files.filter(f => 
    f.type === 'file' && 
    f.mtime && 
    (now - f.mtime < ONE_WEEK)
  );

  if (recentFiles.length === 0) {
    fileTree.innerHTML = '<div class="file-tree-item file-tree-empty">No recently modified files</div>';
    return;
  }

  // Sort by mtime desc
  recentFiles.sort((a, b) => b.mtime - a.mtime);

  // Group by Day (Today, Yesterday, Date)
  const groupedByDay = new Map();
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  recentFiles.forEach(file => {
    const fileDate = new Date(file.mtime);
    fileDate.setHours(0, 0, 0, 0);
    
    let dayLabel;
    if (fileDate.getTime() === today.getTime()) {
      dayLabel = 'Today';
    } else if (fileDate.getTime() === yesterday.getTime()) {
      dayLabel = 'Yesterday';
    } else {
      dayLabel = fileDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    }

    if (!groupedByDay.has(dayLabel)) {
      groupedByDay.set(dayLabel, []);
    }
    groupedByDay.get(dayLabel).push(file);
  });

  fileTree.innerHTML = '';

  groupedByDay.forEach((dayFiles, dayLabel) => {
    // Render Day Header
    const dayHeader = document.createElement('div');
    dayHeader.className = 'file-tree-item';
    dayHeader.style.fontSize = '11px';
    dayHeader.style.fontWeight = '700';
    dayHeader.style.textTransform = 'uppercase';
    dayHeader.style.color = 'var(--text-secondary)';
    dayHeader.style.marginTop = '12px';
    dayHeader.style.marginBottom = '4px';
    dayHeader.style.paddingLeft = '12px';
    dayHeader.style.letterSpacing = '0.5px';
    dayHeader.style.cursor = 'default';
    dayHeader.textContent = dayLabel;
    fileTree.appendChild(dayHeader);

    // Group files by folder within this day
    const filesByFolder = new Map();
    dayFiles.forEach(file => {
      const relativePath = file.path.replace(currentDirectory, '');
      const parentFolder = relativePath.split('/').slice(0, -1).join('/') || '/';
      
      if (!filesByFolder.has(parentFolder)) {
        filesByFolder.set(parentFolder, []);
      }
      filesByFolder.get(parentFolder).push(file);
    });

    filesByFolder.forEach((groupFiles, folderPath) => {
      // Render Folder Sub-header
      const folderEl = document.createElement('div');
      folderEl.className = 'file-tree-item file-tree-folder expanded';
      folderEl.style.paddingLeft = '12px';
      folderEl.style.opacity = '0.8';
      folderEl.style.cursor = 'pointer';
      folderEl.title = 'Click to reveal in file tree';
      folderEl.innerHTML = `
        <svg class="folder-icon" viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path d="M1.75 2.5a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25v-8.5a.25.25 0 00-.25-.25H7.5c-.55 0-1.07-.26-1.4-.7l-.9-1.2a.25.25 0 00-.2-.1H1.75z"/>
        </svg>
        <span style="font-size: 11px; font-weight: 500;">${folderPath === '/' ? '(root)' : folderPath.replace(/^\//, '')}</span>
      `;
      
      // Click to reveal
      const fullFolderPath = folderPath === '/' ? currentDirectory : window.electronAPI.pathJoin(currentDirectory, folderPath);
      folderEl.addEventListener('click', () => {
        revealFolderInTree(fullFolderPath);
      });

      folderEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        window.electronAPI.showFolderContextMenu(fullFolderPath);
      });

      fileTree.appendChild(folderEl);

      // Render Files
      groupFiles.forEach(file => {
        const el = document.createElement('div');
        el.className = 'file-tree-item file-tree-file';
        el.dataset.path = file.path;
        el.title = file.path;
        if (isActiveSidebarFilePath(file.path, getActiveSidebarFilePath())) {
          el.classList.add('active');
        }
        el.style.paddingLeft = '28px'; 
        el.style.height = 'auto';
        el.style.paddingTop = '4px';
        el.style.paddingBottom = '4px';
        
        const isTextFile = file.isMarkdown || file.isTextFile;
        if (!isTextFile) el.classList.add('non-markdown');
        
        const date = new Date(file.mtime);
        const timeString = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

        el.innerHTML = `
          <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" style="margin-top: 2px;">
            <path d="M3.75 1.5a.25.25 0 00-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V4.664a.25.25 0 00-.073-.177l-2.914-2.914a.25.25 0 00-.177-.073H3.75zM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v8.586A1.75 1.75 0 0112.25 15h-8.5A1.75 1.75 0 012 13.25V1.75z"/>
          </svg>
          <div style="display: flex; align-items: baseline; min-width: 0; gap: 6px;">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(file.name)}</span>
            <span style="font-size: 10px; color: var(--text-secondary); opacity: 0.7; white-space: nowrap;">${timeString}</span>
          </div>
        `;
        
        el.addEventListener('click', (e) => {
          const options = {};
          if (e.metaKey) {
            options.newTab = true;
            options.background = !e.shiftKey;
          }
          window.electronAPI.openFileByPath(file.path, options);
        });

        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          window.electronAPI.showFileContextMenu(file.path);
        });
        
        fileTree.appendChild(el);
      });
    });
  });

  syncActiveSidebarFileHighlight();
}

async function revealFolderInTree(targetPath) {
  // Switch to tree view
  settings.sidebarViewMode = 'tree';
  sidebarRecentBtn.classList.remove('active');
  sidebarRecentBtn.style.color = '';
  
  // Re-render tree
  renderFileTree();

  if (!targetPath || targetPath === currentDirectory) return;

  // We need to expand the path to this folder
  // Path parts relative to root
  const relativePath = targetPath.startsWith(currentDirectory) 
    ? targetPath.replace(currentDirectory + '/', '') // Remove root + slash
    : targetPath;
    
  const parts = relativePath.split('/').filter(p => p);
  
  let currentPath = currentDirectory;
  
  // Expand each segment
  for (const part of parts) {
    currentPath += '/' + part;
    
    // 1. Find the element in current DOM
    const folderEl = fileTree.querySelector(`.file-tree-folder[data-path="${currentPath}"]`);
    
    if (folderEl) {
      if (!expandedFolders.has(currentPath)) {
        await toggleFolder(currentPath, folderEl);
      }
      // If it's the target, scroll into view
      if (currentPath === targetPath) {
        folderEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Highlight briefly
        folderEl.classList.add('active');
        setTimeout(() => folderEl.classList.remove('active'), 2000);
      }
    } else {
      // Should not happen if logic is correct and tree is rendered
      console.warn('Could not find folder element to expand:', currentPath);
      break;
    }
  }
}

function clearSidebarDropTargetHighlight() {
  fileTree.querySelectorAll('.file-tree-folder.drop-target').forEach(folderEl => {
    folderEl.classList.remove('drop-target');
  });
}

function refreshSidebarCachesAfterFileMove() {
  allFilesCache = null;
  allFilesCachePromise = null;
  wikiLinkByPath.clear();
  wikiLinkByName.clear();
  wikiLinkConflicts.clear();
}

function updateOpenTabsForMovedFile(oldPath, newPath, fileName) {
  tabs.forEach(tab => {
    if (tab.filePath === oldPath) {
      tab.filePath = newPath;
      tab.fileName = fileName;
      updateTabDisplay(tab.id, fileName, newPath);
      if (tab.id === activeTabId) {
        document.title = `${fileName} - OpenMarkdownReader`;
      }
    }
  });
}

async function handleSidebarFileMove(sourcePath, targetFolderPath) {
  if (!sourcePath || !targetFolderPath) return;
  if (!currentDirectory || settings.sidebarViewMode !== 'tree') return;

  const currentParentDir = window.electronAPI.pathDirname(sourcePath);
  if (currentParentDir === targetFolderPath) {
    showToast('File is already in that folder', 'warning', 2500);
    return;
  }

  const result = await window.electronAPI.moveFileToDirectory(sourcePath, targetFolderPath);
  if (!result || !result.success) {
    showToast(`Could not move file: ${result && result.error ? result.error : 'Unknown error'}`, 'error');
    return;
  }

  if (sidebarTreeUtils && typeof sidebarTreeUtils.moveFileInTree === 'function') {
    const treeMove = sidebarTreeUtils.moveFileInTree(directoryFiles, {
      sourcePath,
      targetFolderPath,
      newPath: result.newPath,
      newName: result.fileName
    });
    if (!treeMove.success) {
      console.warn('Tree move sync warning:', treeMove.error);
    }
  }

  sortDirectoryFiles(directoryFiles);
  updateOpenTabsForMovedFile(sourcePath, result.newPath, result.fileName);
  refreshSidebarCachesAfterFileMove();
  renderFileTree();
  syncActiveSidebarFileHighlight();
  showToast(`Moved "${result.fileName}"`, 'success', 2500);
}

function renderFileTreeItems(items, container, depth) {
  items.forEach(item => {
    const el = document.createElement('div');
    el.style.setProperty('--depth', depth);
    const labelTitle = item.path || item.name;

    if (item.type === 'folder') {
      const isExpanded = expandedFolders.has(item.path);
      const isSelected = !!selectedSidebarFolderPath && item.path === selectedSidebarFolderPath;
      el.className = `file-tree-item file-tree-folder ${isExpanded ? 'expanded' : ''}${isSelected ? ' selected' : ''}${item.isNew ? ' new-folder' : ''}`;
      el.dataset.path = item.path;
      el.title = labelTitle;
      el.innerHTML = `
        <svg class="folder-chevron" viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
          <path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z"/>
        </svg>
        <svg class="folder-icon" viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path d="M1.75 2.5a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25v-8.5a.25.25 0 00-.25-.25H7.5c-.55 0-1.07-.26-1.4-.7l-.9-1.2a.25.25 0 00-.2-.1H1.75z"/>
        </svg>
        <span class="file-tree-label" title="${escapeHtml(labelTitle)}">${escapeHtml(item.name)}</span>
      `;
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        setSelectedSidebarFolder(item.path);
        await toggleFolder(item.path, el);
      });
      el.addEventListener('dragover', (e) => {
        if (!draggedSidebarFilePath || settings.sidebarViewMode !== 'tree') return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('drop-target');
      });
      el.addEventListener('dragleave', () => {
        el.classList.remove('drop-target');
      });
      el.addEventListener('drop', async (e) => {
        if (!draggedSidebarFilePath || settings.sidebarViewMode !== 'tree') return;
        e.preventDefault();
        e.stopPropagation();
        const sourcePath = draggedSidebarFilePath;
        clearSidebarDropTargetHighlight();
        draggedSidebarFilePath = null;
        await handleSidebarFileMove(sourcePath, item.path);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (item.path) {
          setSelectedSidebarFolder(item.path);
          window.electronAPI.showSidebarFolderItemContextMenu(item.path);
        }
      });
      container.appendChild(el);

      // If expanded, render children
      if (isExpanded && item.children) {
        const childContainer = document.createElement('div');
        childContainer.className = 'file-tree-children';
        container.appendChild(childContainer);
        renderFileTreeItems(item.children, childContainer, depth + 1);
      }
    } else {
      // File - show text files normally, other files muted
      const isTextFile = item.isMarkdown || item.isTextFile || isTextFileByName(item.name);
      el.className = `file-tree-item file-tree-file ${isTextFile ? '' : 'non-markdown'}${item.isNew ? ' new-file' : ''}`;
      if (item.path) el.dataset.path = item.path;
      if (item.tempId) el.dataset.tempId = item.tempId;
      if (item.path && isActiveSidebarFilePath(item.path, getActiveSidebarFilePath())) {
        el.classList.add('active');
      }
      el.title = labelTitle;
      el.innerHTML = `
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path d="M3.75 1.5a.25.25 0 00-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V4.664a.25.25 0 00-.073-.177l-2.914-2.914a.25.25 0 00-.177-.073H3.75zM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v8.586A1.75 1.75 0 0112.25 15h-8.5A1.75 1.75 0 012 13.25V1.75z"/>
        </svg>
        <span class="file-tree-label" title="${escapeHtml(labelTitle)}">${escapeHtml(item.name)}</span>
      `;
      // All files are clickable, non-text just shown with muted style
      if (!item.isNew) {
        el.draggable = true;
        el.addEventListener('dragstart', (e) => {
          if (!item.path || settings.sidebarViewMode !== 'tree') {
            e.preventDefault();
            return;
          }
          draggedSidebarFilePath = item.path;
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', item.path);
          }
          el.classList.add('dragging');
        });
        el.addEventListener('dragend', () => {
          el.classList.remove('dragging');
          draggedSidebarFilePath = null;
          clearSidebarDropTargetHighlight();
        });
        el.addEventListener('click', (e) => {
          // Cmd+click = new tab in background, Cmd+Shift+click = new tab and focus
          const options = {};
          if (e.metaKey) {
            options.newTab = true;
            options.background = !e.shiftKey; // Cmd+click = background, Cmd+Shift+click = focus
          }
          window.electronAPI.openFileByPath(item.path, options);
        });
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (item.path) {
            window.electronAPI.showFileContextMenu(item.path);
          }
        });
        // Double-click to rename
        el.querySelector('.file-tree-label').addEventListener('dblclick', (e) => {
          e.stopPropagation();
          startSidebarRename(el, item);
        });
      }
      container.appendChild(el);
    }
  });
}

async function toggleFolder(folderPath, element) {
  if (expandedFolders.has(folderPath)) {
    // Collapse
    expandedFolders.delete(folderPath);
    element.classList.remove('expanded');
    // Remove children container
    const nextEl = element.nextElementSibling;
    if (nextEl && nextEl.classList.contains('file-tree-children')) {
      nextEl.remove();
    }
  } else {
    // Expand - fetch contents
    expandedFolders.add(folderPath);
    element.classList.add('expanded');

    const contents = await window.electronAPI.getDirectoryContents(folderPath);

    // Apply current sort
    sortDirectoryFiles(contents);

    // Store children in our data structure
    const folderItem = findItemByPath(directoryFiles, folderPath);
    if (folderItem) {
      folderItem.children = contents;
    }

    // Insert children container after folder element
    const childContainer = document.createElement('div');
    childContainer.className = 'file-tree-children';
    element.after(childContainer);

    const depth = parseInt(element.style.getPropertyValue('--depth') || '0') + 1;
    renderFileTreeItems(contents, childContainer, depth);
  }

  syncActiveSidebarFileHighlight();
}

function findItemByPath(items, targetPath) {
  if (sidebarTreeUtils && typeof sidebarTreeUtils.findItemByPath === 'function') {
    return sidebarTreeUtils.findItemByPath(items, targetPath);
  }
  for (const item of items) {
    if (item.path === targetPath) return item;
    if (item.children) {
      const found = findItemByPath(item.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

// Rename file from sidebar
function startSidebarRename(el, item) {
  el.classList.add('renaming');
  const span = el.querySelector('.file-tree-label');
  const oldName = item.name;

  // Create input element
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = oldName;

  // Select name without extension
  const dotIndex = oldName.lastIndexOf('.');

  span.replaceWith(input);
  input.focus();
  if (dotIndex > 0) {
    input.setSelectionRange(0, dotIndex);
  } else {
    input.select();
  }

  async function finishRename() {
    const newName = input.value.trim();

    if (!newName || newName === oldName) {
      // Cancel rename
      const newSpan = document.createElement('span');
      newSpan.className = 'file-tree-label';
      newSpan.textContent = oldName;
      newSpan.title = item.path || oldName;
      input.replaceWith(newSpan);
      el.classList.remove('renaming');
      // Re-attach dblclick handler
      newSpan.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        startSidebarRename(el, item);
      });
      return;
    }

    // Attempt the rename
    const result = await window.electronAPI.renameFile(item.path, newName);

    if (result.success) {
      // Update the item
      const oldPath = item.path;
      item.path = result.newPath;
      item.name = newName;
      el.dataset.path = result.newPath;
      el.title = result.newPath;

      // Update any open tabs with this file
      for (const tab of tabs) {
        if (tab.filePath === oldPath) {
          tab.filePath = result.newPath;
          tab.fileName = newName;
          updateTabDisplay(tab.id, newName, result.newPath);
          if (tab.id === activeTabId) {
            document.title = `${newName} - OpenMarkdownReader`;
          }
        }
      }

      // Update the span with new name
      const newSpan = document.createElement('span');
      newSpan.className = 'file-tree-label';
      newSpan.textContent = newName;
      newSpan.title = result.newPath;
      input.replaceWith(newSpan);
      el.classList.remove('renaming');
      // Re-attach dblclick handler
      newSpan.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        startSidebarRename(el, item);
      });
    } else {
      // Show error and revert
      alert(`Could not rename file: ${result.error}`);
      const newSpan = document.createElement('span');
      newSpan.className = 'file-tree-label';
      newSpan.textContent = oldName;
      newSpan.title = item.path || oldName;
      input.replaceWith(newSpan);
      el.classList.remove('renaming');
      // Re-attach dblclick handler
      newSpan.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        startSidebarRename(el, item);
      });
    }
  }

  input.addEventListener('blur', finishRename);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input.value = oldName; // Revert to original name
      input.blur();
    }
  });
}

// Create new file in directory with inline editing
function startNewFileRename(el, tempItem, dirPath, defaultName, targetItems) {
  el.classList.add('renaming');
  const span = el.querySelector('span');

  // Create input element
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = defaultName;

  // Select name without extension
  const dotIndex = defaultName.lastIndexOf('.');

  span.replaceWith(input);
  input.focus();
  if (dotIndex > 0) {
    input.setSelectionRange(0, dotIndex);
  } else {
    input.select();
  }

  let completed = false;

  async function finishNewFile() {
    if (completed) return;
    completed = true;

    const fileName = input.value.trim();

    if (!fileName) {
      // Cancel - remove from directoryFiles and re-render
      const idx = targetItems.indexOf(tempItem);
      if (idx !== -1) targetItems.splice(idx, 1);
      renderFileTree();
      return;
    }

    // Ensure .md extension
    const finalName = fileName.endsWith('.md') ? fileName : fileName + '.md';

    // Create the file on disk
    const result = await window.electronAPI.createFileInDirectory(dirPath, finalName);

    if (result.success) {
      // Update tempItem with real path and remove isNew flag
      tempItem.name = finalName;
      tempItem.path = result.filePath;
      delete tempItem.isNew;
      delete tempItem.tempId;

      // Re-render the file tree to reflect actual state
      renderFileTree();

      // Open the file in a new tab in edit mode
      window.electronAPI.openFileByPath(result.filePath, { forceEdit: true });
    } else {
      // Show error and remove temp item
      alert(`Could not create file: ${result.error}`);
      const idx = targetItems.indexOf(tempItem);
      if (idx !== -1) targetItems.splice(idx, 1);
      renderFileTree();
    }
  }

  input.addEventListener('blur', finishNewFile);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Cancel - clear input so finishNewFile will remove it
      input.value = '';
      input.blur();
    }
  });
}

// New file button on welcome screen
document.getElementById('new-file-btn').addEventListener('click', () => {
  const tabId = createTab('Untitled.md', '', null);
  const tab = tabs.find(t => t.id === tabId);
  if (tab) {
    tab.isEditing = true;
    tab.originalContent = '';
    showEditor('');
    updateTabUI(tabId);
  }
});

// Open button (files or folders)
openBtn.addEventListener('click', () => {
  window.electronAPI.openFileOrFolder();
});

// New tab button
newTabBtn.addEventListener('click', () => {
  createTab();
});

// Edit toggle button
editToggleBtn.addEventListener('click', () => {
  toggleEditMode();
});

// Save button
saveBtn.addEventListener('click', () => {
  saveFile();
});

// Share popover functionality
function updateSharePopoverState() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;

  // Update popover state based on publication status
  if (tab.publishedUrl) {
    shareUnpublished.classList.add('hidden');
    sharePublished.classList.remove('hidden');
    sharePublishing.classList.add('hidden');
    shareUrlInput.value = tab.publishedUrl;
  } else {
    shareUnpublished.classList.remove('hidden');
    sharePublished.classList.add('hidden');
    sharePublishing.classList.add('hidden');
  }
}

function toggleSharePopover() {
  const isHidden = sharePopover.classList.contains('hidden');
  if (isHidden) {
    updateSharePopoverState();
    sharePopover.classList.remove('hidden');
  } else {
    sharePopover.classList.add('hidden');
  }
}

// Close popover when clicking outside
document.addEventListener('click', (e) => {
  if (!sharePopover.contains(e.target) && !shareBtn.contains(e.target)) {
    sharePopover.classList.add('hidden');
  }
});

// Share button opens popover
shareBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleSharePopover();
});

// Publish button in popover
sharePublishBtn.addEventListener('click', async () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab || !tab.content) return;

  // Get current content (from editor if editing, otherwise from tab)
  let content = tab.content;
  if (tab.isEditing) {
    content = easyMDE ? easyMDE.value() : editor.value;
  }

  const fileName = tab.fileName || 'untitled.md';

  // Show publishing state
  shareUnpublished.classList.add('hidden');
  sharePublishing.classList.remove('hidden');

  try {
    const response = await fetch('https://globalbr.ai/api/files/anonymous', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        fileName,
        contentType: 'text/markdown'
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Upload failed');
    }

    const result = await response.json();
    const shareUrl = result.shareUrl || `https://globalbr.ai${result.url}`;

    // Store the published URL in tab
    tab.publishedUrl = shareUrl;

    // Update UI
    updateSharePopoverState();
    updateTabUI(tab.id);

    // Copy to clipboard automatically
    navigator.clipboard.writeText(shareUrl);
    shareCopyBtn.classList.add('copied');
    setTimeout(() => shareCopyBtn.classList.remove('copied'), 1500);

    // Show success toast
    showToast('Published! URL copied to clipboard', 'success');

    console.log('Published to:', shareUrl);
  } catch (err) {
    console.error('Publish failed:', err);
    // Show error state
    sharePublishing.classList.add('hidden');
    shareUnpublished.classList.remove('hidden');

    if (err.message && err.message.includes('storage not configured')) {
      showToast('File storage is not configured on the server. Check globalbr.ai/settings to set up storage.', 'error');
    } else {
      showToast('Failed to publish: ' + err.message, 'error');
    }
  }
});

// Copy button
shareCopyBtn.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab || !tab.publishedUrl) return;

  navigator.clipboard.writeText(tab.publishedUrl);
  shareCopyBtn.classList.add('copied');
  setTimeout(() => shareCopyBtn.classList.remove('copied'), 1500);
});

// Open in browser button
shareOpenBtn.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab || !tab.publishedUrl) return;

  window.electronAPI.openExternal(tab.publishedUrl);
});

// Listen for file loaded from main process
window.electronAPI.onFileLoaded((data) => {
  const openInBackground = data.openInBackground || false;
  const forceNewTab = data.forceNewTab || false;
  const reuseTab = data.reuseTab || null;

  // If reuseTab is specified (e.g., for refresh), update that specific tab
  if (reuseTab) {
    const tab = tabs.find(t => t.id === reuseTab);
    if (tab) {
      tab.content = data.content;
      tab.lastKnownMtime = data.mtime || null;
      tab.isModified = false;
      tab.externalChangePending = false;
      tab.originalContent = data.content;
      // Only update the visible editor/preview if this is the active tab
      if (tab.id === activeTabId) {
        if (data.forceEdit && !tab.isEditing) {
          tab.isEditing = true;
          showEditor(data.content);
        } else if (tab.isEditing) {
          if (easyMDE) {
            easyMDE.value(data.content);
          } else {
            editor.value = data.content;
          }
        } else {
          renderContent(data.content, data.fileName);
        }
        document.title = `${tab.fileName}${tab.isModified ? ' *' : ''} - OpenMarkdownReader`;
      }
      updateTabUI(reuseTab);
      return;
    }
  }

  // Check if file is already open
  if (data.filePath) {
    const existingTab = tabs.find(t => t.filePath === data.filePath);
    if (existingTab) {
      if (!openInBackground) {
        switchToTab(existingTab.id);
      }

      // Update content if no unsaved changes (fresh from disk)
      if (!existingTab.isModified) {
        existingTab.content = data.content;
        existingTab.lastKnownMtime = data.mtime || null;
        existingTab.externalChangePending = false;
        if (existingTab.isEditing) {
          existingTab.originalContent = data.content;
        }

        // Refresh UI only if it's the active tab
        if (existingTab.id === activeTabId) {
          if (data.forceEdit && !existingTab.isEditing) {
            existingTab.isEditing = true;
            showEditor(data.content);
          } else if (existingTab.isEditing) {
            if (easyMDE) {
              easyMDE.value(data.content);
            } else {
              editor.value = data.content;
            }
          } else {
            renderContent(data.content, data.fileName);
          }
          document.title = `${existingTab.fileName}${existingTab.isModified ? ' *' : ''} - OpenMarkdownReader`;
        }
      }
      return;
    }
  }

  const activeTab = tabs.find(t => t.id === activeTabId);

  // If forcing new tab or opening in background, always create new tab
  if (forceNewTab || openInBackground) {
    const newTabId = createTabBackground(data.fileName, data.content, data.filePath, data.mtime);
    
    // Set edit mode if requested
    if (data.forceEdit) {
      const tab = tabs.find(t => t.id === newTabId);
      if (tab) {
        tab.isEditing = true;
        tab.originalContent = data.content;
      }
    }

    // Start watching if watch mode is on
    if (data.filePath && settings.watchFileMode) {
      window.electronAPI.watchFile(data.filePath, getWatcherOptions());
    }
    // If not background, switch to the new tab
    if (!openInBackground) {
      switchToTab(newTabId);
    }
  } else if (activeTab && activeTab.content === null && !activeTab.filePath && !activeTab.isModified) {
    // Only reuse tab if it's truly blank (no content, no file, not modified)
    // Stop watching old file if any
    if (activeTab.filePath && settings.watchFileMode) {
      window.electronAPI.unwatchFile(activeTab.filePath);
    }
    updateTab(activeTabId, data.fileName, data.content, data.filePath, data.mtime);
    
    if (data.forceEdit) {
      activeTab.isEditing = true;
      activeTab.originalContent = data.content;
      showEditor(data.content);
    } else {
      renderContent(data.content, data.fileName);
    }
    
    document.title = `${data.fileName} - OpenMarkdownReader`;
    // Start watching new file
    if (data.filePath && settings.watchFileMode) {
      window.electronAPI.watchFile(data.filePath, getWatcherOptions());
    }
  } else {
    const newTabId = createTab(data.fileName, data.content, data.filePath, true, data.mtime);
    if (data.forceEdit) {
      const tab = tabs.find(t => t.id === newTabId);
      if (tab) {
        tab.isEditing = true;
        tab.originalContent = data.content;
        showEditor(data.content);
      }
    }
    // Start watching if watch mode is on
    if (data.filePath && settings.watchFileMode) {
      window.electronAPI.watchFile(data.filePath, getWatcherOptions());
    }
  }
});

// Listen for new tab request from main process
window.electronAPI.onNewTab(() => {
  createTab();
});

// Listen for close tab request from menu
window.electronAPI.onCloseTab(() => {
  if (activeTabId !== null) {
    closeTab(activeTabId);
  }
});

// Listen for close tab by ID (from context menu)
window.electronAPI.onCloseTabById((tabId) => {
  closeTab(tabId);
});

// Listen for close other tabs (from context menu)
window.electronAPI.onCloseOtherTabs((keepTabId) => {
  const tabsToClose = tabs.filter(t => t.id !== keepTabId);
  tabsToClose.forEach(t => closeTab(t.id, true)); // silent close
});

// Listen for close tabs to the right (from context menu)
window.electronAPI.onCloseTabsToRight((tabId) => {
  const tabIndex = tabs.findIndex(t => t.id === tabId);
  if (tabIndex >= 0) {
    const tabsToClose = tabs.slice(tabIndex + 1);
    tabsToClose.forEach(t => closeTab(t.id, true)); // silent close
  }
});

window.electronAPI.onCreateFileInFolderRequest(async (folderPath) => {
  if (!folderPath) return;
  setSelectedSidebarFolder(folderPath);
  await createNewFileInDirectory(folderPath);
});

window.electronAPI.onRenameTabFileRequest((tabId) => {
  if (!tabId) return;
  startTabRename(tabId);
});

window.electronAPI.onRenameSidebarItemRequest((itemPath) => {
  if (!itemPath || !Array.isArray(directoryFiles)) return;
  const item = findItemByPath(directoryFiles, itemPath);
  if (!item) return;
  const el = Array.from(fileTree.querySelectorAll('.file-tree-item[data-path]'))
    .find(node => node.dataset.path === itemPath);
  if (!el) return;
  startSidebarRename(el, item);
});

// Listen for reopen closed tab (Cmd+Shift+T)
window.electronAPI.onReopenClosedTab(() => {
  if (closedTabs.length === 0) return;

  const closedTab = closedTabs.pop();
  if (closedTab.filePath) {
    // Reopen from file
    window.electronAPI.openFileByPath(closedTab.filePath);
  } else if (closedTab.content !== undefined) {
    // Reopen unsaved content
    const tabId = createTab(closedTab.fileName, closedTab.content, null);
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      tab.isModified = true;
      updateTabUI(tabId);
    }
  }
});

// Keyboard shortcuts modal
const shortcutsModal = document.getElementById('keyboard-shortcuts-modal');
const shortcutsBackdrop = shortcutsModal.querySelector('.shortcuts-backdrop');
const shortcutsClose = shortcutsModal.querySelector('.shortcuts-close');

function showKeyboardShortcuts() {
  shortcutsModal.classList.remove('hidden');
}

function hideKeyboardShortcuts() {
  shortcutsModal.classList.add('hidden');
}

shortcutsBackdrop.addEventListener('click', hideKeyboardShortcuts);
shortcutsClose.addEventListener('click', hideKeyboardShortcuts);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !shortcutsModal.classList.contains('hidden')) {
    hideKeyboardShortcuts();
  }
});

window.electronAPI.onShowKeyboardShortcuts(showKeyboardShortcuts);

// Report Issue modal
const reportIssueModal = document.getElementById('report-issue-modal');
const reportIssueBackdrop = reportIssueModal.querySelector('.report-issue-backdrop');
const reportIssueClose = reportIssueModal.querySelector('.report-issue-close');
const reportIssueTitle = document.getElementById('report-issue-title');
const reportIssueContent = document.getElementById('report-issue-content');
const reportIssueCancel = document.getElementById('report-issue-cancel');
const reportIssueSubmit = document.getElementById('report-issue-submit');
const reportIssueStatus = document.getElementById('report-issue-status');

// OpenMarkdownReader Issues list ID in Noos
const NOOS_ISSUE_LIST_ID = 'mEDpHWSRdT1DwfqfH2Iuv';
const NOOS_API_URL = 'https://globalbr.ai/api';

function showReportIssue() {
  reportIssueTitle.value = '';
  reportIssueContent.value = '';
  reportIssueStatus.className = 'report-issue-status';
  reportIssueStatus.textContent = '';
  reportIssueSubmit.disabled = false;
  reportIssueModal.classList.remove('hidden');
  reportIssueTitle.focus();
}

function hideReportIssue() {
  reportIssueModal.classList.add('hidden');
}

async function submitIssue() {
  const title = reportIssueTitle.value.trim();
  const content = reportIssueContent.value.trim();

  if (!title) {
    reportIssueStatus.className = 'report-issue-status error';
    reportIssueStatus.textContent = 'Please enter a title for your issue.';
    reportIssueTitle.focus();
    return;
  }

  reportIssueSubmit.disabled = true;
  reportIssueStatus.className = 'report-issue-status loading';
  reportIssueStatus.textContent = 'Submitting...';

  try {
    const response = await fetch(`${NOOS_API_URL}/nodes/anonymous-submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listId: NOOS_ISSUE_LIST_ID,
        title,
        content,
        type: 'issue',
        metadata: {
          app: 'OpenMarkdownReader',
          platform: navigator.platform,
          timestamp: new Date().toISOString()
        }
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const result = await response.json();
    reportIssueStatus.className = 'report-issue-status success';
    reportIssueStatus.textContent = 'Issue submitted successfully! Thank you for your feedback.';

    // Clear form and close after delay
    setTimeout(() => {
      hideReportIssue();
    }, 2000);

  } catch (err) {
    console.error('Submit issue error:', err);
    reportIssueStatus.className = 'report-issue-status error';
    reportIssueStatus.textContent = `Failed to submit: ${err.message}`;
    reportIssueSubmit.disabled = false;
  }
}

reportIssueBackdrop.addEventListener('click', hideReportIssue);
reportIssueClose.addEventListener('click', hideReportIssue);
reportIssueCancel.addEventListener('click', hideReportIssue);
reportIssueSubmit.addEventListener('click', submitIssue);

// Submit on Enter in title field (if content is empty) or Cmd+Enter anywhere
reportIssueTitle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !reportIssueContent.value.trim()) {
    e.preventDefault();
    submitIssue();
  }
});

reportIssueContent.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submitIssue();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !reportIssueModal.classList.contains('hidden')) {
    hideReportIssue();
  }
});

window.electronAPI.onShowReportIssue(showReportIssue);

// Custom width dialog
const customWidthDialog = document.getElementById('custom-width-dialog');
const customWidthInput = document.getElementById('custom-width-input');
const customWidthBackdrop = customWidthDialog.querySelector('.custom-width-backdrop');
const customWidthClose = customWidthDialog.querySelector('.custom-width-close');
const customWidthCancel = document.getElementById('custom-width-cancel');
const customWidthApply = document.getElementById('custom-width-apply');

function showCustomWidthDialog() {
  customWidthInput.value = typeof settings.contentWidth === 'number' ? settings.contentWidth : 900;
  customWidthDialog.classList.remove('hidden');
  customWidthInput.focus();
  customWidthInput.select();
}

function hideCustomWidthDialog() {
  customWidthDialog.classList.add('hidden');
}

async function applyCustomWidth() {
  const width = parseInt(customWidthInput.value, 10);
  if (width >= 300 && width <= 3000) {
    const success = await window.electronAPI.setCustomWidth(width);
    if (success) {
      hideCustomWidthDialog();
      showToast(`Content width set to ${width}px`, 'success', 2000);
    } else {
      showToast('Invalid width value', 'error');
    }
  } else {
    showToast('Width must be between 300 and 3000 pixels', 'error');
  }
}

customWidthBackdrop.addEventListener('click', hideCustomWidthDialog);
customWidthClose.addEventListener('click', hideCustomWidthDialog);
customWidthCancel.addEventListener('click', hideCustomWidthDialog);
customWidthApply.addEventListener('click', applyCustomWidth);
customWidthInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    applyCustomWidth();
  } else if (e.key === 'Escape') {
    hideCustomWidthDialog();
  }
});

window.electronAPI.onShowCustomWidthDialog(showCustomWidthDialog);

// Listen for refresh file (Cmd+R)
// Reveal active file's parent folder in Finder
window.electronAPI.onRevealActiveFileInFinder?.(() => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.filePath) {
    window.electronAPI.revealInFinder(tab.filePath);
  }
});

window.electronAPI.onRefreshFile(async () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab || !tab.filePath) return;

  // If there are unsaved changes, confirm first
  if (tab.isModified) {
    const result = await showSaveDialog(tab.fileName, 'Refresh will discard your changes.');
    if (result === 'cancel') return;
    if (result === 'save') {
      if (tab.isEditing) {
        tab.content = easyMDE ? easyMDE.value() : editor.value;
      }
      const saveResult = await writeTabToDisk(tab);
      if (!saveResult || !saveResult.success) {
        return;
      }
      tab.isModified = false;
      if (tab.isEditing) {
        tab.originalContent = tab.content;
      }
      updateTabUI(tab.id);
    }
  }

  // Reload the file from disk
  window.electronAPI.openFileByPath(tab.filePath, { reuseTab: activeTabId });
});

// Listen for new file request - creates tab and enters edit mode
window.electronAPI.onNewFile(() => {
  const tabId = createTab('Untitled.md', '', null);
  const tab = tabs.find(t => t.id === tabId);
  if (tab) {
    tab.isEditing = true;
    tab.originalContent = '';
    showEditor('');
    updateTabUI(tabId);
  }
});

// Listen for toggle edit mode
window.electronAPI.onToggleEdit(() => {
  toggleEditMode();
});

// Listen for revert request
window.electronAPI.onRevert(() => {
  revertChanges();
});

// Listen for save request
window.electronAPI.onSave(() => {
  saveFile();
});

// Listen for save-as request
window.electronAPI.onSaveAs(() => {
  saveFileAs();
});

// Listen for save all request (when closing window with unsaved changes)
window.electronAPI.onSaveAll(async () => {
  await saveAllFiles();
});

// Save all modified files
async function saveAllFiles() {
  for (const tab of tabs) {
    if (tab.isModified) {
      // Make sure to get latest content if editing
      if (tab.isEditing && tab.id === activeTabId) {
        tab.content = easyMDE ? easyMDE.value() : editor.value;
      }

      if (tab.filePath) {
        const result = await writeTabToDisk(tab);
        if (result && result.success) {
          tab.isModified = false;
          if (tab.isEditing) {
            tab.originalContent = tab.content;
          }
          updateTabUI(tab.id);
        }
      } else {
        // No file path, need Save As dialog
        const result = await window.electronAPI.saveFileAs(tab.content, tab.fileName);
        if (result) {
          tab.filePath = result.filePath;
          tab.fileName = result.fileName;
          tab.lastKnownMtime = result.mtime;
          tab.isModified = false;
          tab.externalChangePending = false;
          tab.originalContent = tab.content;
          updateTabDisplay(tab.id, tab.fileName, tab.filePath);
          updateTabUI(tab.id);
        }
      }
    }
  }
}

// Listen for read-only mode toggle
window.electronAPI.onSetReadOnly((isReadOnly) => {
  settings.readOnlyMode = isReadOnly;
  if (isReadOnly) {
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab && tab.isEditing) {
      tab.content = editor.value;
      tab.isEditing = false;
      hideEditor();
      renderContent(tab.content, tab.fileName);
      updateTabUI(activeTabId);
    }
  }
});

// Listen for terminal view toggle
window.electronAPI.onToggleTerminalView((enabled) => {
  settings.terminalView = enabled;
  applyTerminalView();
});

function applyTerminalView() {
  document.documentElement.classList.toggle('terminal-view', settings.terminalView);
}

function getWatcherOptions() {
  return currentDirectory ? { searchRoot: currentDirectory } : {};
}

function getPathBaseName(filePath) {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || filePath;
}

function reconcilePathInNavHistory(oldPath, newPath) {
  for (const entry of navHistory) {
    if (entry.filePath === oldPath) {
      entry.filePath = newPath;
    }
  }
}

function isPathInCurrentDirectory(filePath) {
  if (!filePath || !currentDirectory) return false;
  return filePath === currentDirectory || filePath.startsWith(`${currentDirectory}/`);
}

async function refreshSidebarForExternalMove() {
  if (!currentDirectory) return;
  try {
    directoryFiles = await window.electronAPI.getDirectoryContents(currentDirectory);
    sortDirectoryFiles(directoryFiles);
    renderFileTree();

    setAllFilesCache(await window.electronAPI.getAllFilesRecursive(currentDirectory));
    if (!commandPalette.classList.contains('hidden')) {
      updateCommandPaletteResults();
    }
  } catch (err) {
    console.error('Error refreshing sidebar after external file move:', err);
  }
}

// Listen for watch mode toggle
window.electronAPI.onSetWatchMode((watchMode) => {
  settings.watchFileMode = watchMode;
  
  // Toggle UI indicator
  const watchIndicator = document.getElementById('watch-indicator');
  if (watchIndicator) {
    watchIndicator.classList.toggle('hidden', !watchMode);
  }

  // Start/stop watching all open tabs with paths (not just the active tab)
  for (const tab of tabs) {
    if (!tab.filePath) continue;
    if (watchMode) {
      window.electronAPI.watchFile(tab.filePath, getWatcherOptions());
    } else {
      window.electronAPI.unwatchFile(tab.filePath);
    }
  }
});

window.electronAPI.onFilePathChanged(async ({ oldPath, newPath }) => {
  if (!oldPath || !newPath) return;

  let updatedTabCount = 0;
  const newFileName = getPathBaseName(newPath);
  for (const tab of tabs) {
    if (tab.filePath !== oldPath) continue;
    tab.filePath = newPath;
    tab.fileName = newFileName;
    updateTabDisplay(tab.id, newFileName, newPath);
    updateTabUI(tab.id);
    if (tab.id === activeTabId) {
      document.title = `${newFileName}${tab.isModified ? ' *' : ''} - OpenMarkdownReader`;
    }
    updatedTabCount++;
  }

  if (updatedTabCount === 0) return;

  reconcilePathInNavHistory(oldPath, newPath);
  if (settings.watchFileMode) {
    window.electronAPI.watchFile(newPath, getWatcherOptions());
  }

  if (isPathInCurrentDirectory(oldPath) || isPathInCurrentDirectory(newPath)) {
    await refreshSidebarForExternalMove();
  }
});

// Listen for file changes from watcher
window.electronAPI.onFileChanged(({ filePath, content, mtime }) => {
  // Find the tab with this file
  const tab = tabs.find(t => t.filePath === filePath);
  if (!tab) return;

  // If this was our own save, just update the mtime and return
  if (content === tab.content) {
    tab.lastKnownMtime = mtime;
    tab.externalChangePending = false;
    return;
  }

  // If we have unsaved changes, ask user before reloading
  if (tab.isModified) {
    // Only prompt if the incoming content is actually different from our current buffer
    if (content !== (tab.isEditing ? (easyMDE ? easyMDE.value() : editor.value) : tab.content)) {
      if (confirm(`File "${tab.fileName}" has been modified externally. Would you like to reload it? (Unsaved changes will be lost)`)) {
        tab.content = content;
        tab.lastKnownMtime = mtime;
        tab.isModified = false;
        tab.externalChangePending = false;
        if (tab.isEditing) {
          tab.originalContent = content;
          if (tab.id === activeTabId) {
            if (easyMDE) easyMDE.value(content);
            else editor.value = content;
          }
        } else if (tab.id === activeTabId) {
          renderContent(content, tab.fileName);
        }
        updateTabUI(tab.id);
      } else {
        // User said no: record the external change so auto-save won't overwrite it
        tab.lastKnownMtime = mtime;
        tab.externalChangePending = true;
      }
    }
    return;
  }

  // No unsaved changes, update content automatically
  tab.content = content;
  tab.lastKnownMtime = mtime;
  tab.externalChangePending = false;
  if (tab.isEditing) {
    tab.originalContent = content;
  }

  // If this is the active tab, re-render
  if (tab.id === activeTabId) {
    if (tab.isEditing) {
      if (easyMDE) {
        easyMDE.value(content);
      } else {
        editor.value = content;
      }
    } else {
      renderContent(content, tab.fileName);
    }
    document.title = `${tab.fileName}${tab.isModified ? ' *' : ''} - OpenMarkdownReader`;
  }
  updateTabUI(tab.id);
});

// Listen for toggle sidebar
window.electronAPI.onToggleSidebar(() => {
  sidebarToggle.click();
});

// Watch indicator click to toggle off
document.getElementById('watch-indicator').addEventListener('click', () => {
  window.electronAPI.toggleWatchMode();
});

// Auto-save indicator click to toggle off
document.getElementById('autosave-indicator').addEventListener('click', () => {
  window.electronAPI.toggleAutoSave();
});


// Listen for setting changes
window.electronAPI.onSettingChanged(({ setting, value }) => {
  if (setting === 'content-width') {
    settings.contentWidth = value;
    applyContentWidth();
  } else if (setting === 'content-padding') {
    settings.contentPadding = value;
    applyContentPadding();
  } else if (setting === 'editor-monospace') {
    settings.editorMonospace = !!value;
    applyEditorFont();
  } else if (setting === 'compact-tables') {
    settings.compactTables = !!value;
    document.body.classList.toggle('compact-tables', !!value);
  }
});

// Listen for show command palette from menu
window.electronAPI.onShowCommandPalette(() => {
  showCommandPalette();
});

// Listen for theme changes
window.electronAPI.onSetTheme((theme) => {
  // Set data attribute for CSS
  document.documentElement.setAttribute('data-theme', theme);

  // Handle highlight.js stylesheets
  const lightStyle = document.querySelector('link[href*="github.min.css"]');
  const darkStyle = document.querySelector('link[href*="github-dark.min.css"]');

  if (lightStyle && darkStyle) {
    if (theme === 'light') {
      lightStyle.media = 'all';
      darkStyle.media = 'not all';
    } else if (theme === 'dark') {
      lightStyle.media = 'not all';
      darkStyle.media = 'all';
    } else {
      // System
      lightStyle.media = '(prefers-color-scheme: light)';
      darkStyle.media = '(prefers-color-scheme: dark)';
    }
  }
});

// Listen for export PDF request
window.electronAPI.onExportPDF(async () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) {
    const defaultName = tab.fileName || 'document.md';
    await window.electronAPI.exportPDF(defaultName);
  }
});

function applyContentWidth() {
  const contentEl = document.getElementById('content');
  if (settings.contentWidth === 'full') {
    contentEl.style.maxWidth = 'none';
  } else {
    contentEl.style.maxWidth = `${settings.contentWidth}px`;
  }
}

function applyContentPadding() {
  const base = typeof settings.contentPadding === 'number'
    ? settings.contentPadding
    : 20;
  document.documentElement.style.setProperty('--content-padding-base', `${base}px`);
}

function applyEditorFont() {
  document.documentElement.classList.toggle('editor-font-mono', !!settings.editorMonospace);
  if (easyMDE) {
    easyMDE.codemirror.refresh();
  }
}

// Table of Contents functions
function extractHeadings() {
  if (!markdownBody) return [];

  const headings = [];
  markdownBody.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el) => {
    const level = Number(el.tagName.slice(1));
    const text = (el.dataset.headingText || el.textContent || '').trim();
    const id = el.id;
    if (!id || !text || Number.isNaN(level)) return;
    headings.push({ level, text, id });
  });

  return headings;
}

function renderTOC(headings) {
  if (!headings || headings.length === 0) {
    tocContent.innerHTML = '<div class="toc-empty">No headings found</div>';
    return;
  }

  tocContent.innerHTML = headings.map(h => `
    <a class="toc-item" data-level="${h.level}" data-id="${escapeHtml(h.id)}">
      ${escapeHtml(h.text)}
    </a>
  `).join('');

  // Add click handlers
  tocContent.querySelectorAll('.toc-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      const target = document.getElementById(id);
      if (target) {
        expandSectionAncestors(target);
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Highlight briefly
        target.style.background = 'var(--code-bg)';
        setTimeout(() => target.style.background = '', 1500);
      }
    });
  });
}

function toggleTOC() {
  settings.tocVisible = !settings.tocVisible;
  tocPanel.classList.toggle('hidden', !settings.tocVisible);
  tocToggleBtn.classList.toggle('active', settings.tocVisible);
}

// CSV parsing and rendering
function parseCSV(content, delimiter = ',') {
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        // Escaped quote
        currentCell += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        currentRow.push(currentCell.trim());
        if (currentRow.length > 0 && currentRow.some(c => c !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
        if (char === '\r') i++; // Skip \n in \r\n
      } else if (char !== '\r') {
        currentCell += char;
      }
    }
  }

  // Don't forget the last cell/row
  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some(c => c !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function renderCSVTable(content, filename) {
  const delimiter = filename.toLowerCase().endsWith('.tsv') ? '\t' : ',';
  const rows = parseCSV(content, delimiter);

  if (rows.length === 0) {
    csvTableContainer.innerHTML = '<div class="toc-empty">No data found</div>';
    return;
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);

  let html = '<table class="csv-table"><thead><tr>';
  headers.forEach(h => {
    html += `<th>${escapeHtml(h)}</th>`;
  });
  html += '</tr></thead><tbody>';

  dataRows.forEach(row => {
    html += '<tr>';
    // Ensure we have enough cells even if row is short
    for (let i = 0; i < headers.length; i++) {
      html += `<td>${escapeHtml(row[i] || '')}</td>`;
    }
    html += '</tr>';
  });

  html += '</tbody></table>';
  csvTableContainer.innerHTML = html;
}

function showCSVView(content, filename) {
  markdownBody.classList.add('hidden');
  csvView.classList.remove('hidden');
  renderCSVTable(content, filename);
}

function hideCSVView() {
  csvView.classList.add('hidden');
  markdownBody.classList.remove('hidden');
}

// Configure marked to generate heading IDs
const markedRenderer = new marked.Renderer();
let fallbackHeadingSlugCounts = new Map();
const wikiLinkMarkedExtension = {
  name: 'wikilink',
  level: 'inline',
  start(src) {
    const index = src.indexOf('[[');
    return index >= 0 ? index : undefined;
  },
  tokenizer(src) {
    const match = /^\[\[([^\]]+)\]\]/.exec(src);
    if (!match) return false;

    const parsed = parseWikiLinkMarkup(match[1]);
    if (!parsed.targetPart && !parsed.headingPart) return false;

    const resolved = resolveWikiLinkTarget(parsed.targetPart);
    if (resolved && resolved.type === 'unresolved') {
      return false;
    }

    return {
      type: 'wikilink',
      raw: match[0],
      pageName: parsed.targetPart || parsed.raw,
      href: resolved && resolved.type !== 'missing' ? resolved.href : '',
      headingSlug: resolved && resolved.headingSlug ? resolved.headingSlug : '',
      tokens: this.lexer.inlineTokens(parsed.display || parsed.targetPart || parsed.raw)
    };
  },
  renderer(token) {
    return renderWikiLinkToken(token, this.parser);
  }
};

function slugifyHeadingText(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueSlug(base) {
  const safeBase = base || 'section';
  const count = fallbackHeadingSlugCounts.get(safeBase) || 0;
  fallbackHeadingSlugCounts.set(safeBase, count + 1);
  return count === 0 ? safeBase : `${safeBase}-${count}`;
}

function htmlToPlainText(html) {
  const temp = document.createElement('div');
  temp.innerHTML = html;
  return (temp.textContent || '').trim();
}

function parseHeadingAttributes(raw) {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/\s*\{([^}]+)\}\s*$/);
  if (!match) return null;

  const attributeSource = match[1].trim();
  if (!attributeSource) return null;

  const tokens = attributeSource.split(/\s+/);
  const attrs = { id: null, classes: [], extra: {} };
  let used = false;

  tokens.forEach((token) => {
    if (/^#[A-Za-z][\w-]*$/.test(token)) {
      attrs.id = token.slice(1);
      used = true;
      return;
    }
    if (/^\.[A-Za-z][\w-]*$/.test(token)) {
      attrs.classes.push(token.slice(1));
      used = true;
      return;
    }

    const eqIndex = token.indexOf('=');
    if (eqIndex > 0) {
      const key = token.slice(0, eqIndex);
      let value = token.slice(eqIndex + 1);
      if (!/^[A-Za-z][\w-]*$/.test(key)) return;
      value = value.replace(/^['"]|['"]$/g, '');
      if (!value) return;
      attrs.extra[key] = value;
      used = true;
    }
  });

  if (!used) return null;

  return {
    attrs,
    rawWithoutAttributes: raw.slice(0, match.index).trimEnd(),
    attributeBlock: match[0]
  };
}

markedRenderer.heading = function(text, level, raw, slugger) {
  // Handle both old and new marked API
  const headingHtml = typeof text === 'object' ? text.text : text;
  const headingLevel = typeof text === 'object' ? text.depth : level;

  const rawText = typeof raw === 'string' ? raw.trim() : '';
  const attributeInfo = parseHeadingAttributes(rawText);

  let cleanedHtml = headingHtml;
  let plainText = rawText || htmlToPlainText(headingHtml);

  if (attributeInfo) {
    if (attributeInfo.rawWithoutAttributes) {
      plainText = attributeInfo.rawWithoutAttributes;
    }
    if (typeof cleanedHtml === 'string' && attributeInfo.attributeBlock && cleanedHtml.endsWith(attributeInfo.attributeBlock)) {
      cleanedHtml = cleanedHtml.slice(0, -attributeInfo.attributeBlock.length).trimEnd();
    }
    if (!plainText) {
      plainText = htmlToPlainText(cleanedHtml);
    }
  }

  let id = '';
  if (attributeInfo && attributeInfo.attrs.id) {
    id = attributeInfo.attrs.id;
  } else if (slugger && typeof slugger.slug === 'function') {
    id = slugger.slug(plainText);
  } else {
    id = uniqueSlug(slugifyHeadingText(plainText));
  }

  const safeHeadingText = escapeHtml(plainText);
  const classes = ['md-heading'];
  if (attributeInfo && attributeInfo.attrs.classes.length > 0) {
    classes.push(...attributeInfo.attrs.classes);
  }

  const attrs = [
    `id="${escapeHtml(id)}"`,
    `class="${classes.join(' ')}"`,
    `data-heading-text="${safeHeadingText}"`
  ];

  if (attributeInfo) {
    Object.entries(attributeInfo.attrs.extra).forEach(([key, value]) => {
      attrs.push(`${key}="${escapeHtml(String(value))}"`);
    });
  }

  const collapseToggle = `<button class="collapse-toggle" type="button" aria-label="Collapse section ${safeHeadingText}" aria-expanded="true"></button>`;
  const anchorLink = `<a class="heading-anchor" href="#${escapeHtml(id)}" aria-label="Link to ${safeHeadingText}"></a>`;

  return `<h${headingLevel} ${attrs.join(' ')}>${collapseToggle}${cleanedHtml}${anchorLink}</h${headingLevel}>`;
};

marked.use({
  extensions: [wikiLinkMarkedExtension]
});

marked.setOptions({
  renderer: markedRenderer,
  gfm: true,
  breaks: true
});

function buildCollapsibleSections() {
  if (!markdownBody) return;

  const nodes = Array.from(markdownBody.childNodes);
  const fragment = document.createDocumentFragment();
  const stack = [];

  const isHeading = (node) =>
    node.nodeType === Node.ELEMENT_NODE && /^H[1-6]$/.test(node.tagName);

  nodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
      return;
    }

    if (isHeading(node)) {
      const level = Number(node.tagName.slice(1));

      while (stack.length && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      const section = document.createElement('section');
      section.className = 'md-section';
      section.dataset.level = String(level);

      const body = document.createElement('div');
      body.className = 'md-section-body';

      section.appendChild(node);
      section.appendChild(body);

      if (stack.length) {
        stack[stack.length - 1].body.appendChild(section);
      } else {
        fragment.appendChild(section);
      }

      stack.push({ level, body, section });
      return;
    }

    if (stack.length) {
      stack[stack.length - 1].body.appendChild(node);
    } else {
      fragment.appendChild(node);
    }
  });

  markdownBody.innerHTML = '';
  markdownBody.appendChild(fragment);

  let sectionIndex = 0;
  markdownBody.querySelectorAll('.md-section').forEach((section) => {
    const body = section.querySelector(':scope > .md-section-body');
    const heading = section.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6');
    const toggle = heading ? heading.querySelector('.collapse-toggle') : null;

    if (body && !body.id) {
      sectionIndex += 1;
      body.id = `md-section-body-${sectionIndex}`;
    }

    if (toggle && body && body.id) {
      toggle.setAttribute('aria-controls', body.id);
      toggle.setAttribute('aria-expanded', section.classList.contains('collapsed') ? 'false' : 'true');
    }

    if (body && !body.textContent.trim()) {
      section.classList.add('md-section-empty');
    }
  });
}

function wrapTablesForScroll() {
  if (!markdownBody) return;
  markdownBody.querySelectorAll('table').forEach((table) => {
    const parent = table.parentElement;
    if (parent && parent.classList.contains('table-wrap')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrap';
    parent.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
}

function expandSectionAncestors(target) {
  if (!target) return;
  let section = target.closest('.md-section');
  while (section) {
    if (section.classList.contains('collapsed')) {
      section.classList.remove('collapsed');
      const heading = section.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6');
      const toggle = heading ? heading.querySelector('.collapse-toggle') : null;
      if (toggle) {
        toggle.setAttribute('aria-expanded', 'true');
      }
    }
    section = section.parentElement ? section.parentElement.closest('.md-section') : null;
  }
}

function renderMarkdown(mdContent) {
  try {
    // Hide CSV view if it was showing
    hideCSVView();
    // Clear chat view if it was showing
    document.documentElement.classList.remove('chat-view');
    fallbackHeadingSlugCounts = new Map();

    const html = marked.parse(mdContent);
    markdownBody.innerHTML = html;

    buildCollapsibleSections();
    wrapTablesForScroll();

    document.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block);
    });

    applyLinkTooltips();

    dropZone.classList.add('hidden');
    content.classList.remove('hidden');
    markdownBody.classList.remove('hidden');

    // Update Table of Contents
    const headings = extractHeadings();
    renderTOC(headings);

    window.scrollTo(0, 0);
  } catch (err) {
    console.error('Error rendering markdown:', err);
    markdownBody.innerHTML = '<p style="color:red">Error rendering markdown: ' + escapeHtml(err.message) + '</p><pre>' + escapeHtml(mdContent) + '</pre>';
    dropZone.classList.add('hidden');
    content.classList.remove('hidden');
  }
}

function applyLinkTooltips() {
  if (!markdownBody) return;
  const modifier = isMac ? '⌘-click' : 'Ctrl+click';

  markdownBody.querySelectorAll('a[href]').forEach((a) => {
    if (a.classList.contains('heading-anchor')) return;
    const href = a.getAttribute('href');
    if (!href) return;

    let hint = '';
    if (href.startsWith('http://') || href.startsWith('https://')) {
      hint = 'Click to open link in browser';
    } else if (href.startsWith('#')) {
      hint = 'Click to jump to section';
    } else {
      hint = `Click to open file. ${modifier} to open in new tab`;
    }

    const existingTitle = a.getAttribute('title');
    const title = existingTitle ? `${existingTitle}\n${hint}` : hint;
    a.setAttribute('title', title);
  });
}

// JSONL Chat Parser for Claude Code sessions
function isJsonlFile(filename) {
  return path.extname(filename).toLowerCase() === '.jsonl';
}

function parseClaudeCodeSession(content) {
  const messages = [];
  const lines = content.trim().split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);

      // Skip summary entries
      if (obj.type === 'summary') continue;

      if (obj.type === 'user' && obj.message) {
        messages.push({
          role: 'human',
          content: typeof obj.message.content === 'string' ? obj.message.content : '',
          timestamp: obj.timestamp
        });
      } else if (obj.type === 'assistant' && obj.message && obj.message.content) {
        const contentBlocks = obj.message.content;
        let textContent = '';
        let thinking = '';
        const toolCalls = [];

        if (Array.isArray(contentBlocks)) {
          for (const block of contentBlocks) {
            if (block.type === 'text') {
              textContent += block.text || '';
            } else if (block.type === 'thinking') {
              thinking = block.thinking || '';
            } else if (block.type === 'tool_use') {
              toolCalls.push({
                name: block.name,
                input: block.input
              });
            }
          }
        }

        if (textContent || thinking || toolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: textContent,
            thinking: thinking,
            toolCalls: toolCalls,
            timestamp: obj.timestamp
          });
        }
      } else if (obj.type === 'tool_result') {
        // Tool results - could add these as separate messages if needed
      }
    } catch (e) {
      // Skip invalid JSON lines
    }
  }

  return messages;
}

function renderChatView(messages) {
  let html = '';

  for (const msg of messages) {
    const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '';
    const roleLabel = msg.role === 'human' ? 'Human' : 'Assistant';

    html += `<div class="chat-message ${msg.role}">`;
    html += `<div class="chat-message-header">`;
    html += `<span class="chat-message-role">${roleLabel}</span>`;
    if (timestamp) {
      html += `<span class="chat-message-timestamp">${timestamp}</span>`;
    }
    html += `</div>`;

    // Thinking block (collapsed by default)
    if (msg.thinking) {
      const thinkingPreview = msg.thinking.slice(0, 100).replace(/\n/g, ' ') + '...';
      html += `<div class="chat-thinking" onclick="this.classList.toggle('expanded')">`;
      html += `<div class="chat-thinking-header">`;
      html += `<span class="chat-tool-toggle">▶</span>`;
      html += `<span>Thinking</span>`;
      html += `<span class="chat-thinking-preview">${escapeHtml(thinkingPreview)}</span>`;
      html += `</div>`;
      html += `<div class="chat-thinking-content">${escapeHtml(msg.thinking)}</div>`;
      html += `</div>`;
    }

    // Tool calls (collapsed by default)
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tool of msg.toolCalls) {
        const inputStr = typeof tool.input === 'object' ? JSON.stringify(tool.input, null, 2) : String(tool.input);
        const inputPreview = inputStr.slice(0, 80).replace(/\n/g, ' ');
        html += `<div class="chat-tool-call" onclick="this.classList.toggle('expanded')">`;
        html += `<div class="chat-tool-header">`;
        html += `<span class="chat-tool-toggle">▶</span>`;
        html += `<span class="chat-tool-name">${escapeHtml(tool.name)}</span>`;
        html += `<span class="chat-tool-preview">${escapeHtml(inputPreview)}${inputStr.length > 80 ? '...' : ''}</span>`;
        html += `</div>`;
        html += `<div class="chat-tool-content">${escapeHtml(inputStr)}</div>`;
        html += `</div>`;
      }
    }

    // Main content
    if (msg.content) {
      // Simple markdown-like rendering for code blocks
      let content = escapeHtml(msg.content);
      // Protect fenced blocks first so inline/newline formatting can't mutate their contents.
      const codeBlockPlaceholders = [];
      content = content.replace(/```([^\r\n`]*)\r?\n([\s\S]*?)```/g, (_match, rawLanguage, code) => {
        const language = String(rawLanguage || '').trim().replace(/[^\w-]/g, '');
        const renderedBlock = language
          ? `<pre><code class="language-${language}">${code}</code></pre>`
          : `<pre><code>${code}</code></pre>`;
        const placeholder = `@@CHAT_CODE_BLOCK_${codeBlockPlaceholders.length}@@`;
        codeBlockPlaceholders.push(renderedBlock);
        return placeholder;
      });

      // Convert inline code outside fenced blocks.
      content = content.replace(/`([^`\n]+)`/g, '<code>$1</code>');
      // Convert remaining newlines to <br>.
      content = content.replace(/\n/g, '<br>');
      // Restore fenced blocks after inline/newline transforms.
      content = content.replace(/@@CHAT_CODE_BLOCK_(\d+)@@/g, (_match, indexStr) => {
        const index = Number(indexStr);
        return Number.isInteger(index) ? (codeBlockPlaceholders[index] || '') : '';
      });
      html += `<div class="chat-message-content">${content}</div>`;
    }

    html += `</div>`;
  }

  return html;
}

function detectChatPatterns(content) {
  // Check for common chat patterns in plain text
  const patterns = [
    /^Human:/m,
    /^Assistant:/m,
    /^User:/m,
    /^AI:/m,
    /^> Human:/m,
    /^> Assistant:/m
  ];

  let matchCount = 0;
  for (const pattern of patterns) {
    if (pattern.test(content)) matchCount++;
  }

  return matchCount >= 2; // Need at least 2 different patterns
}

function parseTextChat(content) {
  const messages = [];
  const lines = content.split('\n');
  let currentMessage = null;

  for (const line of lines) {
    // Check for role markers
    const humanMatch = line.match(/^(Human|User|>?\s*Human|>?\s*User):\s*(.*)/i);
    const assistantMatch = line.match(/^(Assistant|AI|Claude|>?\s*Assistant|>?\s*AI|>?\s*Claude):\s*(.*)/i);

    if (humanMatch) {
      if (currentMessage) messages.push(currentMessage);
      currentMessage = { role: 'human', content: humanMatch[2] };
    } else if (assistantMatch) {
      if (currentMessage) messages.push(currentMessage);
      currentMessage = { role: 'assistant', content: assistantMatch[2] };
    } else if (currentMessage) {
      currentMessage.content += '\n' + line;
    }
  }

  if (currentMessage) messages.push(currentMessage);
  return messages;
}

// Render content based on file type
function renderContent(content, filename) {
  const tab = tabs.find(t => t.id === activeTabId);
  updateDocumentWordCount(tab);

  // Check if it's a CSV/TSV file and should show as table
  if (isCsvFile(filename) && settings.csvViewAsTable) {
    dropZone.classList.add('hidden');
    document.getElementById('content').classList.remove('hidden');
    showCSVView(content, filename);
    // Clear TOC for CSV
    tocContent.innerHTML = '<div class="toc-empty">CSV files have no headings</div>';
    return;
  }

  // Check if it's a JSONL file (Claude Code session) - render as chat
  if (isJsonlFile(filename)) {
    const messages = parseClaudeCodeSession(content);
    if (messages.length > 0) {
      hideCSVView();
      document.documentElement.classList.add('terminal-view', 'chat-view');
      markdownBody.innerHTML = renderChatView(messages);
      dropZone.classList.add('hidden');
      document.getElementById('content').classList.remove('hidden');
      markdownBody.classList.remove('hidden');
      tocContent.innerHTML = `<div class="toc-empty">${messages.length} messages</div>`;
      window.scrollTo(0, 0);
      return;
    }
    // Fall through to render as code if parsing fails
  }

  // Check if it's a markdown file - render as markdown
  if (isMarkdownFile(filename)) {
    renderMarkdown(content);
    return;
  }

  // For other text files, show as syntax-highlighted code block
  hideCSVView();
  document.documentElement.classList.remove('chat-view');
  const ext = path.extname(filename).slice(1) || 'plaintext';
  const escapedContent = escapeHtml(content);
  markdownBody.innerHTML = `<pre><code class="language-${ext}">${escapedContent}</code></pre>`;

  // Highlight if possible
  document.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block);
  });

  dropZone.classList.add('hidden');
  document.getElementById('content').classList.remove('hidden');
  markdownBody.classList.remove('hidden');

  // Clear TOC for code files
  tocContent.innerHTML = '<div class="toc-empty">No headings in code files</div>';

  window.scrollTo(0, 0);
}

// Drag and drop handling
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
});

function handleFileDrop(files) {
  Array.from(files).forEach((file, index) => {
    // Accept markdown files and other text files
    if (isMarkdownFile(file.name) || isTextFile(file.name)) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const activeTab = tabs.find(t => t.id === activeTabId);

        if (index === 0 && activeTab && !activeTab.content) {
          updateTab(activeTabId, file.name, event.target.result, null);
          renderContent(event.target.result, file.name);
          document.title = `${file.name} - OpenMarkdownReader`;
        } else {
          createTab(file.name, event.target.result, null);
        }
      };
      reader.readAsText(file);
    }
  });
}

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  handleFileDrop(e.dataTransfer.files);
});

function isMarkdownFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ['.md', '.markdown', '.mdown', '.mkd'].includes(ext);
}

function isTextFile(filename) {
  const lowerName = filename.toLowerCase();
  const ext = '.' + lowerName.split('.').pop();
  // Check explicit extensions
  if (textFileExtensions.includes(ext)) return true;
  // Check special filenames without extensions
  if (textFileExtensions.includes(lowerName)) return true;
  // Also check common dotfiles
  if (lowerName.startsWith('.') && !lowerName.includes('.', 1)) return true;
  return false;
}

// Alternative check for file tree display
function isTextFileByName(filename) {
  const lowerName = filename.toLowerCase();
  const ext = '.' + lowerName.split('.').pop();
  // Check explicit extensions
  if (textFileExtensions.includes(ext)) return true;
  // Check special filenames
  const specialNames = ['makefile', 'dockerfile', 'vagrantfile', 'gemfile', 'rakefile'];
  if (specialNames.includes(lowerName)) return true;
  return false;
}

function isCsvFile(filename) {
  const ext = '.' + filename.toLowerCase().split('.').pop();
  return ext === '.csv' || ext === '.tsv';
}

// Simple path helper since we're in renderer
const path = {
  extname: (filename) => {
    const lastDot = filename.lastIndexOf('.');
    return lastDot > 0 ? filename.slice(lastDot).toLowerCase() : '';
  }
};

document.querySelector('.content-area').addEventListener('dragover', (e) => {
  e.preventDefault();
});

document.querySelector('.content-area').addEventListener('drop', (e) => {
  e.preventDefault();
  handleFileDrop(e.dataTransfer.files);
});

// Switch to next/previous tab
function switchToNextTab() {
  if (tabs.length <= 1) return;
  const currentIndex = tabs.findIndex(t => t.id === activeTabId);
  const nextIndex = (currentIndex + 1) % tabs.length;
  switchToTab(tabs[nextIndex].id);
}

function switchToPrevTab() {
  if (tabs.length <= 1) return;
  const currentIndex = tabs.findIndex(t => t.id === activeTabId);
  const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  switchToTab(tabs[prevIndex].id);
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Cmd+W to close tab (without Shift - Cmd+Shift+W closes the window via menu)
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'w' || e.key === 'W')) {
    e.preventDefault();
    if (activeTabId !== null) {
      closeTab(activeTabId);
    }
  }

  // Ctrl+Tab / Ctrl+Shift+Tab to switch tabs
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) {
      switchToPrevTab();
    } else {
      switchToNextTab();
    }
  }

  // Cmd+Shift+[ and Cmd+Shift+] to switch tabs (Mac style)
  if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
    if (e.key === '[' || e.code === 'BracketLeft') {
      e.preventDefault();
      switchToPrevTab();
    } else if (e.key === ']' || e.code === 'BracketRight') {
      e.preventDefault();
      switchToNextTab();
    }
  }

  // Cmd+S to save, Cmd+Shift+S to save as
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (e.shiftKey) {
      saveFileAs();
    } else {
      saveFile();
    }
  }

  // Cmd+E to toggle edit
  if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
    e.preventDefault();
    toggleEditMode();
  }

  // Cmd+B to toggle sidebar
  if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
    e.preventDefault();
    sidebarToggle.click();
  }

  // Escape handling: close overlays first, then leave edit mode if the editor has focus
  if (e.key === 'Escape') {
    if (!commandPalette.classList.contains('hidden')) {
      e.preventDefault();
      hideCommandPalette();
      return;
    }

    const findBarEl = document.getElementById('find-bar');
    if (findBarEl && !findBarEl.classList.contains('hidden')) {
      e.preventDefault();
      hideFindBar();
      return;
    }

    const tab = tabs.find(t => t.id === activeTabId);
    if (tab && tab.isEditing && editorContainer.contains(e.target)) {
      e.preventDefault();
      exitEditMode();
    }
  }

  // Cmd+P to open command palette
  if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
    e.preventDefault();
    showCommandPalette();
  }
});

// Double-click on titlebar to maximize/restore
document.getElementById('titlebar').addEventListener('dblclick', (e) => {
  // Only trigger on draggable areas (not on buttons or tabs)
  if (e.target.closest('.tab') || e.target.closest('button')) return;
  window.electronAPI.toggleMaximize();
});

// Command Palette / File Search
let commandPaletteSelectedIndex = 0;
let commandPaletteFiles = []; // This will hold the currently displayed (filtered) files

const builtInCommands = [
  {
    name: 'Daily Note: New Scratch Note',
    description: 'Create a new scratch note for today',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
    action: () => window.electronAPI.createDailyNote('scratch', true)
  },
  {
    name: 'Daily Note: Open Today\'s Scratch Note',
    description: 'Open the main scratch note for today',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>',
    action: () => window.electronAPI.createDailyNote('scratch', false)
  },
  {
    name: 'Daily Note: New Reference Note',
    description: 'Create a new reference note for today',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>',
    action: () => window.electronAPI.createDailyNote('ref', true)
  },
  {
    name: 'Daily Note: Open Today\'s Reference Note',
    description: 'Open the main reference note for today',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>',
    action: () => window.electronAPI.createDailyNote('ref', false)
  },
      {
        name: 'Daily Note: Browse Folder in App',
        description: 'Open the daily notes folder in the sidebar',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>',
        action: () => window.electronAPI.browseDailyNotesFolder()
      },
      {
        name: 'Daily Note: Open Folder in Finder',
        description: 'Open the daily notes folder in Finder',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>',
        action: () => window.electronAPI.openDailyNotesFolder()
      },
      {
        name: 'Daily Note: Set Folder...',
    description: 'Choose where daily notes are saved',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
    action: () => window.electronAPI.getDailyNotesFolder()
  },
  {
    name: 'Reveal in Finder',
    description: 'Show the active file in its parent folder (⇧⌘R)',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
    action: () => {
      const tab = tabs.find(t => t.id === activeTabId);
      if (tab && tab.filePath) {
        window.electronAPI.revealInFinder(tab.filePath);
      }
    }
  },
  {
    name: 'Open Containing Folder',
    description: 'Open the parent folder of the active file',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="9" y1="13" x2="15" y2="13"></line></svg>',
    action: () => {
      const tab = tabs.find(t => t.id === activeTabId);
      if (tab && tab.filePath) {
        const dir = tab.filePath.substring(0, tab.filePath.lastIndexOf('/'));
        if (dir) window.electronAPI.openInFinder(dir);
      }
    }
  },
  {
    name: 'Sidebar: New File in Selected Folder',
    description: 'Create a markdown file in the selected sidebar folder',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>',
    action: async () => {
      const targetDirectory = getSelectedFolderTargetDirectory();
      if (!targetDirectory) {
        showToast('Open a folder first', 'warning', 2500);
        return;
      }
      await createNewFileInDirectory(targetDirectory);
    }
  }
];

async function showCommandPalette() {
  commandPalette.classList.remove('hidden');
  commandPaletteInput.value = '';
  commandPaletteInput.focus();
  commandPaletteSelectedIndex = 0;

  // Load all files if we have a directory
  if (currentDirectory && !allFilesCache) {
    commandPaletteResults.innerHTML = '<div class="command-palette-empty">Loading files...</div>';
    if (!allFilesCachePromise) {
      allFilesCachePromise = window.electronAPI.getAllFilesRecursive(currentDirectory)
        .then(files => {
          setAllFilesCache(files);
          return files;
        })
        .catch(err => {
          console.error('Error loading files for command palette:', err);
          allFilesCache = [];
          return [];
        })
        .finally(() => {
          allFilesCachePromise = null;
        });
    }
    await allFilesCachePromise;
  }

  updateCommandPaletteResults();
}

function hideCommandPalette() {
  commandPalette.classList.add('hidden');
  commandPaletteInput.value = '';
}

function getAllFilesFlat(items, basePath = '') {
  let files = [];
  for (const item of items) {
    if (item.type === 'file') {
      files.push({
        name: item.name,
        path: item.path,
        isMarkdown: item.isMarkdown
      });
    } else if (item.type === 'folder' && item.children) {
      files = files.concat(getAllFilesFlat(item.children, item.path));
    }
  }
  return files;
}

function updateCommandPaletteResults() {
  const query = commandPaletteInput.value.toLowerCase().trim();
  const isCommandQuery = query.startsWith('>');
  const searchText = isCommandQuery ? query.substring(1).trim() : query;
  
  // URL detection
  const isUrl = /^https?:\/\//i.test(commandPaletteInput.value.trim());
  
  // File path detection (absolute path or home-relative)
  const inputVal = commandPaletteInput.value.trim();
  const isPath = inputVal.startsWith('/') || inputVal.startsWith('~/') || (inputVal.match(/^[a-zA-Z]:\\/) !== null); // Basic check

  // Build list of searchable items: folder files + open tabs + commands
  let allItems = [];

  // 0. Add URL/File option if detected
  if (isUrl) {
    allItems.push({
      name: `Open URL: ${inputVal}`,
      path: inputVal,
      type: 'url',
      isCommand: true,
      icon: '🌐',
      action: () => window.electronAPI.openExternal(inputVal)
    });
  } else if (isPath) {
    allItems.push({
      name: `Open File: ${inputVal}`,
      path: inputVal,
      type: 'file-path',
      isCommand: true,
      icon: '📄',
      action: () => window.electronAPI.openFileByPath(inputVal)
    });
  }

  // 1. Add built-in commands
  builtInCommands.forEach(cmd => {
    if (!searchText || cmd.name.toLowerCase().includes(searchText) || (cmd.description && cmd.description.toLowerCase().includes(searchText))) {
      allItems.push({
        ...cmd,
        type: 'command',
        isCommand: true
      });
    }
  });

  // 2. Add files from folder if available (unless specifically searching for commands with >)
  if (!isCommandQuery || searchText) {
    if (allFilesCache) {
      allItems = allItems.concat(allFilesCache.map(f => ({ ...f })));
    } else if (directoryFiles.length > 0) {
      allItems = allItems.concat(getAllFilesFlat(directoryFiles));
    }
  }

  // 3. Add open tabs that have content (even without a folder open)
  // We mark them as isOpenTab to prioritize them
  if (!isCommandQuery || searchText) {
    tabs.forEach(tab => {
      if (tab.content !== null) {
        // Check if this file is already in the list
        const existingItem = tab.filePath ? allItems.find(f => f.path === tab.filePath) : null;
        
        if (existingItem) {
          existingItem.isOpenTab = true;
          existingItem.tabId = tab.id;
        } else {
          // Not in file list (or no file path), add it
          allItems.push({
            name: tab.fileName,
            path: tab.filePath || 'Untitled',
            isMarkdown: true,
            isOpenTab: true,
            tabId: tab.id
          });
        }
      }
    });
  }

  // Filter based on query if not already filtered
  let filteredItems = allItems;
  if (searchText && !isCommandQuery) {
    filteredItems = allItems.filter(item => {
      if (item.type === 'url' || item.type === 'file-path') return true; // Keep URL/Path item always
      if (item.isCommand) return item.name.toLowerCase().includes(searchText);
      return item.name.toLowerCase().includes(searchText) || (item.path && item.path.toLowerCase().includes(searchText));
    });
  } else if (isCommandQuery) {
    filteredItems = allItems.filter(item => item.isCommand);
  }

  // Sort: URLs/Paths first, then Commands if query starts with >, otherwise open tabs first
  filteredItems.sort((a, b) => {
    // 0. URL/Path priority
    const aPriority = a.type === 'url' || a.type === 'file-path';
    const bPriority = b.type === 'url' || b.type === 'file-path';
    if (aPriority && !bPriority) return -1;
    if (!aPriority && bPriority) return 1;

    if (isCommandQuery) {
      if (a.isCommand && !b.isCommand) return -1;
      if (!a.isCommand && b.isCommand) return 1;
    } else {
      // 1. Open tabs first
      if (a.isOpenTab && !b.isOpenTab) return -1;
      if (!a.isOpenTab && b.isOpenTab) return 1;
      
      // 2. Commands next
      if (a.isCommand && !b.isCommand) return -1;
      if (!a.isCommand && b.isCommand) return 1;
    }

    // 3. Exact name matches
    const aExact = (a.name || '').toLowerCase() === searchText;
    const bExact = (b.name || '').toLowerCase() === searchText;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    // 4. Case-insensitive sort
    return (a.name || '').localeCompare(b.name || '');
  });

  commandPaletteFiles = filteredItems;

  if (commandPaletteSelectedIndex >= filteredItems.length) {
    commandPaletteSelectedIndex = Math.max(0, filteredItems.length - 1);
  }

  if (filteredItems.length === 0) {
    if (commandPaletteMode === 'files') {
      if (currentDirectory) {
        commandPaletteResults.innerHTML = '<div class="command-palette-empty">No matching files or commands</div>';
      } else {
        commandPaletteResults.innerHTML = '<div class="command-palette-empty">No files open yet<br><span style="font-size: 12px; opacity: 0.7;">Open a file or folder with ⌘O or type > for commands</span></div>';
      }
    }
    return;
  }

  const displayItems = filteredItems.slice(0, 100);
  commandPaletteResults.innerHTML = displayItems.map((item, index) => {
    const isSelected = index === commandPaletteSelectedIndex;
    const isFolder = item.type === 'folder';
    const icon = item.isCommand ? (item.icon || '⌘')
               : isFolder ? '📂'
               : item.isOpenTab ? '📄'
               : '📁';
    const pathSep = window.electronAPI.pathSep || '/';
    const pathDir = item.isCommand ? (item.description || 'Command') : (item.path ? item.path.substring(0, item.path.lastIndexOf(pathSep)) : '');
    const isOpenBadge = item.isOpenTab ? '<span class="command-palette-badge">Open</span>' : '';
    const isCommandBadge = item.isCommand ? '<span class="command-palette-badge" style="background: var(--accent-color); color: white;">Command</span>' : '';
    const isFolderBadge = isFolder ? '<span class="command-palette-badge" title="Opens as project in new window">Folder</span>' : '';

    return `
      <div class="command-palette-item ${isSelected ? 'selected' : ''}" data-index="${index}">
        <div class="command-palette-item-icon">${icon}</div>
        <div class="command-palette-item-info">
          <div class="command-palette-item-name">
            ${escapeHtml(item.name)} ${isOpenBadge} ${isCommandBadge} ${isFolderBadge}
          </div>
          <div class="command-palette-item-path">${escapeHtml(pathDir)}</div>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers to items
  commandPaletteResults.querySelectorAll('.command-palette-item').forEach((el, index) => {
    el.addEventListener('click', (e) => {
      selectCommandPaletteItem(index, e);
    });
    
    el.addEventListener('mouseenter', () => {
      commandPaletteSelectedIndex = index;
      updateCommandPaletteSelection();
    });
  });

  // Ensure selected item is visible
  updateCommandPaletteSelection();
}

function updateCommandPaletteSelection() {
  commandPaletteResults.querySelectorAll('.command-palette-item').forEach((el, index) => {
    el.classList.toggle('selected', index === commandPaletteSelectedIndex);
  });

  // Scroll selected item into view
  const selectedEl = commandPaletteResults.querySelector('.command-palette-item.selected');
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: 'nearest' });
  }
}

function updateSelectedItem() {
  updateCommandPaletteSelection();
}

function selectCommandPaletteItem(index, event = null) {
  if (index >= 0 && index < commandPaletteFiles.length) {
    const item = commandPaletteFiles[index];
    hideCommandPalette();

    if (item.isCommand && item.action) {
      item.action();
      return;
    }

    const file = item;
    // Cmd+click = new tab in background, Cmd+Shift+click = new tab and focus
    const options = {};
    if (event && event.metaKey) {
      options.newTab = true;
      options.background = !event.shiftKey; // Cmd+click = background, Cmd+Shift+click = focus
    }

    // Folders open as a workspace in a new window (markdown-reader-7qf).
    // Picking "Open in New Window" is the safer/clearer default — it doesn't
    // disturb the user's current workspace.
    if (file.type === 'folder') {
      window.electronAPI.openFolderInNewWindow(file.path);
      return;
    }

    if (file.isOpenTab && file.tabId && !options.newTab) {
      switchToTab(file.tabId);
    } else {
      window.electronAPI.openFileByPath(file.path, options);
    }
  }
}

// Command palette input handler with debounce
let commandPaletteInputTimer = null;
commandPaletteInput.addEventListener('input', () => {
  clearTimeout(commandPaletteInputTimer);
  commandPaletteInputTimer = setTimeout(() => {
    commandPaletteSelectedIndex = 0;
    updateCommandPaletteResults();
  }, 150);
});

// Command palette keyboard navigation
commandPaletteInput.addEventListener('keydown', (e) => {
  const items = commandPaletteFiles; // Use data source instead of DOM query

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    lastInputSource = 'keyboard';
    if (commandPaletteSelectedIndex < items.length - 1) {
      commandPaletteSelectedIndex++;
      updateSelectedItem();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    lastInputSource = 'keyboard';
    if (commandPaletteSelectedIndex > 0) {
      commandPaletteSelectedIndex--;
      updateSelectedItem();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    lastInputSource = 'keyboard';
    selectCommandPaletteItem(commandPaletteSelectedIndex);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hideCommandPalette();
  }
});

// Close on backdrop click
document.querySelector('.command-palette-backdrop').addEventListener('click', () => {
  hideCommandPalette();
});

// TOC toggle button handler
tocToggleBtn.addEventListener('click', toggleTOC);
tocCloseBtn.addEventListener('click', toggleTOC);

// CSV raw/table toggle handler
csvToggleRawBtn.addEventListener('click', () => {
  settings.csvViewAsTable = !settings.csvViewAsTable;
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.content !== null) {
    if (settings.csvViewAsTable) {
      csvToggleRawBtn.innerHTML = `
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path d="M4 1.75C4 .784 4.784 0 5.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v8.586A1.75 1.75 0 0114.25 15h-9a.75.75 0 010-1.5h9a.25.25 0 00.25-.25V6H12.5a.25.25 0 01-.25-.25V2.5H5.75a.25.25 0 00-.25.25v2.5a.75.75 0 01-1.5 0V1.75z"/>
          <path d="M0 10.75C0 9.784.784 9 1.75 9h5.5c.966 0 1.75.784 1.75 1.75v3.5A1.75 1.75 0 017.25 16h-5.5A1.75 1.75 0 010 14.25v-3.5zm1.75-.25a.25.25 0 00-.25.25v3.5c0 .138.112.25.25.25h5.5a.25.25 0 00.25-.25v-3.5a.25.25 0 00-.25-.25h-5.5z"/>
        </svg>
        Raw
      `;
      showCSVView(tab.content, tab.fileName);
    } else {
      csvToggleRawBtn.innerHTML = `
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path d="M0 1.5A1.5 1.5 0 011.5 0h13A1.5 1.5 0 0116 1.5v13a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 010 14.5v-13zM1.5 1a.5.5 0 00-.5.5V5h4V1H1.5zM5 6H1v4h4V6zm1 4h4V6H6v4zm5 0V6h4v4h-4zM5 11H1v3.5a.5.5 0 00.5.5H5v-4zm1 4h4v-4H6v4zm5-4v4h3.5a.5.5 0 00.5-.5V11h-4zM15 5h-4V1h3.5a.5.5 0 01.5.5V5zM6 5V1h4v4H6z"/>
        </svg>
        Table
      `;
      hideCSVView();
      // Show as raw text in a code block
      const escapedContent = escapeHtml(tab.content);
      markdownBody.innerHTML = `<pre><code class="language-csv">${escapedContent}</code></pre>`;
      markdownBody.classList.remove('hidden');
    }
  }
});

// Load and display recent files on welcome screen
async function loadRecentFiles() {
  const recentFilesSection = document.getElementById('recent-files-section');
  const recentFilesList = document.getElementById('recent-files-list');

  try {
    const recentFiles = await window.electronAPI.getRecentFiles();

    if (recentFiles && recentFiles.length > 0) {
      recentFilesSection.classList.remove('hidden');

      // Show up to 5 recent items on welcome screen
      const displayFiles = recentFiles.slice(0, 5);

      recentFilesList.innerHTML = displayFiles.map(item => {
        const fileName = item.path.split('/').pop();
        const displayPath = item.path.replace(/^\/Users\/[^/]+/, '~');
        const isFolder = item.type === 'folder';

        const icon = isFolder
          ? `<svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
               <path d="M1.75 2.5a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25v-8.5a.25.25 0 00-.25-.25H7.5c-.55 0-1.07-.26-1.4-.7l-.9-1.2a.25.25 0 00-.2-.1H1.75z"/>
             </svg>`
          : `<svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
               <path d="M3.75 1.5a.25.25 0 00-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V4.664a.25.25 0 00-.073-.177l-2.914-2.914a.25.25 0 00-.177-.073H3.75zM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v8.586A1.75 1.75 0 0112.25 15h-8.5A1.75 1.75 0 012 13.25V1.75z"/>
             </svg>`;

        return `
          <div class="recent-file-item ${isFolder ? 'folder' : ''}" data-path="${escapeHtml(item.path)}" data-type="${item.type}">
            ${icon}
            <div class="recent-file-info">
              <div class="recent-file-name">${escapeHtml(fileName)}</div>
              <div class="recent-file-path">${escapeHtml(displayPath)}</div>
            </div>
          </div>
        `;
      }).join('');

      // Add click handlers
      recentFilesList.querySelectorAll('.recent-file-item').forEach(item => {
        item.addEventListener('click', (e) => {
          const filePath = item.dataset.path;
          const fileType = item.dataset.type;

          // Cmd+click = new tab in background, Cmd+Shift+click = new tab and focus
          const options = {};
          if (e.metaKey) {
            options.newTab = true;
            options.background = !e.shiftKey; // Cmd+click = background, Cmd+Shift+click = focus
          }

          if (fileType === 'folder') {
            // For folders, we need to trigger directory loading
            window.electronAPI.getDirectoryContents(filePath).then(files => {
              // Manually trigger the directory loaded flow
              const event = { dirPath: filePath, files };
              window.electronAPI.onDirectoryLoaded(() => {}); // No-op, just need to open
              // Use openFileByPath which will handle folder detection
            });
            // Actually open the folder properly
            window.electronAPI.openFileByPath(filePath, options);
          } else {
            window.electronAPI.openFileByPath(filePath, options);
          }
        });
      });
    } else {
      recentFilesSection.classList.add('hidden');
    }
  } catch (err) {
    console.error('Error loading recent files:', err);
    recentFilesSection.classList.add('hidden');
  }
}

// Initialize with one empty tab
createTab();

// Load recent files for welcome screen
loadRecentFiles();

// Handle unsaved changes check from main process
window.electronAPI.onCheckUnsaved(async () => {
  // If auto-save is enabled, save all modified files with paths first
  if (settings.autoSave) {
    clearTimeout(autoSaveTimer); // Cancel any pending auto-save
    const savePromises = tabs
      .filter(tab => tab.isModified && tab.filePath)
      .map(async tab => {
        if (tab.isEditing && tab.id === activeTabId) {
          tab.content = easyMDE ? easyMDE.value() : editor.value;
        }
        const result = await writeTabToDisk(tab, { fromAutoSave: true });
        if (result && result.success) {
          tab.isModified = false;
          if (tab.isEditing) {
            tab.originalContent = tab.content;
          }
          updateTabUI(tab.id);
        }
      });
    await Promise.all(savePromises);
  }

  // Build list of unsaved tabs
  const unsavedTabs = tabs
    .filter(tab => {
      // With auto-save, only untitled files count as unsaved
      if (settings.autoSave) {
        return tab.isModified && !tab.filePath;
      }
      return tab.isModified;
    })
    .map(tab => ({
      id: tab.id,
      fileName: tab.fileName,
      filePath: tab.filePath,
      isModified: tab.isModified
    }));

  const sessionData = {
    tabs: tabs.map(t => ({
      filePath: t.filePath,
      fileName: t.fileName
    })).filter(t => t.filePath),
    directory: currentDirectory,
    activeTabIndex: tabs.findIndex(t => t.id === activeTabId),
    sidebarVisible: settings.sidebarVisible,
    sidebarWidth: settings.sidebarWidth,
    richToolbarVisible: settings.richToolbarVisible
  };

  window.electronAPI.reportUnsavedState({
    hasUnsaved: unsavedTabs.length > 0,
    unsavedTabs,
    sessionData
  });
});

// Handle review unsaved tab request - save a specific tab by ID
window.electronAPI.onReviewUnsavedTab(async (tabInfo) => {
  const tab = tabs.find(t => t.id === tabInfo.id);
  if (!tab) {
    window.electronAPI.reportReviewDecision({ success: false, error: 'Tab not found' });
    return;
  }

  // Make sure we have the latest content if this tab is being edited
  if (tab.isEditing && tab.id === activeTabId) {
    tab.content = editor.value;
  }

  try {
    if (tab.filePath) {
      const saveResult = await writeTabToDisk(tab);
      if (!saveResult || !saveResult.success) {
        window.electronAPI.reportReviewDecision({
          success: false,
          tabId: tab.id,
          cancelled: !!(saveResult && saveResult.cancelled)
        });
        return;
      }
      tab.isModified = false;
      tab.originalContent = tab.content;
      updateTabUI(tab.id);
      window.electronAPI.reportReviewDecision({ success: true, tabId: tab.id });
    } else {
      // No file path, need Save As dialog
      const result = await window.electronAPI.saveFileAs(tab.content, tab.fileName);
      if (result) {
        tab.filePath = result.filePath;
        tab.fileName = result.fileName;
        tab.lastKnownMtime = result.mtime;
        tab.isModified = false;
        tab.externalChangePending = false;
        tab.originalContent = tab.content;
        updateTabDisplay(tab.id, tab.fileName, tab.filePath);
        updateTabUI(tab.id);
        window.electronAPI.reportReviewDecision({ success: true, tabId: tab.id, saved: true });
      } else {
        // User cancelled save as dialog
        window.electronAPI.reportReviewDecision({ success: false, tabId: tab.id, cancelled: true });
      }
    }
  } catch (error) {
    window.electronAPI.reportReviewDecision({ success: false, tabId: tab.id, error: error.message });
  }
});

// Handle session state request from main process
window.electronAPI.onGetSessionState(() => {
  const sessionData = {
    tabs: tabs.map(t => ({
      filePath: t.filePath,
      fileName: t.fileName
    })).filter(t => t.filePath), // Only save tabs with files
    directory: currentDirectory,
    activeTabIndex: tabs.findIndex(t => t.id === activeTabId),
    sidebarVisible: settings.sidebarVisible,
    sidebarWidth: settings.sidebarWidth,
    richToolbarVisible: settings.richToolbarVisible
  };
  window.electronAPI.reportSessionState(sessionData);
});

// Handle session restore from main process
window.electronAPI.onRestoreSession((data) => {
  if (!data) return;

  // Restore sidebar visibility (fallback: show if a directory is restored)
  const shouldShowSidebar = (typeof data.sidebarVisible === 'boolean')
    ? data.sidebarVisible
    : Boolean(data.directory);
  setSidebarVisibility(shouldShowSidebar);
  applySidebarWidth(data.sidebarWidth || settings.sidebarWidth);

  if (typeof data.richToolbarVisible === 'boolean') {
    settings.richToolbarVisible = data.richToolbarVisible;
  }
  updateRichToolbarUI();

  // Restore directory/sidebar
  if (data.directory) {
    currentDirectory = data.directory;
    window.electronAPI.getDirectoryContents(data.directory).then(files => {
      directoryFiles = files;
      sortDirectoryFiles(directoryFiles);
      updateSidebarPath(currentDirectory);
      renderFileTree();
      startSidebarLiveWatcher();
    }).catch(console.error);
  }

  // Restore tabs
  if (data.tabs && data.tabs.length > 0) {
    // Close the default empty tab
    const firstTab = tabs[0];
    if (firstTab && !firstTab.filePath && !firstTab.content) {
      closeTab(firstTab.id, true); // silent close
    }

    // Open each saved tab in background to preserve ordering/focus
    data.tabs.forEach((tabData) => {
      if (tabData.filePath) {
        window.electronAPI.openFileByPath(tabData.filePath, { newTab: true, background: true });
      }
    });

    // Restore focus to previously active tab once loads settle
    const activeIndex = typeof data.activeTabIndex === 'number' ? data.activeTabIndex : -1;
    const activeTabData = activeIndex >= 0 && activeIndex < data.tabs.length
      ? data.tabs[activeIndex]
      : null;

    const focusByPath = (filePath, attempts = 10) => {
      const target = tabs.find(t => t.filePath === filePath);
      if (target) {
        switchToTab(target.id);
        return;
      }
      if (attempts > 0) {
        setTimeout(() => focusByPath(filePath, attempts - 1), 100);
      }
    };

    if (activeTabData && activeTabData.filePath) {
      focusByPath(activeTabData.filePath);
    } else if (data.tabs[0] && data.tabs[0].filePath) {
      focusByPath(data.tabs[0].filePath);
    }
  }
});

console.log('Renderer loaded with editing and sidebar support');
// Find in File
const findBar = document.getElementById('find-bar');
const findInput = document.getElementById('find-input');
const findCount = document.getElementById('find-count');
const findPrevBtn = document.getElementById('find-prev-btn');
const findNextBtn = document.getElementById('find-next-btn');
const findCloseBtn = document.getElementById('find-close-btn');

let findState = {
  isOpen: false,
  matches: [], // DOM elements (preview) or {start, end} objects (edit)
  currentIndex: -1,
  query: ''
};

function toggleFind() {
  if (findState.isOpen) {
    hideFindBar();
  } else {
    showFindBar();
  }
}

function showFindBar() {
  findState.isOpen = true;
  findBar.classList.remove('hidden');
  findInput.focus();
  findInput.select();
  updateFindResults();
}

function hideFindBar() {
  findState.isOpen = false;
  findBar.classList.add('hidden');
  clearFindHighlights();
  findCount.classList.add('hidden');
  
  // Return focus to content
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.isEditing) {
    editor.focus();
  }
}

function clearFindHighlights() {
  // Clear preview highlights
  const marks = document.querySelectorAll('mark.find-match');
  marks.forEach(mark => {
    const parent = mark.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    }
  });
  
  findState.matches = [];
  findState.currentIndex = -1;
  findState.query = '';
}

function updateFindResults(options = {}) {
  if (!findState.isOpen) return;
  const { preserveInputFocus = false } = options;

  const query = findInput.value;
  if (!query) {
    clearFindHighlights();
    findCount.classList.add('hidden');
    return;
  }

  clearFindHighlights();
  findState.query = query;

  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;

  if (tab.isEditing) {
    searchInEditor(query, { preserveInputFocus });
  } else {
    searchInPreview(query, { preserveScroll: preserveInputFocus });
  }
  
  updateFindCountUI();
}

function searchInEditor(query, options = {}) {
  const { preserveInputFocus = false } = options;
  // Use EasyMDE's value if active, otherwise plain textarea
  const text = easyMDE ? easyMDE.value() : editor.value;
  const regex = new RegExp(escapeRegExp(query), 'gi');
  let match;

  findState.matches = [];

  while ((match = regex.exec(text)) !== null) {
    findState.matches.push({
      start: match.index,
      end: match.index + match[0].length
    });
  }

  if (findState.matches.length > 0) {
    findState.currentIndex = 0;
    jumpToMatch(0, { preserveInputFocus });
  }
}

function searchInPreview(query, options = {}) {
  if (!markdownBody) return;
  const { preserveScroll = false } = options;

  // Remember scroll position before modifying DOM
  const scrollY = window.scrollY;

  // TreeWalker to find text nodes
  const walker = document.createTreeWalker(
    markdownBody,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  const textNodes = [];
  let node;
  while (node = walker.nextNode()) {
    textNodes.push(node);
  }

  const regex = new RegExp(escapeRegExp(query), 'gi');
  let allMatches = [];

  textNodes.forEach(textNode => {
    const text = textNode.nodeValue;
    let match;
    regex.lastIndex = 0;

    while ((match = regex.exec(text)) !== null) {
      allMatches.push({
        node: textNode,
        index: match.index,
        length: match[0].length,
        text: match[0]
      });
    }
  });

  // Group matches by node
  const matchesByNode = new Map();
  allMatches.forEach(m => {
    if (!matchesByNode.has(m.node)) matchesByNode.set(m.node, []);
    matchesByNode.get(m.node).push(m);
  });

  findState.matches = [];

  // Process each node
  matchesByNode.forEach((matches, node) => {
    // Sort reverse order
    matches.sort((a, b) => b.index - a.index);

    matches.forEach(m => {
      const range = document.createRange();
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m.length);

      const mark = document.createElement('mark');
      mark.className = 'find-match';
      mark.textContent = m.text;

      range.deleteContents();
      range.insertNode(mark);
    });
  });

  // Re-query to get marks in order
  findState.matches = Array.from(document.querySelectorAll('mark.find-match'));

  if (findState.matches.length > 0) {
    if (preserveScroll) {
      // Find the match closest to the current scroll position
      let closestIndex = 0;
      let closestDist = Infinity;
      findState.matches.forEach((mark, i) => {
        const dist = Math.abs(mark.getBoundingClientRect().top);
        if (dist < closestDist) {
          closestDist = dist;
          closestIndex = i;
        }
      });
      findState.currentIndex = closestIndex;
      findState.matches.forEach(m => m.classList.remove('active'));
      findState.matches[closestIndex].classList.add('active');
      // Restore scroll position (DOM changes may have shifted it)
      window.scrollTo(0, scrollY);
    } else {
      findState.currentIndex = 0;
      jumpToMatch(0);
    }
  }
}

function jumpToMatch(index, options = {}) {
  const { preserveInputFocus = false } = options;
  if (findState.matches.length === 0) return;

  // Wrap index
  if (index < 0) index = findState.matches.length - 1;
  if (index >= findState.matches.length) index = 0;

  findState.currentIndex = index;
  updateFindCountUI();

  const tab = tabs.find(t => t.id === activeTabId);

  if (tab.isEditing) {
    const match = findState.matches[index];

    if (easyMDE) {
      // Convert character offset to CodeMirror {line, ch} position
      const cm = easyMDE.codemirror;
      const text = easyMDE.value();

      function offsetToPos(offset) {
        let line = 0;
        let ch = 0;
        for (let i = 0; i < offset && i < text.length; i++) {
          if (text[i] === '\n') {
            line++;
            ch = 0;
          } else {
            ch++;
          }
        }
        return { line, ch };
      }

      const from = offsetToPos(match.start);
      const to = offsetToPos(match.end);

      if (!preserveInputFocus) cm.focus();
      cm.setSelection(from, to);
      cm.scrollIntoView({ from, to }, 100);
    } else {
      if (!preserveInputFocus) editor.focus();
      editor.setSelectionRange(match.start, match.end);
    }
  } else {
    // Preview
    const mark = findState.matches[index];

    // Remove active class from all
    findState.matches.forEach(m => m.classList.remove('active'));

    mark.classList.add('active');
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function updateFindCountUI() {
  if (findState.matches.length > 0) {
    findCount.textContent = `${findState.currentIndex + 1}/${findState.matches.length}`;
    findCount.classList.remove('hidden');
    findNextBtn.disabled = false;
    findPrevBtn.disabled = false;
  } else {
    findCount.textContent = '0/0';
    if (findInput.value) {
      findCount.classList.remove('hidden');
    } else {
      findCount.classList.add('hidden');
    }
    findNextBtn.disabled = true;
    findPrevBtn.disabled = true;
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\\]/g, '\\$&');
}

// Event Listeners for Find
findInput.addEventListener('input', () => {
  updateFindResults({ preserveInputFocus: true });
});

findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) {
      jumpToMatch(findState.currentIndex - 1);
    } else {
      jumpToMatch(findState.currentIndex + 1);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hideFindBar();
  }
});

findNextBtn.addEventListener('click', () => {
  jumpToMatch(findState.currentIndex + 1);
});

findPrevBtn.addEventListener('click', () => {
  jumpToMatch(findState.currentIndex - 1);
});

findCloseBtn.addEventListener('click', hideFindBar);

window.electronAPI.onFindInFile(toggleFind);

window.electronAPI.onFileLoaded(() => {
  if (findState.isOpen) {
    setTimeout(updateFindResults, 50);
  }
});

// Handle link clicks - open external links in browser, handle internal links in-app
markdownBody.addEventListener('click', (e) => {
  const collapseToggle = e.target.closest('.collapse-toggle');
  if (collapseToggle) {
    e.preventDefault();
    e.stopPropagation();
    const heading = collapseToggle.closest('h1, h2, h3, h4, h5, h6');
    const section = heading && heading.parentElement && heading.parentElement.classList.contains('md-section')
      ? heading.parentElement
      : null;
    if (!section) return;
    if (section.classList.contains('md-section-empty')) return;

    const isCollapsed = section.classList.toggle('collapsed');
    collapseToggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    return;
  }

  const link = e.target.closest('a');
  if (!link) return;

  const href = link.getAttribute('href');
  if (!href) return;

  e.preventDefault();

  // External links (http/https) - open in browser
  if (href.startsWith('http://') || href.startsWith('https://')) {
    window.electronAPI.openExternal(href);
    return;
  }

  // Anchor links (same page)
  if (href.startsWith('#')) {
    const target = document.getElementById(href.slice(1));
    if (target) {
      expandSectionAncestors(target);
      target.scrollIntoView({ behavior: 'smooth' });
    }
    return;
  }

  // Relative file links - try to open the file
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.filePath) {
    const wikiHeading = link.getAttribute('data-wiki-heading');
    if (wikiHeading && href === tab.filePath) {
      const target = document.getElementById(wikiHeading);
      if (target) {
        expandSectionAncestors(target);
        target.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }

    const currentDir = tab.filePath.substring(0, tab.filePath.lastIndexOf('/'));
    const targetPath = href.startsWith('/') ? href : `${currentDir}/${href}`;

    // Cmd+click (Mac) / Ctrl+click (Win/Linux) = new tab in background, +Shift = focus
    const options = {};
    if (e.metaKey || (!isMac && e.ctrlKey)) {
      options.newTab = true;
      options.background = !e.shiftKey; // Cmd+click = background, Cmd+Shift+click = focus
    }

    window.electronAPI.openFileByPath(targetPath, options);
  }
});

// Right-click in content area shows tab context menu (for easy access to tab actions)
markdownBody.addEventListener('contextmenu', (e) => {
  // If user has selected text, let the default context menu appear for copy
  const selection = window.getSelection();
  if (selection && selection.toString().length > 0) return;

  // Don't show on links - let the default link context menu appear
  if (e.target.closest('a')) return;

  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;

  e.preventDefault();
  const tabIndex = tabs.findIndex(t => t.id === activeTabId);
  window.electronAPI.showTabContextMenu({
    tabId: activeTabId,
    filePath: tab.filePath,
    tabIndex,
    totalTabs: tabs.length,
    directory: currentDirectory
  });
});


// ==========================================
// RICH EDITOR (EasyMDE) INTEGRATION
// ==========================================

const richModeBtn = document.getElementById('rich-mode-btn');
const richToolbarBtn = document.getElementById('rich-toolbar-btn');

// Detect markdown links under a given cursor position (single line)
function findRegexMatchAt(re, text, ch) {
  re.lastIndex = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (ch >= start && ch <= end) return match;
  }
  return null;
}

function extractMarkdownLinkAt(lineText, ch) {
  // Inline links/images: [label](href "title") or ![alt](href)
  let m = findRegexMatchAt(/!?\[[^\]]*?\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, lineText, ch);
  if (m) return m[1];

  // Autolinks: <https://example.com>
  m = findRegexMatchAt(/<(https?:\/\/[^>]+)>/g, lineText, ch);
  if (m) return m[1];

  // Bare URLs
  m = findRegexMatchAt(/(https?:\/\/[^\s)]+)/g, lineText, ch);
  if (m) return m[1];

  // Wiki-style links: [[file.md]]
  m = findRegexMatchAt(/\[\[([^\]]+)\]\]/g, lineText, ch);
  if (m) {
    const parsed = parseWikiLinkMarkup(m[1]);
    const resolved = resolveWikiLinkTarget(parsed.targetPart);
    if (resolved && resolved.type === 'anchor') return resolved.href;
    if (resolved && resolved.type === 'file') return resolved.href;
    return null;
  }

  return null;
}

function openLinkFromEditor(href, e) {
  if (!href) return;

  if (href.startsWith('http://') || href.startsWith('https://')) {
    window.electronAPI.openExternal(href);
    return;
  }

  if (href.startsWith('#')) {
    return; // anchors don't do much in edit mode
  }

  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.filePath) {
    const currentDir = tab.filePath.substring(0, tab.filePath.lastIndexOf('/'));
    const targetPath = href.startsWith('/') ? href : `${currentDir}/${href}`;

    const options = {
      newTab: true,
      background: !e.shiftKey
    };

    window.electronAPI.openFileByPath(targetPath, options);
  }
}

// Stub — the real per-tab versions are defined further down (see "Redefine
// initRichEditor to add auto-save hook"). Kept as no-ops to avoid breaking
// any pre-override callsites.
function initRichEditor() {}
function destroyRichEditor() {}

// Toggle Rich/Plain Mode
richModeBtn.addEventListener('click', () => {
  settings.richEditorMode = !settings.richEditorMode;
  if (settings.richEditorMode) {
    richModeBtn.classList.add('active');
    enterRichMode();
    if (richToolbarBtn) {
      richToolbarBtn.classList.remove('hidden');
      updateRichToolbarUI();
    }
  } else {
    richModeBtn.classList.remove('active');
    leaveRichMode();
    if (richToolbarBtn) richToolbarBtn.classList.add('hidden');
    if (editor && editor.focus) editor.focus();
  }
});

function updateRichToolbarUI() {
  if (!editorContainer) return;
  const shouldShow = settings.richEditorMode && settings.richToolbarVisible;
  editorContainer.classList.toggle('hide-rich-toolbar', !shouldShow);
  if (richToolbarBtn) {
    richToolbarBtn.classList.toggle('active', settings.richToolbarVisible);
    richToolbarBtn.title = settings.richToolbarVisible
      ? 'Hide Formatting Toolbar'
      : 'Show Formatting Toolbar';
  }
}

if (richToolbarBtn) {
  richToolbarBtn.addEventListener('click', () => {
    settings.richToolbarVisible = !settings.richToolbarVisible;
    updateRichToolbarUI();
    if (easyMDE) {
      easyMDE.codemirror.focus();
    }
  });
}

// ------------------------------------------
// Overridden Functions to support EasyMDE
// ------------------------------------------

// Per-tab showEditor: make sure the active tab's editor (textarea or EasyMDE
// wrapper) is the visible one, and seed content only if the editor doesn't
// already have it (preserves undo on preview/mode toggles).
showEditor = function(content) {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;

  // Make sure tab's textarea exists and is the active one
  setActiveEditor(tab);

  // Seed plain-mode textarea content only if it differs (preserves undo)
  if (typeof content === 'string' && tab.editorEl && tab.editorEl.value !== content) {
    tab.editorEl.value = content;
  }

  editorContainer.classList.remove('hidden');
  markdownBody.classList.add('hidden');
  dropZone.classList.add('hidden');
  document.getElementById('content').classList.remove('hidden');

  richModeBtn.classList.remove('hidden');

  if (settings.richEditorMode) {
    richModeBtn.classList.add('active');
    if (richToolbarBtn) richToolbarBtn.classList.remove('hidden');
    updateRichToolbarUI();
    enterRichMode();
    // Sync content into rich editor only if it differs (preserves CM undo)
    if (tab.easyMDE && typeof content === 'string' && tab.easyMDE.value() !== content) {
      tab.easyMDE.value(content);
    }
  } else {
    richModeBtn.classList.remove('active');
    if (richToolbarBtn) richToolbarBtn.classList.add('hidden');
    if (tab.easyMDE) leaveRichMode();
    if (tab.editorEl) tab.editorEl.focus();
  }
};

// Per-tab hideEditor: capture in-flight content into tab.content and hide
// the editor container. Does NOT destroy the per-tab editor instances —
// they stay in the DOM (just hidden) so undo survives.
hideEditor = function() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.isEditing) {
    tab.content = tab.easyMDE ? tab.easyMDE.value() : (tab.editorEl ? tab.editorEl.value : tab.content);
  }
  editorContainer.classList.add('hidden');
  markdownBody.classList.remove('hidden');
  richModeBtn.classList.add('hidden');
  if (richToolbarBtn) richToolbarBtn.classList.add('hidden');
};

switchToTab = function(tabId) {
  // Save current tab state — read content from THIS tab's own editor instance
  // (not the global `editor`/`easyMDE` refs which would be reassigned in a moment)
  if (activeTabId !== null) {
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (currentTab) {
      currentTab.scrollPos = window.scrollY;
      if (currentTab.isEditing) {
        if (currentTab.easyMDE) {
          currentTab.content = currentTab.easyMDE.value();
        } else if (currentTab.editorEl) {
          currentTab.content = currentTab.editorEl.value;
        }
      }
    }
  }

  // Update active tab
  activeTabId = tabId;
  const tab = tabs.find(t => t.id === tabId);

  // Update tab UI
  document.querySelectorAll('.tab').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.tabId) === tabId);
  });

  // Show content
  if (tab && tab.content !== null && tab.content !== undefined) {
    if (tab.isEditing) {
      showEditor(tab.content);
    } else {
      hideEditor();
      renderContent(tab.content, tab.fileName);
    }
    updateDocumentWordCount(tab);
    document.title = `${tab.fileName}${tab.isModified ? ' *' : ''} - OpenMarkdownReader`;
    setTimeout(() => window.scrollTo(0, tab.scrollPos), 0);
  } else {
    // Show welcome screen
    hideEditor();
    hideCSVView();
    dropZone.classList.remove('hidden');
    content.classList.add('hidden');
    document.title = 'OpenMarkdownReader';
    updateDocumentWordCount(null);
  }

  // Preserve browser-style tab/file history behavior for back/forward navigation.
  if (tab) {
    pushNavHistory(tabId, tab.filePath);
  }

  updateTabUI(tabId);
  syncActiveSidebarFileHighlight();
  
  // Re-run find if open
  if (typeof updateFindResults === 'function' && findState && findState.isOpen) {
     setTimeout(updateFindResults, 50);
  }
};

function getEditModeScrollPercent(tab) {
  if (!tab || !tab.isEditing) return 0;
  if (tab.easyMDE) {
    const scrollInfo = tab.easyMDE.codemirror.getScrollInfo();
    return scrollInfo.top / Math.max(1, scrollInfo.height - scrollInfo.clientHeight);
  }
  const activeEditor = tab.editorEl || editor;
  if (!activeEditor) return 0;
  return activeEditor.scrollTop / Math.max(1, activeEditor.scrollHeight - activeEditor.clientHeight);
}

function exitEditMode({ scrollPercent } = {}) {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab || !tab.isEditing) return;

  const previewScrollPercent = typeof scrollPercent === 'number'
    ? scrollPercent
    : getEditModeScrollPercent(tab);

  tab.isEditing = false;
  tab.content = tab.easyMDE ? tab.easyMDE.value() : (tab.editorEl ? tab.editorEl.value : tab.content);
  hideEditor();
  renderContent(tab.content, tab.fileName);

  setTimeout(() => {
    const targetScroll = previewScrollPercent * (markdownBody.scrollHeight - markdownBody.clientHeight);
    markdownBody.scrollTop = targetScroll;
  }, 50);

  updateTabUI(activeTabId);
}

toggleEditMode = function() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;

  // New file logic
  if (!tab.content && tab.content !== '') {
    tab.fileName = 'Untitled.md';
    tab.content = '';
    tab.isEditing = true;
    tab.originalContent = '';
    updateTabDisplay(activeTabId, tab.fileName, tab.filePath);
    showEditor('');
    updateTabUI(activeTabId);
    return;
  }

  if (settings.readOnlyMode) {
    alert('Read-only mode is enabled. Disable it in the View menu to edit.');
    return;
  }

  // Capture scroll position before switching
  let scrollPercent = 0;
  if (tab.isEditing) {
    // Switching FROM edit mode - get editor scroll position
    scrollPercent = getEditModeScrollPercent(tab);
  } else {
    // Switching FROM preview mode - get preview scroll position
    scrollPercent = markdownBody.scrollTop / Math.max(1, markdownBody.scrollHeight - markdownBody.clientHeight);
  }

  tab.isEditing = !tab.isEditing;

  if (tab.isEditing) {
    tab.originalContent = tab.content;
    showEditor(tab.content);

    // Restore scroll position in editor after a brief delay for layout
    setTimeout(() => {
      if (easyMDE) {
        const scrollInfo = easyMDE.codemirror.getScrollInfo();
        const targetScroll = scrollPercent * (scrollInfo.height - scrollInfo.clientHeight);
        easyMDE.codemirror.scrollTo(null, targetScroll);
      } else {
        const targetScroll = scrollPercent * (editor.scrollHeight - editor.clientHeight);
        editor.scrollTop = targetScroll;
      }
    }, 50);
  } else {
    exitEditMode({ scrollPercent });
  }
};

saveFile = async function(options = {}) {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;

  if (tab.isEditing) {
    tab.content = easyMDE ? easyMDE.value() : editor.value;
  }

  if (tab.filePath) {
    const { fromAutoSave = false } = options;
    const result = await writeTabToDisk(tab, { fromAutoSave });
    if (result && result.success) {
      tab.isModified = false;
      if (tab.isEditing) {
        tab.originalContent = tab.content;
      }
      updateTabUI(activeTabId);
      document.title = `${tab.fileName} - OpenMarkdownReader`;
    }
  } else {
    const result = await window.electronAPI.saveFileAs(tab.content, tab.fileName);
    if (result) {
        tab.filePath = result.filePath;
        tab.fileName = result.fileName;
        tab.lastKnownMtime = result.mtime;
        tab.isModified = false;
        tab.externalChangePending = false;
        if (tab.isEditing) tab.originalContent = tab.content;

        updateTabDisplay(activeTabId, tab.fileName, tab.filePath);
        updateTabUI(activeTabId);
        syncActiveSidebarFileHighlight();
        document.title = `${tab.fileName} - OpenMarkdownReader`;
    }
  }
};

closeTab = async function(tabId, silent = false) {
  const tab = tabs.find(t => t.id === tabId);
  const tabIndex = tabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return;

  // Check for unsaved changes
  if (!silent && tab && tab.isModified) {
    const result = await showSaveDialog(tab.fileName);
    if (result === 'cancel') return;
    if (result === 'save') {
      if (tab.isEditing) {
        if (activeTabId === tabId && easyMDE) {
            tab.content = easyMDE.value();
        } else if (activeTabId === tabId) {
            tab.content = editor.value; 
        }
      }
      if (tab.filePath) {
        const saveResult = await writeTabToDisk(tab);
        if (!saveResult || !saveResult.success) return;
        tab.isModified = false;
        if (tab.isEditing) {
          tab.originalContent = tab.content;
        }
        updateTabUI(tab.id);
      } else {
        const saveResult = await window.electronAPI.saveFileAs(tab.content, tab.fileName);
        if (!saveResult) return;
      }
    }
  }

  // Stop watching the file if we were watching it
  if (tab && tab.filePath && settings.watchFileMode) {
    window.electronAPI.unwatchFile(tab.filePath);
  }

  // Save tab info for reopening (Cmd+Shift+T)
  if (tab && (tab.filePath || tab.content)) {
    closedTabs.push({
      fileName: tab.fileName,
      filePath: tab.filePath,
      content: tab.content,
      scrollPos: tab.scrollPos
    });
    if (closedTabs.length > MAX_CLOSED_TABS) {
      closedTabs.shift();
    }
  }

  // Free per-tab editor resources before removing the tab
  releaseTabEditor(tab);

  // Remove tab
  tabs.splice(tabIndex, 1);
  const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (tabEl) tabEl.remove();

  if (activeTabId === tabId) {
    if (tabs.length > 0) {
      const newIndex = Math.min(tabIndex, tabs.length - 1);
      switchToTab(tabs[newIndex].id);
    } else {
      activeTabId = null;
      hideEditor();
      hideCSVView();
      dropZone.classList.remove('hidden');
      content.classList.add('hidden');
      document.title = 'OpenMarkdownReader';
      updateDocumentWordCount(null);
    }
  }
};

// ==========================================
// AUTO SAVE & RECENT PALETTE EXTENSIONS
// ==========================================

settings.autoSave = false;
let autoSaveTimer = null;
let commandPaletteMode = 'files'; // 'files' or 'recent'

function triggerAutoSave() {
  if (!settings.autoSave) return;
  
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab || !tab.filePath) return;
  
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (tab.id === activeTabId) {
        saveFile({ fromAutoSave: true }); 
    } else {
        writeTabToDisk(tab, { fromAutoSave: true }).then((result) => {
            if (result && result.success) {
                tab.isModified = false;
                if (tab.isEditing) {
                  tab.originalContent = tab.content;
                }
                updateTabUI(tab.id);
            }
        });
    }
  }, 1000);
}

// Hook Auto-Save into Editor
editor.addEventListener('input', triggerAutoSave);

// Per-tab EasyMDE initializer. Creates the EasyMDE instance for the active
// tab if it doesn't already exist, attaches all listeners, and assigns it to
// `tab.easyMDE` AND the global `easyMDE`. Idempotent — calling twice on the
// same tab is a no-op (which is what preserves undo across mode toggles).
initRichEditor = function() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  // Already created for this tab — just point the global ref at it
  if (tab.easyMDE) {
    easyMDE = tab.easyMDE;
    return;
  }
  // Need a textarea to wrap
  const ta = ensureTabEditor(tab);

  const instance = new EasyMDE({
    element: ta,
    autoDownloadFontAwesome: false,
    spellChecker: false,
    status: false,
    toolbar: ['bold', 'italic', 'heading', '|', 'quote', 'code', 'unordered-list', 'ordered-list', '|', 'link', 'image', 'table', '|', 'preview', 'side-by-side', 'fullscreen', '|', 'guide'],
    styleSelectedText: true,
    minHeight: "100%",
    maxHeight: "100%",
    previewRender: (plainText) => marked.parse(plainText)
  });

  // Cmd/Ctrl+click links inside editor (Obsidian-style)
  const cm = instance.codemirror;
  cm.on('mousedown', (cmInstance, e) => {
    if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return;
    const pos = cmInstance.coordsChar({ left: e.clientX, top: e.clientY }, 'window');
    const lineText = cmInstance.getLine(pos.line);
    const href = extractMarkdownLinkAt(lineText, pos.ch);
    if (!href) return;
    e.preventDefault();
    e.stopPropagation();
    openLinkFromEditor(href, e);
  });

  cm.on('change', (cmInstance, change) => {
    if (change && change.origin === 'setValue') return;
    const t = tabs.find(tt => tt.id === activeTabId);
    if (t && t.isEditing) {
      if (!t.isModified) {
        t.isModified = true;
        updateTabUI(activeTabId);
        document.title = `${t.fileName} * - OpenMarkdownReader`;
      }
      updateDocumentWordCount(t);
      triggerAutoSave();
    }
  });

  tab.easyMDE = instance;
  easyMDE = instance;
  updateRichToolbarUI();
};

// Per-tab "leave rich mode" — sync content back to the textarea, hide the
// EasyMDE wrapper, show the textarea. We DO NOT call easyMDE.toTextArea()
// because that destroys the CodeMirror instance and its undo history.
// Toggling back to rich mode reuses the same instance, preserving undo.
//
// Note: switching tabs while in different modes is handled by setActiveEditor,
// which calls this only indirectly via showEditor/setActiveEditor logic.
function leaveRichMode() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab || !tab.easyMDE) return;
  // Sync content from CodeMirror back to the underlying textarea so plain mode
  // sees the latest text.
  try {
    tab.editorEl.value = tab.easyMDE.value();
  } catch {}
  // Hide the EasyMDE wrapper
  const wrapper = tab.editorEl.closest('.EasyMDEContainer');
  if (wrapper) wrapper.style.display = 'none';
  // Show the bare textarea — but we need to MOVE it out of the EasyMDE wrapper
  // first because EasyMDE put it inside. Re-parent to the editor host so it
  // becomes a sibling of the (now hidden) wrapper.
  if (tab.editorEl.parentNode !== editorContainer) {
    editorContainer.appendChild(tab.editorEl);
  }
  tab.editorEl.style.display = '';
  easyMDE = null;
}

// Per-tab "enter rich mode" — moves the textarea back inside its EasyMDE
// wrapper (creating the wrapper on first call), hides the bare textarea, and
// shows the wrapper. Sync content from textarea → CodeMirror.
function enterRichMode() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  if (!tab.easyMDE) {
    // First time — create the EasyMDE instance.
    initRichEditor();
    return;
  }
  // Reusing existing instance: move textarea back into wrapper, sync content
  const wrapper = tab.editorEl.closest('.EasyMDEContainer');
  if (wrapper) {
    if (tab.editorEl.parentNode !== wrapper) {
      // Find the original location inside the wrapper (EasyMDE wraps with
      // a textarea inside; on re-parent we just append to wrapper)
      wrapper.appendChild(tab.editorEl);
    }
    wrapper.style.display = '';
  }
  // Sync the content the user may have typed in plain mode back into CM
  // (This DOES reset CM history — acceptable since user was editing plain)
  try {
    if (tab.easyMDE.value() !== tab.editorEl.value) {
      tab.easyMDE.value(tab.editorEl.value);
    }
  } catch {}
  easyMDE = tab.easyMDE;
  setTimeout(() => {
    if (tab.easyMDE) {
      tab.easyMDE.codemirror.refresh();
      tab.easyMDE.codemirror.focus();
    }
  }, 10);
}

window.electronAPI.onSetAutoSave((enabled) => {
  settings.autoSave = enabled;
  if (!enabled) clearTimeout(autoSaveTimer);

  // Show/hide the auto-save indicator
  const autosaveIndicator = document.getElementById('autosave-indicator');
  if (autosaveIndicator) {
    autosaveIndicator.classList.toggle('hidden', !enabled);
  }
});

// Recent Palette Logic
const originalShowCommandPalette = showCommandPalette;
showCommandPalette = function() {
    commandPaletteMode = 'files';
    originalShowCommandPalette();
    commandPaletteInput.placeholder = 'Search files...';
};

const originalUpdateCommandPaletteResults = updateCommandPaletteResults;
updateCommandPaletteResults = function() {
    if (commandPaletteMode === 'recent') {
        updateCommandPaletteResultsForRecent();
    } else {
        originalUpdateCommandPaletteResults();
    }
};

function showRecentPalette() {
  commandPaletteMode = 'recent';
  commandPalette.classList.remove('hidden');
  commandPaletteInput.value = '';
  commandPaletteInput.focus();
  commandPaletteInput.placeholder = 'Select a recent file or folder...';
  commandPaletteSelectedIndex = 0;

  commandPaletteResults.innerHTML = '<div class="command-palette-empty">Loading recent...</div>';
  
  window.electronAPI.getRecentFiles().then(recentFiles => {
      commandPaletteFiles = recentFiles.map(f => ({
          name: f.path.split('/').pop(),
          path: f.path,
          type: f.type,
          isRecent: true
      }));
      updateCommandPaletteResultsForRecent();
  }).catch(console.error);
}

function updateCommandPaletteResultsForRecent() {
    const query = commandPaletteInput.value.toLowerCase();
    const items = commandPaletteFiles.filter(f => f.name.toLowerCase().includes(query) || f.path.toLowerCase().includes(query));
    
    if (items.length === 0) {
        commandPaletteResults.innerHTML = '<div class="command-palette-empty">No recent files found</div>';
        return;
    }

    commandPaletteResults.innerHTML = items.map((file, index) => {
        const isSelected = index === commandPaletteSelectedIndex;
        const icon = file.type === 'folder' 
          ? `<svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16"><path d="M1.75 2.5a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25v-8.5a.25.25 0 00-.25-.25H7.5c-.55 0-1.07-.26-1.4-.7l-.9-1.2a.25.25 0 00-.2-.1H1.75z"/></svg>`
          : `<svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16"><path d="M3.75 1.5a.25.25 0 00-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V4.664a.25.25 0 00-.073-.177l-2.914-2.914a.25.25 0 00-.177-.073H3.75zM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v8.586A1.75 1.75 0 0112.25 15h-8.5A1.75 1.75 0 012 13.25V1.75z"/></svg>`;
        
        return `
          <div class="command-palette-item ${isSelected ? 'selected' : ''}" data-index="${index}">
            <div class="command-palette-item-icon">${icon}</div>
            <div class="command-palette-item-info">
              <div class="command-palette-item-name">${escapeHtml(file.name)}</div>
              <div class="command-palette-item-path">${escapeHtml(file.path.replace(/^\/Users\/[^/]+/, '~'))}</div>
            </div>
          </div>
        `;
    }).join('');

    // Re-attach click handlers
    commandPaletteResults.querySelectorAll('.command-palette-item').forEach((el, index) => {
        el.addEventListener('click', () => {
            selectCommandPaletteItem(index);
        });
        el.addEventListener('mouseenter', () => {
            if (lastInputSource === 'mouse') {
                commandPaletteSelectedIndex = index;
                updateSelectedItem();
            }
        });
    });
    
    updateSelectedItem();
}

// Override selectCommandPaletteItem to handle folders in recent mode
const originalSelectCommandPaletteItem = selectCommandPaletteItem;
selectCommandPaletteItem = function(index, event = null) {
    if (commandPaletteMode === 'recent') {
         if (index >= 0 && index < commandPaletteFiles.length) {
            const item = commandPaletteFiles[index];
            hideCommandPalette();
            
            if (item.isCommand && item.action) {
                item.action();
                return;
            }
            
            // openFileByPath now handles both files and directories
            window.electronAPI.openFileByPath(item.path);
         }
    } else {
        originalSelectCommandPaletteItem(index, event);
    }
}

window.electronAPI.onShowRecentPalette(showRecentPalette);

// ==========================================
// GLOBAL SEARCH (Cmd+Shift+F)
// ==========================================

const globalSearch = document.getElementById('global-search');
const globalSearchInput = document.getElementById('global-search-input');
const globalSearchStatus = document.getElementById('global-search-status');
const globalSearchResults = document.getElementById('global-search-results');
let globalSearchSelectedIndex = 0;
let globalSearchMatches = []; // Flat list of all matches for keyboard nav

function showGlobalSearch() {
  if (!currentDirectory) {
    showToast('Open a folder first to search across files', 'warning');
    return;
  }
  globalSearch.classList.remove('hidden');
  globalSearchInput.value = '';
  globalSearchInput.focus();
  globalSearchStatus.classList.add('hidden');
  globalSearchResults.innerHTML = '<div class="global-search-empty">Type to search across all files in the folder</div>';
  globalSearchSelectedIndex = 0;
  globalSearchMatches = [];
}

function hideGlobalSearch() {
  globalSearch.classList.add('hidden');
  globalSearchInput.value = '';
  globalSearchMatches = [];
}

async function performGlobalSearch(query) {
  if (!query.trim()) {
    globalSearchResults.innerHTML = '<div class="global-search-empty">Type to search across all files in the folder</div>';
    globalSearchStatus.classList.add('hidden');
    globalSearchMatches = [];
    return;
  }

  globalSearchStatus.textContent = 'Searching...';
  globalSearchStatus.classList.remove('hidden');
  globalSearchResults.innerHTML = '';

  try {
    const result = await window.electronAPI.searchInFiles(currentDirectory, query.trim());

    if (result.results.length === 0) {
      globalSearchResults.innerHTML = '<div class="global-search-empty">No matches found</div>';
      globalSearchStatus.textContent = '0 results';
      globalSearchMatches = [];
      return;
    }

    // Update status
    const fileCount = result.results.length;
    const matchCount = result.totalMatches;
    const truncatedNote = result.truncated ? ' (showing first 500)' : '';
    globalSearchStatus.textContent = `${matchCount} result${matchCount !== 1 ? 's' : ''} in ${fileCount} file${fileCount !== 1 ? 's' : ''}${truncatedNote}`;

    // Build flat list of matches for keyboard navigation
    globalSearchMatches = [];

    // Render results grouped by file
    const html = result.results.map(file => {
      const matchesHtml = file.matches.map(match => {
        const matchId = globalSearchMatches.length;
        globalSearchMatches.push({ filePath: file.filePath, lineNum: match.lineNum });

        // Highlight the match in the content
        const content = escapeHtml(match.content);
        const highlightedContent = highlightMatch(content, escapeHtml(query.trim()));

        return `
          <div class="global-search-match" data-match-id="${matchId}" data-file="${escapeHtml(file.filePath)}" data-line="${match.lineNum}">
            <span class="global-search-line-num">${match.lineNum}</span>
            <span class="global-search-line-content">${highlightedContent}</span>
          </div>
        `;
      }).join('');

      return `
        <div class="global-search-file">
          <div class="global-search-file-header" data-file="${escapeHtml(file.filePath)}">
            <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
              <path d="M3.75 1.5a.25.25 0 00-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V6H9.75A1.75 1.75 0 018 4.25V1.5H3.75zm5.75.56v2.19c0 .138.112.25.25.25h2.19L9.5 2.06zM2 1.75C2 .784 2.784 0 3.75 0h5.086c.464 0 .909.184 1.237.513l3.414 3.414c.329.328.513.773.513 1.237v8.086A1.75 1.75 0 0112.25 15h-8.5A1.75 1.75 0 012 13.25V1.75z"/>
            </svg>
            <span class="global-search-file-path">${escapeHtml(file.relativePath)}</span>
            <span class="global-search-file-count">${file.matches.length}</span>
          </div>
          ${matchesHtml}
        </div>
      `;
    }).join('');

    globalSearchResults.innerHTML = html;
    globalSearchSelectedIndex = 0;
    updateGlobalSearchSelection();

    // Add click handlers
    globalSearchResults.querySelectorAll('.global-search-match').forEach(el => {
      el.addEventListener('click', () => {
        const filePath = el.dataset.file;
        const lineNum = parseInt(el.dataset.line, 10);
        openSearchResult(filePath, lineNum);
      });
    });

    globalSearchResults.querySelectorAll('.global-search-file-header').forEach(el => {
      el.addEventListener('click', () => {
        const filePath = el.dataset.file;
        openSearchResult(filePath, 1);
      });
    });

  } catch (err) {
    console.error('Search error:', err);
    globalSearchResults.innerHTML = `<div class="global-search-empty">Search failed: ${escapeHtml(err.message)}</div>`;
    globalSearchStatus.textContent = 'Error';
  }
}

function highlightMatch(content, query) {
  // Case-insensitive highlight
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return content.replace(regex, '<mark>$1</mark>');
}

function updateGlobalSearchSelection() {
  globalSearchResults.querySelectorAll('.global-search-match').forEach((el, i) => {
    el.classList.toggle('selected', i === globalSearchSelectedIndex);
  });

  // Scroll selected item into view
  const selected = globalSearchResults.querySelector('.global-search-match.selected');
  if (selected) {
    selected.scrollIntoView({ block: 'nearest' });
  }
}

function openSearchResult(filePath, lineNum) {
  hideGlobalSearch();
  // Open file and scroll to line
  window.electronAPI.openFileByPath(filePath, { reuseTab: activeTabId });
  // TODO: scroll to line after file loads
}

// Event handlers
globalSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideGlobalSearch();
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    if (globalSearchMatches.length > 0 && globalSearchSelectedIndex < globalSearchMatches.length) {
      const match = globalSearchMatches[globalSearchSelectedIndex];
      openSearchResult(match.filePath, match.lineNum);
    } else {
      performGlobalSearch(globalSearchInput.value);
    }
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (globalSearchMatches.length > 0) {
      globalSearchSelectedIndex = Math.min(globalSearchSelectedIndex + 1, globalSearchMatches.length - 1);
      updateGlobalSearchSelection();
    }
    return;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (globalSearchMatches.length > 0) {
      globalSearchSelectedIndex = Math.max(globalSearchSelectedIndex - 1, 0);
      updateGlobalSearchSelection();
    }
    return;
  }
});

// Debounce search as user types
let globalSearchDebounce = null;
globalSearchInput.addEventListener('input', () => {
  clearTimeout(globalSearchDebounce);
  globalSearchDebounce = setTimeout(() => {
    performGlobalSearch(globalSearchInput.value);
  }, 300);
});

// Click outside to close
globalSearch.querySelector('.global-search-backdrop').addEventListener('click', hideGlobalSearch);

// Listen for menu command
window.electronAPI.onShowGlobalSearch(showGlobalSearch);

// Keyboard shortcut (Cmd+Shift+F)
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    showGlobalSearch();
  }
});

// ==========================================
// NAVIGATION HISTORY (Back/Forward)
// ==========================================

// Button click handlers
navBackBtn.addEventListener('click', navGoBack);
navForwardBtn.addEventListener('click', navGoForward);

// Keyboard shortcuts (Cmd+[ and Cmd+])
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey) {
    if (e.key === '[') {
      e.preventDefault();
      navGoBack();
    } else if (e.key === ']') {
      e.preventDefault();
      navGoForward();
    }
  }
});

// Listen for menu commands
window.electronAPI.onNavBack?.(() => navGoBack());
window.electronAPI.onNavForward?.(() => navGoForward());

// Update banner
(function setupUpdateBanner() {
  const banner = document.getElementById('update-banner');
  const bannerText = document.getElementById('update-banner-text');
  const bannerLink = document.getElementById('update-banner-link');
  const bannerDismiss = document.getElementById('update-banner-dismiss');
  if (!banner) return;

  function showUpdate(release) {
    bannerText.textContent = `Update available: v${release.version}`;
    bannerLink.onclick = (e) => {
      e.preventDefault();
      window.electronAPI.openExternal(release.url);
    };
    banner.classList.remove('hidden');
  }

  bannerDismiss.addEventListener('click', () => {
    banner.classList.add('hidden');
  });

  // Listen for push from main process
  window.electronAPI.onUpdateAvailable?.((release) => showUpdate(release));

  // Also poll on load (for windows created after the check ran)
  window.electronAPI.getUpdateInfo?.().then((release) => {
    if (release) showUpdate(release);
  });
})();

// Dev/build badge — always visible. Shape depends on whether this is a
// dev build (unpackaged `npm start`, or packaged via `npm run install-dev`)
// versus a proper release build. Tooltip surfaces the exact build identity
// (version, build number, git hash, build date) so "what's running right now?"
// is always one hover away.
(async () => {
  const info = await window.electronAPI.getBuildInfo?.();
  if (!info) return;
  const badge = document.getElementById('dev-badge');
  if (!badge) return;

  // A build is "dev" if it's unpackaged (npm start) OR if the build script
  // explicitly set channel=dev (install-dev.sh). Release builds leave
  // isDev=false and get the subtle gray pill; dev builds get the loud
  // orange one so it's never ambiguous what you're looking at.
  const isDevBuild = !info.isPackaged || info.isDev === true;

  // Visible label: "DEV v1.0.5 b147" for dev, "v1.0.5 b147" for release.
  // Always include the version so users / bug reporters don't have to
  // hover to find it.
  const versionPart = info.version ? `v${info.version}` : '';
  const buildPart = info.buildNumber ? `b${info.buildNumber}` : '';
  const labelCore = [versionPart, buildPart].filter(Boolean).join(' ');
  if (isDevBuild) {
    badge.textContent = labelCore ? `DEV ${labelCore}` : 'DEV';
    badge.classList.remove('packaged');
  } else {
    badge.textContent = labelCore || 'release';
    badge.classList.add('packaged');
  }

  // Tooltip: full details
  const parts = [];
  if (info.version) {
    const buildSuffix = info.buildNumber ? ` (build ${info.buildNumber})` : '';
    parts.push(`v${info.version}${buildSuffix}`);
  }
  if (info.gitHash && info.gitHash !== 'dev') {
    parts.push(info.gitHash);
  }
  if (info.buildDate) {
    parts.push(info.buildDate);
  }
  if (isDevBuild) {
    const reason = !info.isPackaged ? 'unpackaged' : 'install-dev';
    parts.unshift(`DEV build (${reason})`);
  }
  badge.title = parts.join(' • ');
  badge.classList.remove('hidden');
})();

// Noos widget toggle
function setNoosWidgetVisible(visible) {
  const widgetEl = document.getElementById('noos-feedback-widget');
  if (widgetEl) {
    widgetEl.style.display = visible ? '' : 'none';
  }
  // Defensive: NoosFeedback may not be fully initialized when this fires (race
  // between this setting handler and the deferred widget script). Only call
  // close() if it's actually a function on the global object.
  if (!visible && window.NoosFeedback && typeof window.NoosFeedback.close === 'function') {
    try {
      window.NoosFeedback.close();
    } catch (err) {
      console.warn('NoosFeedback.close() failed:', err);
    }
  }
}

window.electronAPI.onSettingChanged?.((data) => {
  if (data.key === 'noos-widget') {
    setNoosWidgetVisible(data.value);
  }
});

// ─── Agent Control Handlers ───────────────────────────────────────────
// Respond to state queries and commands from the agent server (Unix socket)

window.electronAPI.onGetAppState?.(() => {
  const editor = document.getElementById('editor');
  const activeTab = tabs.find(t => t.id === activeTabId);
  const state = {
    tabs: tabs.map((t, i) => ({
      id: t.id,
      index: i,
      filePath: t.filePath || null,
      fileName: t.fileName || 'Untitled',
      isActive: t.id === activeTabId,
      isModified: !!t.isModified,
      isEditing: !!t.isEditing,
      scrollPos: t.scrollPos || 0
    })),
    activeTabId,
    activeTabIndex: tabs.findIndex(t => t.id === activeTabId),
    mode: activeTab ? (activeTab.isEditing ? 'edit' : 'read') : null,
    settings: { ...settings },
    sidebar: {
      visible: settings.sidebarVisible,
      directory: currentDirectory,
      width: settings.sidebarWidth,
      viewMode: settings.sidebarViewMode,
      sortMode: settings.sidebarSortMode
    },
    navigation: {
      historyLength: navHistory.length,
      historyIndex: navHistoryIndex,
      canGoBack: navHistoryIndex > 0,
      canGoForward: navHistoryIndex < navHistory.length - 1
    },
    tabCount: tabs.length,
    unsavedCount: tabs.filter(t => t.isModified).length
  };
  window.electronAPI.reportAppState(state);
});

window.electronAPI.onGetTabContent?.((tabId) => {
  // If tabId is a string path, find by path; if number, find by id
  let tab;
  if (typeof tabId === 'string') {
    tab = tabs.find(t => t.filePath === tabId);
  } else {
    tab = tabs.find(t => t.id === tabId);
  }
  if (!tab) {
    window.electronAPI.reportTabContent({ error: 'Tab not found', tabId });
    return;
  }
  // For an active editing tab, use editor value
  const editor = document.getElementById('editor');
  let content = tab.content || '';
  if (tab.id === activeTabId && tab.isEditing && editor) {
    content = editor.value;
  }
  window.electronAPI.reportTabContent({
    tabId: tab.id,
    filePath: tab.filePath,
    fileName: tab.fileName,
    content,
    isModified: !!tab.isModified,
    isEditing: !!tab.isEditing
  });
});

window.electronAPI.onAgentCommand?.((cmd) => {
  try {
    let result = { ok: true };
    switch (cmd.action) {
      case 'switch-tab': {
        const target = cmd.tab;
        let tab;
        if (typeof target === 'number') {
          tab = tabs[target];
        } else if (typeof target === 'string') {
          tab = tabs.find(t => t.filePath === target) || tabs.find(t => t.fileName === target);
        }
        if (tab) {
          switchToTab(tab.id);
        } else {
          result = { error: `Tab not found: ${target}` };
        }
        break;
      }
      case 'close-tab': {
        const target = cmd.tab;
        let tab;
        if (target === undefined || target === null) {
          tab = tabs.find(t => t.id === activeTabId);
        } else if (typeof target === 'number') {
          tab = tabs[target];
        } else {
          tab = tabs.find(t => t.filePath === target);
        }
        if (tab) {
          closeTab(tab.id);
        } else {
          result = { error: `Tab not found: ${target}` };
        }
        break;
      }
      case 'save':
        saveFile();
        break;
      case 'save-all':
        saveAllFiles();
        break;
      case 'toggle-edit':
        toggleEditMode();
        break;
      case 'toggle-sidebar':
        setSidebarVisibility(!settings.sidebarVisible);
        break;
      case 'set-sidebar': {
        setSidebarVisibility(!!cmd.visible);
        break;
      }
      case 'nav-back':
        if (typeof navigateBack === 'function') navigateBack();
        break;
      case 'nav-forward':
        if (typeof navigateForward === 'function') navigateForward();
        break;
      case 'scroll-to': {
        if (cmd.line) {
          // Scroll to approximate line position
          const lineHeight = 24;
          window.scrollTo({ top: (cmd.line - 1) * lineHeight, behavior: 'smooth' });
        } else if (cmd.top !== undefined) {
          window.scrollTo({ top: cmd.top, behavior: 'smooth' });
        }
        break;
      }
      case 'set-content': {
        const activeT = tabs.find(t => t.id === activeTabId);
        if (activeT && activeT.isEditing) {
          // Use per-tab editor (textarea or EasyMDE) — see editor-per-tab refactor
          if (activeT.easyMDE) {
            activeT.easyMDE.value(cmd.content);
            activeT.isModified = true;
            updateTabUI(activeT.id);
          } else if (activeT.editorEl) {
            activeT.editorEl.value = cmd.content;
            activeT.editorEl.dispatchEvent(new Event('input'));
          }
          result.set = true;
        } else {
          result = { error: 'No active editing tab' };
        }
        break;
      }
      case 'insert': {
        const activeT = tabs.find(t => t.id === activeTabId);
        if (activeT && activeT.isEditing && activeT.editorEl) {
          const editorEl = activeT.editorEl;
          if (activeT.easyMDE) {
            // Use CodeMirror's replaceSelection so undo history is preserved
            activeT.easyMDE.codemirror.replaceSelection(cmd.text);
            result.insertedAt = activeT.easyMDE.codemirror.indexFromPos(activeT.easyMDE.codemirror.getCursor());
          } else {
            const pos = cmd.position === 'end' ? editorEl.value.length :
                        cmd.position === 'start' ? 0 :
                        typeof cmd.position === 'number' ? cmd.position :
                        editorEl.selectionStart;
            const before = editorEl.value.slice(0, pos);
            const after = editorEl.value.slice(pos);
            editorEl.value = before + cmd.text + after;
            editorEl.selectionStart = editorEl.selectionEnd = pos + cmd.text.length;
            editorEl.dispatchEvent(new Event('input'));
            result.insertedAt = pos;
          }
        } else {
          result = { error: 'No active editing tab' };
        }
        break;
      }
      case '_debug-editor-state': {
        // Internal debug command — verifies the per-tab editor structure
        result.tabs = tabs.map(t => {
          // Live value: from CodeMirror if rich, from textarea if plain
          let liveValue = null;
          if (t.easyMDE) {
            try { liveValue = t.easyMDE.value().slice(0, 80); } catch {}
          } else if (t.editorEl) {
            liveValue = t.editorEl.value.slice(0, 80);
          }
          // Whether the editor wrapper (textarea or EasyMDEContainer) is visible
          let wrapperVisible = null;
          if (t.editorEl) {
            const wrapper = t.easyMDE
              ? t.editorEl.closest('.EasyMDEContainer') || t.editorEl
              : t.editorEl;
            wrapperVisible = wrapper.style.display !== 'none';
          }
          return {
            id: t.id,
            fileName: t.fileName,
            isEditing: t.isEditing,
            isActive: t.id === activeTabId,
            isModified: t.isModified,
            hasEditorEl: !!t.editorEl,
            hasEasyMDE: !!t.easyMDE,
            editorElInDom: !!(t.editorEl && document.contains(t.editorEl)),
            liveValue,
            tabContent: t.content ? t.content.slice(0, 80) : null,
            wrapperVisible
          };
        });
        result.globalEditorTagName = editor ? editor.tagName : null;
        result.globalEditorIsFallback = editor === fallbackEditor;
        break;
      }
      case 'find': {
        // Open find bar and optionally set the query
        if (typeof openFindBar === 'function') {
          openFindBar();
        }
        if (cmd.query) {
          const findInput = document.getElementById('find-input');
          if (findInput) {
            findInput.value = cmd.query;
            findInput.dispatchEvent(new Event('input'));
          }
        }
        break;
      }
      default:
        result = { error: `Unknown renderer action: ${cmd.action}` };
    }
    window.electronAPI.reportAgentCommandResult(result);
  } catch (err) {
    window.electronAPI.reportAgentCommandResult({ error: err.message });
  }
});
