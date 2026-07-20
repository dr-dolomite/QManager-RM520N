#!/bin/bash
# =============================================================================
# QManager Uninstall Script — RM520N-GL
# =============================================================================
# Removes QManager from the RM520N-GL modem.
# Preserves /etc/qmanager/ (config, passwords, profiles) unless --purge.
# Entware (/opt/) is NEVER removed by this script regardless of flags.
#
# Usage: bash uninstall_rm520n.sh [--purge] [--force] [--no-reboot] [--help]
# =============================================================================

set -e

# --- Colors & Icons ----------------------------------------------------------

if [ -t 1 ]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    BLUE='\033[0;34m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' BLUE='' BOLD='' DIM='' NC=''
fi
ICO_OK='✓'; ICO_WARN='⚠'; ICO_ERR='✗'; ICO_STEP='▶'

# --- Logging -----------------------------------------------------------------

LOG_FILE="/tmp/qmanager_uninstall.log"

log_init() {
    printf "QManager Uninstall Log — %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" > "$LOG_FILE"
    printf "Args: %s\n\n" "$*" >> "$LOG_FILE"
}

_log_raw() { printf "%s\n" "$1" >> "$LOG_FILE" 2>/dev/null || true; }

info()  {
    local msg="$1"
    printf "    ${GREEN}${ICO_OK}${NC}  %s\n" "$msg"
    _log_raw "[INFO]  $msg"
}
warn()  {
    local msg="$1"
    printf "    ${YELLOW}${ICO_WARN}${NC}  %s\n" "$msg"
    _log_raw "[WARN]  $msg"
}
error() {
    local msg="$1"
    printf "    ${RED}${ICO_ERR}${NC}  %s\n" "$msg"
    _log_raw "[ERROR] $msg"
}
die() {
    error "$1"
    exit 1
}

TOTAL_STEPS=0; CURRENT_STEP=0

step() {
    CURRENT_STEP=$(( CURRENT_STEP + 1 ))
    local label="$1"
    printf "\n  ${DIM}[Step %d/%d]${NC}\n" "$CURRENT_STEP" "$TOTAL_STEPS"
    printf "  ${BLUE}${BOLD}${ICO_STEP}${NC}${BOLD} %s${NC}\n" "$label"
    _log_raw ""
    _log_raw "=== Step ${CURRENT_STEP}/${TOTAL_STEPS}: ${label} ==="
}

# --- Path Constants ----------------------------------------------------------

QMANAGER_ROOT="/usrdata/qmanager"
WWW_ROOT="/usrdata/qmanager/www"
CGI_DIR="/usrdata/qmanager/www/cgi-bin/quecmanager"
LIB_DIR="/usr/lib/qmanager"
BIN_DIR="/usr/bin"
SYSTEMD_DIR="/lib/systemd/system"
WANTS_DIR="/lib/systemd/system/multi-user.target.wants"
CONF_DIR="/etc/qmanager"
CERT_DIR="/usrdata/qmanager/certs"
CONSOLE_DIR="/usrdata/qmanager/console"
SESSION_DIR="/tmp/qmanager_sessions"
LIGHTTPD_CONF="/usrdata/qmanager/lighttpd.conf"
TAILSCALE_DIR="/usrdata/tailscale"

# Detect Entware vs system sudoers location at startup
if [ -d /opt/etc/sudoers.d ]; then
    SUDOERS_FILE="/opt/etc/sudoers.d/qmanager"
elif [ -d /etc/sudoers.d ]; then
    SUDOERS_FILE="/etc/sudoers.d/qmanager"
else
    SUDOERS_FILE=""
fi

# --- Argument Parsing --------------------------------------------------------

PURGE=0
FORCE=0
NO_REBOOT=0

usage() {
    printf "QManager Uninstaller (RM520N-GL)\n\n"
    printf "Usage: bash uninstall_rm520n.sh [OPTIONS]\n\n"
    printf "Options:\n"
    printf "  --purge       Also remove /etc/qmanager/ (config, passwords, profiles)\n"
    printf "                and Tailscale installation\n"
    printf "  --force       Skip interactive [y/N] confirmation prompt\n"
    printf "  --no-reboot   Print summary and exit instead of rebooting\n"
    printf "  --help, -h    Show this help\n\n"
    printf "Notes:\n"
    printf "  - Entware (/opt/) is preserved unconditionally — it is a shared\n"
    printf "    dependency. To remove it manually:\n"
    printf "      rm -rf /opt /usrdata/opt\n"
    printf "      rm -f /lib/systemd/system/opt.mount\n"
    printf "      rm -f /lib/systemd/system/start-opt-mount.service\n"
    printf "      rm -f /lib/systemd/system/rc.unslung.service\n"
    printf "      rm -f /lib/systemd/system/multi-user.target.wants/opt.mount\n"
    printf "      rm -f /lib/systemd/system/multi-user.target.wants/start-opt-mount.service\n"
    printf "      rm -f /lib/systemd/system/multi-user.target.wants/rc.unslung.service\n"
    printf "      reboot\n\n"
    printf "Log: %s\n\n" "$LOG_FILE"
}

