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
  if (typeof OpenMarkdownMobileUtils === 'undefined') missing.push('mobile utilities');
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
let currentFilePath = null;
let currentSourceUrl = null;
let currentSourceType = null;
let currentFolderRoot = null;
let currentFolderPath = null;
let folderPathStack = [];
let isEditMode = false;
let easyMDE = null;
let fontSize = 17;
const MAX_REMOTE_FILE_BYTES = 15 * 1024 * 1024;
const MobileUtils = window.OpenMarkdownMobileUtils;

// ---- DOM Elements ----
const toolbar = document.getElementById('toolbar');
const fileTitle = document.getElementById('file-title');
const sourceBadge = document.getElementById('source-badge');
const backBtn = document.getElementById('back-btn');
const reloadBtn = document.getElementById('reload-btn');
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
const openFolderBtn = document.getElementById('open-folder-btn');
const remoteUrlForm = document.getElementById('remote-url-form');
const remoteUrlInput = document.getElementById('remote-url-input');
const remoteUrlSubmit = document.getElementById('remote-url-submit');
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
const folderBrowser = document.getElementById('folder-browser');
const folderBrowserBackdrop = document.getElementById('folder-browser-backdrop');
const folderBrowserTitle = document.getElementById('folder-browser-title');
const folderBrowserPath = document.getElementById('folder-browser-path');
const folderBrowserList = document.getElementById('folder-browser-list');
const folderBrowserClose = document.getElementById('folder-browser-close');
const folderUpBtn = document.getElementById('folder-up-btn');

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

function sourceLabel() {
  if (currentSourceType === 'remote' && currentSourceUrl) {
    try {
      return new URL(currentSourceUrl).hostname;
    } catch {
      return 'Remote';
    }
  }
  if (currentSourceType === 'folder') return 'Folder';
  if (currentSourceType === 'file') return 'File';
  if (currentSourceType === 'pasted') return 'Pasted';
  return '';
}

function updateSourceUI() {
  const label = sourceLabel();
  sourceBadge.textContent = label;
  sourceBadge.classList.toggle('hidden', !label);
  reloadBtn.classList.toggle('hidden', currentSourceType !== 'remote' || !currentSourceUrl);
}

function showDocument({ content, fileName, filePath = null, sourceUrl = null, sourceType = 'file' }) {
  currentMarkdown = content;
  currentFileName = fileName || 'Untitled.md';
  currentFilePath = filePath;
  currentSourceUrl = sourceUrl;
  currentSourceType = sourceType;
  fileTitle.textContent = currentFileName;
  backBtn.classList.remove('hidden');
  updateSourceUI();
  closeFolderBrowser();
  renderMarkdown(currentMarkdown);
}

function resolveRemoteAssets() {
  if (!currentSourceUrl) return;
  markdownBody.querySelectorAll('img[src]').forEach((image) => {
    const source = image.getAttribute('src');
    if (!source || source.startsWith('data:')) return;
    image.src = MobileUtils.resolveRemoteUrl(source, currentSourceUrl);
  });
}

async function openExternalUrl(url) {
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
    await window.Capacitor.Plugins.Browser.open({ url });
  } else {
    window.open(url, '_blank');
  }
}

function formatFileSize(size) {
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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

// Extract leading YAML frontmatter so marked doesn't mangle it
function extractFrontmatter(content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { frontmatter: null, body: content };
  }
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return { frontmatter: null, body: content };
  }
  return { frontmatter: match[1], body: content.slice(match[0].length) };
}

function renderFrontmatterBlock(yaml) {
  return `<details class="md-frontmatter">` +
    `<summary class="md-frontmatter-summary">Frontmatter</summary>` +
    `<pre class="md-frontmatter-body"><code class="language-yaml">${escapeHtml(yaml)}</code></pre>` +
    `</details>`;
}

