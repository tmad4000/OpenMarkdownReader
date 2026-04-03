#!/usr/bin/env bash
set -euo pipefail

APP_BUNDLE_ID="com.jacobcole.openmarkdownreader"
APP_NAME="OpenMarkdownReader"
APP_PATH="/Applications/OpenMarkdownReader.app"
VERSION="1.0.0"
SOCK_PATH="$HOME/Library/Application Support/OpenMarkdownReader/omr.sock"

# Get version from app's package.json if available
if [[ -f "$APP_PATH/Contents/Resources/app/package.json" ]]; then
  DETECTED_VERSION=$(grep '"version"' "$APP_PATH/Contents/Resources/app/package.json" 2>/dev/null | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/' || echo "$VERSION")
  VERSION="${DETECTED_VERSION:-$VERSION}"
fi

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "OpenMarkdownReader v$VERSION - A beautiful Markdown reader and editor"
  echo ""
  echo "Usage: omr [options] [path ...]"
  echo "       omr --cmd <command> [args...]    Control running instance"
  echo ""
  echo "Options:"
  echo "  -e, --edit           Open file(s) in edit mode"
  echo "  -w, --watch          Watch for external file changes"
  echo "  -s, --scratch        Open today's scratch note"
  echo "  -r, --ref            Open today's reference note"
  echo "  -t, --theme <mode>   Set theme (light, dark, system)"
  echo "      --monospace      Use monospace font in editor"
  echo "      --no-monospace   Use proportional font in editor"
  echo "      --no-session     Don't restore previous session"
  echo "  -n, --new            Create a new untitled file"
  echo "  -v, --version        Show version"
  echo "  -h, --help           Show this help message"
  echo ""
  echo "Agent Control (--cmd):"
  echo "  omr --cmd help                    List available commands"
  echo "  omr --cmd get-state               Full app state (JSON)"
  echo "  omr --cmd list-tabs               List open tabs"
  echo "  omr --cmd get-content <path>      Get tab content"
  echo "  omr --cmd list-windows            List windows"
  echo "  omr --cmd switch-tab <n|path>     Switch to tab"
  echo "  omr --cmd close-tab [n|path]      Close tab"
  echo "  omr --cmd new-tab                 Create new tab"
  echo "  omr --cmd open <path> [--edit]    Open file"
  echo "  omr --cmd save                    Save active tab"
  echo "  omr --cmd save-all                Save all tabs"
  echo "  omr --cmd toggle-edit             Toggle edit mode"
  echo "  omr --cmd toggle-sidebar          Toggle sidebar"
  echo "  omr --cmd set <key> <value>       Change setting"
  echo "  omr --cmd get-config              Get all settings"
  echo "  omr --cmd scroll-to --line <n>    Scroll to line"
  echo "  omr --cmd insert --text '...'     Insert text at cursor"
  echo "  omr --cmd set-content '...'       Replace buffer content"
  echo "  omr --cmd find <query>            Open find with query"
  echo "  omr --cmd nav-back                Navigate back"
  echo "  omr --cmd nav-forward             Navigate forward"
  echo "  omr --cmd search <query> [--dir]  Search in files"
  echo "  omr --cmd export-pdf <out.pdf>    Export to PDF"
  echo "  omr --cmd daily-note [scratch|ref] Create/open daily note"
  echo "  omr --cmd focus                   Focus the app window"
  echo "  omr --cmd new-window              Create new window"
  echo "  omr --cmd watch                   Stream events (NDJSON)"
  echo ""
  echo "Examples:"
  echo "  omr                    Open app (restores last session)"
  echo "  omr .                  Open current directory in sidebar"
  echo "  omr README.md          Open a specific file"
  echo "  omr -e README.md       Open file in edit mode"
  echo "  omr -w README.md       Open and watch for changes"
  echo "  omr -s                 Open today's scratch note"
  echo "  omr --theme dark       Open with dark theme"
  echo "  omr -n                 Create new untitled file"
  echo "  omr --cmd list-tabs    List open tabs as JSON"
  echo "  omr --cmd get-state    Full app state snapshot"
  exit 0
fi

if [[ "${1:-}" == "--version" || "${1:-}" == "-v" ]]; then
  echo "OpenMarkdownReader $VERSION"
  exit 0
fi

# ─── Agent Control Mode ───────────────────────────────────────────────
# omr --cmd <command> [args...] → sends JSON to Unix socket, prints response
if [[ "${1:-}" == "--cmd" ]]; then
  shift
  COMMAND="${1:-help}"
  shift || true

  # Check if socket exists (app must be running)
  if [[ ! -S "$SOCK_PATH" ]]; then
    echo '{"error":"App is not running. Start OpenMarkdownReader first."}' >&2
    exit 1
  fi

  # Build JSON request from remaining args
  # Simple arg parsing: positional args become the primary value,
  # --key value pairs become JSON fields
  ARGS_JSON="{"
  FIRST_ARG=true
  POSITIONAL=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --*)
        KEY="${1#--}"
        VALUE="${2:-true}"
        if [[ "$FIRST_ARG" != true ]]; then ARGS_JSON+=","; fi
        FIRST_ARG=false
        # Try to detect booleans and numbers
        if [[ "$VALUE" == "true" || "$VALUE" == "false" ]]; then
          ARGS_JSON+="\"$KEY\":$VALUE"
        elif [[ "$VALUE" =~ ^[0-9]+$ ]]; then
          ARGS_JSON+="\"$KEY\":$VALUE"
        else
          # Escape JSON string
          ESCAPED_VALUE=$(printf '%s' "$VALUE" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()), end="")')
          ARGS_JSON+="\"$KEY\":$ESCAPED_VALUE"
        fi
        shift 2 || shift
        ;;
      *)
        POSITIONAL="$1"
        shift
        ;;
    esac
  done

  # Add positional arg as a context-appropriate field
  if [[ -n "$POSITIONAL" ]]; then
    if [[ "$FIRST_ARG" != true ]]; then ARGS_JSON+=","; fi
    FIRST_ARG=false
    case "$COMMAND" in
      get-content|switch-tab|close-tab)
        # Could be path or index
        if [[ "$POSITIONAL" =~ ^[0-9]+$ ]]; then
          ARGS_JSON+="\"tab\":$POSITIONAL"
        else
          ESCAPED=$(printf '%s' "$POSITIONAL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()), end="")')
          ARGS_JSON+="\"tab\":$ESCAPED"
        fi
        ;;
      open)
        # Resolve to absolute path
        if [[ "$POSITIONAL" == /* ]]; then
          ABS_PATH="$POSITIONAL"
        else
          ABS_PATH="$(cd "$(dirname "$POSITIONAL")" && pwd)/$(basename "$POSITIONAL")"
        fi
        ESCAPED=$(printf '%s' "$ABS_PATH" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()), end="")')
        ARGS_JSON+="\"path\":$ESCAPED"
        ;;
      set)
        ESCAPED=$(printf '%s' "$POSITIONAL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()), end="")')
        ARGS_JSON+="\"key\":$ESCAPED"
        ;;
      search|find)
        ESCAPED=$(printf '%s' "$POSITIONAL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()), end="")')
        ARGS_JSON+="\"query\":$ESCAPED"
        ;;
      export-pdf)
        # Resolve output path
        if [[ "$POSITIONAL" == /* ]]; then
          ABS_PATH="$POSITIONAL"
        else
          ABS_PATH="$(pwd)/$POSITIONAL"
        fi
        ESCAPED=$(printf '%s' "$ABS_PATH" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()), end="")')
        ARGS_JSON+="\"output\":$ESCAPED"
        ;;
      daily-note)
        ESCAPED=$(printf '%s' "$POSITIONAL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()), end="")')
        ARGS_JSON+="\"type\":$ESCAPED"
        ;;
      set-content)
        ESCAPED=$(printf '%s' "$POSITIONAL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()), end="")')
        ARGS_JSON+="\"content\":$ESCAPED"
        ;;
      insert)
        ESCAPED=$(printf '%s' "$POSITIONAL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()), end="")')
        ARGS_JSON+="\"text\":$ESCAPED"
        ;;
      *)
        ESCAPED=$(printf '%s' "$POSITIONAL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()), end="")')
        ARGS_JSON+="\"arg\":$ESCAPED"
        ;;
    esac
  fi
  ARGS_JSON+="}"

  REQUEST="{\"command\":\"$COMMAND\",\"args\":$ARGS_JSON}"

  # Find the cli-client.js script (bundled in app or next to this script)
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  CLI_CLIENT=""
  # Check next to this script (bundled app)
  if [[ -f "$SCRIPT_DIR/cli-client.js" ]]; then
    CLI_CLIENT="$SCRIPT_DIR/cli-client.js"
  # Check in app bundle resources
  elif [[ -f "$APP_PATH/Contents/Resources/app/cli-client.js" ]]; then
    CLI_CLIENT="$APP_PATH/Contents/Resources/app/cli-client.js"
  elif [[ -f "$APP_PATH/Contents/Resources/cli-client.js" ]]; then
    CLI_CLIENT="$APP_PATH/Contents/Resources/cli-client.js"
  fi

  if [[ -n "$CLI_CLIENT" ]]; then
    exec node "$CLI_CLIENT" "$REQUEST"
  else
    echo '{"error":"cli-client.js not found. Reinstall the app."}' >&2
    exit 1
  fi
fi

if [[ $# -eq 0 ]]; then
  open -b "$APP_BUNDLE_ID" 2>/dev/null || open -a "$APP_NAME"
  exit 0
fi

# Use --args to pass flags to the Electron app
open -b "$APP_BUNDLE_ID" --args "$@" 2>/dev/null || open -a "$APP_NAME" --args "$@"
