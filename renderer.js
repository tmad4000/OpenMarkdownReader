// marked and hljs are loaded from CDN in index.html

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
  console.log('Open button clicked');
  window.electronAPI.openFileDialog();
});

// Listen for file loaded from main process
window.electronAPI.onFileLoaded((data) => {
  console.log('File loaded:', data.fileName);
  renderMarkdown(data.content);
});

function renderMarkdown(mdContent) {
  console.log('Rendering markdown, length:', mdContent.length);
  try {
    const html = marked.parse(mdContent);
    console.log('Parsed HTML length:', html.length);
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

console.log('Renderer loaded, marked available:', typeof marked !== 'undefined');
console.log('hljs available:', typeof hljs !== 'undefined');
