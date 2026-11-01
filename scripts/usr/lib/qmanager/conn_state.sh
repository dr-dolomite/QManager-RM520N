#!/bin/sh
# conn_state.sh — the one reader of /tmp/qmanager_ping.json (poller + watchcat).
# POSIX sh / BusyBox ash safe. Fail-closed: any read problem is STALE, never "up".

[ -n "${_CONN_STATE_LOADED:-}" ] && return 0
_CONN_STATE_LOADED=1

CQ_PING_CACHE="${CQ_PING_CACHE:-/tmp/qmanager_ping.json}"
CQ_PING_CONFIG="${CQ_PING_CONFIG:-/etc/qmanager/ping_profile.json}"
_CQ_TAB=$(printf '\t')

# Neutral values: reachable is "null" (unknown), never true.
_cq_reset() {
    CQ_STALE=1; CQ_STALE_REASON=""; CQ_AGE_SEC=""; CQ_STALE_THRESHOLD=15
    CQ_TIMESTAMP=""; CQ_MONO=""; CQ_REACHABLE="null"; CQ_RTT_MS="null"
    CQ_STREAK_SUCCESS=0; CQ_STREAK_FAIL=0; CQ_FAIL_ELAPSED_SEC=0
    CQ_DURING_RECOVERY="false"; CQ_INTERVAL_SEC=5
    CQ_PROFILE=""; CQ_LAST_FAMILY=""; CQ_LAST_TARGET=""; CQ_TARGET=""
}
_cq_reset

# conn_state_read: one jq read into CQ_* vars; rc 0 fresh, 1 stale/missing (verdict vars neutral).
# Stale = age > max(3*interval_sec, 15); age is cache `mono` vs /proc/uptime (wall clock if absent).
conn_state_read() {
    _cq_reset
    if [ ! -f "$CQ_PING_CACHE" ]; then
        CQ_STALE_REASON="missing"
        return 1
    fi

    _cq_row=$(jq -r 'def s: if . == null or . == "" then "-" else tostring end;
        [(.timestamp|s), (.mono|s), (.reachable|s), (.last_rtt_ms|s),
         (.streak_success|s), (.streak_fail|s), (.fail_elapsed_sec|s),
         (.during_recovery|s), (.interval_sec|s), (.profile|s),
         (.last_family|s), (.last_target|s), (.targets[0]?|s)] | @tsv' \
        "$CQ_PING_CACHE" 2>/dev/null </dev/null)
    if [ -z "$_cq_row" ]; then
        CQ_STALE_REASON="unreadable"
        return 1
    fi

    IFS="$_CQ_TAB" read -r _cq_ts _cq_mono _cq_reach _cq_rtt _cq_ss _cq_sf _cq_fe \
        _cq_dr _cq_iv CQ_PROFILE CQ_LAST_FAMILY CQ_LAST_TARGET CQ_TARGET <<EOF
$_cq_row
EOF

    case "$_cq_ts" in ''|*[!0-9]*)
        CQ_STALE_REASON="no timestamp"
        return 1 ;;
    esac
    case "$_cq_iv" in ''|*[!0-9]*) _cq_iv=5 ;; esac
    { [ "$_cq_iv" -ge 1 ] && [ "$_cq_iv" -le 300 ]; } 2>/dev/null || _cq_iv=5
    CQ_INTERVAL_SEC="$_cq_iv"
    CQ_STALE_THRESHOLD=$((3 * _cq_iv))
    [ "$CQ_STALE_THRESHOLD" -lt 15 ] && CQ_STALE_THRESHOLD=15

    _cq_age=""
    case "$_cq_mono" in
        ''|*[!0-9]*|0) ;;
        *)
            _cq_up=""
            { read -r _cq_up _cq_idle < /proc/uptime; } 2>/dev/null
            _cq_up="${_cq_up%%.*}"
            case "$_cq_up" in ''|*[!0-9]*) ;; *)
                _cq_age=$((_cq_up - _cq_mono))
                CQ_MONO="$_cq_mono"
                if [ "$_cq_age" -lt 0 ]; then
                    CQ_AGE_SEC="$_cq_age"
                    CQ_STALE_REASON="mono ahead of uptime"
                    return 1
                fi ;;
            esac ;;
    esac
    [ -z "$_cq_age" ] && _cq_age=$(( $(date +%s) - _cq_ts ))
    CQ_AGE_SEC="$_cq_age"
    if [ "$_cq_age" -gt "$CQ_STALE_THRESHOLD" ]; then
        CQ_STALE_REASON="age ${_cq_age}s > ${CQ_STALE_THRESHOLD}s"
        return 1
    fi

    CQ_STALE=0
    CQ_TIMESTAMP="$_cq_ts"
    case "$_cq_reach" in true|false) CQ_REACHABLE="$_cq_reach" ;; esac
    case "$_cq_rtt" in ''|-|*[!0-9.]*) CQ_RTT_MS="null" ;; *) CQ_RTT_MS="$_cq_rtt" ;; esac
    case "$_cq_ss" in ''|*[!0-9]*) ;; *) CQ_STREAK_SUCCESS="$_cq_ss" ;; esac
    case "$_cq_sf" in ''|*[!0-9]*) ;; *) CQ_STREAK_FAIL="$_cq_sf" ;; esac
    case "$_cq_fe" in ''|*[!0-9]*) ;; *) CQ_FAIL_ELAPSED_SEC="$_cq_fe" ;; esac
    [ "$_cq_dr" = "true" ] && CQ_DURING_RECOVERY="true"
    [ "$CQ_PROFILE" = "-" ] && CQ_PROFILE=""
    [ "$CQ_LAST_FAMILY" = "-" ] && CQ_LAST_FAMILY=""
    [ "$CQ_LAST_TARGET" = "-" ] && CQ_LAST_TARGET=""
    [ "$CQ_TARGET" = "-" ] && CQ_TARGET=""
    return 0
}

