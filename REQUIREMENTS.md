# OpenMarkdownReader - Product Requirements

## Core Principle: Agent-Native Design

**Added:** 2026-04-02
**Status:** Active — applies to all current and future features

Every feature in OpenMarkdownReader must be fully controllable via CLI and programmatic interfaces, not just the GUI. This is a first-class design constraint, not an afterthought.

### Rules

1. **CLI parity**: Every action available in the UI must also be triggerable via `omr --cmd <command>`. No GUI-only features.
2. **State is queryable**: Agents must be able to read the full app state — open tabs, active tab, edit mode, sidebar state, scroll position, dirty flags, window geometry — via `omr --cmd get-state`.
3. **Events are observable**: Agents can subscribe to a real-time event stream (`omr --cmd watch`) covering file saves, tab switches, mode changes, content edits, and app lifecycle events.
4. **Headless operation**: The app should support a headless/no-window mode for CI pipelines, batch processing, and server-side rendering of markdown.
5. **Structured output**: All CLI query commands return JSON to stdout. Errors go to stderr with non-zero exit codes.
6. **New features ship with CLI commands**: When adding a new feature (e.g., comments, history, publish), the PR must include the corresponding `omr --cmd` subcommands and document them.
7. **Local-first**: Core functionality must work fully offline with no network calls. Network features (publish, update checks, feedback widgets) are opt-in and clearly separated.

### Transport

- Unix domain socket at `~/Library/Application Support/OpenMarkdownReader/omr.sock`
- The running Electron app listens on this socket
- The `omr` CLI connects to the socket for `--cmd` operations
- Falls back to launching the app if no socket is found

### Implications for Planned Features

| Feature | CLI Commands Required |
|---------|----------------------|
| **Comments** (`markdown-reader-4yq`) | `omr --cmd add-comment`, `list-comments`, `delete-comment`, `export-comments` |
| **History** (`markdown-reader-st8`) | `omr --cmd list-history`, `go-back`, `go-forward`, `get-history-entry` |
| **Publish** | `omr --cmd publish`, `get-publish-url`, `unpublish` |
| **Local-only mode** (`markdown-reader-xwc`) | `omr --cmd set network-mode offline`, `get network-mode` |

---

## Feature: One-Click Publish

**Added:** 2026-01-14
**Status:** Planned

### Overview

Add a "Publish" button that instantly uploads the current markdown document and copies a shareable URL to the clipboard. Recipients see a beautifully rendered version of the document.

### User Flow

1. User clicks "Publish" button (toolbar or Cmd+Shift+P)
2. Markdown content is uploaded to the publish service
3. URL is copied to clipboard automatically
4. Toast notification: "Link copied! share.openmarkdown.com/x7k2m"
5. Recipient opens URL → sees styled, read-only markdown

### Architecture

```
┌─────────────────────┐         ┌──────────────────────────┐
│  Electron App       │         │  Cloudflare Worker       │
│                     │         │                          │
│  [Publish Button]   │────────▶│  POST /publish           │
│                     │   POST  │    - Store in KV         │
│  ← URL copied       │◀────────│    - Return short ID     │
└─────────────────────┘         │                          │
                                │  GET /:id                │
        Recipient ─────────────▶│    - Fetch from KV       │
                                │    - Render HTML + CSS   │
                                └──────────────────────────┘
```

### Backend: Cloudflare Worker + KV

**Why Cloudflare:**
- Free tier: 100k requests/day, 1GB KV storage
- Global edge network (fast everywhere)
- Zero infrastructure to maintain
- Free subdomain: `yourname.workers.dev`

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/publish` | Upload markdown, returns `{ id, url }` |
| `GET` | `/:id` | Render markdown as styled HTML |
| `GET` | `/:id/raw` | Return raw markdown (optional) |

**Storage (KV):**
```json
{
  "key": "x7k2m",
  "value": {
    "markdown": "# Hello World\n\nThis is my document...",
    "title": "Hello World",
    "createdAt": "2026-01-14T10:30:00Z"
  }
}
```

**Short ID generation:**
- 5-6 character alphanumeric (base62)
- ~57 billion combinations, collision-resistant
- Example: `x7k2m`, `Abc123`

### Frontend (Electron App)

**UI Elements:**
- Toolbar button with share/publish icon
- Keyboard shortcut: Cmd+Shift+P (Mac) / Ctrl+Shift+P (Windows)
- Toast notification showing the copied URL
- Optional: "Published" indicator if current doc is already published

**Implementation:**
1. Add publish button to toolbar in `index.html`
2. Add IPC handler in `main.js` for clipboard operations
3. Add publish logic in `renderer.js`:
   - `POST` to Cloudflare Worker
   - Copy returned URL to clipboard
   - Show toast notification

### Rendered Page Styling

The published page should:
- Use clean, readable typography
- Support dark/light mode (match system preference)
- Be mobile-responsive
- Show document title in browser tab
- Optionally show "Made with OpenMarkdownReader" footer

**CSS considerations:**
- Use the same markdown rendering styles as the app
- Or create a simplified, web-optimized stylesheet
- Syntax highlighting for code blocks (highlight.js or Prism)

### Future Enhancements (v2+)

| Feature | Description |
|---------|-------------|
| **Custom slugs** | `share.site.com/my-project-notes` instead of random ID |
| **Expiration** | Links expire after N days (configurable) |
| **Password protection** | Require password to view |
| **Edit token** | Secret URL to update published content |
| **Custom domain** | `share.openmarkdownreader.com` |
| **Analytics** | View count (privacy-respecting) |
| **Delete** | Ability to unpublish |

### Implementation Plan

**Phase 1: Backend (Cloudflare Worker)**
1. Set up Cloudflare account and Workers project
2. Implement `POST /publish` endpoint
3. Implement `GET /:id` endpoint with markdown rendering
4. Deploy and test with curl
5. Add nice CSS styling for rendered pages

**Phase 2: Electron Integration**
1. Add "Publish" button to toolbar
2. Implement publish API call in renderer
3. Add clipboard copy functionality
4. Add toast notification
5. Add keyboard shortcut

**Phase 3: Polish**
1. Loading state while publishing
2. Error handling (network failures, etc.)
3. "Already published" detection (optional)
4. Mobile-responsive styling for published pages

### Cost

| Tier | Monthly Cost | Limits |
|------|--------------|--------|
| Free | $0 | 100k requests/day, 1GB KV, 1k writes/day |
| Paid | ~$5 | 10M requests/month, more KV |

For personal/small-scale use, free tier is more than sufficient.

---

## Other Features

(Add future feature requirements here)
