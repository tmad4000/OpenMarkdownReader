# OpenMarkdownReader

A beautiful, open-source Markdown file reader and editor for Mac built with Electron.

## Features

- Clean, GitHub-style markdown rendering
- Syntax highlighting for code blocks
- Dark mode support (follows system preference)
- Drag and drop file support
- Native Mac title bar with traffic lights
- Multi-tab and multi-window support
- Edit mode with live preview toggle (⌘E)
- File browser sidebar with folder navigation
- Adjustable content width
- GFM (GitHub Flavored Markdown) support including:
  - Tables
  - Task lists
  - Strikethrough
  - Autolinks

## Running

```bash
npm start
```

## Keyboard Shortcuts

- `⌘O` - Open file
- `⌘T` - New tab
- `⌘W` - Close tab
- `⌘E` - Toggle edit mode
- `⌘S` - Save
- `⌘B` - Toggle sidebar
- `Escape` - Cancel/revert edits
- `Ctrl+Tab` - Next tab
- `Ctrl+Shift+Tab` - Previous tab

## Usage

1. **Open a file**: Click "Open File" or press `⌘O`
2. **Drag and drop**: Drop a `.md` file onto the window
3. **Edit**: Press `⌘E` to toggle edit mode
4. **Browse folders**: Click the sidebar toggle and open a folder

## Supported File Types

- `.md`
- `.markdown`
- `.mdown`
- `.mkd`
- `.txt`
