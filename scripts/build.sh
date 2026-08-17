#!/bin/bash
# Build dsh-session-message-nav: compile src/ → lib/ with the dsh checkout's tsc.
# Requires DSH_CHECKOUT pointing at a dsh source checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CHECKOUT="${DSH_CHECKOUT:-}"
if [ -z "$CHECKOUT" ] || [ ! -d "$CHECKOUT/packages" ]; then
  echo "build: cannot locate the dsh checkout (set DSH_CHECKOUT)" >&2
  exit 1
fi

TSC="$CHECKOUT/node_modules/.bin/tsc"
if [ ! -x "$TSC" ] && [ ! -f "$TSC.cmd" ]; then
  echo "build: tsc not found at $TSC" >&2
  exit 1
fi

link_pkg() {
  local target="$CHECKOUT/$2"
  if [ ! -e "$target" ]; then
    echo "build: dependency target missing: $target" >&2
    exit 1
  fi
  node -e "
    const fs = require('fs');
    const path = require('path');
    const link = path.resolve(process.argv[1]);
    const target = path.resolve(process.argv[2]);
    fs.rmSync(link, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  " "node_modules/$1" "$target"
}

echo "=== Linking build dependencies (checkout: $CHECKOUT) ==="
mkdir -p node_modules/@deepseek-ai
node -e "const fs=require('fs');fs.rmSync('node_modules/@standard-schema',{recursive:true,force:true})"
link_pkg cordis vendor/cordis
link_pkg cosmokit vendor/cosmokit
link_pkg schemastery vendor/schemastery
link_pkg @deepseek-ai/cordis vendor/cordis
link_pkg @deepseek-ai/dsh-client-runtime packages/client/runtime
link_pkg @deepseek-ai/dsh-client-ui-slots packages/client/ui-slots
link_pkg @deepseek-ai/dsh-client-ui-conversation packages/client/ui-conversation
link_pkg @deepseek-ai/dsh-client-ui-primitives packages/client/ui-primitives
link_pkg @deepseek-ai/dsh-client-locale packages/client/locale
link_pkg @deepseek-ai/dsh-llm packages/llm/llm

# 浏览器端类型/运行时（react 全家桶在 pnpm store 里，root node_modules 没有）
link_store_pkg() {
  # $1 = store 目录名前缀（如 react@），$2 = 包名（如 react）
  local store_dir
  store_dir=$(find "$CHECKOUT/node_modules/.pnpm" -maxdepth 1 -type d -iname "$1" 2>/dev/null | head -1)
  if [ -z "$store_dir" ]; then
    echo "build: store dependency missing: $1 under $CHECKOUT/node_modules/.pnpm" >&2
    exit 1
  fi
  node -e "
    const fs = require('fs');
    const path = require('path');
    const link = path.resolve(process.argv[1]);
    const target = path.resolve(process.argv[2]);
    fs.rmSync(link, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  " "node_modules/$2" "$store_dir/node_modules/$2"
}
link_store_pkg 'react@*' react
link_store_pkg 'react-dom@*' react-dom
link_store_pkg '@types+react@*' @types/react
link_store_pkg '@types+react-dom@*' @types/react-dom
link_pkg @types/node node_modules/@types/node

STD_SCHEMA=$(find "$CHECKOUT/node_modules/.pnpm" -maxdepth 1 -type d -iname '@standard-schema+spec@*' 2>/dev/null | head -1)
if [ -n "$STD_SCHEMA" ]; then
  node -e "
    const fs = require('fs');
    const path = require('path');
    fs.rmSync('node_modules/@standard-schema', { recursive: true, force: true });
    fs.mkdirSync('node_modules/@standard-schema', { recursive: true });
    fs.symlinkSync(path.resolve(process.argv[1]), path.resolve('node_modules/@standard-schema/spec'), process.platform === 'win32' ? 'junction' : 'dir');
  " "$STD_SCHEMA/node_modules/@standard-schema/spec"
fi

echo "=== Compiling src → lib (host half; client excluded, tsdown handles it) ==="
"$TSC" -p tsconfig.json

echo "=== Build complete ==="
ls -la lib/ lib/types/ 2>/dev/null
