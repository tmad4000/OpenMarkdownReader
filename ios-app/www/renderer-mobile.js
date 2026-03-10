/**
 * OpenMarkdownReader - Mobile Renderer
 *
 * Simplified rendering pipeline for iOS, reusing the same
 * marked configuration and highlight.js setup as the desktop app.
 */

// ---- Startup Health Check ----
(function startupHealthCheck() {
  const missing = [];
  if (typeof marked === 'undefined') missing.push('marked (Markdown parser)');
  if (typeof hljs === 'undefined') missing.push('highlight.js (syntax highlighter)');
  if (missing.length > 0) {
    document.body.innerHTML = `
      <div style="padding: 40px; font-family: -apple-system, sans-serif; color: #c00; max-width: 600px; margin: 40px auto;">
        <h2>OpenMarkdownReader failed to start</h2>
        <p>Missing dependencies: ${missing.join(', ')}</p>
      </div>`;
    return;
  }
  console.log('[Mobile] Health check passed');
})();

// ---- State ----
let currentMarkdown = '';
let currentFileName = '';
let isEditMode = false;
let easyMDE = null;
let fontSize = 17;

// ---- DOM Elements ----
const toolbar = document.getElementById('toolbar');
const fileTitle = document.getElementById('file-title');
const backBtn = document.getElementById('back-btn');
const tocBtn = document.getElementById('toc-btn');
const editBtn = document.getElementById('edit-btn');
const shareActionBtn = document.getElementById('share-action-btn');
const settingsBtn = document.getElementById('settings-btn');
const tocPanel = document.getElementById('toc-panel');
const tocBackdrop = document.getElementById('toc-backdrop');
const tocClose = document.getElementById('toc-close');
const tocContent = document.getElementById('toc-content');
const settingsPanel = document.getElementById('settings-panel');
const settingsBackdrop = document.getElementById('settings-backdrop');
const settingsClose = document.getElementById('settings-close');
const welcome = document.getElementById('welcome');
const openFileBtn = document.getElementById('open-file-btn');
const pasteArea = document.getElementById('paste-area');
const renderPasteBtn = document.getElementById('render-paste-btn');
const contentEl = document.getElementById('content');
const markdownBody = document.getElementById('markdown-body');
const editorContainer = document.getElementById('editor-container');
const editorEl = document.getElementById('editor');
const bottomBar = document.getElementById('bottom-bar');
const bottomOpenBtn = document.getElementById('bottom-open-btn');
const bottomCopyBtn = document.getElementById('bottom-copy-btn');
const bottomShareBtn = document.getElementById('bottom-share-btn');
const wordCountEl = document.getElementById('word-count');
const contentArea = document.querySelector('.content-area');
const fontDecrease = document.getElementById('font-decrease');
const fontIncrease = document.getElementById('font-increase');
const fontSizeDisplay = document.getElementById('font-size-display');
const toastContainer = document.getElementById('toast-container');

// ---- Utilities ----
function escapeHtml(text) {
  if (!text) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, (c) => map[c]);
}