ORIGINAL_ARGS="$*"

while [ $# -gt 0 ]; do
    case "$1" in
        --purge)     PURGE=1 ;;
        --force)     FORCE=1 ;;
        --no-reboot) NO_REBOOT=1 ;;
        --help|-h)   usage; exit 0 ;;
        *) error "Unknown option: $1"; usage; exit 1 ;;
    esac
    shift
done

# --- Root Check --------------------------------------------------------------

if [ "$(id -u)" -ne 0 ]; then
    error "Must be run as root"
    exit 1
fi

# --- Step Count --------------------------------------------------------------
# Fixed steps: services, binaries, udev, CGI/frontend/lighttpd, sudoers,
#              console, firewall, runtime-state, cron, config, finish
TOTAL_STEPS=11
# Tailscale teardown only runs with --purge
[ "$PURGE" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))

# --- Confirmation ------------------------------------------------------------

confirm_uninstall() {
    # Non-TTY or --force skips the prompt — useful for scripted uninstalls
    if [ "$FORCE" = "1" ] || [ ! -t 0 ]; then
        return 0
    fi

    printf "\n  ${BOLD}QManager — RM520N-GL Uninstaller${NC}\n\n"
    printf "  The following will be removed:\n"
    printf "    • All QManager systemd services and boot symlinks\n"
    printf "    • Daemons and binaries: /usr/bin/qmanager_*, qcmd, atcli_smd11, sms_tool\n"
    printf "    • Shared libraries: %s\n" "$LIB_DIR"
    printf "    • udev rule: /etc/udev/rules.d/99-qmanager-smd11.rules\n"
    printf "    • CGI endpoints and frontend: %s\n" "$WWW_ROOT"
    printf "    • lighttpd config and TLS certs\n"
    printf "    • Sudoers rules\n"
    printf "    • Web console (ttyd): %s\n" "$CONSOLE_DIR"
    printf "    • Speedtest CLI: /usrdata/root/bin/speedtest\n"
    printf "    • Runtime state: /tmp/qmanager_*\n"
    printf "    • Cron jobs referencing qmanager\n"
    if [ "$PURGE" = "1" ]; then
        printf "    • Config directory: %s  ${YELLOW}[--purge]${NC}\n" "$CONF_DIR"
        printf "    • Tailscale installation: %s  ${YELLOW}[--purge]${NC}\n" "$TAILSCALE_DIR"
    fi
    printf "\n"
    printf "  ${YELLOW}Entware (/opt/) is preserved unconditionally.${NC}\n\n"
    printf "  Continue? [y/N] "
    local answer
    read -r answer
    case "$answer" in
        [Yy]|[Yy][Ee][Ss]) ;;
        *) die "Uninstall aborted by user" ;;
    esac
}

# --- Banner ------------------------------------------------------------------

log_init "$ORIGINAL_ARGS"

printf "\n"
printf "  ══════════════════════════════════════════\n"
printf "  ${BOLD}  QManager — RM520N-GL Uninstaller${NC}\n"
printf "  ══════════════════════════════════════════\n"

confirm_uninstall

# Remount rootfs read-write — /usr, /etc, /lib live on the read-only root
mount -o remount,rw / 2>/dev/null || true

# =============================================================================
# Step 1: Stop services and kill daemons
# =============================================================================

step "Stopping QManager services and daemons"

# Filesystem-driven: collect every installed qmanager-*.service unit and stop
# them in a single batched call so systemd shuts them down in parallel.
_units=""
for unit_file in "$SYSTEMD_DIR"/qmanager-*.service; do
    [ -f "$unit_file" ] || continue
    _units="$_units $(basename "$unit_file" .service)"
done
# Also stop lighttpd (QManager owns its service file; restored below)
if [ -n "$_units" ]; then
    systemctl stop $_units lighttpd 2>/dev/null || true
