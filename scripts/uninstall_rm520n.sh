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

# Remount rootfs read-write — /usr and /lib live on the read-only root (ubi0).
# NOT /etc: that is a bind mount of ubi2_0, always rw, unaffected by this call.
# Left rw afterwards, matching install_rm520n.sh and qmanager_setup — the tree's
# convention is "remount rw once, never restore ro". See docs/BACKEND.md.
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

# Scheduled Reboot timer teardown — same shape: runtime-armed by
# qmanager_scheduled_reboot_arm, never a static installer-shipped .timer, so
# it is not caught by the qmanager-*.service glob in Step 2 either. Must run
# here, before Step 3 removes the arm helper binary itself.
if [ -x "$BIN_DIR/qmanager_scheduled_reboot_arm" ]; then
    "$BIN_DIR/qmanager_scheduled_reboot_arm" teardown >/dev/null 2>&1 || true
    info "Scheduled reboot timer torn down"
else
    systemctl stop qmanager-scheduled-reboot.timer 2>/dev/null || true
    rm -f /lib/systemd/system/timers.target.wants/qmanager-scheduled-reboot.timer
    rm -f /etc/systemd/system/qmanager-scheduled-reboot.timer
    systemctl daemon-reload 2>/dev/null || true
    info "Scheduled reboot timer torn down (manual fallback)"
fi

# Tower Lock schedule timer PAIR teardown — same shape, one helper call tears
# down both qmanager-tower-schedule-apply.timer and
# qmanager-tower-schedule-clear.timer.
if [ -x "$BIN_DIR/qmanager_tower_schedule_arm" ]; then
    "$BIN_DIR/qmanager_tower_schedule_arm" teardown >/dev/null 2>&1 || true
    info "Tower lock schedule timers torn down"
else
    systemctl stop qmanager-tower-schedule-apply.timer qmanager-tower-schedule-clear.timer 2>/dev/null || true
    rm -f /lib/systemd/system/timers.target.wants/qmanager-tower-schedule-apply.timer
    rm -f /lib/systemd/system/timers.target.wants/qmanager-tower-schedule-clear.timer
    rm -f /etc/systemd/system/qmanager-tower-schedule-apply.timer
    rm -f /etc/systemd/system/qmanager-tower-schedule-clear.timer
    systemctl daemon-reload 2>/dev/null || true
    info "Tower lock schedule timers torn down (manual fallback)"
fi

# Traffic Engine (DPI bypass) rule teardown — dpi_state.sh installs an
# iptables `nat` PREROUTING REDIRECT sending LAN tcp/80,443 to the tpws
# engine's port. That rule is not owned by any systemd unit — stopping
# qmanager-dpi-ensure.timer below only stops the periodic re-assertion of
# it, it never removes it — so a live REDIRECT rule survives uninstall and
# points at a dead port, breaking every LAN client's HTTP/HTTPS until QCMAP
# next flushes iptables. Must run here, before Step 3 removes the helper
# binary and /usr/lib/qmanager/dpi_state.sh it sources.
if [ -x "$BIN_DIR/qmanager_dpi_run" ]; then
    "$BIN_DIR/qmanager_dpi_run" --clear >/dev/null 2>&1 || true
    info "Traffic Engine REDIRECT rule torn down"
fi

# Auto-update timer teardown — unlike the three runtime-armed timers above,
# this is a STATIC installer-shipped .timer, so it is caught by neither the
# qmanager-*.service glob in Step 2 nor an arm-helper teardown verb (the
# helper's disarm only drops the symlink; it never removes the unit file).
# Its wants-symlink also lives in timers.target.wants/, not the
# multi-user.target.wants/ ($WANTS_DIR) that Step 2 knows about. Remove the
# symlink AND the unit file here, before Step 3 removes the arm helper binary.
systemctl stop qmanager-auto-update.timer 2>/dev/null || true
rm -f /lib/systemd/system/timers.target.wants/qmanager-auto-update.timer
rm -f "$SYSTEMD_DIR/qmanager-auto-update.timer"
systemctl daemon-reload 2>/dev/null || true
info "Auto-update timer torn down"

# Traffic Engine ensure timer teardown — same static-installer shape as the
# auto-update timer above (shipped by the installer, timers.target.wants
# symlink, not covered by the qmanager-*.service glob). The engine unit
# files themselves are removed by the Step 2 glob; only the .timer needs
# explicit handling.
systemctl stop qmanager-dpi-ensure.timer 2>/dev/null || true
rm -f /lib/systemd/system/timers.target.wants/qmanager-dpi-ensure.timer
rm -f "$SYSTEMD_DIR/qmanager-dpi-ensure.timer"
systemctl daemon-reload 2>/dev/null || true
info "Traffic Engine ensure timer torn down"

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

