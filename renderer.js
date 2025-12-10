// marked and hljs are loaded from CDN in index.html

// Settings
let settings = {
  readOnlyMode: false,
  sidebarVisible: false
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

  // Insert before the + button
  tabBar.insertBefore(tabEl, newTabBtn);

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
    document.title = `${tab.fileName}${tab.isModified ? ' *' : ''} - Markdown Reader`;
    setTimeout(() => window.scrollTo(0, tab.scrollPos), 0);
  } else {
    // Show welcome screen
    hideEditor();
    dropZone.classList.remove('hidden');
    content.classList.add('hidden');
    document.title = 'Markdown Reader';
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
  // Update edit button state
  if (tab && tabId === activeTabId) {
    editToggleBtn.classList.toggle('active', tab.isEditing);
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
    showEditor(tab.content);
  } else {
    tab.content = editor.value;
    hideEditor();
    renderMarkdown(tab.content);
  }

  updateTabUI(activeTabId);
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
    document.title = `${tab.fileName} * - Markdown Reader`;
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
    document.title = `${tab.fileName} - Markdown Reader`;
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
      document.title = `${tab.fileName} - Markdown Reader`;
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
  renderFileTree();

  // Show sidebar if hidden
  if (!settings.sidebarVisible) {
    settings.sidebarVisible = true;
    sidebar.classList.remove('hidden');
    sidebarToggle.classList.add('active');
  }
});

function renderFileTree() {
  fileTree.innerHTML = '';

  if (!directoryFiles.length) {
    fileTree.innerHTML = '<div class="file-tree-item" style="opacity:0.5">No markdown files</div>';
    return;
  }

  directoryFiles.forEach(file => {
    const item = document.createElement('div');
    item.className = 'file-tree-item';
    item.innerHTML = `
      <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
        <path d="M3.75 1.5a.25.25 0 00-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V4.664a.25.25 0 00-.073-.177l-2.914-2.914a.25.25 0 00-.177-.073H3.75zM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v8.586A1.75 1.75 0 0112.25 15h-8.5A1.75 1.75 0 012 13.25V1.75z"/>
      </svg>
      <span>${escapeHtml(file.name)}</span>
    `;
    item.addEventListener('click', () => {
      window.electronAPI.openFileByPath(file.path);
    });
    fileTree.appendChild(item);
  });
}

// Open file button
openBtn.addEventListener('click', () => {
  window.electronAPI.openFileDialog();
});

// New tab button
newTabBtn.addEventListener('click', () => {
  createTab();
});

// Edit toggle button
editToggleBtn.addEventListener('click', () => {
  toggleEditMode();
});

// Listen for file loaded from main process
window.electronAPI.onFileLoaded((data) => {
  const activeTab = tabs.find(t => t.id === activeTabId);

  if (activeTab && !activeTab.content) {
    updateTab(activeTabId, data.fileName, data.content, data.filePath);
    renderMarkdown(data.content);
    document.title = `${data.fileName} - Markdown Reader`;
  } else {
    createTab(data.fileName, data.content, data.filePath);
  }
});

// Listen for new tab request from main process
window.electronAPI.onNewTab(() => {
  createTab();
});

// Listen for toggle edit mode
window.electronAPI.onToggleEdit(() => {
  toggleEditMode();
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

// Listen for toggle sidebar
window.electronAPI.onToggleSidebar(() => {
  sidebarToggle.click();
});

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
          document.title = `${file.name} - Markdown Reader`;
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

  // Escape to exit edit mode
  if (e.key === 'Escape') {
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab && tab.isEditing) {
      toggleEditMode();
    }
  }
});

// Double-click on titlebar to maximize/restore
document.getElementById('titlebar').addEventListener('dblclick', (e) => {
  // Only trigger on draggable areas (not on buttons or tabs)
  if (e.target.closest('.tab') || e.target.closest('button')) return;
  window.electronAPI.toggleMaximize();
});

// Initialize with one empty tab
createTab();

console.log('Renderer loaded with editing and sidebar support');
