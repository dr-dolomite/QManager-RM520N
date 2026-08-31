#!/bin/bash
# =============================================================================
# QManager Installation Script — RM520N-GL
# =============================================================================
# Installs QManager frontend and backend onto the RM520N-GL modem,
# replacing SimpleAdmin as the web management interface.
#
# Expected archive layout (tar.gz extracted to /tmp/qmanager_install/):
#   out/                    — Next.js static export (frontend)
#   scripts/                — Backend shell scripts
#     etc/systemd/system/   — Systemd unit files
#     etc/sudoers.d/        — Sudoers rules
#     etc/qmanager/         — Config files
#     usr/bin/              — Daemons and utilities
#     usr/lib/qmanager/     — Shared shell libraries
#     www/cgi-bin/          — CGI API endpoints
#     usrdata/qmanager/     — lighttpd config
#   dependencies/           — Bundled binaries and packages
#     atcli_smd11           — ARM binary (AT command transport via /dev/smd11)
#     sms_tool              — ARM binary (SMS send/recv/delete via /dev/smd11)
#     jq.ipk                — JSON processor (Entware package)
#     dropbear_*.ipk        — SSH server (Entware package)
#   install_rm520n.sh       — This script
#
# Usage:
#   1. Transfer qmanager.tar.gz to /tmp/ on the device
#   2. cd /tmp && tar xzf qmanager.tar.gz
#   3. cd /tmp/qmanager_install && bash install_rm520n.sh
#
# Flags:
#   --frontend-only    Only install frontend files
#   --backend-only     Only install backend scripts
#   --no-enable        Don't enable systemd services
#   --no-start         Don't start services after install
#   --skip-packages    Skip dependency installation
#   --no-reboot        Don't reboot after installation
#   --force            Skip modem firmware detection in preflight
#   --help             Show this help
#
# =============================================================================

set -e

# --- Configuration -----------------------------------------------------------

# Placeholder — overwritten by build.sh at package time. Running this script
# straight from a git checkout (not a built release tarball) stamps this
# placeholder as the installed version, so a dev box will perpetually see
# "update available" against any real release. Not a bug — just don't chase it.
VERSION="v0.1.5"
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"

# Destinations
QMANAGER_ROOT="/usrdata/qmanager"
WWW_ROOT="/usrdata/qmanager/www"
CGI_DIR="/usrdata/qmanager/www/cgi-bin/quecmanager"
LIB_DIR="/usr/lib/qmanager"
BIN_DIR="/usr/bin"
SYSTEMD_DIR="/lib/systemd/system"
WANTS_DIR="/lib/systemd/system/multi-user.target.wants"
TIMERS_WANTS_DIR="/lib/systemd/system/timers.target.wants"
TAILSCALE_DIR="/usrdata/tailscale"

# Detect Entware vs system sudo (called as function — must re-evaluate
# after install_dependencies installs sudo on a fresh modem)
detect_sudo() {
    if [ -f /opt/etc/sudoers ]; then
        SUDOERS_DIR="/opt/etc/sudoers.d"
        SUDOERS_CONF="/opt/etc/sudoers"
        SUDO_BIN="/opt/bin/sudo"
    elif [ -f /etc/sudoers ]; then
        SUDOERS_DIR="/etc/sudoers.d"
        SUDOERS_CONF="/etc/sudoers"
        SUDO_BIN="/usr/bin/sudo"
    else
        SUDOERS_DIR=""
        SUDOERS_CONF=""
        SUDO_BIN=""
    fi
}
detect_sudo
CONF_DIR="/etc/qmanager"
# Root-only store for alert secrets (Discord bot token, Gmail app password,
# msmtprc). Deliberately a SIBLING of $CONF_DIR, not a subdirectory: www-data
# owns $CONF_DIR, so it could rename any subdirectory of it out of the way.
# See migrate_alert_secrets().
SECRETS_DIR="/etc/qmanager-secrets"
CERT_DIR="/usrdata/qmanager/certs"
SESSION_DIR="/tmp/qmanager_sessions"
# Timestamped auth.json snapshots (the QManager login password), one per
# install/OTA run, newest 5 kept. Deliberately a SIBLING of $CONF_DIR for the
# same reason as $SECRETS_DIR above and /etc/qmanager.env: www-data owns
# $CONF_DIR, and unlink/rename permission comes from the PARENT directory, so
# nothing inside it can be protected from www-data no matter its own owner or
# mode — and qmanager_setup:177 chowns the whole tree to www-data on every
# boot anyway. This lived at /etc/qmanager/backups until F22. See
# migrate_backup_location().
BACKUP_DIR="/etc/qmanager-backups"
LIGHTTPD_CONF="/usrdata/qmanager/lighttpd.conf"

# Source directories (relative to INSTALL_DIR)
SRC_FRONTEND="$INSTALL_DIR/out"
SRC_SCRIPTS="$INSTALL_DIR/scripts"
SRC_DEPS="$INSTALL_DIR/dependencies"

# Entware opkg path
OPKG="/opt/bin/opkg"

# Optional packages (not bundled — installed from Entware if available)
OPTIONAL_PACKAGES="msmtp"

# Two-phase version write: written at preflight, finalized at the end
VERSION_PENDING="/etc/qmanager/VERSION.pending"

# Watchcat lock prevents Tier-4 reboot during install
WATCHCAT_LOCK="/tmp/qmanager_watchcat.lock"

# Status of early SSH bootstrap; set by setup_ssh_early(), read by print_summary().
# Values: installed | skipped_ota | skipped_existing | failed_install | failed_start | failed_password | not_run
SSH_BOOTSTRAP_STATUS="not_run"

# Install log (qmanager_update tails this for step progress)
LOG_FILE="/tmp/qmanager_install.log"

# Services gated on config: only re-enable if they were already enabled.
UCI_GATED_SERVICES="qmanager-watchcat qmanager-tower-failover qmanager-discord qmanager-sms-forward"

# Conflict packages that must be removed before installing
CONFLICT_PACKAGES="socat socat-at-bridge"

# Full IANA tzdata (RM520N-GL's vendor /usr/share/zoneinfo ships empty) —
# see ensure_zoneinfo_packages()
ZONEINFO_PACKAGE="zoneinfo-all"

# --- Colors & Icons ----------------------------------------------------------

if [ -t 1 ]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    BLUE='\033[0;34m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' BLUE='' BOLD='' DIM='' NC=''
fi
ICO_OK='✓'; ICO_WARN='⚠'; ICO_ERR='✗'; ICO_STEP='▶'

# --- Logging -----------------------------------------------------------------

log_init() {
    : > "$LOG_FILE"
    _log_raw "QManager install started — version $VERSION"
}

_log_raw() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE"
}

info() {
    _log_raw "INFO  $1"
    printf "    ${GREEN}${ICO_OK}${NC}  %s\n" "$1"
}

warn() {
    _log_raw "WARN  $1"
    printf "    ${YELLOW}${ICO_WARN}${NC}  %s\n" "$1"
}

error() {
    _log_raw "ERROR $1"
    printf "    ${RED}${ICO_ERR}${NC}  %s\n" "$1"
}

die() {
    error "$1"
    exit 1
}

# --- qm_timeout: portable `timeout` wrapper (BusyBox 1.29 vs 1.31 straddle) --
# LOCAL COPY of qm_timeout() from scripts/usr/lib/qmanager/platform.sh. This
# script needs its own copy rather than sourcing the lib: LIB_DIR points at
# the DEPLOYED path (/usr/lib/qmanager), which doesn't exist yet this early
# in a fresh install, and `--frontend-only` (DO_BACKEND=0) never deploys libs
# at all while still running the AT/service verification code below that
# needs a portable timeout. Keep this block byte-for-byte logically
# identical to platform.sh's qm_timeout — a change to the BusyBox-version
# rationale, the 143->124 remap, or the fail-open bound belongs in BOTH
# places. See platform.sh for the full rationale; only the set -e-specific
# notes below are unique to this copy.
#
# BusyBox changed `timeout`'s CLI in 1.30: SECS went from an option
# (`-t SECS`) to a positional first argument, and `-t` was dropped.
# RG501Q-EU (v1.29.3) and RM520N-GL (v1.31.1) straddle that change, so no
# single literal invocation works on both. `command -v timeout` cannot tell
# the two apart (BusyBox always provides the applet) — detect by BEHAVIOUR
# instead: run `timeout 1 true` once and check for exit 127.
#
# Every probe/dispatch below uses "cmd || rc=$?" rather than a bare
# "cmd; rc=$?" — this script runs under `set -e` (see top of file), and a
# bare statement's non-zero exit outside an if/while/&&/|| test aborts the
# WHOLE INSTALL, including on the very probe that exists to detect a
# non-zero exit on purpose.
_QM_TIMEOUT_BIN=""
_QM_TIMEOUT_FORM=""   # "positional" (coreutils/BusyBox >=1.30) or "legacy" (-t, BusyBox <1.30)

if [ -x /opt/bin/timeout ]; then
    _qm_probe_rc=0
    /opt/bin/timeout 1 true >/dev/null 2>&1 || _qm_probe_rc=$?
    if [ "$_qm_probe_rc" -ne 127 ]; then
        _QM_TIMEOUT_BIN="/opt/bin/timeout"
        _QM_TIMEOUT_FORM="positional"
    fi
fi

if [ -z "$_QM_TIMEOUT_BIN" ] && [ -x /usr/bin/timeout ]; then
    _qm_probe_rc=0
    /usr/bin/timeout 1 true >/dev/null 2>&1 || _qm_probe_rc=$?
    if [ "$_qm_probe_rc" -eq 127 ]; then
        _QM_TIMEOUT_BIN="/usr/bin/timeout"
        _QM_TIMEOUT_FORM="legacy"
    else
        _QM_TIMEOUT_BIN="/usr/bin/timeout"
        _QM_TIMEOUT_FORM="positional"
    fi
fi
unset _qm_probe_rc

# qm_timeout SECS COMMAND [ARGS...] — callers always write the coreutils
# (positional) form; dispatches to whichever CLI shape was detected above,
# and remaps a BusyBox SIGTERM-relay (143) to the documented 124 contract.
# See platform.sh's qm_timeout for why the remap is scoped to this function
# only, not a global "143 means timeout" rule.
qm_timeout() {
    local secs="$1"
    shift
    local rc=0
    local cmd_pid waited killed

    if [ -n "$_QM_TIMEOUT_BIN" ] && [ "$_QM_TIMEOUT_FORM" = "positional" ]; then
        "$_QM_TIMEOUT_BIN" "$secs" "$@" || rc=$?
    elif [ -n "$_QM_TIMEOUT_BIN" ] && [ "$_QM_TIMEOUT_FORM" = "legacy" ]; then
        "$_QM_TIMEOUT_BIN" -t "$secs" "$@" || rc=$?
    else
        # Fail open, but never unbounded: neither probe found a usable
        # `timeout` (should not happen on either target device). Bound the
        # command manually rather than exec'ing it with no limit at all —
        # an unbounded call inside this `set -e` installer would hang the
        # whole install, which is the exact hazard `timeout` exists to
        # prevent.
        "$@" &
        cmd_pid=$!
        waited=0
        killed=0
        while kill -0 "$cmd_pid" 2>/dev/null; do
            if [ "$waited" -ge "$secs" ]; then
                kill -TERM "$cmd_pid" 2>/dev/null || true
                wait "$cmd_pid" 2>/dev/null || true
                rc=143
                killed=1
                break
            fi
            sleep 1
            waited=$((waited + 1))
        done
        if [ "$killed" -eq 0 ]; then
            wait "$cmd_pid" || rc=$?
        fi
    fi

    [ "$rc" -eq 143 ] && rc=124
    return "$rc"
}

TOTAL_STEPS=9; CURRENT_STEP=0

# step() writes the step header used by qmanager_update to track progress —
# the exact "=== Step N/M: <label> ===" format is the tail-target pattern.
step() {
    CURRENT_STEP=$(( CURRENT_STEP + 1 ))
    local label="$1"
    _log_raw "=== Step ${CURRENT_STEP}/${TOTAL_STEPS}: ${label} ==="
    printf "\n  ${DIM}[Step %d/%d]${NC}\n" "$CURRENT_STEP" "$TOTAL_STEPS"
    printf "  ${BLUE}${BOLD}${ICO_STEP}${NC}${BOLD} %s${NC}\n" "$label"
}

count_files() { find "$1" -type f 2>/dev/null | wc -l | tr -d ' '; }

# --- Atomic File Install Helpers ---------------------------------------------

# install_file <src> <dst> <mode>
# Copies src to dst atomically (temp + mv). Strips CRLF for non-ELF files.
install_file() {
    local src="$1" dst="$2" mode="$3"
    local tmp="${dst}.qm_install.$$"

    cp "$src" "$tmp" || return 1

    if ! head -c 4 "$tmp" 2>/dev/null | grep -q $'\x7fELF'; then
        tr -d '\r' < "$tmp" > "${tmp}.cr" && mv "${tmp}.cr" "$tmp"
    fi

    chmod "$mode" "$tmp" || { rm -f "$tmp"; return 1; }
    mv "$tmp" "$dst" || { rm -f "$tmp"; return 1; }
    return 0
}

# install_dir_flat <src> <dst> <mode>
# Installs all regular files from a flat source dir. Dies on any failure.
install_dir_flat() {
    local src="$1" dst="$2" mode="$3"
    local count=0
    for f in "$src"/*; do
        [ -f "$f" ] || continue
        install_file "$f" "$dst/$(basename "$f")" "$mode" \
            || die "Failed to install $(basename "$f") from $src"
        count=$(( count + 1 ))
    done
    printf '%d' "$count"
}

# install_tree <src> <dst>
# Recursively copies src tree to dst (wiping dst first), then sets permissions.
install_tree() {
    local src="$1" dst="$2"
    rm -rf "$dst"
    mkdir -p "$dst"
    cp -r "$src"/. "$dst/"
    # Strip CRLF first — the .cr-rewrite + mv pattern below replaces files
    # with new ones whose mode comes from umask (typically 644). Apply final
    # modes AFTER stripping so the executable bit can't be silently wiped.
    find "$dst" -type f -not -name "*.sh" | while IFS= read -r f; do
        if ! head -c 4 "$f" 2>/dev/null | grep -q $'\x7fELF'; then
            tr -d '\r' < "$f" > "${f}.cr" && mv "${f}.cr" "$f" 2>/dev/null || true
        fi
    done
    find "$dst" -name "*.sh" | while IFS= read -r f; do
        tr -d '\r' < "$f" > "${f}.cr" && mv "${f}.cr" "$f" 2>/dev/null || true
    done
    # Final mode pass — must be last to survive the CRLF rewrites above.
    find "$dst" -name "*.sh" -exec chmod 755 {} \;
    find "$dst" -not -name "*.sh" -type f -exec chmod 644 {} \;
}

# --- Two-phase Version Write -------------------------------------------------

mark_version_pending() {
    # SECURITY: pin the mode, don't just ensure existence. This is the FIRST
    # thing that creates $CONF_DIR, and a bare `mkdir -p` honours the ambient
    # umask and is a silent no-op on an already-existing directory — which is
    # how 0777 reached fielded devices and then survived every OTA. `install -d`
    # re-applies the mode on EVERY run, so one OTA self-heals a drifted device.
    # Owner is deliberately NOT set here: www-data is created later, in
    # install_dependencies(). install_backend() pins owner+mode together once
    # the user exists. See the SECURITY note there for why the mode matters.
    install -d -m 0755 "$CONF_DIR"
    printf '%s\n' "$VERSION" > "$VERSION_PENDING"
    _log_raw "Version $VERSION marked as pending"
}

finalize_version() {
    if [ -f "$VERSION_PENDING" ]; then
        mv "$VERSION_PENDING" "$CONF_DIR/VERSION"
        _log_raw "Version $VERSION finalized"
    fi
}

# --- Download Helper ---------------------------------------------------------
#
# curl/wget auto-detection — mirrors scripts/usr/lib/qmanager/downloader.sh.
# Inlined because the installer runs before that library is on disk. curl is
# preferred; wget is a first-class fallback so curl need not be force-installed.

_DL_TOOL=""

dl_resolve() {
    if [ -z "$_DL_TOOL" ]; then
        if command -v curl >/dev/null 2>&1; then
            _DL_TOOL="curl"
        elif command -v wget >/dev/null 2>&1; then
            _DL_TOOL="wget"
        else
            _DL_TOOL="none"
        fi
    fi
    [ "$_DL_TOOL" != "none" ]
}

# dl_get <url> <dest> [max_time_secs] — download url to dest; dest is removed
# on failure so a partial file or an HTTP error page is never left behind as
# a "success". The optional 3rd arg bounds the transfer (curl --max-time /
# wget -T) for callers where a hung connection must not stall indefinitely;
# omitted, curl keeps its prior unbounded behavior and wget keeps its 60s
# default, so existing 2-arg call sites are unaffected.
dl_get() {
    local url="$1" dest="$2" max_time="${3:-}" rc
    dl_resolve || return 1
    case "$_DL_TOOL" in
        curl)
            if [ -n "$max_time" ]; then
                curl -fsSL --max-time "$max_time" -o "$dest" "$url"
            else
                curl -fsSL -o "$dest" "$url"
            fi
            ;;
        wget) wget -q -T "${max_time:-60}" -O "$dest" "$url" ;;
    esac
    rc=$?
    [ "$rc" -ne 0 ] && rm -f "$dest"
    return "$rc"
}

# --- Pre-flight Checks -------------------------------------------------------

preflight() {
    step "Running pre-flight checks"

    if [ "$(id -u)" -ne 0 ]; then
        die "This script must be run as root"
    fi

    # A downloader is required for fetching Entware, GitHub releases, etc.
    # curl is preferred; wget is accepted as a first-class fallback so curl no
    # longer has to be force-installed. The downloads themselves are the real
    # TLS test — here we only confirm a tool exists and warn (never abort) if
    # HTTPS looks unreachable with the selected tool.
    if ! dl_resolve; then
        die "No downloader found. Install 'curl' or 'wget' and re-run."
    fi
    info "Using '$_DL_TOOL' to download files"
    if [ "$_DL_TOOL" = "wget" ]; then
        if ! wget -q -T 8 -O /dev/null https://api.github.com/ 2>/dev/null; then
            warn "Could not confirm HTTPS works with wget — if downloads fail,"
            warn "your wget may lack TLS support; install curl or a TLS-capable wget."
        fi
    fi

    if [ "$DO_FORCE" = "1" ]; then
        warn "--force: skipping modem firmware detection"
    else
        if [ -f /etc/quectel-project-version ]; then
            local ver project_name
            ver=$(cat /etc/quectel-project-version 2>/dev/null)
            project_name=$(grep -m1 "^Project Name:" /etc/quectel-project-version 2>/dev/null \
                | sed 's/^Project Name:[[:space:]]*//' | tr -d '[:space:]')

            case "$project_name" in
                RM551E*)
                    die "Incompatible device: $project_name detected. Use the QManager RM551E installer."
                    ;;
                RM520N*)
                    info "Detected: RM520N-GL ($ver)"
                    ;;
                RG501Q*)
                    # Community tier — see qm_hw_tier() in hw_profile.sh. Info
                    # only, deliberately no prompt: this arm exists so the
                    # RG501Q stops falling through to the `*` arm's
                    # "unrecognized device / proceed anyway?" question.
                    info "Detected: RG501Q-EU ($ver)"
                    ;;
                "")
                    warn "Cannot parse device model from firmware version — proceeding anyway"
                    ;;
                *)
                    warn "Unrecognized device: $project_name"
                    printf "\n"
                    printf "%s\n" "$ver" | sed 's/^/    /'
                    printf "\n  This installer targets RM520N-GL devices. Your device may not be compatible.\n"
                    printf "  Do you want to proceed anyway? [y/N] "

                    # Prefer /dev/tty so the prompt still works when stdin is
                    # piped (curl|bash, adb shell without -t, etc.). Use a
                    # redirect probe (not [ -r ]) — /dev/tty always has read
                    # permissions but returns ENXIO on open when there is no
                    # controlling terminal (systemd service, OTA worker, etc.).
                    local answer=""
                    if { true </dev/tty; } 2>/dev/null; then
                        read -r answer </dev/tty || answer=""
                    elif [ -t 0 ]; then
                        read -r answer || answer=""
                    fi
                    # No terminal available (OTA update, curl|bash, headless ADB):
                    # auto-proceed with a warning rather than aborting. The old
                    # qmanager_update worker (pre-v0.1.8) does not pass --force, so
                    # dying here silently breaks OTA upgrades on variant devices.
                    if [ -z "$answer" ]; then
                        printf "\n"
                        warn "No terminal available — proceeding non-interactively. Use --force to suppress this check."
                        answer="y"
                    fi
                    case "$answer" in
                        [Yy]|[Yy][Ee][Ss]) info "Proceeding on user request" ;;
                        *) die "Installation aborted by user" ;;
                    esac
                    ;;
            esac
        else
            warn "Cannot detect firmware version (/etc/quectel-project-version not found) — proceeding anyway"
        fi
    fi

    # Remount root filesystem read-write if needed
    if ! touch /usr/.qm_rw_test 2>/dev/null; then
        mount -o remount,rw / 2>/dev/null || die "Could not remount / read-write"
    fi
    rm -f /usr/.qm_rw_test

    # Check source directories exist
    if [ "$DO_FRONTEND" = "1" ] && [ ! -d "$SRC_FRONTEND" ]; then
        die "Frontend source not found at $SRC_FRONTEND"
    fi
    if [ "$DO_BACKEND" = "1" ] && [ ! -d "$SRC_SCRIPTS" ]; then
        die "Backend scripts not found at $SRC_SCRIPTS"
    fi

    mark_version_pending

    # Write the advisory hardware profile. The PLACEMENT here is load-bearing on
    # three counts, and two of them fail silently if it moves:
    #
    #  1. AFTER mark_version_pending(), which is the first thing that creates
    #     $CONF_DIR (`install -d -m 0755`, :249). qm_hw_write_profile()
    #     deliberately refuses to create its own parent, so anywhere earlier it
    #     returns 1 and writes nothing on every device where QManager was never
    #     installed — that is, every fresh install. A device that already has
    #     /etc/qmanager would show nothing wrong, which is exactly how such a
    #     bug ships.
    #  2. OUTSIDE the `--force` gate that closes above. Every OTA upgrade passes
    #     --force, so anything placed inside that block never runs on upgrade.
    #  3. AFTER the RM551E die and the remount die, so the installer never
    #     leaves config behind on a device it explicitly refused.
    #
    # Sourced from the STAGING tree, never the absolute /usr/lib/qmanager path:
    # at preflight time the installed copy is the PREVIOUS version's library (on
    # an OTA) or absent entirely (fresh install). install_backend() does not
    # glob-install that directory until much later.
    #
    # CRLF: this is the installer's first `.` of a staging-tree file ahead of any
    # line-ending normalization — every other source in this file reads the
    # already-installed, already-stripped copy. Safety rests entirely on
    # .gitattributes' `scripts/**/*.sh text eol=lf`.
    #
    # Both the source AND the call are guarded, because this file runs under
    # `set -e` (:42) and preflight is called bare from main(): --frontend-only
    # sets DO_BACKEND=0 and so never asserts $SRC_SCRIPTS exists, and
    # qm_hw_write_profile returns 1 legitimately. The profile is advisory —
    # failing to write one must never abort an install.
    local hw_lib="$SRC_SCRIPTS/usr/lib/qmanager/hw_profile.sh"
    if [ -f "$hw_lib" ] && . "$hw_lib" && command -v qm_hw_write_profile >/dev/null 2>&1; then
        if qm_hw_write_profile "$CONF_DIR/platform.json"; then
            info "Hardware profile written: $CONF_DIR/platform.json"
        else
            warn "Could not write hardware profile — continuing (it is advisory)"
        fi
    else
        warn "Hardware profile library unavailable — skipping (it is advisory)"
    fi

    info "Pre-flight checks passed"
}

