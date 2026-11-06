#!/usr/bin/env bash
# Build the browser version into web/pkg. Requires: rustup target wasm32-unknown-unknown,
# wasm-bindgen-cli 0.2.100 (cargo install wasm-bindgen-cli --version 0.2.100).
set -euo pipefail
cd "$(dirname "$0")"
cargo build -p swiv-web --target wasm32-unknown-unknown --release
wasm-bindgen --target web --no-typescript --out-dir web/pkg \
  target/wasm32-unknown-unknown/release/swiv_web.wasm
echo "built web/pkg; serve web/ with any static server, e.g.: python3 -m http.server -d web 8080"
