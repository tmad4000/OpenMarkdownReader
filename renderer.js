// marked and hljs are loaded from CDN in index.html

// Settings
let settings = {
  readOnlyMode: false,
  sidebarVisible: false,
  contentWidth: 900,
  watchFileMode: false,
  tocVisible: false,
  csvViewAsTable: true // Default to showing CSV as table
};

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
const tocPanel = document.getElementById('toc-panel');
const tocContent = document.getElementById('toc-content');
const tocToggleBtn = document.getElementById('toc-toggle-btn');
const tocCloseBtn = document.getElementById('toc-close');
const csvView = document.getElementById('csv-view');
const csvTableContainer = document.getElementById('csv-table-container');
const csvToggleRawBtn = document.getElementById('csv-toggle-raw');

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
  tabEl.draggable = true;
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

  switchToTab(tabId);
  return tabId;
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
      tabBar.appendChild(draggedTab);
      
      // Update tabs array
      const draggedTabId = parseInt(draggedTab.dataset.tabId);
      const draggedTabData = tabs.find(t => t.id === draggedTabId);
      
      const oldIndex = tabs.indexOf(draggedTabData);
      if (oldIndex > -1) tabs.splice(oldIndex, 1);
      
      tabs.push(draggedTabData);
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
        } else {
          alert(`Could not rename file: ${result.error}`);
        }
      } else {
        // Just update the tab name for unsaved files
        tab.fileName = newName;
        titleEl.textContent = newName;
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
    // Show save button when editing with unsaved changes
    saveBtn.classList.toggle('hidden', !(tab.isEditing && tab.isModified));
  }
}

