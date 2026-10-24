#!/usr/bin/env bash
# The uv the app bundles (tauri.conf.json bundle.externalBin), for the target being built: a pinned release of
# astral-sh/uv, checked against the sha256 pinned here for that target (taken from the release when the version was
# pinned, so a replaced asset is caught, not only a corrupted download), unpacked to src-tauri/binaries/uv-<target triple>
# (git-ignored). Runs before `tauri dev` and `tauri build`; does nothing when the right version is already there.
# To move to a newer uv: change UV_VERSION and the four sha256 values (each release publishes uv-<triple>.tar.gz.sha256).
# uv is MIT OR Apache-2.0 (https://github.com/astral-sh/uv), so the app may redistribute it.
set -euo pipefail
UV_VERSION=0.13.5
triple=${TAURI_ENV_TARGET_TRIPLE:-$(rustc -vV | sed -n 's/^host: //p')}
dir=$(cd "$(dirname "$0")/.." && pwd)/src-tauri/binaries
out=$dir/uv-$triple
if [ -x "$out" ] && "$out" --version | grep -q "^uv $UV_VERSION\b"; then exit 0; fi
case "$triple" in   # sha256 of uv-<triple>.tar.gz for UV_VERSION
  aarch64-apple-darwin)      expected=743f85035a1996ecb350659e01cd9faea9709829be09b1b4b03c73eaf3c9cd73 ;;
  x86_64-apple-darwin)       expected=b0f52b0e3945b4107d89024ea38e625683011fbfc05a0d98f9fa2d6dcee28c66 ;;
  x86_64-unknown-linux-gnu)  expected=f68d291c75783122dad58ab77def0e13f3233f358731db5d6d7e8715603b928f ;;
  aarch64-unknown-linux-gnu) expected=4bb69cf95ed13f23713bb7bc09f241896ea0c75b7c557e615a20604b82f9c403 ;;
  *windows*) echo "fetch-uv: Windows ships uv as a .zip; not set up yet" >&2; exit 1 ;;
  *) echo "fetch-uv: no sha256 pinned for $triple (add it from the release's .sha256 file)" >&2; exit 1 ;;
esac
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
url=https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-$triple.tar.gz
curl -fsSL -o "$tmp/uv.tar.gz" "$url"
if command -v shasum > /dev/null; then sum="shasum -a 256"; elif command -v sha256sum > /dev/null; then sum=sha256sum
else echo "fetch-uv: neither shasum nor sha256sum is installed" >&2; exit 1; fi
actual=$($sum "$tmp/uv.tar.gz" | awk '{print $1}')
if [ "$expected" != "$actual" ]; then
  echo "fetch-uv: $url does not match the sha256 pinned for it ($actual, expected $expected)" >&2; exit 1
fi
tar -xzf "$tmp/uv.tar.gz" -C "$tmp"
mkdir -p "$dir"
install -m 755 "$tmp/uv-$triple/uv" "$out"
echo "fetch-uv: uv $UV_VERSION for $triple -> $out"