# One-line reason for the last conn_state_read failure (for the caller's log).
conn_state_why() {
    printf '%s' "${CQ_STALE_REASON:-unknown}"
}

# conn_state_down_for N: link is DOWN for >= N s (reachable=false, fresh read).
# during_recovery is deliberately not consulted.
conn_state_down_for() {
    case "${1:-}" in ''|*[!0-9]*) return 1 ;; esac
    [ "$CQ_STALE" = "0" ] && [ "$CQ_REACHABLE" = "false" ] && [ "$CQ_FAIL_ELAPSED_SEC" -ge "$1" ]
}

# conn_state_is_up: fresh read with reachable=true (independent of during_recovery).
conn_state_is_up() {
    [ "$CQ_STALE" = "0" ] && [ "$CQ_REACHABLE" = "true" ]
}

# conn_state_cadence [config]: effective probe cadence (profile table, then numeric overrides,
# as resolve_profile() in qmanager_ping) into CQ_CFG_PROFILE/INTERVAL_SEC/FAIL_SECS/RECOVER_SECS.
conn_state_cadence() {
    _cq_cfg="${1:-$CQ_PING_CONFIG}"
    CQ_CFG_PROFILE="relaxed"; _cq_pi=""; _cq_pf=""; _cq_pr=""
    if [ -f "$_cq_cfg" ]; then
        _cq_row=$(jq -r 'def s: if . == null or . == "" then "-" else tostring end;
            [(.profile|s), (.interval_sec|s), (.fail_secs|s), (.recover_secs|s)] | @tsv' \
            "$_cq_cfg" 2>/dev/null </dev/null)
        if [ -n "$_cq_row" ]; then
            IFS="$_CQ_TAB" read -r CQ_CFG_PROFILE _cq_pi _cq_pf _cq_pr <<EOF
$_cq_row
EOF
        fi
    fi
    case "$CQ_CFG_PROFILE" in
        sensitive) CQ_CFG_INTERVAL_SEC=1;  CQ_CFG_FAIL_SECS=15; CQ_CFG_RECOVER_SECS=3 ;;
        regular)   CQ_CFG_INTERVAL_SEC=2;  CQ_CFG_FAIL_SECS=20; CQ_CFG_RECOVER_SECS=6 ;;
        quiet)     CQ_CFG_INTERVAL_SEC=10; CQ_CFG_FAIL_SECS=60; CQ_CFG_RECOVER_SECS=20 ;;
        *) CQ_CFG_PROFILE="relaxed"
           CQ_CFG_INTERVAL_SEC=5;  CQ_CFG_FAIL_SECS=30; CQ_CFG_RECOVER_SECS=10 ;;
    esac
    case "$_cq_pi" in ''|*[!0-9]*) ;; *) CQ_CFG_INTERVAL_SEC="$_cq_pi" ;; esac
    case "$_cq_pf" in ''|*[!0-9]*) ;; *) CQ_CFG_FAIL_SECS="$_cq_pf" ;; esac
    case "$_cq_pr" in ''|*[!0-9]*) ;; *) CQ_CFG_RECOVER_SECS="$_cq_pr" ;; esac
    [ "$CQ_CFG_INTERVAL_SEC" -gt 0 ] 2>/dev/null || CQ_CFG_INTERVAL_SEC=1
    return 0
}

