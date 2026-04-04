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
#     usrdata/simpleadmin/  — lighttpd config
#   dependencies/           — Bundled binaries and packages
#     sms_tool              — Static ARM binary (AT command transport)
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
#   --help             Show this help
#
# =============================================================================

set -e

# --- Configuration -----------------------------------------------------------

VERSION="v0.1.13"
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"

# Destinations
WWW_ROOT="/usrdata/simpleadmin/www"
CGI_DIR="/usrdata/simpleadmin/www/cgi-bin/quecmanager"
LIB_DIR="/usr/lib/qmanager"
BIN_DIR="/usr/bin"
SYSTEMD_DIR="/etc/systemd/system"
# Detect Entware vs system sudo
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
CONF_DIR="/etc/qmanager"
CERT_DIR="/usrdata/qmanager/certs"
SESSION_DIR="/tmp/qmanager_sessions"
BACKUP_DIR="/etc/qmanager/backups"
LIGHTTPD_CONF="/usrdata/simpleadmin/lighttpd.conf"

# Source directories (relative to INSTALL_DIR)
SRC_FRONTEND="$INSTALL_DIR/out"
SRC_SCRIPTS="$INSTALL_DIR/scripts"
SRC_DEPS="$INSTALL_DIR/dependencies"

# Entware opkg path
OPKG="/opt/bin/opkg"

# Optional packages (not bundled — installed from Entware if available)
OPTIONAL_PACKAGES="msmtp"

# --- Colors & Icons ----------------------------------------------------------

if [ -t 1 ]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    BLUE='\033[0;34m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' BLUE='' BOLD='' DIM='' NC=''
fi
ICO_OK='✓'; ICO_WARN='⚠'; ICO_ERR='✗'; ICO_STEP='▶'

# --- Helpers -----------------------------------------------------------------

info()  { printf "    ${GREEN}${ICO_OK}${NC}  %s\n" "$1"; }
warn()  { printf "    ${YELLOW}${ICO_WARN}${NC}  %s\n" "$1"; }
error() { printf "    ${RED}${ICO_ERR}${NC}  %s\n" "$1"; }
die()   { error "$1"; exit 1; }

count_files() { find "$1" -type f 2>/dev/null | wc -l | tr -d ' '; }

TOTAL_STEPS=9; CURRENT_STEP=0

step() {
    CURRENT_STEP=$(( CURRENT_STEP + 1 ))
    printf "\n  ${DIM}[Step %d/%d]${NC}\n" "$CURRENT_STEP" "$TOTAL_STEPS"
    printf "  ${BLUE}${BOLD}${ICO_STEP}${NC}${BOLD} %s${NC}\n" "$1"
}

# --- Pre-flight Checks -------------------------------------------------------

preflight() {
    step "Running pre-flight checks"

    if [ "$(id -u)" -ne 0 ]; then
        die "This script must be run as root"
    fi

    # Check we're on RM520N-GL
    if [ -f /etc/quectel-project-version ]; then
        local ver
        ver=$(cat /etc/quectel-project-version 2>/dev/null)
        info "Detected: RM520N-GL ($ver)"
    else
        warn "Cannot detect RM520N-GL firmware version — proceeding anyway"
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

    info "Pre-flight checks passed"
}

# --- Install Dependencies ----------------------------------------------------

install_dependencies() {
    step "Installing bundled dependencies"

    # --- sms_tool (static ARM binary — direct copy) ---
    if [ -f "$SRC_DEPS/sms_tool" ]; then
        cp "$SRC_DEPS/sms_tool" "$BIN_DIR/sms_tool"
        chmod +x "$BIN_DIR/sms_tool"
        info "sms_tool installed to $BIN_DIR/sms_tool"
    elif command -v sms_tool >/dev/null 2>&1; then
        info "sms_tool already installed (not bundled)"
    else
        die "sms_tool not found in $SRC_DEPS and not installed on device"
    fi

    # --- Bundled .ipk packages (Entware) ---
    if [ ! -x "$OPKG" ]; then
        warn "Entware opkg not found at $OPKG — skipping .ipk installation"
        warn "Manually install jq and coreutils-timeout if not present"
    else
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

        # coreutils-timeout
        if command -v timeout >/dev/null 2>&1; then
            info "timeout is already installed"
        else
            "$OPKG" install coreutils-timeout >/dev/null 2>&1 \
                && info "coreutils-timeout installed from Entware" \
                || warn "coreutils-timeout not available — some commands may hang without timeout safety"
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
}

