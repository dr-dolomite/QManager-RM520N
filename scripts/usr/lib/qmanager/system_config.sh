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
sys_set_timezone() {
    local tz="$1" zn="${2:-}"
    [ -z "$tz" ] && return 1
    qm_config_set settings timezone "$tz"
    [ -n "$zn" ] && qm_config_set settings zonename "$zn"
    # Apply to running system: symlink /etc/localtime (standard Linux)
    if [ -n "$zn" ] && [ -f "/usr/share/zoneinfo/$zn" ]; then
        ln -sf "/usr/share/zoneinfo/$zn" /etc/localtime 2>/dev/null
    fi
    # Also export TZ for the current process and /etc/TZ as fallback
    export TZ="$tz"
    echo "$tz" > /etc/TZ 2>/dev/null
}
