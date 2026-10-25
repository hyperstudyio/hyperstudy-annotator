#!/usr/bin/env bash
# Sign, notarize and staple a release DMG (.github/workflows/release-macos.yml), then check it as Gatekeeper will:
#   scripts/notarize-dmg.sh PATH.dmg
# The app inside was signed by `tauri build` (APPLE_SIGNING_IDENTITY, hardened runtime, the bundled uv with it).
# Needs APPLE_SIGNING_IDENTITY, APPLE_ID, APPLE_PASSWORD (an app-specific password) and APPLE_TEAM_ID, from the
# repository's secrets; none is printed.
set -euo pipefail
dmg=$1
for v in APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  [ -n "${!v:-}" ] || { echo "notarize-dmg: $v is not set (a repository secret)" >&2; exit 1; }
done

codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$dmg"
codesign --verify --strict "$dmg"

out=$(xcrun notarytool submit "$dmg" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" \
      --wait --output-format json)
echo "$out"
id=$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
status=$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')
if [ "$status" != "Accepted" ]; then
  echo "notarize-dmg: Apple did not accept it ($status); its log:" >&2
  xcrun notarytool log "$id" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" >&2
  exit 1
fi

xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
