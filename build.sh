#!/usr/bin/env bash
set -eu

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

DEPS_DIR="$ROOT_DIR/dependencies"

step "Cleaning qmanager_install/..."
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

step "Copying frontend build output..."
cp -r "$OUT_DIR" "$INSTALL_DIR/out"

step "Copying backend scripts..."
mkdir -p "$INSTALL_DIR/scripts"
for item in "$SCRIPTS_DIR"/*; do
  name="$(basename "$item")"
  case "$name" in install*.sh|uninstall*.sh) continue ;; esac
  cp -r "$item" "$INSTALL_DIR/scripts/$name"
done

step "Copying install & uninstall scripts..."
cp "$SCRIPTS_DIR/install_rm520n.sh" "$INSTALL_DIR/install_rm520n.sh"
cp "$SCRIPTS_DIR/uninstall_rm520n.sh" "$INSTALL_DIR/uninstall_rm520n.sh"

step "Copying bundled dependencies..."
if [ -d "$DEPS_DIR" ]; then
  cp -r "$DEPS_DIR" "$INSTALL_DIR/dependencies"
else
  fail "'dependencies/' not found — atcli_smd11, sms_tool, jq.ipk, dropbear.ipk are required"
fi

step "Creating qmanager.tar.gz..."
mkdir -p "$BUILD_DIR"
tar czf "$ARCHIVE" -C "$ROOT_DIR" qmanager_install

step "Generating sha256sum.txt..."
(cd "$BUILD_DIR" && sha256sum qmanager.tar.gz > sha256sum.txt)

ARCHIVE_SIZE=$(du -h "$ARCHIVE" | cut -f1)
FILE_COUNT=$(tar tzf "$ARCHIVE" | wc -l)
SHA_VALUE=$(awk '{print $1}' "$BUILD_DIR/sha256sum.txt")
printf "\n${GREEN}${BOLD}Build complete!${NC} qmanager.tar.gz (%s, %d files)\n" "$ARCHIVE_SIZE" "$FILE_COUNT"
printf "SHA-256: %s\n\n" "$SHA_VALUE"