// Close a tab
async function closeTab(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  const tabIndex = tabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return;

  // Check for unsaved changes - offer Save/Don't Save/Cancel
  if (tab && tab.isModified) {
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
        await window.electronAPI.saveFile(tab.filePath, tab.content);
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
  if (!tab) return;

  // If blank tab (no content), create a new file instead
  if (!tab.content && tab.content !== '') {
    tab.fileName = 'Untitled.md';
    tab.content = '';
    tab.isEditing = true;
    tab.originalContent = '';
    const tabEl = document.querySelector(`.tab[data-tab-id="${activeTabId}"] .tab-title`);
    if (tabEl) tabEl.textContent = tab.fileName;
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
    // Update original content to match saved content, so 'Revert' goes back to this save
    if (tab.isEditing) {
      tab.originalContent = tab.content;
    }
    updateTabUI(activeTabId);
    document.title = `${tab.fileName} - OpenMarkdownReader`;
  } else {
    // No file path, use save as
    const result = await window.electronAPI.saveFileAs(tab.content, tab.fileName);
    if (result) {
      tab.filePath = result.filePath;
      tab.fileName = result.fileName;
      tab.isModified = false;
      // Update original content here too
      if (tab.isEditing) {
        tab.originalContent = tab.content;
      }
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
  
  // Pre-fetch all files for command palette
  allFilesCache = null;
  window.electronAPI.getAllFilesRecursive(currentDirectory).then(files => {
    allFilesCache = files;
    // If palette is open, update results immediately
    if (!commandPalette.classList.contains('hidden')) {
      updateCommandPaletteResults();
    }
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
      // File - show text files normally, other files muted
      const isTextFile = item.isMarkdown || item.isTextFile || isTextFileByName(item.name);
      el.className = `file-tree-item file-tree-file ${isTextFile ? '' : 'non-markdown'}`;
      el.innerHTML = `
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path d="M3.75 1.5a.25.25 0 00-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V4.664a.25.25 0 00-.073-.177l-2.914-2.914a.25.25 0 00-.177-.073H3.75zM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v8.586A1.75 1.75 0 0112.25 15h-8.5A1.75 1.75 0 012 13.25V1.75z"/>
        </svg>
        <span>${escapeHtml(item.name)}</span>
      `;
      // All files are clickable, non-text just shown with muted style
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

// Listen for file loaded from main process
window.electronAPI.onFileLoaded((data) => {
  // Check if file is already open
  if (data.filePath) {
    const existingTab = tabs.find(t => t.filePath === data.filePath);
    if (existingTab) {
      switchToTab(existingTab.id);

      // Update content if no unsaved changes (fresh from disk)
      if (!existingTab.isModified) {
        existingTab.content = data.content;

        // Refresh UI
        if (existingTab.isEditing) {
          editor.value = data.content;
        } else {
          renderContent(data.content, data.fileName);
        }
      }
      return;
    }
  }

  const activeTab = tabs.find(t => t.id === activeTabId);

  if (activeTab && !activeTab.content) {
    // Stop watching old file if any
    if (activeTab.filePath && settings.watchFileMode) {
      window.electronAPI.unwatchFile(activeTab.filePath);
    }
    updateTab(activeTabId, data.fileName, data.content, data.filePath);
    renderContent(data.content, data.fileName);
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
      renderContent(content, tab.fileName);
    }
  }
});

// Listen for toggle sidebar
window.electronAPI.onToggleSidebar(() => {
  sidebarToggle.click();
});

// Watch indicator click to toggle
document.getElementById('watch-indicator').addEventListener('click', () => {
  window.electronAPI.toggleWatchMode();
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

// Table of Contents functions
function extractHeadings(content) {
  const headings = [];
  // Match markdown headings (# style)
  const lines = content.split('\n');
  let inCodeBlock = false;

  lines.forEach((line, index) => {
    // Track code blocks
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      return;
    }
    if (inCodeBlock) return;

    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      // Generate ID similar to how marked does it
      const id = text.toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-');
      headings.push({ level, text, id, line: index });
    }
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
markedRenderer.heading = function(text, level) {
  // Handle both old and new marked API
  const headingText = typeof text === 'object' ? text.text : text;
  const headingLevel = typeof text === 'object' ? text.depth : level;

  const id = headingText.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
  return `<h${headingLevel} id="${id}">${headingText}</h${headingLevel}>`;
};

marked.setOptions({
  renderer: markedRenderer,
  gfm: true,
  breaks: false
});

function renderMarkdown(mdContent) {
  try {
    // Hide CSV view if it was showing
    hideCSVView();

    const html = marked.parse(mdContent);
    markdownBody.innerHTML = html;

    document.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block);
    });

    dropZone.classList.add('hidden');
    content.classList.remove('hidden');
    markdownBody.classList.remove('hidden');

    // Update Table of Contents
    const headings = extractHeadings(mdContent);
    renderTOC(headings);

    window.scrollTo(0, 0);
  } catch (err) {
    console.error('Error rendering markdown:', err);
    markdownBody.innerHTML = '<p style="color:red">Error rendering markdown: ' + escapeHtml(err.message) + '</p><pre>' + escapeHtml(mdContent) + '</pre>';
    dropZone.classList.add('hidden');
    content.classList.remove('hidden');
  }
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
let commandPaletteFiles = []; // This will hold the currently displayed (filtered) files
let allFilesCache = null;
let lastInputSource = 'mouse'; // Track input source to prevent mouse hover fighting keyboard

document.addEventListener('mousemove', () => {
  lastInputSource = 'mouse';
});

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

  // Build list of searchable items: folder files + open tabs
  let allItems = [];

  // Add files from folder if available
  if (allFilesCache) {
    allItems = allFilesCache.map(f => ({ ...f })); // Clone to avoid modifying cache
  } else if (directoryFiles.length > 0) {
    allItems = getAllFilesFlat(directoryFiles);
  }

  // Add open tabs that have content (even without a folder open)
  // We mark them as isOpenTab to prioritize them
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

  // Filter based on query
  let filteredFiles = allItems;
  if (query) {
    filteredFiles = allItems.filter(f =>
      f.name.toLowerCase().includes(query) ||
      f.path.toLowerCase().includes(query)
    );
  }

  // Sort: Open tabs first, then exact name matches, then partial matches
  filteredFiles.sort((a, b) => {
    // 1. Open tabs first
    if (a.isOpenTab && !b.isOpenTab) return -1;
    if (!a.isOpenTab && b.isOpenTab) return 1;

    // 2. Exact name match starts with query
    const aNameMatch = a.name.toLowerCase().startsWith(query);
    const bNameMatch = b.name.toLowerCase().startsWith(query);
    if (aNameMatch && !bNameMatch) return -1;
    if (!aNameMatch && bNameMatch) return 1;
    
    // 3. Alphabetical
    return a.name.localeCompare(b.name);
  });

  // Limit results
  filteredFiles = filteredFiles.slice(0, 20);
  
  // Update global variable for selection logic
  commandPaletteFiles = filteredFiles;

  // Reset selection if out of bounds
  if (commandPaletteSelectedIndex >= filteredFiles.length) {
    commandPaletteSelectedIndex = Math.max(0, filteredFiles.length - 1);
  }

  // Render results
  if (filteredFiles.length === 0) {
    if (!currentDirectory && tabs.filter(t => t.filePath).length === 0) {
      commandPaletteResults.innerHTML = '<div class="command-palette-empty">No files open yet<br><span style="font-size: 12px; opacity: 0.7;">Open a file or folder with ⌘O</span></div>';
    } else if (query) {
      commandPaletteResults.innerHTML = '<div class="command-palette-empty">No matching files</div>';
    } else {
      commandPaletteResults.innerHTML = '<div class="command-palette-empty">No files found</div>';
    }
    return;
  }

  commandPaletteResults.innerHTML = filteredFiles.map((file, index) => {
    const relativePath = currentDirectory && file.path.startsWith(currentDirectory) 
      ? file.path.replace(currentDirectory + '/', '') 
      : file.path;
    const pathDir = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';
    
    const icon = file.isOpenTab ? 
      // Tab icon
      `<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" style="opacity: 0.8;">
         <path d="M0 3.75C0 2.784.784 2 1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0114.25 14H1.75A1.75 1.75 0 010 12.25v-8.5zm1.75-.25a.25.25 0 00-.25.25v8.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25v-8.5a.25.25 0 00-.25-.25H1.75zM3.5 6.25a.75.75 0 01.75-.75h7.5a.75.75 0 010 1.5h-7.5a.75.75 0 01-.75-.75z"/>
       </svg>` :
      // File icon
      `<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" style="opacity: 0.5;">
         <path d="M3.75 1.5a.25.25 0 00-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V4.664a.25.25 0 00-.073-.177l-2.914-2.914a.25.25 0 00-.177-.073H3.75zM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v8.586A1.75 1.75 0 0112.25 15h-8.5A1.75 1.75 0 012 13.25V1.75z"/>
       </svg>`;

    const isOpenBadge = file.isOpenTab ? '<span class="command-palette-badge">Open</span>' : '';

    return `
      <div class="command-palette-item ${index === commandPaletteSelectedIndex ? 'selected' : ''}" data-index="${index}">
        ${icon}
        <div class="command-palette-item-info">
          <div class="command-palette-item-name">
            ${escapeHtml(file.name)}
            ${isOpenBadge}
          </div>
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
      // Only update selection on mouse hover if the mouse is actually the source of input
      // This prevents the selection from jumping when the list scrolls under the mouse due to keyboard nav
      if (lastInputSource === 'mouse') {
        commandPaletteSelectedIndex = index;
        updateSelectedItem();
      }
    });
  });
  
  // Ensure selected item is in view
  updateSelectedItem();
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
  if (index >= 0 && index < commandPaletteFiles.length) {
    const file = commandPaletteFiles[index];
    hideCommandPalette();
    
    if (file.isOpenTab && file.tabId) {
      switchToTab(file.tabId);
    } else {
      window.electronAPI.openFileByPath(file.path);
    }
  }
}

// Command palette input handler
commandPaletteInput.addEventListener('input', () => {
  commandPaletteSelectedIndex = 0;
  updateCommandPaletteResults();
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
        item.addEventListener('click', () => {
          const filePath = item.dataset.path;
          const fileType = item.dataset.type;

          if (fileType === 'folder') {
            // For folders, we need to trigger directory loading
            window.electronAPI.getDirectoryContents(filePath).then(files => {
              // Manually trigger the directory loaded flow
              const event = { dirPath: filePath, files };
              window.electronAPI.onDirectoryLoaded(() => {}); // No-op, just need to open
              // Use openFileByPath which will handle folder detection
            });
            // Actually open the folder properly
            window.electronAPI.openFileByPath(filePath);
          } else {
            window.electronAPI.openFileByPath(filePath);
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
window.electronAPI.onCheckUnsaved(() => {
  const hasUnsaved = tabs.some(tab => tab.isModified);
  window.electronAPI.reportUnsavedState(hasUnsaved);
});

console.log('Renderer loaded with editing and sidebar support');