# --- Remove Conflicts --------------------------------------------------------

# Removes packages that must not coexist with QManager (e.g. socat-at-bridge
# which holds /dev/smd11 open, blocking atcli_smd11).
# Runs even with --skip-packages so conflicts are cleared on every update.
remove_conflicts() {
    # Skip silently if Entware isn't available yet (fresh install, pre-bootstrap)
    if [ ! -x "$OPKG" ]; then
        _log_raw "remove_conflicts: opkg not available — skipping (pre-Entware)"
        return 0
    fi

    for pkg in $CONFLICT_PACKAGES; do
        if "$OPKG" list-installed 2>/dev/null | grep -q "^${pkg} "; then
            info "Removing conflicting package: $pkg"
            if "$OPKG" remove "$pkg" >/dev/null 2>&1; then
                info "Removed $pkg"
            elif "$OPKG" remove --force-removal-of-dependent-packages "$pkg" >/dev/null 2>&1; then
                info "Removed $pkg (force-deps)"
            elif "$OPKG" remove --force-depends "$pkg" >/dev/null 2>&1; then
                info "Removed $pkg (force-depends)"
            else
                die "Cannot remove conflicting package '$pkg' — please remove it manually and re-run"
            fi
        fi
    done
}

# --- Neutralize Entware lighttpd ---------------------------------------------

# Disables Entware's S80lighttpd init script so it can never win the boot-time
# race for port 80 against QManager's own lighttpd.service. rc.unslung starts
# S80lighttpd via `pidof lighttpd` — a process-NAME check, not a port check —
# so on some boots Entware's instance binds port 80 first, in an empty docroot
# with no TLS, before QManager's unit gets there. Confirmed live on an
# RG501Q-EU: identical on-disk config won on one boot by 1.18s and lost
# outright on an earlier boot the same day. rc.unslung selects scripts with
# `find /opt/etc/init.d/ -perm '-u+x' -name 'S*'` — no allowlist, no
# .disabled convention — so clearing the executable bit is a valid, sufficient
# disable.
#
# Must never die() or return non-zero: failure here only degrades to today's
# pre-existing intermittent behavior, it must not abort an install. Must be
# idempotent — safe on every install and every OTA, including when the file
# is already non-executable or absent.
neutralize_entware_lighttpd() {
    local _s80="/opt/etc/init.d/S80lighttpd"

    if [ ! -f "$_s80" ]; then
        return 0
    fi

    if [ ! -x "$_s80" ]; then
        info "Entware S80lighttpd already disabled"
        return 0
    fi

    # `a-x`, not a bare `-x`: with no "who" prefix, POSIX chmod acts as if `a`
    # were given BUT skips bits set in the umask. This whole fix depends on
    # clearing the one bit rc.unslung tests (`find -perm '-u+x'`), so a masked
    # u+x would leave S80lighttpd armed while we log success — the exact silent
    # no-op F8 exists to eliminate. Spelling out `a` makes umask irrelevant.
    if chmod a-x "$_s80" 2>/dev/null; then
        info "Disabled Entware S80lighttpd (QManager's lighttpd.service owns ports 80/443)"
    else
        warn "Could not disable $_s80 — the Entware lighttpd may take port 80 on some boots"
    fi

    return 0
}

# --- Harden Entware bootstrap unit modes -------------------------------------

# The three Entware bootstrap units written by `cat > ... << EOF` heredocs in
# install_dependencies() are created with mode 0666 & ~umask. The install
# shell's umask is 0000 on both measured devices, so all three land
# world-writable (0666, measured on RM520N-GL and RG501Q-EU).
# /lib/systemd/system itself is 0755, so the exposure is bounded to exactly
# these three files — but each is a unit systemd executes as root at boot, and
# the installer remounts / rw and never restores ro, so the file mode is the
# only barrier left. Any local user could append an ExecStart and own the
# device on the next reboot.
#
# Numeric 0644, not `go-w`: a numeric mode is idempotent regardless of whatever
# mode the file already carries, and is immune to the umask-sensitivity that
# bites symbolic modes with no "who" prefix.
#
# Runs unconditionally from main() — the same precedent as
# neutralize_entware_lighttpd — so it reaches already-installed devices over
# OTA (qmanager_update calls this installer with --skip-packages, which skips
# install_dependencies where the heredocs live), not just fresh installs.
# Must never die() or return non-zero: a failed chmod leaves today's behavior.
harden_entware_unit_modes() {
    local _unit

    for _unit in /lib/systemd/system/opt.mount \
                 /lib/systemd/system/start-opt-mount.service \
                 /lib/systemd/system/rc.unslung.service; do
        [ -f "$_unit" ] || continue
        chmod 0644 "$_unit" 2>/dev/null \
            || warn "Could not chmod 0644 $_unit — it may remain world-writable"
    done

    # / is UBIFS and the installer leaves it mounted rw; flush the metadata the
    # same way every other rootfs write in this installer does. No
    # daemon-reload is needed — changing a file's mode does not make systemd
    # re-parse the unit, and the chmod is safe on an already-loaded active one.
    sync 2>/dev/null || true

    return 0
}

# --- Ensure Zoneinfo Packages -------------------------------------------------

# Installs the zoneinfo-all Entware package (full IANA tzdata) into
# /opt/share/zoneinfo — RM520N-GL's vendor /usr/share/zoneinfo ships empty, so
# qmanager_timezone_apply has nothing to copy from without this.
#
# Runs UNCONDITIONALLY, even with --skip-packages (mirrors remove_conflicts()
# just above in main()): OTA upgrades invoke this installer with
# --skip-packages, which gates install_dependencies(). Gating this install
# behind that flag would mean the majority upgrade path (in-app "Software
# Update") never fetches zoneinfo, and the timezone-apply fix stays silently
# broken forever for every existing user. Warn-only on failure — a device
# offline during an update should still complete the upgrade, not brick it.
ensure_zoneinfo_packages() {
    # Skip silently if Entware isn't available yet (fresh install, pre-bootstrap —
    # install_dependencies() bootstraps Entware and this will catch up on next run)
    if [ ! -x "$OPKG" ]; then
        _log_raw "ensure_zoneinfo_packages: opkg not available — skipping (pre-Entware)"
        return 0
    fi

    if "$OPKG" list-installed 2>/dev/null | grep -q "^${ZONEINFO_PACKAGE} "; then
        info "$ZONEINFO_PACKAGE already installed"
        return 0
    fi

    info "Installing timezone data ($ZONEINFO_PACKAGE)..."
    if "$OPKG" update >/dev/null 2>&1 && "$OPKG" install "$ZONEINFO_PACKAGE" >/dev/null 2>&1; then
        info "$ZONEINFO_PACKAGE installed"
    else
        warn "Failed to install $ZONEINFO_PACKAGE (offline?) — timezone apply will fail until this succeeds"
        warn "  Retry manually: $OPKG update && $OPKG install $ZONEINFO_PACKAGE"
    fi
}

# --- Install Bundled Binaries -------------------------------------------------

# Copies the first-party binaries bundled in dependencies/ (atcli_smd11,
# sms_tool, qmanager_discord) into $BIN_DIR.
#
# Runs UNCONDITIONALLY, even with --skip-packages (mirrors remove_conflicts()
# and ensure_zoneinfo_packages() above in main()): OTA upgrades invoke this
# installer with --skip-packages, which gates install_dependencies(). These
# binaries are app payload, not Entware opkg packages — unlike the one-time
# package installs that legitimately stay skippable, they ship a new revision
# with every QManager release and MUST be refreshed on every upgrade. This was
# the root cause of the SMS OTA-upgrade bug: devices that OTA'd to v0.1.13 kept
# the OLD unpatched sms_tool (compiled default /dev/ttyUSB0) because the copy
# was gated behind install_dependencies(), while v0.1.13's CGI calls sms_tool
# without -d /dev/smd11, relying on the new patched binary's smd11 default.
#
# Each binary is skipped via `cmp -s` if the bundled copy is byte-identical to
# what's already installed, avoiding a needless UBIFS rewrite on every OTA.
install_bundled_binaries() {
    step "Installing bundled binaries"

    # --- atcli_smd11 (AT command transport — direct /dev/smd11 access) --------
    if [ -f "$SRC_DEPS/atcli_smd11" ]; then
        if [ -x "$BIN_DIR/atcli_smd11" ] && cmp -s "$SRC_DEPS/atcli_smd11" "$BIN_DIR/atcli_smd11"; then
            info "atcli_smd11 already current"
        else
            install_file "$SRC_DEPS/atcli_smd11" "$BIN_DIR/atcli_smd11" 755 \
                || die "Failed to install atcli_smd11"
            info "atcli_smd11 installed to $BIN_DIR/atcli_smd11"
        fi
    elif [ -x "$BIN_DIR/atcli_smd11" ]; then
        info "atcli_smd11 already installed"
    else
        die "atcli_smd11 not found in $SRC_DEPS and not installed on device"
    fi

    # --- sms_tool (SMS send/recv/delete — handles multi-part reassembly) ------
    if [ -f "$SRC_DEPS/sms_tool" ]; then
        if [ -x "$BIN_DIR/sms_tool" ] && cmp -s "$SRC_DEPS/sms_tool" "$BIN_DIR/sms_tool"; then
            info "sms_tool already current"
        else
            install_file "$SRC_DEPS/sms_tool" "$BIN_DIR/sms_tool" 755 \
                || die "Failed to install sms_tool"
            info "sms_tool installed to $BIN_DIR/sms_tool"
        fi
    elif [ -x "$BIN_DIR/sms_tool" ]; then
        info "sms_tool already installed"
    else
        warn "sms_tool not found — SMS features will not work"
    fi

    # --- qmanager_discord (optional Discord bot binary) -----------------------
    if [ -f "$SRC_DEPS/qmanager_discord" ]; then
        if [ -x "$BIN_DIR/qmanager_discord" ] && cmp -s "$SRC_DEPS/qmanager_discord" "$BIN_DIR/qmanager_discord"; then
            info "qmanager_discord already current"
        else
            install_file "$SRC_DEPS/qmanager_discord" "$BIN_DIR/qmanager_discord" 755 \
                || warn "Failed to install qmanager_discord"
            info "qmanager_discord installed to $BIN_DIR/qmanager_discord"
        fi
    elif [ -x "$BIN_DIR/qmanager_discord" ]; then
        info "qmanager_discord already installed"
    else
        info "qmanager_discord not bundled — Discord bot feature disabled"
    fi
}

# --- Install Speedtest CLI ----------------------------------------------------

# Downloads the Ookla Speedtest CLI (not bundled — proprietary, not
# redistributable) into /usrdata/root/bin so the web UI's speed test feature
# has a binary to exec.
#
# Runs UNCONDITIONALLY, even with --skip-packages (mirrors remove_conflicts(),
# ensure_zoneinfo_packages(), and install_bundled_binaries() above in main()):
# OTA upgrades invoke this installer with --skip-packages, which gates
# install_dependencies(). This download used to live inside that gated
# function — a device whose install-time download failed (offline, flaky
# cellular) would warn and continue, then NEVER get a retry on any future OTA,
# leaving Speedtest permanently dead with no recovery path. Warn-only on any
# failure here too — optional, must never abort an install or upgrade.
#
# Depends on preflight() having already remounted / read-write earlier in
# main() — if this is ever called from outside main(), it needs its own
# remount guard.
install_speedtest_cli() {
    local speedtest_dir="/usrdata/root/bin"
    local speedtest_url="https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-armhf.tgz"

    # /usrdata must already be its own mount before we create anything under
    # it, or the dir (and binary) land on whatever filesystem backs the path
    # and silently vanish on next boot. Device-number comparison rather than
    # the BusyBox applet that tests this on most systems: the RG501Q ships
    # no such applet at all, and a command-not-found (exit 127) read through
    # `!` reads as "not mounted", which silently skips this function's
    # install -d remediation below on every RG501Q. stat -c %d is verified
    # working on both devices.
    if [ "$(stat -c %d /usrdata 2>/dev/null)" = "$(stat -c %d / 2>/dev/null)" ]; then
        warn "/usrdata is not a mounted filesystem — skipping speedtest CLI install"
        return 0
    fi

    # install -d (not mkdir -p): mkdir -p no-ops on an already-existing dir
    # and would preserve a bad mode across every future OTA.
    #
    # ORDER IS LOAD-BEARING: this runs BEFORE the idempotence guard below, so
    # the directory mode is re-asserted on every install and every OTA even
    # when the binary is already present. Putting it after the guard looks
    # tidier and silently defeats the whole point — a device that installed
    # the CLI under the old `mkdir -p` code satisfies both halves of that
    # guard while sitting on a world-writable 0777 directory, so it would
    # return early and never be remediated. Devices already in the bad state
    # are exactly the ones this line exists for. Only the network download
    # below is worth skipping; this is free.
    install -d -o root -g root -m 0755 "$speedtest_dir"

    # Primary idempotence guard: command -v costs zero network calls on a
    # device that already has it — this is what keeps a normal OTA free of
    # any speedtest network traffic. The -x check on our own install path is
    # belt-and-braces against some other same-named binary earlier on PATH
    # shadowing a missing/broken install here.
    if command -v speedtest >/dev/null 2>&1 && [ -x "$speedtest_dir/speedtest" ]; then
        info "speedtest CLI is already installed"
        return 0
    fi

    # 120s bound: a hung TCP connection on a marginal cellular link must not
    # stall an OTA indefinitely now that this runs on every upgrade.
    if ! dl_get "$speedtest_url" /tmp/speedtest.tgz 120 2>/dev/null; then
        warn "speedtest CLI download failed (optional — requires internet)"
        return 0
    fi

    tar -xzf /tmp/speedtest.tgz -C "$speedtest_dir" speedtest 2>/dev/null
    rm -f /tmp/speedtest.tgz "$speedtest_dir/speedtest.md"

    # Verify extraction actually produced the binary before touching
    # ownership/mode or linking — a truncated archive (disk full, dropped
    # cellular link) must never leave a symlink to a missing/partial target.
    if [ ! -f "$speedtest_dir/speedtest" ]; then
        warn "speedtest CLI extraction failed (partial download?) — skipping"
        return 0
    fi

    # tar inherits owner metadata from the archive (observed shipping as
    # uid/gid 10000:10000, an account with no /etc/passwd entry) — assert
    # root:root explicitly rather than trusting the tarball's own attrs.
    chown root:root "$speedtest_dir/speedtest" 2>/dev/null
    chmod 0755 "$speedtest_dir/speedtest"

    if [ ! -x "$speedtest_dir/speedtest" ]; then
        warn "speedtest CLI binary is not executable after extraction — skipping"
        return 0
    fi

    ln -sf "$speedtest_dir/speedtest" /bin/speedtest
    info "speedtest CLI installed to $speedtest_dir/speedtest"
}

# --- Install Dependencies ----------------------------------------------------

# qm_entware_complete — replaces a bare "-x $OPKG" check as the bootstrap
# guard. A binary at $OPKG is not proof the bootstrap finished: it is written
# partway through, and either of the two `opkg` calls right after it can
# still fail and `die`. Without this, a device that died there is a poison
# pill forever — every future run sees the leftover binary, prints "already
# installed", and skips ~120 lines of setup that never actually completed.
#   - rc.unslung is written strictly AFTER entware-opt installs successfully,
#     so its presence proves the run crossed the point that currently kills
#     it (see the bootstrap block below).
#   - an empty `opkg list-installed` is the exact signature measured on a
#     poisoned RG501Q-EU: the binary exists, but no base package landed.
qm_entware_complete() {
    [ -x "$OPKG" ] || return 1
    [ -f /opt/etc/init.d/rc.unslung ] || return 1
    "$OPKG" list-installed 2>/dev/null | head -n 1 | grep -q . || return 1
    return 0
}

install_dependencies() {
    step "Installing dependencies"

    # --- System users & groups ------------------------------------------------
    # Create www-data user/group if missing (lighttpd runs as www-data:dialout)
    if ! getent group dialout >/dev/null 2>&1; then
        addgroup dialout 2>/dev/null || groupadd dialout 2>/dev/null || true
        info "Created group: dialout"
    fi
    if ! getent group www-data >/dev/null 2>&1; then
        addgroup www-data 2>/dev/null || groupadd www-data 2>/dev/null || true
        info "Created group: www-data"
    fi
    if ! id www-data >/dev/null 2>&1; then
        adduser -S -H -D -G www-data www-data 2>/dev/null || \
        useradd -r -M -s /sbin/nologin -g www-data www-data 2>/dev/null || true
        info "Created user: www-data"
    fi
    # Add www-data to dialout (needed to access /dev/smd11 with mode 660 root:dialout).
    # Try every known helper, then VERIFY — silent failure here was the root cause of
    # the x5* (PRAIRE/sdxprairie) compatibility regression where /dev/smd11 ended up
    # unreachable through the dialout group on platforms whose addgroup/usermod
    # variants don't accept the "add user to group" syntax.
    addgroup www-data dialout 2>/dev/null || \
    usermod -aG dialout www-data 2>/dev/null || \
    gpasswd -a www-data dialout 2>/dev/null || true

    # Membership check: `id -Gn` prints group NAMES space-separated (e.g. "www-data dialout").
    # `id www-data` alone prints `groups=33(www-data),20(dialout)` — splitting that on commas
    # gives tokens like "20(dialout)" not "dialout", which is why a naive grep -qx fails
    # (verified live on RM520N-GL BusyBox v1.31.1).
    if ! id -Gn www-data 2>/dev/null | tr ' ' '\n' | grep -qx 'dialout'; then
        warn "addgroup/usermod/gpasswd did not add www-data to dialout — falling back to direct /etc/group edit"
        if grep -q '^dialout:' /etc/group 2>/dev/null; then
            # Group exists — append www-data to its member list. Safe to run only
            # because the surrounding `id -Gn ... | grep -qx` already proved
            # www-data is NOT yet a member; otherwise this would duplicate.
            # Two-step sed handles the empty-member-list case (trailing colon):
            #   "dialout:x:20:"            → ",www-data" appended → ":,"  → ":"
            #   "dialout:x:20:user1"       → ",www-data" appended (no :, to clean)
            sed -i \
                -e '/^dialout:/s/$/,www-data/' \
                -e '/^dialout:/s/:,/:/' \
                /etc/group
        else
            # Group missing entirely. GID 20 is the canonical Debian dialout GID
            # and matches every Quectel image we have evidence for.
            echo 'dialout:x:20:www-data' >> /etc/group
        fi
        sync
        if ! id -Gn www-data 2>/dev/null | tr ' ' '\n' | grep -qx 'dialout'; then
            die "Could not add www-data to dialout group — manual /etc/group fix required"
        fi
        info "www-data added to dialout via /etc/group fallback"
    fi

    # Bundled first-party binaries (atcli_smd11, sms_tool, qmanager_discord) are
    # installed unconditionally by install_bundled_binaries(), called earlier in
    # main() — NOT here — so they refresh on OTA even with --skip-packages.

    # --- Temporary wget shim for opkg -------------------------------------------
    # Entware's opkg binary shells out to wget to download packages, hardcoded
    # at build time — there is no "option downloader" in opkg.conf to point it
    # at curl instead. That's fine on the RM520N-GL (BusyBox v1.31.1 ships
    # wget), but the RG501Q-EU's BusyBox (v1.29.3) was built without the wget
    # applet at all — only /usr/bin/curl exists — so every opkg fetch fails,
    # every Entware package (lighttpd, sudo, jq, dropbear) gets skipped, and
    # the install never finalizes.
    #
    # The fix is a curl-backed wget shim, but it must be gone by the time this
    # function returns rather than living in /opt/bin: on the RM520N-GL,
    # /opt/bin precedes /usr/bin in the vendor default PATH, so a persistent
    # /opt/bin/wget would shadow the real system wget for the CGI backend,
    # the poller's downloader, and every root helper. It also can't rely on
    # the uninstaller to clean it up — uninstall_rm520n.sh deliberately never
    # touches anything under /opt. So it lives under /tmp instead, is put
    # first on PATH only for the remainder of this function, and is deleted
    # unconditionally before returning (see the bottom of this function). It
    # is a stepping stone: step 2 below installs the real wget-ssl package
    # from Entware once opkg is up, and that becomes the permanent handoff.
    _QM_NEED_WGET_SHIM=0
    if ! command -v wget >/dev/null 2>&1; then
        _QM_NEED_WGET_SHIM=1
        install -d -m 0755 /tmp/qm_wget_shim
        cat > /tmp/qm_wget_shim/wget << 'SHIMEOF'
#!/bin/sh
# Minimal curl-backed stand-in for wget, used only while bootstrapping
# Entware's opkg on a device with no wget applet (see install_rm520n.sh).
# Translates the flags opkg actually passes (confirmed via `strings` on the
# opkg binary): -O <file>/-O<file>, --no-check-certificate, --timeout[=]N.
# Anything else starting with '-' is silently dropped; the last non-flag
# argument is treated as the URL.
_out=""
_url=""
_curl_args=""
while [ $# -gt 0 ]; do
    case "$1" in
        -O)
            shift
            _out="$1"
            ;;
        -O*)
            _out="${1#-O}"
            ;;
        --no-check-certificate)
            _curl_args="$_curl_args -k"
            ;;
        --timeout=*)
            _curl_args="$_curl_args --max-time ${1#--timeout=}"
            ;;
        --timeout)
            shift
            _curl_args="$_curl_args --max-time $1"
            ;;
        --version)
            # Must NOT contain the string "GNU Wget" in any form —
            # downloader.sh does `wget --version | grep -qi 'GNU Wget'` to
            # pick a header-dump strategy, and a substring match doesn't
            # care that a disclaimer was meant. Say nothing about GNU.
            echo "qm-wget-shim 1 (curl-backed, temporary)"
            exit 0
            ;;
        -*)
            # unrecognized flag — ignore
            ;;
        *)
            _url="$1"
            ;;
    esac
    shift
done
if [ -z "$_url" ]; then
    echo "qm-wget-shim: no URL given" >&2
    exit 1
fi
if [ -n "$_out" ]; then
    exec curl -fsSL $_curl_args -o "$_out" "$_url"
else
    exec curl -fsSL $_curl_args "$_url"
fi
SHIMEOF
        chmod 755 /tmp/qm_wget_shim/wget
        PATH="/tmp/qm_wget_shim:/opt/bin:/opt/sbin:$PATH"
        export PATH
        info "No wget on this device — using a temporary curl-backed shim for opkg"
    fi

    # --- Entware bootstrap -------------------------------------------------------
    # If opkg is not installed, bootstrap Entware from scratch.
    # This replicates the RGMII toolkit's Entware installation process.
    if ! qm_entware_complete; then
        info "Entware not found — bootstrapping from bin.entware.net"

        # Prevent library conflicts during bootstrap
        unset LD_LIBRARY_PATH
        unset LD_PRELOAD

        ENTWARE_ARCH="armv7sf-k3.2"
        ENTWARE_URL="http://bin.entware.net/${ENTWARE_ARCH}/installer"

        # Rename factory opkg if present (conflicts with Entware opkg)
        if command -v opkg >/dev/null 2>&1; then
            _old_opkg=$(command -v opkg)
            mv "$_old_opkg" "${_old_opkg}_old" 2>/dev/null || true
            info "Renamed factory opkg to opkg_old"
        fi

        # Create /usrdata/opt and bind-mount to /opt via systemd.
        # install -d, not mkdir -p: mkdir -p no-ops on an existing directory,
        # so a bad mode from a prior run would silently persist across OTA.
        install -d -m 0755 /usrdata/opt

        if [ ! -f /lib/systemd/system/opt.mount ]; then
            cat > /lib/systemd/system/opt.mount << 'MOUNTEOF'
