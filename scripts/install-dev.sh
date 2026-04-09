#!/usr/bin/env bash
# install-dev.sh — Fast local install of the current source as the default Markdown Reader.
#
# Produces a signed-but-NOT-notarized arm64 build (saves ~5 min per build vs the
# full universal+notarized release build) and ditto's it over /Applications.
# LaunchServices picks up the new binary automatically because the bundle ID
# (com.jacobcole.openmarkdownreader) is unchanged — default .md handler keeps working.
#
# First-launch will show a one-time Gatekeeper "unknown developer" warning since
# the build isn't notarized. Click "Open Anyway" in System Settings → Privacy &
# Security, or right-click → Open. After that it's trusted forever.
#
# For release builds (notarized, universal, published to GitHub), use
# `npm run build:mac` with the APPLE_API_KEY env vars (see CLAUDE.md memory).

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "→ Generating build info (channel=dev)..."
OMR_BUILD_CHANNEL=dev node scripts/generate-build-info.js

echo "→ Building (arm64 dir target, skip notarization)..."
# --mac dir: stop after signing, skip DMG + zip packaging (~1 min savings)
# -c.mac.notarize=false: skip notarization (~5 min savings)
# --arm64: single-arch, no x64 rebuild + universal merge (~1 min savings)
npx electron-builder --mac dir --arm64 -c.mac.notarize=false

BUILT_APP="dist/mac-arm64/OpenMarkdownReader.app"
if [ ! -d "$BUILT_APP" ]; then
  echo "✗ Build did not produce $BUILT_APP" >&2
  exit 1
fi

echo "→ Quitting any running instance..."
osascript -e 'tell application "OpenMarkdownReader" to quit' 2>/dev/null || true
sleep 1
# Graceful SIGTERM first, then SIGKILL only if still alive after 2s
pkill -f "OpenMarkdownReader.app/Contents" 2>/dev/null || true
sleep 2
pkill -9 -f "OpenMarkdownReader.app/Contents" 2>/dev/null || true
sleep 1

# Copy new build to a staging path first, then atomically swap.
# This prevents the "no installed app" state if ditto fails mid-copy.
STAGING="/Applications/OpenMarkdownReader-staging-$$.app"

echo "→ Copying $BUILT_APP → staging..."
if ! ditto "$BUILT_APP" "$STAGING"; then
  echo "✗ ditto failed — existing install untouched" >&2
  rm -rf "$STAGING" 2>/dev/null || true
  exit 1
fi

echo "→ Swapping into /Applications/OpenMarkdownReader.app..."
if [ -d /Applications/OpenMarkdownReader.app ]; then
  mv /Applications/OpenMarkdownReader.app "$HOME/.Trash/OpenMarkdownReader-prev-$(date +%s).app"
fi
mv "$STAGING" /Applications/OpenMarkdownReader.app

VER=$(defaults read /Applications/OpenMarkdownReader.app/Contents/Info CFBundleShortVersionString)
# Build number lives in build-info.json, not CFBundleVersion (electron-builder
# doesn't thread it through Info.plist by default).
BUILD=$(python3 -c "import json; print(json.load(open('build-info.json'))['buildNumber'])" 2>/dev/null || echo "?")
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "?")

echo ""
echo "✓ Installed OpenMarkdownReader v${VER} [DEV build ${BUILD}] (commit ${COMMIT})"
echo "  → /Applications/OpenMarkdownReader.app"
echo ""
echo "Double-click any .md file to open it with the new build."
echo "First launch may show a Gatekeeper warning (unsigned/unnotarized) — click Open Anyway."
