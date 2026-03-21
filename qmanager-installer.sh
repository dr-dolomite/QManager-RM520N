#!/bin/sh
# ==============================================================================
# QManager — Installer for OpenWRT
# Quectel Modem Manager
# https://github.com/dr-dolomite/QManager
#
# Usage:
#   wget -O /tmp/qmanager-installer.sh \
#     https://github.com/dr-dolomite/QManager/raw/refs/heads/development-home/qmanager-installer.sh
#   sh /tmp/qmanager-installer.sh
#
# Environment variables:
#   QMANAGER_VERSION  Release tag to download (default: latest)
#
# ==============================================================================

# --- Configuration -----------------------------------------------------------

GITHUB_REPO="dr-dolomite/QManager"
QMANAGER_VERSION="${QMANAGER_VERSION:-latest}"

if [ "$QMANAGER_VERSION" = "latest" ]; then
    DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/latest/download/qmanager.tar.gz"
else
    DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/download/${QMANAGER_VERSION}/qmanager.tar.gz"
fi

ARCHIVE_PATH="/tmp/qmanager.tar.gz"
EXTRACT_DIR="/tmp/qmanager_install"

# Device paths (must match install.sh / uninstall.sh)
WWW_ROOT="/www"
CGI_DIR="/www/cgi-bin/quecmanager"
LIB_DIR="/usr/lib/qmanager"
BIN_DIR="/usr/bin"
INITD_DIR="/etc/init.d"
CONF_DIR="/etc/qmanager"
BACKUP_DIR="/etc/qmanager/backups"
SESSION_DIR="/tmp/qmanager_sessions"

# --- Colors & Formatting -----------------------------------------------------

if [ -t 1 ]; then
    BOLD='\033[1m'
    DIM='\033[2m'
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    CYAN='\033[0;36m'
    NC='\033[0m'
else
    BOLD='' DIM='' RED='' GREEN='' YELLOW='' CYAN='' NC=''
fi

# --- Helpers -----------------------------------------------------------------

info()  { printf "  ${GREEN}*${NC}  %s\n" "$1"; }
warn()  { printf "  ${YELLOW}!${NC}  %s\n" "$1"; }
err()   { printf "  ${RED}x${NC}  %s\n" "$1"; }
step()  { printf "\n  ${CYAN}>${NC}  ${BOLD}%s${NC}\n" "$1"; }

die() {
    err "$1"
    exit 1
}

# --- Checks ------------------------------------------------------------------

check_root() {
    [ "$(id -u)" -eq 0 ] || die "This script must be run as root"
}

check_openwrt() {
    [ -f /etc/openwrt_release ] || die "OpenWRT not detected (/etc/openwrt_release missing)"
}

is_installed() {
    [ -d "$LIB_DIR" ] || [ -f "$INITD_DIR/qmanager" ] || [ -d "$CGI_DIR" ]
}

# --- Download Helper ---------------------------------------------------------

download_archive() {
    local url="$1" dest="$2"

    # uclient-fetch — native OpenWRT HTTPS downloader
    if command -v uclient-fetch >/dev/null 2>&1; then
        info "Using uclient-fetch..."
        uclient-fetch -q -O "$dest" "$url" 2>/dev/null && return 0
    fi

    # wget (BusyBox or full)
    if command -v wget >/dev/null 2>&1; then
        info "Using wget..."
        wget -q -O "$dest" "$url" 2>/dev/null && return 0
    fi

    # curl (if installed)
    if command -v curl >/dev/null 2>&1; then
        info "Using curl..."
        curl -fsSL -o "$dest" "$url" 2>/dev/null && return 0
    fi

    return 1
}

# ==============================================================================
# Option 1 — Install
# ==============================================================================

do_install() {
    check_root
    check_openwrt

    printf "\n"
    if is_installed; then
        warn "QManager is already installed. This will upgrade it."
        printf "\n  Continue? [y/N] "
        read -r ans
        case "$ans" in y|Y|yes|YES) ;; *) printf "\n  Aborted.\n\n"; return ;; esac
    fi

    # Download
    step "Downloading QManager..."
    printf "     %s\n" "$DOWNLOAD_URL"

    rm -f "$ARCHIVE_PATH"
    if ! download_archive "$DOWNLOAD_URL" "$ARCHIVE_PATH"; then
        printf "\n"
        die "Download failed. Ensure HTTPS is available (opkg install wget-ssl)"
    fi
    [ -f "$ARCHIVE_PATH" ] || die "Download failed — archive not found"

    local size
    size=$(du -k "$ARCHIVE_PATH" 2>/dev/null | awk '{print $1 "K"}')
    info "Downloaded qmanager.tar.gz ($size)"

    # Extract
    step "Extracting archive..."
    rm -rf "$EXTRACT_DIR"
    tar xzf "$ARCHIVE_PATH" -C /tmp/ 2>/dev/null || die "Extraction failed — archive may be corrupt"
    [ -d "$EXTRACT_DIR" ] || die "Extraction failed — $EXTRACT_DIR not found"
    info "Extracted to $EXTRACT_DIR"

    # Run install.sh from the archive
    step "Running QManager installer..."
    printf "\n"
    if [ -f "$EXTRACT_DIR/install.sh" ]; then
        chmod +x "$EXTRACT_DIR/install.sh"
        sh "$EXTRACT_DIR/install.sh"
    else
        die "install.sh not found inside archive"
    fi

    # Cleanup
    step "Cleaning up..."
    rm -f "$ARCHIVE_PATH"
    rm -rf "$EXTRACT_DIR"
    info "Temporary files removed"

    # Show version info
    if [ "$QMANAGER_VERSION" = "latest" ]; then
        info "Installed from latest release"
    else
        info "Installed from release $QMANAGER_VERSION"
    fi
}

