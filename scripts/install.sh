#!/bin/sh
# =============================================================================
# QManager Installation Script
# =============================================================================
# Installs QManager frontend and backend onto an OpenWRT device.
#
# Expected archive layout (tar.gz extracted to /tmp/qmanager_install/):
#   out/                    — Next.js static export (frontend)
#   scripts/                — Backend shell scripts
#     etc/init.d/           — Init.d service scripts
#     usr/bin/              — Daemons and utilities
#     usr/lib/qmanager/     — Shared shell libraries
#     www/cgi-bin/          — CGI API endpoints
#   install.sh              — This script
#
# Usage:
#   1. Transfer qmanager.tar.gz to /tmp/ on the device
#   2. cd /tmp && tar xzf qmanager.tar.gz
#   3. cd /tmp/qmanager_install && sh install.sh
#
# Flags:
#   --frontend-only    Only install frontend files
#   --backend-only     Only install backend scripts
#   --no-enable        Don't enable init.d services
#   --no-start         Don't start services after install
#   --skip-packages    Skip opkg package installation
#   --uninstall        Remove QManager completely
#   --help             Show this help
#
# =============================================================================

set -e

# --- Configuration -----------------------------------------------------------

VERSION="0.1.0-beta.1"
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"

# Destinations
WWW_ROOT="/www"
CGI_DIR="/www/cgi-bin/quecmanager"
LIB_DIR="/usr/lib/qmanager"
BIN_DIR="/usr/bin"
INITD_DIR="/etc/init.d"
CONF_DIR="/etc/qmanager"
SESSION_DIR="/tmp/qmanager_sessions"
BACKUP_DIR="/etc/qmanager/backups"

# Source directories (relative to INSTALL_DIR)
SRC_FRONTEND="$INSTALL_DIR/out"
SRC_SCRIPTS="$INSTALL_DIR/scripts"

# Required packages
REQUIRED_PACKAGES="jq"
# Optional packages (installed if available, non-fatal if missing)
OPTIONAL_PACKAGES="msmtp tailscale ethtool"

# --- Colors & Icons ----------------------------------------------------------

if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    DIM='\033[2m'
    NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' BLUE='' CYAN='' BOLD='' DIM='' NC=''
fi

ICO_OK='✓'
ICO_WARN='⚠'
ICO_ERR='✗'
ICO_STEP='▶'

# --- Progress Tracking -------------------------------------------------------

# TOTAL_STEPS is calculated dynamically in main() based on active flags.
# Each function that calls step() counts as one step.
TOTAL_STEPS=9
CURRENT_STEP=0

# --- Helper Functions --------------------------------------------------------

info()  { printf "    ${GREEN}${ICO_OK}${NC}  %s\n" "$1"; }
warn()  { printf "    ${YELLOW}${ICO_WARN}${NC}  %s\n" "$1"; }
error() { printf "    ${RED}${ICO_ERR}${NC}  %s\n" "$1"; }

die() {
    error "$1"
    exit 1
}

# Count files in a directory (POSIX-safe)
count_files() {
    find "$1" -type f 2>/dev/null | wc -l | tr -d ' '
}

# Draw a Unicode block progress bar.
# Args: current, total, [width=20]
_draw_bar() {
    local curr="$1" tot="$2" w="${3:-20}"
    local fill=$(( curr * w / tot ))
    local bar="" i=0
    while [ "$i" -lt "$w" ]; do
        if [ "$i" -lt "$fill" ]; then
            bar="${bar}█"
        else
            bar="${bar}░"
        fi
        i=$(( i + 1 ))
    done
    printf "%s" "$bar"
}

# Print a step header with progress bar.
step() {
    CURRENT_STEP=$(( CURRENT_STEP + 1 ))
    local pct=$(( CURRENT_STEP * 100 / TOTAL_STEPS ))
    printf "\n"
    if [ -t 1 ]; then
        printf "  ${DIM}[%s  %3d%%  Step %d/%d]${NC}\n" \
            "$(_draw_bar "$CURRENT_STEP" "$TOTAL_STEPS")" \
            "$pct" "$CURRENT_STEP" "$TOTAL_STEPS"
    fi
    printf "  ${BLUE}${BOLD}${ICO_STEP}${NC}${BOLD} %s${NC}\n" "$1"
}

