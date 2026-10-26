#!/bin/bash
# Before a release builds: the updater key in the release environment (TAURI_SIGNING_PRIVATE_KEY) opens with its
# password (TAURI_SIGNING_PRIVATE_KEY_PASSWORD), and is the key whose public half the app carries (tauri.conf.json).
# Signing comes at the end of the build, so either mistake showed only after it (v0.0.2's first run, 2026-10-26: a
# password that was not the key's, found after 6 minutes of building and notarizing); this signs a line of text instead.
# A key that is not the app's would sign every update with nothing able to install it: no installed copy accepts them.
# Usage: bash scripts/check-updater-key.sh [tauri.conf.json]   (after npm ci; the two secrets in the environment)
set -euo pipefail
conf="${1:-src-tauri/tauri.conf.json}"
[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ] || { echo "the TAURI_SIGNING_PRIVATE_KEY secret is not set in the release environment" >&2; exit 1; }
probe="$(mktemp -d)/probe"
echo "updater key probe" > "$probe"
npx tauri signer sign "$probe" > /dev/null || { echo "the updater key does not open with TAURI_SIGNING_PRIVATE_KEY_PASSWORD: set the password it was made with" >&2; exit 1; }
# a .sig and a pubkey are each base64 of minisign's text; its second line, decoded: 2 bytes of algorithm, then the key ID
python3 - "$probe.sig" "$conf" <<'EOF'
import base64, json, sys
key_id = lambda b64: base64.b64decode(base64.b64decode(b64).decode().splitlines()[1])[2:10][::-1].hex().upper()
signed = key_id(open(sys.argv[1]).read().strip())
app = key_id(json.load(open(sys.argv[2]))['plugins']['updater']['pubkey'])
if signed != app:
    sys.exit(f'the updater key in the release environment is {signed}, but the app trusts {app}: '
             'set the secret to the key whose .pub is in tauri.conf.json')
print(f'the updater key {signed} opens with its password, and is the one the app trusts')
EOF
