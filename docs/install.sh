#!/bin/sh
# Braincell installer — https://orgolestani.github.io/braincell
#
# Downloads the latest release zip and moves Braincell.app into /Applications.
# curl'd downloads carry no com.apple.quarantine flag, so this path never
# hits Gatekeeper's "damaged" / "could not verify" dialogs.
set -eu

URL="https://github.com/orgolestani/braincell/releases/latest/download/Braincell-macOS-arm64.zip"
DEST="${BRAINCELL_INSTALL_DIR:-/Applications}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Braincell is a macOS app." >&2
  exit 1
fi
if [ "$(uname -m)" != "arm64" ]; then
  echo "Braincell ships Apple Silicon builds only (Intel: build from source —" >&2
  echo "https://github.com/orgolestani/braincell)." >&2
  exit 1
fi

TMP="$(mktemp -d /tmp/braincell.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

echo "⌚ Downloading Braincell (~110MB)…"
curl -fL --progress-bar "$URL" -o "$TMP/braincell.zip"

echo "⌚ Installing to $DEST…"
ditto -xk "$TMP/braincell.zip" "$TMP/unpacked"
rm -rf "$DEST/Braincell.app"
mv "$TMP/unpacked/Braincell.app" "$DEST/Braincell.app"

# belt & braces: if anything upstream ever adds a quarantine flag, clear it
xattr -cr "$DEST/Braincell.app" 2>/dev/null || true

open "$DEST/Braincell.app"
echo "⌚ Braincell is on your desk. Mind the context."
