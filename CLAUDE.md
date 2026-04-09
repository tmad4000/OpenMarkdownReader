# OpenMarkdownReader - Claude Code Instructions

## Running the App

```bash
npm start
```

## Building and Installing

### Fast local dev install (no notarization)

For iterating on local changes — builds an arm64-only, signed-but-not-notarized `.app` and installs it over `/Applications/OpenMarkdownReader.app`. Takes ~90 seconds vs ~5+ minutes for the full release build. Bundle ID is unchanged so the system default `.md` handler keeps working.

```bash
npm run install-dev
```

First launch after install may show a Gatekeeper "unknown developer" prompt (unsigned quarantine bit); click Open Anyway and it's trusted forever.

### Full release build (universal, notarized)

For releases that go up on GitHub:

```bash
# Requires APPLE_API_KEY env vars (see memory/ for notarization setup)
npm run build:mac

# Install to Applications (ditto preserves code signatures; cp -R breaks them!)
ditto dist/mac-universal/OpenMarkdownReader.app /Applications/OpenMarkdownReader.app
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
