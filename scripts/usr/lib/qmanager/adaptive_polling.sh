#!/bin/sh
# adaptive_polling.sh — read, validate and save qmanager.conf .poller.
# Shared by system/adaptive_polling.sh and the config backup section.

[ -n "$_ADAPTIVE_POLLING_LOADED" ] && return 0
_ADAPTIVE_POLLING_LOADED=1

. /usr/lib/qmanager/config.sh

AP_RELOAD_FLAG="/tmp/qmanager_poller_reload"

# Clamped like the poller; $tier is only echoed back.
AP_READ_JQ='
    def ival(v; lo; hi; d):
        (v | tostring) as $s
        | if ($s | length) > 0 and ($s | length) < 6 and ($s | explode | all(. >= 48 and . <= 57))
          then ($s | tonumber) as $n | if $n >= lo and $n <= hi then $n else d end
          else d end;
    ((if type == "object" then .poller else null end) // null) as $raw
    | ($raw // {}) as $p
    | ival($p.active_grace; 20; 120; 20) as $ag
    | ival($p.idle_interval; 5; 300; 15) as $ii
    | ival($p.idle_threshold; 60; 3600; 300) as $it0
    | (if $it0 > $ag then $it0 else 300 end) as $it
    | ival($p.deep_idle_interval; $ii; 300; 60) as $di0
    | (if $di0 >= $ii then $di0 else $ii end) as $di
    | {success: true,
       settings: {enabled: (($p.enabled | tostring) as $e
                            | ($e != "0" and $e != "false" and $e != "no" and $e != "off")),
                  active_grace: $ag, idle_interval: $ii,
                  idle_threshold: $it, deep_idle_interval: $di},
       isDefault: ($raw == null),
       tier: $tier}'

# ap_read_json [tier] -> the GET body; empty on failure.
ap_read_json() {
    local out
    out=$(jq --arg tier "${1:-active}" "$AP_READ_JQ" "$QM_CONFIG" 2>/dev/null)
    [ -n "$out" ] || out=$(jq -n --arg tier "${1:-active}" "null | $AP_READ_JQ" 2>/dev/null)
    printf '%s' "$out"
}

_ap_in_range() {
    case "$1" in ''|*[!0-9]*|??????*) return 1 ;; esac
    [ "$1" -ge "$2" ] && [ "$1" -le "$3" ]
}

# ap_validate <enabled true|false> <ag> <ii> <it> <di>; sets AP_ERR_CODE / AP_ERR_DETAIL.
ap_validate() {
    AP_ERR_CODE=""; AP_ERR_DETAIL=""
    case "$1" in
        true|false) ;;
        *) AP_ERR_CODE="invalid_enabled"; AP_ERR_DETAIL="enabled must be true or false"; return 1 ;;
    esac
    _ap_in_range "$2" 20 120 || { AP_ERR_CODE="invalid_active_grace"; AP_ERR_DETAIL="active_grace must be 20-120"; return 1; }
    _ap_in_range "$3" 5 300 || { AP_ERR_CODE="invalid_idle_interval"; AP_ERR_DETAIL="idle_interval must be 5-300"; return 1; }
    { _ap_in_range "$4" 60 3600 && [ "$4" -gt "$2" ]; } ||
        { AP_ERR_CODE="invalid_idle_threshold"; AP_ERR_DETAIL="idle_threshold must be 60-3600 and above active_grace"; return 1; }
    _ap_in_range "$5" "$3" 300 ||
        { AP_ERR_CODE="invalid_deep_idle_interval"; AP_ERR_DETAIL="deep_idle_interval must be idle_interval-300"; return 1; }
}

# ap_save <enabled true|false> <ag> <ii> <it> <di> — validated values only.
ap_save() {
    local en=0
    [ "$1" = "true" ] && en=1
    qm_config_set poller enabled "$en" &&
        qm_config_set poller active_grace "$2" &&
        qm_config_set poller idle_interval "$3" &&
        qm_config_set poller idle_threshold "$4" &&
        qm_config_set poller deep_idle_interval "$5" || return 1
    touch "$AP_RELOAD_FLAG"
}
