#!/bin/sh
# wd_quality.sh — quality detection for qmanager_watchcat: a reachable but degraded link starts a
# Tier 1-2 recovery (never a reboot). Thresholds are Connection Quality's (conn_state.sh presets).
# Needs: conn_state.sh (cq_thresholds_load, CQ_*), wd_mono, CFG_QUALITY_ENABLED, CFG_QUALITY_CONSECUTIVE.

[ -n "${_WD_QUALITY_LOADED:-}" ] && return 0
_WD_QUALITY_LOADED=1

WD_PING_HISTORY="${WD_PING_HISTORY:-/tmp/qmanager_ping_history}"
WD_Q_MIN_SAMPLES=10        # same floor as the poller: below 10 a loss figure is not representable
WD_Q_LAT_FLOOR_MS=50       # so a 1 ms custom limit cannot trip recovery
WD_Q_LOSS_FLOOR_PCT=10     # so a 1 % custom limit cannot trip recovery
WD_Q_HOLDOFF_SECS=900      # pause after a quality recovery that did not help
WD_Q_SETTLE_SECS=600       # pause after one that did, so a flapping link cannot loop Tier 1/2
WD_Q_MAX_TIER=2

quality_since=0
quality_breach_counter=0
quality_holdoff_until=0
q_avg_latency="null"
q_packet_loss="null"
q_lat_limit=250
q_loss_limit=30

# Start the sample window now: the next verdict sees only samples taken after this.
wd_quality_mark() {
    quality_since=$(wd_mono)
}

# Effective limits: the Connection Quality preset, raised to the floors.
wd_quality_limits() {
    if [ "${_CQ_THR_PENDING:-1}" = "1" ] && command -v cq_thresholds_load >/dev/null 2>&1; then
        cq_thresholds_load
    fi
    q_lat_limit="${CQ_LAT_MS:-250}"; q_loss_limit="${CQ_LOSS_PCT:-30}"
    case "$q_lat_limit" in ''|*[!0-9]*) q_lat_limit=250 ;; esac
    case "$q_loss_limit" in ''|*[!0-9]*) q_loss_limit=30 ;; esac
    [ "$q_lat_limit" -lt "$WD_Q_LAT_FLOOR_MS" ] && q_lat_limit="$WD_Q_LAT_FLOOR_MS"
    [ "$q_loss_limit" -lt "$WD_Q_LOSS_FLOOR_PCT" ] && q_loss_limit="$WD_Q_LOSS_FLOOR_PCT"
    return 0
}

# rc 0 with q_avg_latency/q_packet_loss over the samples since the mark (capped ~2 min);
# rc 1 = no signal (fewer than WD_Q_MIN_SAMPLES, or no history).
wd_quality_read() {
    local _iv _w _n _now _out
    q_avg_latency="null"; q_packet_loss="null"
    _iv="${CQ_INTERVAL_SEC:-5}"
    case "$_iv" in ''|*[!0-9]*) _iv=5 ;; esac
    [ "$_iv" -ge 1 ] || _iv=5
    _w=$((120 / _iv)); [ "$_w" -lt "$WD_Q_MIN_SAMPLES" ] && _w="$WD_Q_MIN_SAMPLES"; [ "$_w" -gt 60 ] && _w=60
    _now=$(wd_mono)
    [ "$_now" -ge "$quality_since" ] 2>/dev/null || return 1
    _n=$(( (_now - quality_since) / _iv ))
    [ "$_n" -gt "$_w" ] && _n="$_w"
    [ "$_n" -ge "$WD_Q_MIN_SAMPLES" ] || return 1
    [ -f "$WD_PING_HISTORY" ] || return 1
    # The ping daemon truncates history on a winner change, so count what tail really returns.
    _out=$(tail -n "$_n" "$WD_PING_HISTORY" 2>/dev/null | awk -v m="$WD_Q_MIN_SAMPLES" '
        { c++ }
        $0 ~ /^[0-9]+(\.[0-9]+)?$/ { s += $0; k++; next }
        { nl++ }
        END {
            if (c < m) exit 1
            if (k > 0) avg = sprintf("%.1f", s / k); else avg = "null"
            printf "%s %d\n", avg, int(nl * 100 / c)
        }')
    [ -n "$_out" ] || return 1
    q_avg_latency="${_out% *}"
    q_packet_loss="${_out#* }"
    case "$q_packet_loss" in ''|*[!0-9]*) q_packet_loss="null"; return 1 ;; esac
    return 0
}

