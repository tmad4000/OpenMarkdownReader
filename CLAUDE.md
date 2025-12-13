# OpenMarkdownReader - Claude Code Instructions

## Running the App

```bash
npm start
```

## Building and Installing

After making changes, build and install to Applications:

```bash
# Build the Mac app (universal binary for Intel + Apple Silicon)
npm run build:mac

# Install to Applications (preserves "Open With" default associations)
cp -R dist/mac-universal/OpenMarkdownReader.app /Applications/
```

## Releasing

To update the GitHub release with a new build:

```bash
# Build first
npm run build:mac

# Upload to existing release (replaces old assets)
gh release upload v1.0.0 dist/OpenMarkdownReader-1.0.0-universal.dmg dist/OpenMarkdownReader-1.0.0-universal-mac.zip --clobber
```

## Project Structure

- `main.js` - Electron main process (window management, IPC handlers, menus)
- `renderer.js` - Renderer process (UI logic, tab management, editor)
- `preload.js` - IPC bridge between main and renderer
- `index.html` - Main HTML structure
- `styles.css` - All styling including EasyMDE overrides