# --- Stop Running Services ---------------------------------------------------

stop_services() {
    step "Stopping QManager services"

    # Stop systemd services
    for svc in qmanager-poller qmanager-ping qmanager-watchcat \
               qmanager-tower-failover qmanager-ttl qmanager-mtu \
               qmanager-imei-check; do
        systemctl stop "$svc" 2>/dev/null || true
    done

    # Kill any lingering processes
    for proc in qmanager_poller qmanager_ping qmanager_watchcat \
                qmanager_band_failover qmanager_tower_failover \
                qmanager_tower_schedule qmanager_cell_scanner \
                qmanager_neighbour_scanner qmanager_mtu_apply \
                qmanager_profile_apply qmanager_imei_check \
                qmanager_scheduled_reboot qmanager_update \
                qmanager_auto_update; do
        killall "$proc" 2>/dev/null || true
    done

    sleep 1
    info "All services stopped"
}

# --- Backup Originals --------------------------------------------------------

backup_originals() {
    step "Backing up original files"

    mkdir -p "$BACKUP_DIR"

    # Backup SimpleAdmin's original index.html (first install only)
    if [ ! -f "$WWW_ROOT/index.html.bak" ] && [ -f "$WWW_ROOT/index.html" ]; then
        if ! grep -q "QManager" "$WWW_ROOT/index.html" 2>/dev/null; then
            cp "$WWW_ROOT/index.html" "$WWW_ROOT/index.html.bak"
            info "Backed up SimpleAdmin index.html → index.html.bak"
        fi
    fi

    # Backup SimpleAdmin lighttpd config
    if [ -f "$LIGHTTPD_CONF" ] && ! grep -q "QManager" "$LIGHTTPD_CONF" 2>/dev/null; then
        cp "$LIGHTTPD_CONF" "${LIGHTTPD_CONF}.simpleadmin.bak"
        info "Backed up SimpleAdmin lighttpd.conf"
    fi

    # Backup existing QManager auth
    if [ -f "$CONF_DIR/auth.json" ]; then
        local ts; ts=$(date +%Y%m%d_%H%M%S)
        cp "$CONF_DIR/auth.json" "$BACKUP_DIR/auth.json.$ts" 2>/dev/null || true
        info "Backed up auth config"
    fi

    info "Backups complete"
}

# --- Install Frontend --------------------------------------------------------

