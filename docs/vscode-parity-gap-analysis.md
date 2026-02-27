# VS Code Parity Gap Analysis (markdown-reader-br6)

## Scope
Compared markdown-reader UX against common VS Code workflows for:
- Navigation
- Sidebar / explorer
- Tabs
- Search
- Rename / move
- Context menus
- Split editors
- Update flow

Goal: identify obvious parity gaps, prioritize by user impact, and map each gap to bd issues.

## Prioritized Gaps And Recommendations

| Priority | Gap | User Impact | Recommendation | bd Mapping |
|---|---|---|---|---|
| P1 | `Cmd+F` find input loses focus after first character | Breaks core in-file search workflow | Fix focus retention and regression-test keyboard search loop (open -> type -> next/prev). | `markdown-reader-b90` |
| P1 | Back/forward history can fail to reflect real tab/file navigation | Navigation feels unreliable vs editor norms | Ensure every tab switch/open path pushes history consistently; keep back/forward button state synchronized. | `markdown-reader-i20` |
| P1 | Explorer does not stay in sync with external filesystem changes | Sidebar becomes stale after external edits | Add live directory watchers with targeted refresh and debounce; preserve expansion/selection state on refresh. | `markdown-reader-39u` |
| P1 | Rename/move behavior is not yet VS Code-consistent across UI and disk events | High risk of broken references/confusing state | Unify rename entry points (context menu + double-click) and reconcile external rename/move to open tabs and tree items. | `markdown-reader-7lp`, `markdown-reader-2ww` |
| P2 | No split editor (side-by-side) workflow | Blocks compare/reference workflows common in VS Code | Add two-pane split with tab-to-split actions and resizable divider. | `markdown-reader-mwv` |
| P2 | Sidebar width is fixed | Poor adaptation for long filenames/deep paths | Add drag handle with persisted width and min/max constraints. | `markdown-reader-dvb` |
| P2 | Content-area right-click lacks full native macOS editing actions | Feels non-native, lowers trust in editor | Provide standard native context menu actions where relevant (copy/paste/look up/speech). | `markdown-reader-ytp` |
| P2 | File-tree operations are still fragmented vs standard explorer flows | Extra clicks for common organizer actions | Complete direct-in-folder file creation, drag/drop moves, and open-in-finder from all relevant surfaces. | `markdown-reader-8ls`, `markdown-reader-7gp`, `markdown-reader-ds7` |
| P2 | Active location clarity in explorer/tabs is weaker than VS Code | Harder to orient in large workspaces | Highlight active file in tree, improve path discoverability, and make sort mode explicit. | `markdown-reader-09i`, `markdown-reader-j45`, `markdown-reader-av3` |
| P2 | Search UX lacks standard power controls (match case/regex/include-exclude/replace) | Limits real project-wide search workflows | Extend global search UI with advanced filters and replacement actions while preserving keyboard-first flow. | `markdown-reader-0d4` (new) |
| P2 | Update flow is less explicit than standard desktop editor UX | Users may miss updates or current state | Add explicit menu entry for status/check/apply updates, aligned with passive indicator. | `markdown-reader-jbx` |
| P3 | No breadcrumb path bar for active file | Higher navigation friction in nested folders | Add clickable workspace-relative breadcrumbs synced to tab changes and file moves. | `markdown-reader-n36` (new) |

## Existing Coverage Notes
- Global search baseline already exists and is shipped: `markdown-reader-6ct`.
- Initial back/forward feature shipped previously (`markdown-reader-vji`), with reliability follow-up tracked in `markdown-reader-i20`.
- Content-area tab menu parity shipped (`markdown-reader-4go`), with native macOS action parity tracked in `markdown-reader-ytp`.

## Suggested Execution Order
1. Stabilize core workflows first (all P1 issues).
2. Ship high-frequency editor ergonomics (split, sidebar resize, context menu, explorer operations).
3. Add power-user navigation/search layers (advanced search controls, breadcrumbs).
