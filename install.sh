#!/usr/bin/env bash
# Install Claude Pixel Bar into the user GNOME Shell extensions directory.
set -euo pipefail

UUID="claude-pixel-bar@local"
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

echo "Installing $UUID → $DEST"
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
mkdir -p "$DEST/bin"

cp -a "$SRC/extension.js" "$SRC/stylesheet.css" "$SRC/metadata.json" "$SRC/today_stats.py" "$DEST/"
cp -a "$SRC/bin/claudebar" "$DEST/bin/claudebar"
chmod +x "$DEST/today_stats.py" "$DEST/bin/claudebar"

if command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions enable "$UUID" 2>/dev/null || true
  echo
  echo "Installed & enabled."
  echo "Reload GNOME Shell to see it:"
  echo "  X11:     Alt+F2 → r → Enter  (English IME)"
  echo "  Wayland: log out and back in"
else
  echo "Installed. Enable with: gnome-extensions enable $UUID"
fi

echo
echo "Requires: Claude Code logged in (claude), curl, jq, Python 3."
