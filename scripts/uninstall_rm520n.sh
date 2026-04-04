#!/bin/bash
# =============================================================================
# QManager Uninstall Script — RM520N-GL
# =============================================================================
# Removes QManager from the RM520N-GL modem.
# Preserves /etc/qmanager/ (config, passwords, profiles) unless --purge.
#
# Usage: bash uninstall_rm520n.sh [--purge]
# =============================================================================

set -e

if [ -t 1 ]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    BOLD='\033[1m'; NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' BOLD='' NC=''
fi

info()  { printf "  ${GREEN}✓${NC}  %s\n" "$1"; }
warn()  { printf "  ${YELLOW}⚠${NC}  %s\n" "$1"; }
error() { printf "  ${RED}✗${NC}  %s\n" "$1"; }

WWW_ROOT="/usrdata/simpleadmin/www"
CGI_DIR="/usrdata/simpleadmin/www/cgi-bin/quecmanager"
LIB_DIR="/usr/lib/qmanager"
BIN_DIR="/usr/bin"
SYSTEMD_DIR="/etc/systemd/system"
CONF_DIR="/etc/qmanager"
CERT_DIR="/usrdata/qmanager/certs"
SESSION_DIR="/tmp/qmanager_sessions"
# Detect Entware vs system sudo
if [ -d /opt/etc/sudoers.d ]; then
    SUDOERS_FILE="/opt/etc/sudoers.d/qmanager"
elif [ -d /etc/sudoers.d ]; then
    SUDOERS_FILE="/etc/sudoers.d/qmanager"
else
    SUDOERS_FILE=""
fi
LIGHTTPD_CONF="/usrdata/simpleadmin/lighttpd.conf"

PURGE=0
[ "$1" = "--purge" ] && PURGE=1

if [ "$(id -u)" -ne 0 ]; then
    error "Must be run as root"
    exit 1
fi

printf "\n  ${BOLD}QManager — RM520N-GL Uninstaller${NC}\n\n"

# --- Stop and disable systemd services ---
for svc in qmanager-poller qmanager-ping qmanager-watchcat \
           qmanager-tower-failover qmanager-ttl qmanager-mtu \
           qmanager-imei-check; do
    systemctl stop "$svc" 2>/dev/null || true
    systemctl disable "$svc" 2>/dev/null || true
done
info "Stopped and disabled systemd services"

# Kill lingering processes
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
info "Killed lingering processes"

# --- Remove systemd unit files and boot symlinks ---
rm -f "$SYSTEMD_DIR"/qmanager*.service "$SYSTEMD_DIR"/qmanager*.target
rm -rf "$SYSTEMD_DIR"/qmanager.target.wants
rm -f /lib/systemd/system/multi-user.target.wants/qmanager.target
systemctl daemon-reload
info "Removed systemd units and boot symlinks"

# --- Remove daemons and bundled binaries ---
rm -f "$BIN_DIR/qcmd" "$BIN_DIR/qcmd_test" "$BIN_DIR/sms_tool"
rm -f "$BIN_DIR"/qmanager_*
info "Removed daemons and binaries from $BIN_DIR"

# --- Remove libraries ---
rm -rf "$LIB_DIR"
info "Removed $LIB_DIR"

# --- Remove CGI endpoints ---
rm -rf "$CGI_DIR"
info "Removed CGI endpoints"

# --- Remove sudoers ---
if [ -n "$SUDOERS_FILE" ] && [ -f "$SUDOERS_FILE" ]; then
    rm -f "$SUDOERS_FILE"
    info "Removed sudoers rules from $SUDOERS_FILE"
else
    info "No sudoers rules to remove"
fi

# --- Remove frontend (restore SimpleAdmin backup if available) ---
for item in "$WWW_ROOT"/*; do
    name=$(basename "$item")
    case "$name" in
        cgi-bin|*.bak) continue ;;
        *) rm -rf "$item" ;;
    esac
done

if [ -f "$WWW_ROOT/index.html.bak" ]; then
    mv "$WWW_ROOT/index.html.bak" "$WWW_ROOT/index.html"
    info "Restored SimpleAdmin index.html from backup"
fi
info "Removed frontend files"

# --- Restore SimpleAdmin lighttpd config if backed up ---
if [ -f "${LIGHTTPD_CONF}.simpleadmin.bak" ]; then
    mv "${LIGHTTPD_CONF}.simpleadmin.bak" "$LIGHTTPD_CONF"
    systemctl restart lighttpd 2>/dev/null || true
    info "Restored SimpleAdmin lighttpd config"
fi

# --- Remove TLS certs ---
rm -rf "$CERT_DIR"
info "Removed QManager TLS certs"

# --- Remove firewall rules ---
rm -f /etc/firewall.user.ttl /etc/firewall.user.mtu 2>/dev/null || true

# --- Remove runtime state ---
rm -f /tmp/qmanager_*.json /tmp/qmanager.log* 2>/dev/null || true
rm -f /tmp/qmanager_*.pid /tmp/qmanager_*.lock 2>/dev/null || true
rm -f /tmp/qmanager_email_reload /tmp/qmanager_imei_check_done 2>/dev/null || true
rm -f /tmp/qmanager_low_power_active /tmp/qmanager_recovery_active 2>/dev/null || true
rm -f /tmp/qmanager_staged.tar.gz /tmp/qmanager_staged_version 2>/dev/null || true
rm -rf "$SESSION_DIR"
info "Removed runtime state"

# --- Remove cron jobs ---
if crontab -l 2>/dev/null | grep -q qmanager; then
    crontab -l 2>/dev/null | grep -v qmanager | crontab - 2>/dev/null || true
    info "Removed cron jobs"
fi

# --- Config directory ---
if [ "$PURGE" = "1" ]; then
    rm -rf "$CONF_DIR"
    info "Purged config directory $CONF_DIR"
elif [ -d "$CONF_DIR" ]; then
    warn "Config preserved at $CONF_DIR (use --purge to remove)"
fi

printf "\n  ${GREEN}${BOLD}QManager uninstalled.${NC}\n\n"
