#!/bin/sh
# Cross-compile qmanager_discord for RM520N-GL (ARMv7l, Linux)
set -eu

OUT="qmanager-build/bin/qmanager_discord"
mkdir -p qmanager-build/bin

GO_EXE="${GO_EXE:-go}"

# Fail fast with an actionable message if Go isn't reachable. On Windows from
# PowerShell, `bash` resolves to WSL bash (C:\Windows\system32\bash.exe) by
# default, and WSL Ubuntu typically has no Go installed. Without this guard the
# next line errors with `env: 'go': No such file or directory`, which is
# correct but unhelpful.
if [ "$GO_EXE" = "go" ]; then
    if ! command -v go >/dev/null 2>&1; then
        echo "ERROR: 'go' not found on PATH." >&2
        if [ -r /proc/version ] && grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
            echo "  Detected WSL — Windows Go is not visible here unless installed inside WSL." >&2
            echo "  From PowerShell, prefer:  sh ./build-discord-bot.sh   (resolves to Git Bash)" >&2
        else
            echo "  Install Go from https://go.dev/dl/ or set GO_EXE to an absolute path." >&2
        fi
        exit 1
    fi
elif [ ! -f "$GO_EXE" ]; then
    echo "ERROR: GO_EXE='$GO_EXE' does not exist." >&2
    exit 1
fi

echo "Building qmanager_discord for linux/arm7 (go: $GO_EXE)..."
# Use `env` (a real binary) to set GOOS/GOARCH so bun's embedded shell on
# Windows can't drop the env vars during shell parsing — it would otherwise
# silently produce a windows/amd64 PE binary with the wrong architecture.
#
# Build flags:
#   -trimpath          strip absolute filesystem paths from pclntab
#   -buildvcs=false    skip embedded git revision metadata
#   -ldflags "-s -w"   strip symbol table and DWARF debug info
#   -ldflags "-buildid="  blank the Go build ID (small but free)
cd discord-bot
env GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0 "$GO_EXE" build \
    -trimpath -buildvcs=false \
    -ldflags="-s -w -buildid=" \
    -o "../${OUT}" .
cd ..

# Verify the architecture before claiming success — prevents silent regressions.
case "$(head -c 4 "${OUT}" | od -An -c 2>/dev/null | tr -d ' \n')" in
    *ELF*) ;;
    *) echo "ERROR: ${OUT} is not an ELF binary — cross-compile env vars were not honored" >&2; exit 1 ;;
esac

RAW_SIZE=$(du -sh "$OUT" | cut -f1)
echo "Built (uncompressed): ${OUT} (${RAW_SIZE})"

# UPX compression — validated on RM520N-GL hardware to cut binary size ~72%
# (7.1 MB -> 2.0 MB) with no runtime regressions. Unlike the Rust atcli_smd11
# binary (which segfaults on exit when UPX-packed), the Go runtime exits
# cleanly through UPX's decompression stub on this kernel.
#
# Set UPX_COMPRESS=0 to skip compression for debugging — uncompressed binaries
# are easier to inspect with strings/objdump and start ~50ms faster.
if [ "${UPX_COMPRESS:-1}" = "1" ]; then
    # Prefer a project-bundled upx (gitignored under tools/upx/) over PATH so
    # builds are reproducible regardless of the developer's system install.
    UPX_BIN=""
    if [ -x "tools/upx/upx.exe" ]; then
        UPX_BIN="tools/upx/upx.exe"
    elif [ -x "tools/upx/upx" ]; then
        UPX_BIN="tools/upx/upx"
    elif command -v upx >/dev/null 2>&1; then
        UPX_BIN="upx"
    fi

    if [ -n "$UPX_BIN" ]; then
        echo "Compressing with $UPX_BIN --lzma --best..."
        "$UPX_BIN" --lzma --best "$OUT" >/dev/null 2>&1 || {
            echo "ERROR: upx compression failed" >&2
            exit 1
        }
        PACKED_SIZE=$(du -sh "$OUT" | cut -f1)
        echo "Built (compressed):   ${OUT} (${PACKED_SIZE})"
    else
        echo "WARNING: upx not found — shipping uncompressed ${RAW_SIZE} binary." >&2
        echo "         Drop a binary at tools/upx/upx.exe (Windows) or tools/upx/upx (Linux)" >&2
        echo "         to enable compression. Download: https://upx.github.io/" >&2
    fi
fi
