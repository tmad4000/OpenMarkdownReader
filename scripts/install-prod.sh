#!/usr/bin/env bash
# install-prod.sh — Download and install the latest production release from GitHub.
#
# Use this to fall back to the last known-good release when a dev build breaks.
# Downloads the notarized DMG, extracts the .app, and installs to /Applications.
#
# Usage:
#   npm run install-prod              # install latest release
#   npm run install-prod -- v1.0.4    # install a specific version

set -euo pipefail

REPO="tmad4000/OpenMarkdownReader"
VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  # Find the latest non-prerelease
  VERSION=$(gh release list --repo "$REPO" --limit 10 \
    | grep -v Pre-release \
    | grep Latest \
    | awk '{print $3}')
  if [ -z "$VERSION" ]; then
    echo "✗ Could not determine latest release. Specify version: npm run install-prod -- v1.0.5" >&2
    exit 1
  fi
fi

echo "→ Downloading $VERSION from GitHub..."
TMPDIR=$(mktemp -d)
gh release download "$VERSION" --repo "$REPO" --pattern "*.dmg" -D "$TMPDIR"

DMG=$(ls "$TMPDIR"/*.dmg 2>/dev/null | head -1)
if [ -z "$DMG" ]; then
  echo "✗ No DMG found in release $VERSION" >&2
  exit 1
fi

echo "→ Mounting $DMG..."
hdiutil attach "$DMG" -nobrowse -quiet
MOUNT=$(ls -d /Volumes/OpenMarkdownReader* 2>/dev/null | head -1)
if [ -z "$MOUNT" ] || [ ! -d "$MOUNT/OpenMarkdownReader.app" ]; then
  echo "✗ Could not find app in mounted DMG" >&2
  exit 1
fi

echo "→ Quitting any running instance..."
osascript -e 'tell application "OpenMarkdownReader" to quit' 2>/dev/null || true
sleep 1
pkill -f "OpenMarkdownReader.app/Contents" 2>/dev/null || true
sleep 2
pkill -9 -f "OpenMarkdownReader.app/Contents" 2>/dev/null || true
sleep 1

# Stage → swap (same atomic pattern as install-dev.sh)
STAGING="/Applications/OpenMarkdownReader-staging-$$.app"

echo "→ Copying to staging..."
if ! ditto "$MOUNT/OpenMarkdownReader.app" "$STAGING"; then
  echo "✗ ditto failed" >&2
  hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
  rm -rf "$STAGING" 2>/dev/null || true
  exit 1
fi

echo "→ Swapping into /Applications..."
if [ -d /Applications/OpenMarkdownReader.app ]; then
  mv /Applications/OpenMarkdownReader.app "$HOME/.Trash/OpenMarkdownReader-prev-$(date +%s).app"
fi
mv "$STAGING" /Applications/OpenMarkdownReader.app

# Cleanup
hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
rm -rf "$TMPDIR"

VER=$(defaults read /Applications/OpenMarkdownReader.app/Contents/Info CFBundleShortVersionString 2>/dev/null || echo "?")

echo ""
echo "✓ Installed OpenMarkdownReader v${VER} [PRODUCTION release $VERSION]"
echo "  → /Applications/OpenMarkdownReader.app"
echo "  → Signed + notarized — no Gatekeeper warnings"
echo ""
echo "To switch back to dev: npm run install-dev"
