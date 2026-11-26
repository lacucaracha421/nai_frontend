#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[1/3] Pulling latest source..."
git pull --ff-only

echo "[2/3] Building frontend..."
npm ci
npm run build

echo "[3/3] Building Rust web server (release, headless)..."
cargo build --manifest-path src-tauri/Cargo.toml --release --no-default-features --features web-server --bin nai-web-server

if systemctl list-unit-files | grep -q '^nai-web-server\.service'; then
  echo "[OK] Restarting nai-web-server.service..."
  sudo systemctl restart nai-web-server
  sudo systemctl status nai-web-server --no-pager -l | head -n 15
else
  echo "[OK] Build complete. Install deploy/nai-web-server.service to run as a background service."
fi