# The installer disables Entware's S80lighttpd so it can never win the
# boot-time port-80 race against QManager's lighttpd.service. Now that we've
# just removed that unit, restore S80lighttpd so the device still has a web
# server on port 80 after uninstall — leaving it disabled would strand the
# device with no web server at all. opt.mount's wants symlink is intentionally
# left alone: Entware is preserved unconditionally and still needs /opt mounted.
# qmanager-wait-usrdata.service (F11) IS removed, by the qmanager-*.service glob
# above. That is correct: /opt then races /usrdata again exactly as it did
# pre-QManager, with start-opt-mount.service — also left alone — still the
# fallback that gets it mounted.
if [ -f /opt/etc/init.d/S80lighttpd ] && [ ! -x /opt/etc/init.d/S80lighttpd ]; then
    # `a+x`, not a bare `+x`: a bare `+x` skips umask-set bits, so a masked u+x
    # would silently leave the device with no web server after uninstall.
    chmod a+x /opt/etc/init.d/S80lighttpd
    info "Restored Entware S80lighttpd"
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

# One glob, not a maintained list. The previous form matched only *.json, *.pid
# and *.lock plus a hand-kept roster of named files, so every EXTENSION-LESS
# runtime file survived an uninstall until the next reboot — the scan error
# files, the long-running maintenance marker, three watchcat flags and the
# events reload flag were all leaking, and the roster had already been extended
# three times without closing the class. A prefix glob closes it permanently:
# every file this product writes to /tmp is named `qmanager_*` by convention.
#
# Safe because uninstall is terminal and standalone — it is never invoked from
# the OTA path (`qmanager_update`), so there is no in-flight staging state to
# protect. Directories under the prefix (`qmanager_install`, the session dir)
# fail this `rm -f` with EISDIR, which `|| true` swallows exactly as before;
# `$SESSION_DIR` is still removed explicitly below.
#
# `qmanager.log*` needs its own line: a dot follows the prefix there, not an
# underscore, so `qmanager_*` does not match it.
rm -f  /tmp/qmanager_*   2>/dev/null || true
rm -f  /tmp/qmanager.log* 2>/dev/null || true
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

