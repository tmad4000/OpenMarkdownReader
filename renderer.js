// marked and hljs are loaded from CDN in index.html

// Settings
let settings = {
  readOnlyMode: false,
  sidebarVisible: false,
  contentWidth: 900,
  contentPadding: 20,
  editorMonospace: false,
  watchFileMode: false,
  tocVisible: false,
  csvViewAsTable: true, // Default to showing CSV as table
  richEditorMode: true, // Default to Rich
  richToolbarVisible: false // Default toolbar closed
};

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
  '.csv', '.tsv', '.json', '.xml', '.yaml', '.yml', '.toml',
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
// Command palette file cache (prefetched per directory)
let allFilesCache = null;
let allFilesCachePromise = null;

// Wiki link index: maps page names (lowercase, without .md) to file paths
let wikiLinkIndex = new Map();
let wikiLinkConflicts = new Set(); // Page names with multiple matches

// Build wiki link index from allFilesCache
function buildWikiLinkIndex() {
  wikiLinkIndex.clear();
  wikiLinkConflicts.clear();

  if (!allFilesCache || !currentDirectory) return;

  // Index all markdown files by their base name (without extension)
  allFilesCache.forEach(file => {
    if (!file.isMarkdown) return;

    // Get the base name without .md extension
    const baseName = file.name.replace(/\.md$/i, '').toLowerCase();

    if (wikiLinkIndex.has(baseName)) {
      // Conflict: multiple files with the same base name
      wikiLinkConflicts.add(baseName);
    } else {
      wikiLinkIndex.set(baseName, file.path);
    }
  });

  // Log conflicts if any
  if (wikiLinkConflicts.size > 0) {
    console.log('Wiki link conflicts detected:', Array.from(wikiLinkConflicts));
  }
}

// Process wiki links in markdown content: [[page]] or [[page|display text]]
function processWikiLinks(markdown) {
  if (!currentDirectory || wikiLinkIndex.size === 0) {
    return markdown;
  }

  const shownConflictWarnings = new Set();

  // Match [[page]] or [[page|alias]]
  const wikiLinkPattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

  return markdown.replace(wikiLinkPattern, (match, pageName, displayText) => {
    const lookupName = pageName.trim().toLowerCase();
    const display = displayText ? displayText.trim() : pageName.trim();

    // Check if this page exists in our index
    const targetPath = wikiLinkIndex.get(lookupName);

    if (targetPath) {
      // Show conflict warning once per page
      if (wikiLinkConflicts.has(lookupName) && !shownConflictWarnings.has(lookupName)) {
        shownConflictWarnings.add(lookupName);
        showToast(`Multiple files match "${pageName}" - using first match`, 'warning', 5000);
      }

      // Convert to a regular markdown link with the full path
      return `[${display}](${targetPath})`;
    }

    // Page not found - return as a broken link with special styling
    return `<span class="wiki-link-broken" title="Page not found: ${escapeHtml(pageName)}">${escapeHtml(display)}</span>`;
  });
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
    if (titleEl) titleEl.textContent = fileName;
    tabEl.title = filePath || fileName;
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
const sidebarToggle = document.getElementById('sidebar-toggle');
const navBackBtn = document.getElementById('nav-back-btn');
const navForwardBtn = document.getElementById('nav-forward-btn');
const openFolderBtn = document.getElementById('open-folder-btn');
const sidebarNewFileBtn = document.getElementById('sidebar-new-file-btn');
const sidebarNewFolderBtn = document.getElementById('sidebar-new-folder-btn');
const sidebarPath = document.getElementById('sidebar-path');
const sidebarPathText = document.getElementById('sidebar-path-text');
const fileTree = document.getElementById('file-tree');
const editorContainer = document.getElementById('editor-container');
const editor = document.getElementById('editor');
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
    publishedUrl: null  // URL if published to globalbr.ai
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
        } else {
          alert(`Could not rename file: ${result.error}`);
        }
      } else {
        // Just update the tab name for unsaved files
        tab.fileName = newName;
        titleEl.textContent = newName;
        tabEl.title = newName;
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
    document.title = `${tab.fileName}${tab.isModified ? ' *' : ''} - OpenMarkdownReader`;
    setTimeout(() => window.scrollTo(0, tab.scrollPos), 0);
  } else {
    // Show welcome screen
    hideEditor();
    hideCSVView();
    dropZone.classList.remove('hidden');
    content.classList.add('hidden');
    document.title = 'OpenMarkdownReader';
  }

  // Add to navigation history
  if (tab) {
    pushNavHistory(tabId, tab.filePath);
  }

  updateTabUI(tabId);
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