function countWords(text) {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

function showToast(message, type = 'success', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = {
    success: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 16A8 8 0 108 0a8 8 0 000 16zm3.78-9.72a.75.75 0 00-1.06-1.06L6.75 9.19 5.28 7.72a.75.75 0 00-1.06 1.06l2 2a.75.75 0 001.06 0l4.5-4.5z"/></svg>',
    error: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2.343 13.657A8 8 0 1113.657 2.343 8 8 0 012.343 13.657zM6.03 4.97a.75.75 0 00-1.06 1.06L6.94 8 4.97 9.97a.75.75 0 101.06 1.06L8 9.06l1.97 1.97a.75.75 0 101.06-1.06L9.06 8l1.97-1.97a.75.75 0 10-1.06-1.06L8 6.94 6.03 4.97z"/></svg>',
    warning: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0114.082 15H1.918a1.75 1.75 0 01-1.543-2.575L6.457 1.047zM8 5a.75.75 0 00-.75.75v2.5a.75.75 0 001.5 0v-2.5A.75.75 0 008 5zm1 6a1 1 0 11-2 0 1 1 0 012 0z"/></svg>'
  };
  toast.innerHTML = `
    ${icons[type] || icons.success}
    <span class="toast-message">${message}</span>
    <button class="toast-close">
      <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
        <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
      </svg>
    </button>`;
  toast.querySelector('.toast-close').addEventListener('click', () => dismissToast(toast));
  toastContainer.appendChild(toast);
  if (duration > 0) setTimeout(() => dismissToast(toast), duration);
}

function dismissToast(toast) {
  if (!toast || !toast.parentElement) return;
  toast.classList.add('dismissing');
  setTimeout(() => toast.remove(), 200);
}

// ---- Marked Configuration (matches desktop exactly) ----
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
    if (/^#[A-Za-z][\w-]*$/.test(token)) { attrs.id = token.slice(1); used = true; return; }
    if (/^\.[A-Za-z][\w-]*$/.test(token)) { attrs.classes.push(token.slice(1)); used = true; return; }
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
  const headingHtml = typeof text === 'object' ? text.text : text;
  const headingLevel = typeof text === 'object' ? text.depth : level;

  const rawText = typeof raw === 'string' ? raw.trim() : '';
  const attributeInfo = parseHeadingAttributes(rawText);

  let cleanedHtml = headingHtml;
  let plainText = rawText || htmlToPlainText(headingHtml);

  if (attributeInfo) {
    if (attributeInfo.rawWithoutAttributes) plainText = attributeInfo.rawWithoutAttributes;
    if (typeof cleanedHtml === 'string' && attributeInfo.attributeBlock && cleanedHtml.endsWith(attributeInfo.attributeBlock)) {
      cleanedHtml = cleanedHtml.slice(0, -attributeInfo.attributeBlock.length).trimEnd();
    }
    if (!plainText) plainText = htmlToPlainText(cleanedHtml);
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

  // Mobile: no collapse toggle or heading anchor
  return `<h${headingLevel} ${attrs.join(' ')}>${cleanedHtml}</h${headingLevel}>`;
};

marked.setOptions({
  renderer: markedRenderer,
  gfm: true,
  breaks: true
});

// ---- Rendering ----
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

function renderMarkdown(mdContent) {
  try {
    fallbackHeadingSlugCounts = new Map();
    const html = marked.parse(mdContent);
    markdownBody.innerHTML = html;

    wrapTablesForScroll();

    // Syntax highlighting
    document.querySelectorAll('#markdown-body pre code').forEach((block) => {
      hljs.highlightElement(block);
    });

    // Show content, hide welcome
    welcome.classList.add('hidden');
    contentEl.classList.remove('hidden');
    editorContainer.classList.add('hidden');
    bottomBar.classList.remove('hidden');
    contentArea.classList.add('has-bottom-bar');

    // Show toolbar buttons
    tocBtn.classList.remove('hidden');
    editBtn.classList.remove('hidden');
    shareActionBtn.classList.remove('hidden');

    // Update word count
    const words = countWords(mdContent);
    wordCountEl.textContent = `${words} word${words !== 1 ? 's' : ''}`;

    // Build TOC
    buildTOC();

    // Scroll to top
    contentArea.scrollTop = 0;
  } catch (err) {
    console.error('[Mobile] Render error:', err);
    markdownBody.innerHTML = '<p style="color:red">Error rendering markdown: ' + escapeHtml(err.message) + '</p>';
    welcome.classList.add('hidden');
    contentEl.classList.remove('hidden');
  }
}

// ---- Table of Contents ----
function buildTOC() {
  if (!markdownBody) return;
  tocContent.innerHTML = '';
  const headings = markdownBody.querySelectorAll('h1, h2, h3, h4, h5, h6');
  if (headings.length === 0) {
    tocBtn.classList.add('hidden');
    return;
  }
  tocBtn.classList.remove('hidden');

  headings.forEach((heading) => {
    const level = parseInt(heading.tagName.charAt(1));
    const text = heading.textContent.trim();
    const id = heading.id;
    const a = document.createElement('a');
    a.className = `toc-item toc-h${level}`;
    a.textContent = text;
    a.href = `#${id}`;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      closeTOC();
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    tocContent.appendChild(a);
  });
}

function openTOC() {
  tocPanel.classList.remove('hidden');
  tocBackdrop.classList.remove('hidden');
  // Force reflow then add visible class for transition
  requestAnimationFrame(() => {
    tocPanel.classList.add('visible');
    tocBackdrop.classList.add('visible');
  });
}

function closeTOC() {
  tocPanel.classList.remove('visible');
  tocBackdrop.classList.remove('visible');
  setTimeout(() => {
    tocPanel.classList.add('hidden');
    tocBackdrop.classList.add('hidden');
  }, 250);
}

// ---- Settings Panel ----
function openSettings() {
  settingsPanel.classList.remove('hidden');
  settingsBackdrop.classList.remove('hidden');
  requestAnimationFrame(() => {
    settingsPanel.classList.add('visible');
    settingsBackdrop.classList.add('visible');
  });
}

function closeSettings() {
  settingsPanel.classList.remove('visible');
  settingsBackdrop.classList.remove('visible');
  setTimeout(() => {
    settingsPanel.classList.add('hidden');
    settingsBackdrop.classList.add('hidden');
  }, 250);
}

function applyTheme(theme) {
  if (theme === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  localStorage.setItem('omr-theme', theme);

  // Update segmented control
  document.querySelectorAll('.settings-seg-btn[data-theme]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

function applyFontSize(size) {
  fontSize = Math.max(12, Math.min(28, size));
  document.documentElement.style.setProperty('--font-size', fontSize + 'px');
  fontSizeDisplay.textContent = fontSize + 'px';
  localStorage.setItem('omr-font-size', fontSize);
}

// ---- Edit Mode ----
function enterEditMode() {
  isEditMode = true;
  contentEl.classList.add('hidden');
  editorContainer.classList.remove('hidden');
  editBtn.classList.add('active');

  if (typeof EasyMDE !== 'undefined' && !easyMDE) {
    easyMDE = new EasyMDE({
      element: editorEl,
      autofocus: true,
      spellChecker: false,
      status: false,
      toolbar: ['bold', 'italic', 'heading', '|', 'quote', 'unordered-list', 'ordered-list', '|', 'link', 'image', '|', 'preview'],
      initialValue: currentMarkdown,
      previewRender: (plainText) => marked.parse(plainText)
    });
    easyMDE.codemirror.on('change', () => {
      currentMarkdown = easyMDE.value();
    });
  } else if (easyMDE) {
    easyMDE.value(currentMarkdown);
  } else {
    // Fallback: plain textarea
    editorEl.value = currentMarkdown;
    editorEl.addEventListener('input', () => {
      currentMarkdown = editorEl.value;
    });
  }
}

function exitEditMode() {
  isEditMode = false;
  editorContainer.classList.add('hidden');
  contentEl.classList.remove('hidden');
  editBtn.classList.remove('active');

  if (easyMDE) {
    currentMarkdown = easyMDE.value();
  }

  // Re-render with updated content
  renderMarkdown(currentMarkdown);
}

function toggleEditMode() {
  if (isEditMode) {
    exitEditMode();
  } else {
    enterEditMode();
  }
}

// ---- File Opening via Capacitor ----
async function openFile() {
  try {
    // Check if Capacitor is available
    if (window.Capacitor && window.Capacitor.Plugins) {
      const { FilePicker } = window.Capacitor.Plugins;
      if (FilePicker) {
        const result = await FilePicker.pickFiles({
          types: ['text/markdown', 'text/plain', 'text/x-markdown'],
          multiple: false,
          readData: true
        });
        if (result && result.files && result.files.length > 0) {
          const file = result.files[0];
          currentFileName = file.name || 'Untitled.md';
          // Data comes as base64, decode it
          if (file.data) {
            currentMarkdown = atob(file.data);
          } else if (file.path) {
            // If we have a path, read via Filesystem
            const { Filesystem } = window.Capacitor.Plugins;
            const contents = await Filesystem.readFile({ path: file.path });
            currentMarkdown = atob(contents.data);
          }
          fileTitle.textContent = currentFileName;
          backBtn.classList.remove('hidden');
          renderMarkdown(currentMarkdown);
          return;
        }
      }
    }

    // Fallback: use HTML file input
    openFileViaInput();
  } catch (err) {
    console.error('[Mobile] File open error:', err);
    // Fallback to HTML file input
    openFileViaInput();
  }
}

function openFileViaInput() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.md,.markdown,.txt,.text,.mdx,.mdown';
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    currentFileName = file.name;
    const text = await file.text();
    currentMarkdown = text;
    fileTitle.textContent = currentFileName;
    backBtn.classList.remove('hidden');
    renderMarkdown(currentMarkdown);
  });
  input.click();
}

// ---- Share / Copy ----
async function copyMarkdown() {
  if (!currentMarkdown) return;
  try {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Clipboard) {
      await window.Capacitor.Plugins.Clipboard.write({ string: currentMarkdown });
    } else {
      await navigator.clipboard.writeText(currentMarkdown);
    }
    showToast('Copied to clipboard');
  } catch (err) {
    console.error('[Mobile] Copy error:', err);
    showToast('Failed to copy', 'error');
  }
}

async function shareContent() {
  if (!currentMarkdown) return;
  try {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share) {
      await window.Capacitor.Plugins.Share.share({
        title: currentFileName || 'Markdown',
        text: currentMarkdown,
        dialogTitle: 'Share markdown'
      });
    } else if (navigator.share) {
      await navigator.share({
        title: currentFileName || 'Markdown',
        text: currentMarkdown
      });
    } else {
      await copyMarkdown();
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('[Mobile] Share error:', err);
    }
  }
}

