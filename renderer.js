// marked and hljs are loaded from CDN in index.html

// Tab management
let tabs = [];
let activeTabId = null;
let tabIdCounter = 0;

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

// Create a new tab
function createTab(fileName = 'New Tab', mdContent = null, filePath = null) {
  const tabId = ++tabIdCounter;
  const tab = {
    id: tabId,
    fileName,
    filePath,
    content: mdContent,
    scrollPos: 0
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
  // Save current tab's scroll position
  if (activeTabId !== null) {
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (currentTab) {
      currentTab.scrollPos = window.scrollY;
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
    renderMarkdown(tab.content, false);
    document.title = `${tab.fileName} - Markdown Reader`;
    // Restore scroll position
    setTimeout(() => window.scrollTo(0, tab.scrollPos), 0);
  } else {
    // Show welcome screen
    dropZone.classList.remove('hidden');
    content.classList.add('hidden');
    document.title = 'Markdown Reader';
  }
}

// Close a tab
function closeTab(tabId) {
  const tabIndex = tabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return;

  // Remove tab data
  tabs.splice(tabIndex, 1);

  // Remove tab element
  const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (tabEl) tabEl.remove();

  // If closing active tab, switch to another
  if (activeTabId === tabId) {
    if (tabs.length > 0) {
      // Switch to next tab, or previous if closing last
      const newIndex = Math.min(tabIndex, tabs.length - 1);
      switchToTab(tabs[newIndex].id);
    } else {
      // No tabs left, create a new empty one
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

    // Update tab title
    const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"] .tab-title`);
    if (tabEl) tabEl.textContent = fileName;
  }
}

// Open file button
openBtn.addEventListener('click', () => {
  window.electronAPI.openFileDialog();
});

// New tab button
newTabBtn.addEventListener('click', () => {
  createTab();
});

// Listen for file loaded from main process
window.electronAPI.onFileLoaded((data) => {
  const activeTab = tabs.find(t => t.id === activeTabId);

  // If current tab is empty (no content), load into it
  if (activeTab && !activeTab.content) {
    updateTab(activeTabId, data.fileName, data.content, data.filePath);
    renderMarkdown(data.content);
    document.title = `${data.fileName} - Markdown Reader`;
  } else {
    // Create new tab for this file
    createTab(data.fileName, data.content, data.filePath);
  }
});

// Listen for new tab request from main process
window.electronAPI.onNewTab(() => {
  createTab();
});

function renderMarkdown(mdContent, updateTitle = true) {
  try {
    const html = marked.parse(mdContent);
    markdownBody.innerHTML = html;

    // Apply syntax highlighting to code blocks
    document.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block);
    });

    // Show content, hide welcome
    dropZone.classList.add('hidden');
    content.classList.remove('hidden');

    // Scroll to top
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
          // First file goes into current empty tab
          updateTab(activeTabId, file.name, event.target.result, null);
          renderMarkdown(event.target.result);
          document.title = `${file.name} - Markdown Reader`;
        } else {
          // Additional files get new tabs
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

// Also allow dropping on the content area to open a new file
content.addEventListener('dragover', (e) => {
  e.preventDefault();
});

content.addEventListener('drop', (e) => {
  e.preventDefault();
  handleFileDrop(e.dataTransfer.files);
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Cmd+W to close tab
  if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
    e.preventDefault();
    if (activeTabId !== null) {
      closeTab(activeTabId);
    }
  }
});

// Initialize with one empty tab
createTab();

console.log('Renderer loaded with tabs support');
