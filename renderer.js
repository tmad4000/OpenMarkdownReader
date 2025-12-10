// marked and hljs are loaded from CDN in index.html

// Settings
let settings = {
  readOnlyMode: false,
  sidebarVisible: false,
  contentWidth: 900,
  watchFileMode: false
};

// Tab management
let tabs = [];
let activeTabId = null;
let tabIdCounter = 0;

// Directory state
let currentDirectory = null;
let directoryFiles = [];

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

// DOM Elements
const tabBar = document.getElementById('tab-bar');
const newTabBtn = document.getElementById('new-tab-btn');
const dropZone = document.getElementById('drop-zone');
const content = document.getElementById('content');
const markdownBody = document.getElementById('markdown-body');
const openBtn = document.getElementById('open-btn');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const openFolderBtn = document.getElementById('open-folder-btn');
const fileTree = document.getElementById('file-tree');
const editorContainer = document.getElementById('editor-container');
const editor = document.getElementById('editor');
const editToggleBtn = document.getElementById('edit-toggle-btn');
const commandPalette = document.getElementById('command-palette');
const commandPaletteInput = document.getElementById('command-palette-input');
const commandPaletteResults = document.getElementById('command-palette-results');
const saveBtn = document.getElementById('save-btn');

// Create a new tab
function createTab(fileName = 'New Tab', mdContent = null, filePath = null) {
  const tabId = ++tabIdCounter;
  const tab = {
    id: tabId,
    fileName,
    filePath,
    content: mdContent,
    scrollPos: 0,
    isEditing: false,
    isModified: false
  };
  tabs.push(tab);

  // Create tab element
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.tabId = tabId;
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

  switchToTab(tabId);
  return tabId;
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
  if (tab && tab.content) {
    if (tab.isEditing) {
      showEditor(tab.content);
    } else {
      hideEditor();
      renderMarkdown(tab.content);
    }
    document.title = `${tab.fileName}${tab.isModified ? ' *' : ''} - OpenMarkdownReader`;
    setTimeout(() => window.scrollTo(0, tab.scrollPos), 0);
  } else {
    // Show welcome screen
    hideEditor();
    dropZone.classList.remove('hidden');
    content.classList.add('hidden');
    document.title = 'OpenMarkdownReader';
  }

  updateTabUI(tabId);
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
    // Show save button when editing with unsaved changes
    saveBtn.classList.toggle('hidden', !(tab.isEditing && tab.isModified));
  }
}

// Close a tab
function closeTab(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  const tabIndex = tabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return;

  // Check for unsaved changes
  if (tab && tab.isModified) {
    if (!confirm(`"${tab.fileName}" has unsaved changes. Close anyway?`)) {
      return;
    }
  }

  // Stop watching the file if we were watching it
  if (tab && tab.filePath) {
    window.electronAPI.unwatchFile(tab.filePath);
  }

  // Remove tab data
  tabs.splice(tabIndex, 1);

  // Remove tab element
  const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (tabEl) tabEl.remove();

  // If closing active tab, switch to another
  if (activeTabId === tabId) {
    if (tabs.length > 0) {
      const newIndex = Math.min(tabIndex, tabs.length - 1);
      switchToTab(tabs[newIndex].id);
    } else {
      activeTabId = null;
      createTab();
    }
  }
}

// Update tab content
function updateTab(tabId, fileName, mdContent, filePath) {
  const tab = tabs.find(t => t.id === tabId);
  if (tab) {
    tab.fileName = fileName;
    tab.content = mdContent;
    tab.filePath = filePath;
    tab.scrollPos = 0;
    tab.isModified = false;

    const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"] .tab-title`);
    if (tabEl) tabEl.textContent = fileName;
    updateTabUI(tabId);
  }
}

// Toggle edit mode
function toggleEditMode() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab || !tab.content) return;

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
    renderMarkdown(tab.content);
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
  renderMarkdown(tab.content);
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