[Unit]
Description=Bind /usrdata/opt to /opt

[Mount]
What=/usrdata/opt
Where=/opt
Type=none
Options=bind

[Install]
WantedBy=multi-user.target
MOUNTEOF
            info "Created opt.mount systemd unit"
        fi

        # Bootstrap service ensures opt.mount starts at boot
        if [ ! -f /lib/systemd/system/start-opt-mount.service ]; then
            cat > /lib/systemd/system/start-opt-mount.service << 'SVCEOF'
[Unit]
Description=Ensure opt.mount is started at boot
After=network.target

[Service]
Type=oneshot
ExecStart=/bin/systemctl start opt.mount

[Install]
WantedBy=multi-user.target
SVCEOF
            ln -sf /lib/systemd/system/start-opt-mount.service \
                /lib/systemd/system/multi-user.target.wants/start-opt-mount.service
            info "Created start-opt-mount.service"
        fi

        systemctl daemon-reload 2>/dev/null || warn "daemon-reload failed (transient?) — continuing"
        systemctl start opt.mount 2>/dev/null || true
        info "Mounted /usrdata/opt → /opt"

        # Create directory structure. sbin is normally created by the
        # entware-opt package itself, but dropbear.service hardcodes
        # ExecStart=/opt/sbin/dropbear and /opt/sbin was measured absent on
        # the RG501Q-EU, so create it up front rather than trust the package.
        for folder in bin sbin etc lib/opkg tmp var/lock; do
            mkdir -p "/opt/$folder"
        done
        chmod 777 /opt/tmp

        # Download opkg binary and config. ENTWARE_URL is plain HTTP, so any
        # downloader works here — including a TLS-less BusyBox wget.
        dl_get "$ENTWARE_URL/opkg" /opt/bin/opkg \
            || die "Failed to download opkg from $ENTWARE_URL"
        # wget (unlike curl -f) writes HTTP error pages to the output file on a
        # 4xx/5xx. Verify the download is a real ELF binary before trusting it:
        # the first 4 bytes of every ELF file are 0x7F 'E' 'L' 'F', so the
        # literal "ELF" appears in the first 4 bytes (an HTML/JSON error page
        # never does). head + grep only — no od dependency.
        if ! head -c4 /opt/bin/opkg 2>/dev/null | grep -q 'ELF'; then
            rm -f /opt/bin/opkg
            die "Downloaded opkg is not a valid binary (server error or bad mirror?)"
        fi
        chmod 755 /opt/bin/opkg
        dl_get "$ENTWARE_URL/opkg.conf" /opt/etc/opkg.conf \
            || die "Failed to download opkg.conf from $ENTWARE_URL"
        info "Downloaded opkg package manager"

        # Install base Entware. Both failure paths remove the just-downloaded
        # opkg binary before dying — same precedent as the ELF sanity check
        # above — so a failed bootstrap doesn't leave a poison-pill binary
        # behind for qm_entware_complete() to have to detect. This cleanup is
        # only safe here because it runs after the opt.mount start above,
        # where /opt is guaranteed to be the bind-mounted /usrdata/opt and
        # never the rootfs.
        /opt/bin/opkg update >/dev/null 2>&1 \
            || { rm -f /opt/bin/opkg; die "Package list download failed — no usable wget for opkg, or check connectivity"; }
        /opt/bin/opkg install entware-opt >/dev/null 2>&1 \
            || { rm -f /opt/bin/opkg; die "Failed to install entware-opt base package"; }
        info "Entware base installed"

        # Link system user/group files
        for file in passwd group shells shadow gshadow; do
            [ -f "/etc/$file" ] && ln -sf "/etc/$file" "/opt/etc/$file"
        done
        [ -f /etc/localtime ] && ln -sf /etc/localtime /opt/etc/localtime

        # Create Entware init.d service (starts Entware services at boot)
        if [ ! -f /lib/systemd/system/rc.unslung.service ]; then
            cat > /lib/systemd/system/rc.unslung.service << 'RCEOF'
[Unit]
Description=Start Entware services

[Service]
Type=oneshot
ExecStartPre=/bin/sleep 5
ExecStart=/opt/etc/init.d/rc.unslung start
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
RCEOF
            ln -sf /lib/systemd/system/rc.unslung.service \
                /lib/systemd/system/multi-user.target.wants/rc.unslung.service
            info "Created rc.unslung.service"
        fi

        # Create global symlinks for critical Entware binaries
        ln -sf /opt/bin/opkg /bin/opkg 2>/dev/null || true
        ln -sf /opt/bin/jq /usr/bin/jq 2>/dev/null || true

        systemctl daemon-reload 2>/dev/null || warn "daemon-reload failed (transient?) — continuing"
        info "Entware bootstrap complete"
    else
        info "Entware already bootstrapped at $OPKG"
    fi

    # --- Entware packages (requires opkg to be available) ---------------------
    _opkg_ready=0
    if [ -x "$OPKG" ]; then
        if "$OPKG" update >/dev/null 2>&1; then
            _opkg_ready=1
        else
            warn "Package list download failed — no usable wget for opkg, or check connectivity"
            warn "Skipping Entware package installs (lighttpd, sudo, jq, etc.)"
            warn "Re-run the installer with internet to complete package setup"
        fi
    fi

    if [ "$_opkg_ready" = "1" ]; then
        # wget-ssl: the permanent replacement for the temporary shim above.
        # Installed first so every opkg call after this one — and anything
        # else on the device that shells out to wget — gets the real thing.
        # A failure here is not fatal: the shim already got opkg this far,
        # and it will simply be needed again on the next run.
        if [ "$_QM_NEED_WGET_SHIM" = "1" ]; then
            "$OPKG" install wget-ssl >/dev/null 2>&1 \
                && info "wget-ssl installed from Entware (replaces temporary shim)" \
                || warn "wget-ssl install failed — opkg will need the temporary shim again next run"
        fi

        # lighttpd (web server + required modules)
        if [ -x /opt/sbin/lighttpd ]; then
            info "lighttpd is already installed"
            # Upgrade lighttpd + all modules together to prevent version mismatch
            # (plugin-version must match lighttpd-version or modules fail to load)
            "$OPKG" upgrade lighttpd lighttpd-mod-cgi lighttpd-mod-openssl \
                lighttpd-mod-redirect lighttpd-mod-proxy >/dev/null 2>&1 \
                && info "lighttpd packages synced" \
                || true
        else
            "$OPKG" install lighttpd >/dev/null 2>&1 \
                && info "lighttpd installed from Entware" \
                || die "Failed to install lighttpd from Entware"
        fi
        # Install required modules (Entware packages them ALL separately)
        for mod in lighttpd-mod-cgi lighttpd-mod-openssl lighttpd-mod-redirect lighttpd-mod-proxy; do
            "$OPKG" install "$mod" >/dev/null 2>&1 \
                && info "$mod installed" \
                || warn "$mod not available"
        done

        # sudo (privilege escalation for CGI)
        if command -v sudo >/dev/null 2>&1; then
            info "sudo is already installed"
        else
            "$OPKG" install sudo >/dev/null 2>&1 \
                && info "sudo installed from Entware" \
                || warn "sudo not available — CGI privilege escalation will not work"
        fi

        # jq
        if command -v jq >/dev/null 2>&1; then
            info "jq is already installed"
        elif ls "$SRC_DEPS"/jq*.ipk >/dev/null 2>&1; then
            "$OPKG" install "$SRC_DEPS"/jq*.ipk >/dev/null 2>&1 \
                && info "jq installed from bundled package" \
                || die "Failed to install jq from bundled package"
        else
            "$OPKG" install jq >/dev/null 2>&1 \
                && info "jq installed from Entware" \
                || die "Failed to install jq"
        fi

        # Ensure jq is in standard PATH (lighttpd CGI won't see /opt/bin)
        [ -x /opt/bin/jq ] && ln -sf /opt/bin/jq /usr/bin/jq 2>/dev/null || true

        # Same for curl — Entware-installed curl lands in /opt/bin/, but
        # CGI scripts and BusyBox shells don't have /opt/bin on PATH.
        [ -x /opt/bin/curl ] && [ ! -e /usr/bin/curl ] && \
            ln -sf /opt/bin/curl /usr/bin/curl 2>/dev/null || true

        # coreutils-timeout — installed as defense-in-depth only, NOT
        # load-bearing. qm_timeout() (defined above) is the actual fix for
        # BusyBox's `-t SECS` vs positional `SECS` straddle; per that
        # block's header comment, `timeout` installed via Entware even lands
        # at /opt/bin, which is missing from the PATH sudo hands root
        # helpers (measured), so this package can be invisible to exactly
        # the callers that need it. `command -v timeout` is not a valid
        # detector here — BusyBox always ships the applet, so that check
        # always reports "installed" and coreutils-timeout would never get
        # installed even on the legacy-CLI device. Reuse qm_timeout's own
        # behaviour probe instead.
        if [ "$_QM_TIMEOUT_FORM" = "legacy" ]; then
            info "BusyBox timeout uses the legacy -t form — installing GNU coreutils-timeout as defense-in-depth (qm_timeout wrapper is the actual portability fix)"
            "$OPKG" install coreutils-timeout >/dev/null 2>&1 \
                && info "coreutils-timeout installed from Entware" \
                || warn "coreutils-timeout not available — qm_timeout's fail-open bound still applies"
        else
            info "BusyBox timeout is coreutils-compatible (positional SECS) — no separate package needed"
        fi

        # dropbear (SSH server)
        if command -v dropbear >/dev/null 2>&1; then
            info "dropbear is already installed"
        elif ls "$SRC_DEPS"/dropbear*.ipk >/dev/null 2>&1; then
            "$OPKG" install "$SRC_DEPS"/dropbear*.ipk >/dev/null 2>&1 \
                && info "dropbear installed from bundled package" \
                || warn "dropbear install failed (optional — SSH server)"
        else
            info "dropbear not bundled and not installed (optional)"
        fi
    fi

    # --- Optional packages (from Entware, not bundled) ---
    if [ -x "$OPKG" ]; then
        for pkg in $OPTIONAL_PACKAGES; do
            if command -v "$pkg" >/dev/null 2>&1; then
                info "$pkg is already installed"
            else
                "$OPKG" install "$pkg" >/dev/null 2>&1 && info "$pkg installed" \
                    || warn "$pkg not available (optional)"
            fi
        done
    fi

    # Remove the temporary wget shim before anything outside this function
    # can see it, and before the /opt/bin/wget symlink check right below —
    # while the shim is still on PATH it IS a "wget", so any PATH-based
    # probe would find it rather than a real one.
    if [ "$_QM_NEED_WGET_SHIM" = "1" ]; then
        rm -rf /tmp/qm_wget_shim
    fi

    # Same intent as the jq/curl symlinks above: Entware-installed wget lands
    # in /opt/bin/, which CGI scripts and BusyBox shells do NOT have on PATH
    # (see downloader.sh, which backs the OTA pipeline and probes for wget
    # with an unmutated PATH).
    #
    # Test the symlink TARGET directly instead of using `! command -v wget`.
    # The PATH set when the shim was created is still in effect here and
    # still carries /opt/bin, so a `command -v wget` probe would resolve to
    # /opt/bin/wget, decide wget is "already reachable", and skip the symlink
    # on the exact devices that need it — leaving OTA's wget fallback blind
    # to the wget we just installed. Testing /usr/bin/wget is immune to
    # whatever PATH happens to be in force.
    #
    # The PATH mutation is deliberately NOT restored. setup_ssh_early() runs
    # after this function and probes `command -v dropbear`; dropbear exists
    # only at /opt/sbin/dropbear and gets no symlink anywhere, so dropping
    # /opt/sbin would make that probe report "not installed" on every fresh
    # install and trigger a redundant reinstall. coreutils-timeout (used by
    # at_stack_check) has the same shape — Entware-only, no symlink.
    [ -x /opt/bin/wget ] && [ ! -e /usr/bin/wget ] && \
        ln -sf /opt/bin/wget /usr/bin/wget 2>/dev/null || true
}

# --- Stop Running Services ---------------------------------------------------

stop_services() {
    step "Stopping QManager services"

    # Stop watchcat first — it can trigger Tier-4 reboots if it sees the poller die
    touch "$WATCHCAT_LOCK"
    systemctl stop qmanager-watchcat 2>/dev/null || true
    killall -9 qmanager_watchcat 2>/dev/null || true
    touch "$WATCHCAT_LOCK"  # re-touch after SIGKILL as defense in depth

    # Stop socat-at-bridge services if present from previous installations
    # (idempotent — systemctl stop is a no-op for inactive/missing units)
    systemctl stop socat-smd11 socat-smd11-to-ttyIN socat-smd11-from-ttyIN 2>/dev/null || true
    for svc in socat-smd11 socat-smd11-to-ttyIN socat-smd11-from-ttyIN; do
        rm -f "$WANTS_DIR/${svc}.service"
    done

    # Collect all qmanager-* units (excluding watchcat — already stopped above)
    _units=""
    for unit in "$SYSTEMD_DIR"/qmanager-*.service; do
        [ -f "$unit" ] || continue
        svc=$(basename "$unit" .service)
        [ "$svc" = "qmanager-watchcat" ] && continue
        _units="$_units $svc"
    done
    # Single batched stop — systemd processes these in parallel internally
    if [ -n "$_units" ]; then
        systemctl stop $_units 2>/dev/null || true
    fi

    # SIGTERM all qmanager_* processes (update and auto_update excluded —
    # qmanager_update is our own parent; qmanager_auto_update owns the outer loop)
    for bin in "$BIN_DIR"/qmanager_*; do
        [ -f "$bin" ] || continue
        proc=$(basename "$bin")
        case "$proc" in
            qmanager_update|qmanager_auto_update) continue ;;
        esac
        killall "$proc" 2>/dev/null || true
    done

    sleep 1

    # SIGKILL any stragglers (same exclusions)
    for bin in "$BIN_DIR"/qmanager_*; do
        [ -f "$bin" ] || continue
        proc=$(basename "$bin")
        case "$proc" in
            qmanager_update|qmanager_auto_update) continue ;;
        esac
        killall -9 "$proc" 2>/dev/null || true
    done

    info "All services stopped"
}

# --- Backup Originals --------------------------------------------------------

backup_originals() {
    step "Backing up original files"

    # install -d, NOT mkdir -p: measured 0777 www-data:www-data on BOTH shipped
    # devices 2026-08-31 (umask 0000 at install time, see :624; mkdir -p then
    # no-ops on the existing dir forever). The auth.json snapshots inside are
    # individually 0600, but a world-writable, non-sticky parent lets any uid
    # unlink and replace them regardless of the files' own mode.
    #
    # BOTH halves are durable now, which was NOT true before F22. This store
    # used to sit at /etc/qmanager/backups, where `-o root -g root` was
    # decorative: qmanager_setup:177 runs `chown -R www-data:www-data
    # /etc/qmanager` unconditionally on every boot, so the pin survived
    # exactly one boot cycle and 0700 then meant "www-data only" rather than
    # "root only". F22 moved $BACKUP_DIR out to a sibling under root-owned
    # /etc (see migrate_backup_location()), which the boot-time sweep does not
    # reach — so root ownership now persists and 0700 means what it says.
    #
    # This is a real boundary and not just tidiness: the installer is the only
    # reader and the only writer here (the cp below and the prune loop under
    # it), and it runs as root. Nothing else in the tree — no CGI, no root
    # helper, no restore path — touches the store, so there is no consumer
    # that a root-only mode could break.
    install -d -o root -g root -m 0700 "$BACKUP_DIR"

    # Backup existing QManager auth (preserves password across upgrades)
    if [ -f "$CONF_DIR/auth.json" ]; then
        local ts; ts=$(date +%Y%m%d_%H%M%S)
        cp "$CONF_DIR/auth.json" "$BACKUP_DIR/auth.json.$ts" 2>/dev/null || true
        info "Backed up auth config"

        # Prune to the newest 5 auth.json backups — every install/OTA run adds
        # one and nothing ever removed the old ones, so this grows unbounded
        # on constrained UBI flash. Filenames use %Y%m%d_%H%M%S, so a plain
        # lexicographic sort is already chronological order — no reliance on
        # `ls -t` (mtime-based, BusyBox behavior not guaranteed) or `head -n
        # -N` (negative counts aren't portable either).
        local _keep=5
        local _backups; _backups=$(ls -1 "$BACKUP_DIR"/auth.json.* 2>/dev/null | sort)
        if [ -n "$_backups" ]; then
            local _total; _total=$(printf '%s\n' "$_backups" | wc -l)
            if [ "$_total" -gt "$_keep" ]; then
                local _excess=$(( _total - _keep ))
                printf '%s\n' "$_backups" | head -n "$_excess" | while IFS= read -r f; do
                    rm -f "$f" 2>/dev/null || true
                done
                info "Pruned $_excess old auth.json backup(s), keeping newest $_keep"
            fi
        fi
    fi

    # Backup existing lighttpd config (if upgrading)
    if [ -f "$LIGHTTPD_CONF" ]; then
        cp "$LIGHTTPD_CONF" "${LIGHTTPD_CONF}.bak"
        info "Backed up existing lighttpd.conf"
    fi

    info "Backups complete"
}

# --- Install Frontend --------------------------------------------------------

install_frontend() {
    step "Installing frontend"

    # Create web root if it doesn't exist (independent install — no SimpleAdmin)
    # SECURITY: 0755, never world-writable. lighttpd serves this tree and runs
    # CGI from cgi-bin/; a writable docroot lets an unprivileged local user
    # replace served assets or swap out the whole cgi-bin/ subtree (the subtree
    # is correctly 0755 itself, but a writable PARENT makes that moot).
    install -d -o root -g root -m 0755 "$WWW_ROOT"
    install -d -o root -g root -m 0755 "$WWW_ROOT/cgi-bin"

    local file_count
    file_count=$(count_files "$SRC_FRONTEND")
    info "Deploying $file_count frontend files to $WWW_ROOT"

    # Clean www root — preserve cgi-bin
    for item in "$WWW_ROOT"/*; do
        name=$(basename "$item")
        case "$name" in
            cgi-bin) continue ;;
            *) rm -rf "$item" ;;
        esac
    done

    # Copy new frontend
    cp -r "$SRC_FRONTEND"/* "$WWW_ROOT/"

    # Re-derive the served language-pack copy from the persistent store.
    # /usrdata/qmanager/locales-packs/ lives OUTSIDE $WWW_ROOT so it survives
    # the wipe above; this is the OTA-survival step that puts installed packs
    # back under the web root on every install/update run. Idempotent — safe
    # on fresh installs (no persistent store yet) and every subsequent OTA.
    mkdir -p "$WWW_ROOT/locales-packs"
    if [ -d /usrdata/qmanager/locales-packs ]; then
        for d in /usrdata/qmanager/locales-packs/*/; do
            [ -d "$d" ] && cp -r "$d" "$WWW_ROOT/locales-packs/"
        done
    fi

    info "Frontend installed ($file_count files)"
}

# --- Install Backend ---------------------------------------------------------

