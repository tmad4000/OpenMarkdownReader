# Handoff List — Things To Pick Up

Tickets you can grab from `bd ready`. Organized from easiest to hardest, and split between "ready to claim cold" vs "needs Jacob's input first".

For full ticket details: `bd show <id>`

## ✅ Ready to Claim (well-scoped, no design questions)

### Small (a few hours each)

| ID | What | Why it's ready |
|---|---|---|
| **markdown-reader-trs** | P2 — Open markdown from URL in Cmd+P | Cmd+P already detects URLs (`isUrl` at renderer.js:4602) but currently calls `openExternal`. Replace with: fetch URL via `electron net`, parse as markdown, open as a new tab. The hard part (URL detection + UI) is done. |
| **markdown-reader-n36** | P3 — Breadcrumb path bar above content | Has explicit acceptance criteria. Add a `<div class="breadcrumb">` above `#content`, populate from `tab.filePath`. Each segment is clickable → expands sidebar to that folder. |
| **markdown-reader-f9j** | P3 — More App Store screenshots | Just take 4-5 screenshots in different modes (light/dark, edit/preview, sidebar open). Update App Store Connect listing manually. Needs nothing but a working app and the App Store Connect login. |
| **markdown-reader-6v2** | P3 — Audit Settings vs View menu placement | Walk through both menus, write up which controls feel misplaced. Output: a short doc + concrete proposed moves. |

### Medium (1-2 days each)

| ID | What | Why it's ready |
|---|---|---|
| **markdown-reader-0d4** | P2 — Advanced global search controls (case, regex, glob, replace) | Acceptance criteria is explicit. Existing global search (`Cmd+Shift+F`) is the foundation — extend the input bar with toggle buttons + add `caseSensitive`/`regex` flags through to the search function. |
| **markdown-reader-lzy** | P2 — DOCX import/export | Use `mammoth` (DOCX→HTML→markdown via turndown) and `docx` (markdown→DOCX). Both are well-maintained npm packages. Acceptance criteria covers the four user-visible flows. |
| **markdown-reader-ztt** | P2 — Audit MAS sandbox-unsafe code paths | Has an explicit suspect list in the ticket. Walk each one, classify safe/unsafe under sandbox, add `isMASBuild()` gates or surface error toasts. Output: an audit doc + the gating PRs. |

## ⚠️ Needs Jacob's Input First

These have real architectural or product decisions that aren't safe to guess at.

| ID | What | What Jacob needs to decide |
|---|---|---|
| **markdown-reader-r1r** | P2 — WYSIWYG via Milkdown | Now unblocked (a4h is fixed). Needs a build-system call (Milkdown isn't a CDN drop-in like EasyMDE). Jacob: greenlight + pick build pipeline (esbuild? vite?). |
| **markdown-reader-mwv** | P2 — VS Code-style split editor | Major UI architecture change. Affects tabs, sidebar, command palette, persistence. Jacob: confirm priority + scope (split current tab? split between tabs? both?). |
| **markdown-reader-msv** | P2 — Web-based markdown viewer | Whole new project. Hosting? Domain? Integrate with noos? Jacob: define the strategy. |
| **markdown-reader-kq3** | P2 — Escape to exit edit mode | Now unblocked (a4h is fixed). 3 behavior options in the ticket. Jacob: pick option 1/2/3. |
| **markdown-reader-st8** | P2 — Browsing/navigation history | Needs UX design — sidebar panel? menu? popover? Visible per-tab or global? |
| **markdown-reader-xwc** | P2 — Local-only / offline-first mode | Needs scope: which features get gated? Define what "local-only" means precisely (no telemetry? no auto-updates? no font CDN? all of the above?). |
| **markdown-reader-o3m** | P2 — Auto-parse AI chat transcripts | Many sub-features in the ticket (visual styling, collapse, ANSI preservation, layout). Needs Jacob to pick the v1 slice. |
| **markdown-reader-4yq** | P2 — Document comments | Has `defer` label. Big feature, lots of UX questions. Jacob revisits when ready. |
| **markdown-reader-b79** | P3 — Diff / track-changes mode | Big feature. Needs design — VS Code-style inline? Side-by-side compare? Word-level vs line-level? |

### Recently closed (don't re-open)

- ✅ **a4h** — Editor-per-tab refactor done. Tab switches and preview toggles now preserve undo. Within-tab rich/plain toggle still loses undo on the OLD mode (tracked separately as **iqz**, P3).
- ✅ **7qf** — Open folder as project shipped: sidebar right-click "Open in New Window" + Cmd+P folder selection. Bonus: `omr --cmd open /path --new-window` for headless testing.
- ✅ **ie3** — Wikilink resolver fixed.
- ✅ **av2** — Chat code fence corruption fixed.
- ✅ **d12** — Cmd+P tilde expansion fixed (single fix in `open-file-by-path` IPC).
- ✅ **r12** — Sidebar collapse-all button shipped.
- ✅ **hjc** — Per-build incrementing build numbers + visible build pill on packaged builds.

## ❌ Don't Touch

| ID | Why |
|---|---|
| **markdown-reader-e7r** | Far-future collaboration ticket — explicitly "do not work on without explicit user green-light". Parking ticket only. |
| **markdown-reader-rhj/ypl/nzs/qn6** | P4 format-support tickets (RTF/Marktree/Obsidian/terminal-paste). Not high-priority enough to block on. |

## Workflow

```bash
# 1. Pick a ticket
bd ready
bd show markdown-reader-<id>

# 2. Claim it
bd update markdown-reader-<id> --status=in_progress

# 3. Branch off feature/daily-notes
git checkout feature/daily-notes
git pull
git checkout -b your-name/<short-description>

# 4. Build, test, verify with omr --cmd
npm start

# 5. Commit + push + open PR targeting feature/daily-notes
git push -u origin your-name/<short-description>
gh pr create --base feature/daily-notes

# 6. Close the ticket when merged
bd close markdown-reader-<id>
bd sync
```

## Heuristics

- **If a ticket's description has options A/B/C, ask Jacob which.** Don't guess.
- **If you see "blocked by N" in `bd list`, run `bd show` first** — the blocker might still need fixing.
- **Match scope to ticket priority.** P1 = ship now, P2 = soon, P3 = nice-to-have, P4 = backlog.
- **Read the existing code before adding more.** The renderer.js is dense but well-organized; trace existing patterns.
- **Test via `omr --cmd`** instead of clicking around. Faster feedback loop, scriptable.
