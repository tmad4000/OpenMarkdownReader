// marked and hljs are loaded from CDN in index.html

// Configure marked with syntax highlighting
marked.setOptions({
  gfm: true,
  breaks: false,
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch (err) {
        // Fall through
      }
    }
    try {
      return hljs.highlightAuto(code).value;
    } catch (err) {
      return escapeHtml(code);
    }
  }
});

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

  // Apply syntax highlighting to code blocks
  document.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block);
  });

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
