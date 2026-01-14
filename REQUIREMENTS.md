# OpenMarkdownReader - Product Requirements

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