function showEditor(content) {
  editor.value = content;
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

// Editor change handler
editor.addEventListener('input', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.isEditing) {
    tab.isModified = true;
    updateTabUI(activeTabId);
    document.title = `${tab.fileName} * - OpenMarkdownReader`;
  }
});

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
  document.title = `${tab.fileName} - OpenMarkdownReader`;

  if (settings.watchFileMode) {
    window.electronAPI.watchFile(tab.filePath);
  }
}

// Sidebar toggle
sidebarToggle.addEventListener('click', () => {
  settings.sidebarVisible = !settings.sidebarVisible;
  sidebar.classList.toggle('hidden', !settings.sidebarVisible);
  sidebarToggle.classList.toggle('active', settings.sidebarVisible);
});

// Open folder
openFolderBtn.addEventListener('click', () => {
  window.electronAPI.openFolder();
});

// Update sidebar path display
function updateSidebarPath(dirPath) {
  if (!dirPath) {
    sidebarPath.classList.add('hidden');
    return;
  }

  // Show the path, with home directory abbreviated
  const homePath = dirPath.replace(/^\/Users\/[^/]+/, '~');
  const folderName = dirPath.split('/').pop();

  sidebarPathText.textContent = folderName;
  sidebarPathText.title = dirPath; // Full path on hover
  sidebarPath.classList.remove('hidden');
}