function renderMarkdown(mdContent) {
  try {
    fallbackHeadingSlugCounts = new Map();
    const { frontmatter, body } = extractFrontmatter(mdContent);
    const frontmatterHtml = frontmatter !== null ? renderFrontmatterBlock(frontmatter) : '';
    const html = frontmatterHtml + marked.parse(body);
    markdownBody.innerHTML = html;

    resolveRemoteAssets();
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

async function saveCurrentLocalFile() {
  if (!currentFilePath || !['file', 'folder'].includes(currentSourceType)) return false;
  const Filesystem = window.Capacitor && window.Capacitor.Plugins
    ? window.Capacitor.Plugins.Filesystem
    : null;
  if (!Filesystem) return false;

  try {
    await Filesystem.writeFile({
      path: currentFilePath,
      data: MobileUtils.encodeBase64Utf8(currentMarkdown)
    });
    showToast('Saved to Files');
    return true;
  } catch (error) {
    console.error('[Mobile] File save error:', error);
    showToast('Changes kept in the app, but iOS could not write back to this file', 'warning', 5000);
    return false;
  }
}

async function exitEditMode() {
  isEditMode = false;
  editorContainer.classList.add('hidden');
  contentEl.classList.remove('hidden');
  editBtn.classList.remove('active');

  if (easyMDE) {
    currentMarkdown = easyMDE.value();
  }

  // Re-render with updated content
  renderMarkdown(currentMarkdown);
  await saveCurrentLocalFile();
}

async function toggleEditMode() {
  if (isEditMode) {
    await exitEditMode();
  } else {
    enterEditMode();
  }
}

// ---- File Opening via Capacitor ----
async function readNativeTextFile(filePath) {
  const Filesystem = window.Capacitor && window.Capacitor.Plugins
    ? window.Capacitor.Plugins.Filesystem
    : null;
  if (!Filesystem) throw new Error('Filesystem is unavailable');
  const contents = await Filesystem.readFile({ path: filePath });
  return MobileUtils.decodeBase64Utf8(contents.data);
}

async function loadPickedFile(file, sourceType = 'file') {
  const filePath = file.path || file.uri || null;
  let content = '';
  if (file.data) {
    content = MobileUtils.decodeBase64Utf8(file.data);
  } else if (filePath) {
    content = await readNativeTextFile(filePath);
  } else {
    throw new Error('The selected file did not provide readable data');
  }

  showDocument({
    content,
    fileName: file.name || filePath.split('/').pop() || 'Untitled.md',
    filePath,
    sourceType
  });
}

async function openFile() {
  try {
    if (window.Capacitor && window.Capacitor.Plugins) {
      const { FilePicker } = window.Capacitor.Plugins;
      if (FilePicker) {
        const result = await FilePicker.pickFiles({
          types: [
            'text/markdown',
            'text/plain',
            'text/x-markdown',
            'application/json',
            'application/xml',
            'application/yaml'
          ],
          limit: 1,
          readData: false
        });
        if (result && result.files && result.files.length > 0) {
          await loadPickedFile(result.files[0]);
          return;
        }
      }
    }

    // Fallback: use HTML file input
    openFileViaInput();
  } catch (err) {
    console.error('[Mobile] File open error:', err);
    showToast('Could not open that file', 'error');
  }
}

function openFolderBrowser() {
  folderBrowser.classList.remove('hidden');
  folderBrowserBackdrop.classList.remove('hidden');
}

function closeFolderBrowser() {
  folderBrowser.classList.add('hidden');
  folderBrowserBackdrop.classList.add('hidden');
}

async function showFolder(folderPath, pushCurrent = false) {
  const Filesystem = window.Capacitor && window.Capacitor.Plugins
    ? window.Capacitor.Plugins.Filesystem
    : null;
  if (!Filesystem) throw new Error('Filesystem is unavailable');

  if (pushCurrent && currentFolderPath) folderPathStack.push(currentFolderPath);
  currentFolderPath = folderPath;
  folderBrowserTitle.textContent = folderPath.split('/').filter(Boolean).pop() || 'Folder';
  folderBrowserPath.textContent = folderPath;
  folderUpBtn.classList.toggle('hidden', folderPathStack.length === 0);
  folderBrowserList.innerHTML = '<div class="folder-browser-empty">Loading…</div>';
  openFolderBrowser();

  const result = await Filesystem.readdir({ path: folderPath });
  const entries = (result.files || [])
    .filter((entry) => entry.type === 'directory' || MobileUtils.isSupportedFileName(entry.name))
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    });

  folderBrowserList.innerHTML = '';
  if (entries.length === 0) {
    folderBrowserList.innerHTML = '<div class="folder-browser-empty">No readable Markdown or text files here.</div>';
    return;
  }

  entries.forEach((entry) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'folder-browser-item';
    const icon = entry.type === 'directory' ? '▸' : '◫';
    button.innerHTML = `
      <span class="folder-browser-item-icon">${icon}</span>
      <span class="folder-browser-item-name"></span>
      <span class="folder-browser-item-meta">${entry.type === 'file' ? formatFileSize(entry.size) : ''}</span>
    `;
    button.querySelector('.folder-browser-item-name').textContent = entry.name;
    button.addEventListener('click', async () => {
      try {
        if (entry.type === 'directory') {
          await showFolder(entry.uri, true);
        } else {
          await loadPickedFile({ name: entry.name, path: entry.uri }, 'folder');
        }
      } catch (error) {
        console.error('[Mobile] Folder entry error:', error);
        showToast('Could not open that item', 'error');
      }
    });
    folderBrowserList.appendChild(button);
  });
}

