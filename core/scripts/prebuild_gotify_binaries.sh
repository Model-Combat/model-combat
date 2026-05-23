#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGETS=(
  "$ROOT/data/artifacts/gotify-v1/vuln"
  "$ROOT/data/artifacts/gotify-wave2/vuln"
  "$ROOT/data/artifacts/gotify-wave3/vuln"
)

for target in "${TARGETS[@]}"; do
  echo "prebuilding $target"
  mkdir -p "$target/build"
  docker run --rm \
    --platform linux/arm64 \
    -e GOTOOLCHAIN=local \
    -v "$target:/workspace/gotify" \
    -w /workspace/gotify \
    golang:latest \
    sh -lc 'mkdir -p build && /usr/local/go/bin/go build -o build/gotify .'
done
