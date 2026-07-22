#!/usr/bin/env bash
# Build the qmanager_ping Rust binary for ARMv7-musl and install it into
# scripts/usr/bin/ where the QManager installer expects it.
#
# RETIRED: qmanager_ping is now a shell daemon at scripts/usr/bin/qmanager_ping
# (ported from RM551E's ICMP-probing shell daemon, adapted to RM520N-GL's
# JSON config at /etc/qmanager/ping_profile.json). This Rust build step is no
# longer used and must NOT be re-run — doing so would overwrite the shell
# script with a stale compiled ELF. The ping-daemon/ crate itself is kept
# around for reference only, pending a later cleanup commit.
echo "ERROR: qmanager_ping is now a shell script (scripts/usr/bin/qmanager_ping)." >&2
echo "This Rust build step is retired and must not be run — it would clobber" >&2
echo "the shell daemon with a stale ELF binary. See ping-daemon/build-ping-daemon.sh" >&2
echo "history / RELEASE_NOTES.md for the ICMP daemon migration." >&2
exit 1

set -euo pipefail

MODE="release"
if [ "${1:-}" = "--debug" ]; then
    MODE="debug"
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRATE_DIR="$REPO_ROOT/ping-daemon"
TARGET="armv7-unknown-linux-musleabihf"
DEST="$REPO_ROOT/scripts/usr/bin/qmanager_ping"

cd "$CRATE_DIR"

if ! rustup target list --installed | grep -q "^${TARGET}\$"; then
    echo "Installing Rust target ${TARGET}..."
    rustup target add "$TARGET"
fi

if ! command -v arm-linux-gnueabihf-gcc >/dev/null 2>&1; then
    echo "ERROR: arm-linux-gnueabihf-gcc not found. Install with:" >&2
    echo "  sudo apt install gcc-arm-linux-gnueabihf" >&2
    exit 1
fi

echo "Building qmanager_ping (${MODE}, target=${TARGET})..."
if [ "$MODE" = "release" ]; then
    cargo build --release --target="$TARGET"
    BIN="$CRATE_DIR/target/$TARGET/release/qmanager_ping"
else
    cargo build --target="$TARGET"
    BIN="$CRATE_DIR/target/$TARGET/debug/qmanager_ping"
fi

if [ ! -f "$BIN" ]; then
    echo "ERROR: build did not produce $BIN" >&2
    exit 1
fi

if [ "$MODE" = "release" ]; then
    if command -v arm-linux-gnueabihf-strip >/dev/null 2>&1; then
        echo "Stripping binary..."
        arm-linux-gnueabihf-strip "$BIN"
    fi
fi

# DO NOT UPX-compress: Rust ARM + UPX = segfault on exit (project memory).
echo "(skipping UPX — Rust ARM binaries segfault on exit when packed)"

cp "$BIN" "$DEST"
chmod +x "$DEST"

SIZE=$(stat -c %s "$DEST")
SIZE_KB=$((SIZE / 1024))
echo "Installed to: $DEST (${SIZE_KB} KB)"

if [ "$SIZE_KB" -gt 800 ]; then
    echo "WARNING: binary is ${SIZE_KB} KB — spec target is 300-450 KB. Consider:" >&2
    echo "  - cargo install cargo-bloat && cargo bloat --release --target=$TARGET" >&2
fi