install_backend() {
    step "Installing backend scripts"

    # --- Secure the install root FIRST ----------------------------------------
    # SECURITY: $QMANAGER_ROOT must never be group/world-writable, and must be
    # pinned BEFORE anything is written into it — not merely by the time this
    # function returns.
    #
    # Why it matters: qmanager-console.service has no User= directive, so it
    # runs as root with ExecStart=$QMANAGER_ROOT/console/ttyd ... console.sh.
    # Write permission on this PARENT allows deleting and recreating console/
    # regardless of console/'s own mode, so the next service start would execute
    # attacker-supplied console.sh as root, with no authentication anywhere in
    # the path.
    #
    # Why up here: this directory was otherwise first created by the console
    # block further down via `mkdir -p`, which honours the ambient umask and is
    # a silent no-op on an existing directory — exactly how 0777 reached fielded
    # devices and then persisted across every OTA. `install -d` re-applies
    # owner/mode on EVERY run, so one OTA self-heals a drifted device.
    install -d -o root -g root -m 0755 "$QMANAGER_ROOT"

    # --- Traffic Engine binary directory ---
    # Home of the tpws engine binary (installed on demand by
    # /usr/bin/qmanager_dpi_install from the official zapret release). Must
    # stay root-owned 0755: the root systemd unit execs this binary, so
    # www-data writability here would be a root-code-execution vector. It
    # lives on the persistent ubi2_0 volume ($QMANAGER_ROOT) on purpose —
    # unlike /usr/bin, it survives a rootfs wipe on OTA.
    install -d -o root -g root -m 0755 "$QMANAGER_ROOT/bin"

    # --- Shared libraries ---
    # SECURITY: this directory MUST NOT be group/world-writable. Root helpers
    # (qmanager_*_apply, invoked by www-data through a NOPASSWD sudoers grant)
    # `.` source these libraries AS ROOT. Directory write permission governs
    # create/rename/DELETE of entries — so a world-writable dir lets www-data
    # replace a 0644 root-owned lib wholesale and get root code execution on
    # the next helper call, regardless of the files' own modes.
    #
    # `mkdir -p` honours the process umask and is a silent no-op on an existing
    # directory, which is how this shipped as 0777 in the field. `install -d`
    # re-applies owner/mode on EVERY run, so one OTA self-heals every device
    # (same idiom, same reason, as /etc/data/qmanager below).
    install -d -o root -g root -m 0755 "$LIB_DIR"
    if [ -d "$SRC_SCRIPTS/usr/lib/qmanager" ]; then
        local lib_count
        lib_count=$(install_dir_flat "$SRC_SCRIPTS/usr/lib/qmanager" "$LIB_DIR" 644)
        info "$lib_count libraries installed to $LIB_DIR"
    fi

    # --- Tailscale systemd units (staged for on-demand install) ---
    # These are NOT installed as active units — qmanager_tailscale_mgr copies
    # them to /lib/systemd/system/ when the user clicks "Install Tailscale".
    for f in tailscaled.service tailscaled.defaults qmanager-console.service; do
        src="$SRC_SCRIPTS/etc/systemd/system/$f"
        if [ -f "$src" ]; then
            install_file "$src" "$LIB_DIR/$f" 644 \
                || warn "Failed to stage $f"
        fi
    done

    # --- Upgrade existing Tailscale deployment ---
    # If Tailscale is already installed, update the live systemd unit and staged
    # copy so service fixes (e.g. ExecStartPost chmod) take effect on next boot.
    if [ -x "$TAILSCALE_DIR/tailscaled" ] && [ -f "$LIB_DIR/tailscaled.service" ]; then
        install_file "$LIB_DIR/tailscaled.service" "$SYSTEMD_DIR/tailscaled.service" 644 \
            || warn "Failed to update live tailscaled.service"
        mkdir -p "$TAILSCALE_DIR/systemd"
        install_file "$LIB_DIR/tailscaled.service" "$TAILSCALE_DIR/systemd/tailscaled.service" 644 \
            || warn "Failed to update staged tailscaled.service"
        info "Updated deployed tailscaled.service"
    fi

    # --- Daemons and utilities ---
    local bin_count=0
    if [ -d "$SRC_SCRIPTS/usr/bin" ]; then
        for f in "$SRC_SCRIPTS/usr/bin"/*; do
            [ -f "$f" ] || continue
            local fname; fname=$(basename "$f")
            install_file "$f" "$BIN_DIR/$fname" 755 \
                || die "Failed to install $fname"
            bin_count=$(( bin_count + 1 ))
        done
        info "$bin_count daemons/utilities installed to $BIN_DIR"
    fi

    # --- CGI endpoints ---
    if [ -d "$SRC_SCRIPTS/www/cgi-bin/quecmanager" ]; then
        install_tree "$SRC_SCRIPTS/www/cgi-bin/quecmanager" "$CGI_DIR"
        # Defensive chmod — install_tree should already have set 755/644, but
        # any silent mode regression here means lighttpd 500s on every request.
        find "$CGI_DIR" -name "*.sh" -type f -exec chmod 755 {} \;
        find "$CGI_DIR" -name "*.json" -exec chmod 644 {} \;
        local cgi_count
        cgi_count=$(find "$CGI_DIR" -name "*.sh" -type f | wc -l | tr -d ' ')
        info "$cgi_count CGI scripts installed to $CGI_DIR"
    fi

    # --- Console startup script ---
    # console/ holds console.sh, which qmanager-console.service executes AS ROOT
    # (no User= directive). Both this dir and its parent are pinned to 0755 —
    # see the SECURITY note on $QMANAGER_ROOT at the top of this function.
    if [ -d "$SRC_SCRIPTS/usrdata/qmanager/console" ]; then
        install -d -o root -g root -m 0755 "$QMANAGER_ROOT/console"
        for f in "$SRC_SCRIPTS/usrdata/qmanager/console"/*; do
            [ -f "$f" ] || continue
            local mode=644
            case "$f" in *.sh) mode=755 ;; esac
            install_file "$f" "$QMANAGER_ROOT/console/$(basename "$f")" "$mode" || true
        done
        info "Console startup script installed"
    fi

    # --- Systemd unit files (SimpleAdmin pattern: /lib/systemd/system/) ---
    if [ -d "$SRC_SCRIPTS/etc/systemd/system" ]; then
        # Ensure rootfs is writable (may have reverted since preflight)
        mount -o remount,rw / 2>/dev/null || true

        # Remove old /etc/systemd/system/ units from previous installs
        rm -f /etc/systemd/system/qmanager*.service /etc/systemd/system/qmanager*.target
        rm -rf /etc/systemd/system/qmanager.target.wants

        # Copy service files to /lib/systemd/system/ (persistent on RM520N-GL)
        for f in "$SRC_SCRIPTS/etc/systemd/system"/qmanager*.service; do
            [ -f "$f" ] || continue
            install_file "$f" "$SYSTEMD_DIR/$(basename "$f")" 644 \
                || die "Failed to install $(basename "$f")"
        done

        # Copy timer units too (e.g. qmanager-auto-update.timer) — the glob
        # above only matches *.service, so timers need their own loop or they
        # silently never get deployed. Enablement is gated separately in
        # enable_services() (timers.target.wants, not multi-user.target.wants).
        for f in "$SRC_SCRIPTS/etc/systemd/system"/qmanager*.timer; do
            [ -f "$f" ] || continue
            install_file "$f" "$SYSTEMD_DIR/$(basename "$f")" 644 \
                || die "Failed to install $(basename "$f")"
        done

        # Install lighttpd service file — ensures correct config path is used.
        # Entware's default service may point to /opt/etc/lighttpd/lighttpd.conf
        # instead of /usrdata/qmanager/lighttpd.conf where QManager's config lives.
        if [ -f "$SRC_SCRIPTS/etc/systemd/system/lighttpd.service" ]; then
            install_file "$SRC_SCRIPTS/etc/systemd/system/lighttpd.service" \
                "$SYSTEMD_DIR/lighttpd.service" 644 \
                || die "Failed to install lighttpd.service"
            info "lighttpd.service installed (config: /usrdata/qmanager/lighttpd.conf)"
        fi
        sync

        systemctl daemon-reload 2>/dev/null || warn "daemon-reload failed (transient?) — continuing"
        info "Systemd units installed to $SYSTEMD_DIR"
    fi

    # --- Console login-shell PATH snippet (/etc/profile.d) --------------------
    # SSH sessions and CGI already get /opt/bin (Entware) on PATH via
    # cgi_base.sh / the dropbear login profile. The one gap is an interactive
    # serial/getty console LOGIN shell, which reads /etc/profile.d/*.sh but
    # otherwise starts with the vendor's bare PATH. Cosmetic only — nothing
    # functional depends on it — so failures here are warnings, not die().
    if [ -f "$SRC_SCRIPTS/etc/profile.d/qmanager-path.sh" ]; then
        # /etc/profile.d does not exist on stock RM520N-GL, and the vendor
        # /etc/profile only sources it from inside `if [ -d /etc/profile.d ]` —
        # so the directory must exist first, or the snippet is never read anyway.
        # install_file also writes its atomic temp file *inside* the destination
        # dir, so without this mkdir the cp fails with ENOENT. (/etc is its own
        # always-RW UBIFS volume — no root remount is needed or helpful here.)
        # install -d, NOT mkdir -p. This directory is a root code-execution
        # path — /etc/profile:15 sources /etc/profile.d/*.sh — and it measured
        # 0777 root:root on BOTH shipped devices on 2026-08-31. Cause: the
        # install shell runs at umask 0000 (see :624), so a bare `mkdir -p`
        # creates it 0777, and `mkdir -p` then no-ops on the existing directory
        # forever after, carrying that mode through every OTA. Because the dir
        # has no sticky bit, a world-writable mode lets www-data (the CGI user,
        # so web-reachable) drop a new snippet here or replace qmanager-path.sh
        # outright — the file's own 0644 is no defence, since unlink permission
        # comes from the directory. It would then run as root at the next root
        # login. install -d re-applies the mode on every run, so an OTA heals
        # an already-affected device; mkdir -p never would.
        install -d -o root -g root -m 0755 /etc/profile.d 2>/dev/null || true
        if [ -d /etc/profile.d ] && install_file "$SRC_SCRIPTS/etc/profile.d/qmanager-path.sh" \
            "/etc/profile.d/qmanager-path.sh" 644; then
            sync
            info "Console PATH snippet installed (/etc/profile.d/qmanager-path.sh)"
        else
            warn "Failed to install qmanager-path.sh profile.d snippet"
        fi
    fi

    # --- Sudoers (re-detect after install_dependencies may have installed sudo) ---
    detect_sudo
    if [ -f "$SRC_SCRIPTS/etc/sudoers.d/qmanager" ] && [ -n "$SUDOERS_DIR" ]; then
        # install -d, not mkdir -p: this is the sudoers drop-in directory —
        # whatever detect_sudo resolved SUDOERS_DIR to. On the RM520N-GL that
        # is Entware's /opt/etc/sudoers.d, NOT /etc/sudoers.d, which does not
        # exist on the device; the fix applies uniformly either way.
        # mkdir -p honours the ambient umask and no-ops on an existing dir, so
        # a bad mode reached once persists across every OTA forever. install -d
        # re-applies owner/mode on EVERY run. 0750 (not 0755) — sudo itself is
        # setuid-root so it reads the dir regardless of mode; 0750 only stops
        # non-root users (www-data) from listing it, matching the 0700
        # precedent already shipped for SECRETS_DIR.
        install -d -o root -g root -m 0750 "$SUDOERS_DIR"
        # Ensure sudoers includes the drop-in directory
        if ! grep -q "includedir.*sudoers.d" "$SUDOERS_CONF" 2>/dev/null; then
            echo "#includedir $SUDOERS_DIR" >> "$SUDOERS_CONF"
            info "Added #includedir $SUDOERS_DIR to $SUDOERS_CONF"
        fi
        # SYNTAX-GATE the drop-in before it goes live. sudo parses the whole
        # of sudoers.d as one unit: a single malformed line here does not
        # disable one grant, it makes sudo reject the ENTIRE directory — which
        # takes out every privileged CGI action at once (reboot, OTA, Tailscale,
        # ethernet, timezone, secret writes). Installing an unvalidated file was
        # survivable while the content was static; it is not now that grants are
        # being added to it.
        #
        # Staged in the DESTINATION directory so the final `mv` is a true
        # rename(2) on the same filesystem, and so a validation failure leaves
        # the previously-installed (known-good) file completely untouched.
        # Safe to stage in-place: sudo SKIPS any file in an include directory
        # whose name contains a '.', so `qmanager.qm_stage.$$` is never parsed
        # even if we crash before cleaning it up (same property install_file's
        # own `.qm_install.$$` temp relies on).
        _sudo_stage="$SUDOERS_DIR/qmanager.qm_stage.$$"
        _sudoers_ok=0
        if install_file "$SRC_SCRIPTS/etc/sudoers.d/qmanager" "$_sudo_stage" 440; then
            chown root:root "$_sudo_stage" 2>/dev/null || true
            # visudo lives in sbin, which is not always on PATH for this
            # script; probe both the Entware and the system location. If the
            # binary is genuinely absent (sudo installed without visudo) we
            # proceed unvalidated rather than blocking the install — the
            # pre-existing behaviour — but say so loudly.
            _visudo=""
            for _c in /opt/sbin/visudo /opt/bin/visudo /usr/sbin/visudo /usr/bin/visudo; do
                [ -x "$_c" ] && { _visudo="$_c"; break; }
            done
            [ -z "$_visudo" ] && _visudo=$(command -v visudo 2>/dev/null) || true
            if [ -n "$_visudo" ]; then
                if "$_visudo" -c -f "$_sudo_stage" >/dev/null 2>&1; then
                    _sudoers_ok=1
                else
                    warn "sudoers drop-in FAILED visudo syntax check — refusing to install it"
                    warn "Existing $SUDOERS_DIR/qmanager left untouched; privileged CGI actions unchanged"
                    "$_visudo" -c -f "$_sudo_stage" 2>&1 | head -5 || true
                fi
            else
                warn "visudo not found — installing sudoers drop-in WITHOUT syntax validation"
                _sudoers_ok=1
            fi
        else
            # Same hard failure as before this gate existed: if the file cannot
            # even be staged, the install is broken in a way the operator must
            # see.
            rm -f "$_sudo_stage" 2>/dev/null || true
            die "Failed to install sudoers rules"
        fi

        if [ "$_sudoers_ok" = "1" ]; then
            if mv "$_sudo_stage" "$SUDOERS_DIR/qmanager"; then
                chown root:root "$SUDOERS_DIR/qmanager" 2>/dev/null || true
                chmod 440 "$SUDOERS_DIR/qmanager" 2>/dev/null || true
                info "Sudoers rules installed to $SUDOERS_DIR (440, visudo-checked)"
            else
                rm -f "$_sudo_stage" 2>/dev/null || true
                die "Failed to install sudoers rules"
            fi
        else
            rm -f "$_sudo_stage" 2>/dev/null || true
        fi
    elif [ -z "$SUDOERS_DIR" ]; then
        warn "sudo not found — install Entware sudo: $OPKG install sudo"
        warn "Skipping sudoers rules (CGI privilege escalation will not work)"
    fi

    # --- lighttpd config ---
    # ($QMANAGER_ROOT is secured at the top of this function, before any write.)
    if [ -f "$SRC_SCRIPTS/usrdata/qmanager/lighttpd.conf" ]; then
        install_file "$SRC_SCRIPTS/usrdata/qmanager/lighttpd.conf" "$LIGHTTPD_CONF" 644 \
            || die "Failed to install lighttpd.conf"
        info "lighttpd config installed"
    fi

    # --- TLS certificates ---
    # SECURITY: 0755 root:root. The private key is 0600 and lighttpd reads it
    # while still root at startup (it drops to www-data afterwards), so www-data
    # never needs to read the key — but it DOES need traverse+read for the
    # public cert, which is why this is 0755 and not 0750. The bug being fixed
    # is the world-WRITE bit: a writable certs/ let any local user delete and
    # replace server.key/server.crt wholesale (bypassing the key's own 0600)
    # and MITM the HTTPS admin UI.
    install -d -o root -g root -m 0755 "$CERT_DIR"
    if [ ! -f "$CERT_DIR/server.key" ]; then
        # Generate self-signed cert if none exist
        openssl req -x509 -newkey rsa:2048 -keyout "$CERT_DIR/server.key" \
            -out "$CERT_DIR/server.crt" -days 3650 -nodes \
            -subj "/CN=QManager" 2>/dev/null
        info "Generated self-signed TLS certificate"
    else
        info "TLS certs already exist"
    fi
    # Re-assert file modes every run: the key must never be group/world
    # readable, and the cert was shipping 0666 (world-WRITABLE) on fielded
    # devices. Unconditional so an already-drifted device self-heals on OTA.
    [ -f "$CERT_DIR/server.key" ] && chmod 600 "$CERT_DIR/server.key"
    [ -f "$CERT_DIR/server.crt" ] && chmod 644 "$CERT_DIR/server.crt"

    # --- Create required directories ---
    # www-data (lighttpd CGI) needs write access to config dir (auth.json, profiles)
    # and session dir (session tokens). Also needs dialout group for serial device access.
    addgroup www-data dialout 2>/dev/null || true

    # SECURITY: $CONF_DIR must be 0755, never group/world-writable — and the
    # MODE matters independently of the ownership carve-out below.
    #
    # Why: removing or replacing a file requires write permission on its PARENT
    # DIRECTORY, not on the file. A 0777 $CONF_DIR therefore lets ANY local
    # user — not just the owner — unlink a file here and drop in their own,
    # no matter what that file's own mode says. Pinning a file's mode is not a
    # defence against a writable parent.
    #
    # Note what 0755 does and does not buy: it closes group and world, but
    # www-data OWNS this directory, and 0755 grants the owner rwx. So www-data
    # can still create, rename and unlink anything in here. That is by design —
    # the CGI has to write auth.json, profiles/, ping_profile.json and the
    # *_alerts.json blobs — but it means this directory can never hold a file
    # that must be protected FROM www-data. The daemon EnvironmentFile used to
    # try, and failed; it now lives at /etc/qmanager.env. See
    # migrate_environment_location().
    #
    # This directory was previously created by mark_version_pending()'s
    # `mkdir -p`, which honours the ambient umask and no-ops on an existing
    # directory — so 0777 reached fielded devices and persisted across every
    # OTA. `install -d` re-applies owner AND mode on EVERY run: one OTA
    # self-heals a drifted device. Same reasoning as $QMANAGER_ROOT above.
    install -d -o www-data -g www-data -m 0755 "$CONF_DIR"
    install -d -o www-data -g www-data -m 0755 "$CONF_DIR/profiles"
    chown -R www-data:www-data "$CONF_DIR"

    # NOTE: the daemon EnvironmentFile used to live at $CONF_DIR/environment,
    # carved out of the blanket chown above and re-pinned root:root here. That
    # carve-out did not work and has been REMOVED — the file now lives at
    # /etc/qmanager.env, outside this directory entirely. See
    # migrate_environment_location() below for the full reasoning. The short
    # version: pinning a file root:root inside a directory www-data OWNS buys
    # nothing, because unlinking and replacing a file needs write permission on
    # the PARENT DIRECTORY, not the file. Worse, qmanager_setup runs a bare
    # `chown -R www-data:www-data /etc/qmanager` on EVERY boot, so the pin only
    # survived until the next reboot anyway. Do not reintroduce a carve-out
    # here for any file that must not be www-data-writable — move it out of
    # $CONF_DIR instead.

    # --- Alert secrets store (root-only, OUTSIDE $CONF_DIR) -------------------
    # The Discord bot token and the Gmail app password used to live as plain
    # strings inside $CONF_DIR/discord_bot.json and $CONF_DIR/email_alerts.json,
    # both 0644 and both inside the directory www-data OWNS — so any local user
    # could read them and www-data could rewrite them at will. As with the
    # daemon EnvironmentFile above, no mode or ownership pin INSIDE $CONF_DIR
    # can fix that (qmanager_setup re-runs `chown -R www-data:www-data
    # /etc/qmanager` on every boot, and owning the parent directory beats any
    # per-file mode). The only real fix is relocation, which is what
    # migrate_alert_secrets() performs.
    #
    # 0700 root:root: only root reads these. www-data writes them exclusively
    # through the /usr/bin/qmanager_secret_set sudoers grant, which takes the
    # value on stdin and never on argv.
    #
    # `install -d`, never `mkdir -p`: mkdir -p honours the ambient umask and is
    # a silent no-op on an existing directory, so a mode that drifted once would
    # persist across every future OTA. install -d re-applies the mode on EVERY
    # run, so one OTA self-heals a drifted device. The explicit chmod/chown
    # afterwards do not assume `install -o/-g/-m` semantics are uniform, and
    # everything here is non-fatal: an abort inside install_backend would kill
    # an in-flight OTA with services already stopped.
    install -d -m 0700 "$SECRETS_DIR" 2>/dev/null || warn "Could not create $SECRETS_DIR"
    if [ -d "$SECRETS_DIR" ]; then
        chown root:root "$SECRETS_DIR" 2>/dev/null || true
        chmod 0700 "$SECRETS_DIR" 2>/dev/null || true
    fi

    # Custom DNS needs a www-data-owned staging dir on /dev/ubi2_0 (same volume
    # as /etc/data/dnsmasq.conf) so the CGI can write the candidate config and
    # the final rename into place stays atomic. install -d self-heals owner/mode
    # on re-run, so this is safe on upgrade.
    install -d -o www-data -g www-data -m 0700 /etc/data/qmanager

    # Runtime language-pack downloader storage (Increment B). Persistent store
    # stays root-owned — only the qmanager_language_pack_apply root helper may
    # write into it (see sudoers.d/qmanager). The staging dir is www-data-owned
    # so the unprivileged download worker can extract + validate a pack there
    # before handing the validated tree to the root helper. install -d self-
    # heals owner/mode on re-run, so this is safe on upgrade.
    #
    # Both lines below use install -d. Until 2026-08-31 the packs line was a
    # bare `mkdir -p`, and the "install -d self-heals" sentence above was true
    # only of the staging line directly beneath it — so the store inherited the
    # installer's umask 0000 (see :624) and measured 0777 on BOTH shipped
    # devices, which is precisely the root-only-writer boundary this comment
    # claims to enforce.
    #
    # 0755, NOT 0700: the store must stay world-READABLE. Only root writes it,
    # but system/language-packs/list.sh is a www-data CGI that reads each
    # <code>/_pack.json straight out of here to report what is installed.
    # Tightening this to 0700 breaks the language-pack list endpoint.
    install -d -o root -g root -m 0755 /usrdata/qmanager/locales-packs
    install -d -o www-data -g www-data -m 0700 /usrdata/qmanager/locales-staging

    # --- Migrate legacy TTL state file (one-time, non-fatal) -----------------
    # Old path: /etc/firewall.user.ttl (root-owned, unwritable by www-data CGI)
    # New path: /etc/qmanager/ttl_state (www-data-owned via CONF_DIR chown above)
    if [ -f /etc/firewall.user.ttl ] && [ ! -f "$CONF_DIR/ttl_state" ]; then
        info "Migrating legacy TTL state from /etc/firewall.user.ttl ..."
        (
            . "$LIB_DIR/platform.sh" 2>/dev/null
            . "$LIB_DIR/ttl_state.sh" 2>/dev/null
            old_ttl=$(grep -o -- '--ttl-set [0-9]*' /etc/firewall.user.ttl 2>/dev/null | awk '{print $2}' | head -n1)
            old_hl=$(grep -o -- '--hl-set [0-9]*' /etc/firewall.user.ttl 2>/dev/null | awk '{print $2}' | head -n1)
            [ -z "$old_ttl" ] && old_ttl=0
            [ -z "$old_hl" ] && old_hl=0
            if [ "$old_ttl" -eq 0 ] && [ "$old_hl" -eq 0 ]; then
                info "Legacy /etc/firewall.user.ttl had no parseable TTL/HL — leaving in place for inspection"
            else
                # Only delete the legacy file once the new state file is
                # confirmed written — this migration is gated on ttl_state
                # not existing, so it never retries. Deleting unconditionally
                # (previously a separate statement outside this check) would
                # permanently lose the operator's TTL/HL on a write failure.
                if ttl_state_write_persisted "$old_ttl" "$old_hl"; then
                    info "Migrated TTL=$old_ttl HL=$old_hl to $TTL_STATE_FILE"
                    rm -f /etc/firewall.user.ttl || true
                    info "Removed legacy /etc/firewall.user.ttl"
                else
                    warn "Failed to write $TTL_STATE_FILE — leaving /etc/firewall.user.ttl in place to retry next run"
                fi
            fi
        ) || true
    fi

    mkdir -p "$SESSION_DIR"
    chown www-data:www-data "$SESSION_DIR"
    chmod 700 "$SESSION_DIR"
    mkdir -p /var/lock

    # --- Config files (deploy new, don't overwrite existing) ---
    if [ -d "$SRC_SCRIPTS/etc/qmanager" ]; then
        for f in "$SRC_SCRIPTS/etc/qmanager"/*; do
            [ -f "$f" ] || continue
            local fname; fname=$(basename "$f")
            if [ ! -f "$CONF_DIR/$fname" ]; then
                install_file "$f" "$CONF_DIR/$fname" 644 \
                    || warn "Failed to deploy config: $fname"
                info "Deployed config: $fname"
            fi
        done
    fi

    # --- Initialize JSON config if missing ---
    if [ -f "$LIB_DIR/config.sh" ]; then
        . "$LIB_DIR/config.sh"
        qm_config_init
        info "Config initialized at /etc/qmanager/qmanager.conf"
        migrate_watchcat_fail_threshold
    fi

    # --- Bootstrap default ping_profile.json / migrate legacy env vars ----------
    install_ping_profile
    migrate_ping_environment
    prune_stale_ping_environment
    # MUST stay after the two above — they are hardcoded to the OLD path and
    # would silently no-op forever if the file moved first. See the ordering
    # note in migrate_environment_location().
    migrate_environment_location
    migrate_ping_targets
    migrate_sim_registry
    migrate_apn_sidecars
    # Relocates the Discord token / Gmail app password / msmtprc out of the
    # www-data-owned $CONF_DIR into $SECRETS_DIR. Depends only on $SECRETS_DIR
    # existing (created earlier in this function); see the ordering note in
    # migrate_alert_secrets().
    migrate_alert_secrets

    info "Backend installed"
}

# --- Migrate watchcat.max_failures -> watchcat.fail_threshold ----------------

# Split-ownership realignment: the Connection Watchdog now owns the fail
# cadence (fail_threshold, compared against the ping daemon's raw
# streak_fail — replaces the old max_failures double-debounce) AND the probe
# cadence (probe_interval, propagated into ping_profile.json's interval_sec
# by monitoring/watchdog.sh). The Connectivity Sensitivity card keeps only
# the probe targets. Runs unconditionally on every install/OTA — mirrors
# migrate_ping_environment's idempotent style. Three cases, each a no-op on
# re-run:
#   1. fail_threshold unset, max_failures set   -> copy value, delete old key
#   2. fail_threshold unset, max_failures unset -> seed fail_threshold=5
#   3. fail_threshold already set               -> just drop any leftover max_failures
# Also seeds probe_interval=5 (the daemon's relaxed-profile default) if unset,
# so an upgraded device gets a sane starting cadence.
migrate_watchcat_fail_threshold() {
    command -v qm_config_get >/dev/null 2>&1 || return 0

    # qm_config_set/qm_config_delete (config.sh) return 1 on a jq failure —
    # e.g. a corrupt/unparseable qmanager.conf — and this file runs under
    # `set -e` with this function called bare from install_backend(), so an
    # unguarded call here would abort the entire installer/OTA over a
    # non-fatal config migration. `|| true` on each: worst case this one
    # migration is skipped and retried next run: config.sh's writers are
    # self-contained (temp file + gated mv), so a skip here cannot corrupt
    # the config, only leave the old key(s) in place for the next install.
    local current legacy probe_interval
    current=$(qm_config_get watchcat fail_threshold "")
    if [ -n "$current" ]; then
        qm_config_delete watchcat max_failures || true
    else
        legacy=$(qm_config_get watchcat max_failures "")
        if [ -n "$legacy" ]; then
            qm_config_set watchcat fail_threshold "$legacy" || true
            qm_config_delete watchcat max_failures || true
            echo "  Migrated watchcat.max_failures -> watchcat.fail_threshold ($legacy)"
        else
            qm_config_set watchcat fail_threshold 5 || true
            echo "  Seeded watchcat.fail_threshold=5 (default)"
        fi
    fi

    probe_interval=$(qm_config_get watchcat probe_interval "")
    if [ -z "$probe_interval" ]; then
        qm_config_set watchcat probe_interval 5 || true
        echo "  Seeded watchcat.probe_interval=5 (default)"
    fi
}

# --- Bootstrap Default ping_profile.json -------------------------------------

# Bootstrap default ping_profile.json on first install. Idempotent.
install_ping_profile() {
    local target="/etc/qmanager/ping_profile.json"
    local source_file="$SRC_SCRIPTS/etc/qmanager/ping_profile.json"

    mkdir -p /etc/qmanager
    if [ ! -f "$target" ]; then
        if [ -f "$source_file" ]; then
            # This file runs under `set -e` and install_ping_profile is
            # called bare from install_backend() — a `cp` failure (e.g. disk
            # full on /etc/qmanager's UBIFS volume) would otherwise abort the
            # whole installer/OTA over a missing default profile, which the
            # ping daemon can tolerate (it has in-code defaults) far better
            # than a half-finished install can.
            if cp "$source_file" "$target" 2>/dev/null; then
                chmod 644 "$target"
                echo "  Installed default ping profile (relaxed)"
            else
                echo "  WARNING: failed to install default ping profile to $target" >&2
            fi
        else
            echo "  WARNING: $source_file missing from installer payload" >&2
        fi
    else
        echo "  Existing ping profile preserved at $target"
    fi
}

# --- Migrate Legacy HTTP Ping Targets to ICMP Targets ------------------------

# The ping daemon moved from HTTP probes (target_1/target_2 URLs, e.g.
# "http://cp.cloudflare.com/") to plain ICMP probes (target_ipv4/target_ipv6
# hosts, e.g. "1.1.1.1"). An HTTP URL is not a valid ICMP host, so this does
# NOT try to convert the old value — it reseeds the Cloudflare ICMP defaults
# and drops the stale keys. Idempotent: a device already on target_ipv4/
# target_ipv6 (or with no config file yet) is a no-op.
migrate_ping_targets() {
    local target="/etc/qmanager/ping_profile.json"
    [ -f "$target" ] || return 0
    command -v jq >/dev/null 2>&1 || return 0

    local has_legacy has_new
    has_legacy=$(jq -r 'has("target_1") or has("target_2")' "$target" 2>/dev/null)
    has_new=$(jq -r 'has("target_ipv4") and has("target_ipv6")' "$target" 2>/dev/null)

    if [ "$has_legacy" != "true" ] || [ "$has_new" = "true" ]; then
        return 0
    fi

    echo "  Migrating ping_profile.json from HTTP targets to ICMP targets..."
    # Temp file MUST live in the destination directory (/etc/qmanager), not a
    # bare `mktemp` (which lands in /tmp): mv is only atomic (rename(2))
    # within one filesystem, and /tmp is tmpfs while /etc is UBIFS — a
    # cross-filesystem mv silently degrades to copy+unlink. That matters here
    # for two reasons: (1) crash-atomicity against power loss mid-write on
    # flash, and (2) lighttpd (and its CGI, settings/ping_profile.sh and
    # monitoring/watchdog.sh) is NOT stopped during an OTA, so there IS a live
    # concurrent writer for this specific file. Note this does not fully
    # close that race: no lock is held on either side, so an atomic rename
    # only turns a torn read into a lost update if the CGI writes between our
    # read and our rename — out of scope here, no locking added.
    local tmp
    tmp=$(mktemp /etc/qmanager/.ping_profile.json.XXXXXX) || {
        echo "  WARNING: failed to create temp file for ping_profile.json migration — skipping" >&2
        return 0
    }
    if jq \
        --arg t4 "1.1.1.1" \
        --arg t6 "2606:4700:4700::1111" \
        '.target_ipv4 = $t4 | .target_ipv6 = $t6 | del(.target_1) | del(.target_2)' \
        "$target" > "$tmp" 2>/dev/null; then
        # Set mode AND owner on the temp file BEFORE the rename: BusyBox
        # mktemp creates 0600 root:root, and mv carries both mode and owner
        # to the destination. A chmod-after-mv (the old code) leaves a
        # 0600-root window AND silently flips this file from
        # www-data:www-data back to root:root on every run where the legacy
        # gate fires — install_backend() chowns /etc/qmanager to
        # www-data:www-data earlier in the same function, so www-data is the
        # intended steady state. `|| true` on chown: a missing www-data user
        # must not abort the install.
        chmod 644 "$tmp"
        chown www-data:www-data "$tmp" 2>/dev/null || true
        mv "$tmp" "$target"
        echo "  Migrated $target to target_ipv4=1.1.1.1 target_ipv6=2606:4700:4700::1111"
    else
        rm -f "$tmp"
        echo "  WARNING: failed to migrate legacy ping targets in $target" >&2
    fi
}

# --- Migrate APN Sidecars from /usrdata/qmanager to /etc/qmanager ------------

# The two APN sidecars (apn_names.json — the per-CID profile-name map; and
# apn_setting.json — the WS6 single-APN record) used to live in
# /usrdata/qmanager. That directory is pinned 0755 root:root for security (the
# root-run qmanager-console.service executes ttyd from a subdirectory, so a
# writable parent is a root-escalation path), and BOTH writers of these files
# run as www-data: cellular/apn.sh is CGI, and qmanager_profile_apply is
# spawned WITHOUT sudo by profiles/apply.sh on the UI path. Creating a file
# needs write permission on the parent directory, so both writers' atomic
# tmp+rename silently no-opped and the settings never persisted.
#
# They now live in /etc/qmanager, which install_backend() already owns as
# www-data:www-data. Nothing root sources or executes from there, so this adds
# no privilege surface — these are inert JSON blobs read only via jq.
#
# Migration is needed, not merely tidy: apn_setting.json shipped while
# /usrdata/qmanager was still 0777, so devices installed in that window carry
# a real file with real user data. apn_names.json is older still and is known
# to exist in the field (see the orphan-cleanup note in uninstall_rm520n.sh).
#
# Idempotent: no-op when the source is absent or the destination already
# exists, so re-running an install or OTA never clobbers newer state.
#
# Never aborts the installer: called bare from install_backend() under `set -e`,
# after stop_services() has already torn every qmanager service down, so every
# failure path must warn and continue rather than return non-zero. The original
# is unlinked only after the copy AND the rename have both succeeded — a failure
# leaves the old file exactly where it was, still readable, rather than losing
# the user's APN settings.
migrate_apn_sidecars() {
    local f src dst tmp
    for f in apn_names.json apn_setting.json; do
        src="/usrdata/qmanager/$f"
        dst="/etc/qmanager/$f"

        [ -f "$src" ] || continue

        # Guard the pathological case BEFORE anything else touches $src.
        # Nothing in this tree ever creates a directory at $dst — the two
        # writers (cellular/apn.sh, qmanager_profile_apply) only ever mkdir the
        # PARENT — but if one existed it would poison both checks below. `[ -e ]`
        # would read it as "already migrated" and delete the original outright,
        # while falling through is worse still: `mv file dir` does not fail, it
        # moves the file INSIDE the directory where nothing reads it, returns 0,
        # and the unlink would then run believing the rename succeeded. Bail out
        # and keep $src instead. Same guard, same reason, as
        # migrate_environment_location() below.
        if [ -d "$dst" ]; then
            echo "  WARNING: $dst exists and is a directory — skipping migration of $f, leaving $src in place" >&2
            continue
        fi

        # `-f`, not `-e`: only a regular file counts as already-migrated, so the
        # unlink below can never be reached by a non-file squatting on $dst.
        if [ -f "$dst" ]; then
            # Already migrated on an earlier run; drop the stale original so a
            # later reader can never pick up the abandoned copy.
            rm -f "$src" 2>/dev/null || true
            continue
        fi

        echo "  Migrating $src -> $dst ..."
        # Temp file MUST live in the DESTINATION directory. /usrdata and /etc
        # are separate UBIFS volumes, so a direct `mv` across them is not
        # rename(2) — it degrades to copy+unlink and loses crash-atomicity on
        # flash. Same reasoning as migrate_ping_targets() above; lighttpd is
        # not stopped during an OTA, so a concurrent CGI reader is possible.
        tmp=$(mktemp /etc/qmanager/.${f}.XXXXXX) || {
            echo "  WARNING: failed to create temp file for $f migration — skipping" >&2
            continue
        }
        if cat "$src" > "$tmp" 2>/dev/null; then
            # Mode AND owner set BEFORE the rename: BusyBox mktemp creates
            # 0600 root:root and mv carries both across, which would leave the
            # file unreadable and unwritable by the www-data CGI that owns it.
            # Both guarded, not just the chown: a bare `chmod` here would abort
            # the whole in-flight OTA under `set -e` — after stop_services() has
            # torn every service down — which is exactly what this function's
            # header promises it will never do. Degrading is safe and
            # self-healing: the file lands 0600, but the chown below (and
            # qmanager_setup's `chown -R www-data:www-data /etc/qmanager` on
            # every boot, qmanager_setup:139) makes www-data the owner, and
            # www-data is the ONLY reader/writer — cellular/apn.sh is CGI and
            # qmanager_profile_apply is spawned without sudo. So 0600 www-data
            # is functionally equivalent here; nothing else needs the read bit.
            chmod 644 "$tmp" 2>/dev/null || true
            chown www-data:www-data "$tmp" 2>/dev/null || true
            # The rename is guarded and the original is unlinked ONLY inside the
            # success branch. General rule, and the reason this function had a
            # data-loss bug: an unlink of the LAST REMAINING COPY must live
            # inside the success branch of whatever created the new copy — never
            # as a sibling statement after it. A bare `mv` here was doubly wrong:
            # on a genuine failure it would abort the whole in-flight OTA under
            # `set -e`, after stop_services() has torn every service down (this
            # function is called bare from install_backend(), so it must never
            # return non-zero — see the same convention at the top of
            # migrate_sim_registry()); and on the `mv file dir` case it returns 0
            # while doing the wrong thing, which no exit-status check can catch —
            # hence the [ -d "$dst" ] guard above as well.
            if mv "$tmp" "$dst"; then
                rm -f "$src" 2>/dev/null || true
                echo "  Migrated $f to /etc/qmanager"
            else
                rm -f "$tmp" 2>/dev/null || true
                echo "  WARNING: failed to install $dst — leaving $src in place" >&2
            fi
        else
            rm -f "$tmp"
            echo "  WARNING: failed to copy $src — leaving original in place" >&2
        fi
    done
}

# --- Seed SIM Registry from Legacy known_iccids ------------------------------

# The "New SIM detected" banner used to be dismissed via browser localStorage.
# The new /etc/qmanager/sim_registry.json (root:root 0644, one object per
# ICCID) replaces that with a server-side record, filled in going forward by
# the poller (carrier/phone_number) and the sim_registry CGI (dismissed).
#
# On an existing device, /etc/qmanager/known_iccids (newline-delimited bare
# ICCIDs, see sim_db.sh) already lists every SIM the device has seen and the
# user has implicitly acknowledged — being a member of that set IS the prior
# acknowledgement. So each line is seeded as dismissed:true to avoid re-firing
# the banner for every already-known SIM on the first boot after upgrade.
# carrier/phone_number are seeded empty (unknown for historical entries — the
# poller fills them in for the active SIM on its next cycle) and first_seen is
# seeded null (there is no recorded add-time for these legacy entries; do NOT
# fabricate one from install time or the file's mtime, which only reflects the
# LAST add, not the first).
#
# Idempotent via a CONTENT check (missing-keys backfill), not an existence
# gate. It used to gate on existence alone, which turned a one-release bug into
# a permanent one: the original seed trimmed with jq's gsub(), which aborts on
# this platform (see the ONIGURUMA note below), so the file got created lazily
# by sim_registry_refresh_active()'s auto-vivify with only the ACTIVE SIM in it.
# An existence gate then meant no later install could ever repair that — the
# same trap as "fixing" a bad chmod by deleting the line (see
# docs/reference/qmanager-independence.md): a fix that never revisits the drifted
# state is not a fix. So this now adds records for known_iccids entries that have
# NO record at all, and is strictly ADDITIVE — an existing record is never
# modified, so a real "new SIM" record (first_seen set, dismissed false) and a
# user's dismissal both survive untouched. If nothing is missing it writes
# nothing, which also keeps it from clobbering a concurrent CGI write in the
# common case (lighttpd is NOT stopped during an OTA, unlike the poller).
# NOTE: this function is called BARE (not inside an if/&&/||) from
# install_backend(), and this whole file runs under `set -e` (see top of
# file). A non-zero return here would abort the entire installer/OTA
# mid-flight — after stop_services() has already torn down every qmanager
# service, with no rollback. A failed seed is recoverable (the poller/CGI
# recreate sim_registry.json records lazily as the SIM is re-observed), but a
# half-finished install is not. So every failure path below warns to stderr
# and returns 0, matching every sibling migration function in this file.
migrate_sim_registry() {
    local target="/etc/qmanager/sim_registry.json"
    local source_file="/etc/qmanager/known_iccids"
    command -v jq >/dev/null 2>&1 || return 0
    # Config dir must exist — the in-dir mktemp below depends on it.
    [ -d /etc/qmanager ] || return 0
    # Nothing to seed from, and nothing to repair.
    [ -f "$source_file" ] || return 0

    # Load any existing registry. A target that exists but does not parse is
    # left strictly alone: it may be a partial CGI write we'd rather not
    # overwrite, and destroying a user's dismissal state is worse than skipping.
    local existing='{}'
    if [ -f "$target" ]; then
        existing=$(jq -c '.' "$target" 2>/dev/null) || {
            echo "  WARNING: $target is not valid JSON — leaving it untouched" >&2
            return 0
        }
        [ -n "$existing" ] || existing='{}'
    fi
    # NO jq regex functions anywhere below. Entware's jq on RM520N-GL (1.7.1) is
    # built WITHOUT the ONIGURUMA regex library, so gsub/sub/test/match/capture
    # all abort at runtime with "jq was compiled without ONIGURUMA regex
    # library". `jq -n builtins` still LISTS gsub/2, so `builtins` is NOT a
    # usable capability probe — only actually calling one reveals the gap.
    # Trimming is done by `tr` before jq sees the data: known_iccids lines are
    # bare ICCIDs (line format frozen — see sim_db.sh), so deleting every
    # space/tab/CR is equivalent to trimming each line, and also strips CRLF if
    # the file was ever touched by a Windows editor.
    local missing
    missing=$(tr -d ' \t\r' < "$source_file" | jq -R -s --argjson existing "$existing" '
        [ split("\n")[]
          | select(length > 0)
          | . as $iccid
          | select($existing | has($iccid) | not)
        ] | length' 2>&1) || {
        echo "  WARNING: failed to read known_iccids: ${missing:-unknown error}" >&2
        return 0
    }
    case "$missing" in
        ''|*[!0-9]*) return 0 ;;
        0) return 0 ;;
    esac

    echo "  Backfilling sim_registry.json with $missing SIM(s) from known_iccids..."
    # Temp file MUST live in the destination directory: mv is only atomic
    # (rename(2)) within one filesystem, and /tmp is tmpfs while /etc is UBIFS.
    # A cross-filesystem mv degrades to copy+unlink, leaving a window where the
    # destination exists half-written. Note this atomicity is what bounds the
    # residual race with a CGI dismissal write (lighttpd is never stopped during
    # an OTA): a concurrent write can be LOST here, but the file cannot be
    # corrupted, and this branch only runs when a record is genuinely missing.
    local tmp
    tmp=$(mktemp /etc/qmanager/.sim_registry.json.XXXXXX) || {
        echo "  WARNING: failed to create temp file for sim_registry.json seed — skipping" >&2
        return 0
    }
    # Seed a stub for every known ICCID, then let any EXISTING record win
    # outright. `+` on objects is a shallow, right-hand-wins merge, which is
    # exactly the semantics wanted: a key present in $existing replaces the
    # seeded stub WHOLESALE, so an existing record is never partially patched
    # and a field the poller/CGI deliberately left absent is never resurrected.
    # Do NOT use `*` here — it deep-merges and would reach inside live records.
    # stderr is captured, NOT discarded: the previous `2>/dev/null` is exactly
    # what hid the ONIGURUMA failure behind a generic warning on a live install.
    local jq_err
    jq_err=$(tr -d ' \t\r' < "$source_file" | jq -R -s --argjson existing "$existing" '
        split("\n")
        | map(select(length > 0))
        | reduce .[] as $iccid ({}; .[$iccid] = {
            carrier: "",
            phone_number: "",
            first_seen: null,
            dismissed: true
          })
        | . + $existing
        ' > "$tmp" 2>&1) || {
        rm -f "$tmp"
        echo "  WARNING: failed to seed sim_registry.json from known_iccids: ${jq_err:-unknown error}" >&2
        return 0
    }
    # chmod BEFORE the rename: mktemp creates 0600, so chmod-after would leave a
    # window where the live file is root-only and www-data's CGI cannot read it.
    # Both of these are guarded rather than bare: a bare failure under `set -e`
    # would abort the in-flight OTA, which is exactly what this function's header
    # comment promises it will never do.
    chmod 644 "$tmp" 2>/dev/null || true
    # Owner must be set on the TEMP too, for the same reason as the mode: `mv`
    # carries owner as well as mode across a rename. The blanket
    # `chown -R www-data:www-data "$CONF_DIR"` runs earlier in install_backend()
    # than this function, so a root:root temp would silently DOWNGRADE a live
    # www-data-owned registry. sim_registry.json genuinely has a www-data
    # writer — the dismiss/undismiss CGI, via sim_registry.sh — so www-data
    # ownership is correct here, and that is exactly why this file belongs in
    # $CONF_DIR while the daemon EnvironmentFile (no www-data writer, and a
    # root-escalation path if it had one) does not. See
    # migrate_environment_location().
    chown www-data:www-data "$tmp" 2>/dev/null || true
    if ! mv "$tmp" "$target"; then
        rm -f "$tmp"
        echo "  WARNING: could not install $target — skipping seed" >&2
        return 0
    fi
    local count; count=$(jq 'length' "$target" 2>/dev/null) || true
    echo "  Seeded $target with ${count:-0} entries from known_iccids"
}

# --- Migrate Legacy Ping Environment -----------------------------------------

# Migrate old cycle-count env vars in /etc/qmanager/environment to time-based.
# Old: FAIL_THRESHOLD=3 (cycles)  ->  New: FAIL_SECS=15 (seconds, assuming 5s probe interval)
# Idempotent: re-running on already-migrated file is a no-op.
migrate_ping_environment() {
    local env_file="/etc/qmanager/environment"
    [ -f "$env_file" ] || return 0

    # Skip if migration already happened (FAIL_SECS present, FAIL_THRESHOLD absent)
    if grep -q '^FAIL_SECS=' "$env_file" && ! grep -q '^FAIL_THRESHOLD=' "$env_file"; then
        return 0
    fi
    if ! grep -q '^FAIL_THRESHOLD=\|^RECOVER_THRESHOLD=\|^HISTORY_SIZE=' "$env_file"; then
        return 0
    fi

    echo "  Migrating ping env vars from cycle-count to time-based..."
    local interval=5
    if grep -q '^PING_INTERVAL=' "$env_file"; then
        interval=$(grep '^PING_INTERVAL=' "$env_file" | head -1 | cut -d= -f2)
        # Defensive default if the value is missing or non-numeric
        case "$interval" in
            ''|*[!0-9]*) interval=5 ;;
        esac
    fi

    local backup="${env_file}.pre-rust-ping.bak"
    # `|| true`: this file runs under `set -e` and migrate_ping_environment
    # is called bare from install_backend() — a backup-copy failure (e.g.
    # disk full) must not abort the whole installer/OTA over a best-effort
    # safety copy; the migration below still proceeds without one.
    cp "$env_file" "$backup" 2>/dev/null || echo "  WARNING: failed to back up $env_file to $backup" >&2

    # Temp file MUST live in the destination directory (/etc/qmanager), not a
    # bare `mktemp` (which lands in /tmp): mv is only atomic (rename(2))
    # within one filesystem, and /tmp is tmpfs while /etc is UBIFS — a
    # cross-filesystem mv silently degrades to copy+unlink. The concern here
    # is crash-atomicity, not a concurrent reader: /etc/qmanager/environment
    # is the systemd EnvironmentFile= for four units (qmanager-poller,
    # qmanager-ping, qmanager-watchcat, qmanager-discord), and stop_services()
    # has already stopped all of them by the time install_backend() runs
    # this migration — but a power loss mid-copy on flash can still leave the
    # file truncated, and a torn EnvironmentFile means those daemons silently
    # start with missing env vars on next boot.
    local tmp
    tmp=$(mktemp /etc/qmanager/.environment.XXXXXX) || {
        echo "  WARNING: failed to create temp file for environment migration — skipping" >&2
        return 0
    }
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            FAIL_THRESHOLD=*)
                local n="${line#FAIL_THRESHOLD=}"
                case "$n" in ''|*[!0-9]*) n=3 ;; esac
                printf 'FAIL_SECS=%s\n' "$((n * interval))" >> "$tmp"
                ;;
            RECOVER_THRESHOLD=*)
                local n="${line#RECOVER_THRESHOLD=}"
                case "$n" in ''|*[!0-9]*) n=2 ;; esac
                printf 'RECOVER_SECS=%s\n' "$((n * interval))" >> "$tmp"
                ;;
            HISTORY_SIZE=*)
                local n="${line#HISTORY_SIZE=}"
                case "$n" in ''|*[!0-9]*) n=60 ;; esac
                printf 'HISTORY_SECS=%s\n' "$((n * interval))" >> "$tmp"
                ;;
            *)
                printf '%s\n' "$line" >> "$tmp"
                ;;
        esac
    done < "$env_file"
    # Set mode AND owner on the temp file BEFORE the rename: BusyBox mktemp
    # creates 0600, and mv carries both mode and owner to the destination, so
    # a chmod-after-mv (the old code) leaves a window where the live file is
    # 0600 and the owner is whatever the temp had.
    #
    # Owner is root:root DELIBERATELY, unlike ping_profile.json below. This
    # file is the systemd EnvironmentFile= for four root-run daemons
    # (qmanager-poller/-ping/-watchcat/-discord) and NO CGI reads or writes
    # it. Making it www-data-owned would hand a compromised web user
    # in-place environment-variable injection into root daemons; 0644 keeps
    # it world-readable, which is all any consumer needs.
    #
    # This function still operates on the OLD path, /etc/qmanager/environment,
    # on purpose — it is a one-time historical conversion and must run BEFORE
    # migrate_environment_location() moves the file to /etc/qmanager.env. Do
    # not retarget it. The root:root here is therefore transient: it holds only
    # until the relocation a few calls later, which is where the ownership
    # actually becomes durable. Inside $CONF_DIR it never was — the blanket
    # `chown -R www-data:www-data "$CONF_DIR"` earlier in install_backend()
    # and qmanager_setup's per-boot equivalent both flatten it back.
    chmod 644 "$tmp"
    chown root:root "$tmp" 2>/dev/null || true
    mv "$tmp" "$env_file"
    echo "  Migrated $env_file (backup at $backup)"
}

# --- Prune Stale Ping Environment Vars ---------------------------------------

# Strip env vars that were removed in a past release and are now no-ops or harmful.
# Idempotent: safe to run on every install/upgrade.
#   CARRIER_FILE — removed in v0.1.9: daemon now relies solely on HTTP probes.
prune_stale_ping_environment() {
    local env_file="/etc/qmanager/environment"
    [ -f "$env_file" ] || return 0

    local stale_keys="CARRIER_FILE"
    local pruned=0
    # Temp file MUST live in the destination directory (/etc/qmanager), not a
    # bare `mktemp` (which lands in /tmp): mv is only atomic (rename(2))
    # within one filesystem, and /tmp is tmpfs while /etc is UBIFS — a
    # cross-filesystem mv silently degrades to copy+unlink. As with
    # migrate_ping_environment() above, the concern is crash-atomicity (this
    # file is the systemd EnvironmentFile= for four daemons, all stopped by
    # stop_services() before this runs, but a torn write on power loss still
    # leaves them starting with missing env vars), not a concurrent reader.
    local tmp
    tmp=$(mktemp /etc/qmanager/.environment.XXXXXX) || {
        echo "  WARNING: failed to create temp file for environment pruning — skipping" >&2
        return 0
    }

    while IFS= read -r line || [ -n "$line" ]; do
        local key="${line%%=*}"
        local drop=0
        for k in $stale_keys; do
            [ "$key" = "$k" ] && drop=1 && break
        done
        if [ "$drop" = "1" ]; then
            pruned=$(( pruned + 1 ))
        else
            printf '%s\n' "$line" >> "$tmp"
        fi
    done < "$env_file"

    if [ "$pruned" -gt 0 ]; then
        # Mode AND owner on the temp file BEFORE the rename — see the
        # equivalent block in migrate_ping_environment() above for the full
        # rationale, including why this function still targets the OLD path
        # and must run before migrate_environment_location().
        chmod 644 "$tmp"
        chown root:root "$tmp" 2>/dev/null || true
        mv "$tmp" "$env_file"
        echo "  Removed $pruned stale ping env var(s) from $env_file (CARRIER_FILE no longer used)"
    else
        rm -f "$tmp"
    fi
}

# --- Relocate the daemon EnvironmentFile out of /etc/qmanager ----------------

# SECURITY. Moves /etc/qmanager/environment -> /etc/qmanager.env.
#
# That file is the systemd EnvironmentFile= for four ROOT-run daemons
# (qmanager-poller/-ping/-watchcat/-discord). systemd does not shell-source an
# EnvironmentFile, but it DOES set every KEY=VALUE it finds into those daemons'
# environment — including PATH= and LD_PRELOAD= — and those daemons shell out
# constantly. So anyone who can write that file, or replace it, has root code
# execution.
#
# It used to live inside /etc/qmanager and was pinned root:root 0644 by a
# carve-out in install_backend(). That did not work, for two independent
# reasons, both confirmed on live hardware:
#
#   1. Unlinking or replacing a file requires write permission on its PARENT
#      DIRECTORY, not on the file. /etc/qmanager is owned by www-data (the CGI
#      genuinely writes auth.json, profiles/, ping_profile.json, sim_registry
#      .json and the *_alerts.json blobs there), and mode 0755 grants the OWNER
#      rwx. So www-data could unlink the pinned file and drop in its own,
#      whatever the file's mode said. Verified: `sudo -u www-data` could both
#      create and unlink in that directory.
#   2. qmanager_setup runs `chown -R www-data:www-data /etc/qmanager` on EVERY
#      boot with no exclusion list, so the install-time pin survived exactly
#      one boot cycle. Fielded devices were found with the file sitting
#      www-data:www-data — directly writable, no unlink trick even needed.
#
# Neither is fixable while the file lives in that directory, because the
# directory must stay www-data-writable for the CGI to work. A root-owned
# SUBdirectory would not help either: www-data owns the parent, so it could
# rename the subdirectory out of the way. Nor would the sticky bit (+t), whose
# exemption covers "root, the directory's owner, or the file's owner" — and
# www-data IS the directory's owner.
#
# /etc is root:root 0755 and unwritable by www-data (verified live), so
# /etc/qmanager.env is genuinely out of reach. Moving the file also makes
# qmanager_setup's blanket chown harmless for it, which removes the lockstep
# hazard rather than adding another carve-out to keep in sync.
#
# ORDERING — this must run AFTER migrate_ping_environment() and
# prune_stale_ping_environment(). Both of those open with
# `env_file=/etc/qmanager/environment; [ -f "$env_file" ] || return 0` and are
# deliberately left pointing at the OLD path. If this relocation ran first, a
# device still carrying the pre-v0.1.9 cycle-count format (FAIL_THRESHOLD=3
# rather than FAIL_SECS=15) would move the unconverted file out from under
# them, both would find nothing, return 0, and that device would never get its
# conversion — not on this OTA and not on any future one. Running last lets
# them finish their one-time historical work first. After the first successful
# relocation the old path stays empty forever, so both become permanent
# no-ops; that is expected, not a bug.
#
# Idempotent, and never aborts the installer: this file runs under `set -e` and
# this function is called bare from install_backend(), so every failure path
# warns and returns 0. The original is removed only after the copy AND the
# rename have both succeeded — a failure leaves the old file exactly where it
# was, still readable by the daemons, rather than losing the operator's
# overrides.
migrate_environment_location() {
    local src="/etc/qmanager/environment"
    local dst="/etc/qmanager.env"
    local tmp

    [ -f "$src" ] || return 0

    # Guard the pathological case BEFORE anything else touches $src. Nothing in
    # this tree ever creates a directory at $dst, but if one existed the two
    # obvious codings both destroy data: `[ -e ]` would treat it as "already
    # migrated" and delete the original outright, while falling through would
    # be worse still — `mv file dir` does not fail, it moves the file INSIDE
    # the directory, where nothing reads it, and then we would delete the
    # original believing the rename succeeded. Bail out and keep $src instead.
    if [ -d "$dst" ]; then
        echo "  WARNING: $dst exists and is a directory — skipping relocation, leaving $src in place" >&2
        return 0
    fi

    if [ -f "$dst" ]; then
        # Already relocated on an earlier run. Drop the stale original so no
        # later reader — and no downgraded unit file — can pick up the
        # abandoned copy, and so www-data stops owning a writable leftover.
        rm -f "$src" 2>/dev/null || true
        return 0
    fi

    echo "  Relocating $src -> $dst (security: out of the www-data-owned dir) ..."

    # Temp file in the DESTINATION directory, /etc. Confirmed live: /etc and
    # /etc/qmanager are the same UBIFS volume (/dev/ubi2_0, the same one as
    # /usrdata), so `mv` between them is a true rename(2) and stays atomic. A
    # bare mktemp would land in /tmp, which is tmpfs — a different filesystem,
    # where mv silently degrades to copy+unlink and a power loss mid-write can
    # leave a torn EnvironmentFile.
    tmp=$(mktemp /etc/.qmanager.env.XXXXXX) || {
        echo "  WARNING: failed to create temp file for environment relocation — skipping" >&2
        return 0
    }

    if cat "$src" > "$tmp" 2>/dev/null; then
        # Mode AND owner BEFORE the rename: BusyBox mktemp creates 0600 and mv
        # carries both mode and owner across, so setting them afterwards leaves
        # a window at the wrong values. root:root is the whole point here; 0644
        # is all any consumer needs, and nothing but root ever writes it.
        #
        # Both are `|| true` rather than bare. Under `set -e` a bare failure
        # here would abort the whole in-flight OTA — with services already
        # stopped — which is precisely what this function's header promises it
        # will never do. Degrading instead is safe: a chmod failure leaves the
        # file 0600 root:root, and systemd reads an EnvironmentFile as root, so
        # the daemons still get their overrides.
        chmod 644 "$tmp" 2>/dev/null || true
        chown root:root "$tmp" 2>/dev/null || true
        # The rename is guarded for the same reason, and the original is
        # removed ONLY if it succeeded — otherwise the operator's overrides
        # would be lost with nothing installed in their place.
        if mv "$tmp" "$dst"; then
            rm -f "$src" 2>/dev/null || true
            echo "  Relocated daemon environment to $dst (root:root 0644)"
        else
            rm -f "$tmp" 2>/dev/null || true
            echo "  WARNING: failed to install $dst — leaving $src in place" >&2
        fi
    else
        rm -f "$tmp" 2>/dev/null || true
        echo "  WARNING: failed to copy $src — leaving original in place" >&2
    fi
}

# --- Relocate the auth-backup store out of /etc/qmanager ---------------------

# SECURITY (F22). Moves /etc/qmanager/backups/* -> /etc/qmanager-backups/.
#
# That store holds timestamped auth.json snapshots — the QManager login
# password, one per install/OTA run, newest 5 kept. It is the third and last
# thing to leave /etc/qmanager for the reasons migrate_environment_location()
# spells out in full above and migrate_alert_secrets() repeats below: www-data
# OWNS /etc/qmanager, unlink/rename permission comes from the parent directory
# rather than the entry, and qmanager_setup:177 chowns the whole tree to
# www-data on every boot with no exclusion list. So no per-file owner or mode
# inside that directory means anything, and an exclusion list is not the fix —
# qmanager_setup:144-156 forbids that pattern in its own comment, because it
# addresses the boot-time sweep while leaving the parent-directory rule
# untouched, and the parent-directory rule alone is sufficient.
#
# F15 had already raised this directory from a bare `mkdir -p` (measured 0777
# on both shipped devices) to `install -d -o root -g root -m 0700`. That was a
# real improvement — it removed every OTHER local uid — but it could not make
# the directory root-only while it lived inside the swept tree. Relocation is
# what makes F15's mode pin mean what it says.
#
# WHY THIS IS NOT A COPY OF THE TWO FUNCTIONS AROUND IT
# -----------------------------------------------------
# Both of those move a single FILE. This moves a DIRECTORY OF N FILES into a
# destination that ALREADY EXISTS on essentially every run, and two codings
# that are correct for one file are actively wrong here:
#
#   - No directory-level `mv "$src" "$dst"`. BusyBox `mv dir dir` does not
#     fail when the destination exists — it NESTS the source inside it. The
#     destination is created by backup_originals() on every run, so a bare mv
#     would bury every snapshot at $BACKUP_DIR/backups/, one level below the
#     prune loop's `ls -1 "$BACKUP_DIR"/auth.json.*` glob, orphaned on flash
#     forever. Hence the per-file copy loop below.
#   - No `[ -e "$dst" ] && return` completion check, for the same reason: the
#     destination's existence carries no information about whether this
#     migration has run. The gate keys on the OLD path instead, which is the
#     only signal that actually means "there is still work to do".
#
# ORDERING — this must run BEFORE backup_originals(), and OUTSIDE the
# `if [ "$DO_FRONTEND" = "1" ]` block that guards it in main(). Two separate
# reasons, both load-bearing:
#
#   1. backup_originals() creates the store, copies in the fresh snapshot AND
#      prunes to the newest 5, all in one call. Running this migration after
#      that — e.g. from install_backend()'s migration block, where the two
#      sibling relocations live and where this one would naturally be filed —
#      delivers the legacy snapshots after the prune has already happened,
#      leaving up to 10 files with no further prune pass until the NEXT OTA.
#      Running first lets the existing prune operate over the merged set once,
#      correctly.
#   2. backup_originals() is gated on DO_FRONTEND. A `--backend-only` run
#      would therefore never migrate — leaving the password snapshots sitting
#      in the swept directory on exactly the devices an operator was
#      repairing. So the call site is unconditional, and this function creates
#      the destination itself rather than depending on backup_originals having
#      already done so.
#
#      KNOWN, ACCEPTED CONSEQUENCE of that same asymmetry: on a
#      `--backend-only` run this migration executes but backup_originals — and
#      therefore the prune-to-5 — does not. A device whose legacy store held
#      more than 5 snapshots (one predating the prune logic, or one that has
#      not had a frontend-inclusive install since) can sit above the retention
#      cap until the next ordinary run. That is not a regression: those files
#      were already unpruned in the old location, they are merely unpruned in
#      a safer one now, and the next non-backend-only run prunes the merged
#      set correctly. Deliberately not worth gating the security fix on.
#
# Idempotent, and never aborts the installer: this file runs under `set -e`,
# the call site is bare in main() with services already stopped, so every
# failure path warns and returns 0. Each original is unlinked only after its
# own copy has succeeded — a partial failure leaves the remaining snapshots
# where they were rather than losing them.
migrate_backup_location() {
    local src="/etc/qmanager/backups"
    local dst="$BACKUP_DIR"
    local migrated=0
    local skipped=0
    local failed=0
    local f base

    # Gate on the OLD path only — never on the destination, which exists on
    # essentially every run. Once the old path is gone this is a permanent
    # no-op, which is expected rather than a bug.
    #
    # The literal is spelled out again rather than reusing $src so the
    # regression harness can anchor this gate by text: substituting a
    # destination-existence check here is the specific defect it pins.
    [ -d "/etc/qmanager/backups" ] || return 0

    # Refuse to migrate onto ourselves. Nothing sets $BACKUP_DIR back to the
    # old path, but a bad edit that did would otherwise make the loop below
    # copy each file onto itself and then unlink it — deleting the store.
    if [ "$src" = "$dst" ]; then
        echo "  WARNING: \$BACKUP_DIR is still $src — skipping relocation" >&2
        return 0
    fi

    echo "  Relocating $src -> $dst (security: out of the www-data-owned dir) ..."

    # Create the destination ourselves; see ORDERING note 2 above. Same flags
    # as backup_originals() so a --backend-only run gets the same mode.
    if [ ! -d "$dst" ]; then
        install -d -o root -g root -m 0700 "$dst" 2>/dev/null || {
            echo "  WARNING: could not create $dst — leaving $src in place" >&2
            return 0
        }
    fi

    for f in "$src"/*; do
        # Literal glob when the directory is empty — nothing matched.
        [ -e "$f" ] || continue
        [ -f "$f" ] || continue
        base=$(basename "$f")

        # Collision: keep what is already at the destination, discard ours.
        #
        # This is not the "two different snapshots happened to share a
        # timestamp" case — that cannot occur. Once this fix ships, NOTHING
        # writes to the old path again (backup_originals always targets
        # $BACKUP_DIR, which is now the new path), so the source directory is
        # frozen. A same-name collision therefore means only one thing: an
        # earlier run already copied this file successfully and its trailing
        # `rm -f` did not take effect. Source and destination are byte-identical
        # in every reachable collision, so discarding the source costs nothing.
        #
        # The direction is also the safe one on its own merits: this function
        # runs BEFORE backup_originals takes today's snapshot, so anything
        # already at the destination is at least as current as what we carry.
        if [ -e "$dst/$base" ]; then
            echo "  WARNING: $dst/$base already exists — keeping it, discarding the copy at $src" >&2
            rm -f "$f" 2>/dev/null || true
            skipped=$((skipped + 1))
            continue
        fi

        # Copy-then-verify-then-unlink, one file at a time. `cp -p` preserves
        # the 0600 the snapshots already carry; the chown is belt-and-braces
        # for the case where the source file had drifted to www-data (which is
        # the normal state on every fielded device — that is the whole bug).
        if cp -p "$f" "$dst/$base" 2>/dev/null; then
            chown root:root "$dst/$base" 2>/dev/null || true
            rm -f "$f" 2>/dev/null || true
            migrated=$((migrated + 1))
        else
            rm -f "$dst/$base" 2>/dev/null || true
            failed=$((failed + 1))
        fi
    done

    if [ "$failed" -gt 0 ]; then
        echo "  WARNING: $failed snapshot(s) could not be copied — left in $src" >&2
    fi

    # Best-effort. Fails harmlessly and by design if anything is left behind,
    # which is exactly the case where we want the old directory kept.
    rmdir "$src" 2>/dev/null || true

    if [ -d "$src" ]; then
        echo "  Relocated $migrated snapshot(s) to $dst; $src kept (not empty)"
    else
        echo "  Relocated $migrated snapshot(s) to $dst (root:root 0700), removed $src"
    fi
    # A full `if` rather than `[ cond ] && echo`. Under `set -e` the AND-list
    # form evaluates to 1 when the condition is false, and errexit DOES apply
    # to the list as a whole — so the common `[ x ] && echo` idiom placed
    # mid-function aborts the installer on the ordinary path where nothing was
    # skipped. Exactly the failure this function's header promises never to
    # cause.
    if [ "$skipped" -gt 0 ]; then
        echo "  Discarded $skipped stale duplicate(s)"
    fi

    return 0
}

# --- Relocate alert secrets out of the www-data-owned config dir -------------

# WHY THIS EXISTS — the same story as migrate_environment_location() above, one
# directory over.
#
# /etc/qmanager/discord_bot.json shipped mode 0644 with a LIVE Discord bot token
# stored as a plain JSON string, and /etc/qmanager/email_alerts.json did the same
# with the operator's Gmail app password. /etc/qmanager/msmtprc held that
# password a second time. Two independent problems:
#
#   1. World-readable. 0644 means every local account — the web console shell,
#      any Entware daemon, anything that gets a shell through a CGI bug — can
#      read a bot token that controls the operator's Discord bot, and an app
#      password that is full IMAP/SMTP access to their Google account.
#   2. www-data-writable. www-data OWNS /etc/qmanager, and directory write
#      permission governs unlink/rename of entries, so no per-file mode or
#      ownership pin inside it means anything. qmanager_setup then runs a bare
#      `chown -R www-data:www-data /etc/qmanager` on EVERY boot, so even a
#      root:root pin only survives until the next reboot.
#
# Neither is fixable in place, for exactly the reasons spelled out in
# migrate_environment_location(): the directory has to stay www-data-writable
# for the CGI to work, a root-owned SUBdirectory is renameable by the parent's
# owner, and the sticky bit exempts the directory's owner — which is www-data.
# So the fix is relocation to /etc/qmanager-secrets (0700 root:root, a SIBLING
# of /etc/qmanager under root-owned /etc), with www-data writing values only
# through the qmanager_secret_set sudoers grant.
#
# THE del() IS THE WHOLE FIX. /etc/qmanager is the additive-only bucket —
# nothing in this tree ever prunes stale keys out of a config there. Copying the
# secret to the new store and leaving the key behind would make the entire
# change cosmetic: the plaintext would sit world-readable in the old file
# forever. The JSON is therefore rewritten with `del(.bot_token)` /
# `del(.app_password)`, and a non-secret boolean marker (`token_set` /
# `app_password_set`) is written in its place so the CGI's GET can still tell
# the UI whether a secret is configured without ever handling the value.
#
# ORDERING — this runs LAST in install_backend's migration block, after
# migrate_environment_location() and the sidecar migrations. Nothing else reads
# or writes these two keys during install, so there is no dependency in either
# direction; running last simply keeps the "historical one-time conversions
# first, relocations after" shape the block already has. It DOES depend on
# $SECRETS_DIR existing, which install_backend creates far earlier in the same
# function.
#
# Idempotent, and a permanent no-op after the first success: once the secret key
# is gone from the JSON there is nothing left to extract, and once msmtprc is at
# the new path the old one no longer exists. Never aborts the installer — this
# file runs under `set -e` and this function is called bare from
# install_backend(), so an unguarded failure would kill an in-flight OTA with
# services already stopped. Every failure path warns and returns 0, and every
# command substitution carries a `|| var=default`.
migrate_alert_secrets() {
    if [ ! -d "$SECRETS_DIR" ]; then
        echo "  WARNING: $SECRETS_DIR missing — skipping alert secret relocation" >&2
        return 0
    fi

    _migrate_one_secret "$CONF_DIR/discord_bot.json"  bot_token     token_set        discord_bot_token
    _migrate_one_secret "$CONF_DIR/email_alerts.json" app_password  app_password_set email_app_password
    _migrate_msmtprc
}

# _migrate_one_secret <config.json> <secret_key> <marker_key> <secret_filename>
#
# Extract $secret_key out of the JSON into $SECRETS_DIR/$secret_filename, then
# rewrite the JSON without it and with $marker_key set to a boolean. If there is
# no secret to move, still ensure $marker_key exists so the CGI's GET has a
# defined value rather than `null` (a `null` would render the UI's "configured"
# state as neither true nor false).
_migrate_one_secret() {
    local cfg="$1" key="$2" marker="$3" fname="$4"
    local dst="$SECRETS_DIR/$fname"
    local val tmp

    [ -f "$cfg" ] || return 0

    # Guarded: corrupt JSON makes jq exit non-zero, and a bare command
    # substitution under `set -e` would abort the OTA right here.
    val=$(jq -r --arg k "$key" '.[$k] // ""' "$cfg" 2>/dev/null) || val=""

    if [ -n "$val" ] && [ "$val" != "null" ]; then
        # Guard the pathological case BEFORE touching anything. `mv file dir`
        # does NOT fail — it moves the file INSIDE the directory — so falling
        # through would leave the secret somewhere nothing reads while we
        # happily deleted the key from the JSON, destroying the only copy.
        if [ -d "$dst" ]; then
            echo "  WARNING: $dst is a directory — skipping $key relocation" >&2
            return 0
        fi

        # Temp file in the DESTINATION directory. /etc, /etc/qmanager and
        # /etc/qmanager-secrets are all the same UBIFS volume (/dev/ubi2_0), so
        # `mv` between them is a true atomic rename(2). A bare `mktemp` lands in
        # /tmp, which is tmpfs — a DIFFERENT filesystem, where mv silently
        # degrades to copy+unlink and a power cut can tear the file.
        tmp=$(mktemp "$SECRETS_DIR/.secret.XXXXXX" 2>/dev/null) || {
            echo "  WARNING: failed to create temp file in $SECRETS_DIR — skipping $key" >&2
            return 0
        }

        # printf '%s' (no trailing newline) — the contract is a raw value, and a
        # stray \n would be sent verbatim as part of the Discord Authorization
        # header / SMTP password.
        if printf '%s' "$val" > "$tmp" 2>/dev/null; then
            # Mode AND owner BEFORE the rename: mv carries both across, so
            # setting them afterwards leaves a window at the wrong values. Both
            # are `|| true` — a bare failure here would abort the OTA, and this
            # function promises it never does. BusyBox mktemp already creates
            # 0600, and we run as root, so the degraded state is still correct.
            chmod 600 "$tmp" 2>/dev/null || true
            chown root:root "$tmp" 2>/dev/null || true
            if mv "$tmp" "$dst" 2>/dev/null; then
                # Only NOW is it safe to drop the key: the secret is durably at
                # its new home. Rewriting the JSON first and failing the move
                # would lose the operator's token outright.
                _strip_secret_key "$cfg" "$key" "$marker" true
            else
                rm -f "$tmp" 2>/dev/null || true
                echo "  WARNING: failed to install $dst — leaving $key in $cfg" >&2
            fi
        else
            rm -f "$tmp" 2>/dev/null || true
            echo "  WARNING: failed to write $dst — leaving $key in $cfg" >&2
        fi
        return 0
    fi

    # No secret in the config. Two sub-cases: the key is present but empty (drop
    # it — an empty string is still a key the new readers must not see), or it
    # was never there. Either way the marker must end up defined. Its value
    # depends on whether a secret file already exists at the new path, so a
    # device that migrated on an earlier OTA does not get its marker reset to
    # false and prompt the user to re-enter a secret that is in fact configured.
    local have=false
    [ -s "$dst" ] && have=true

    local marker_now
    marker_now=$(jq -r --arg m "$marker" '.[$m] // "absent"' "$cfg" 2>/dev/null) || marker_now="absent"

    local key_present
    key_present=$(jq -r --arg k "$key" 'has($k)' "$cfg" 2>/dev/null) || key_present="false"

    if [ "$marker_now" = "absent" ] || [ "$key_present" = "true" ]; then
        _strip_secret_key "$cfg" "$key" "$marker" "$have"
    fi
    return 0
}

# _strip_secret_key <config.json> <secret_key> <marker_key> <true|false>
#
# Atomically rewrite the JSON with the secret key DELETED and the marker set.
# Ownership/mode are deliberately re-applied from the ORIGINAL file rather than
# pinned: this file stays www-data-owned 0644 (it holds no secret any more) and
# the CGI must keep being able to write it.
_strip_secret_key() {
    local cfg="$1" key="$2" marker="$3" val="$4"
    local tmp

    # SECURITY: mktemp, never a predictable "${cfg}.something.$$" name.
    #
    # $cfg lives in $CONF_DIR, which www-data OWNS. A shell `>` redirect
    # FOLLOWS SYMLINKS, so a predictable temp name lets an already-compromised
    # www-data pre-plant that path as a symlink to any root-owned file
    # (/etc/sudoers.d/qmanager, a systemd unit, /etc/shadow) and have root's jq
    # below truncate and overwrite the target — an arbitrary-root-write
    # primitive reachable on every OTA. mktemp creates with O_EXCL, so it FAILS
    # on a pre-planted path instead of following it. This is why every other
    # migration in this file uses mktemp inside the destination directory; the
    # `mv` further down is already safe, because rename(2) does not follow
    # symlinks the way redirection does.
    tmp=$(mktemp "${CONF_DIR}/.qmsecret.XXXXXX" 2>/dev/null) || {
        echo "  WARNING: could not create temp file for $cfg — $key NOT removed" >&2
        return 0
    }

    if ! jq --arg k "$key" --arg m "$marker" --argjson v "$val" \
            'del(.[$k]) | .[$m] = $v' "$cfg" > "$tmp" 2>/dev/null; then
        rm -f "$tmp" 2>/dev/null || true
        echo "  WARNING: could not rewrite $cfg (invalid JSON?) — $key NOT removed" >&2
        return 0
    fi

    # Refuse to install an empty result. A jq that wrote nothing but still
    # exited 0 (disk full mid-write) would otherwise truncate the config.
    if [ ! -s "$tmp" ]; then
        rm -f "$tmp" 2>/dev/null || true
        echo "  WARNING: rewrite of $cfg produced an empty file — leaving original" >&2
        return 0
    fi

    chmod 644 "$tmp" 2>/dev/null || true
    chown www-data:www-data "$tmp" 2>/dev/null || true
    if mv "$tmp" "$cfg" 2>/dev/null; then
        echo "  Removed $key from $cfg (now $marker=$val)"
    else
        rm -f "$tmp" 2>/dev/null || true
        echo "  WARNING: failed to replace $cfg — $key NOT removed" >&2
    fi
    return 0
}

# Relocate the msmtp config, which contains the SMTP password in cleartext by
# construction (msmtp has no other way to supply it non-interactively).
_migrate_msmtprc() {
    local src="$CONF_DIR/msmtprc"
    local dst="$SECRETS_DIR/msmtprc"
    local tmp

    [ -f "$src" ] || return 0

    # Same `mv file dir` trap as above — bail rather than scatter the file.
    if [ -d "$dst" ]; then
        echo "  WARNING: $dst is a directory — leaving $src in place" >&2
        return 0
    fi

    if [ -f "$dst" ]; then
        # Already relocated on an earlier run. Drop the stale original so the
        # cleartext password stops sitting in a world-readable, www-data-owned
        # directory, and so no downgraded reader picks up the abandoned copy.
        rm -f "$src" 2>/dev/null || true
        return 0
    fi

    tmp=$(mktemp "$SECRETS_DIR/.msmtprc.XXXXXX" 2>/dev/null) || {
        echo "  WARNING: failed to create temp file in $SECRETS_DIR — leaving $src in place" >&2
        return 0
    }

    if cat "$src" > "$tmp" 2>/dev/null; then
        chmod 600 "$tmp" 2>/dev/null || true
        chown root:root "$tmp" 2>/dev/null || true
        # The original is removed ONLY after the destination is confirmed in
        # place — msmtp refuses to run with no config at all, so losing it
        # would silently break every email alert.
        if mv "$tmp" "$dst" 2>/dev/null; then
            rm -f "$src" 2>/dev/null || true
            echo "  Relocated msmtprc to $dst (root:root 0600)"
        else
            rm -f "$tmp" 2>/dev/null || true
            echo "  WARNING: failed to install $dst — leaving $src in place" >&2
        fi
    else
        rm -f "$tmp" 2>/dev/null || true
        echo "  WARNING: failed to copy $src — leaving original in place" >&2
    fi
    return 0
}

# --- Cleanup Legacy Scripts --------------------------------------------------

# Removes scripts, units, and libraries that no longer exist in the source tree.
# Prevents stale handlers from running after features are removed.
cleanup_legacy_scripts() {
    step "Cleaning up legacy scripts"

    local removed=0

    # /usr/bin/qmanager_* — remove if not in source (scripts/usr/bin/) AND not bundled in dependencies/
    for installed in "$BIN_DIR"/qmanager_*; do
        [ -f "$installed" ] || continue
        fname=$(basename "$installed")
        if [ ! -f "$SRC_SCRIPTS/usr/bin/$fname" ] && [ ! -f "$SRC_DEPS/$fname" ]; then
            rm -f "$installed"
            rm -f "$WANTS_DIR/${fname}.service"
            _log_raw "Removed legacy: $fname"
            info "Removed legacy: $fname"
            removed=$(( removed + 1 ))
        fi
    done

    # /lib/systemd/system/qmanager-*.service — remove if not in source
    for installed in "$SYSTEMD_DIR"/qmanager-*.service; do
        [ -f "$installed" ] || continue
        fname=$(basename "$installed")
        if [ ! -f "$SRC_SCRIPTS/etc/systemd/system/$fname" ]; then
            rm -f "$installed"
            rm -f "$WANTS_DIR/$fname"
            _log_raw "Removed legacy: $fname"
            info "Removed legacy: $fname"
            removed=$(( removed + 1 ))
        fi
    done

    # /usr/lib/qmanager/*.sh — remove if not in source
    for installed in "$LIB_DIR"/*.sh; do
        [ -f "$installed" ] || continue
        fname=$(basename "$installed")
        if [ ! -f "$SRC_SCRIPTS/usr/lib/qmanager/$fname" ]; then
            rm -f "$installed"
            _log_raw "Removed legacy: $fname"
            info "Removed legacy: $fname"
            removed=$(( removed + 1 ))
        fi
    done

    if [ "$removed" -eq 0 ]; then
        info "No legacy scripts to remove"
    else
        info "Removed $removed legacy file(s)"
    fi
}

# --- Install udev Rules ------------------------------------------------------

# scrub_vendor_smd11_rules: remove third-party smd11 entries from vendor udev files.
#
# Background: rgmii-toolkit and various community fixes (e.g. 1alessandro1's
# upstream advice) edit Quectel's /etc/udev/rules.d/data_udev_rules.rules and
# /etc/udev/scripts/data_udev_script.sh to chown /dev/smd11 to www-data:www-data.
# Vanilla Quectel firmware does NOT claim smd11 (confirmed on RM520N-GL —
# vendor's data_udev_rules.rules only lists smd7..smd10), so any smd11 entry
# we find is from a previous third-party install and will race our own rule.
#
# Removing them eliminates the race so our 99-qmanager-smd11.rules is the sole
# writer of /dev/smd11 permissions. A one-time backup (.qmanager.bak) is kept
# per file so a curious operator can restore the original.
scrub_vendor_smd11_rules() {
    local vendor_rules="/etc/udev/rules.d/data_udev_rules.rules"
    local vendor_script="/etc/udev/scripts/data_udev_script.sh"
    local scrubbed=0

    if [ -f "$vendor_rules" ] && grep -q 'KERNEL=="smd11"' "$vendor_rules" 2>/dev/null; then
        [ -f "$vendor_rules.qmanager.bak" ] || cp "$vendor_rules" "$vendor_rules.qmanager.bak"
        sed -i '/KERNEL=="smd11"/d' "$vendor_rules"
        info "Removed competing smd11 rule from $vendor_rules (backup: .qmanager.bak)"
        scrubbed=1
    fi

    if [ -f "$vendor_script" ] && grep -qE '^[[:space:]]*smd11\)' "$vendor_script" 2>/dev/null; then
        [ -f "$vendor_script.qmanager.bak" ] || cp "$vendor_script" "$vendor_script.qmanager.bak"
        # Delete the smd11) case in two passes for safety:
        #   Pass 1 — one-liner form:  "    smd11) cmd ;;"
        #            Match the whole line at once.
        #   Pass 2 — multi-line form: "smd11)" alone, then body, then "    ;;" alone.
        #            End anchor requires a line whose ENTIRE non-whitespace content
        #            is ";;", so any nested "case ... ;;" inside the block can't
        #            close the range early and over-delete (defensive — vanilla
        #            Quectel scripts and the known third-party edits don't nest,
        #            but this future-proofs us).
        sed -i '/^[[:space:]]*smd11)[^)]*;;[[:space:]]*$/d' "$vendor_script"
        sed -i '/^[[:space:]]*smd11)[[:space:]]*$/,/^[[:space:]]*;;[[:space:]]*$/d' "$vendor_script"
        info "Removed competing smd11 case from $vendor_script (backup: .qmanager.bak)"
        scrubbed=1
    fi

    if [ "$scrubbed" -eq 1 ]; then
        sync
        command -v udevadm >/dev/null 2>&1 && udevadm control --reload-rules 2>/dev/null || true
    fi
    return 0
}

install_udev_rules() {
    step "Installing udev rules for /dev/smd11"

    local rule_src="$SRC_SCRIPTS/etc/udev/rules.d/99-qmanager-smd11.rules"
    local rule_dst="/etc/udev/rules.d/99-qmanager-smd11.rules"
    local helper_src="$SRC_SCRIPTS/etc/udev/scripts/qmanager_smd11_udev.sh"
    local helper_dst="/usr/lib/qmanager/qmanager_smd11_udev.sh"

    if [ ! -f "$rule_src" ] || [ ! -f "$helper_src" ]; then
        warn "udev rule sources missing — skipping (smd11 perms rely on qmanager-setup oneshot)"
        return 0
    fi

    # Remount rootfs rw — /usr/lib lives on the read-only root (ubi0). NOT /etc:
    # that is a bind mount of ubi2_0 and is always rw, so this call does nothing
    # for the /etc/udev write below. Left rw afterwards, per the tree-wide
    # "remount rw once, never restore ro" convention. See docs/BACKEND.md.
    mount -o remount,rw / 2>/dev/null || true

    mkdir -p /etc/udev/rules.d
    # 0755 explicitly — see the SECURITY note in install_backend(); root helpers
    # source libs from here, so this dir must never be world-writable no matter
    # which of the two creation sites happens to run first.
    install -d -o root -g root -m 0755 /usr/lib/qmanager

    # Strip any third-party smd11 entries from vendor files first, so our rule
    # is the only one firing on smd11 add events (no race for ownership).
    scrub_vendor_smd11_rules

    # helper lives outside install_backend's LIB_DIR glob to preserve 755
    install_file "$helper_src" "$helper_dst" 755 \
        || die "Failed to install udev helper"
    chown root:root "$helper_dst"
    info "Helper installed: $helper_dst"

    install_file "$rule_src" "$rule_dst" 644 \
        || die "Failed to install udev rule"
    chown root:root "$rule_dst"
    info "Rule installed: $rule_dst"

    sync

    # Reload rules and trigger an add event on smd11 so the rule fires now
    # (rather than waiting for the next reboot or modem reset).
    if command -v udevadm >/dev/null 2>&1; then
        if udevadm control --reload-rules 2>/dev/null; then
            if [ -c /dev/smd11 ]; then
                udevadm trigger --action=add /dev/smd11 2>/dev/null || true
                udevadm settle --timeout=5 2>/dev/null || true
                # Verify the rule actually applied
                local mode owner
                mode=$(stat -c '%a' /dev/smd11 2>/dev/null)
                owner=$(stat -c '%U:%G' /dev/smd11 2>/dev/null)
                if [ "$mode" = "660" ] && [ "$owner" = "root:dialout" ]; then
                    info "Rule applied: /dev/smd11 = $owner $mode"
                else
                    warn "Rule did not apply cleanly: /dev/smd11 = $owner $mode (expected root:dialout 660)"
                fi
            else
                info "/dev/smd11 not present yet — rule will fire when modem creates it"
            fi
        else
            warn "udevadm reload failed — rule will activate at next reboot"
        fi
    else
        warn "udevadm not found — rule will activate at next reboot"
    fi
}

# --- Enable Services ---------------------------------------------------------

enable_services() {
    step "Enabling systemd services"

    # Ensure rootfs is writable for symlink creation
    mount -o remount,rw / 2>/dev/null || true

    # SimpleAdmin's proven pattern: symlink each service directly into
    # multi-user.target.wants. No intermediate target — RM520N-GL's minimal
    # systemd handles direct wants reliably.
    mkdir -p "$WANTS_DIR"

    # Remove old target-based setup from previous installs
    rm -f "$WANTS_DIR/qmanager.target"
    rm -rf /etc/systemd/system/qmanager.target.wants

    # Ensure lighttpd is enabled for boot
    if [ -f "$SYSTEMD_DIR/lighttpd.service" ]; then
        ln -sf "$SYSTEMD_DIR/lighttpd.service" "$WANTS_DIR/lighttpd.service"
        info "Enabled lighttpd"
    fi

    # Ensure opt.mount is properly enabled. It is written with
    # WantedBy=multi-user.target but was never symlinked into wants/, so /opt
    # ended up mounted by start-opt-mount.service's `systemctl start opt.mount`
    # wrapper instead — a oneshot that self-deadlocks on systemd's job queue
    # and burns ~3.7s before /opt appears, which is what ate the margin behind
    # the lighttpd boot race (see neutralize_entware_lighttpd). The [ -f ]
    # guard is required: opt.mount is only written in the bootstrap branch, so
    # a device that already had Entware before QManager never gets the file
    # and the symlink would dangle. start-opt-mount.service is intentionally
    # left in place as a fallback — do not remove it.
    if [ -f "$SYSTEMD_DIR/opt.mount" ]; then
        ln -sf "$SYSTEMD_DIR/opt.mount" "$WANTS_DIR/opt.mount"
        info "Enabled opt.mount"
    fi

    # Capture pre-install symlink state for gated services so we can restore
    # the same enabled/disabled state rather than force-enabling them.
    local gated_was_enabled=""
    for svc in $UCI_GATED_SERVICES; do
        if [ -L "$WANTS_DIR/${svc}.service" ]; then
            gated_was_enabled="$gated_was_enabled $svc"
        fi
    done

    # Scan all installed qmanager units and enable/skip based on gating
    for unit in "$SYSTEMD_DIR"/qmanager-*.service; do
        [ -f "$unit" ] || continue
        svc=$(basename "$unit" .service)

        # qmanager-auto-update.service has no [Install] section — it is
        # started only by qmanager-auto-update.timer, never boot-enabled
        # directly. Symlinking it here would run it at every boot in
        # addition to the timer schedule, which is not the intent.
        [ "$svc" = "qmanager-auto-update" ] && continue

        # qmanager-scenario-schedule.service is the same shape: no [Install]
        # section, started only by qmanager-scenario-schedule.timer. Unlike
        # the auto-update timer, that .timer is never shipped by the
        # installer at all — it is generated and armed at runtime by the
        # qmanager_scenario_schedule_arm root helper when a profile with an
        # enabled scenario schedule becomes active, so there is nothing to
        # gate here beyond skipping the boot-symlink for the .service itself.
        [ "$svc" = "qmanager-scenario-schedule" ] && continue

        # qmanager-scheduled-reboot.service / qmanager-tower-schedule-apply.service /
        # qmanager-tower-schedule-clear.service are the same shape: no
        # [Install] section, started only by their runtime-armed .timer
        # counterparts (see the re-arm step below, after this loop). Nothing
        # to gate here beyond skipping the boot-symlink for the .service
        # files themselves.
        [ "$svc" = "qmanager-scheduled-reboot" ] && continue
        [ "$svc" = "qmanager-tower-schedule-apply" ] && continue
        [ "$svc" = "qmanager-tower-schedule-clear" ] && continue

        # Check if this service is in the gated list
        local is_gated=0
        for g in $UCI_GATED_SERVICES; do
            if [ "$svc" = "$g" ]; then
                is_gated=1
                break
            fi
        done

        if [ "$is_gated" = "1" ]; then
            # Only re-enable if it was already enabled before this run
            local was_on=0
            for w in $gated_was_enabled; do
                if [ "$w" = "$svc" ]; then
                    was_on=1
                    break
                fi
            done
            if [ "$was_on" = "1" ]; then
                ln -sf "$unit" "$WANTS_DIR/${svc}.service"
                info "Re-enabled $svc (was previously enabled)"
            else
                info "Skipped $svc (enable manually if needed)"
            fi
        else
            ln -sf "$unit" "$WANTS_DIR/${svc}.service"
            info "Enabled $svc"
        fi
    done

    # --- Auto-update timer (config-gated, NOT symlink-state-gated) ------------
    # Timers enable via timers.target.wants, not multi-user.target.wants, so
    # this can't share the .service loop above. Unlike the UCI_GATED_SERVICES
    # services above, this is NOT "restore whatever symlink state existed
    # before this run" — timers are new this release, so a user who already
    # opted in via the existing System Settings → Software Update toggle has
    # update.auto_update_enabled=1 in config but NO pre-existing timer
    # symlink. Gating on symlink presence would silently ignore that opt-in;
    # gating on the config key the UI already writes does not.
    mkdir -p "$TIMERS_WANTS_DIR"
    command -v qm_config_get >/dev/null 2>&1 || . "$LIB_DIR/config.sh"

    if [ -f "$SYSTEMD_DIR/qmanager-auto-update.timer" ]; then
        _auto_update_enabled=$(qm_config_get update auto_update_enabled 0 2>/dev/null) || _auto_update_enabled=0
        if [ "$_auto_update_enabled" = "1" ]; then
            ln -sf "$SYSTEMD_DIR/qmanager-auto-update.timer" "$TIMERS_WANTS_DIR/qmanager-auto-update.timer"
            info "Auto-update timer enabled (update.auto_update_enabled=1)"
        else
            # rm -f (not just "skip") so a later opt-OUT is honored on re-run/OTA
            rm -f "$TIMERS_WANTS_DIR/qmanager-auto-update.timer"
            info "Auto-update timer not enabled (opt in via System Settings → Software Update)"
        fi
    fi

    # --- Traffic Engine ensure timer (unconditionally armed, payload self-gates)
    # The qmanager-dpi-ensure.timer re-asserts the REDIRECT rule every 60s
    # (QCMAP flushes iptables on re-dial). Unlike auto-update there is no
    # config to gate on: the oneshot payload (qmanager_dpi_run --ensure)
    # self-gates — it exits 0 doing nothing when the engine is disabled. So
    # the timer is always armed here, unconditionally (additive ln -sf only).
    if [ -f "$SYSTEMD_DIR/qmanager-dpi-ensure.timer" ]; then
        ln -sf "$SYSTEMD_DIR/qmanager-dpi-ensure.timer" "$TIMERS_WANTS_DIR/qmanager-dpi-ensure.timer"
        info "Traffic Engine ensure timer enabled"
    fi

    # --- Scheduled Reboot / Tower Lock schedule timers (config-driven re-arm) --
    # Unlike qmanager-scenario-schedule (armed only when a profile activates
    # it), Scheduled Reboot and the Tower Lock schedule are NOT
    # symlink-state-gated either — they are config-driven, same as
    # auto-update above, and re-armed HERE unconditionally so the generated
    # .timer + timers.target.wants symlink survive an OTA partition swap.
    # /etc/qmanager survives OTA (persistent UBIFS partition); /lib does not
    # — a fresh install_rm520n.sh run (fresh install OR OTA, both reach this
    # function since DO_BACKEND/DO_ENABLE default on and OTA never passes
    # --backend-only or --no-enable) always regenerates both timers from
    # whatever is currently saved in config, so a device that had Scheduled
    # Reboot or Tower Lock schedule armed before the update still has it
    # armed after. Calling the arm helpers DIRECTLY (not via sudo -n) because
    # this installer already runs as root — mirrors scenario_mgr.sh's
    # scenario_install_schedule "already root" branch.
    if [ -x "$BIN_DIR/qmanager_scheduled_reboot_arm" ]; then
        _sched_enabled=$(qm_config_get settings sched_reboot_enabled 0 2>/dev/null) || _sched_enabled=0
        if [ "$_sched_enabled" = "1" ]; then
            _sched_time=$(qm_config_get settings sched_reboot_time "04:00" 2>/dev/null) || _sched_time="04:00"
            _sched_days=$(qm_config_get settings sched_reboot_days "0,1,2,3,4,5,6" 2>/dev/null) || _sched_days="0,1,2,3,4,5,6"
            "$BIN_DIR/qmanager_scheduled_reboot_arm" install "$_sched_time" "$_sched_days" >/dev/null 2>&1 \
                && info "Scheduled reboot timer re-armed (${_sched_time}, days=${_sched_days})" \
                || warn "Scheduled reboot timer re-arm failed (non-fatal)"
        else
            "$BIN_DIR/qmanager_scheduled_reboot_arm" teardown >/dev/null 2>&1 || true
        fi
    fi

    if [ -x "$BIN_DIR/qmanager_tower_schedule_arm" ] && [ -f /etc/qmanager/tower_lock.json ]; then
        _tower_enabled=$(jq -r '.schedule.enabled // false' /etc/qmanager/tower_lock.json 2>/dev/null) || _tower_enabled=false
        if [ "$_tower_enabled" = "true" ]; then
            _tower_start=$(jq -r '.schedule.start_time // "08:00"' /etc/qmanager/tower_lock.json 2>/dev/null) || _tower_start="08:00"
            _tower_end=$(jq -r '.schedule.end_time // "22:00"' /etc/qmanager/tower_lock.json 2>/dev/null) || _tower_end="22:00"
            _tower_days=$(jq -r '.schedule.days // [1,2,3,4,5] | join(",")' /etc/qmanager/tower_lock.json 2>/dev/null) || _tower_days="1,2,3,4,5"
            "$BIN_DIR/qmanager_tower_schedule_arm" install "$_tower_start" "$_tower_end" "$_tower_days" >/dev/null 2>&1 \
                && info "Tower lock schedule timers re-armed (apply ${_tower_start}, clear ${_tower_end}, days=${_tower_days})" \
                || warn "Tower lock schedule timer re-arm failed (non-fatal)"
        else
            "$BIN_DIR/qmanager_tower_schedule_arm" teardown >/dev/null 2>&1 || true
        fi
    fi

    # --- Discord bot (gated on binary + config + enabled flag) ----------------
    if [ -x "$BIN_DIR/qmanager_discord" ] && [ -f /etc/qmanager/discord_bot.json ]; then
        enabled=$(jq -r '.enabled // false' /etc/qmanager/discord_bot.json 2>/dev/null) || enabled=false
        if [ "$enabled" = "true" ]; then
            ln -sf "$SYSTEMD_DIR/qmanager-discord.service" "$WANTS_DIR/qmanager-discord.service"
            info "Discord bot service enabled"
        fi
    fi

    # --- Watchcat / Tower Failover / SMS Forward (config-gated self-heal) -----
    # Same shape as the Discord block above, extended to the other three
    # UCI_GATED_SERVICES. Those three are restored ONLY from pre-install
    # symlink state (the loop above) — a device that lost its
    # multi-user.target.wants symlink to a transient EROFS window (see
    # svc_enable) has configured intent that the symlink-restore loop can
    # never see, so it stays disabled forever across every future OTA. This
    # pass re-derives "should be enabled" from the same config each service's
    # own CGI already treats as authoritative, and is ADDITIVE ONLY: it only
    # ever ln -sf's a service ON. It never rm -f's one, so it can't undo what
    # the symlink-restore loop just did — repair upward only, matching the
    # brief's "never silently turn a working feature off."
    #
    # watchcat: /etc/qmanager/qmanager.conf is JSON despite the .conf name;
    # qm_config_get already degrades to the given default on a missing/
    # unparseable file (jq failure -> empty val -> default), so no separate
    # [ -f ... ] guard is needed here — mirrors the auto-update timer block.
    if [ -x "$BIN_DIR/qmanager_watchcat" ]; then
        _watchcat_enabled=$(qm_config_get watchcat enabled 0 2>/dev/null) || _watchcat_enabled=0
        if [ "$_watchcat_enabled" = "1" ]; then
            ln -sf "$SYSTEMD_DIR/qmanager-watchcat.service" "$WANTS_DIR/qmanager-watchcat.service"
            info "Watchdog service enabled (watchcat.enabled=1)"
        fi
    fi

    # tower-failover: /etc/qmanager/tower_lock.json, .failover.enabled (bool).
    # Same jq -r '... // false' pattern the tower schedule re-arm above and
    # tower/status.sh both already use for this exact file.
    if [ -x "$BIN_DIR/qmanager_tower_failover" ] && [ -f /etc/qmanager/tower_lock.json ]; then
        _failover_enabled=$(jq -r '.failover.enabled // false' /etc/qmanager/tower_lock.json 2>/dev/null) || _failover_enabled=false
        if [ "$_failover_enabled" = "true" ]; then
            ln -sf "$SYSTEMD_DIR/qmanager-tower-failover.service" "$WANTS_DIR/qmanager-tower-failover.service"
            info "Tower failover service enabled (failover.enabled=true)"
        fi
    fi

    # sms-forward: /etc/qmanager/sms_forwarding.json, .enabled (bool). Lazy-
    # created by cellular/sms_forwarding.sh's own tmp+mv on first save — there
    # is no installer seed, so a fresh/never-configured device simply has no
    # file here. The [ -f ... ] guard treats that as "not enabled" without
    # invoking jq on a nonexistent path.
    if [ -x "$BIN_DIR/qmanager_sms_forward" ] && [ -f /etc/qmanager/sms_forwarding.json ]; then
        _smsfwd_enabled=$(jq -r '.enabled // false' /etc/qmanager/sms_forwarding.json 2>/dev/null) || _smsfwd_enabled=false
        if [ "$_smsfwd_enabled" = "true" ]; then
            ln -sf "$SYSTEMD_DIR/qmanager-sms-forward.service" "$WANTS_DIR/qmanager-sms-forward.service"
            info "SMS forwarding service enabled (sms_forwarding.enabled=true)"
        fi
    fi

    sync
    systemctl daemon-reload 2>/dev/null || warn "daemon-reload failed (transient?) — continuing"
}

# --- Start Services ----------------------------------------------------------

start_services() {
    step "Starting QManager services"

    # AT device permissions — www-data (dialout group) needs read/write on /dev/smd11
    if [ -e /dev/smd11 ]; then
        chown root:dialout /dev/smd11
        chmod 660 /dev/smd11
        info "Set /dev/smd11 permissions for dialout group"
    fi

    # Start firewall before lighttpd (protects web UI before accepting connections)
    systemctl start qmanager-firewall 2>/dev/null || true

    # Restart lighttpd to pick up new config
    systemctl restart lighttpd 2>/dev/null || warn "Could not restart lighttpd"
    info "lighttpd restarted with QManager config"

    # Run setup oneshot (creates lock files, session dirs, permissions).
    #
    # `restart`, not `start`, as defence-in-depth. qmanager-setup.service is
    # Type=oneshot with RemainAfterExit=yes, so systemd holds it `active` after
    # ExecStart exits (that latch is what keeps Before=qmanager-poller.service
    # satisfiable), and `systemctl start` on an ALREADY-active unit is a no-op
    # that returns success without re-running ExecStart.
    #
    # That no-op does NOT bite today: stop_services() above batches a stop over
    # every /lib/systemd/system/qmanager-*.service except watchcat, which
    # includes this unit and releases the latch — so `start` did re-run it. The
    # correctness of the /tmp ownership seed in qmanager_setup therefore rests
    # on an exclusion list in a different function. `restart` makes it rest on
    # nothing: it is identical to `start` on an inactive or not-yet-loaded unit,
    # and still re-runs ExecStart if that stop is ever narrowed, reordered, or
    # silently fails. Cheap insurance on a step whose failure mode is invisible
    # (files keep last boot's ownership; cross-UID writes fail silently).
    #
    # Safe to restart mid-install: qmanager_setup is idempotent by design, and
    # chown/chmod mutate the existing inode in place rather than replacing it,
    # so a flock held on /tmp/qmanager_at.lock (tied to the open file
    # description, not the mode bits) and any open fd both survive untouched.
    systemctl restart qmanager-setup 2>/dev/null || true

    # Start always-on services with verification
    for svc in qmanager-cfun-fix qmanager-ping qmanager-poller qmanager-ttl qmanager-mtu qmanager-imei-check; do
        systemctl start "$svc" 2>/dev/null || true
    done

    # Start Discord bot if binary present, config exists, and enabled flag is true
    if [ -x "$BIN_DIR/qmanager_discord" ] && [ -f /etc/qmanager/discord_bot.json ]; then
        # `|| _dc_enabled=false` is load-bearing: this file runs under `set -e`,
        # so a corrupt discord_bot.json makes jq exit non-zero and aborts the
        # installer HERE — mid-OTA, with services already stopped. Matches the
        # guarded read in the enable block above.
        _dc_enabled=$(jq -r '.enabled // false' /etc/qmanager/discord_bot.json 2>/dev/null) || _dc_enabled=false
        if [ "$_dc_enabled" = "true" ]; then
            systemctl start qmanager-discord 2>/dev/null || warn "Could not start qmanager-discord"
            info "Discord bot started"
        fi
    fi
    sleep 2

    # Start Traffic Engine ensure timer (armed; payload self-gates on config).
    # The engine itself starts from its own config gate below (or on next
    # boot via the unit glob in enable_services).
    systemctl start qmanager-dpi-ensure.timer 2>/dev/null || true

    # Start Traffic Engine if enabled and the binary is provisioned. Mirrors
    # the Discord bot start guard: binary present AND config enabled. A
    # missing binary is non-fatal — the engine shows "stopped" in the UI
    # until the user runs the on-demand install.
    if [ -x "$BIN_DIR/qmanager_dpi_run" ]; then
        command -v qm_config_get >/dev/null 2>&1 || . "$LIB_DIR/config.sh"
        _dpi_enabled=$(qm_config_get video_optimizer enabled 0 2>/dev/null) || _dpi_enabled=0
        if [ "$_dpi_enabled" = "1" ] && [ -x /usrdata/qmanager/bin/tpws ]; then
            systemctl start qmanager-dpi 2>/dev/null || warn "Could not start qmanager-dpi"
        fi
    fi

    # Download ttyd for web console (non-fatal — console is optional)
    if [ ! -x /usrdata/qmanager/console/ttyd ]; then
        info "Downloading ttyd for web console..."
        /usr/bin/qmanager_console_mgr install 2>/dev/null || warn "ttyd download failed — web console unavailable"
    fi

    # Verify critical services
    local svc_errors=0
    for svc in qmanager-firewall lighttpd qmanager-setup qmanager-ping qmanager-poller; do
        if systemctl is-active "$svc" >/dev/null 2>&1; then
            info "$svc is running"
        else
            warn "$svc is NOT running — check: journalctl -u $svc"
            svc_errors=$((svc_errors + 1))
        fi
    done

    # Verify AT device access
    if [ -x "$BIN_DIR/atcli_smd11" ] && [ -e /dev/smd11 ]; then
        if qm_timeout 3 "$BIN_DIR/atcli_smd11" "AT" >/dev/null 2>&1; then
            info "AT device responds (atcli_smd11 → /dev/smd11)"
        else
            warn "AT device not responding — modem may not be ready yet"
        fi
    fi

    if [ "$svc_errors" -gt 0 ]; then
        warn "$svc_errors service(s) failed to start"
    fi
}

# --- Health Check ------------------------------------------------------------

# Polls for a live qmanager_poller PID and its status cache (warn-only).
health_check() {
    local deadline=$(( $(date +%s) + 10 ))
    local ok=0
    while [ "$(date +%s)" -lt "$deadline" ]; do
        if pgrep -x qmanager_poller >/dev/null 2>&1 && \
           [ -f /tmp/qmanager_status.json ]; then
            ok=1
            break
        fi
        sleep 1
    done
    if [ "$ok" = "1" ]; then
        info "health_check: poller running and status cache present"
    else
        warn "health_check: poller not ready within 10s — check: journalctl -u qmanager-poller"
    fi
}

# --- AT Stack Check ----------------------------------------------------------

# Sends a test AT command through qcmd. Warn-only so a cold modem doesn't
# block a successful install from being reported.
at_stack_check() {
    local ok=0
    local i=1
    while [ "$i" -le 3 ]; do
        if command -v qcmd >/dev/null 2>&1; then
            local out
            out=$(qm_timeout 8 qcmd 'ATI' 2>/dev/null) || true
            if printf '%s' "$out" | grep -q '^OK'; then
                ok=1
                break
            fi
        fi
        i=$(( i + 1 ))
        sleep 2
    done
    if [ "$ok" = "1" ]; then
        info "at_stack_check: AT stack responding"
    else
        warn "at_stack_check: no OK from ATI after 3 attempts"
        warn "  Troubleshooting: check /dev/smd11 permissions (should be root:dialout 660)"
        warn "  and verify atcli_smd11 is executable: $BIN_DIR/atcli_smd11"
    fi
}

# --- Early SSH Bootstrap (fresh installs only) -------------------------------
# Runs once, right after install_dependencies (so Entware/dropbear are available)
# and before the rest of the install. On fresh installs with no existing SSH,
# installs dropbear, writes a systemd unit, starts it, and sets root's password
# to "qmanager" so the user can SSH in immediately. Web-UI onboarding overwrites
# this temporary password later.
#
# Skips entirely on OTA upgrades (VERSION file present) or when port 22 is
# already in use by another SSH server.

setup_ssh_early() {
    step "Bootstrap SSH (fresh install)"

    # 1. Fresh-install gate. /etc/qmanager/VERSION only exists from a prior
    #    successful install. VERSION.pending (written by preflight) is ignored
    #    on purpose — that's the in-flight marker, not the prior-install marker.
    if [ -f "$CONF_DIR/VERSION" ]; then
        SSH_BOOTSTRAP_STATUS="skipped_ota"
        info "OTA upgrade detected — skipping SSH bootstrap"
        return 0
    fi

    # 2. Port-22 safety check. If anything is already listening, leave it alone.
    if command -v ss >/dev/null 2>&1; then
        if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE '(^|:)22$'; then
            SSH_BOOTSTRAP_STATUS="skipped_existing"
            info "SSH already running on port 22 — skipping bootstrap"
            return 0
        fi
    elif command -v netstat >/dev/null 2>&1; then
        if netstat -ltn 2>/dev/null | awk '{print $4}' | grep -qE '(^|:)22$'; then
            SSH_BOOTSTRAP_STATUS="skipped_existing"
            info "SSH already running on port 22 — skipping bootstrap"
            return 0
        fi
    fi
    if pidof dropbear >/dev/null 2>&1 || pidof sshd >/dev/null 2>&1; then
        SSH_BOOTSTRAP_STATUS="skipped_existing"
        info "SSH daemon already running — skipping bootstrap"
        return 0
    fi

    # 3. Ensure dropbear is installed. install_dependencies already does this on
    #    a fresh install, so this is normally a no-op fallback. We still try the
    #    bundled .ipk first, then Entware, in case install_dependencies failed
    #    on dropbear specifically.
    if ! command -v dropbear >/dev/null 2>&1; then
        if [ -x "$OPKG" ]; then
            if ls "$SRC_DEPS"/dropbear*.ipk >/dev/null 2>&1; then
                "$OPKG" install "$SRC_DEPS"/dropbear*.ipk >/dev/null 2>&1 \
                    && info "dropbear installed from bundled package" \
                    || { warn "dropbear install failed (bundled .ipk)"; SSH_BOOTSTRAP_STATUS="failed_install"; return 0; }
            else
                "$OPKG" install dropbear >/dev/null 2>&1 \
                    && info "dropbear installed from Entware" \
                    || { warn "dropbear install failed (Entware)"; SSH_BOOTSTRAP_STATUS="failed_install"; return 0; }
            fi
        else
            warn "Cannot install dropbear — opkg not available"
            SSH_BOOTSTRAP_STATUS="failed_install"
            return 0
        fi
    else
        info "dropbear already installed"
    fi

    # 4. Write the systemd unit. opkg's post-install hook generates RSA/ECDSA/
    #    ED25519 host keys in /opt/etc/dropbear/, which persists via the
    #    /usrdata/opt bind mount. dropbear finds them automatically.
    if [ ! -f "$SYSTEMD_DIR/dropbear.service" ]; then
        mount -o remount,rw / 2>/dev/null || true
        cat > "$SYSTEMD_DIR/dropbear.service" << 'SSHEOF'
[Unit]
Description=Dropbear SSH Server
After=network.target

[Service]
Type=simple
ExecStart=/opt/sbin/dropbear -F -E -p 22
Restart=on-failure

[Install]
WantedBy=multi-user.target
SSHEOF
        sync
        info "Created dropbear.service"
    fi

    # systemctl enable does not work on RM520N-GL — direct symlink instead.
    ln -sf "$SYSTEMD_DIR/dropbear.service" "$WANTS_DIR/dropbear.service"
    systemctl daemon-reload 2>/dev/null || true

    # 5. Start dropbear and verify it's active.
    systemctl start dropbear 2>/dev/null || true
    sleep 1
    if ! systemctl is-active dropbear >/dev/null 2>&1; then
        warn "dropbear failed to start — check: journalctl -u dropbear"
        SSH_BOOTSTRAP_STATUS="failed_start"
        return 0
    fi
    info "dropbear started on port 22"

    # 6. Set root's password to "qmanager" inline. The qmanager_set_ssh_password
    #    helper isn't installed at this point in the install (backend hasn't run),
    #    so we replicate its core logic here. Onboarding will overwrite the
    #    password on first web login.
    local _password="qmanager"
    local _salt _hash _escaped_hash
    _salt=$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')
    _hash=$(printf '%s\n' "$_password" | openssl passwd -1 -salt "$_salt" -stdin 2>/dev/null)

    if [ -z "$_hash" ]; then
        warn "openssl passwd failed — root password not set"
        SSH_BOOTSTRAP_STATUS="failed_password"
        return 0
    fi

    if [ ! -f /etc/shadow ]; then
        warn "/etc/shadow not found — root password not set"
        SSH_BOOTSTRAP_STATUS="failed_password"
        return 0
    fi

    mount -o remount,rw / 2>/dev/null || true

    # Escape sed-special chars in the hash. Using | as the sed delimiter so /
    # in the hash isn't a problem; only &, \, and | need escaping.
    _escaped_hash=$(printf '%s' "$_hash" | sed 's/[&\\|]/\\&/g')

    # Match locked (root:!:...), passwordless (root::...), or any-existing-hash forms.
    if ! sed -i "s|^root:[^:]*:|root:${_escaped_hash}:|" /etc/shadow 2>/dev/null; then
        warn "Failed to update /etc/shadow"
        SSH_BOOTSTRAP_STATUS="failed_password"
        return 0
    fi
    sync

    SSH_BOOTSTRAP_STATUS="installed"
    info "Root password set to 'qmanager' (will be replaced on web onboarding)"
}

# --- Summary -----------------------------------------------------------------

print_summary() {
    printf "\n"
    printf "  ══════════════════════════════════════════\n"
    printf "  ${GREEN}${BOLD}  QManager — Installation Complete${NC}\n"
    printf "  ${DIM}  RM520N-GL Edition${NC}\n"
    printf "  ══════════════════════════════════════════\n\n"

    printf "  ${DIM}Frontend:  ${NC}%s\n" "$WWW_ROOT"
    printf "  ${DIM}CGI:       ${NC}%s\n" "$CGI_DIR"
    printf "  ${DIM}Libraries: ${NC}%s\n" "$LIB_DIR"
    printf "  ${DIM}Daemons:   ${NC}%s/qmanager_*\n" "$BIN_DIR"
    printf "  ${DIM}Systemd:   ${NC}%s/qmanager-*\n" "$SYSTEMD_DIR"
    printf "  ${DIM}Config:    ${NC}%s\n" "$CONF_DIR"
    printf "  ${DIM}Certs:     ${NC}%s\n" "$CERT_DIR"
    printf "  ${DIM}Log:       ${NC}%s\n" "$LOG_FILE"

    printf "\n"
    printf "  Open in browser:  ${BOLD}https://192.168.225.1${NC}\n"
    printf "  Web console:      ${BOLD}https://192.168.225.1/console${NC}\n"

    case "$SSH_BOOTSTRAP_STATUS" in
        installed)
            printf "  SSH:              ${BOLD}ssh root@192.168.225.1${NC} ${DIM}(temp password: qmanager — replaced on web onboarding)${NC}\n"
            ;;
        failed_install|failed_start|failed_password)
            printf "  ${YELLOW}SSH bootstrap failed${NC} (${SSH_BOOTSTRAP_STATUS}). Re-run installer or set up dropbear manually.\n"
            ;;
        skipped_ota|skipped_existing|not_run)
            : # no SSH line — avoid noise on upgrades or pre-existing setups
            ;;
    esac
    printf "\n"

    if [ ! -f "$CONF_DIR/auth.json" ]; then
        info "First-time setup: you will be prompted to create a password"
    fi
    printf "\n"
}

# --- Usage -------------------------------------------------------------------

usage() {
    printf "QManager Installer (RM520N-GL) v%s\n\n" "$VERSION"
    printf "Usage: bash install_rm520n.sh [OPTIONS]\n\n"
    printf "Options:\n"
    printf "  --frontend-only    Only install frontend files\n"
    printf "  --backend-only     Only install backend scripts\n"
    printf "  --no-enable        Don't enable systemd services\n"
    printf "  --no-start         Don't start services after install\n"
    printf "  --skip-packages    Skip dependency installation\n"
    printf "  --no-reboot        Don't reboot after installation\n"
    printf "  --force            Skip modem firmware detection in preflight\n"
    printf "  --help             Show this help\n\n"
}

# --- Main --------------------------------------------------------------------

main() {
    DO_FRONTEND=1; DO_BACKEND=1; DO_ENABLE=1; DO_START=1
    DO_PACKAGES=1; DO_REBOOT=1; DO_FORCE=0

    while [ $# -gt 0 ]; do
        case "$1" in
            --frontend-only) DO_FRONTEND=1; DO_BACKEND=0 ;;
            --backend-only)  DO_FRONTEND=0; DO_BACKEND=1 ;;
            --no-enable)     DO_ENABLE=0 ;;
            --no-start)      DO_START=0 ;;
            --skip-packages) DO_PACKAGES=0 ;;
            --no-reboot)     DO_REBOOT=0 ;;
            --force)         DO_FORCE=1 ;;
            --help|-h)       usage; exit 0 ;;
            *) error "Unknown option: $1"; usage; exit 1 ;;
        esac
        shift
    done

    # Watchcat lock cleanup on any exit — prevents Tier-4 reboot if installer aborts
    trap 'rm -f "$WATCHCAT_LOCK"' EXIT INT TERM

    log_init

    printf "\n"
    printf "  ══════════════════════════════════════════\n"
    printf "  ${BOLD}  QManager — RM520N-GL Installer${NC}\n"
    printf "  ${DIM}  Version: %s${NC}\n" "$VERSION"
    printf "  ══════════════════════════════════════════\n"

    # Calculate steps: preflight always runs; others are conditional
    TOTAL_STEPS=5  # preflight + install_bundled_binaries + setup_ssh_early + stop_services + cleanup_legacy_scripts
    [ "$DO_PACKAGES" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))
    [ "$DO_FRONTEND" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 2 ))  # backup + frontend
    [ "$DO_BACKEND" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 2 ))   # backend + udev
    [ "$DO_BACKEND" = "1" ] && [ "$DO_ENABLE" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))
    [ "$DO_START" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))

    preflight

    # remove_conflicts runs even with --skip-packages (e.g. socat-at-bridge
    # must be gone before atcli_smd11 can open /dev/smd11)
    remove_conflicts

    # ensure_zoneinfo_packages runs even with --skip-packages — OTA upgrades
    # pass that flag, so gating this behind install_dependencies() would leave
    # the timezone-apply fix silently broken for every in-app-updated device.
    ensure_zoneinfo_packages

    # install_bundled_binaries runs even with --skip-packages — see its
    # doc-comment above for why (SMS OTA-upgrade bug root cause).
    install_bundled_binaries

    # install_speedtest_cli runs even with --skip-packages — see its
    # doc-comment above for why (permanently-dead-Speedtest bug on any device
    # whose install-time download failed).
    install_speedtest_cli

    [ "$DO_PACKAGES" = "1" ] && install_dependencies

    # neutralize_entware_lighttpd runs unconditionally (even with
    # --skip-packages, mirroring remove_conflicts/ensure_zoneinfo_packages
    # above) so the OTA path (qmanager_update calls this installer with
    # --force --skip-packages --no-reboot) also disables S80lighttpd on
    # already-installed devices, not just fresh installs. It must also run
    # AFTER install_dependencies: that step's `opkg upgrade/install lighttpd`
    # re-extracts S80lighttpd with its executable bit restored, which would
    # silently undo an earlier disable in the same run.
    neutralize_entware_lighttpd

    # Same unconditional placement, and for the same OTA-reach reason. Runs
    # after install_dependencies so the units already exist by the time it
    # chmods them on a fresh install.
    harden_entware_unit_modes

    # SSH bootstrap runs after install_dependencies so Entware + bundled
    # dropbear .ipk are available, and before stop_services so it never has
    # to wait on QManager service teardown.
    setup_ssh_early

    stop_services

    # F22 — relocate the auth-backup store out of the www-data-owned
    # /etc/qmanager. Placement here is load-bearing in two ways, both of which
    # a natural filing alongside the other migrations in install_backend()
    # would get wrong; see the function's ORDERING note:
    #   - BEFORE backup_originals, which creates the store, takes the fresh
    #     snapshot AND prunes to the newest 5 in one call. Migrating after
    #     that leaves up to 10 files with no prune pass until the next OTA.
    #   - OUTSIDE the DO_FRONTEND gate below, so a --backend-only run migrates
    #     too. Otherwise the password snapshots stay in the swept directory on
    #     exactly the devices someone is repairing.
    migrate_backup_location

    if [ "$DO_FRONTEND" = "1" ]; then
        backup_originals
        install_frontend
    fi

    if [ "$DO_BACKEND" = "1" ]; then
        install_backend
        cleanup_legacy_scripts
        install_udev_rules
        [ "$DO_ENABLE" = "1" ] && enable_services
    fi

    [ "$DO_START" = "1" ] && start_services

    [ "$DO_START" = "1" ] && health_check
    [ "$DO_START" = "1" ] && at_stack_check

    print_summary

    finalize_version

    # Staging-dir cleanup is intentionally NOT done here. On the OTA path the
    # worker (qmanager_update) cd's into /tmp/qmanager_install before invoking
    # us and owns the `rm -rf /tmp/qmanager_install` afterward. If the installer
    # deleted it here it would (a) race that owner and (b) yank the CWD out from
    # under whoever is sitting inside it — the OTA worker, or a human who ran
    # `cd /tmp/qmanager_install && sh install_rm520n.sh` — producing
    # `getcwd: No such file or directory` and a `(unknown)#` prompt. /tmp is
    # tmpfs, so any leftover staging is cleared on the next reboot regardless.

    if [ "$DO_REBOOT" = "1" ]; then
        printf "  Rebooting in 5 seconds — press Ctrl+C to cancel...\n\n"
        sync
        sleep 5
        reboot
    fi
}

main "$@"