# Run a command with a rotating spinner (TTY only).
# Usage: run_with_spinner "label" cmd [args...]
run_with_spinner() {
    local label="$1"; shift
    local i=0 rc=0 f

    # No spinner when not a TTY — just run silently
    if [ ! -t 1 ]; then
        "$@" >/dev/null 2>&1 || rc=$?
        return "$rc"
    fi

    "$@" >/tmp/qm_spin_out 2>&1 &
    local cpid=$!

    while kill -0 "$cpid" 2>/dev/null; do
        case $(( i % 3 )) in
            0) f='|' ;; 1) f='/' ;; *) f='-' ;;
        esac
        printf "\r    ${CYAN}%s${NC}  %s " "$f" "$label"
        i=$(( i + 1 ))
        sleep 1
    done

    wait "$cpid"
    rc=$?
    printf "\r\033[2K"
    rm -f /tmp/qm_spin_out
    return "$rc"
}

# --- Pre-flight Checks -------------------------------------------------------

preflight() {
    step "Running pre-flight checks"

    # Must run as root
    if [ "$(id -u)" -ne 0 ]; then
        die "This script must be run as root"
    fi

    # Check we're on OpenWRT
    if [ ! -f /etc/openwrt_release ]; then
        warn "Cannot detect OpenWRT — proceeding anyway"
    else
        local distro
        distro=$(. /etc/openwrt_release && echo "$DISTRIB_DESCRIPTION")
        info "Detected: $distro"
    fi

    # Check source directories exist
    if [ "$DO_FRONTEND" = "1" ] && [ ! -d "$SRC_FRONTEND" ]; then
        die "Frontend source not found at $SRC_FRONTEND"
    fi

    if [ "$DO_BACKEND" = "1" ] && [ ! -d "$SRC_SCRIPTS" ]; then
        die "Backend scripts not found at $SRC_SCRIPTS"
    fi

    info "Pre-flight checks passed"
}

# --- Install Required Packages -----------------------------------------------

install_packages() {
    step "Installing required packages"

    if run_with_spinner "Updating package lists" opkg update; then
        info "Package lists updated"
    else
        warn "opkg update failed — will try installing from cache"
    fi

    # Install required packages (fatal if missing)
    for pkg in $REQUIRED_PACKAGES; do
        if command -v "$pkg" >/dev/null 2>&1; then
            info "$pkg is already installed"
        else
            if run_with_spinner "Installing $pkg" opkg install "$pkg"; then
                info "$pkg installed successfully"
            else
                die "Failed to install required package: $pkg"
            fi
        fi
    done

    # Install optional packages (non-fatal)
    for pkg in $OPTIONAL_PACKAGES; do
        if command -v "$pkg" >/dev/null 2>&1; then
            info "$pkg is already installed"
        else
            if run_with_spinner "Installing $pkg (optional)" opkg install "$pkg"; then
                info "$pkg installed successfully"
            else
                warn "$pkg not available — feature will be disabled"
                warn "  Install later with: opkg install $pkg"
            fi
        fi
    done
}

# --- Stop Running Services ---------------------------------------------------

