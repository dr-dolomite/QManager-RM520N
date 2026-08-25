#!/bin/sh
# platform.sh — Service control abstraction (RM520N-GL / systemd)
# Replaces direct /etc/init.d/* calls with systemctl equivalents.
# Adds sudo for privileged operations (lighttpd runs as www-data).

# `${_PLATFORM_LOADED:-}`, not `$_PLATFORM_LOADED`: a caller running under
# `set -u` (qmanager_health_check does) aborts on an unset reference, and
# sourcing a lib whose FIRST line kills the caller is not something a
# `. lib 2>/dev/null || { fallback; }` guard can rescue — the shell is
# already gone. Measured 2026-08-25; the rest of this file is set -u clean.
[ -n "${_PLATFORM_LOADED:-}" ] && return 0
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

# --- qm_timeout: portable `timeout` wrapper (BusyBox 1.29 vs 1.31 straddle) --
# This is the canonical copy, for any future consumer that already sources
# this lib. install_rm520n.sh and qmanager_health_check each carry their own
# LOCAL COPY, deliberately:
#   - the installer runs BEFORE this lib is deployed (libs land later in the
#     run, and --frontend-only never deploys them at all while still running
#     the verification code that calls qm_timeout), and an installer whose
#     own checks depend on the artifacts it just deployed cannot report
#     honestly on a failed deploy;
#   - qmanager_health_check ships in the same payload as this lib but is
#     redeployed by OTA independently of it, so a device mid-upgrade can have
#     a platform.sh that predates qm_timeout. A source-with-fallback would
#     need the fallback to be a full working copy anyway, so the copy is the
#     simpler construction with no failure mode.
# Keep all three in sync — a change to the BusyBox-version rationale, the
# 143->124 remap, or the fail-open bound belongs in every copy.
# scripts/test/timeout-portability.sh FAILS if they diverge.
#
# BusyBox changed `timeout`'s CLI in 1.30: SECS went from an option (`-t SECS`)
# to a positional first argument, and `-t` was dropped. RG501Q-EU (v1.29.3)
# and RM520N-GL (v1.31.1) straddle that change, so no single literal
# invocation of `timeout SECS CMD...` works on both — one device treats
# "SECS" as the program to exec and fails with exit 127.
#
# `command -v timeout` is useless for detection: BusyBox always provides the
# applet on both devices, so that probe can never tell you which CLI form it
# accepts — that's exactly the mistake that caused this bug. Instead we probe
# BEHAVIOUR once at load time: run `timeout 1 true` and check for exit 127.
# 127 means the shell could not execute "1" as a program, i.e. this build
# expects the legacy `-t SECS` form. Any other exit (0, 124, 143, ...) means
# the positional/coreutils form was accepted.
#
# Resolution is by absolute path only, never $PATH — a root helper invoked as
# `setsid sudo -n ...` gets a PATH with no /opt/bin (measured), so a coreutils
# `timeout` installed via Entware at /opt/bin/timeout would silently vanish
# for exactly the caller that needs it if we ever relied on PATH lookup.
# Every probe below uses "cmd || rc=$?" rather than a bare "cmd; rc=$?" — a
# bare statement whose non-zero exit isn't part of an if/while/&&/|| test
# trips `set -e` in any caller that has it active (install_rm520n.sh's local
# copy of this block does), aborting the whole script on the very probe
# that's SUPPOSED to be testing for exactly that non-zero exit.
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

# qm_timeout SECS COMMAND [ARGS...]
# Callers always write the coreutils (positional) form; this dispatches to
# whichever CLI shape the resolved binary actually accepts, and normalizes
# the "command was killed for running too long" exit status to 124 — GNU
# coreutils timeout hardcodes 124 when IT enforces the deadline, but BusyBox
# timeout just relays the killed child's raw wait status (SIGTERM → 128+15 =
# 143). Callers that test for 124 (the documented contract, e.g.
# qmanager_health_check:499) would otherwise see a dead branch on both target
# devices, since neither ships coreutils-timeout.
#
# The remap below (rc==143 -> 124) is intentionally scoped to *inside this
# function only* — it is not a codebase-wide "143 means timeout" rule. Within
# qm_timeout's own boundary a 143 can only come from: (a) the BusyBox binary
# relaying its own SIGTERM-kill of the child we just asked it to bound, or
# (b) our manual fail-open branch, which sets rc=143 itself right before this
# line specifically to mean "I killed it". In both cases 143 == "qm_timeout's
# own bound fired". The one theoretical false positive is a child that races
# its own *unrelated* SIGTERM death against the deadline under the BusyBox
# binary — accepted, since BusyBox's timeout gives us no way to distinguish
# the two and misreporting that rare race as "timed out" is strictly safer
# for a warn-only diagnostic caller than misreporting a real timeout as a
# clean exit.
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
        # an unbounded call inside a `set -e` installer would hang the whole
        # install, which is the exact hazard `timeout` exists to prevent.
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
