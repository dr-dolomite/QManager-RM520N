#!/bin/sh
# =============================================================================
# crash_log.sh — Root-owned reboot-cause log: path + one-time migration
# =============================================================================
# The log lives in /usrdata/qmanager (root:root 0755), NOT /etc/qmanager: that
# directory is www-data-owned and non-sticky, so www-data could swap the file
# for a symlink between a root writer's check and its chown/chmod/append.
# Writers are root only (watchcat, scheduled_reboot, qmanager_crash_log_append);
# the file is 0644 so any reader (alert_engine.sh, CGI) can still read it.
#
# Sourced by sh and bash. Provides: QM_CRASH_LOG, qm_crash_log_prepare.
# Install location: /usr/lib/qmanager/crash_log.sh
# =============================================================================

[ -n "${_QM_CRASH_LOG_LOADED:-}" ] && return 0
_QM_CRASH_LOG_LOADED=1

QM_CRASH_LOG_DIR="/usrdata/qmanager"
QM_CRASH_LOG="$QM_CRASH_LOG_DIR/crash.log"
_QM_CRASH_LOG_MIGRATED="$QM_CRASH_LOG_DIR/.crash_log_migrated"
_QM_CRASH_LOG_LEGACY="/etc/qmanager/crash.log"

# qm_crash_log_prepare — root only. Ensure the directory, merge the legacy
# www-data-writable log exactly once, then drop the legacy path. Never fails the caller.
qm_crash_log_prepare() {
    [ "$(id -u 2>/dev/null)" = "0" ] || return 0
    [ -d "$QM_CRASH_LOG_DIR" ] || install -d -o root -g root -m 0755 "$QM_CRASH_LOG_DIR" 2>/dev/null

    [ -e "$_QM_CRASH_LOG_LEGACY" ] || [ -L "$_QM_CRASH_LOG_LEGACY" ] || return 0
    # A real legacy log is a regular file; anything else is never read.
    if [ ! -f "$_QM_CRASH_LOG_MIGRATED" ] && [ ! -L "$_QM_CRASH_LOG_LEGACY" ] && [ -f "$_QM_CRASH_LOG_LEGACY" ]; then
        # Read failed (e.g. no sudo before /opt mounts): keep the legacy file for next time.
        _qm_crash_log_migrate || return 0
    fi
    # Merged once (marker set): later legacy files could only be forged by www-data.
    rm -f "$_QM_CRASH_LOG_LEGACY" 2>/dev/null
    return 0
}

# Read the legacy file AS www-data (never `su`, it hangs here) so a symlink
# planted there cannot make root disclose a root-only file; keep only
# well-formed lines, merged ahead of anything already logged, bounded.
_qm_crash_log_migrate() {
    local sudo_bin raw="$QM_CRASH_LOG.mig.raw" tmp="$QM_CRASH_LOG.mig.tmp"
    # systemd's default PATH lacks /opt/bin, where Entware's sudo lives.
    sudo_bin=$(PATH=/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin command -v sudo 2>/dev/null) || return 1
    [ -n "$sudo_bin" ] || return 1
    rm -f "$raw" "$tmp" 2>/dev/null
    # Bounded read: qm_timeout covers the BusyBox 1.29/1.31 timeout CLI split.
    if command -v qm_timeout >/dev/null 2>&1; then
        qm_timeout 5 "$sudo_bin" -n -u www-data cat "$_QM_CRASH_LOG_LEGACY" </dev/null >"$raw" 2>/dev/null
    elif timeout 1 true 2>/dev/null; [ $? -ne 127 ]; then
        timeout 5 "$sudo_bin" -n -u www-data cat "$_QM_CRASH_LOG_LEGACY" </dev/null >"$raw" 2>/dev/null
    else
        timeout -t 5 "$sudo_bin" -n -u www-data cat "$_QM_CRASH_LOG_LEGACY" </dev/null >"$raw" 2>/dev/null
    fi || { rm -f "$raw"; return 1; }
    # A non-empty legacy log that read back empty is a failed read, not an empty log.
    if [ ! -s "$raw" ] && [ -s "$_QM_CRASH_LOG_LEGACY" ]; then
        rm -f "$raw"; return 1
    fi
    { grep -E '^[0-9]+\|[A-Za-z_]+\|[A-Za-z0-9_]+$' "$raw" 2>/dev/null
      [ -f "$QM_CRASH_LOG" ] && [ ! -L "$QM_CRASH_LOG" ] && cat "$QM_CRASH_LOG" 2>/dev/null
    } | tail -n 100 > "$tmp" 2>/dev/null
    rm -f "$raw"
    chmod 644 "$tmp" 2>/dev/null
    mv "$tmp" "$QM_CRASH_LOG" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; return 1; }
    : > "$_QM_CRASH_LOG_MIGRATED" 2>/dev/null
    return 0
}