install_frontend() {
    step "Installing frontend"

    local file_count
    file_count=$(count_files "$SRC_FRONTEND")
    info "Deploying $file_count frontend files to $WWW_ROOT"

    # Clean www root — preserve cgi-bin and backup files
    for item in "$WWW_ROOT"/*; do
        name=$(basename "$item")
        case "$name" in
            cgi-bin|*.bak) continue ;;
            *) rm -rf "$item" ;;
        esac
    done

    # Copy new frontend
    cp -r "$SRC_FRONTEND"/* "$WWW_ROOT/"

    # Remove SimpleAdmin CGI scripts (keep only quecmanager/ subdirectory)
    if [ -d "$WWW_ROOT/cgi-bin" ]; then
        local sa_removed=0
        for item in "$WWW_ROOT/cgi-bin"/*; do
            name=$(basename "$item")
            case "$name" in
                quecmanager) continue ;;
                *) rm -rf "$item"; sa_removed=$(( sa_removed + 1 )) ;;
            esac
        done
        [ "$sa_removed" -gt 0 ] && info "Removed $sa_removed SimpleAdmin CGI scripts"
    fi

    info "Frontend installed ($file_count files)"
}

# --- Install Backend ---------------------------------------------------------

install_backend() {
    step "Installing backend scripts"

    # --- Shared libraries ---
    mkdir -p "$LIB_DIR"
    if [ -d "$SRC_SCRIPTS/usr/lib/qmanager" ]; then
        cp "$SRC_SCRIPTS/usr/lib/qmanager"/* "$LIB_DIR/"
        find "$LIB_DIR" -maxdepth 1 -name "*.sh" -exec chmod 644 {} \;
        info "Libraries installed to $LIB_DIR"
    fi

    # --- Daemons and utilities ---
    local bin_count=0
    if [ -d "$SRC_SCRIPTS/usr/bin" ]; then
        for f in "$SRC_SCRIPTS/usr/bin"/*; do
            [ -f "$f" ] || continue
            local fname; fname=$(basename "$f")
            cp "$f" "$BIN_DIR/$fname"
            chmod +x "$BIN_DIR/$fname"
            bin_count=$(( bin_count + 1 ))
        done
        info "$bin_count daemons/utilities installed to $BIN_DIR"
    fi

    # --- CGI endpoints ---
    if [ -d "$SRC_SCRIPTS/www/cgi-bin/quecmanager" ]; then
        rm -rf "$CGI_DIR"
        mkdir -p "$CGI_DIR"
        cp -r "$SRC_SCRIPTS/www/cgi-bin/quecmanager"/* "$CGI_DIR/"
        find "$CGI_DIR" -name "*.sh" -exec chmod 755 {} \;
        find "$CGI_DIR" -name "*.json" -exec chmod 644 {} \;
        local cgi_count
        cgi_count=$(find "$CGI_DIR" -name "*.sh" -type f | wc -l | tr -d ' ')
        info "$cgi_count CGI scripts installed to $CGI_DIR"
    fi

    # --- Systemd unit files ---
    if [ -d "$SRC_SCRIPTS/etc/systemd/system" ]; then
        cp "$SRC_SCRIPTS/etc/systemd/system"/qmanager* "$SYSTEMD_DIR/"
        systemctl daemon-reload
        info "Systemd units installed and daemon-reloaded"
    fi

    # --- Sudoers ---
    if [ -f "$SRC_SCRIPTS/etc/sudoers.d/qmanager" ] && [ -n "$SUDOERS_DIR" ]; then
        mkdir -p "$SUDOERS_DIR"
        # Ensure sudoers includes the drop-in directory
        if ! grep -q "includedir.*sudoers.d" "$SUDOERS_CONF" 2>/dev/null; then
            echo "#includedir $SUDOERS_DIR" >> "$SUDOERS_CONF"
            info "Added #includedir $SUDOERS_DIR to $SUDOERS_CONF"
        fi
        cp "$SRC_SCRIPTS/etc/sudoers.d/qmanager" "$SUDOERS_DIR/qmanager"
        chmod 440 "$SUDOERS_DIR/qmanager"
        chown root:root "$SUDOERS_DIR/qmanager"
        info "Sudoers rules installed to $SUDOERS_DIR (440)"
    elif [ -z "$SUDOERS_DIR" ]; then
        warn "sudo not found — install Entware sudo: $OPKG install sudo"
        warn "Skipping sudoers rules (CGI privilege escalation will not work)"
    fi

    # --- lighttpd config ---
    if [ -f "$SRC_SCRIPTS/usrdata/simpleadmin/lighttpd.conf" ]; then
        cp "$SRC_SCRIPTS/usrdata/simpleadmin/lighttpd.conf" "$LIGHTTPD_CONF"
        info "lighttpd config installed"
    fi

    # --- TLS certificates (copy from SimpleAdmin if QManager doesn't have its own) ---
    mkdir -p "$CERT_DIR"
    if [ ! -f "$CERT_DIR/server.key" ]; then
        if [ -f /usrdata/simpleadmin/server.key ]; then
            cp /usrdata/simpleadmin/server.key "$CERT_DIR/server.key"
            cp /usrdata/simpleadmin/server.crt "$CERT_DIR/server.crt"
            info "TLS certs copied from SimpleAdmin"
        else
            # Generate self-signed cert if none exist
            openssl req -x509 -newkey rsa:2048 -keyout "$CERT_DIR/server.key" \
                -out "$CERT_DIR/server.crt" -days 3650 -nodes \
                -subj "/CN=QManager" 2>/dev/null
            info "Generated self-signed TLS certificate"
        fi
    else
        info "TLS certs already exist"
    fi

    # --- Create required directories ---
    # www-data (lighttpd CGI) needs write access to config dir (auth.json, profiles)
    # and session dir (session tokens). Also needs dialout group for serial device access.
    addgroup www-data dialout 2>/dev/null || true
    mkdir -p "$CONF_DIR/profiles"
    chown -R www-data:www-data "$CONF_DIR"
    mkdir -p "$SESSION_DIR"
    chown www-data:www-data "$SESSION_DIR"
    chmod 700 "$SESSION_DIR"
    mkdir -p /var/lock
    # Lock files — both root (daemons) and www-data (CGI) need flock access
    touch /var/lock/qmanager.lock /var/lock/qmanager.pid
    chmod 666 /var/lock/qmanager.lock /var/lock/qmanager.pid

    # --- Config files (deploy new, don't overwrite existing) ---
    if [ -d "$SRC_SCRIPTS/etc/qmanager" ]; then
        for f in "$SRC_SCRIPTS/etc/qmanager"/*; do
            [ -f "$f" ] || continue
            local fname; fname=$(basename "$f")
            if [ ! -f "$CONF_DIR/$fname" ]; then
                cp "$f" "$CONF_DIR/$fname"
                info "Deployed config: $fname"
            fi
        done
    fi

    # --- Initialize JSON config if missing ---
    if [ -f "$LIB_DIR/config.sh" ]; then
        . "$LIB_DIR/config.sh"
        qm_config_init
        info "Config initialized at /etc/qmanager/qmanager.conf"
    fi

    info "Backend installed"
}

# --- Fix Line Endings --------------------------------------------------------

fix_line_endings() {
    step "Fixing line endings (CRLF → LF)"

    local fixed=0
    for dir in "$LIB_DIR" "$BIN_DIR" "$CGI_DIR"; do
        [ -d "$dir" ] || continue
        while IFS= read -r f; do
            if grep -q "$(printf '\r')" "$f" 2>/dev/null; then
                tr -d '\r' < "$f" > "$f.tmp" && mv "$f.tmp" "$f"
                fixed=$(( fixed + 1 ))
            fi
        done < <(find "$dir" -type f \( -name "*.sh" -o -name "qmanager*" -o -name "qcmd*" \))
    done

    if [ "$fixed" -gt 0 ]; then
        warn "Fixed $fixed files with CRLF line endings"
    else
        info "All files already have correct LF line endings"
    fi
}

# --- Fix Permissions ---------------------------------------------------------

fix_permissions() {
    step "Verifying file permissions"

    # Daemons — executable
    for f in "$BIN_DIR"/qmanager_* "$BIN_DIR/qcmd" "$BIN_DIR/qcmd_test"; do
        [ -f "$f" ] && chmod 755 "$f"
    done
    info "Daemons: 755"

    # CGI — .sh executable, .json readable
    if [ -d "$CGI_DIR" ]; then
        find "$CGI_DIR" -name "*.sh" -exec chmod 755 {} \;
        find "$CGI_DIR" -name "*.json" -exec chmod 644 {} \;
        info "CGI scripts: 755, JSON data: 644"
    fi

    # Libraries — readable
    [ -d "$LIB_DIR" ] && find "$LIB_DIR" -maxdepth 1 -type f -exec chmod 644 {} \;
    info "Libraries: 644"

    # Sudoers — strict permissions
    [ -f "$SUDOERS_DIR/qmanager" ] && chmod 440 "$SUDOERS_DIR/qmanager"

    info "All permissions verified"
}

# --- Enable Services ---------------------------------------------------------

enable_services() {
    step "Enabling systemd services"

    # RM520N-GL's minimal systemd ignores `systemctl enable` for boot startup.
    # SimpleAdmin's proven pattern: explicit symlinks into multi-user.target.wants.
    # The wants dir lives under /lib/systemd/system/ on this platform.
    WANTS_DIR="/lib/systemd/system/multi-user.target.wants"
    mkdir -p "$WANTS_DIR"

    # Enable the target — this is what multi-user.target pulls in at boot
    if [ -f "$SYSTEMD_DIR/qmanager.target" ]; then
        ln -sf "$SYSTEMD_DIR/qmanager.target" "$WANTS_DIR/qmanager.target"
        info "Linked qmanager.target → multi-user.target.wants"
    fi

    # Always-on services — symlink into target.wants so target pulls them in
    for svc in qmanager-setup qmanager-ping qmanager-poller qmanager-ttl \
               qmanager-mtu qmanager-imei-check; do
        if [ -f "$SYSTEMD_DIR/${svc}.service" ]; then
            # Symlink into qmanager.target.wants (for target dependency)
            mkdir -p "$SYSTEMD_DIR/qmanager.target.wants"
            ln -sf "$SYSTEMD_DIR/${svc}.service" "$SYSTEMD_DIR/qmanager.target.wants/${svc}.service"
            info "Enabled $svc"
        fi
    done

    # Config-gated services — enable only if previously active
    for svc in qmanager-watchcat qmanager-tower-failover; do
        if [ -f "$SYSTEMD_DIR/${svc}.service" ]; then
            if [ -L "$SYSTEMD_DIR/qmanager.target.wants/${svc}.service" ]; then
                info "$svc already enabled"
            else
                info "Skipped $svc (enable manually if needed)"
            fi
        fi
    done

    systemctl daemon-reload
}

# --- Start Services ----------------------------------------------------------

start_services() {
    step "Starting QManager services"

    # Add loopback iptables rules — CGI scripts need localhost access to lighttpd
    # (default RM520N-GL firewall drops non-bridge/eth traffic on 80/443)
    if ! iptables -C INPUT -i lo -p tcp --dport 80 -j ACCEPT 2>/dev/null; then
        iptables -I INPUT 1 -i lo -p tcp --dport 80 -j ACCEPT
        info "Added iptables loopback rule for port 80"
    fi
    if ! iptables -C INPUT -i lo -p tcp --dport 443 -j ACCEPT 2>/dev/null; then
        iptables -I INPUT 1 -i lo -p tcp --dport 443 -j ACCEPT
        info "Added iptables loopback rule for port 443"
    fi

    # Restart lighttpd to pick up new config
    systemctl restart lighttpd 2>/dev/null || warn "Could not restart lighttpd"
    info "lighttpd restarted with QManager config"

    # Run setup oneshot first (creates lock files, session dirs, iptables rules)
    systemctl start qmanager-setup 2>/dev/null || true

    # Start the target — systemd resolves dependencies and starts all enabled services
    systemctl daemon-reload
    systemctl start qmanager.target 2>/dev/null || true
    sleep 2

    # Verify
    if systemctl is-active qmanager-poller >/dev/null 2>&1; then
        info "Poller is running"
    else
        warn "Poller does not appear to be running — check: journalctl -u qmanager-poller"
    fi

    if systemctl is-active qmanager-ping >/dev/null 2>&1; then
        info "Ping daemon is running"
    else
        warn "Ping daemon does not appear to be running"
    fi
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
    printf "  ${DIM}Logs:      ${NC}/tmp/qmanager.log\n"

    printf "\n"
    printf "  Open in browser:  ${BOLD}https://192.168.225.1${NC}\n"
    printf "  Web console:      ${BOLD}https://192.168.225.1/console${NC}\n\n"

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
    printf "  --help             Show this help\n\n"
}

# --- Main --------------------------------------------------------------------

main() {
    DO_FRONTEND=1; DO_BACKEND=1; DO_ENABLE=1; DO_START=1
    DO_PACKAGES=1; DO_REBOOT=1

    while [ $# -gt 0 ]; do
        case "$1" in
            --frontend-only) DO_FRONTEND=1; DO_BACKEND=0 ;;
            --backend-only)  DO_FRONTEND=0; DO_BACKEND=1 ;;
            --no-enable)     DO_ENABLE=0 ;;
            --no-start)      DO_START=0 ;;
            --skip-packages) DO_PACKAGES=0 ;;
            --no-reboot)     DO_REBOOT=0 ;;
            --help|-h)       usage; exit 0 ;;
            *) error "Unknown option: $1"; usage; exit 1 ;;
        esac
        shift
    done

    printf "\n"
    printf "  ══════════════════════════════════════════\n"
    printf "  ${BOLD}  QManager — RM520N-GL Installer${NC}\n"
    printf "  ${DIM}  Version: %s${NC}\n" "$VERSION"
    printf "  ══════════════════════════════════════════\n"

    # Calculate steps
    TOTAL_STEPS=1
    [ "$DO_PACKAGES" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))
    TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))  # stop_services
    [ "$DO_FRONTEND" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 2 ))
    [ "$DO_BACKEND" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 3 ))
    [ "$DO_BACKEND" = "1" ] && [ "$DO_ENABLE" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))
    [ "$DO_START" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))

    preflight

    [ "$DO_PACKAGES" = "1" ] && install_dependencies
    stop_services

    if [ "$DO_FRONTEND" = "1" ]; then
        backup_originals
        install_frontend
    fi

    if [ "$DO_BACKEND" = "1" ]; then
        install_backend
        fix_line_endings
        fix_permissions
        [ "$DO_ENABLE" = "1" ] && enable_services
    fi

    [ "$DO_START" = "1" ] && start_services

    print_summary
    mkdir -p "$CONF_DIR" && echo "$VERSION" > "$CONF_DIR/VERSION"

    if [ "$DO_REBOOT" = "1" ]; then
        printf "  Rebooting in 5 seconds — press Ctrl+C to cancel...\n\n"
        sleep 5
        reboot
    fi
}

main "$@"
