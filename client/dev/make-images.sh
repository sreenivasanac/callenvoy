#!/usr/bin/env bash
# Renders dev/og.html to public/og.png (link preview) and to the app icons, with a headless Chrome. No npm package.
# Usage: client/dev/make-images.sh   (CHROME=/path/to/chrome to use another browser binary)
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
shot() { "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size="$2" --screenshot="$3" "file://$PWD/dev/og.html$1" >/dev/null 2>&1; }
shot "" 1200,630 public/og.png
shot "?icon" 1024,1024 public/icon.png
cp public/icon.png assets/icon.png
sips -Z 96 public/icon.png --out assets/favicon.png >/dev/null   # Expo makes favicon.ico from this
ls -la public/og.png public/icon.png assets/favicon.png
