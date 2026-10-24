#!/usr/bin/env bash
# The uv the app bundles (tauri.conf.json bundle.externalBin), for the target being built: a pinned release of
# astral-sh/uv, checked against the sha256 published with it, unpacked to src-tauri/binaries/uv-<target triple>
# (git-ignored). Runs before `tauri dev` and `tauri build`; does nothing when the right version is already there.
# uv is MIT OR Apache-2.0 (https://github.com/astral-sh/uv), so the app may redistribute it.
set -euo pipefail
UV_VERSION=0.12.15
triple=${TAURI_ENV_TARGET_TRIPLE:-$(rustc -vV | sed -n 's/^host: //p')}
dir=$(cd "$(dirname "$0")/.." && pwd)/src-tauri/binaries
out=$dir/uv-$triple
if [ -x "$out" ] && "$out" --version | grep -q "^uv $UV_VERSION\b"; then exit 0; fi
case "$triple" in
  *windows*) echo "fetch-uv: Windows ships uv as a .zip; not set up yet" >&2; exit 1 ;;
esac
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
url=https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-$triple.tar.gz
curl -fsSL -o "$tmp/uv.tar.gz" "$url"
curl -fsSL -o "$tmp/uv.tar.gz.sha256" "$url.sha256"
expected=$(awk '{print $1}' "$tmp/uv.tar.gz.sha256")
actual=$(shasum -a 256 "$tmp/uv.tar.gz" | awk '{print $1}')
if [ "$expected" != "$actual" ]; then
  echo "fetch-uv: $url does not match its published sha256 ($actual, expected $expected)" >&2; exit 1
fi
tar -xzf "$tmp/uv.tar.gz" -C "$tmp"
mkdir -p "$dir"
install -m 755 "$tmp/uv-$triple/uv" "$out"
echo "fetch-uv: uv $UV_VERSION for $triple -> $out"
