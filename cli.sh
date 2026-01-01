#!/usr/bin/env bash
set -euo pipefail

APP_BUNDLE_ID="com.jacobcole.openmarkdownreader"
APP_NAME="OpenMarkdownReader"
APP_PATH="/Applications/OpenMarkdownReader.app"
VERSION="1.0.0"

# Get version from app's package.json if available
if [[ -f "$APP_PATH/Contents/Resources/app/package.json" ]]; then
  DETECTED_VERSION=$(grep '"version"' "$APP_PATH/Contents/Resources/app/package.json" 2>/dev/null | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/' || echo "$VERSION")
  VERSION="${DETECTED_VERSION:-$VERSION}"
fi

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "OpenMarkdownReader v$VERSION - A beautiful Markdown reader and editor"
  echo ""
  echo "Usage: omr [options] [path ...]"
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
  echo "Examples:"
  echo "  omr                    Open app (restores last session)"
  echo "  omr .                  Open current directory in sidebar"
  echo "  omr README.md          Open a specific file"
  echo "  omr -e README.md       Open file in edit mode"
  echo "  omr -w README.md       Open and watch for changes"
  echo "  omr -s                 Open today's scratch note"
  echo "  omr --theme dark       Open with dark theme"
  echo "  omr -n                 Create new untitled file"
  exit 0
fi

if [[ "${1:-}" == "--version" || "${1:-}" == "-v" ]]; then
  echo "OpenMarkdownReader $VERSION"
  exit 0
fi

if [[ $# -eq 0 ]]; then
  open -b "$APP_BUNDLE_ID" 2>/dev/null || open -a "$APP_NAME"
  exit 0
fi

# Use --args to pass flags to the Electron app
open -b "$APP_BUNDLE_ID" --args "$@" 2>/dev/null || open -a "$APP_NAME" --args "$@"