# ---------------------------------------------------------------------------
# Quality thresholds: the one preset table (poller verdict + events.sh detector)
# ---------------------------------------------------------------------------
QUALITY_CONFIG="${QUALITY_CONFIG:-/etc/qmanager/quality_thresholds.json}"
QUALITY_RELOAD_FLAG="${QUALITY_RELOAD_FLAG:-/tmp/qmanager_events_reload}"
CQ_SMS_CONFIG="${CQ_SMS_CONFIG:-/etc/qmanager/sms_alerts.json}"
CQ_EMAIL_CONFIG="${CQ_EMAIL_CONFIG:-/etc/qmanager/email_alerts.json}"
CQ_DISCORD_CONFIG="${CQ_DISCORD_CONFIG:-/etc/qmanager/discord_bot.json}"

# Defaults = the "tolerant" row; kept on a missing or garbage config.
CQ_LAT_PRESET="tolerant"; CQ_LAT_MS=250; CQ_LAT_DEBOUNCE=3
CQ_LOSS_PRESET="tolerant"; CQ_LOSS_PCT=30; CQ_LOSS_DEBOUNCE=3
CQ_ALERT_AFTER_MIN=5
_CQ_THR_PENDING=1   # 1 until the first successful cq_thresholds_load

# Value (ms / %) and debounce (consecutive polls, entry and exit) per preset. `custom` takes
# its integer as $2 (latency 1-10000, loss 1-100), debounce 3; a bad value returns 1, globals untouched.
cq_preset_latency() {
    case "$1" in
        standard)      CQ_LAT_MS=150; CQ_LAT_DEBOUNCE=3 ;;
        tolerant)      CQ_LAT_MS=250; CQ_LAT_DEBOUNCE=3 ;;
        very-tolerant) CQ_LAT_MS=500; CQ_LAT_DEBOUNCE=2 ;;
        custom)
            case "${2:-}" in ''|*[!0-9]*) return 1 ;; esac
            [ "${#2}" -le 5 ] && [ "$2" -ge 1 ] && [ "$2" -le 10000 ] || return 1
            CQ_LAT_MS="$2"; CQ_LAT_DEBOUNCE=3 ;;
        *) return 1 ;;
    esac
    CQ_LAT_PRESET="$1"
}

cq_preset_loss() {
    case "$1" in
        standard)      CQ_LOSS_PCT=15; CQ_LOSS_DEBOUNCE=3 ;;
        tolerant)      CQ_LOSS_PCT=30; CQ_LOSS_DEBOUNCE=3 ;;
        very-tolerant) CQ_LOSS_PCT=50; CQ_LOSS_DEBOUNCE=2 ;;
        custom)
            case "${2:-}" in ''|*[!0-9]*) return 1 ;; esac
            [ "${#2}" -le 3 ] && [ "$2" -ge 1 ] && [ "$2" -le 100 ] || return 1
            CQ_LOSS_PCT="$2"; CQ_LOSS_DEBOUNCE=3 ;;
        *) return 1 ;;
    esac
    CQ_LOSS_PRESET="$1"
}

# _cq_num_key file key: prints the key's value when it is a JSON number, else nothing.
_cq_num_key() {
    [ -f "$1" ] || return 1
    jq -r --arg k "$2" '(try .[$k] catch null) | if type == "number" then tostring else "" end' \
        "$1" 2>/dev/null </dev/null
}

# _cq_try_wait file key: adopts the value into CQ_ALERT_AFTER_MIN when it is an integer 1-1440.
_cq_try_wait() {
    _cq_w=$(_cq_num_key "$1" "$2")
    case "$_cq_w" in ''|*[!0-9]*) return 1 ;; esac
    { [ "$_cq_w" -ge 1 ] && [ "$_cq_w" -le 1440 ]; } 2>/dev/null || return 1
    CQ_ALERT_AFTER_MIN="$_cq_w"
}

