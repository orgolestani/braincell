#!/bin/sh
# Braincells installer — https://orgolestani.github.io/braincell
#
# Downloads the latest release zip and moves Braincells.app into /Applications.
# curl'd downloads carry no com.apple.quarantine flag, so this path never
# hits Gatekeeper's "damaged" / "could not verify" dialogs.
set -eu

BASE="https://github.com/orgolestani/braincell/releases/latest/download"
DEST="${BRAINCELLS_INSTALL_DIR:-${BRAINCELL_INSTALL_DIR:-/Applications}}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Braincells is a macOS app." >&2
  exit 1
fi
if [ "$(uname -m)" != "arm64" ]; then
  echo "Braincells ships Apple Silicon builds only (Intel: build from source —" >&2
  echo "https://github.com/orgolestani/braincell)." >&2
  exit 1
fi

TMP="$(mktemp -d /tmp/braincells.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

echo "⌚ Downloading Braincells (~110MB)…"
# Releases published before the Braincells rebrand ship the old asset name —
# probe quietly and fall back so this script works on either side of the rename.
URL="$BASE/Braincells-macOS-arm64.zip"
if ! curl -fsIL "$URL" -o /dev/null 2>/dev/null; then
  URL="$BASE/Braincell-macOS-arm64.zip"
fi
curl -fL --progress-bar "$URL" -o "$TMP/braincells.zip"

echo "⌚ Verifying checksum…"
EXPECTED="$(curl -fsSL "$URL.sha256" | awk '{print $1}')"
ACTUAL="$(shasum -a 256 "$TMP/braincells.zip" | awk '{print $1}')"
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Checksum mismatch — refusing to install." >&2
  echo "  expected: ${EXPECTED:-<none>}" >&2
  echo "  got:      $ACTUAL" >&2
  exit 1
fi
echo "   sha256 ok: $ACTUAL"

echo "⌚ Installing to $DEST…"
ditto -xk "$TMP/braincells.zip" "$TMP/unpacked"
APP_NAME="$(basename "$(find "$TMP/unpacked" -maxdepth 1 -name '*.app' | head -n 1)")"
if [ -z "$APP_NAME" ] || [ "$APP_NAME" = ".app" ]; then
  echo "No .app bundle in the release zip — refusing to install." >&2
  exit 1
fi
# Replace either name so a rebrand upgrade doesn't leave two copies around.
rm -rf "$DEST/Braincells.app" "$DEST/Braincell.app"
mv "$TMP/unpacked/$APP_NAME" "$DEST/$APP_NAME"

open "$DEST/$APP_NAME"
echo "⌚ Braincells is on your desk. Mind the context."
