#!/bin/sh
# wd_ssr.sh — SSR grace for qmanager_watchcat: hold the ladder while the baseband restarts itself.
# Source: the same subsys0 sysfs pair the poller reads. A missing or unreadable state counts as ONLINE.
# Needs: CFG_SSR_AWARE, CFG_SSR_GRACE, CFG_FAIL_THRESHOLD, CFG_CHECK_INTERVAL, CQ_INTERVAL_SEC, wd_mono.

[ -n "${_WD_SSR_LOADED:-}" ] && return 0
_WD_SSR_LOADED=1

WD_SSR_SYSFS="${WD_SSR_SYSFS:-/sys/devices/platform/4080000.qcom,mss/subsys0}"

ssr_hold="false"
ssr_hold_started=0
last_ssr_detected="null"   # mono second of the last SSR sign, or null
ssr_state_online=1
_ssr_count_seen=""

# Reads subsys0 into _ssr_state (online|down) and _ssr_count (digits or empty).
_wd_ssr_read() {
    local _s _c
    _s=""; _c=""
    [ -r "$WD_SSR_SYSFS/state" ] && read -r _s < "$WD_SSR_SYSFS/state" 2>/dev/null
    [ -r "$WD_SSR_SYSFS/crash_count" ] && read -r _c < "$WD_SSR_SYSFS/crash_count" 2>/dev/null
    case "$_s" in
        ''|[Oo][Nn][Ll][Ii][Nn][Ee]) _ssr_state=online ;;
        *) _ssr_state=down ;;
    esac
    case "$_c" in ''|*[!0-9]*) _ssr_count="" ;; *) _ssr_count="$_c" ;; esac
}

# Baseline at daemon start: the counter resets per boot, so only increments after this count.
wd_ssr_init() {
    _wd_ssr_read
    _ssr_count_seen="$_ssr_count"
}

# One sample per loop pass (every path, including cooldown/locked/stale): stamps last_ssr_detected.
wd_ssr_sample() {
    local _now
    _wd_ssr_read
    _now=$(wd_mono)
    ssr_state_online=1
    if [ "$_ssr_state" = "down" ]; then
        ssr_state_online=0
        last_ssr_detected="$_now"
    fi
    if [ -n "$_ssr_count" ]; then
        if [ -z "$_ssr_count_seen" ] || [ "$_ssr_count" -lt "$_ssr_count_seen" ]; then
            _ssr_count_seen="$_ssr_count"
        elif [ "$_ssr_count" -gt "$_ssr_count_seen" ]; then
            qlog_warn "Baseband subsystem restart seen (crash_count $_ssr_count_seen -> $_ssr_count)"
            _ssr_count_seen="$_ssr_count"
            last_ssr_detected="$_now"
        fi
    fi
}

# rc 0 when an SSR is under way or recent enough to explain the outage the ladder sees now.
wd_ssr_recent() {
    local _now _gr _ft _iv _ci _win
    [ "$CFG_SSR_AWARE" = "1" ] || return 1
    [ "$ssr_state_online" = "0" ] && return 0
    case "$last_ssr_detected" in ''|null|*[!0-9]*) return 1 ;; esac
    _now=$(wd_mono)
    _gr="$CFG_SSR_GRACE"; case "$_gr" in ''|*[!0-9]*) _gr=45 ;; esac
    _ft="$CFG_FAIL_THRESHOLD"; case "$_ft" in ''|*[!0-9]*) _ft=5 ;; esac
    _iv="${CQ_INTERVAL_SEC:-5}"; case "$_iv" in ''|*[!0-9]*) _iv=5 ;; esac
    _ci="$CFG_CHECK_INTERVAL"; case "$_ci" in ''|*[!0-9]*) _ci=10 ;; esac
    # Look back over detection delay (fail_threshold x probe interval, two passes) plus the grace.
    _win=$((_gr + _ft * _iv + 2 * _ci))
    [ $((_now - last_ssr_detected)) -ge 0 ] && [ $((_now - last_ssr_detected)) -le "$_win" ]
}

# rc 0 = hold the ladder this pass; rc 1 = run it (no SSR, or the grace ran out).
wd_ssr_hold_gate() {
    local _now
    _now=$(wd_mono)
    if [ "$ssr_hold" = "true" ]; then
        if [ $((_now - ssr_hold_started)) -ge "$CFG_SSR_GRACE" ]; then
            qlog_warn "SSR hold: ${CFG_SSR_GRACE}s grace ran out without recovery, releasing the ladder"
            ssr_hold="false"
            ssr_hold_started=0
            return 1
        fi
        return 0
    fi
    if wd_ssr_recent; then
        ssr_hold="true"
        ssr_hold_started="$_now"
        qlog_warn "Baseband restart in progress, holding recovery up to ${CFG_SSR_GRACE}s"
        append_event "watchcat_recovery" "Modem restarting itself, holding recovery" "info"
        return 0
    fi
    return 1
}

# Seconds of grace left while holding (0 otherwise), for the state file.
wd_ssr_hold_left() {
    local _l
    if [ "$ssr_hold" = "true" ]; then
        _l=$((CFG_SSR_GRACE - ($(wd_mono) - ssr_hold_started)))
        [ "$_l" -lt 0 ] && _l=0
        printf '%s' "$_l"
    else
        printf '0'
    fi
}

wd_ssr_hold_clear() {
    [ "$ssr_hold" = "true" ] && qlog_info "SSR hold cleared"
    ssr_hold="false"
    ssr_hold_started=0
}
