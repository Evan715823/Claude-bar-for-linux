#!/usr/bin/env bash
# Install Claude Pixel Bar into the user GNOME Shell extensions directory.
set -euo pipefail

UUID="claude-pixel-bar@local"
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

missing=()
for cmd in curl jq python3 date; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    missing+=("$cmd")
  fi
done
if ((${#missing[@]})); then
  echo "Missing required commands: ${missing[*]}" >&2
  echo "Install them, then re-run ./install.sh" >&2
  exit 1
fi

if [[ ! -x "$SRC/bin/claudebar" ]]; then
  echo "Missing bundled usage helper: $SRC/bin/claudebar" >&2
  exit 1
fi

echo "Installing $UUID → $DEST"
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
mkdir -p "$DEST/bin"

cp -a "$SRC/extension.js" "$SRC/stylesheet.css" "$SRC/metadata.json" "$SRC/today_stats.py" "$DEST/"
cp -a "$SRC/bin/claudebar" "$DEST/bin/claudebar"
chmod +x "$DEST/today_stats.py" "$DEST/bin/claudebar"

echo
if command -v gnome-extensions >/dev/null 2>&1; then
  if gnome-extensions enable "$UUID" 2>/dev/null; then
    echo "Installed & enabled."
  else
    echo "Installed, but enable failed."
    echo "Check: gnome-extensions info $UUID"
    echo "Then:  gnome-extensions enable $UUID"
  fi
  echo "Reload GNOME Shell to see it:"
  echo "  X11:     Alt+F2 → r → Enter  (English IME)"
  echo "  Wayland: log out and back in"
else
  echo "Installed. Enable with: gnome-extensions enable $UUID"
fi

echo
echo "Requires: Claude Code logged in (claude)."