# Scrub qmanager markers directly from the spool file rather than shelling
# out to `crontab` — RM520N-GL has no functioning cron (no crond unit, no
# boot symlink; the BusyBox crond/crontab binaries being present is not
# evidence anything consumes crontabs), and on this device `crontab -l`
# itself errors ("can't open 'root'"), so the old grep|crontab pipeline
# never actually matched. Mirrors scrub_legacy_cron() in qmanager_update.
CRON_FILE="/var/spool/cron/crontabs/root"
if [ -f "$CRON_FILE" ] && grep -q qmanager "$CRON_FILE" 2>/dev/null; then
    # Temp file lives in the same directory as CRON_FILE so the mv below is
    # an atomic same-filesystem rename(2), not a cross-filesystem copy.
    CRON_TMP="${CRON_FILE}.tmp"
    # grep exits 1 when it selects NO lines. For `grep -v` that means every
    # line was a qmanager entry — i.e. the crontab is entirely ours, the case
    # this step most needs to handle. Testing the pipeline directly would
    # short-circuit on that exit 1 and silently leave our entries behind, so
    # capture the status and treat 0 and 1 alike; only 2+ is a real error.
    # (`|| rc=$?` also keeps this safe under the `set -e` at the top of the
    # file — a bare non-zero command there would abort the uninstall.)
    CRON_RC=0
    grep -v qmanager "$CRON_FILE" > "$CRON_TMP" 2>/dev/null || CRON_RC=$?
    if [ "$CRON_RC" -le 1 ]; then
        # crontabs are conventionally 0600 root:root; set that on the temp
        # file before the rename, since the `>` redirect above creates it
        # with the ambient umask.
        chmod 600 "$CRON_TMP" 2>/dev/null || true
        # Report success only if the rename actually happened — swallowing
        # mv's status with `|| true` and then claiming success would leave
        # the entries in place while telling the user they were removed.
        if mv "$CRON_TMP" "$CRON_FILE" 2>/dev/null; then
            info "Removed qmanager cron jobs"
        else
            rm -f "$CRON_TMP" 2>/dev/null || true
            warn "Could not replace $CRON_FILE — qmanager cron entries left in place"
        fi
    else
        rm -f "$CRON_TMP" 2>/dev/null || true
        warn "Could not scrub qmanager cron entries from $CRON_FILE"
    fi
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

    # The daemon EnvironmentFile is user config (QLOG_LEVEL, and the
    # PING_PROFILE / PING_TARGET_IPV4 / PING_TARGET_IPV6 manual overrides
    # documented in qmanager-ping.service), so it follows the same
    # "preserved unless --purge" contract as everything else in $CONF_DIR.
    # It needs its own line because it deliberately lives OUTSIDE $CONF_DIR —
    # /etc/qmanager is www-data-owned and a www-data-writable EnvironmentFile
    # for four root daemons is a privilege-escalation path (see
    # migrate_environment_location() in install_rm520n.sh). The `rm -rf`
    # above therefore does not reach it. Same orphan class as the APN
    # sidecars below.
    rm -f /etc/qmanager.env
    info "Purged daemon environment file (/etc/qmanager.env)"

    # Alert secrets store — the Discord bot token, the Gmail app password, and
    # msmtprc (which holds that password in cleartext by construction). Same
    # orphan class as /etc/qmanager.env above: it deliberately lives OUTSIDE
    # $CONF_DIR — /etc/qmanager is www-data-owned, so nothing secret can be
    # protected inside it (see migrate_alert_secrets() in install_rm520n.sh) —
    # so the `rm -rf "$CONF_DIR"` above does not reach it. Without this line a
    # purge uninstall leaves a LIVE bot token and a plaintext Gmail app
    # password on disk after the user believes QManager is gone.
    rm -rf /etc/qmanager-secrets
    info "Purged alert secrets store (/etc/qmanager-secrets)"

    # Auth-backup store — the timestamped auth.json snapshots, i.e. the
    # operator's QManager login password, up to 5 generations of it. Third
    # member of the same orphan class as the two above: it deliberately lives
    # OUTSIDE $CONF_DIR because /etc/qmanager is www-data-owned and nothing
    # inside it can be protected from www-data (see migrate_backup_location()
    # in install_rm520n.sh), so the `rm -rf "$CONF_DIR"` above does not reach
    # it. Without this line a purge uninstall leaves the password history on
    # disk after the user believes QManager is gone.
    rm -rf /etc/qmanager-backups
    info "Purged auth backup store (/etc/qmanager-backups)"

    # Sidecar state files that live directly under $QMANAGER_ROOT (siblings
    # of www/, not inside it — install_frontend's www-wipe-and-recopy never
    # touches these, so they must be cleaned up here explicitly).
    # apn_names.json was a pre-existing orphan bug: it was never removed on
    # --purge, so it silently blocked the rmdir below from ever succeeding
    # and left /usrdata/qmanager/ behind after every purge uninstall.
    #
    # Both sidecars now live in $CONF_DIR, which the `rm -rf` above already
    # removes. This line is kept for the LEGACY path: a device uninstalled
    # before it ever OTA'd through migrate_apn_sidecars() still has them here,
    # and leaving either one behind re-strands /usrdata/qmanager/. Do not drop
    # it just because the new location is covered.
    rm -f "$QMANAGER_ROOT/apn_setting.json" "$QMANAGER_ROOT/apn_names.json"
    info "Purged APN sidecar state (apn_setting.json, apn_names.json)"

    # Language-pack persistent store (Increment B) — same shape as the APN
    # sidecars above: created directly under $QMANAGER_ROOT, outside www/, so
    # install_frontend's www-wipe never touches them and, left behind, they
    # silently block the rmdir below and strand /usrdata/qmanager/ after purge.
    rm -rf "$QMANAGER_ROOT/locales-packs" "$QMANAGER_ROOT/locales-staging"
    info "Purged language-pack store (locales-packs, locales-staging)"
elif [ -d "$CONF_DIR" ]; then
    warn "Config preserved at $CONF_DIR, /etc/qmanager.env, /etc/qmanager-secrets and /etc/qmanager-backups (use --purge to remove)"
    warn "/etc/qmanager-secrets still holds the Discord token / email app password (root-only, 0700)"
    warn "/etc/qmanager-backups still holds up to 5 auth.json password snapshots (root-only, 0700)"
fi

# Custom DNS staging dir (/etc/data/qmanager) — installer-created scratch space
# for the atomic dnsmasq.conf rename; not user config, safe to remove on every
# uninstall (independent of --purge).
rm -rf /etc/data/qmanager

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
