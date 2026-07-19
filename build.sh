#!/usr/bin/env bash
set -eu

# When invoked from bun on Windows (e.g. `bun run package`), `bash` resolves to
# C:\Windows\system32\bash.exe — WSL bash. WSL Ubuntu typically has no Go,
# which silently broke the discord-bot cross-compile. If we detect WSL and a
# Git Bash is reachable via WSL interop, re-exec under Git Bash so the rest of
# the script runs with Windows Go on PATH. No-op on real Linux/macOS (the
# /proc/version check fails) and on Git Bash directly (no "microsoft" string).
if [ -z "${QMANAGER_GIT_BASH_REEXEC:-}" ] \
    && [ -r /proc/version ] \
    && grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
    GIT_BASH="/mnt/c/Program Files/Git/usr/bin/bash.exe"
    if [ -x "$GIT_BASH" ]; then
        echo "[build.sh] Detected WSL bash — re-execing under Git Bash for Windows Go access" >&2
        export QMANAGER_GIT_BASH_REEXEC=1
        exec "$GIT_BASH" "$0" "$@"
    fi
fi

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$ROOT_DIR/out"
SCRIPTS_DIR="$ROOT_DIR/scripts"
DEPS_DIR="$ROOT_DIR/dependencies"
BUILD_DIR="$ROOT_DIR/qmanager-build"
STAGING_DIR="$BUILD_DIR/qmanager_install"
ARCHIVE="$BUILD_DIR/qmanager.tar.gz"

# Colors
if [ -t 1 ]; then
  GREEN='\033[0;32m' BOLD='\033[1m' RED='\033[0;31m' NC='\033[0m'
else
  GREEN='' BOLD='' RED='' NC=''
fi

step() { printf "${GREEN}[%s]${NC} %s\n" "$(date +%H:%M:%S)" "$1"; }
fail() { printf "${RED}[%s] ERROR:${NC} %s\n" "$(date +%H:%M:%S)" "$1"; exit 1; }

# --- Preflight checks --------------------------------------------------------
[ -d "$OUT_DIR" ] || fail "'out/' not found — run 'bun run build' first"
[ -d "$DEPS_DIR" ] || fail "'dependencies/' not found at repo root"
[ -f "$DEPS_DIR/atcli_smd11" ] || fail "Missing required binary: dependencies/atcli_smd11"
[ -f "$DEPS_DIR/sms_tool" ]    || fail "Missing required binary: dependencies/sms_tool"
[ -f "$DEPS_DIR/jq.ipk" ]      || fail "Missing required package: dependencies/jq.ipk"
DROPBEAR_IPK=$(ls "$DEPS_DIR"/dropbear_*.ipk 2>/dev/null | head -n1)
[ -n "$DROPBEAR_IPK" ] || fail "Missing required package: dependencies/dropbear_*.ipk"

step "Preparing staging directory..."
mkdir -p "$BUILD_DIR"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

step "Copying frontend build output..."
cp -r "$OUT_DIR" "$STAGING_DIR/out"

