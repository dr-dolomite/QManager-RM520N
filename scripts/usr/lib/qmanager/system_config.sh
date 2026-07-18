#!/bin/sh
# system_config.sh — System settings abstraction (RM520N-GL)
# Replaces UCI system.@system[0].* reads/writes with standard Linux APIs.
# Hostname and timezone are stored in qmanager.conf for persistence across
# read-only rootfs remounts, and applied to the live system.

[ -n "$_SYSTEM_CONFIG_LOADED" ] && return 0
_SYSTEM_CONFIG_LOADED=1

. /usr/lib/qmanager/config.sh

# --- Hostname ----------------------------------------------------------------

# Get current hostname
# Falls back to qmanager.conf → /etc/hostname → "RM520N-GL"
sys_get_hostname() {
    local h
    h=$(qm_config_get settings hostname "")
    if [ -z "$h" ] && [ -f /etc/hostname ]; then
        h=$(cat /etc/hostname 2>/dev/null | tr -d '[:space:]')
    fi
    [ -z "$h" ] && h="RM520N-GL"
    printf '%s' "$h"
}

# Set hostname (persists to config + applies live)
sys_set_hostname() {
    local name="$1"
    [ -z "$name" ] && return 1
    qm_config_set settings hostname "$name"
    # Apply to running system
    echo "$name" > /proc/sys/kernel/hostname 2>/dev/null
    # Persist to /etc/hostname (requires remount if rootfs is ro)
    if [ -w /etc/hostname ] || mount -o remount,rw / 2>/dev/null; then
        echo "$name" > /etc/hostname 2>/dev/null
    fi
}

# --- Timezone ----------------------------------------------------------------

# Get current timezone string (POSIX TZ, e.g., "UTC0", "PST8PDT")
sys_get_timezone() {
    local tz
    tz=$(qm_config_get settings timezone "UTC0")
    printf '%s' "$tz"
}

# Get timezone display name (e.g., "America/Los_Angeles")
sys_get_zonename() {
    local zn
    zn=$(qm_config_get settings zonename "UTC")
    printf '%s' "$zn"
}

# Set timezone (persists to config + applies live)
# Args: $1 = POSIX TZ string, $2 = zone name (IANA, e.g., "Asia/Manila")
# Stdout: status token — one of:
#   applied       — helper ran and installed the TZif successfully
#   failed        — helper ran but reported an error (zone not found, copy failed, etc.)
#   not_attempted — tz was valid but zonename ($2) was empty, so no live-apply was tried
#   invalid       — tz itself was empty; nothing was persisted (also returns 1)
# NOTE: does NOT export TZ or write /etc/TZ — glibc 2.31 on this platform reads
# /etc/localtime, not /etc/TZ, and leaving TZ exported here would leak into the
# rest of this CGI process and corrupt any later `date`-based effective-tz check.
sys_set_timezone() {
    local tz="$1" zn="${2:-}" status
    [ -z "$tz" ] && { printf 'invalid'; return 1; }
    qm_config_set settings timezone "$tz"
    [ -n "$zn" ] && qm_config_set settings zonename "$zn"

    if [ -z "$zn" ]; then
        printf 'not_attempted'
        return 0
    fi

    # Apply to running system via the root helper (www-data cannot write /etc directly).
    if sudo -n /usr/bin/qmanager_timezone_apply "$zn" >/dev/null 2>&1; then
        status="applied"
    else
        status="failed"
        qlog_warn "qmanager_timezone_apply failed for zone $zn"
    fi

    # NOTE: scheduled-reboot / low-power cron windows adopt the new timezone on
    # the NEXT device reboot, not instantly. RM520N-GL's cron is BusyBox crond
    # writing /var/spool/cron/crontabs/root directly — it is NOT a systemd unit
    # under any name (verified on-device: cron/crond/busybox-cron/cronie all
    # absent), and glibc caches the zone per-process at start, so a running
    # crond cannot be made to re-read /etc/localtime without a fresh start.
    # We deliberately do NOT attempt an in-request restart (it would be dead or
    # unreliable code); the natural next-boot start picks up /etc/localtime.
    # date/log/alert timestamps are unaffected — each is a fresh process that
    # reads /etc/localtime at exec time. See docs/reference/timezone.md.

    printf '%s' "$status"
    return 0
}

# Get the LIVE effective timezone vs. what's configured, so GET can report
# ground truth rather than just echoing config back. Since we COPY a TZif into
# /etc/localtime (no symlink), readlink can't recover the zone name — instead
# compare the live UTC offset against the offset recomputed from tzdata for
# the configured zone.
# Stdout: "<live_offset> <expected_offset> <applied:0|1> <live_zone_abbr>"
#   e.g. "+0800 +0800 1 PHT"
sys_get_effective_tz() {
    local configured_zn live_offset expected_offset applied abbr tzdir d
    configured_zn=$(sys_get_zonename); [ -z "$configured_zn" ] && configured_zn="UTC"
    live_offset=$(date +%z 2>/dev/null); [ -z "$live_offset" ] && live_offset="+0000"
    abbr=$(date +%Z 2>/dev/null)

    tzdir=""
    for d in /opt/share/zoneinfo /usr/share/zoneinfo; do
        [ -f "$d/$configured_zn" ] && { tzdir="$d"; break; }
    done
    if [ -z "$tzdir" ] && [ "$configured_zn" = "UTC" ]; then
        for d in /opt/share/zoneinfo /usr/share/zoneinfo; do
            [ -f "$d/Etc/UTC" ] && { tzdir="$d"; configured_zn="Etc/UTC"; break; }
        done
    fi

    if [ -n "$tzdir" ]; then
        expected_offset=$(TZDIR="$tzdir" TZ="$configured_zn" date +%z 2>/dev/null)
    else
        expected_offset=""
    fi

    if [ -n "$expected_offset" ] && [ "$live_offset" = "$expected_offset" ]; then
        applied="1"
    else
        applied="0"
    fi

    printf '%s %s %s %s' "$live_offset" "${expected_offset:-unknown}" "$applied" "${abbr:-UTC}"
}
