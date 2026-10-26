#!/bin/bash
# Install packages on a CI runner with apt, saying where the time goes. The step that installs Tauri's Linux libraries
# usually takes about 30 s but sometimes stalled for 5 to 25 minutes (2026-10-26), and `-qq` hid where. So: first the
# apt and dpkg processes already running (the runner image's own apt timers can hold apt's lock) and the sources apt
# will fetch, then each phase with the time it starts, and apt's own lines (each source it fetches, or fails to).
# Usage: bash scripts/ci-apt.sh <package or ./file.deb>...
set -euo pipefail
stamp() { echo "[$(date -u +%H:%M:%S)] $*"; }

stamp "apt or dpkg already running:"
ps -eo pid,etime,args | grep -E '[a]pt|[d]pkg|[u]nattended' | grep -v ci-apt.sh || echo "  none"
stamp "sources:"
grep -rhE '^(deb |URIs:)' /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null | sort -u | sed 's/^/  /'

stamp "apt-get update"
sudo apt-get update
stamp "apt-get install $*"
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$@"
stamp "done"