else
    systemctl stop lighttpd 2>/dev/null || true
fi

info "Systemd services stopped"

# Scenario schedule timer teardown — this .timer is armed live at runtime
# by qmanager_scenario_schedule_arm (see the profile Connection Scenario
# schedule feature); it is never a static installer-shipped unit, so it is
# not caught by the filesystem-driven qmanager-*.service glob in Step 2.
# Must run here, before Step 3 removes the arm helper binary itself. Prefer
# the helper (its teardown verb is authoritative and idempotent); fall back
# to the equivalent manual sequence if it's missing (e.g. a partial install).
if [ -x "$BIN_DIR/qmanager_scenario_schedule_arm" ]; then
    "$BIN_DIR/qmanager_scenario_schedule_arm" teardown >/dev/null 2>&1 || true
    info "Scenario schedule timer torn down"
else
    systemctl stop qmanager-scenario-schedule.timer 2>/dev/null || true
    rm -f /lib/systemd/system/timers.target.wants/qmanager-scenario-schedule.timer
    rm -f /etc/systemd/system/qmanager-scenario-schedule.timer
    systemctl daemon-reload 2>/dev/null || true
    info "Scenario schedule timer torn down (manual fallback)"
fi

# SIGTERM first, then SIGKILL stragglers — uninstall is terminal so
# we include update daemons that are normally excluded from service teardown
for proc in $(ls "$BIN_DIR"/qmanager_* 2>/dev/null | xargs -I{} basename {} 2>/dev/null); do
    killall -TERM "$proc" 2>/dev/null || true
done
sleep 1
for proc in $(ls "$BIN_DIR"/qmanager_* 2>/dev/null | xargs -I{} basename {} 2>/dev/null); do
    killall -KILL "$proc" 2>/dev/null || true
done

info "Daemon processes terminated"

# =============================================================================
# Step 2: Remove systemd unit files and boot symlinks
# =============================================================================

step "Removing systemd units and boot symlinks"

# Filesystem-driven: remove qmanager-*.service units and their wants symlinks
for unit_file in "$SYSTEMD_DIR"/qmanager-*.service "$SYSTEMD_DIR"/qmanager*.target; do
    [ -f "$unit_file" ] || continue
    svc=$(basename "$unit_file")
    rm -f "$WANTS_DIR/$svc"
    rm -f "$unit_file"
    _log_raw "  removed: $unit_file"
done

# QManager owns the lighttpd.service override — removing it restores Entware default
if [ -f "$SYSTEMD_DIR/lighttpd.service" ]; then
    rm -f "$WANTS_DIR/lighttpd.service"
    rm -f "$SYSTEMD_DIR/lighttpd.service"
    info "Removed QManager lighttpd.service override"
fi

# Clean up old /etc/systemd/system/ location from any previous installs
rm -f /etc/systemd/system/qmanager*.service /etc/systemd/system/qmanager*.target
rm -rf /etc/systemd/system/qmanager.target.wants

systemctl daemon-reload
info "Systemd units and boot symlinks removed"

# =============================================================================
# Step 3: Remove binaries and shared libraries
# =============================================================================

step "Removing binaries and shared libraries"

# QManager daemons and utilities
rm -f "$BIN_DIR"/qmanager_*
info "Removed /usr/bin/qmanager_*"

# Bundled transport and tool binaries
rm -f "$BIN_DIR/qcmd" "$BIN_DIR/qcmd_test"
rm -f "$BIN_DIR/atcli_smd11" "$BIN_DIR/sms_tool"
info "Removed qcmd, atcli_smd11, sms_tool"

# Shared libraries (includes staged tailscaled.service + qmanager_smd11_udev.sh)
rm -rf "$LIB_DIR"
info "Removed $LIB_DIR"

# Speedtest CLI installed by QManager installer into /usrdata/root/bin
rm -f /usrdata/root/bin/speedtest
rm -f /bin/speedtest
# Remove the containing dir only if it is now empty
rmdir /usrdata/root/bin 2>/dev/null || true
info "Removed speedtest CLI"

# =============================================================================
# Step 4: Remove udev rule
# =============================================================================

step "Removing udev rule for /dev/smd11"

if [ -f /etc/udev/rules.d/99-qmanager-smd11.rules ]; then
    rm -f /etc/udev/rules.d/99-qmanager-smd11.rules
    if command -v udevadm >/dev/null 2>&1; then
        udevadm control --reload-rules 2>/dev/null || true
    fi
    info "Removed udev rule and reloaded rules"
