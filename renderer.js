const { Marked } = require('marked');
const hljs = require('highlight.js');

// Configure marked with syntax highlighting
const marked = new Marked({
  gfm: true,
  breaks: false,
  pedantic: false
});

// Custom renderer for syntax highlighting
marked.use({
  renderer: {
    code(token) {
      const lang = token.lang || '';
      const code = token.text;

      if (lang && hljs.getLanguage(lang)) {
        try {
          const highlighted = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
          return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
        } catch (err) {
          // Fall through to default
        }
      }

      // Auto-detect language or use plain text
      try {
        const highlighted = hljs.highlightAuto(code).value;
        return `<pre><code class="hljs">${highlighted}</code></pre>`;
      } catch (err) {
        return `<pre><code>${escapeHtml(code)}</code></pre>`;
      }
    },

    // Task list support
    listitem(token) {
      let text = token.text;
      if (token.task) {
        const checkbox = `<input type="checkbox" ${token.checked ? 'checked' : ''} disabled>`;
        text = checkbox + text;
        return `<li class="task-list-item">${text}</li>\n`;
      }
      return `<li>${text}</li>\n`;
    }
  }
});

function escapeHtml(text) {
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
const dropZone = document.getElementById('drop-zone');
const content = document.getElementById('content');
const markdownBody = document.getElementById('markdown-body');
const openBtn = document.getElementById('open-btn');

// Open file button
openBtn.addEventListener('click', () => {
  window.electronAPI.openFileDialog();
});

// Listen for file loaded from main process
window.electronAPI.onFileLoaded((data) => {
  renderMarkdown(data.content);
});

function renderMarkdown(mdContent) {
  const html = marked.parse(mdContent);
  markdownBody.innerHTML = html;

  // Show content, hide welcome
  dropZone.classList.add('hidden');
  content.classList.remove('hidden');

  // Scroll to top
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

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    const file = files[0];
    if (isMarkdownFile(file.name)) {
      const reader = new FileReader();
      reader.onload = (event) => {
        renderMarkdown(event.target.result);
        document.title = `${file.name} - Markdown Reader`;
      };
      reader.readAsText(file);
    }
  }
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

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    const file = files[0];
    if (isMarkdownFile(file.name)) {
      const reader = new FileReader();
      reader.onload = (event) => {
        renderMarkdown(event.target.result);
        document.title = `${file.name} - Markdown Reader`;
      };
      reader.readAsText(file);
    }
  }
});
