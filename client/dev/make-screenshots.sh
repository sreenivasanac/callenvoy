#!/usr/bin/env bash
# Takes the README screenshots (docs/screenshots/*.png) from the mock server, with a headless Chrome. Mock data only.
# First: pnpm run build, then start the mock (node dev/mock-api.mjs, port 3020). Restart the mock for a clean state.
# Usage: client/dev/make-screenshots.sh   (CHROME=/path/to/chrome, BASE=http://localhost:3020 to change)
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
BASE="${BASE:-http://localhost:3020}"
OUT=../docs/screenshots
PROFILE="$(mktemp -d)" # keeps the mock's session cookie between the shots
mkdir -p "$OUT"
# shot <file> <width,height> <scale> <path>. The time budget lets the page load its data before the picture.
shot() {
  # preferredColorScheme=1 is light. Smooth scrolling is off because it does not finish before the picture (?focus=keys).
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --disable-smooth-scrolling --user-data-dir="$PROFILE" --blink-settings=preferredColorScheme=1 \
    --force-device-scale-factor="$3" --window-size="$2" --virtual-time-budget=6000 --screenshot="$OUT/$1" "$BASE$4" >/dev/null 2>&1
}
shot landing.png 1280,860 1 /                               # signed out
shot calls.png 1280,1180 1 "/__mock/signin?as=dana"         # signs in, then shows Calls
shot call-live.png 1280,1420 1 /calls/c_secret              # a live call that asks for a protected detail
shot call-done.png 1280,1500 1 /calls/c_done                # a finished call: how it went, cost, transcript
shot new-call.png 1280,980 1 /new
# Phone width: a person answered. A headless window is at least 500 px wide, so the page sits in a centered 390 px frame and sips cuts off the rest.
shot phone-call.png 500,844 2 "/__mock/frame?path=/calls/c_alert"
sips -c 1688 780 "$OUT/phone-call.png" >/dev/null
shot settings-keys.png 1280,1180 1 "/__mock/signin?as=riya" # riya has her own keys saved
shot settings-keys.png 1280,1180 1 "/settings?focus=keys"
ls -la "$OUT"