# cq_alert_after_min: the alert wait (minutes) into CQ_ALERT_AFTER_MIN: the quality config key,
# else the first per-channel threshold_minutes (SMS, email, Discord), else 5. rc 1 only without jq.
cq_alert_after_min() {
    CQ_ALERT_AFTER_MIN=5
    command -v jq >/dev/null 2>&1 || return 1
    _cq_try_wait "$QUALITY_CONFIG" alert_after_min && return 0
    _cq_try_wait "$CQ_SMS_CONFIG" threshold_minutes && return 0
    _cq_try_wait "$CQ_EMAIL_CONFIG" threshold_minutes && return 0
    _cq_try_wait "$CQ_DISCORD_CONFIG" threshold_minutes && return 0
    return 0
}

# cq_thresholds_load [config]: resolve the active presets and the alert wait. Missing or
# garbage config -> the defaults above. rc 1 (and a retry on refresh) while jq is not mounted.
cq_thresholds_load() {
    _cq_qcfg="${1:-$QUALITY_CONFIG}"
    if ! command -v jq >/dev/null 2>&1; then
        _CQ_THR_PENDING=1
        return 1
    fi
    _CQ_THR_PENDING=0
    _cq_lp="-"; _cq_sp="-"; _cq_lc="-"; _cq_sc="-"
    if [ -f "$_cq_qcfg" ]; then
        _cq_row=$(jq -r 'def s: if type == "string" and . != "" then . else "-" end;
            def n: if type == "number" and . == floor then tostring else "-" end;
            [((try .latency.preset catch null) | s), ((try .loss.preset catch null) | s),
             ((try .latency.custom_ms catch null) | n), ((try .loss.custom_pct catch null) | n)] | @tsv' \
            "$_cq_qcfg" 2>/dev/null </dev/null)
        if [ -n "$_cq_row" ]; then
            IFS="$_CQ_TAB" read -r _cq_lp _cq_sp _cq_lc _cq_sc <<EOF
$_cq_row
EOF
        fi
    fi
    # A custom preset with a missing or invalid number falls back to tolerant.
    cq_preset_latency "$_cq_lp" "$_cq_lc" || cq_preset_latency tolerant
    cq_preset_loss "$_cq_sp" "$_cq_sc" || cq_preset_loss tolerant
    cq_alert_after_min
    return 0
}

# cq_thresholds_refresh: per-cycle poller hook. Re-reads on the CGI's reload flag, and
# retries while the first load is still pending (jq not mounted yet at boot).
cq_thresholds_refresh() {
    if [ -f "$QUALITY_RELOAD_FLAG" ]; then
        rm -f "$QUALITY_RELOAD_FLAG"
        cq_thresholds_load
        command -v qlog_info >/dev/null 2>&1 && \
            qlog_info "Quality thresholds reloaded: lat=${CQ_LAT_MS}ms/${CQ_LAT_DEBOUNCE} loss=${CQ_LOSS_PCT}%/${CQ_LOSS_DEBOUNCE} wait=${CQ_ALERT_AFTER_MIN}m"
    elif [ "$_CQ_THR_PENDING" = "1" ]; then
        cq_thresholds_load
    fi
    return 0
}

# cq_quality_merge <jq-filter> [jq args...]: atomic merge-write of QUALITY_CONFIG through
# the filter, so keys this lib does not own survive. Garbage on disk is replaced by {}.
cq_quality_merge() {
    _cq_filter="$1"; shift
    mkdir -p "$(dirname "$QUALITY_CONFIG")" 2>/dev/null
    _cq_base='{}'
    if [ -s "$QUALITY_CONFIG" ]; then
        _cq_cur=$(jq -c 'if type == "object" then . else {} end' "$QUALITY_CONFIG" 2>/dev/null </dev/null)
        [ -n "$_cq_cur" ] && _cq_base="$_cq_cur"
    fi
    if jq -n --argjson cur "$_cq_base" "$@" "\$cur | $_cq_filter" > "${QUALITY_CONFIG}.tmp" 2>/dev/null \
        && mv "${QUALITY_CONFIG}.tmp" "$QUALITY_CONFIG" 2>/dev/null; then
        return 0
    fi
    rm -f "${QUALITY_CONFIG}.tmp"
    return 1
}