async function openFolder() {
  try {
    const FilePicker = window.Capacitor && window.Capacitor.Plugins
      ? window.Capacitor.Plugins.FilePicker
      : null;
    if (!FilePicker || typeof FilePicker.pickDirectory !== 'function') {
      showToast('Folder browsing requires the iOS app', 'warning');
      return;
    }
    const result = await FilePicker.pickDirectory();
    if (!result || !result.path) return;
    currentFolderRoot = result.path;
    currentFolderPath = null;
    folderPathStack = [];
    await showFolder(currentFolderRoot);
  } catch (error) {
    if (String(error && error.message || '').toLowerCase().includes('cancel')) return;
    console.error('[Mobile] Folder open error:', error);
    showToast('Could not browse that folder', 'error');
  }
}

async function openRemoteUrl(value, { reload = false } = {}) {
  let remoteUrl;
  try {
    remoteUrl = MobileUtils.normalizeRemoteUrl(value);
  } catch (error) {
    showToast(error.message, 'warning');
    remoteUrlInput.focus();
    return;
  }

  remoteUrlSubmit.disabled = true;
  remoteUrlSubmit.textContent = reload ? 'Reloading…' : 'Opening…';
  try {
    const response = await fetch(remoteUrl, {
      headers: {
        Accept: 'text/markdown,text/plain,text/*,application/json,application/xml,application/yaml,*/*;q=0.2'
      }
    });
    if (!response.ok) throw new Error(`Remote server returned HTTP ${response.status}`);

    const contentType = response.headers.get('content-type') || '';
    if (!MobileUtils.isTextLikeContentType(contentType)
      && !MobileUtils.isSupportedFileName(new URL(response.url || remoteUrl).pathname)) {
      throw new Error(`Remote file does not look like text (${contentType || 'unknown type'})`);
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_REMOTE_FILE_BYTES) throw new Error('Remote file is larger than 15 MB');
    const content = await response.text();
    if (new Blob([content]).size > MAX_REMOTE_FILE_BYTES) {
      throw new Error('Remote file is larger than 15 MB');
    }

    const finalUrl = response.url || remoteUrl;
    showDocument({
      content,
      fileName: MobileUtils.remoteFileName(finalUrl),
      sourceUrl: finalUrl,
      sourceType: 'remote'
    });
    remoteUrlInput.value = finalUrl;
    if (reload) showToast('Remote file refreshed');
  } catch (error) {
    console.error('[Mobile] Remote open error:', error);
    showToast(`Could not open remote file: ${error.message}`, 'error', 5000);
  } finally {
    remoteUrlSubmit.disabled = false;
    remoteUrlSubmit.textContent = 'Open';
  }
}