// ---- Go Back to Welcome ----
function goBack() {
  // Destroy EasyMDE if active
  if (easyMDE) {
    easyMDE.toTextArea();
    easyMDE = null;
  }
  isEditMode = false;

  currentMarkdown = '';
  currentFileName = '';
  fileTitle.textContent = 'OpenMarkdownReader';
  backBtn.classList.add('hidden');
  tocBtn.classList.add('hidden');
  editBtn.classList.add('hidden');
  editBtn.classList.remove('active');
  shareActionBtn.classList.add('hidden');
  contentEl.classList.add('hidden');
  editorContainer.classList.add('hidden');
  bottomBar.classList.add('hidden');
  contentArea.classList.remove('has-bottom-bar');
  welcome.classList.remove('hidden');
  pasteArea.value = '';
  renderPasteBtn.classList.add('hidden');
}

// ---- Event Listeners ----

// Toolbar
backBtn.addEventListener('click', goBack);
tocBtn.addEventListener('click', openTOC);
editBtn.addEventListener('click', toggleEditMode);
shareActionBtn.addEventListener('click', shareContent);
settingsBtn.addEventListener('click', openSettings);

// TOC
tocClose.addEventListener('click', closeTOC);
tocBackdrop.addEventListener('click', closeTOC);

// Settings
settingsClose.addEventListener('click', closeSettings);
settingsBackdrop.addEventListener('click', closeSettings);

