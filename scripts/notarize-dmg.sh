#!/usr/bin/env bash
# Sign, notarize and staple a release DMG (.github/workflows/release-macos.yml), then check it as Gatekeeper will:
#   scripts/notarize-dmg.sh PATH.dmg
# The app inside was signed, notarized and stapled by `tauri build` (hardened runtime, the bundled uv with it).
# Needs APPLE_SIGNING_IDENTITY, and an App Store Connect API key for notarytool: APPLE_API_KEY_PATH (its .p8 file),
# APPLE_API_KEY_ID and APPLE_API_ISSUER, from the repository's secrets; none is printed.
set -euo pipefail
dmg=$1
for v in APPLE_SIGNING_IDENTITY APPLE_API_KEY_PATH APPLE_API_KEY_ID APPLE_API_ISSUER; do
  [ -n "${!v:-}" ] || { echo "notarize-dmg: $v is not set (a repository secret)" >&2; exit 1; }
done
auth=(--key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")

codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$dmg"
codesign --verify --strict "$dmg"

out=$(xcrun notarytool submit "$dmg" "${auth[@]}" --wait --output-format json)
echo "$out"
id=$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
status=$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')
if [ "$status" != "Accepted" ]; then
  echo "notarize-dmg: Apple did not accept it ($status); its log:" >&2
  xcrun notarytool log "$id" "${auth[@]}" >&2
  exit 1
fi

xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