else
    info "No udev rule found (already removed)"
fi

# Console login-shell PATH snippet (installed by install_backend into
# /etc/profile.d). Lockstep with the installer — leaving it behind would keep
# prepending /opt/bin to every future login shell after QManager is gone.
if [ -f /etc/profile.d/qmanager-path.sh ]; then
    rm -f /etc/profile.d/qmanager-path.sh
    info "Removed console PATH snippet (/etc/profile.d/qmanager-path.sh)"
fi

# =============================================================================
# Step 5: Remove CGI, frontend, lighttpd config, and TLS certs
# =============================================================================

step "Removing CGI, frontend, lighttpd config, and TLS certs"

rm -rf "$WWW_ROOT"
info "Removed frontend and CGI endpoints ($WWW_ROOT)"

rm -f "$LIGHTTPD_CONF" "${LIGHTTPD_CONF}.bak"
info "Removed lighttpd config"

rm -rf "$CERT_DIR"
info "Removed TLS certs ($CERT_DIR)"

# =============================================================================
# Step 6: Remove sudoers rules
# =============================================================================

step "Removing sudoers rules"

if [ -n "$SUDOERS_FILE" ] && [ -f "$SUDOERS_FILE" ]; then
    rm -f "$SUDOERS_FILE"
    info "Removed sudoers rules from $SUDOERS_FILE"
else
    info "No sudoers rules to remove"
fi

# =============================================================================
# Step 7: Remove web console
# =============================================================================

step "Removing web console (ttyd)"

# Stop the console service before removing its binary
systemctl stop qmanager-console 2>/dev/null || true

rm -rf "$CONSOLE_DIR"
info "Removed console directory ($CONSOLE_DIR)"

# The qmanager-console.service unit was already removed in Step 2.
# Confirm the wants symlink is gone regardless of filesystem-scan order.
rm -f "$WANTS_DIR/qmanager-console.service"

info "Web console removed"

# =============================================================================
# Step 8: Tailscale teardown (--purge only)
# =============================================================================

if [ "$PURGE" = "1" ]; then
    step "Removing Tailscale"

    if systemctl is-active tailscaled >/dev/null 2>&1; then
        systemctl stop tailscaled 2>/dev/null || true
        info "tailscaled stopped"
    fi

    rm -f "$SYSTEMD_DIR/tailscaled.service"
    rm -f "$WANTS_DIR/tailscaled.service"

    # Binaries + persistent state (keys, node ID, peer database)
    rm -rf "$TAILSCALE_DIR"
    info "Removed $TAILSCALE_DIR (binaries + state)"

    # Two symlinks the installer creates for CLI accessibility
    rm -f /usrdata/root/bin/tailscale
    rm -f "$BIN_DIR/tailscale"

    rm -rf /etc/tailscale/

    systemctl daemon-reload
    info "Tailscale removed"
else
    step "Tailscale (preserved — use --purge to remove)"
    info "Tailscale preserved (use --purge to remove Tailscale and its state)"
fi

# =============================================================================
# Step 9: Firewall cleanup
# =============================================================================

step "Cleaning up firewall rules"

# Legacy TTL/MTU helper files that may persist independently of the service
rm -f /etc/firewall.user.ttl /etc/firewall.user.mtu 2>/dev/null || true

# The qmanager-firewall service (stopped in Step 1) runs ExecStop to flush
# its rules. The fallbacks below cover the case where the service was
# already gone before uninstall started — both the new chain-based layout
# and any pre-chain INPUT-direct rules from older installs are cleaned.
if command -v iptables >/dev/null 2>&1; then
    # New layout: tear down the QMANAGER_FW chain
    while iptables -C INPUT -j QMANAGER_FW 2>/dev/null; do
        iptables -D INPUT -j QMANAGER_FW 2>/dev/null || break
    done
    iptables -F QMANAGER_FW 2>/dev/null || true
    iptables -X QMANAGER_FW 2>/dev/null || true

    # Legacy layout: drain INPUT-direct rules from pre-chain installs
    for port in 80 443; do
        while iptables -C INPUT -p tcp --dport "$port" -j DROP 2>/dev/null; do
            iptables -D INPUT -p tcp --dport "$port" -j DROP 2>/dev/null || break
        done
        for iface in lo bridge0 eth0 tailscale0 rmnet_data0; do
            while iptables -C INPUT -i "$iface" -p tcp --dport "$port" -j ACCEPT 2>/dev/null; do
                iptables -D INPUT -i "$iface" -p tcp --dport "$port" -j ACCEPT 2>/dev/null || break
            done
            while iptables -C INPUT -i "$iface" -p tcp --dport "$port" -j DROP 2>/dev/null; do
                iptables -D INPUT -i "$iface" -p tcp --dport "$port" -j DROP 2>/dev/null || break
            done
        done
    done
