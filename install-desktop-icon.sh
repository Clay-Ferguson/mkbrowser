#!/bin/bash
# Creates and installs a .desktop file for MkBrowser

set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
ICON_PATH="$APP_DIR/icon-256.png"
DESKTOP_FILE="mkbrowser.desktop"
DESKTOP_DIR="$HOME/.local/share/applications"

if [ ! -f "$ICON_PATH" ]; then
    echo "Error: icon-256.png not found at $ICON_PATH"
    exit 1
fi

mkdir -p "$DESKTOP_DIR"

cat > "$DESKTOP_DIR/$DESKTOP_FILE" <<EOF
[Desktop Entry]
Name=MkBrowser
Comment=Folder browsing with inline Markdown rendering
Exec=mk-browser
Icon=$ICON_PATH
Terminal=false
Type=Application
Categories=Utility;TextEditor;Development;
StartupWMClass=mk-browser
EOF

chmod +x "$DESKTOP_DIR/$DESKTOP_FILE"

echo "Desktop file installed to $DESKTOP_DIR/$DESKTOP_FILE"
echo "You should now see MkBrowser in your application list."
echo "Right-click the icon to add it to your dock."
