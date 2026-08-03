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

# --- Logging stubs (defensive — caller may not have sourced qlog.sh) ---------
. /usr/lib/qmanager/qlog.sh 2>/dev/null || {
    qlog_init()  { :; }
    qlog_debug() { :; }
    qlog_info()  { :; }
    qlog_warn()  { :; }
    qlog_error() { :; }
}

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

# Ensure the rootfs is writable before a root-side symlink write. Only ever
# called when running as root ($_SUDO empty) — www-data has no mount grant
# (confirmed via `sudo -l -U www-data`) and must not attempt a remount; on
# that path we go straight to the ln/rm and just detect+report the failure.
# Probe-then-remount, matching install_rm520n.sh's preflight() and
# qmanager_setup — never remount back to ro.
_svc_ensure_rw() {
    if ! touch /usr/.qm_rw_test 2>/dev/null; then
        mount -o remount,rw / 2>/dev/null
    fi
    rm -f /usr/.qm_rw_test 2>/dev/null
}

svc_enable() {
    local unit="$(_svc_unit "$1").service"
    local err

    # `if`, not `[ ... ] && ...` — the && form evaluates to 1 on the www-data
    # path (where the test is false), which would abort the whole function
    # under a caller running `set -e`, looking exactly like the silent
    # enable-failure this code exists to fix. No caller sets -e today.
    if [ -z "$_SUDO" ]; then
        _svc_ensure_rw
    fi

    err=$($_SUDO /bin/ln -sf "$_UNIT_DIR/$unit" "$_WANTS_DIR/$unit" 2>&1 >/dev/null)
    [ -n "$err" ] && qlog_warn "svc_enable($1): ln failed: $err"

    if [ -L "$_WANTS_DIR/$unit" ]; then
        return 0
    fi
    qlog_warn "svc_enable($1): boot symlink missing after enable attempt ($_WANTS_DIR/$unit)"
    return 1
}

# Disable a service (remove boot symlink)
svc_disable() {
    local unit="$(_svc_unit "$1").service"
    local err

    # `if`, not `[ ... ] && ...` — see the note in svc_enable().
    if [ -z "$_SUDO" ]; then
        _svc_ensure_rw
    fi

    err=$($_SUDO /bin/rm -f "$_WANTS_DIR/$unit" 2>&1 >/dev/null)
    [ -n "$err" ] && qlog_warn "svc_disable($1): rm failed: $err"

    if [ ! -L "$_WANTS_DIR/$unit" ]; then
        return 0
    fi
    qlog_warn "svc_disable($1): boot symlink still present after disable attempt ($_WANTS_DIR/$unit)"
    return 1
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