# ==============================================================================
# Option 2 — Uninstall
# ==============================================================================

do_uninstall() {
    check_root
    check_openwrt

    printf "\n"
    if ! is_installed; then
        warn "QManager does not appear to be installed."
        printf "\n  Continue anyway? [y/N] "
        read -r ans
        case "$ans" in y|Y|yes|YES) ;; *) printf "\n  Aborted.\n\n"; return ;; esac
    fi

    # Confirmation
    printf "\n"
    printf "  ${YELLOW}${BOLD}This will permanently remove QManager from your device.${NC}\n\n"
    printf "  The following will be removed:\n\n"
    printf "     - Frontend files in %s/\n" "$WWW_ROOT"
    printf "     - CGI endpoints in %s/\n" "$CGI_DIR"
    printf "     - Libraries in %s/\n" "$LIB_DIR"
    printf "     - Daemons: %s/qcmd, %s/qmanager_*\n" "$BIN_DIR" "$BIN_DIR"
    printf "     - Init.d services in %s/\n" "$INITD_DIR"
    printf "     - Runtime state in /tmp/\n"
    printf "     - UCI config (quecmanager.*)\n"
    printf "     - Firewall rules (/etc/firewall.user.ttl, .mtu)\n"
    printf "\n"
    printf "  Type ${BOLD}yes${NC} to confirm: "
    read -r confirm
    case "$confirm" in
        yes|YES) ;;
        *) printf "\n  Aborted — nothing was removed.\n\n"; return ;;
    esac

    # Ask about config directory
    KEEP_CONFIG=1
    if [ -d "$CONF_DIR" ]; then
        printf "\n  Keep configuration files (%s/)? [Y/n] " "$CONF_DIR"
        read -r ans
        case "$ans" in n|N|no|NO) KEEP_CONFIG=0 ;; esac
    fi

    printf "\n"

    # --- 1. Stop services ---
    step "Stopping services..."
    if [ -x "$INITD_DIR/qmanager" ]; then
        "$INITD_DIR/qmanager" stop 2>/dev/null || true
    fi
    for svc in qmanager_eth_link qmanager_mtu qmanager_imei_check \
               qmanager_wan_guard qmanager_tower_failover qmanager_ttl \
               qmanager_low_power_check; do
        [ -x "$INITD_DIR/$svc" ] && "$INITD_DIR/$svc" stop 2>/dev/null || true
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

    # --- 2. Disable & remove init.d scripts ---
    step "Removing init.d services..."
    for svc in qmanager qmanager_eth_link qmanager_ttl qmanager_mtu \
               qmanager_wan_guard qmanager_imei_check \
               qmanager_tower_failover qmanager_low_power_check \
               qmanager_watchcat; do
        if [ -f "$INITD_DIR/$svc" ]; then
            "$INITD_DIR/$svc" disable 2>/dev/null || true
            rm -f "$INITD_DIR/$svc"
        fi
    done
    # Clean up rc.d symlinks
    for _link in /etc/rc.d/*qmanager*; do
        [ -e "$_link" ] && rm -f "$_link" 2>/dev/null || true
    done
    info "Init.d services removed"

    # --- 3. Remove backend ---
    step "Removing backend files..."
    rm -f "$BIN_DIR/qcmd"
    for f in "$BIN_DIR"/qmanager_*; do
        [ -f "$f" ] && rm -f "$f"
    done
    rm -rf "$LIB_DIR"
    rm -rf "$CGI_DIR"
    info "Binaries, libraries, and CGI endpoints removed"

    # --- 4. Remove frontend ---
    step "Removing frontend files..."
    for dir in _next dashboard cellular monitoring local-network \
               login about-device support system-settings setup reboot; do
        [ -d "$WWW_ROOT/$dir" ] && rm -rf "$WWW_ROOT/$dir"
    done
    rm -f "$WWW_ROOT/index.html" "$WWW_ROOT/404.html" "$WWW_ROOT/favicon.ico"

    # Restore original index.html from backup
    if [ -f "$BACKUP_DIR/index.html.orig" ]; then
        cp "$BACKUP_DIR/index.html.orig" "$WWW_ROOT/index.html"
        info "Original index.html restored from backup"
    else
        warn "No backup found — original index.html not restored"
        warn "Reinstall LuCI if needed: opkg install luci"
    fi

    # --- 5. Remove runtime state ---
    step "Cleaning up runtime state..."
    rm -f /tmp/qmanager_status.json \
          /tmp/qmanager_ping.json \
          /tmp/qmanager_ping_history.json \
          /tmp/qmanager_signal_history.json \
          /tmp/qmanager_events.json \
          /tmp/qmanager_email_log.json \
          /tmp/qmanager_profile_state.json \
          /tmp/qmanager_watchcat.json \
          /tmp/qmanager_band_failover_state.json \
          /tmp/qmanager_tower_failover_state.json
    rm -f /tmp/qmanager.log /tmp/qmanager.log.1
    rm -f /tmp/qmanager_*.lock \
          /tmp/qmanager_email_reload \
          /tmp/qmanager_imei_check_done \
          /tmp/qm_spin_out \
          /tmp/qmanager_low_power_active 2>/dev/null || true
    rm -rf "$SESSION_DIR"
    info "Runtime state cleaned"

    # --- 6. Remove firewall rules ---
    rm -f /etc/firewall.user.ttl /etc/firewall.user.mtu

    # --- 7. Remove UCI config ---
    if uci -q get quecmanager >/dev/null 2>&1; then
        uci -q delete quecmanager 2>/dev/null || true
        uci commit 2>/dev/null || true
    fi
    rm -f /etc/config/quecmanager
    info "UCI config removed"

    # --- 8. Remove cron jobs ---
    if crontab -l 2>/dev/null | grep -q qmanager; then
        crontab -l 2>/dev/null | grep -v qmanager | crontab - 2>/dev/null || true
        info "Cron jobs removed"
    fi

    # --- 9. Config directory ---
    if [ "$KEEP_CONFIG" -eq 0 ]; then
        rm -rf "$CONF_DIR"
        info "Configuration directory removed"
    else
        if [ -d "$CONF_DIR" ]; then
            info "Configuration preserved at $CONF_DIR/"
        fi
    fi

    # Summary
    printf "\n"
    printf "  ${CYAN}==========================================${NC}\n"
    printf "  ${GREEN}${BOLD}    QManager — Uninstall Complete${NC}\n"
    printf "  ${CYAN}==========================================${NC}\n"
    printf "\n"
    printf "  ${DIM}Tip: Reboot recommended to clear live iptables rules.${NC}\n\n"
}

# ==============================================================================
# Option 3 — Download Only
# ==============================================================================

do_download_only() {
    printf "\n"
    step "Downloading QManager..."
    printf "     %s\n" "$DOWNLOAD_URL"

    rm -f "$ARCHIVE_PATH"
    if ! download_archive "$DOWNLOAD_URL" "$ARCHIVE_PATH"; then
        printf "\n"
        die "Download failed. Ensure HTTPS is available (opkg install wget-ssl)"
    fi

    if [ -f "$ARCHIVE_PATH" ]; then
        local size
        size=$(du -k "$ARCHIVE_PATH" 2>/dev/null | awk '{print $1 "K"}')
        info "Downloaded to $ARCHIVE_PATH ($size)"
        printf "\n"
        printf "  To install later:\n\n"
        printf "     tar xzf %s -C /tmp/\n" "$ARCHIVE_PATH"
        printf "     sh %s/install.sh\n\n" "$EXTRACT_DIR"
    else
        die "Download failed"
    fi
}

# ==============================================================================
# Menu
# ==============================================================================

show_menu() {
    clear 2>/dev/null || true
    printf "\n"
    printf "  ${CYAN}==========================================${NC}\n"
    printf "  ${BOLD}       QManager — Setup Wizard${NC}\n"
    printf "  ${DIM}     Quectel Modem Manager for OpenWRT${NC}\n"
    printf "  ${CYAN}==========================================${NC}\n"
    printf "\n"

    # Show install status
    if is_installed; then
        printf "  Status: ${GREEN}Installed${NC}\n"
    else
        printf "  Status: ${DIM}Not installed${NC}\n"
    fi
    printf "\n"

    printf "  ${BOLD}[1]${NC}  Install QManager\n"
    printf "  ${BOLD}[2]${NC}  Uninstall QManager\n"
    printf "  ${BOLD}[3]${NC}  Download Only\n"
    printf "\n"
    printf "  ${DIM}[0]  Exit${NC}\n"
    printf "\n"
    printf "  Select an option: "
}

# ==============================================================================
# Entrypoint
# ==============================================================================

main() {
    show_menu
    read -r choice

    case "$choice" in
        1) do_install ;;
        2) do_uninstall ;;
        3) do_download_only ;;
        0) printf "\n  Goodbye.\n\n"; exit 0 ;;
        *)
            printf "\n"
            err "Invalid option: $choice"
            printf "\n"
            exit 1
            ;;
    esac
}

main
