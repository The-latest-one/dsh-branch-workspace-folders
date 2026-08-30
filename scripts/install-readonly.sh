#!/usr/bin/env bash
# Reliable install/update flow for DSH branch-workspace-folders.
#   - Works on read-only root filesystems (remounts / rw when needed).
#   - Builds and packs the plugin.
#   - Copies the tarball into the target DSH profile.
#   - Tries pnpm offline/prefer-offline install.
#   - If pnpm full-profile install is blocked by unrelated remote deps,
#     falls back to directly syncing the plugin files into the already-installed
#     node_modules package so the plugin can be updated without network.
set -euo pipefail

REPO="${1:-$PWD}"
PROFILE="${2:-${DSH_PROFILE:-${DSH_HOME:-$HOME/.dsh}/profiles/web}}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
DSH_START_DIR="${DSH_START_DIR:-$HOME}"
NPM_CACHE_DIR="${NPM_CACHE_DIR:-/tmp/dsh-npm-cache}"
PNPM_STORE_DIR="${PNPM_STORE_DIR:-}"
PNPM_CACHE_DIR="${PNPM_CACHE_DIR:-}"

ensure_writable() {
  local target="$1"
  if [ ! -w "$target" ]; then
    echo "[install-dsh] '$target' is not writable, attempting remount..."
    # Best-effort remount. In containers this is often permitted; on truly
    # immutable systems this will fail and the script stops with a clear error.
    mount -o remount,rw / 2>/dev/null || true
  fi
  if [ ! -w "$target" ]; then
    echo "[install-dsh] ERROR: '$target' is still read-only." >&2
    echo "[install-dsh] Manual action required: remount the root filesystem rw, or bind-mount a writable path over $DSH_HOME." >&2
    exit 1
  fi
}

sync_plugin_files() {
  local install_dir="$PROFILE/node_modules/$PKG_NAME"
  if [ ! -e "$install_dir" ]; then
    echo "[install-dsh] ERROR: $install_dir does not exist; cannot direct-sync." >&2
    echo "[install-dsh] Please run the pnpm install manually when network is available." >&2
    exit 1
  fi
  if [ -L "$install_dir" ]; then
    install_dir="$(readlink -f "$install_dir")"
  fi
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  tar -xzf "$TARBALL" -C "$tmp_dir"
  cp -a "$tmp_dir/package/." "$install_dir/"
  rm -rf "$tmp_dir"
  echo "[install-dsh] Direct sync completed: $install_dir"
}


echo "[install-dsh] Ensuring writable DSH home and profile..."
ensure_writable "$DSH_HOME"
ensure_writable "$PROFILE"

echo "[install-dsh] Building plugin in $REPO..."
cd "$REPO"
npm run typecheck
npm run build
mkdir -p "$NPM_CACHE_DIR"
npm pack --cache "$NPM_CACHE_DIR" --loglevel=error

PKG_NAME="$(node -p "require('./package.json').name")"
PKG_VERSION="$(node -p "require('./package.json').version")"
TARBALL="$PWD/${PKG_NAME}-${PKG_VERSION}.tgz"
VENDOR_DIR="$PROFILE/vendor"

if [ ! -d "$VENDOR_DIR" ]; then
  mkdir -p "$VENDOR_DIR"
fi
cp -f "$TARBALL" "$VENDOR_DIR/"
echo "[install-dsh] Copied tarball to $VENDOR_DIR/"

cd "$PROFILE"

PNPM_FLAGS=(--no-frozen-lockfile)
if [ -n "$PNPM_STORE_DIR" ]; then
  PNPM_FLAGS+=(--store-dir "$PNPM_STORE_DIR")
fi
if [ -n "$PNPM_CACHE_DIR" ]; then
  PNPM_FLAGS+=(--cache-dir "$PNPM_CACHE_DIR")
fi

install_ok=0
echo "[install-dsh] Trying pnpm offline install..."
if pnpm install --offline "${PNPM_FLAGS[@]}"; then
  install_ok=1
else
  echo "[install-dsh] Offline install failed; retrying with prefer-offline..."
  if pnpm install --prefer-offline "${PNPM_FLAGS[@]}"; then
    install_ok=1
  fi
fi

if [ "$install_ok" -ne 1 ]; then
  echo "[install-dsh] pnpm full-profile install is blocked (often by unrelated GitHub dependencies without network)."
  echo "[install-dsh] Falling back to direct plugin file sync into existing node_modules..."
  sync_plugin_files
else
  echo "[install-dsh] pnpm install succeeded; keeping node_modules managed by pnpm."
fi

echo "[install-dsh] Restarting DSH web..."
# Match both `node /usr/local/bin/dsh web` and `dsh web` processes.
pkill -f "dsh web" 2>/dev/null || true
sleep 1
cd "$DSH_START_DIR"
nohup dsh web >/tmp/dsh-web.log 2>&1 &
echo "[install-dsh] DSH web restarted with pid $!"
