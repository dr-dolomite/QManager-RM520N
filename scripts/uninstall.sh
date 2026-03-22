#!/bin/sh
# =============================================================================
# QManager Uninstall Script
# =============================================================================
# Completely removes QManager from an OpenWRT device.
#
# Usage:
#   sh uninstall.sh [OPTIONS]
#
# Flags:
#   --force        Skip the "type yes to confirm" prompt
#   --keep-config  Always keep /etc/qmanager/ (default: ask)
#   --purge        Always remove /etc/qmanager/ without asking
#   --help         Show this help
#
# What this removes:
#   - Frontend files from /www/ (restores original index.html if backed up)
#   - CGI endpoints from /www/cgi-bin/quecmanager/
#   - Shared libraries from /usr/lib/qmanager/
#   - Daemons from /usr/bin/qmanager_* and /usr/bin/qcmd
#   - Init.d services from /etc/init.d/qmanager*
#   - Runtime state from /tmp (JSON, logs, sessions, lock files)
#   - UCI config namespace (quecmanager.*)
#   - Firewall rule files (/etc/firewall.user.ttl, /etc/firewall.user.mtu)
#   - Optionally: /etc/qmanager/ (password, profiles, backups)
#
# =============================================================================

set -e

# --- Configuration -----------------------------------------------------------

VERSION="v0.1.2"

# Paths
WWW_ROOT="/www"
CGI_DIR="/www/cgi-bin/quecmanager"
LIB_DIR="/usr/lib/qmanager"
BIN_DIR="/usr/bin"
INITD_DIR="/etc/init.d"
CONF_DIR="/etc/qmanager"
BACKUP_DIR="/etc/qmanager/backups"
SESSION_DIR="/tmp/qmanager_sessions"

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

TOTAL_STEPS=6
CURRENT_STEP=0

# --- Helper Functions --------------------------------------------------------

info()  { printf "    ${GREEN}${ICO_OK}${NC}  %s\n" "$1"; }
warn()  { printf "    ${YELLOW}${ICO_WARN}${NC}  %s\n" "$1"; }
error() { printf "    ${RED}${ICO_ERR}${NC}  %s\n" "$1"; }

die() {
    error "$1"
    exit 1
}

_draw_bar() {
    # Draw a Unicode block progress bar.
    # Args: current, total, [width=20]
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

# --- Preflight Checks --------------------------------------------------------

preflight() {
    step "Running pre-flight checks"

    if [ "$(id -u)" -ne 0 ]; then
        die "This script must be run as root"
    fi

    if [ ! -f /etc/openwrt_release ]; then
        warn "Cannot detect OpenWRT — proceeding anyway"
    else
        local distro
        distro=$(. /etc/openwrt_release && echo "$DISTRIB_DESCRIPTION")
        info "Detected: $distro"
    fi

    # Warn if QManager doesn't appear to be installed
    if [ ! -d "$CGI_DIR" ] && [ ! -d "$LIB_DIR" ] && [ ! -f "$BIN_DIR/qcmd" ]; then
        warn "QManager does not appear to be fully installed"
        printf "\n  Continue uninstall anyway? [y/N] "
        read -r _ans
        case "$_ans" in
            y|Y|yes|YES) printf "\n" ;;
            *) printf "\n  ${YELLOW}Aborted.${NC}\n\n"; exit 0 ;;
        esac
    else
        info "QManager installation detected"
    fi

    info "Pre-flight checks passed"
}

# --- Confirmation Prompt -----------------------------------------------------

confirm_uninstall() {
    printf "\n"
    printf "  ${YELLOW}${BOLD}This will permanently remove QManager from your device.${NC}\n\n"
    printf "  The following will be deleted:\n\n"
    printf "    ${DIM}${ICO_STEP}${NC}  Frontend files in %s/\n" "$WWW_ROOT"
    printf "    ${DIM}${ICO_STEP}${NC}  CGI endpoints in %s/\n" "$CGI_DIR"
    printf "    ${DIM}${ICO_STEP}${NC}  Libraries in %s/\n" "$LIB_DIR"
    printf "    ${DIM}${ICO_STEP}${NC}  Daemons: %s/qmanager_* and qcmd\n" "$BIN_DIR"
    printf "    ${DIM}${ICO_STEP}${NC}  Init.d services: %s/qmanager*\n" "$INITD_DIR"
    printf "    ${DIM}${ICO_STEP}${NC}  Runtime state in /tmp\n"
    printf "    ${DIM}${ICO_STEP}${NC}  UCI config (quecmanager.*)\n"
    printf "\n"
    printf "  Type ${BOLD}yes${NC} to confirm: "
    read -r _confirm
    case "$_confirm" in
        yes|YES)
            printf "\n"
            ;;
        *)
            printf "\n  ${YELLOW}Aborted — nothing was removed.${NC}\n\n"
            exit 0
            ;;
    esac
}