document.querySelectorAll('.settings-seg-btn[data-theme]').forEach((btn) => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
});

fontDecrease.addEventListener('click', () => applyFontSize(fontSize - 1));
fontIncrease.addEventListener('click', () => applyFontSize(fontSize + 1));

// Welcome
openFileBtn.addEventListener('click', openFile);

pasteArea.addEventListener('input', () => {
  renderPasteBtn.classList.toggle('hidden', !pasteArea.value.trim());
});

renderPasteBtn.addEventListener('click', () => {
  const text = pasteArea.value.trim();
  if (!text) return;
  currentMarkdown = text;
  currentFileName = 'Pasted Content';
  fileTitle.textContent = currentFileName;
  backBtn.classList.remove('hidden');
  renderMarkdown(currentMarkdown);
});

// Bottom bar
bottomOpenBtn.addEventListener('click', openFile);
bottomCopyBtn.addEventListener('click', copyMarkdown);
bottomShareBtn.addEventListener('click', shareContent);

// Handle links in rendered markdown
markdownBody.addEventListener('click', (e) => {
  const link = e.target.closest('a');
  if (!link) return;

  const href = link.getAttribute('href');
  if (!href) return;

  if (href.startsWith('#')) {
    // Internal anchor navigation
    e.preventDefault();
    const target = document.getElementById(href.slice(1));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return;
  }

  if (href.startsWith('http://') || href.startsWith('https://')) {
    e.preventDefault();
    // Open external links in system browser
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
      window.Capacitor.Plugins.Browser.open({ url: href });
    } else {
      window.open(href, '_blank');
    }
    return;
  }
});

// ---- Restore Settings ----
(function restoreSettings() {
  const savedTheme = localStorage.getItem('omr-theme');
  if (savedTheme) applyTheme(savedTheme);

  const savedFontSize = localStorage.getItem('omr-font-size');
  if (savedFontSize) {
    applyFontSize(parseInt(savedFontSize, 10));
  }
})();

// ---- Handle receiving shared files (via App URL scheme / share sheet) ----
document.addEventListener('DOMContentLoaded', () => {
  // Listen for Capacitor App URL open events
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.addListener('appUrlOpen', async (data) => {
      console.log('[Mobile] App URL opened:', data.url);
      // Handle file:// URLs
      if (data.url.startsWith('file://')) {
        try {
          const { Filesystem } = window.Capacitor.Plugins;
          const path = data.url.replace('file://', '');
          const contents = await Filesystem.readFile({ path });
          currentMarkdown = atob(contents.data);
          currentFileName = path.split('/').pop() || 'Shared File';
          fileTitle.textContent = currentFileName;
          backBtn.classList.remove('hidden');
          renderMarkdown(currentMarkdown);
        } catch (err) {
          console.error('[Mobile] Failed to open shared file:', err);
          showToast('Failed to open file', 'error');
        }
      }
    });
  }
});

console.log('[Mobile] OpenMarkdownReader mobile renderer loaded');
