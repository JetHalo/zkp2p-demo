#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM_DIR="$ROOT_DIR/.upstream/tlsn-plugin-boilerplate"

mkdir -p "$ROOT_DIR/.upstream"

if [ -d "$UPSTREAM_DIR/.git" ]; then
  echo "[tlsn-wise-plugin] updating existing boilerplate..."
  git -C "$UPSTREAM_DIR" pull --ff-only
else
  echo "[tlsn-wise-plugin] cloning boilerplate..."
  git clone --depth=1 https://github.com/tlsnotary/tlsn-plugin-boilerplate.git "$UPSTREAM_DIR"
fi

cat <<'EOF'

[tlsn-wise-plugin] bootstrap complete.

Next:
1) cd apps/tlsn-wise-plugin/.upstream/tlsn-plugin-boilerplate
2) follow upstream build steps
3) generate wise.plugin.wasm
4) set your app's tlsnPluginUrl to that wasm URL

EOF
