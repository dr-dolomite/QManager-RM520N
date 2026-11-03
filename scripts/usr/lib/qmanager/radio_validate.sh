#!/bin/sh
# =============================================================================
# radio_validate.sh — shared radio validators and writers
# =============================================================================
# One implementation for the CGI save paths (cellular/settings.sh, bands/*,
# tower/*, scenarios/*) and the config-backup appliers, so both accept the
# same values. Validators return 0/1 and set RV_CODE / RV_DETAIL on failure.
#
# Install location: /usr/lib/qmanager/radio_validate.sh
# =============================================================================

[ -n "$_RADIO_VALIDATE_LOADED" ] && return 0
_RADIO_VALIDATE_LOADED=1

[ -f /usr/lib/qmanager/platform.sh ] && . /usr/lib/qmanager/platform.sh
if ! command -v qlog_info >/dev/null 2>&1; then
    qlog_init()  { :; }
    qlog_debug() { :; }
    qlog_info()  { :; }
    qlog_warn()  { :; }
    qlog_error() { :; }
fi

RV_CODE=""
RV_DETAIL=""

# --- Network mode (cellular/settings.sh) --------------------------------------

rv_mode_pref() {
    case "$1" in
        AUTO|LTE|NR5G|WCDMA|LTE:NR5G|LTE:WCDMA|NR5G:LTE:WCDMA) return 0 ;;
    esac
    RV_CODE="invalid_mode_pref"
    RV_DETAIL="Invalid network mode"
    return 1
}

# radio_set_mode_pref <value>: one AT write; rc is qcmd's exit status, kept in _aw_rc.
radio_set_mode_pref() {
    _aw_out=$(qcmd "AT+QNWPREFCFG=\"mode_pref\",$1" 2>/dev/null)
    _aw_rc=$?
    return $_aw_rc
}

# --- Bands (bands/lock.sh, scenarios/activate.sh) -----------------------------

# rv_band_type <lte|nsa_nr5g|sa_nr5g>: sets RV_AT_PARAM.
rv_band_type() {
    RV_AT_PARAM=""
    case "$1" in
        lte)        RV_AT_PARAM="lte_band" ;;
        nsa_nr5g)   RV_AT_PARAM="nsa_nr5g_band" ;;
        sa_nr5g)    RV_AT_PARAM="nr5g_band" ;;
        *) return 1 ;;
    esac
    return 0
}

# rv_bands_format <bands>: colon-delimited digits only (empty passes; callers test it).
rv_bands_format() {
    case "$1" in
        *[!0-9:]*) return 1 ;;
    esac
    return 0
}

# rv_bands_supported <bands> <supported>: every band is in the supported list.
# An empty supported list means "unknown" and passes.
rv_bands_supported() {
    local b rest="$1" sup=":$2:"
    [ -n "$2" ] || return 0
    while [ -n "$rest" ]; do
        b="${rest%%:*}"
        case "$rest" in
            *:*) rest="${rest#*:}" ;;
            *) rest="" ;;
        esac
        [ -n "$b" ] || continue
        case "$sup" in
            *":$b:"*) ;;
            *) return 1 ;;
        esac
    done
    return 0
}

BANDS_FAILOVER_ENABLED_FILE="/etc/qmanager/band_failover_enabled"
BANDS_FAILOVER_ACTIVATED_FLAG="/tmp/qmanager_band_failover"
BANDS_FAILOVER_PID_FILE="/tmp/qmanager_band_failover.pid"
BANDS_FAILOVER_SCRIPT="/usr/bin/qmanager_band_failover"

# bands_lock_write <at_param> <bands>: one band-lock AT write, rc 0 on success.
bands_lock_write() {
    local at_cmd="AT+QNWPREFCFG=\"${1}\",${2}" result rc
    result=$(qcmd "$at_cmd" 2>/dev/null)
    rc=$?
    if [ $rc -ne 0 ] || [ -z "$result" ]; then
        qlog_error "Band lock failed (rc=$rc): $at_cmd"
        return 1
    fi
    qlog_info "Band lock applied: $1=$2"
    return 0
}

# bands_failover_kill_watcher: stop a running watcher (pid verified by name).
_bands_failover_kill_watcher() {
    local old_pid
    [ -f "$BANDS_FAILOVER_PID_FILE" ] || return 0
    old_pid=$(cat "$BANDS_FAILOVER_PID_FILE" 2>/dev/null | tr -d ' \n\r')
    if pid_is "$old_pid" qmanager_band_failover; then
        kill "$old_pid" 2>/dev/null
        BANDS_WATCHER_KILLED="$old_pid"
    fi
    rm -f "$BANDS_FAILOVER_PID_FILE"
}

# bands_arm_failover: after a lock, clear the activation flag and respawn the
# watcher when failover is enabled. Sets BANDS_FAILOVER_ARMED (true|false).
bands_arm_failover() {
    local val failover_enabled="false"
    BANDS_FAILOVER_ARMED="false"

    rm -f "$BANDS_FAILOVER_ACTIVATED_FLAG"

    if [ -f "$BANDS_FAILOVER_ENABLED_FILE" ]; then
        val=$(cat "$BANDS_FAILOVER_ENABLED_FILE" 2>/dev/null | tr -d ' \n\r')
        [ "$val" = "1" ] && failover_enabled="true"
    fi

    if [ "$failover_enabled" = "true" ] && [ -x "$BANDS_FAILOVER_SCRIPT" ]; then
        BANDS_WATCHER_KILLED=""
        _bands_failover_kill_watcher
        [ -n "$BANDS_WATCHER_KILLED" ] && qlog_debug "Killed previous failover watcher (PID=$BANDS_WATCHER_KILLED)"

        # Double-fork so the watcher escapes the caller's process group.
        ( "$BANDS_FAILOVER_SCRIPT" </dev/null >/dev/null 2>&1 & )
        qlog_info "Failover watcher spawned"
        BANDS_FAILOVER_ARMED="true"
    fi
}

