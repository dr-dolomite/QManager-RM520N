#!/bin/sh
# wd_common.sh — watchdog key defaults/ranges (shared by qmanager_watchcat and watchdog.sh) + mono clock.
# qm_config_init never rewrites a non-empty conf, so these reader defaults are what OTA'd devices get.

[ -n "${_WD_COMMON_LOADED:-}" ] && return 0
_WD_COMMON_LOADED=1

# wd_key_spec <key>: prints "<default> <min> <max>"; rc 1 for a key this table does not own.
wd_key_spec() {
    case "$1" in
        ssr_aware)                printf '1 0 1' ;;
        ssr_grace)                printf '45 10 120' ;;
        quality_enabled)          printf '0 0 1' ;;
        quality_consecutive)      printf '5 1 60' ;;
        primary_recheck_enabled)  printf '0 0 1' ;;
        primary_recheck_interval) printf '30 5 1440' ;;
        *) return 1 ;;
    esac
}

WD_KEYS="ssr_aware ssr_grace quality_enabled quality_consecutive primary_recheck_enabled primary_recheck_interval"

# wd_key_valid <key> <value>: rc 0 when value is an integer inside the key's range.
wd_key_valid() {
    local _spec _def _min _max
    _spec=$(wd_key_spec "$1") || return 1
    set -- "$2" $_spec
    _def="$2"; _min="$3"; _max="$4"
    case "$1" in ''|*[!0-9]*) return 1 ;; esac
    [ "${#1}" -le 5 ] && [ "$1" -ge "$_min" ] && [ "$1" -le "$_max" ]
}

# wd_key_get <key>: the stored value when valid, else the table default.
wd_key_get() {
    local _spec _v
    _spec=$(wd_key_spec "$1") || return 1
    _v=""
    command -v qm_config_get >/dev/null 2>&1 && _v=$(qm_config_get watchcat "$1" "")
    if wd_key_valid "$1" "$_v"; then
        printf '%s' "$_v"
    else
        printf '%s' "${_spec%% *}"
    fi
}

# wd_mono: whole seconds since boot (immune to the 1970 clock step); 0 when unreadable.
wd_mono() {
    local _up _idle
    _up=""
    { read -r _up _idle < /proc/uptime; } 2>/dev/null
    _up="${_up%%.*}"
    case "$_up" in ''|*[!0-9]*) printf '0' ;; *) printf '%s' "$_up" ;; esac
}