// Click on path to reveal in Finder
sidebarPathText.addEventListener('click', () => {
  if (currentDirectory) {
    window.electronAPI.revealInFinder(currentDirectory);
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
sidebarNewFileBtn.addEventListener('click', () => {
  if (currentDirectory) {
    // Create file in directory with editable name
    createNewFileInDirectory(currentDirectory);
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
function createNewFileInDirectory(dirPath) {
  // Generate a unique default name
  let defaultName = 'Untitled.md';
  let counter = 1;
  const existingNames = new Set();

  // Collect existing file names in root directory
  for (const item of directoryFiles) {
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
    isMarkdown: true,
    isTextFile: true
  };

  // Add to beginning of directoryFiles temporarily
  directoryFiles.unshift(tempItem);

  // Re-render the file tree
  renderFileTree();

  // Find the new file element and start editing
  const newFileEl = fileTree.querySelector('.file-tree-file.new-file');
  if (newFileEl) {
    // Scroll into view
    newFileEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Start inline editing
    startNewFileRename(newFileEl, tempItem, dirPath, defaultName);
  }
}

// Listen for directory loaded
window.electronAPI.onDirectoryLoaded((data) => {
  currentDirectory = data.dirPath;
  directoryFiles = data.files;

  // Update sidebar path display
  updateSidebarPath(currentDirectory);

  // Pre-fetch all files for command palette and wiki links
  allFilesCache = null;
  wikiLinkIndex.clear();
  allFilesCachePromise = window.electronAPI.getAllFilesRecursive(currentDirectory)
    .then(files => {
      allFilesCache = files;
      // Build wiki link index for [[page]] links
      buildWikiLinkIndex();
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

  renderFileTree();

  // Show sidebar if hidden
  if (!settings.sidebarVisible) {
    settings.sidebarVisible = true;
    sidebar.classList.remove('hidden');
    sidebarToggle.classList.add('active');
  }
});

// Track expanded folders
const expandedFolders = new Set();

function renderFileTree() {
  fileTree.innerHTML = '';

  if (!directoryFiles.length) {
    fileTree.innerHTML = '<div class="file-tree-item file-tree-empty">No files</div>';
    return;
  }

  renderFileTreeItems(directoryFiles, fileTree, 0);
}

function renderFileTreeItems(items, container, depth) {
  items.forEach(item => {
    const el = document.createElement('div');
    el.style.setProperty('--depth', depth);

    if (item.type === 'folder') {
      const isExpanded = expandedFolders.has(item.path);
      el.className = `file-tree-item file-tree-folder ${isExpanded ? 'expanded' : ''}${item.isNew ? ' new-folder' : ''}`;
      el.innerHTML = `
        <svg class="folder-chevron" viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
          <path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z"/>
        </svg>
        <svg class="folder-icon" viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path d="M1.75 2.5a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25v-8.5a.25.25 0 00-.25-.25H7.5c-.55 0-1.07-.26-1.4-.7l-.9-1.2a.25.25 0 00-.2-.1H1.75z"/>
        </svg>
        <span>${escapeHtml(item.name)}</span>
      `;
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        await toggleFolder(item.path, el);
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
      el.innerHTML = `
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path d="M3.75 1.5a.25.25 0 00-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V4.664a.25.25 0 00-.073-.177l-2.914-2.914a.25.25 0 00-.177-.073H3.75zM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v8.586A1.75 1.75 0 0112.25 15h-8.5A1.75 1.75 0 012 13.25V1.75z"/>
        </svg>
        <span>${escapeHtml(item.name)}</span>
      `;
      // All files are clickable, non-text just shown with muted style
      if (!item.isNew) {
        el.addEventListener('click', (e) => {
          // Cmd+click = new tab in background, Cmd+Shift+click = new tab and focus
          const options = {};
          if (e.metaKey) {
            options.newTab = true;
            options.background = !e.shiftKey; // Cmd+click = background, Cmd+Shift+click = focus
          }
          window.electronAPI.openFileByPath(item.path, options);
        });
        // Double-click to rename
        el.querySelector('span').addEventListener('dblclick', (e) => {
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
}

function findItemByPath(items, targetPath) {
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
  const span = el.querySelector('span');
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
      newSpan.textContent = oldName;
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
      newSpan.textContent = newName;
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
      newSpan.textContent = oldName;
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
function startNewFileRename(el, tempItem, dirPath, defaultName) {
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
      const idx = directoryFiles.indexOf(tempItem);
      if (idx !== -1) directoryFiles.splice(idx, 1);
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

      // Re-render the file tree to reflect actual state
      renderFileTree();

      // Open the file in a new tab in edit mode
      window.electronAPI.openFileByPath(result.filePath);
    } else {
      // Show error and remove temp item
      alert(`Could not create file: ${result.error}`);
      const idx = directoryFiles.indexOf(tempItem);
      if (idx !== -1) directoryFiles.splice(idx, 1);
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
    showToast('Failed to publish: ' + err.message, 'error');
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
      window.electronAPI.watchFile(data.filePath);
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
      window.electronAPI.watchFile(data.filePath);
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
      window.electronAPI.watchFile(data.filePath);
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

// Listen for refresh file (Cmd+R)
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
      window.electronAPI.watchFile(tab.filePath);
    } else {
      window.electronAPI.unwatchFile(tab.filePath);
    }
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

marked.setOptions({
  renderer: markedRenderer,
  gfm: true,
  breaks: false
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
    fallbackHeadingSlugCounts = new Map();

    // Process wiki links [[page]] -> [page](path) before parsing
    const processedContent = processWikiLinks(mdContent);
    const html = marked.parse(processedContent);
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

// Render content based on file type
function renderContent(content, filename) {
  const tab = tabs.find(t => t.id === activeTabId);

  // Check if it's a CSV/TSV file and should show as table
  if (isCsvFile(filename) && settings.csvViewAsTable) {
    dropZone.classList.add('hidden');
    document.getElementById('content').classList.remove('hidden');
    showCSVView(content, filename);
    // Clear TOC for CSV
    tocContent.innerHTML = '<div class="toc-empty">CSV files have no headings</div>';
    return;
  }

  // Check if it's a markdown file - render as markdown
  if (isMarkdownFile(filename)) {
    renderMarkdown(content);
    return;
  }

  // For other text files, show as syntax-highlighted code block
  hideCSVView();
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

  // Cmd+S to save
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    saveFile();
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

  // Escape handling: close overlays first, then revert edits if in edit mode
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
      revertChanges();
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
          allFilesCache = files;
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

  // Build list of searchable items: folder files + open tabs + commands
  let allItems = [];

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
      if (item.isCommand) return item.name.toLowerCase().includes(searchText);
      return item.name.toLowerCase().includes(searchText) || (item.path && item.path.toLowerCase().includes(searchText));
    });
  } else if (isCommandQuery) {
    filteredItems = allItems.filter(item => item.isCommand);
  }

  // Sort: Commands first if query starts with >, otherwise open tabs first
  filteredItems.sort((a, b) => {
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
    const icon = item.isCommand ? (item.icon || '⌘') : (item.isOpenTab ? '📄' : '📁');
    const pathDir = item.isCommand ? (item.description || 'Command') : (item.path ? item.path.substring(0, item.path.lastIndexOf(path.sep)) : '');
    const isOpenBadge = item.isOpenTab ? '<span class="command-palette-badge">Open</span>' : '';
    const isCommandBadge = item.isCommand ? '<span class="command-palette-badge" style="background: var(--accent-color); color: white;">Command</span>' : '';

    return `
      <div class="command-palette-item ${isSelected ? 'selected' : ''}" data-index="${index}">
        <div class="command-palette-item-icon">${icon}</div>
        <div class="command-palette-item-info">
          <div class="command-palette-item-name">
            ${escapeHtml(item.name)} ${isOpenBadge} ${isCommandBadge}
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

function updateSelectedItem() {
  commandPaletteResults.querySelectorAll('.command-palette-item').forEach((el, index) => {
    el.classList.toggle('selected', index === commandPaletteSelectedIndex);
  });

  // Scroll selected item into view
  const selectedEl = commandPaletteResults.querySelector('.command-palette-item.selected');
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: 'nearest' });
  }
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
  settings.sidebarVisible = shouldShowSidebar;
  sidebar.classList.toggle('hidden', !shouldShowSidebar);
  sidebarToggle.classList.toggle('active', shouldShowSidebar);

  if (typeof data.richToolbarVisible === 'boolean') {
    settings.richToolbarVisible = data.richToolbarVisible;
  }
  updateRichToolbarUI();

  // Restore directory/sidebar
  if (data.directory) {
    currentDirectory = data.directory;
    window.electronAPI.getDirectoryContents(data.directory).then(files => {
      directoryFiles = files;
      buildFileTree(files, data.directory);
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

function updateFindResults() {
  if (!findState.isOpen) return;
  
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
    searchInEditor(query);
  } else {
    searchInPreview(query);
  }
  
  updateFindCountUI();
}

function searchInEditor(query) {
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
    jumpToMatch(0);
  }
}

function searchInPreview(query) {
  if (!markdownBody) return;
  
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
    findState.currentIndex = 0;
    jumpToMatch(0);
  }
}

function jumpToMatch(index) {
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

      cm.focus();
      cm.setSelection(from, to);
      cm.scrollIntoView({ from, to }, 100);
    } else {
      editor.focus();
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
  updateFindResults();
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
  if (m) return m[1];

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

function initRichEditor() {
  if (easyMDE) return;
  
  easyMDE = new EasyMDE({
    element: editor,
	    autoDownloadFontAwesome: false,
    spellChecker: false,
    status: false, // Hide status bar
    toolbar: ['bold', 'italic', 'heading', '|', 'quote', 'code', 'unordered-list', 'ordered-list', '|', 'link', 'image', 'table', '|', 'preview', 'side-by-side', 'fullscreen', '|', 'guide'],
    styleSelectedText: true,
    minHeight: "100%",
    maxHeight: "100%"
  });
  
  // Change handler to update tab status
  easyMDE.codemirror.on('change', (cm, change) => {
    if (change && change.origin === 'setValue') return;
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab && tab.isEditing) {
      if (!tab.isModified) {
        tab.isModified = true;
        updateTabUI(activeTabId);
        document.title = `${tab.fileName} * - OpenMarkdownReader`;
      }
    }
  });
}

function destroyRichEditor() {
  if (easyMDE) {
    easyMDE.toTextArea();
    easyMDE = null;
  }
}

// Toggle Rich/Plain Mode
richModeBtn.addEventListener('click', () => {
  settings.richEditorMode = !settings.richEditorMode;
  if (settings.richEditorMode) {
    richModeBtn.classList.add('active');
    initRichEditor();
    if (easyMDE) {
      easyMDE.value(editor.value);
      setTimeout(() => {
        if (easyMDE) {
          easyMDE.codemirror.refresh();
          easyMDE.codemirror.focus();
        }
      }, 10);
    }
    if (richToolbarBtn) {
      richToolbarBtn.classList.remove('hidden');
      updateRichToolbarUI();
    }
  } else {
    richModeBtn.classList.remove('active');
    if (easyMDE) editor.value = easyMDE.value();
    destroyRichEditor();
    if (richToolbarBtn) richToolbarBtn.classList.add('hidden');
    editor.focus();
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

showEditor = function(content) {
  editor.value = content;
  editorContainer.classList.remove('hidden');
  markdownBody.classList.add('hidden');
  dropZone.classList.add('hidden');
  document.getElementById('content').classList.remove('hidden');
  editor.focus();

  // Rich Mode Logic
  richModeBtn.classList.remove('hidden');
  
  if (settings.richEditorMode) {
    richModeBtn.classList.add('active');
    initRichEditor();
    if (richToolbarBtn) richToolbarBtn.classList.remove('hidden');
    updateRichToolbarUI();
    if (easyMDE) {
      easyMDE.value(content);
      // Refresh to fix layout issues and focus editor
      setTimeout(() => {
        if (easyMDE) {
          easyMDE.codemirror.refresh();
          easyMDE.codemirror.focus();
        }
      }, 10);
    }
  } else {
    richModeBtn.classList.remove('active');
    if (richToolbarBtn) richToolbarBtn.classList.add('hidden');
    destroyRichEditor();
    editor.focus();
  }
};

hideEditor = function() {
  if (easyMDE) {
    // Sync content back to textarea just in case
    editor.value = easyMDE.value();
  }
  editorContainer.classList.add('hidden');
  markdownBody.classList.remove('hidden');
  richModeBtn.classList.add('hidden');
  if (richToolbarBtn) richToolbarBtn.classList.add('hidden');
};

switchToTab = function(tabId) {
  // Save current tab state
  if (activeTabId !== null) {
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (currentTab) {
      currentTab.scrollPos = window.scrollY;
      if (currentTab.isEditing) {
        // Capture content from EasyMDE if active
        currentTab.content = easyMDE ? easyMDE.value() : editor.value;
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
    document.title = `${tab.fileName}${tab.isModified ? ' *' : ''} - OpenMarkdownReader`;
    setTimeout(() => window.scrollTo(0, tab.scrollPos), 0);
  } else {
    // Show welcome screen
    hideEditor();
    hideCSVView();
    dropZone.classList.remove('hidden');
    content.classList.add('hidden');
    document.title = 'OpenMarkdownReader';
  }

  updateTabUI(tabId);
  
  // Re-run find if open
  if (typeof updateFindResults === 'function' && findState && findState.isOpen) {
     setTimeout(updateFindResults, 50);
  }
};

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
    if (easyMDE) {
      const scrollInfo = easyMDE.codemirror.getScrollInfo();
      scrollPercent = scrollInfo.top / Math.max(1, scrollInfo.height - scrollInfo.clientHeight);
    } else {
      scrollPercent = editor.scrollTop / Math.max(1, editor.scrollHeight - editor.clientHeight);
    }
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
    // Capture content
    tab.content = easyMDE ? easyMDE.value() : editor.value;
    hideEditor();
    renderContent(tab.content, tab.fileName);

    // Restore scroll position in preview after rendering
    setTimeout(() => {
      const targetScroll = scrollPercent * (markdownBody.scrollHeight - markdownBody.clientHeight);
      markdownBody.scrollTop = targetScroll;
    }, 50);
  }

  updateTabUI(activeTabId);
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

// Redefine initRichEditor to add auto-save hook
	initRichEditor = function() {
	  if (easyMDE) return;
	  
	  easyMDE = new EasyMDE({
	    element: editor,
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
	  const cm = easyMDE.codemirror;
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
	  
		  easyMDE.codemirror.on('change', (cmInstance, change) => {
		    if (change && change.origin === 'setValue') return;
		    const tab = tabs.find(t => t.id === activeTabId);
		    if (tab && tab.isEditing) {
		      if (!tab.isModified) {
	        tab.isModified = true;
	        updateTabUI(activeTabId);
	        document.title = `${tab.fileName} * - OpenMarkdownReader`;
	      }
	      triggerAutoSave();
	    }
	  });

		  updateRichToolbarUI();
	};

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
