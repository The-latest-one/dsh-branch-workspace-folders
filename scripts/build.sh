#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TSC="node_modules/.bin/tsc"
if [ ! -x "$TSC" ] && [ ! -f "$TSC.cmd" ]; then
  if command -v tsc >/dev/null 2>&1; then
    TSC="tsc"
  elif [ -x "/root/Job/dsh-ai-manager/node_modules/.bin/tsc" ]; then
    TSC="/root/Job/dsh-ai-manager/node_modules/.bin/tsc"
  else
    echo "build: tsc not found" >&2
    exit 1
  fi
fi

echo "=== Compiling host (tsc $("$TSC" --version)) ==="
"$TSC" -p tsconfig.build.json
node scripts/copy-client-types.mjs
echo "=== Host build complete ==="