stop_services() {
    step "Stopping QManager services"

    # Stop main service (poller + ping + watchcat)
    if [ -x "$INITD_DIR/qmanager" ]; then
        "$INITD_DIR/qmanager" stop 2>/dev/null || true
        info "Stopped qmanager (poller, ping, watchcat)"
    fi

    # Stop auxiliary services
    for svc in qmanager_eth_link qmanager_mtu qmanager_imei_check \
               qmanager_wan_guard qmanager_tower_failover qmanager_ttl \
               qmanager_low_power_check; do
        if [ -x "$INITD_DIR/$svc" ]; then
            "$INITD_DIR/$svc" stop 2>/dev/null || true
        fi
    done

    # Kill any lingering qmanager processes
    for proc in qmanager_poller qmanager_ping qmanager_watchcat \
                qmanager_band_failover qmanager_tower_failover \
                qmanager_tower_schedule qmanager_cell_scanner \
                qmanager_neighbour_scanner qmanager_mtu_apply \
                qmanager_profile_apply qmanager_imei_check \
                qmanager_wan_guard qmanager_low_power \
                qmanager_low_power_check qmanager_scheduled_reboot; do
        killall "$proc" 2>/dev/null || true
    done

    sleep 1
    info "All services stopped"
}

# --- Backup Original Files ---------------------------------------------------

backup_originals() {
    step "Backing up original files"

    mkdir -p "$BACKUP_DIR"

    local ts
    ts=$(date +%Y%m%d_%H%M%S)

    # Backup original index.html (the OpenWRT/LuCI default page)
    if [ -f "$WWW_ROOT/index.html" ]; then
        # Only backup if it's NOT already a QManager index.html
        # (avoid backing up our own file on upgrades)
        if ! grep -q "QManager" "$WWW_ROOT/index.html" 2>/dev/null; then
            cp "$WWW_ROOT/index.html" "$BACKUP_DIR/index.html.orig.$ts"
            info "Backed up original index.html → $BACKUP_DIR/index.html.orig.$ts"
        else
            info "Existing index.html is already QManager — skipping backup"
        fi

        # Always keep a single .orig if we don't have one yet
        if [ ! -f "$BACKUP_DIR/index.html.orig" ]; then
            cp "$WWW_ROOT/index.html" "$BACKUP_DIR/index.html.orig"
            info "Saved pristine backup as $BACKUP_DIR/index.html.orig"
        fi
    else
        info "No existing index.html to backup"
    fi

    # Backup existing QManager config if upgrading
    if [ -f "$CONF_DIR/shadow" ]; then
        cp "$CONF_DIR/shadow" "$BACKUP_DIR/shadow.$ts" 2>/dev/null || true
        info "Backed up password hash"
    fi

    info "Backups stored in $BACKUP_DIR"
}

# --- Install Frontend --------------------------------------------------------