// Save file
async function saveFile() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;

  if (tab.isEditing) {
    tab.content = editor.value;
  }

  if (tab.filePath) {
    await window.electronAPI.saveFile(tab.filePath, tab.content);
    tab.isModified = false;
    updateTabUI(activeTabId);
    document.title = `${tab.fileName} - OpenMarkdownReader`;
  } else {
    // No file path, use save as
    const result = await window.electronAPI.saveFileAs(tab.content, tab.fileName);
    if (result) {
      tab.filePath = result.filePath;
      tab.fileName = result.fileName;
      tab.isModified = false;
      const tabEl = document.querySelector(`.tab[data-tab-id="${activeTabId}"] .tab-title`);
      if (tabEl) tabEl.textContent = tab.fileName;
      updateTabUI(activeTabId);
      document.title = `${tab.fileName} - OpenMarkdownReader`;
    }
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

// Listen for directory loaded
window.electronAPI.onDirectoryLoaded((data) => {
  currentDirectory = data.dirPath;
  directoryFiles = data.files;
  allFilesCache = null; // Clear command palette cache
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
      el.className = `file-tree-item file-tree-folder ${isExpanded ? 'expanded' : ''}`;
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
      // File
      el.className = `file-tree-item file-tree-file ${item.isMarkdown ? '' : 'non-markdown'}`;
      el.innerHTML = `
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path d="M3.75 1.5a.25.25 0 00-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V4.664a.25.25 0 00-.073-.177l-2.914-2.914a.25.25 0 00-.177-.073H3.75zM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v8.586A1.75 1.75 0 0112.25 15h-8.5A1.75 1.75 0 012 13.25V1.75z"/>
        </svg>
        <span>${escapeHtml(item.name)}</span>
      `;
      // All files are clickable, non-markdown just shown with muted style
      el.addEventListener('click', () => {
        window.electronAPI.openFileByPath(item.path);
      });
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

// Open file button
openBtn.addEventListener('click', () => {
  window.electronAPI.openFileDialog();
});

// Open folder button on welcome screen
document.getElementById('open-folder-welcome-btn').addEventListener('click', () => {
  window.electronAPI.openFolder();
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

// Listen for file loaded from main process
window.electronAPI.onFileLoaded((data) => {
  const activeTab = tabs.find(t => t.id === activeTabId);

  if (activeTab && !activeTab.content) {
    // Stop watching old file if any
    if (activeTab.filePath && settings.watchFileMode) {
      window.electronAPI.unwatchFile(activeTab.filePath);
    }
    updateTab(activeTabId, data.fileName, data.content, data.filePath);
    renderMarkdown(data.content);
    document.title = `${data.fileName} - OpenMarkdownReader`;
    // Start watching new file
    if (data.filePath && settings.watchFileMode) {
      window.electronAPI.watchFile(data.filePath);
    }
  } else {
    createTab(data.fileName, data.content, data.filePath);
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

// Listen for read-only mode toggle
window.electronAPI.onSetReadOnly((isReadOnly) => {
  settings.readOnlyMode = isReadOnly;
  if (isReadOnly) {
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab && tab.isEditing) {
      tab.content = editor.value;
      tab.isEditing = false;
      hideEditor();
      renderMarkdown(tab.content);
      updateTabUI(activeTabId);
    }
  }
});

// Listen for watch mode toggle
window.electronAPI.onSetWatchMode((watchMode) => {
  settings.watchFileMode = watchMode;
  // Start/stop watching current tab's file
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.filePath) {
    if (watchMode) {
      window.electronAPI.watchFile(tab.filePath);
    } else {
      window.electronAPI.unwatchFile(tab.filePath);
    }
  }
});

// Listen for file changes from watcher
window.electronAPI.onFileChanged(({ filePath, content }) => {
  // Find the tab with this file
  const tab = tabs.find(t => t.filePath === filePath);
  if (!tab) return;

  // Don't update if user is editing and has unsaved changes
  if (tab.isEditing && tab.isModified) {
    console.log('File changed externally but tab has unsaved edits, skipping update');
    return;
  }

  // Update content
  tab.content = content;

  // If this is the active tab, re-render
  if (tab.id === activeTabId) {
    if (tab.isEditing) {
      editor.value = content;
    } else {
      renderMarkdown(content);
    }
  }
});

// Listen for toggle sidebar
window.electronAPI.onToggleSidebar(() => {
  sidebarToggle.click();
});

// Listen for open folder from menu
window.electronAPI.onOpenFolderDialog(() => {
  window.electronAPI.openFolder();
});

// Listen for setting changes
window.electronAPI.onSettingChanged(({ setting, value }) => {
  if (setting === 'content-width') {
    settings.contentWidth = value;
    applyContentWidth();
  }
});

// Listen for show command palette from menu
window.electronAPI.onShowCommandPalette(() => {
  showCommandPalette();
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

function renderMarkdown(mdContent) {
  try {
    const html = marked.parse(mdContent);
    markdownBody.innerHTML = html;

    document.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block);
    });

    dropZone.classList.add('hidden');
    content.classList.remove('hidden');
    markdownBody.classList.remove('hidden');

    window.scrollTo(0, 0);
  } catch (err) {
    console.error('Error rendering markdown:', err);
    markdownBody.innerHTML = '<p style="color:red">Error rendering markdown: ' + escapeHtml(err.message) + '</p><pre>' + escapeHtml(mdContent) + '</pre>';
    dropZone.classList.add('hidden');
    content.classList.remove('hidden');
  }
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
    if (isMarkdownFile(file.name)) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const activeTab = tabs.find(t => t.id === activeTabId);

        if (index === 0 && activeTab && !activeTab.content) {
          updateTab(activeTabId, file.name, event.target.result, null);
          renderMarkdown(event.target.result);
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
  const ext = filename.toLowerCase().split('.').pop();
  return ['md', 'markdown', 'mdown', 'mkd', 'txt'].includes(ext);
}

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
  // Cmd+W to close tab
  if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
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

  // Escape to close command palette (edit mode revert is handled by menu accelerator)
  if (e.key === 'Escape') {
    if (!commandPalette.classList.contains('hidden')) {
      e.preventDefault();
      hideCommandPalette();
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
let commandPaletteFiles = [];
let allFilesCache = null;

async function showCommandPalette() {
  commandPalette.classList.remove('hidden');
  commandPaletteInput.value = '';
  commandPaletteInput.focus();
  commandPaletteSelectedIndex = 0;

  // Load all files if we have a directory
  if (currentDirectory && !allFilesCache) {
    commandPaletteResults.innerHTML = '<div class="command-palette-empty">Loading files...</div>';
    allFilesCache = await window.electronAPI.getAllFilesRecursive(currentDirectory);
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

  // Use cached files if available, otherwise use sidebar files
  commandPaletteFiles = allFilesCache || getAllFilesFlat(directoryFiles);

  // Filter based on query
  let filteredFiles = commandPaletteFiles;
  if (query) {
    filteredFiles = commandPaletteFiles.filter(f =>
      f.name.toLowerCase().includes(query) ||
      f.path.toLowerCase().includes(query)
    );
  }

  // Sort: exact name matches first, then partial matches
  filteredFiles.sort((a, b) => {
    const aNameMatch = a.name.toLowerCase().startsWith(query);
    const bNameMatch = b.name.toLowerCase().startsWith(query);
    if (aNameMatch && !bNameMatch) return -1;
    if (!aNameMatch && bNameMatch) return 1;
    return a.name.localeCompare(b.name);
  });

  // Limit results
  filteredFiles = filteredFiles.slice(0, 20);

  // Reset selection if out of bounds
  if (commandPaletteSelectedIndex >= filteredFiles.length) {
    commandPaletteSelectedIndex = Math.max(0, filteredFiles.length - 1);
  }

  // Render results
  if (filteredFiles.length === 0) {
    if (!currentDirectory) {
      commandPaletteResults.innerHTML = '<div class="command-palette-empty">Open a folder first (⌘⇧O)</div>';
    } else {
      commandPaletteResults.innerHTML = '<div class="command-palette-empty">No files found</div>';
    }
    return;
  }

  commandPaletteResults.innerHTML = filteredFiles.map((file, index) => {
    const relativePath = currentDirectory ? file.path.replace(currentDirectory + '/', '') : file.path;
    const pathDir = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';
    return `
      <div class="command-palette-item ${index === commandPaletteSelectedIndex ? 'selected' : ''}" data-path="${escapeHtml(file.path)}">
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path d="M3.75 1.5a.25.25 0 00-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V4.664a.25.25 0 00-.073-.177l-2.914-2.914a.25.25 0 00-.177-.073H3.75zM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v8.586A1.75 1.75 0 0112.25 15h-8.5A1.75 1.75 0 012 13.25V1.75z"/>
        </svg>
        <div class="command-palette-item-info">
          <div class="command-palette-item-name">${escapeHtml(file.name)}</div>
          ${pathDir ? `<div class="command-palette-item-path">${escapeHtml(pathDir)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers
  commandPaletteResults.querySelectorAll('.command-palette-item').forEach((el, index) => {
    el.addEventListener('click', () => {
      selectCommandPaletteItem(index);
    });
    el.addEventListener('mouseenter', () => {
      commandPaletteSelectedIndex = index;
      updateSelectedItem();
    });
  });
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

function selectCommandPaletteItem(index) {
  const items = commandPaletteResults.querySelectorAll('.command-palette-item');
  if (index >= 0 && index < items.length) {
    const path = items[index].dataset.path;
    hideCommandPalette();
    window.electronAPI.openFileByPath(path);
  }
}

// Command palette input handler
commandPaletteInput.addEventListener('input', () => {
  commandPaletteSelectedIndex = 0;
  updateCommandPaletteResults();
});

// Command palette keyboard navigation
commandPaletteInput.addEventListener('keydown', (e) => {
  const items = commandPaletteResults.querySelectorAll('.command-palette-item');

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (commandPaletteSelectedIndex < items.length - 1) {
      commandPaletteSelectedIndex++;
      updateSelectedItem();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (commandPaletteSelectedIndex > 0) {
      commandPaletteSelectedIndex--;
      updateSelectedItem();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
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

// Initialize with one empty tab
createTab();

console.log('Renderer loaded with editing and sidebar support');