# --- Stop All Services -------------------------------------------------------

stop_services() {
    step "Stopping all QManager services"

    # Stop main service (poller + ping + watchcat)
    if [ -x "$INITD_DIR/qmanager" ]; then
        "$INITD_DIR/qmanager" stop 2>/dev/null || true
        info "Stopped qmanager (poller, ping, watchcat)"
    fi

    # Stop auxiliary services
    for svc in qmanager_eth_link qmanager_mtu qmanager_imei_check \
               qmanager_wan_guard qmanager_watchcat qmanager_tower_failover \
               qmanager_ttl qmanager_low_power_check qmanager_bandwidth; do
        if [ -x "$INITD_DIR/$svc" ]; then
            "$INITD_DIR/$svc" stop 2>/dev/null || true
        fi
    done

    # Kill any lingering processes by name
    for proc in qmanager_poller qmanager_ping qmanager_watchcat \
                qmanager_band_failover qmanager_tower_failover \
                qmanager_tower_schedule qmanager_cell_scanner \
                qmanager_neighbour_scanner qmanager_mtu_apply \
                qmanager_profile_apply qmanager_imei_check \
                qmanager_wan_guard qmanager_low_power \
                qmanager_low_power_check qmanager_scheduled_reboot \
                qmanager_update qmanager_auto_update \
                bridge_traffic_monitor_rm551 websocat; do
        killall "$proc" 2>/dev/null || true
    done

    sleep 1
    info "All services stopped"
}

# --- Remove Init.d Services --------------------------------------------------