install_frontend() {
    step "Installing frontend"

    local file_count
    file_count=$(count_files "$SRC_FRONTEND")
    info "Deploying $file_count frontend files"

    # Remove old QManager frontend directories (keep cgi-bin/ and non-QM files)
    for dir in _next dashboard cellular monitoring local-network \
               login about-device support system-settings; do
        rm -rf "$WWW_ROOT/$dir"
    done

    # Remove old QManager root HTML files
    rm -f "$WWW_ROOT/index.html"
    rm -f "$WWW_ROOT/404.html"
    rm -f "$WWW_ROOT/favicon.ico"

    # Copy new frontend
    cp -r "$SRC_FRONTEND"/* "$WWW_ROOT/"

    info "Frontend installed ($file_count files)"
}

# --- Install Backend ---------------------------------------------------------

install_backend() {
    step "Installing backend scripts"

    # --- Shared libraries ---
    info "Installing shared libraries to $LIB_DIR"
    mkdir -p "$LIB_DIR"

    if [ -d "$SRC_SCRIPTS/usr/lib/qmanager" ]; then
        cp "$SRC_SCRIPTS/usr/lib/qmanager"/* "$LIB_DIR/"
        chmod 644 "$LIB_DIR"/*.sh
        local lib_count
        lib_count=$(count_files "$LIB_DIR")
        info "  $lib_count library files installed"
    fi

    # --- Daemons and utilities ---
    info "Installing daemons to $BIN_DIR"

    local fname bin_count=0
    if [ -d "$SRC_SCRIPTS/usr/bin" ]; then
        for f in "$SRC_SCRIPTS/usr/bin"/*; do
            [ -f "$f" ] || continue
            fname=$(basename "$f")
            cp "$f" "$BIN_DIR/$fname"
            chmod +x "$BIN_DIR/$fname"
            bin_count=$(( bin_count + 1 ))
        done
        info "  $bin_count daemon/utility files installed"
    fi

    # --- CGI endpoints ---
    info "Installing CGI endpoints to $CGI_DIR"

    if [ -d "$SRC_SCRIPTS/www/cgi-bin/quecmanager" ]; then
        # Recreate CGI directory structure
        rm -rf "$CGI_DIR"
        mkdir -p "$CGI_DIR"
        cp -r "$SRC_SCRIPTS/www/cgi-bin/quecmanager"/* "$CGI_DIR/"

        # Make all .sh files executable
        find "$CGI_DIR" -name "*.sh" -exec chmod +x {} \;

        # JSON data files should be readable
        find "$CGI_DIR" -name "*.json" -exec chmod 644 {} \;

        local cgi_count
        cgi_count=$(find "$CGI_DIR" -name "*.sh" -type f | wc -l | tr -d ' ')
        info "  $cgi_count CGI scripts installed"
    fi

    # --- Init.d services ---
    info "Installing init.d services to $INITD_DIR"

    local initd_count=0
    if [ -d "$SRC_SCRIPTS/etc/init.d" ]; then
        for f in "$SRC_SCRIPTS/etc/init.d"/*; do
            [ -f "$f" ] || continue
            fname=$(basename "$f")
            cp "$f" "$INITD_DIR/$fname"
            chmod +x "$INITD_DIR/$fname"
            initd_count=$(( initd_count + 1 ))
        done
        info "  $initd_count init.d scripts installed"
    fi

    # --- Create required directories ---
    mkdir -p "$CONF_DIR/profiles"
    mkdir -p "$SESSION_DIR"
    mkdir -p /var/lock

    info "Backend installed"
}

# --- Fix Line Endings --------------------------------------------------------

fix_line_endings() {
    step "Fixing line endings (CRLF → LF)"

    local tmplist=/tmp/qm_fixed_list
    local scanlist=/tmp/qm_scan_list
    local fixed=0
    rm -f "$tmplist" "$scanlist"

    for dir in "$LIB_DIR" "$BIN_DIR" "$INITD_DIR" "$CGI_DIR"; do
        [ -d "$dir" ] || continue
        find "$dir" -type f \( -name "*.sh" -o -name "qmanager*" -o -name "qcmd" \) \
            > "$scanlist"
        while IFS= read -r f; do
            # grep for literal CR byte — portable, no 'file' command needed
            if grep -ql "$(printf '\r')" "$f" 2>/dev/null; then
                sed -i 's/\r$//' "$f"
                echo "$f" >> "$tmplist"
            fi
        done < "$scanlist"
    done

    rm -f "$scanlist"
    [ -f "$tmplist" ] && fixed=$(wc -l < "$tmplist" | tr -d ' ')
    rm -f "$tmplist"

    if [ "$fixed" -gt 0 ]; then
        warn "Fixed $fixed files with CRLF line endings"
    else
        info "All files already have correct LF line endings"
    fi
}

# --- Enable Services ---------------------------------------------------------

enable_services() {
    step "Enabling init.d services"

    # Main service (poller + ping + watchcat)
    if [ -x "$INITD_DIR/qmanager" ]; then
        "$INITD_DIR/qmanager" enable
        info "Enabled qmanager (main service)"
    fi

    # Auxiliary services
    for svc in qmanager_eth_link qmanager_ttl qmanager_mtu \
               qmanager_wan_guard qmanager_imei_check; do
        if [ -x "$INITD_DIR/$svc" ]; then
            "$INITD_DIR/$svc" enable
            info "Enabled $svc"
        fi
    done

    # Tower failover — only enable if previously enabled
    if [ -x "$INITD_DIR/qmanager_tower_failover" ]; then
        local was_enabled=0
        # Check if it was already enabled (symlink exists in /etc/rc.d/)
        for _rc in /etc/rc.d/*qmanager_tower_failover*; do
            [ -e "$_rc" ] && was_enabled=1 && break
        done
        if [ "$was_enabled" = "1" ]; then
            "$INITD_DIR/qmanager_tower_failover" enable
            info "Enabled qmanager_tower_failover (was previously enabled)"
        else
            info "Skipped qmanager_tower_failover (enable manually if needed)"
        fi
    fi
}

# --- Start Services ----------------------------------------------------------

start_services() {
    step "Starting QManager services"

    if [ -x "$INITD_DIR/qmanager" ]; then
        "$INITD_DIR/qmanager" start
        info "Started qmanager (poller + ping)"
    fi

    # Give poller a moment to initialize
    sleep 2

    # Verify poller is running
    local poller_pid ping_pid
    poller_pid=$(pidof qmanager_poller 2>/dev/null || true)
    ping_pid=$(pidof qmanager_ping 2>/dev/null || true)

    if [ -n "$poller_pid" ]; then
        info "Poller is running (PID: $poller_pid)"
    else
        warn "Poller does not appear to be running — check /tmp/qmanager.log"
    fi

    if [ -n "$ping_pid" ]; then
        info "Ping daemon is running (PID: $ping_pid)"
    else
        warn "Ping daemon does not appear to be running"
    fi
}

# --- Uninstall (via --uninstall flag) ----------------------------------------
# For a richer uninstall experience use the standalone uninstall.sh script.

uninstall() {
    step "Uninstalling QManager"

    # Stop services (inline — stop_services() also calls step(), so we inline here)
    info "Stopping services"
    if [ -x "$INITD_DIR/qmanager" ]; then
        "$INITD_DIR/qmanager" stop 2>/dev/null || true
    fi
    for svc in qmanager_eth_link qmanager_mtu qmanager_imei_check \
               qmanager_wan_guard qmanager_tower_failover qmanager_ttl \
               qmanager_low_power_check; do
        if [ -x "$INITD_DIR/$svc" ]; then
            "$INITD_DIR/$svc" stop 2>/dev/null || true
        fi
    done
    for proc in qmanager_poller qmanager_ping qmanager_watchcat \
                qmanager_band_failover qmanager_tower_failover \
                qmanager_tower_schedule qmanager_cell_scanner \
                qmanager_neighbour_scanner qmanager_mtu_apply \
                qmanager_profile_apply qmanager_imei_check \
                qmanager_wan_guard qmanager_low_power \
                qmanager_low_power_check qmanager_scheduled_reboot; do
        killall "$proc" 2>/dev/null || true
    done
    sleep 1
    info "All services stopped"

    # Disable and remove init.d services
    for svc in qmanager qmanager_eth_link qmanager_ttl qmanager_mtu \
               qmanager_wan_guard qmanager_imei_check qmanager_tower_failover \
               qmanager_low_power_check; do
        if [ -x "$INITD_DIR/$svc" ]; then
            "$INITD_DIR/$svc" disable 2>/dev/null || true
            rm -f "$INITD_DIR/$svc"
        fi
    done
    info "Removed init.d services"

    # Remove daemons
    rm -f "$BIN_DIR/qcmd"
    rm -f "$BIN_DIR"/qmanager_*
    info "Removed daemons from $BIN_DIR"

    # Remove libraries
    rm -rf "$LIB_DIR"
    info "Removed $LIB_DIR"

    # Remove CGI endpoints
    rm -rf "$CGI_DIR"
    info "Removed $CGI_DIR"

    # Remove UCI config
    if uci -q get quecmanager >/dev/null 2>&1; then
        uci -q delete quecmanager 2>/dev/null || true
        uci commit 2>/dev/null || true
        info "Removed UCI config"
    fi

    # Remove frontend and restore original index.html
    for dir in _next dashboard cellular monitoring local-network \
               login about-device support system-settings; do
        rm -rf "$WWW_ROOT/$dir"
    done
    rm -f "$WWW_ROOT/index.html" "$WWW_ROOT/404.html" "$WWW_ROOT/favicon.ico"

    if [ -f "$BACKUP_DIR/index.html.orig" ]; then
        cp "$BACKUP_DIR/index.html.orig" "$WWW_ROOT/index.html"
        info "Restored original index.html from backup"
    fi
    info "Removed frontend files"

    # Remove runtime state
    rm -f /tmp/qmanager_*.json /tmp/qmanager.log* 2>/dev/null || true
    rm -rf "$SESSION_DIR"
    info "Removed runtime state from /tmp"

    # Ask about config
    if [ -d "$CONF_DIR" ]; then
        printf "\n"
        warn "Configuration directory $CONF_DIR still exists."
        warn "It contains: password, profiles, tower/band lock configs, IMEI backup, backups."
        printf "  Remove it? [y/N] "
        read -r answer
        case "$answer" in
            y|Y|yes|YES)
                rm -rf "$CONF_DIR"
                info "Removed $CONF_DIR"
                ;;
            *)
                info "Kept $CONF_DIR (configs preserved for reinstall)"
                ;;
        esac
    fi

    printf "\n"
    info "QManager has been uninstalled"
}

# --- Version Check -----------------------------------------------------------

check_existing() {
    # Try to detect existing installation
    if [ -f "$LIB_DIR/cgi_base.sh" ]; then
        info "Existing installation detected — will upgrade in place"
        info "Configuration in $CONF_DIR will be preserved"
    else
        info "Fresh installation"
    fi
}

# --- Summary -----------------------------------------------------------------

print_summary() {
    printf "\n"
    if [ -t 1 ]; then
        printf "  [%s  100%%  Complete]\n" \
            "$(_draw_bar "$TOTAL_STEPS" "$TOTAL_STEPS")"
    fi
    printf "\n"
    printf "  ╔══════════════════════════════════════╗\n"
    printf "  ║  %-34s  ║\n" "QManager v$VERSION — Installed!"
    printf "  ╚══════════════════════════════════════╝\n\n"

    if [ "$DO_FRONTEND" = "1" ]; then
        printf "  ${DIM}Frontend:  ${NC}%s\n" "$WWW_ROOT"
    fi
    if [ "$DO_BACKEND" = "1" ]; then
        printf "  ${DIM}CGI:       ${NC}%s\n" "$CGI_DIR"
        printf "  ${DIM}Libraries: ${NC}%s\n" "$LIB_DIR"
        printf "  ${DIM}Daemons:   ${NC}%s/qmanager_*\n" "$BIN_DIR"
        printf "  ${DIM}Init.d:    ${NC}%s/qmanager*\n" "$INITD_DIR"
        printf "  ${DIM}Config:    ${NC}%s\n" "$CONF_DIR"
        printf "  ${DIM}Backups:   ${NC}%s\n" "$BACKUP_DIR"
        printf "  ${DIM}Logs:      ${NC}/tmp/qmanager.log\n"
        printf "  ${DIM}Status:    ${NC}/tmp/qmanager_status.json\n"
    fi

    printf "\n"
    printf "  ${DIM}Packages:${NC}\n"
    for pkg in $REQUIRED_PACKAGES $OPTIONAL_PACKAGES; do
        if command -v "$pkg" >/dev/null 2>&1; then
            printf "    ${GREEN}${ICO_OK}${NC}  %-12s installed\n" "$pkg"
        else
            printf "    ${YELLOW}${ICO_WARN}${NC}  %-12s missing\n" "$pkg"
        fi
    done

    printf "\n"

    # Detect device IP
    local device_ip
    device_ip=$(uci get network.lan.ipaddr 2>/dev/null || echo "192.168.1.1")
    printf "  Open in browser:  ${BOLD}http://%s${NC}\n\n" "$device_ip"

    if [ ! -f "$CONF_DIR/shadow" ]; then
        info "First-time setup: you will be prompted to create a password"
    fi

    if [ -f "$BACKUP_DIR/index.html.orig" ]; then
        info "Original index.html backed up to $BACKUP_DIR/index.html.orig"
        info "  Restore with: cp $BACKUP_DIR/index.html.orig $WWW_ROOT/index.html"
    fi

    printf "\n"
}

# --- Usage -------------------------------------------------------------------

usage() {
    printf "QManager Installer v%s\n\n" "$VERSION"
    printf "Usage: sh install.sh [OPTIONS]\n\n"
    printf "Options:\n"
    printf "  --frontend-only    Only install frontend files\n"
    printf "  --backend-only     Only install backend scripts\n"
    printf "  --no-enable        Don't enable init.d services\n"
    printf "  --no-start         Don't start services after install\n"
    printf "  --skip-packages    Skip opkg package installation\n"
    printf "  --uninstall        Remove QManager completely\n"
    printf "  --help             Show this help\n\n"
    printf "Expected archive layout:\n"
    printf "  qmanager_install/\n"
    printf "    ├── install.sh        (this script)\n"
    printf "    ├── out/              (frontend build)\n"
    printf "    └── scripts/          (backend scripts)\n\n"
    printf "Example:\n"
    printf "  cd /tmp && tar xzf qmanager.tar.gz\n"
    printf "  cd qmanager_install && sh install.sh\n\n"
    printf "For a standalone uninstall: sh uninstall.sh --help\n\n"
}

# --- Main --------------------------------------------------------------------

main() {
    # Defaults
    DO_FRONTEND=1
    DO_BACKEND=1
    DO_ENABLE=1
    DO_START=1
    DO_UNINSTALL=0
    DO_PACKAGES=1

    # Parse arguments
    while [ $# -gt 0 ]; do
        case "$1" in
            --frontend-only)
                DO_FRONTEND=1
                DO_BACKEND=0
                ;;
            --backend-only)
                DO_FRONTEND=0
                DO_BACKEND=1
                ;;
            --no-enable)
                DO_ENABLE=0
                ;;
            --no-start)
                DO_START=0
                ;;
            --skip-packages)
                DO_PACKAGES=0
                ;;
            --uninstall)
                DO_UNINSTALL=1
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
        shift
    done

    # Header banner
    printf "\n"
    printf "  ╔══════════════════════════════════════╗\n"
    printf "  ║  ${BOLD}%-34s${NC}  ║\n" "QManager · Installation Script"
    printf "  ╠══════════════════════════════════════╣\n"
    printf "  ║  ${DIM}%-34s${NC}  ║\n" "Version: v$VERSION"
    printf "  ╚══════════════════════════════════════╝\n"

    # Handle uninstall path (2 steps: preflight + uninstall)
    if [ "$DO_UNINSTALL" = "1" ]; then
        TOTAL_STEPS=2
        preflight
        uninstall
        exit 0
    fi

    # Calculate total steps for the selected install mode
    TOTAL_STEPS=1                                    # preflight always
    [ "$DO_PACKAGES" = "1" ]  && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))  # install_packages
    TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))               # stop_services always
    if [ "$DO_FRONTEND" = "1" ]; then
        TOTAL_STEPS=$(( TOTAL_STEPS + 2 ))           # backup_originals + install_frontend
    fi
    if [ "$DO_BACKEND" = "1" ]; then
        TOTAL_STEPS=$(( TOTAL_STEPS + 2 ))           # install_backend + fix_line_endings
        [ "$DO_ENABLE" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))  # enable_services
        [ "$DO_START"  = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))  # start_services
    fi

    # Normal install flow
    preflight
    check_existing

    if [ "$DO_PACKAGES" = "1" ]; then
        install_packages
    fi

    stop_services

    if [ "$DO_FRONTEND" = "1" ]; then
        backup_originals
        install_frontend
    fi

    if [ "$DO_BACKEND" = "1" ]; then
        install_backend
        fix_line_endings

        if [ "$DO_ENABLE" = "1" ]; then
            enable_services
        fi
    fi

    if [ "$DO_START" = "1" ] && [ "$DO_BACKEND" = "1" ]; then
        start_services
    fi

    print_summary
}

main "$@"
