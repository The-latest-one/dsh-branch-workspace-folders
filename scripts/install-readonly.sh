#!/usr/bin/env bash
# Reliable install/update flow for DSH branch-graph-sidebar in read-only root
# filesystems.  It optionally remounts / rw, rebuilds the plugin, refreshes
# pnpm-lock.yaml, installs the local tarball, and restarts `dsh web`.
set -euo pipefail

REPO="${1:-$PWD}"
PROFILE="${2:-${DSH_HOME:-$HOME/.dsh}/profiles/web}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
DSH_START_DIR="${DSH_START_DIR:-$HOME}"

ensure_writable() {
  local target="$1"
  if [ ! -w "$target" ]; then
    echo "[install-readonly] '$target' is not writable, attempting remount..."
    # Best-effort remount. In containers this is often permitted; on truly
    # immutable systems this will fail and the script stops with a clear error.
    mount -o remount,rw / 2>/dev/null || true
  fi
  if [ ! -w "$target" ]; then
    echo "[install-readonly] ERROR: '$target' is still read-only." >&2
    echo "[install-readonly] Manual action required: remount the root filesystem rw, or bind-mount a writable path over $DSH_HOME." >&2
    exit 1
  fi
}

echo "[install-readonly] Ensuring writable DSH home and profile..."
ensure_writable "$DSH_HOME"
ensure_writable "$PROFILE"

echo "[install-readonly] Building plugin in $REPO..."
cd "$REPO"
npm run typecheck
npm run build
npm pack --loglevel=error

echo "[install-readonly] Updating profile package/lock and installing tarball..."
cd "$PROFILE"
# The profile already references the local tarball via file: dependency.
# `--no-frozen-lockfile` lets pnpm add the missing lockfile entry.  We prefer
# offline mode so an network outage cannot erase an already-installed plugin.
if ! pnpm install --offline --no-frozen-lockfile; then
  echo "[install-readonly] Offline install failed; retrying with prefer-offline..."
  pnpm install --prefer-offline --no-frozen-lockfile
fi

echo "[install-readonly] Restarting DSH web..."
# Match both `node /usr/local/bin/dsh web` and `dsh web` processes.
pkill -f "dsh web" 2>/dev/null || true
sleep 1
cd "$DSH_START_DIR"
nohup dsh web >/tmp/dsh-web.log 2>&1 &
echo "[install-readonly] DSH web restarted with pid $!"
