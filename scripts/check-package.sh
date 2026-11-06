#!/usr/bin/env bash
# The editor package as an app installs it. The desktop app reads packages/annotator from its source (a Vite alias),
# so nothing else would notice a file left out of the tarball, an export that does not resolve, a component that does
# not compile from dist, or annotator.css missing. This packs it (npm pack: exactly what `files` ships), installs the
# tarball into scripts/package-consumer (a Vite + Svelte 5 app set up as HyperStudy's frontend is), and builds that.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "${work:?}"' EXIT

npm run package --workspace @hyperstudyio/annotator
(cd "$root/packages/annotator" && npm pack --silent --pack-destination "$work" >/dev/null)
cp -R "$root/scripts/package-consumer" "$work/app"
cd "$work/app"
npm install --no-audit --no-fund --silent
npm install --no-audit --no-fund --silent --no-save "$work"/hyperstudyio-annotator-*.tgz
npx vite build --logLevel warn
grep -q 'hs-annotator' dist/assets/*.css || { echo "annotator.css is not in the consumer's build" >&2; exit 1; }
echo "The packed package installs and builds in a HyperStudy-like app."
