#!/bin/bash
# Snap installer for macOS: downloads the latest release and installs it to /Applications.
# Double-click this file, or run: bash install-mac.command
set -euo pipefail
REPO="ponya5/snap"
case "$(uname -m)" in arm64) ARCH="arm64" ;; *) ARCH="x64" ;; esac

echo "Looking up the latest Snap release..."
JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")
# Prefer the DMG for this CPU; the x64 build has no arch suffix.
URL=$(printf '%s' "$JSON" | grep -o '"browser_download_url": *"[^"]*\.dmg"' | cut -d'"' -f4 | { if [ "$ARCH" = arm64 ]; then grep -- '-arm64'; else grep -v -- '-arm64'; fi; } | head -n1 || true)
[ -n "$URL" ] || { echo "No DMG for $ARCH in the latest release. See https://github.com/$REPO/releases"; exit 1; }

TMP=$(mktemp -d); trap 'hdiutil detach "$TMP/mnt" -quiet 2>/dev/null || true; rm -rf "$TMP"' EXIT
echo "Downloading $URL"
curl -fL --progress-bar -o "$TMP/Snap.dmg" "$URL"
mkdir "$TMP/mnt"
hdiutil attach "$TMP/Snap.dmg" -nobrowse -quiet -mountpoint "$TMP/mnt"

osascript -e 'tell application "Snap" to quit' >/dev/null 2>&1 || true
rm -rf /Applications/Snap.app
cp -R "$TMP/mnt/Snap.app" /Applications/
xattr -cr /Applications/Snap.app   # build is unsigned; clear the quarantine flag
open /Applications/Snap.app
echo "Snap installed. Allow Screen Recording in System Settings > Privacy & Security when asked, then reopen Snap."