# rc 0 when the figures read last breach a limit (latency is a float: compared in awk).
wd_quality_breached() {
    if [ "$q_avg_latency" != "null" ] && \
        awk -v a="$q_avg_latency" -v c="$q_lat_limit" 'BEGIN { exit !((a + 0) > (c + 0)) }'; then
        return 0
    fi
    [ "$q_packet_loss" != "null" ] && [ "$q_packet_loss" -ge "$q_loss_limit" ]
}

# Prints 0 good, 1 breached, 2 no signal. For the cooldown verdict and the primary recheck.
wd_quality_state() {
    wd_quality_limits
    if ! wd_quality_read; then printf '2'; return 0; fi
    if wd_quality_breached; then printf '1'; else printf '0'; fi
}

wd_quality_holdoff_left() {
    local _l
    _l=$((quality_holdoff_until - $(wd_mono)))
    [ "$_l" -gt 0 ] && printf '%s' "$_l" || printf '0'
}

wd_quality_holdoff_start() {
    quality_holdoff_until=$(( $(wd_mono) + WD_Q_HOLDOFF_SECS ))
    qlog_warn "QUALITY: recovery did not help, pausing quality recovery for ${WD_Q_HOLDOFF_SECS}s"
}

wd_quality_holdoff_settle() {
    quality_holdoff_until=$(( $(wd_mono) + WD_Q_SETTLE_SECS ))
    qlog_info "QUALITY: restored, next quality recovery no sooner than ${WD_Q_SETTLE_SECS}s"
}

wd_quality_holdoff_clear() {
    quality_holdoff_until=0
}

# Start gate, in order: none (no Tier 1/2 armed), holdoff, ssr (baseband restart recent),
# radio_off (AT+CFUN 0 or 4: turned off on purpose; an unreadable reply counts as on), go.
wd_quality_gate() {
    local _cf
    if [ "$CFG_TIER1_ENABLED" != "1" ] && [ "$CFG_TIER2_ENABLED" != "1" ]; then printf 'none'; return 0; fi
    if [ "$(wd_quality_holdoff_left)" != "0" ]; then printf 'holdoff'; return 0; fi
    if command -v wd_ssr_recent >/dev/null 2>&1 && wd_ssr_recent; then printf 'ssr'; return 0; fi
    _cf=$(qcmd 'AT+CFUN?' 2>/dev/null | grep '+CFUN:' | sed 's/.*: *//' | tr -d '\r ')
    case "$_cf" in 0|4) printf 'radio_off' ;; *) printf 'go' ;; esac
}

# One monitor pass on a fresh, reachable read. rc 0 = start a quality recovery now (caller runs it).
wd_quality_evaluate() {
    local _gate
    [ "$CFG_QUALITY_ENABLED" = "1" ] || return 1
    wd_quality_limits
    wd_quality_read || return 1   # no signal: the count neither grows nor resets
    if ! wd_quality_breached; then
        quality_breach_counter=0
        return 1
    fi
    quality_breach_counter=$((quality_breach_counter + 1))
    qlog_info "QUALITY: breach ${quality_breach_counter}/${CFG_QUALITY_CONSECUTIVE} (avg ${q_avg_latency}ms vs ${q_lat_limit}ms, loss ${q_packet_loss}% vs ${q_loss_limit}%)"
    [ "$quality_breach_counter" -ge "$CFG_QUALITY_CONSECUTIVE" ] || return 1
    quality_breach_counter=0
    _gate=$(wd_quality_gate)
    if [ "$_gate" != "go" ]; then
        qlog_info "QUALITY: recovery not started ($_gate)"
        return 1
    fi
    qlog_warn "QUALITY → RECOVERY: ${CFG_QUALITY_CONSECUTIVE} breaches in a row (avg ${q_avg_latency}ms, loss ${q_packet_loss}%)"
    append_event "watchcat_recovery" "Connection quality degraded, starting recovery" "warning"
    return 0
}
