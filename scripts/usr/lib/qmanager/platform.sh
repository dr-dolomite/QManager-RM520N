#!/bin/sh
# platform.sh — Service control abstraction (RM520N-GL / systemd)
# Replaces direct /etc/init.d/* calls with systemctl equivalents.
# Adds sudo for privileged operations (lighttpd runs as www-data).

[ -n "$_PLATFORM_LOADED" ] && return 0
_PLATFORM_LOADED=1

# Detect sudo path — Entware (/opt/bin/sudo) or system (/usr/bin/sudo)
# When running as root (daemons), sudo is skipped entirely.
if [ "$(id -u)" -eq 0 ]; then
    _SUDO=""
elif [ -x /opt/bin/sudo ]; then
    _SUDO="/opt/bin/sudo"
elif [ -x /usr/bin/sudo ]; then
    _SUDO="/usr/bin/sudo"
else
    _SUDO="sudo"
fi

# Map QManager service names to systemd unit names.
# Input: procd-style name (e.g., "qmanager_watchcat")
# Output: systemd unit name (e.g., "qmanager-watchcat")
_svc_unit() {
    printf '%s' "$1" | sed 's/_/-/g'
}

# Full paths — Entware sudo's secure_path doesn't include /sbin or /usr/sbin
_SYSTEMCTL="/bin/systemctl"

# Start a service
svc_start() {
    $_SUDO $_SYSTEMCTL start "$(_svc_unit "$1")" 2>/dev/null
}

# Stop a service
svc_stop() {
    $_SUDO $_SYSTEMCTL stop "$(_svc_unit "$1")" 2>/dev/null
}

# Restart a service
svc_restart() {
    $_SUDO $_SYSTEMCTL restart "$(_svc_unit "$1")" 2>/dev/null
}

# Enable a service (start on boot via symlink — SimpleAdmin pattern).
# NOTE: `systemctl enable` is NOT actually broken on this systemd 244 — it works, but
# it writes its symlink into /etc/systemd/system/...wants/ while `systemctl is-enabled`
# only ever reads /etc. Every deployed qmanager unit is enabled via a /lib symlink (the
# installer's enable_services + these helpers), which is invisible to `is-enabled` and
# whose boot-honoring from /etc is unverified on this minimal systemd. So we deliberately
# stay on explicit /lib symlinks for ONE consistent source of truth. Do NOT "simplify"
# these to `systemctl enable/disable/is-enabled`: a live audit showed a naive swap would
# silently leave a UI-disabled unit (e.g. the connection watchdog) still autostarting
# from its legacy /lib symlink. Any migration must relocate the whole fleet in lockstep
# (installer + qmanager_health_check included). See docs/reference/qmanager-independence.md.
_WANTS_DIR="/lib/systemd/system/multi-user.target.wants"
_UNIT_DIR="/lib/systemd/system"

svc_enable() {
    local unit="$(_svc_unit "$1").service"
    $_SUDO /bin/ln -sf "$_UNIT_DIR/$unit" "$_WANTS_DIR/$unit" 2>/dev/null
}

# Disable a service (remove boot symlink)
svc_disable() {
    local unit="$(_svc_unit "$1").service"
    $_SUDO /bin/rm -f "$_WANTS_DIR/$unit" 2>/dev/null
}

# Check if a service is enabled (boot symlink exists)
svc_is_enabled() {
    local unit="$(_svc_unit "$1").service"
    [ -L "$_WANTS_DIR/$unit" ]
}

# Check if a service is currently running
svc_is_running() {
    $_SUDO $_SYSTEMCTL is-active "$(_svc_unit "$1")" >/dev/null 2>&1
}

# Privileged command helpers — add sudo prefix for www-data context
run_iptables() {
    $_SUDO /usr/sbin/iptables "$@"
}

run_ip6tables() {
    $_SUDO /usr/sbin/ip6tables "$@"
}

run_reboot() {
    $_SUDO /sbin/reboot "$@"
}

# Check if a process is alive by PID — works cross-user (unlike kill -0).
# On RM520N-GL, CGI runs as www-data but daemons run as root.
# kill -0 fails with EPERM across user boundaries; /proc/$pid always works.
# Usage: pid_alive <pid>
pid_alive() {
    [ -n "$1" ] && [ -d "/proc/$1" ]
}
