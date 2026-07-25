# OpenMarkdownReader

**Homepage:** [wikihub.md/openmarkdownreader](http://wikihub.md/openmarkdownreader)

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
- Read-only remote folder browsing over HTTP(S), including Tailscale URLs
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
5. **Browse a remote folder**: Click the globe button in the sidebar and paste an HTTP(S) directory URL

### Remote folders

OpenMarkdownReader can turn common HTML directory indexes (including
`python3 -m http.server`, Apache, and nginx auto-index pages) into a lazy,
read-only sidebar tree. It also accepts a JSON manifest:

```json
{
  "name": "Project Notes",
  "entries": [
    { "name": "README.md", "path": "README.md" },
    { "name": "Research", "type": "folder", "path": "research/" }
  ]
}
```

For a private machine, serve the folder on localhost and expose it with
Tailscale Serve. Paste the resulting HTTPS folder URL into the globe-button
dialog. Quick Open (`⌘P`) also offers both **Open Remote File** and
**Browse Remote Folder** when you paste a URL.

## Supported File Types

- `.md`
- `.markdown`
- `.mdown`
- `.mkd`
- `.txt`

## Notes & Future Plans

### App Size (~200MB)

The app is large because Electron bundles a full Chromium browser. This is standard for Electron apps (VS Code, Slack, Discord are similar sizes). The universal binary (ARM + Intel) doubles the size.

**Potential optimizations (no current intent to implement):**
- Build single-architecture versions (~100MB each for ARM or Intel separately)
- Port to Tauri (~15-20MB) which uses the system webview instead of bundling Chromium
- Port to Neutralino (~3-5MB) for even smaller size

For now, the convenience of Electron's development experience outweighs the size concern.