step "Copying backend scripts..."
mkdir -p "$STAGING_DIR/scripts"
for item in "$SCRIPTS_DIR"/*; do
  name="$(basename "$item")"
  case "$name" in install_rm520n.sh|uninstall_rm520n.sh) continue ;; esac
  cp -r "$item" "$STAGING_DIR/scripts/$name"
done

step "Copying install & uninstall scripts..."
cp "$SCRIPTS_DIR/install_rm520n.sh"   "$STAGING_DIR/install_rm520n.sh"
cp "$SCRIPTS_DIR/uninstall_rm520n.sh" "$STAGING_DIR/uninstall_rm520n.sh"

step "Stamping version from package.json..."
PKG_VERSION=$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT_DIR/package.json" | head -n1)
[ -n "$PKG_VERSION" ] || fail "Could not read version from package.json"
tmp="$STAGING_DIR/install_rm520n.sh.tmp"
sed "s|^VERSION=\"[^\"]*\"|VERSION=\"$PKG_VERSION\"|" "$STAGING_DIR/install_rm520n.sh" > "$tmp" && mv "$tmp" "$STAGING_DIR/install_rm520n.sh"
chmod +x "$STAGING_DIR/install_rm520n.sh" "$STAGING_DIR/uninstall_rm520n.sh"
grep -q "^VERSION=\"$PKG_VERSION\"" "$STAGING_DIR/install_rm520n.sh" \
  || fail "Failed to stamp install_rm520n.sh with version $PKG_VERSION — is VERSION= line present?"
step "Stamped install_rm520n.sh with version: $PKG_VERSION"

step "Linting install_rm520n.sh (systemd service coverage)..."
# Verify every core QManager service unit actually exists in the source tree.
# A missing .service file here means the installer will enable a non-existent
# unit — silent failure on the device.
SYSTEMD_SCRIPTS_DIR="$SCRIPTS_DIR/etc/systemd/system"
# qmanager-auto-update is default-off/gated (like qmanager-watchcat and
# qmanager-tower-failover above it) but, unlike the Discord bot, is always
# shipped rather than conditionally built — so it belongs in this list too.
CORE_SERVICES="lighttpd qmanager-firewall qmanager-setup qmanager-ping qmanager-poller qmanager-ttl qmanager-mtu qmanager-imei-check qmanager-watchcat qmanager-tower-failover qmanager-auto-update"
LINT_ERRORS=0

for svc in $CORE_SERVICES; do
  if [ ! -f "$SYSTEMD_SCRIPTS_DIR/$svc.service" ]; then
    printf "  ${RED}MISSING:${NC} %s.service not found in scripts/etc/systemd/system/\n" "$svc"
    LINT_ERRORS=$((LINT_ERRORS + 1))
  fi
done

# qmanager-auto-update.service intentionally has no [Install] section (it's
# only ever started by its .timer, never boot-enabled directly) — so it needs
# its own check here; the loop above only looks for CORE_SERVICES.service.
if [ ! -f "$SYSTEMD_SCRIPTS_DIR/qmanager-auto-update.timer" ]; then
  printf "  ${RED}MISSING:${NC} qmanager-auto-update.timer not found in scripts/etc/systemd/system/\n"
  LINT_ERRORS=$((LINT_ERRORS + 1))
fi

if [ "$LINT_ERRORS" -gt 0 ]; then
  fail "Lint failed with $LINT_ERRORS missing service unit(s)"
fi
step "Lint passed ($CORE_SERVICES + qmanager-auto-update.timer)"

step "Copying bundled dependencies..."
mkdir -p "$STAGING_DIR/dependencies"
cp "$DEPS_DIR/atcli_smd11" "$STAGING_DIR/dependencies/atcli_smd11"
cp "$DEPS_DIR/sms_tool"    "$STAGING_DIR/dependencies/sms_tool"
cp "$DEPS_DIR/jq.ipk"      "$STAGING_DIR/dependencies/jq.ipk"
cp "$DEPS_DIR"/dropbear_*.ipk "$STAGING_DIR/dependencies/"
chmod 755 "$STAGING_DIR/dependencies/atcli_smd11" "$STAGING_DIR/dependencies/sms_tool"

# Discord bot binary — built fresh on every package run via build-discord-bot.sh.
DISCORD_BUILT="$ROOT_DIR/qmanager-build/bin/qmanager_discord"
[ -f "$ROOT_DIR/build-discord-bot.sh" ] || fail "build-discord-bot.sh missing — required to build qmanager_discord"

# Locate Go's absolute executable path. bun on Windows can spawn a bash with
# inconsistent PATH and command-lookup behavior, so don't rely on `command -v`.
# Probe known install dirs (POSIX, MSYS, WSL forms), then where.exe, then
# fall back to plain `go` only as a last resort.
locate_go_exe() {
    local cand
    for cand in \
        "/c/Program Files/Go/bin/go.exe" \
        "/c/Program Files (x86)/Go/bin/go.exe" \
        "/mnt/c/Program Files/Go/bin/go.exe" \
        "/mnt/c/Program Files (x86)/Go/bin/go.exe" \
        "C:/Program Files/Go/bin/go.exe" \
        "C:/Program Files (x86)/Go/bin/go.exe" \
        "$HOME/go/bin/go" \
        "$HOME/sdk/go/bin/go" \
        "/usr/local/go/bin/go"
    do
        if [ -f "$cand" ]; then
            printf '%s\n' "$cand"
            return 0
        fi
    done
    if command -v where.exe >/dev/null 2>&1; then
        local win_path posix_path
        win_path=$(where.exe go.exe 2>/dev/null | head -n1 | tr -d '\r')
        if [ -n "$win_path" ]; then
            # C:\Foo\Bar\go.exe → /c/Foo/Bar/go.exe (Git Bash) or /mnt/c/... (WSL)
            local drive_lower rest
            drive_lower=$(printf '%s' "$win_path" | head -c1 | tr 'A-Z' 'a-z')
            rest=$(printf '%s' "$win_path" | tail -c +3 | tr '\\' '/')
            if [ -d "/mnt/c" ]; then
                posix_path="/mnt/$drive_lower$rest"
            else
                posix_path="/$drive_lower$rest"
            fi
            if [ -f "$posix_path" ]; then
                printf '%s\n' "$posix_path"
                return 0
            fi
            # If neither POSIX form exists but the Windows path does (rare
            # Cygwin/native bash), pass it through unchanged.
            if [ -f "$win_path" ]; then
                printf '%s\n' "$win_path"
                return 0
            fi
        fi
    fi
    if command -v go >/dev/null 2>&1; then
        printf 'go\n'
        return 0
    fi
    return 1
}
GO_EXE=$(locate_go_exe) \
    || fail "Go not found — install from https://go.dev/dl/ (verify with: where.exe go in PowerShell)"

step "Building Discord bot (using $GO_EXE)..."
( cd "$ROOT_DIR" && GO_EXE="$GO_EXE" ./build-discord-bot.sh ) \
    || fail "build-discord-bot.sh failed"

[ -f "$DISCORD_BUILT" ] || fail "Build reported success but $DISCORD_BUILT not found"
cp "$DISCORD_BUILT" "$STAGING_DIR/dependencies/qmanager_discord"
chmod 755 "$STAGING_DIR/dependencies/qmanager_discord"
step "Staged Discord bot binary"

step "Creating qmanager.tar.gz..."
tar czf "$ARCHIVE" -C "$BUILD_DIR" qmanager_install

step "Generating sha256sum.txt..."
(cd "$BUILD_DIR" && sha256sum qmanager.tar.gz > sha256sum.txt)

# Clean up staging only after both release artifacts exist.
if [ -f "$ARCHIVE" ] && [ -f "$BUILD_DIR/sha256sum.txt" ]; then
  step "Cleaning up staging directory..."
  rm -rf "$STAGING_DIR"
fi

ARCHIVE_SIZE=$(du -h "$ARCHIVE" | cut -f1)
FILE_COUNT=$(tar tzf "$ARCHIVE" | wc -l)
SHA_VALUE=$(awk '{print $1}' "$BUILD_DIR/sha256sum.txt")
printf "\n${GREEN}${BOLD}Build complete!${NC} qmanager.tar.gz (%s, %d files)\n" "$ARCHIVE_SIZE" "$FILE_COUNT"
printf "SHA-256: %s\n\n" "$SHA_VALUE"
