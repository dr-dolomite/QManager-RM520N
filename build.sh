#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$ROOT_DIR/qmanager_install"
OUT_DIR="$ROOT_DIR/out"
SCRIPTS_DIR="$ROOT_DIR/scripts"
BUILD_DIR="$ROOT_DIR/qmanager-build"
ARCHIVE="$BUILD_DIR/qmanager.tar.gz"

# Colors
if [ -t 1 ]; then
  GREEN='\033[0;32m' BOLD='\033[1m' RED='\033[0;31m' NC='\033[0m'
else
  GREEN='' BOLD='' RED='' NC=''
fi

step() { printf "${GREEN}[%s]${NC} %s\n" "$(date +%H:%M:%S)" "$1"; }
fail() { printf "${RED}[%s] ERROR:${NC} %s\n" "$(date +%H:%M:%S)" "$1"; exit 1; }

[ -d "$OUT_DIR" ] || fail "'out/' not found — run 'bun run build' first"

step "Cleaning qmanager_install/..."
rm -rf "$INSTALL_DIR/out" "$INSTALL_DIR/scripts" "$INSTALL_DIR/install.sh" "$INSTALL_DIR/uninstall.sh"
mkdir -p "$INSTALL_DIR"

step "Copying frontend build output..."
cp -r "$OUT_DIR" "$INSTALL_DIR/out"

step "Copying backend scripts..."
mkdir -p "$INSTALL_DIR/scripts"
for item in "$SCRIPTS_DIR"/*; do
  name="$(basename "$item")"
  case "$name" in install.sh|uninstall.sh) continue ;; esac
  cp -r "$item" "$INSTALL_DIR/scripts/$name"
done

step "Copying install & uninstall scripts..."
cp "$SCRIPTS_DIR/install.sh" "$INSTALL_DIR/install.sh"
cp "$SCRIPTS_DIR/uninstall.sh" "$INSTALL_DIR/uninstall.sh"

step "Creating qmanager.tar.gz..."
mkdir -p "$BUILD_DIR"

# Preserve previous archive as rollback image
if [ -f "$ARCHIVE" ]; then
  mv "$ARCHIVE" "$ARCHIVE.old"
  step "Preserved previous build as qmanager.tar.gz.old (rollback image)"
fi

tar czf "$ARCHIVE" -C "$ROOT_DIR" qmanager_install

ARCHIVE_SIZE=$(du -h "$ARCHIVE" | cut -f1)
FILE_COUNT=$(tar tzf "$ARCHIVE" | wc -l)
printf "\n${GREEN}${BOLD}Build complete!${NC} qmanager.tar.gz (%s, %d files)\n" "$ARCHIVE_SIZE" "$FILE_COUNT"
if [ -f "$ARCHIVE.old" ]; then
  OLD_SIZE=$(du -h "$ARCHIVE.old" | cut -f1)
  printf "${GREEN}${BOLD}Rollback image:${NC} qmanager.tar.gz.old (%s)\n" "$OLD_SIZE"
fi
printf "\n"