# bands_set_failover <true|anything-else>: persist the toggle; off also stops
# the watcher and clears the activation flag.
bands_set_failover() {
    local tmp="${BANDS_FAILOVER_ENABLED_FILE}.tmp"
    mkdir -p "$(dirname "$BANDS_FAILOVER_ENABLED_FILE")" 2>/dev/null

    if [ "$1" = "true" ]; then
        printf '1' > "$tmp" && mv -f "$tmp" "$BANDS_FAILOVER_ENABLED_FILE" || return 1
        qlog_info "Band failover ENABLED"
    else
        printf '0' > "$tmp" && mv -f "$tmp" "$BANDS_FAILOVER_ENABLED_FILE" || return 1
        qlog_info "Band failover DISABLED"

        BANDS_WATCHER_KILLED=""
        _bands_failover_kill_watcher
        [ -n "$BANDS_WATCHER_KILLED" ] && qlog_warn "Killed active failover watcher (PID=$BANDS_WATCHER_KILLED) due to toggle OFF"

        # Reset the UI from "Using Default Bands".
        rm -f "$BANDS_FAILOVER_ACTIVATED_FLAG"
    fi
    return 0
}

# --- Tower lock (tower/lock.sh, settings.sh, schedule.sh) ----------------------

# rv_tower_lte_cells "<earfcns>" "<pcis>": space-separated values, blanks skipped.
rv_tower_lte_cells() {
    local val
    for val in $1; do
        case "$val" in
            *[!0-9]*)
                RV_CODE="invalid_earfcn"; RV_DETAIL="EARFCN must be numeric"; return 1 ;;
        esac
    done
    for val in $2; do
        case "$val" in
            *[!0-9]*)
                RV_CODE="invalid_pci"; RV_DETAIL="PCI must be numeric"; return 1 ;;
        esac
        if [ "$val" -gt 503 ]; then
            RV_CODE="invalid_pci"; RV_DETAIL="PCI must be 0-503"; return 1
        fi
    done
    return 0
}

# rv_tower_nr_fields <pci> <arfcn> <band>: each a non-negative integer.
rv_tower_nr_fields() {
    case "$1" in
        ''|*[!0-9]*) RV_CODE="invalid_pci"; RV_DETAIL="PCI must be a non-negative integer"; return 1 ;;
    esac
    case "$2" in
        ''|*[!0-9]*) RV_CODE="invalid_arfcn"; RV_DETAIL="ARFCN must be a non-negative integer"; return 1 ;;
    esac
    case "$3" in
        ''|*[!0-9]*) RV_CODE="invalid_band"; RV_DETAIL="Band must be a non-negative integer"; return 1 ;;
    esac
    return 0
}

rv_tower_scs() {
    case "$1" in
        15|30|60|120|240) return 0 ;;
    esac
    RV_CODE="invalid_scs"
    RV_DETAIL="SCS must be 15, 30, 60, 120, or 240 kHz"
    return 1
}

# rv_tower_threshold <value>: empty passes (caller defaults it).
rv_tower_threshold() {
    [ -n "$1" ] || return 0
    case "$1" in
        *[!0-9]*)
            RV_CODE="invalid_threshold"; RV_DETAIL="Threshold must be a number 0-100"; return 1 ;;
    esac
    if [ "$1" -lt 0 ] 2>/dev/null || [ "$1" -gt 100 ] 2>/dev/null; then
        RV_CODE="invalid_threshold"; RV_DETAIL="Threshold must be 0-100"; return 1
    fi
    return 0
}

# rv_hhmm <value>: HH:MM, 24-hour.
rv_hhmm() {
    case "$1" in
        [01][0-9]:[0-5][0-9]|2[0-3]:[0-5][0-9]) return 0 ;;
    esac
    return 1
}

# rv_tower_days <csv>: at least one day, each 0-6.
rv_tower_days() {
    local d invalid_day=""
    if [ -z "$1" ]; then
        RV_CODE="no_days"; RV_DETAIL="At least one day must be selected"; return 1
    fi
    for d in $(echo "$1" | tr ',' ' '); do
        case "$d" in
            0|1|2|3|4|5|6) ;;
            *) invalid_day="$d" ;;
        esac
    done
    if [ -n "$invalid_day" ]; then
        RV_CODE="invalid_day"; RV_DETAIL="Days must be 0-6 (0=Sun, 6=Sat)"; return 1
    fi
    return 0
}

# --- Connection scenarios (scenarios/save.sh, delete.sh, activate.sh) ----------

# rv_scenario_id <id>: custom-<digits>; no path characters.
rv_scenario_id() {
    case "$1" in
        custom-[0-9]*) ;;
        *) return 1 ;;
    esac
    case "$1" in
        *[!A-Za-z0-9_-]*) return 1 ;;
    esac
    return 0
}

rv_scenario_mode() {
    case "$1" in
        AUTO|LTE|NR5G|LTE:NR5G) return 0 ;;
    esac
    return 1
}
