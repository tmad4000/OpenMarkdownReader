# OpenMarkdownReader TODO

## Next Up

- [ ] **Fix Watch Mode**: Not persisting to config (resets on restart) - should save like Auto Save does
- [ ] **Move Watch Mode to Settings**: Currently in View menu, should be in Settings next to Auto Save
- [ ] **Tab Hover Tooltip**: Show the full file path when hovering over a tab
- [ ] **Tab Right-Click Context Menu**: VS Code-style menu with options like:
  - Open in Finder / Reveal in Finder
  - Copy Path
  - Copy Relative Path
  - Close Tab
  - Close Other Tabs
  - Close Tabs to the Right

## Future Features

- [ ] Make a proper Markdown editor (syntax highlighting, toolbar, live preview side-by-side)
- [ ] Auto-update functionality (using electron-updater with GitHub Releases)
- [ ] Mac App Store submission

## Missing Features Analysis (Gap Analysis)

### Core Editor Experience
- [ ] **Syntax Highlighting**: The current `textarea` lacks code coloring. Need to integrate a proper code editor component (e.g., CodeMirror, Monaco, or Ace) to support markdown syntax highlighting.
- [ ] **Split View**: Ability to view Editor and Preview side-by-side (currently only toggle).
- [ ] **Scroll Sync**: Synchronized scrolling between Editor and Preview panes.
- [ ] **Editing Toolbar**: Buttons for common formatting (Bold, Italic, Lists, Links, Images) to assist users unfamiliar with Markdown syntax.
- [ ] **Smart Editing**: Auto-closing brackets/quotes, auto-continuation of lists.
- [ ] **Line Numbers**: Essential for code editing and error tracking.

### Content Handling
- [ ] **Image Handling**: Drag-and-drop images into editor, paste images from clipboard (automatically saving them to an `assets` folder).
- [ ] **Math Support**: Rendering LaTeX equations (e.g., KaTeX or MathJax).
- [ ] **Diagrams**: Support for Mermaid.js or PlantUML for code-defined diagrams.
- [ ] **Task Lists**: Interactive checkboxes in Preview mode that update the source text.
- [ ] **Frontmatter Support**: better visualization or hiding of YAML frontmatter.

### Application Features
- [ ] **Crash Recovery / Draft Persistence**: Auto-save unsaved buffer content to a temp/drafts folder periodically. On app restart, detect and offer to recover unsaved drafts. Would protect against crashes and enable workflows with truly temporary scratch files.
- [ ] **Auto-Save**: (Needs thought - potentially dangerous/annoying) Option to automatically save changes after a delay or on focus loss.
- [ ] **Spell Checker**: Integrated spell checking for the editor.
- [ ] **Word Count & Stats**: Status bar display for words, characters, and reading time.
- [ ] **Search & Replace**: Full find/replace functionality within the editor (current "Find" is read-only highlighting).
- [ ] **Distraction-Free Mode**: Toggle to hide all UI elements (sidebar, tab bar) for focused writing.
- [ ] **Theme Customization**: Ability for users to define custom CSS for the preview.

## Brainstorm / Maybe Later

These are ideas that might be interesting but need more thought:

- [ ] **In-App Web Browsing**: Option to open external links in an embedded browser view with back/forward navigation and "Open in Browser" button. Would need careful UX design to not confuse users about what's a local file vs web content. Could be useful for documentation that references external resources.
- [ ] **Link Preview on Hover**: Show a tooltip preview when hovering over links.
- [ ] **Vim Keybindings**: Optional vim-mode for power users.

