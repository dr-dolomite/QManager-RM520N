#!/bin/sh
# config.sh — QManager Configuration Helper (RM520N-GL)
# Drop-in replacement for UCI get/set/commit operations.
# Uses a single JSON config file with jq for reads and writes.

[ -n "$_CONFIG_LOADED" ] && return 0
_CONFIG_LOADED=1

QM_CONFIG="/etc/qmanager/qmanager.conf"
QM_CONFIG_LOCK="/etc/qmanager/qmanager.conf.lock"

# Lock is 0644 and opened read-only; noclobber (O_EXCL) refuses a planted symlink.
_qm_config_lock_ready() {
    [ -L "$QM_CONFIG_LOCK" ] && return 1
    [ -f "$QM_CONFIG_LOCK" ] || (umask 022; set -C; : > "$QM_CONFIG_LOCK") 2>/dev/null
    [ -f "$QM_CONFIG_LOCK" ] && [ ! -L "$QM_CONFIG_LOCK" ]
}

# _qm_config_mutate <jq args...>: locked jq edit, published via a per-call temp + mv.
_qm_config_mutate() {
    (
        if _qm_config_lock_ready; then
            exec 9< "$QM_CONFIG_LOCK"
            flock -x 9 || exit 1
        fi
        tmp=$(mktemp "${QM_CONFIG}.XXXXXX" 2>/dev/null) || exit 1
        if jq "$@" "$QM_CONFIG" > "$tmp" 2>/dev/null &&
            chmod 0644 "$tmp" && mv "$tmp" "$QM_CONFIG"; then
            exit 0
        fi
        rm -f "$tmp"
        exit 1
    )
}

# Create default config if missing or empty
qm_config_init() {
    [ -s "$QM_CONFIG" ] && return 0
    (
        if _qm_config_lock_ready; then
            exec 9< "$QM_CONFIG_LOCK"
            flock -x 9 || exit 1
        fi
        [ -s "$QM_CONFIG" ] && exit 0
        tmp=$(mktemp "${QM_CONFIG}.XXXXXX" 2>/dev/null) || exit 1
        _qm_config_defaults > "$tmp" && chmod 0644 "$tmp" && mv "$tmp" "$QM_CONFIG" && exit 0
        rm -f "$tmp"
        exit 1
    )
}

_qm_config_defaults() {
    cat << 'DEFAULTS'
{
  "watchcat": {
    "enabled": 0,
    "check_interval": 10,
    "fail_threshold": 5,
    "probe_interval": 5,
    "cooldown": 60,
    "tier1_enabled": 1,
    "tier2_enabled": 1,
    "tier3_enabled": 0,
    "tier4_enabled": 1,
    "backup_sim_slot": "",
    "max_reboots_per_hour": 3
  },
  "bridge_monitor": {
    "enabled": 0,
    "ws_port": 8838,
    "refresh_rate_ms": 1000,
    "interfaces": "br-lan,eth0,rmnet_data0,rmnet_data1,rmnet_ipa0",
    "channel": "network-monitor",
    "json_mode": "yes"
  },
  "eth_link": {
    "speed_limit": "auto"
  },
  "settings": {
    "temp_unit": "celsius",
    "distance_unit": "km",
    "hostname": "",
    "timezone": "UTC0",
    "zonename": "UTC",
    "sms_tool_device": "",
    "sched_reboot_enabled": 0,
    "sched_reboot_time": "04:00",
    "sched_reboot_days": "0,1,2,3,4,5,6"
  },
  "video_optimizer": {
    "enabled": 0,
    "strategy": "full"
  },
  "full_bypass": {
    "enabled": 0,
    "sni_domain": "speedtest.net"
  },
  "update": {
    "include_prerelease": 1,
    "auto_update_enabled": 0,
    "auto_update_time": "03:00"
  }
}
DEFAULTS
}

# Read: qm_config_get <section> <key> [default]
# Example: qm_config_get watchcat enabled 0
#   Equivalent to: uci -q get quecmanager.watchcat.enabled
# NOTE: Uses // empty which treats both false and null as absent.
# All config values here are strings or integers (never boolean false),
# so this is safe. If boolean false is ever needed, use the safe pattern:
#   jq '(.[$s][$k]) | if . == null then empty else tostring end'
qm_config_get() {
    local section="$1" key="$2" default="${3:-}"
    [ -f "$QM_CONFIG" ] || { echo "$default"; return; }
    local val
    val=$(jq -r --arg s "$section" --arg k "$key" \
        '.[$s][$k] // empty' "$QM_CONFIG" 2>/dev/null)
    if [ -z "$val" ]; then
        echo "$default"
    else
        echo "$val"
    fi
}

# Write: qm_config_set <section> <key> <value>
# Example: qm_config_set watchcat enabled 0
#   Equivalent to: uci set quecmanager.watchcat.enabled=0 && uci commit
# Locked read-modify-write; atomic publish via per-call temp + mv.
qm_config_set() {
    local section="$1" key="$2" value="$3"
    qm_config_init
    # Detect numeric values to store as numbers, not strings
    case "$value" in
        ''|*[!0-9]*) # non-numeric or empty — store as string
            _qm_config_mutate --arg s "$section" --arg k "$key" --arg v "$value" \
                '.[$s][$k] = $v' ;;
        *) # numeric — store as number
            _qm_config_mutate --arg s "$section" --arg k "$key" --argjson v "$value" \
                '.[$s][$k] = $v' ;;
    esac
}

# Delete: qm_config_delete <section> <key>
# Example: qm_config_delete watchcat max_failures
#   Equivalent to: uci -q delete quecmanager.watchcat.max_failures
# No-op (success) if the config file or the section/key doesn't exist — used
# by defensive key-rename migrations.
qm_config_delete() {
    local section="$1" key="$2"
    [ -f "$QM_CONFIG" ] || return 0
    _qm_config_mutate --arg s "$section" --arg k "$key" \
        'if has($s) then .[$s] |= del(.[$k]) else . end'
}

# Delete a whole section: qm_config_delete_section <section>
# Example: qm_config_delete_section traffic_masquerade
# No-op (success) if the config file or the section doesn't exist.
#
# Section-scoped sibling of qm_config_delete: deleting a section's keys one at
# a time leaves an empty `"x": {}` behind. Used by install_rm520n.sh renames.
qm_config_delete_section() {
    local section="$1"
    [ -f "$QM_CONFIG" ] || return 0
    _qm_config_mutate --arg s "$section" 'del(.[$s])'
}

# Bulk read: qm_config_section <section>
# Returns the entire section as a JSON object on stdout.
# Example: qm_config_section watchcat | jq -r '.enabled'
qm_config_section() {
    local section="$1"
    [ -f "$QM_CONFIG" ] || { echo "{}"; return; }
    jq -r --arg s "$section" '.[$s] // {}' "$QM_CONFIG" 2>/dev/null
}
