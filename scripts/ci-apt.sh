#!/bin/bash
# Install packages on a CI runner with apt, saying where the time goes. The step that installs Tauri's Linux libraries
# usually takes about 30 s but sometimes stalled for 5 to 25 minutes (2026-10-26), and `-qq` hid where. So: first the
# apt and dpkg processes already running (the runner image's own apt timers can hold apt's lock) and the sources apt
# will fetch, then each phase with the time it starts, and apt's own lines (each source it fetches, or fails to).
#
# Why it stalled: the packages come from Azure's Ubuntu mirror, whose speed varies by the run: 77 MB in 7 s at
# 10.7 MB/s, or in 2 min 50 s at 451 kB/s (no errors, no retries, no lock), and at its slowest the step took 18 min.
# So APT_ARCHIVES, when set, is a folder the downloaded packages are kept in, which the workflow caches: a run then
# downloads only what changed since, not 77 MB from the mirror every time.
# Usage: [APT_ARCHIVES=<folder>] bash scripts/ci-apt.sh <package or ./file.deb>...
set -euo pipefail
stamp() { echo "[$(date -u +%H:%M:%S)] $*"; }
keep=()
if [ -n "${APT_ARCHIVES:-}" ]; then
  mkdir -p "$APT_ARCHIVES/partial"
  sudo chown _apt "$APT_ARCHIVES/partial"   # apt downloads as the _apt user
  keep=(-o "Dir::Cache::Archives=$APT_ARCHIVES" -o APT::Keep-Downloaded-Packages=true)
  stamp "packages kept in $APT_ARCHIVES: $(find "$APT_ARCHIVES" -maxdepth 1 -name '*.deb' | wc -l) from earlier runs"
fi

stamp "apt or dpkg already running:"
ps -eo pid,etime,args | grep -E '[a]pt|[d]pkg|[u]nattended' | grep -v ci-apt.sh || echo "  none"
stamp "sources:"
grep -rhE '^(deb |URIs:)' /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null | sort -u | sed 's/^/  /'

stamp "apt-get update"
sudo apt-get update
stamp "apt-get install $*"
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q "${keep[@]}" "$@"
stamp "done"
