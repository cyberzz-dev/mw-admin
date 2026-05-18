#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$ROOT/frontend"
BACKEND="$ROOT/backend"
WEB_TMP="$BACKEND/cmd/web"
OUTPUT="$ROOT/mw-admin"

echo "===== mw-admin Production Build ====="
echo

# Step 1: Build frontend
echo "[1/4] Building frontend..."
cd "$FRONTEND"
npm run build
cd "$ROOT"
echo

# Step 2: Copy dist into backend embed dir
echo "[2/4] Copying dist to backend embed dir..."
rm -rf "$WEB_TMP"
mkdir -p "$WEB_TMP"
cp -r "$FRONTEND/dist" "$WEB_TMP/dist"
echo

# Step 3: Build Go binary with embedded frontend
echo "[3/4] Building Go binary..."
cd "$BACKEND"
go build -tags prod -ldflags="-s -w" -trimpath -o "$OUTPUT" ./cmd/
cd "$ROOT"
echo

# Step 4: Clean up temporary embed dir
echo "[4/4] Cleaning up..."
rm -rf "$WEB_TMP"
echo

echo "===== Build complete! ====="
echo "Output : $OUTPUT"
echo
echo "Run    : ./mw-admin"
echo "Access : http://localhost:8080"
echo