fi

info "Firewall rules cleared"

# =============================================================================
# Step 10: Remove runtime state and temporary files
# =============================================================================

step "Removing runtime state and temporary files"

rm -f /tmp/qmanager_*.json  2>/dev/null || true
rm -f /tmp/qmanager.log*    2>/dev/null || true
rm -f /tmp/qmanager_*.pid   2>/dev/null || true
rm -f /tmp/qmanager_*.lock  2>/dev/null || true
rm -f /tmp/qmanager_speedtest_output /tmp/qmanager_speedtest_run.sh 2>/dev/null || true
rm -f /tmp/qmanager_email_reload /tmp/qmanager_sms_reload          2>/dev/null || true
rm -f /tmp/qmanager_sms_forward_reload /tmp/qmanager_sms_forward_seen 2>/dev/null || true
rm -f /tmp/qmanager_sms_forward_failures.json                       2>/dev/null || true
rm -f /tmp/qmanager_ping_reload /tmp/qmanager_ping_history          2>/dev/null || true
rm -f /tmp/qmanager_imei_check_done                                 2>/dev/null || true
rm -f /tmp/qmanager_low_power_active /tmp/qmanager_recovery_active  2>/dev/null || true
rm -f /tmp/qmanager_staged.tar.gz /tmp/qmanager_staged_version      2>/dev/null || true
rm -rf "$SESSION_DIR"

# Update artifacts that live under /etc/qmanager but are runtime, not config
rm -f "$CONF_DIR/VERSION.pending"                2>/dev/null || true
rm -f "$CONF_DIR/updates/previous_version"       2>/dev/null || true
rmdir "$CONF_DIR/updates"                        2>/dev/null || true

info "Runtime state removed"

# =============================================================================
# Step 11: Remove cron jobs
# =============================================================================

step "Removing cron jobs"

if crontab -l 2>/dev/null | grep -q qmanager; then
    crontab -l 2>/dev/null | grep -v qmanager | crontab - 2>/dev/null || true
    info "Removed qmanager cron jobs"
else
    info "No qmanager cron jobs found"
fi

# =============================================================================
# Step 12: Config directory and empty-dir cleanup
# =============================================================================

step "Config directory"

if [ "$PURGE" = "1" ]; then
    rm -rf "$CONF_DIR"
    info "Purged config directory $CONF_DIR"

    # Sidecar state files that live directly under $QMANAGER_ROOT (siblings
    # of www/, not inside it — install_frontend's www-wipe-and-recopy never
    # touches these, so they must be cleaned up here explicitly).
    # apn_names.json was a pre-existing orphan bug: it was never removed on
    # --purge, so it silently blocked the rmdir below from ever succeeding
    # and left /usrdata/qmanager/ behind after every purge uninstall.
    rm -f "$QMANAGER_ROOT/apn_setting.json" "$QMANAGER_ROOT/apn_names.json"
    info "Purged APN sidecar state (apn_setting.json, apn_names.json)"
elif [ -d "$CONF_DIR" ]; then
    warn "Config preserved at $CONF_DIR (use --purge to remove)"
fi

# Remove qmanager root only when empty (console + certs already gone;
# Tailscale teardown under --purge removes nothing here)
rmdir "$QMANAGER_ROOT" 2>/dev/null || true

# =============================================================================
# Finish
# =============================================================================

printf "\n"
printf "  ══════════════════════════════════════════\n"
printf "  ${GREEN}${BOLD}  QManager uninstalled successfully.${NC}\n"
printf "  ══════════════════════════════════════════\n\n"
printf "  ${DIM}Log: %s${NC}\n\n" "$LOG_FILE"

if [ "$NO_REBOOT" = "1" ]; then
    info "Skipping reboot (--no-reboot). Some changes (udev, kernel modules) require a reboot to take full effect."
    exit 0
fi

printf "  Rebooting in 5 seconds — press Ctrl+C to cancel...\n\n"
sync
sleep 5
reboot
