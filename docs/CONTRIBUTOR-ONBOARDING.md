# Contributor Onboarding

Welcome! This doc gets you from zero to shipping a feature in OpenMarkdownReader.

## 1. Setup (5 minutes)

```bash
git clone git@github.com:tmad4000/OpenMarkdownReader.git
cd OpenMarkdownReader
git checkout feature/daily-notes   # active dev branch, ahead of main
npm install
npm start                          # launches Electron in dev mode
```

The dev build shows an orange `DEV b<n>` badge in the title bar. The number bumps every build so you can tell whether your code is actually running.

## 2. Project Layout

| File | What it does |
|------|-------------|
| `main.js` | Electron main process. Window management, IPC handlers, menus, file I/O, agent socket server. ~3000 lines. |
| `renderer.js` | Renderer process. Tab management, editor UI, sidebar, command palette, markdown rendering. ~6500 lines (the big one). |
| `preload.js` | IPC bridge. Defines `window.electronAPI` surface area. |
| `index.html` | Main HTML structure. |
| `styles.css` | All styling, including EasyMDE/CodeMirror overrides. |
| `agent-server.js` | Unix socket server for agent/CLI control. |
| `cli-client.js` | Node.js socket client used by `omr --cmd <command>`. |
| `cli.sh` | The `omr` shell wrapper installed to `/opt/homebrew/bin`. |
| `scripts/build-mas.sh` | Mac App Store / TestFlight build pipeline. |
| `scripts/generate-build-info.js` | Bumps `build-info.json` build number on every build (monotonic). |
| `.beads/` | Beads issue tracker (git-backed). Run `bd list --status=open` to see work. |

## 3. The Active Branch

We work on **`feature/daily-notes`**, not `main`. `main` is months behind. All PRs target `feature/daily-notes`.

## 4. Issue Tracker

We use [beads](https://github.com/aurex-labs/beads) — a git-backed issue tracker with a CLI:

```bash
bd ready                      # tickets with no blockers, ready to claim
bd show <id>                  # detailed view + dependencies
bd update <id> --status=in_progress
bd close <id> --reason="..."  # done
bd sync                       # commits beads state to git
```

Tickets to start with are listed in `docs/HANDOFF-LIST.md`.

## 5. Conventions

- **Commits**: Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`). Reference ticket IDs in commit messages.
- **No defensive code**: Don't add error handling for things that can't happen. Trust internal code.
- **No abstractions for one-time operations**: Three similar lines is better than a premature helper.
- **Read before editing**: Always read a file before modifying it; understand existing patterns.
- **Beads first for non-trivial work**: Create a ticket if a change spans more than one session.

## 6. Agent-Native Design (READ THIS)

Every user-facing feature **must** ship with an `omr --cmd <command>` equivalent. The app is designed for AI agents to drive end-to-end via the Unix socket. See `REQUIREMENTS.md` for the full principle and current command list.

When you add a new menu item or button, also:
1. Add a command in `agent-server.js` / `main.js` (search `registerAgentCommands`)
2. Add the new command to `cli.sh` help text
3. Test it: `omr --cmd <new-command>`

## 7. Building & Releasing

```bash
# Dev build (no signing, fast)
npm start

# Notarized macOS DMG (~5 min)
APPLE_API_KEY=~/.private_keys/AuthKey_KWJX4896S5.p8 \
APPLE_API_KEY_ID=KWJX4896S5 \
APPLE_API_ISSUER=69a6de95-2833-47e3-e053-5b8c7c11a4d1 \
npm run build:mac

# Mac App Store / TestFlight
./scripts/build-mas.sh --upload

# Install locally (use ditto, NOT cp -R, to preserve signatures)
ditto dist/mac-universal/OpenMarkdownReader.app /Applications/OpenMarkdownReader.app
```

Notarization needs the API key from Jacob.

## 8. Agent Control (Power Tools for You Too)

You can drive the running app from your shell:

```bash
omr --cmd help                              # all 26+ commands
omr --cmd get-state | jq                    # full app state JSON
omr --cmd list-tabs                         # current tabs
omr --cmd open ~/notes/foo.md --edit        # open in edit mode
omr --cmd save                              # save active tab
omr --cmd set theme dark                    # change setting
omr --cmd export-pdf out.pdf                # headless PDF export
omr --cmd search "query" --dir ~/notes      # search files
```

This is great for testing — instead of clicking around, script your reproduction.

## 9. Where to Ask

Open a GitHub issue with `question:` prefix, or ping Jacob directly. The CLAUDE.md files in the repo root and `~/.claude/` (Jacob's machine) document all the conventions in detail.