function openFileViaInput() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.md,.markdown,.txt,.text,.mdx,.mdown,.json,.jsonl,.yaml,.yml,.xml,.csv,.log';
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    showDocument({
      content: text,
      fileName: file.name,
      sourceType: 'file'
    });
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
  const returnToFolder = currentSourceType === 'folder' && !!currentFolderPath;
  // Destroy EasyMDE if active
  if (easyMDE) {
    easyMDE.toTextArea();
    easyMDE = null;
  }
  isEditMode = false;

  currentMarkdown = '';
  currentFileName = '';
  currentFilePath = null;
  currentSourceUrl = null;
  currentSourceType = null;
  fileTitle.textContent = 'OpenMarkdownReader';
  backBtn.classList.add('hidden');
  reloadBtn.classList.add('hidden');
  sourceBadge.classList.add('hidden');
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
  updateSourceUI();
  if (returnToFolder) openFolderBrowser();
}

// ---- Event Listeners ----

// Toolbar
backBtn.addEventListener('click', goBack);
reloadBtn.addEventListener('click', () => {
  if (currentSourceUrl) openRemoteUrl(currentSourceUrl, { reload: true });
});
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

// Folder browser
folderBrowserClose.addEventListener('click', closeFolderBrowser);
folderBrowserBackdrop.addEventListener('click', closeFolderBrowser);
folderUpBtn.addEventListener('click', async () => {
  const previousPath = folderPathStack.pop();
  if (!previousPath) return;
  try {
    await showFolder(previousPath);
  } catch (error) {
    console.error('[Mobile] Parent folder error:', error);
    showToast('Could not return to that folder', 'error');
  }
});

// Welcome
openFileBtn.addEventListener('click', openFile);
openFolderBtn.addEventListener('click', openFolder);
remoteUrlForm.addEventListener('submit', (event) => {
  event.preventDefault();
  openRemoteUrl(remoteUrlInput.value);
});

pasteArea.addEventListener('input', () => {
  renderPasteBtn.classList.toggle('hidden', !pasteArea.value.trim());
});

renderPasteBtn.addEventListener('click', () => {
  const text = pasteArea.value.trim();
  if (!text) return;
  showDocument({
    content: text,
    fileName: 'Pasted Content',
    sourceType: 'pasted'
  });
});

// Bottom bar
bottomOpenBtn.addEventListener('click', openFile);
bottomCopyBtn.addEventListener('click', copyMarkdown);
bottomShareBtn.addEventListener('click', shareContent);

// Handle links in rendered markdown
markdownBody.addEventListener('click', async (e) => {
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

  const resolvedHref = currentSourceUrl
    ? MobileUtils.resolveRemoteUrl(href, currentSourceUrl)
    : href;
  if (!/^https?:\/\//i.test(resolvedHref)) return;

  e.preventDefault();
  if (MobileUtils.isMarkdownLikeUrl(resolvedHref)) {
    await openRemoteUrl(resolvedHref);
  } else {
    await openExternalUrl(resolvedHref);
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
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    const handleAppUrl = async (value) => {
      if (!value) return;
      console.log('[Mobile] App URL opened:', value);
      try {
        if (/^https?:\/\//i.test(value)) {
          remoteUrlInput.value = value;
          await openRemoteUrl(value);
          return;
        }
        if (value.startsWith('file://')) {
          await loadPickedFile({
            name: decodeURIComponent(value.split('/').pop() || 'Shared File'),
            path: value
          });
        }
      } catch (error) {
        console.error('[Mobile] Failed to open incoming URL:', error);
        showToast('Failed to open file', 'error');
      }
    };

    window.Capacitor.Plugins.App.addListener('appUrlOpen', (data) => handleAppUrl(data.url));
    if (typeof window.Capacitor.Plugins.App.getLaunchUrl === 'function') {
      window.Capacitor.Plugins.App.getLaunchUrl()
        .then((result) => handleAppUrl(result && result.url))
        .catch((error) => console.warn('[Mobile] Launch URL unavailable:', error));
    }
  }
});

console.log('[Mobile] OpenMarkdownReader mobile renderer loaded');
