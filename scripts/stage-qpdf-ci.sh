#!/usr/bin/env bash
# Stage qpdf into src-tauri/resources/qpdf for CI / release builds (non-interactive).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$(cd "$SCRIPT_DIR/../src-tauri/resources/qpdf" && pwd)"
mkdir -p "$DEST"

copy_deps() {
  local bin="$1"
  if command -v ldd >/dev/null 2>&1; then
    ldd "$bin" | awk '/=> \// { print $3 }' | while read -r lib; do
      if [[ -n "$lib" && -f "$lib" ]]; then
        cp -f "$lib" "$DEST/"
      fi
    done
  elif command -v otool >/dev/null 2>&1; then
    otool -L "$bin" | awk '/\t\// { gsub(/\(.*/, "", $1); print $1 }' | while read -r lib; do
      if [[ -f "$lib" ]]; then
        cp -f "$lib" "$DEST/"
      fi
    done
  fi
}

case "$(uname -s)" in
  Linux)
    sudo apt-get update -qq
    sudo apt-get install -y -qq qpdf
    cp -f "$(command -v qpdf)" "$DEST/qpdf"
    chmod +x "$DEST/qpdf"
    copy_deps "$DEST/qpdf"
    ;;
  Darwin)
    brew install qpdf
    cp -f "$(brew --prefix qpdf)/bin/qpdf" "$DEST/qpdf"
    chmod +x "$DEST/qpdf"
    copy_deps "$DEST/qpdf"
    ;;
  *)
    echo "Unsupported OS for stage-qpdf-ci.sh: $(uname -s)" >&2
    exit 1
    ;;
esac

echo "Staged qpdf in: $DEST"