remove_services() {
    step "Removing init.d services"

    local removed=0
    for svc in qmanager qmanager_eth_link qmanager_ttl qmanager_mtu \
               qmanager_wan_guard qmanager_imei_check \
               qmanager_tower_failover qmanager_low_power_check \
               qmanager_watchcat qmanager_bandwidth; do
        if [ -f "$INITD_DIR/$svc" ]; then
            "$INITD_DIR/$svc" disable 2>/dev/null || true
            rm -f "$INITD_DIR/$svc"
            info "Removed /etc/init.d/$svc"
            removed=$(( removed + 1 ))
        fi
    done

    # Clean up any leftover rc.d symlinks
    for _link in /etc/rc.d/*qmanager*; do
        [ -e "$_link" ] && rm -f "$_link" 2>/dev/null || true
    done

    if [ "$removed" -eq 0 ]; then
        warn "No init.d services found — may have already been removed"
    else
        info "$removed service(s) removed and disabled"
    fi
}

# --- Remove Backend Files ----------------------------------------------------

remove_backend() {
    step "Removing backend files"

    # Remove daemons and utilities from /usr/bin/
    local bin_count=0
    if [ -f "$BIN_DIR/qcmd" ]; then
        rm -f "$BIN_DIR/qcmd"
        bin_count=$(( bin_count + 1 ))
    fi
    for f in "$BIN_DIR"/qmanager_*; do
        [ -f "$f" ] || continue
        rm -f "$f"
        bin_count=$(( bin_count + 1 ))
    done
    if [ -f "$BIN_DIR/bridge_traffic_monitor_rm551" ]; then
        rm -f "$BIN_DIR/bridge_traffic_monitor_rm551"
        bin_count=$(( bin_count + 1 ))
    fi
    info "Removed $bin_count binary/daemon file(s) from $BIN_DIR"

    # Remove shared libraries
    if [ -d "$LIB_DIR" ]; then
        rm -rf "$LIB_DIR"
        info "Removed $LIB_DIR"
    else
        warn "$LIB_DIR not found — already removed"
    fi

    # Remove CGI endpoints
    if [ -d "$CGI_DIR" ]; then
        rm -rf "$CGI_DIR"
        info "Removed $CGI_DIR"
    else
        warn "$CGI_DIR not found — already removed"
    fi

    # Remove UCI config namespace
    if uci -q get quecmanager >/dev/null 2>&1; then
        uci -q delete quecmanager 2>/dev/null || true
        uci commit 2>/dev/null || true
        info "Removed UCI config (quecmanager.*)"
    fi

    # Remove firewall rule files
    if [ -f /etc/firewall.user.ttl ]; then
        rm -f /etc/firewall.user.ttl
        info "Removed /etc/firewall.user.ttl"
        warn "Live iptables TTL/HL rules still active — will clear on reboot"
    fi
    if [ -f /etc/firewall.user.mtu ]; then
        rm -f /etc/firewall.user.mtu
        info "Removed /etc/firewall.user.mtu"
    fi

    # Remove msmtp config
    if [ -f /etc/qmanager/msmtprc ]; then
        rm -f /etc/qmanager/msmtprc
        info "Removed /etc/qmanager/msmtprc (email config)"
    fi

    # Remove bandwidth monitor SSL certs
    if [ -d /etc/qmanager/bandwidth_certs ]; then
        rm -rf /etc/qmanager/bandwidth_certs
        info "Removed /etc/qmanager/bandwidth_certs (bandwidth SSL)"
    fi

    # Remove cron jobs (auto-update, low power, etc.)
    if crontab -l 2>/dev/null | grep -q qmanager; then
        crontab -l 2>/dev/null | grep -v qmanager | crontab - 2>/dev/null || true
        info "Removed qmanager cron jobs"
    fi
}

# --- Remove Frontend Files ---------------------------------------------------

remove_frontend() {
    step "Removing frontend files"

    # Remove QManager-specific directories from /www/
    local removed_dirs=0
    for dir in _next dashboard cellular monitoring local-network \
               login about-device support system-settings setup reboot; do
        if [ -d "$WWW_ROOT/$dir" ]; then
            rm -rf "$WWW_ROOT/$dir"
            removed_dirs=$(( removed_dirs + 1 ))
        fi
    done
    info "Removed $removed_dirs frontend director(ies) from $WWW_ROOT"

    # Remove root-level QManager files (HTML + public assets)
    rm -f "$WWW_ROOT/index.html" \
          "$WWW_ROOT/404.html" \
          "$WWW_ROOT/favicon.ico" \
          "$WWW_ROOT/qmanager-logo.svg" \
          "$WWW_ROOT/device-icon.svg" \
          "$WWW_ROOT/device-icon-1.svg" \
          "$WWW_ROOT/discord-qr.svg" \
          "$WWW_ROOT/file.svg" \
          "$WWW_ROOT/globe.svg" \
          "$WWW_ROOT/window.svg"

    # Restore the original OpenWRT/LuCI index.html from backup
    if [ -f "$BACKUP_DIR/index.html.orig" ]; then
        cp "$BACKUP_DIR/index.html.orig" "$WWW_ROOT/index.html"
        info "Restored original index.html from $BACKUP_DIR/index.html.orig"
    else
        warn "No backup found — original index.html was not restored"
        warn "  Device web interface may show a blank page until LuCI is reinstalled"
        warn "  Or: opkg install luci && reboot"
    fi
}

# --- Remove Runtime State ----------------------------------------------------

remove_runtime_state() {
    step "Removing runtime state from /tmp"

    local tmp_count=0

    # JSON state and cache files
    for f in /tmp/qmanager_status.json \
              /tmp/qmanager_ping.json \
              /tmp/qmanager_ping_history.json \
              /tmp/qmanager_signal_history.json \
              /tmp/qmanager_events.json \
              /tmp/qmanager_email_log.json \
              /tmp/qmanager_profile_state.json \
              /tmp/qmanager_watchcat.json \
              /tmp/qmanager_band_failover_state.json \
              /tmp/qmanager_tower_failover_state.json \
              /tmp/qmanager_update.json; do
        if [ -f "$f" ]; then
            rm -f "$f"
            tmp_count=$(( tmp_count + 1 ))
        fi
    done

    # Log files
    for f in /tmp/qmanager.log /tmp/qmanager.log.1 /tmp/qmanager_update.log; do
        [ -f "$f" ] && rm -f "$f" && tmp_count=$(( tmp_count + 1 )) || true
    done

    # Lock, PID, and flag files
    rm -f /tmp/qmanager_*.lock \
          /tmp/qmanager_email_reload \
          /tmp/qmanager_imei_check_done \
          /tmp/qmanager_update.pid \
          /tmp/qmanager_long_running \
          /tmp/qmanager_low_power_active \
          /tmp/qmanager_recovery_active \
          /tmp/qmanager_watchcat.pid \
          /tmp/qm_spin_out \
          2>/dev/null || true

    # Bandwidth monitor runtime directory
    rm -rf /tmp/quecmanager 2>/dev/null || true

    # Session directory
    if [ -d "$SESSION_DIR" ]; then
        rm -rf "$SESSION_DIR"
        info "Removed session directory $SESSION_DIR"
    fi

    info "Removed $tmp_count runtime file(s) from /tmp"
}

# --- Remove Config Directory (conditional) -----------------------------------

remove_config() {
    if [ -d "$CONF_DIR" ]; then
        rm -rf "$CONF_DIR"
        info "Removed $CONF_DIR"
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
    printf "  ══════════════════════════════════════════\n"
    printf "  ${GREEN}${BOLD}  QManager - Uninstall Complete${NC}\n"
    printf "  ══════════════════════════════════════════\n\n"

    printf "  ${GREEN}${ICO_OK}${NC}  Frontend files removed from %s\n" "$WWW_ROOT"
    printf "  ${GREEN}${ICO_OK}${NC}  CGI endpoints, libraries, and daemons removed\n"
    printf "  ${GREEN}${ICO_OK}${NC}  Init.d services disabled and removed\n"
    printf "  ${GREEN}${ICO_OK}${NC}  Runtime state cleared from /tmp\n"

    if [ -f "$WWW_ROOT/index.html" ]; then
        printf "  ${GREEN}${ICO_OK}${NC}  Original index.html restored\n"
    else
        printf "  ${YELLOW}${ICO_WARN}${NC}  No index.html — device web UI may be blank\n"
    fi

    printf "\n"
    printf "  ${DIM}Tip: A reboot is recommended to clear any live iptables rules.${NC}\n\n"
}

# --- Usage -------------------------------------------------------------------

usage() {
    printf "QManager Uninstall Script v%s\n\n" "$VERSION"
    printf "Usage: sh uninstall.sh [OPTIONS]\n\n"
    printf "Options:\n"
    printf "  --force        Skip confirmation prompt\n"
    printf "  --keep-config  Keep /etc/qmanager/ (configs, profiles, backups)\n"
    printf "  --purge        Remove /etc/qmanager/ without asking\n"
    printf "  --help         Show this help\n\n"
    printf "What is removed:\n"
    printf "  /www/           Frontend files (original index.html restored)\n"
    printf "  /www/cgi-bin/   QManager CGI endpoints\n"
    printf "  /usr/lib/       qmanager shared libraries\n"
    printf "  /usr/bin/       qcmd and qmanager_* daemons\n"
    printf "  /etc/init.d/    qmanager* service scripts\n"
    printf "  /tmp/           Runtime JSON, logs, sessions, lock files\n"
    printf "  UCI             quecmanager.* config namespace\n"
    printf "  /etc/firewall.* TTL/MTU rule files\n\n"
    printf "Optional (asked or via flag):\n"
    printf "  /etc/qmanager/  Password, profiles, tower/band configs, backups\n\n"
}

# --- Main --------------------------------------------------------------------

main() {
    DO_FORCE=0
    DO_CONFIG="ask"   # "ask" | "keep" | "purge"

    while [ $# -gt 0 ]; do
        case "$1" in
            --force)        DO_FORCE=1 ;;
            --keep-config)  DO_CONFIG="keep" ;;
            --purge)        DO_CONFIG="purge" ;;
            --help|-h)      usage; exit 0 ;;
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
    printf "  ══════════════════════════════════════════\n"
    printf "  ${BOLD}  QManager - Uninstall Script${NC}\n"
    printf "  ${DIM}  Version: v%s${NC}\n" "$VERSION"
    printf "  ══════════════════════════════════════════\n"

    preflight

    if [ "$DO_FORCE" = "0" ]; then
        confirm_uninstall
    fi

    stop_services
    remove_services
    remove_backend
    remove_frontend
    remove_runtime_state

    # Handle /etc/qmanager/ config directory
    if [ "$DO_CONFIG" = "purge" ]; then
        remove_config
        info "Configuration directory purged"
    elif [ "$DO_CONFIG" = "keep" ]; then
        info "Kept $CONF_DIR (configs preserved)"
    else
        # Interactive prompt
        if [ -d "$CONF_DIR" ]; then
            printf "\n"
            warn "Configuration directory $CONF_DIR still exists."
            warn "It contains: password hash, profiles, tower/band lock configs, IMEI backup, backups."
            printf "  Remove it? [y/N] "
            read -r answer
            case "$answer" in
                y|Y|yes|YES)
                    remove_config
                    info "Configuration directory removed"
                    ;;
                *)
                    info "Kept $CONF_DIR (configs preserved for reinstall)"
                    ;;
            esac
        fi
    fi

    print_summary
}

main "$@"
