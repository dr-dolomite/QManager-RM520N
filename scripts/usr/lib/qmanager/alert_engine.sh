#!/bin/sh
# =============================================================================
# alert_engine.sh — Unified Alert Engine for QManager
# =============================================================================
# Sourced by qmanager_poller. Replaces the three independent per-channel
# downtime state machines (check_email_alert / check_sms_alert / the Go
# Discord daemon's own timer) with ONE monotonic downtime timer plus a
# routing x capability matrix that decides which enabled+routed+capable
# channel(s) fire for each of 3 events: connection_lost, connection_restored,
# reboot.
#
# events.sh (Recent Activities) is NOT touched by this engine — it has its
# own independent internet_lost/internet_restored detection. This engine
# only decides alert DISPATCH (SMS/email/Discord), not event logging.
#
# Signal source for downtime: conn_internet_available ONLY (never latency
# or packet loss — those are quality signals, not connectivity signals).
# Timer source: /proc/uptime (monotonic) — NEVER date +%s for durations,
# since NTP/NITZ can step the wall clock backward/forward mid-outage.
#
# Capability matrix (hardcoded, not configurable):
#   connection_lost:      sms=capable, email/discord=INCAPABLE (need internet)
#   connection_restored:  sms/email/discord all capable
#   reboot:                sms/email/discord all capable
#
# Config:
#   Routing:  /etc/qmanager/alert_routing.json  {"version":1,"events":{...}}
#   Channels: /etc/qmanager/email_alerts.json, sms_alerts.json,
#             discord_bot.json (read via each lib's own config-read function;
#             discord has no such lib function, so this engine reads it
#             directly.)
#   Reboot bookkeeping:
#     /proc/sys/kernel/random/boot_id  — compared against...
#     /etc/qmanager/last_boot_id       — ...to detect a reboot happened
#     /etc/qmanager/reboot_history.json — NDJSON {"epoch":N,"cause":"..."}, cap 10
#     /etc/qmanager/crash.log          — read-only here (written by
#                                        qmanager_watchcat as root, or by
#                                        the sudoers-gated root helper
#                                        qmanager_crash_log_append for
#                                        user-initiated reboots)
#
# Reload flags (touched by the CGI on save, consumed + removed here):
#   /tmp/qmanager_alert_routing_reload
#   /tmp/qmanager_email_reload    (shared with email_alerts.sh)
#   /tmp/qmanager_sms_reload      (shared with sms_alerts.sh)
#   /tmp/qmanager_discord_reload  (shared with discord_alerts.sh)
#
# Exposed to the poller:
#   alert_engine_init   — call once at poller startup
#   check_alerts         — call once per poll cycle
#
# Consumes from other libs (best-effort — degrades gracefully if any of
# these are missing, since a broken alert channel must never crash the
# poller):
#   _ea_read_config, _ea_enabled, _ea_recipient, _ea_threshold_minutes,
#     _ea_log_event, email_alert_send      (email_alerts.sh)
#   _sa_read_config, _sa_enabled, _sa_recipient, _sa_threshold_minutes,
#     _sa_log_event, sms_alert_send        (sms_alerts.sh)
#   discord_dispatch_message, _DA_LOG      (discord_alerts.sh)
#
# Poller globals read: conn_internet_available, conn_during_recovery
#
# Install location: /usr/lib/qmanager/alert_engine.sh
# =============================================================================

[ -n "$_ALERT_ENGINE_LOADED" ] && return 0
_ALERT_ENGINE_LOADED=1

# --- Constants ---------------------------------------------------------------
_AE_ROUTING_FILE="/etc/qmanager/alert_routing.json"
_AE_ROUTING_RELOAD_FLAG="/tmp/qmanager_alert_routing_reload"
_AE_DISCORD_CONFIG="/etc/qmanager/discord_bot.json"
_AE_BOOT_ID_FILE="/proc/sys/kernel/random/boot_id"
_AE_LAST_BOOT_ID_FILE="/etc/qmanager/last_boot_id"
_AE_REBOOT_HISTORY_FILE="/etc/qmanager/reboot_history.json"
_AE_CRASH_LOG="/etc/qmanager/crash.log"
_AE_MAX_REBOOT_HISTORY=10
_AE_REBOOT_COALESCE_THRESHOLD=3
_AE_REBOOT_CLASSIFY_WINDOW_SECS=600

# Applied verbatim whenever alert_routing.json is missing or fails to parse.
_AE_ROUTING_DEFAULT='{"connection_lost":{"sms":true,"email":false,"discord":false},"connection_restored":{"sms":true,"email":true,"discord":true},"reboot":{"sms":true,"email":true,"discord":true}}'

# --- State (poller-lifetime only — not persisted across a poller restart,
#     matching the pre-existing per-channel timers this engine replaces) ----
_ae_routing_json="$_AE_ROUTING_DEFAULT"
_ae_down=0            # 1 while an outage is being tracked
_ae_down_start=0      # /proc/uptime seconds at the down transition
_ae_lost_sent_sms=0   # connection_lost dispatched for this outage already?
_ae_reboot_pending=0  # a reboot was detected this boot and not yet alerted

# Discord config mirror (no _read_config equivalent exists in discord_alerts.sh)
_ae_discord_enabled="false"
_ae_discord_owner_id=""
_ae_discord_threshold_minutes=5

# --- Discord library (optional — poller does not source this on its own) ----
. /usr/lib/qmanager/discord_alerts.sh 2>/dev/null || {
    qlog_warn "alert_engine: discord_alerts.sh not found, Discord dispatch disabled"
    discord_dispatch_message() { return 1; }
    da_is_running() { return 1; }
}

# =============================================================================
# _ae_uptime_secs — Monotonic clock (integer seconds), immune to NTP/NITZ steps
# =============================================================================
_ae_uptime_secs() {
    awk '{ print int($1) }' /proc/uptime 2>/dev/null
}

# =============================================================================
# _ae_format_duration — Convert seconds to human-readable string
# =============================================================================
_ae_format_duration() {
    local secs="$1" hours mins remaining
    case "$secs" in ''|*[!0-9]*) secs=0 ;; esac
    hours=$((secs / 3600))
    remaining=$((secs % 3600))
    mins=$((remaining / 60))
    remaining=$((remaining % 60))
    if [ "$hours" -gt 0 ]; then
        printf "%dh %dm %ds" "$hours" "$mins" "$remaining"
    elif [ "$mins" -gt 0 ]; then
        printf "%dm %ds" "$mins" "$remaining"
    else
        printf "%ds" "$remaining"
    fi
}

# =============================================================================
# Per-channel config refresh — defensive: never assume the sibling lib loaded
# =============================================================================
_ae_refresh_email() {
    if command -v _ea_read_config >/dev/null 2>&1; then
        _ea_read_config
    else
        _ea_enabled="false"
    fi
}

_ae_refresh_sms() {
    if command -v _sa_read_config >/dev/null 2>&1; then
        _sa_read_config
    else
        _sa_enabled="false"
    fi
}

_ae_read_discord_config() {
    if [ ! -f "$_AE_DISCORD_CONFIG" ]; then
        _ae_discord_enabled="false"
        return 0
    fi
    _ae_discord_enabled=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$_AE_DISCORD_CONFIG" 2>/dev/null)
    case "$_ae_discord_enabled" in true) ;; *) _ae_discord_enabled="false" ;; esac
    _ae_discord_owner_id=$(jq -r '.owner_discord_id // ""' "$_AE_DISCORD_CONFIG" 2>/dev/null)
    _ae_discord_threshold_minutes=$(jq -r '.threshold_minutes // 5' "$_AE_DISCORD_CONFIG" 2>/dev/null)
    case "$_ae_discord_threshold_minutes" in ''|*[!0-9]*) _ae_discord_threshold_minutes=5 ;; esac
}

# =============================================================================
# Routing table — load / reload
# =============================================================================
_ae_load_routing() {
    local candidate
    if [ -f "$_AE_ROUTING_FILE" ]; then
        candidate=$(jq -c '.events // empty' "$_AE_ROUTING_FILE" 2>/dev/null)
        if [ -n "$candidate" ] && [ "$candidate" != "null" ]; then
            _ae_routing_json="$candidate"
            return 0
        fi
    fi
    qlog_warn "alert_engine: routing config missing or unparseable, using defaults"
    _ae_routing_json="$_AE_ROUTING_DEFAULT"
}

# =============================================================================
# Capability matrix (hardcoded backend truth — CGI must mirror this)
# =============================================================================
_ae_capable() {
    case "$1" in
        connection_lost)
            [ "$2" = "sms" ]
            ;;
        connection_restored|reboot)
            case "$2" in sms|email|discord) return 0 ;; *) return 1 ;; esac
            ;;
        *)
            return 1
            ;;
    esac
}

# =============================================================================
# _ae_effective_send <event> <channel> — capability AND master-enabled AND routed
# =============================================================================
_ae_effective_send() {
    local event="$1" channel="$2" routed

    _ae_capable "$event" "$channel" || return 1

    case "$channel" in
        sms)     [ "$_sa_enabled" = "true" ] || return 1 ;;
        email)   [ "$_ea_enabled" = "true" ] || return 1 ;;
        discord) [ "$_ae_discord_enabled" = "true" ] || return 1 ;;
        *)       return 1 ;;
    esac

    routed=$(printf '%s' "$_ae_routing_json" | jq -r --arg e "$event" --arg c "$channel" \
        '(.[$e][$c]) | if . == null then false else . end' 2>/dev/null)
    [ "$routed" = "true" ]
}

# =============================================================================
# Reboot detection / classification
# =============================================================================

# Append one NDJSON entry to reboot_history.json, capped to the newest N.
_ae_append_reboot_history() {
    local epoch="$1" cause="$2" count tmp
    mkdir -p /etc/qmanager 2>/dev/null
    printf '{"epoch":%s,"cause":"%s"}\n' "$epoch" "$cause" >> "$_AE_REBOOT_HISTORY_FILE" 2>/dev/null

    count=$(wc -l < "$_AE_REBOOT_HISTORY_FILE" 2>/dev/null || echo 0)
    if [ "$count" -gt "$_AE_MAX_REBOOT_HISTORY" ]; then
        tmp="${_AE_REBOOT_HISTORY_FILE}.tmp"
        if tail -n "$_AE_MAX_REBOOT_HISTORY" "$_AE_REBOOT_HISTORY_FILE" > "$tmp" 2>/dev/null; then
            mv "$tmp" "$_AE_REBOOT_HISTORY_FILE" 2>/dev/null || rm -f "$tmp"
        else
            rm -f "$tmp"
        fi
    fi
}

# Classify the reboot that just happened by inspecting the newest crash.log
# line. Sets _ae_reboot_cause to one of: watchdog | user | unplanned.
_ae_classify_reboot() {
    _ae_reboot_cause="unplanned"
    [ -f "$_AE_CRASH_LOG" ] || return 0

    local last_line last_epoch last_tag now age
    last_line=$(tail -n 1 "$_AE_CRASH_LOG" 2>/dev/null)
    [ -z "$last_line" ] && return 0

    last_epoch=$(printf '%s' "$last_line" | cut -d'|' -f1)
    last_tag=$(printf '%s' "$last_line" | cut -d'|' -f3)
    case "$last_epoch" in ''|*[!0-9]*) return 0 ;; esac

    now=$(date +%s)
    age=$((now - last_epoch))
    [ "$age" -lt 0 ] && age=0

    if [ "$age" -le "$_AE_REBOOT_CLASSIFY_WINDOW_SECS" ]; then
        case "$last_tag" in
            tier4_escalation) _ae_reboot_cause="watchdog" ;;
            user)             _ae_reboot_cause="user" ;;
            *)                _ae_reboot_cause="unplanned" ;;
        esac
    fi
}

# Detect a reboot by comparing /proc/sys/kernel/random/boot_id against the
# last-seen id persisted in /etc/qmanager/last_boot_id. First boot (file
# absent) is recorded but NEVER alerted — installs/upgrades reboot the
# device themselves and that must not look like a crash to the user.
_ae_init_boot_check() {
    local cur_boot_id

    cur_boot_id=$(cat "$_AE_BOOT_ID_FILE" 2>/dev/null)
    if [ -z "$cur_boot_id" ]; then
        qlog_warn "alert_engine: cannot read boot_id, reboot detection disabled this run"
        return 0
    fi

    if [ ! -f "$_AE_LAST_BOOT_ID_FILE" ]; then
        printf '%s' "$cur_boot_id" > "${_AE_LAST_BOOT_ID_FILE}.tmp" 2>/dev/null \
            && mv "${_AE_LAST_BOOT_ID_FILE}.tmp" "$_AE_LAST_BOOT_ID_FILE" 2>/dev/null
        qlog_info "alert_engine: first boot_id recorded, reboot alert not armed"
        return 0
    fi

    local prev_boot_id
    prev_boot_id=$(cat "$_AE_LAST_BOOT_ID_FILE" 2>/dev/null)
    if [ "$cur_boot_id" != "$prev_boot_id" ]; then
        qlog_info "alert_engine: boot_id changed — classifying reboot cause"
        _ae_classify_reboot
        _ae_append_reboot_history "$(date +%s)" "$_ae_reboot_cause"
        _ae_reboot_pending=1
        printf '%s' "$cur_boot_id" > "${_AE_LAST_BOOT_ID_FILE}.tmp" 2>/dev/null \
            && mv "${_AE_LAST_BOOT_ID_FILE}.tmp" "$_AE_LAST_BOOT_ID_FILE" 2>/dev/null
    fi
}

# =============================================================================
# Dispatch adapters
# =============================================================================

_ae_email_subject() {
    case "$1" in
        connection_restored) printf '%s' "Connection Recovered" ;;
        reboot)               printf '%s' "Device Rebooted" ;;
        *)                    printf '%s' "Alert" ;;
    esac
}

# Discord successes are logged by the Go daemon itself once it actually
# completes the Discord API call — we only log here when the dispatch never
# reached the daemon at all (not installed / not running / write failed),
# since in that case no other process will ever record the attempt.
_ae_log_discord_failed() {
    local trigger="$1" recipient="$2" ts logfile
    logfile="${_DA_LOG:-/tmp/qmanager_discord_log.json}"
    ts=$(date "+%Y-%m-%d %H:%M:%S")
    jq -n -c \
        --arg ts "$ts" --arg trigger "$trigger" --arg recipient "$recipient" \
        '{timestamp: $ts, trigger: $trigger, status: "failed", recipient: $recipient}' \
        >> "$logfile" 2>/dev/null
}

# _ae_dispatch <channel> <trigger> <message>
# Sends via the real channel transport and logs the outcome (except Discord
# success, see _ae_log_discord_failed above). Returns the transport's rc.
_ae_dispatch() {
    local channel="$1" trigger="$2" message="$3"
    local rc=1 recipient="" status="failed"

    case "$channel" in
        sms)
            recipient="$_sa_recipient"
            if command -v sms_alert_send >/dev/null 2>&1; then
                sms_alert_send "$message"
                rc=$?
            fi
            [ "$rc" -eq 0 ] && status="sent"
            command -v _sa_log_event >/dev/null 2>&1 && _sa_log_event "$trigger" "$status" "$recipient"
            ;;
        email)
            recipient="$_ea_recipient"
            if command -v email_alert_send >/dev/null 2>&1; then
                email_alert_send "$(_ae_email_subject "$trigger")" "$message"
                rc=$?
            fi
            [ "$rc" -eq 0 ] && status="sent"
            command -v _ea_log_event >/dev/null 2>&1 && _ea_log_event "$trigger" "$status" "$recipient"
            ;;
        discord)
            recipient="discord:${_ae_discord_owner_id:-unknown}"
            if command -v discord_dispatch_message >/dev/null 2>&1; then
                discord_dispatch_message "$message"
                rc=$?
            fi
            [ "$rc" -ne 0 ] && _ae_log_discord_failed "$trigger" "$recipient"
            ;;
        *)
            return 1
            ;;
    esac

    qlog_info "alert_engine: dispatch channel=$channel trigger=$trigger rc=$rc"
    return "$rc"
}

# =============================================================================
# Reboot alert delivery (with trailing-hour coalescing)
# =============================================================================
_ae_deliver_reboot() {
    local cause count now cutoff msg

    cause=$(tail -n 1 "$_AE_REBOOT_HISTORY_FILE" 2>/dev/null | jq -r '.cause // empty' 2>/dev/null)
    if [ -z "$cause" ] || [ "$cause" = "null" ]; then
        cause="unplanned"
    fi

    # Coalescer: mirrors qmanager_watchcat's own trailing-hour crash count
    # (same CRASH_LOG, same awk technique) so a flapping device doesn't send
    # one message per reboot.
    now=$(date +%s)
    cutoff=$((now - 3600))
    count=$(awk -v cutoff="$cutoff" -F'|' \
        '$1 ~ /^[0-9]+$/ && $1 >= cutoff && $2 == "reboot" { n++ } END { print n+0 }' \
        "$_AE_CRASH_LOG" 2>/dev/null)
    case "$count" in ''|*[!0-9]*) count=0 ;; esac

    if [ "$count" -gt "$_AE_REBOOT_COALESCE_THRESHOLD" ]; then
        msg="Device rebooted ${count} times in the last hour"
    else
        msg="Device rebooted (cause: ${cause})"
    fi

    _ae_effective_send reboot sms     && _ae_dispatch sms     reboot "$msg"
    _ae_effective_send reboot email   && _ae_dispatch email   reboot "$msg"
    _ae_effective_send reboot discord && _ae_dispatch discord reboot "$msg"
}

# =============================================================================
# Downtime tracking
# =============================================================================

# connection_lost: SMS is the only capable channel, so this only ever
# evaluates SMS — kept as a dedicated function so the capability table stays
# the single source of truth (adding a capable channel here is a one-line
# change to _ae_capable, not a rewrite of this logic).
_ae_check_connection_lost() {
    local now_up="$1" elapsed thr_min thr_sec dur_text msg

    [ "$_ae_lost_sent_sms" = "1" ] && return 0

    thr_min="$_sa_threshold_minutes"
    case "$thr_min" in ''|*[!0-9]*) return 0 ;; esac
    thr_sec=$((thr_min * 60))

    elapsed=$((now_up - _ae_down_start))
    [ "$elapsed" -lt 0 ] && elapsed=0
    [ "$elapsed" -ge "$thr_sec" ] || return 0

    _ae_effective_send connection_lost sms || return 0

    dur_text=$(_ae_format_duration "$elapsed")
    msg="Connection down ${dur_text}"
    _ae_dispatch sms connection_lost "$msg"
    _ae_lost_sent_sms=1
}

# connection_restored: evaluated independently per channel — a channel fires
# iff the TOTAL outage duration crossed *that channel's own* threshold, same
# semantics as the three timers this engine replaces (each channel used to
# track downtime and threshold independently).
_ae_maybe_restore() {
    local channel="$1" elapsed="$2" thr_min thr_sec dur_text msg

    case "$channel" in
        sms)     thr_min="$_sa_threshold_minutes" ;;
        email)   thr_min="$_ea_threshold_minutes" ;;
        discord) thr_min="$_ae_discord_threshold_minutes" ;;
        *)       return 1 ;;
    esac
    case "$thr_min" in ''|*[!0-9]*) thr_min=5 ;; esac
    thr_sec=$((thr_min * 60))

    [ "$elapsed" -ge "$thr_sec" ] || return 0
    _ae_effective_send connection_restored "$channel" || return 0

    dur_text=$(_ae_format_duration "$elapsed")
    msg="Connection recovered (down ${dur_text})"
    _ae_dispatch "$channel" connection_restored "$msg"
}

_ae_handle_restore() {
    local now_up="$1" elapsed
    elapsed=$((now_up - _ae_down_start))
    [ "$elapsed" -lt 0 ] && elapsed=0
    qlog_info "alert_engine: recovery detected — downtime=${elapsed}s"

    _ae_maybe_restore sms     "$elapsed"
    _ae_maybe_restore email   "$elapsed"
    _ae_maybe_restore discord "$elapsed"

    if [ "$_ae_reboot_pending" = "1" ]; then
        _ae_deliver_reboot
        _ae_reboot_pending=0
    fi
}

# =============================================================================
# check_alerts — called every poll cycle (replaces check_email_alert +
#                check_sms_alert)
# =============================================================================
check_alerts() {
    # No alerts during scheduled low power mode
    [ -f "/tmp/qmanager_low_power_active" ] && return 0

    # Guardrail: freeze entirely during watchdog recovery — mirrors
    # events.sh:339's detect_data_connection_events guard. Do not reset the
    # timer, do not dispatch, do not even pick up config reloads, so a
    # recovery action never gets misread as a real downtime edge.
    if [ "$conn_during_recovery" = "true" ]; then
        return 0
    fi

    # --- Reload flags (touched by the CGI on save) ---
    if [ -f "$_AE_ROUTING_RELOAD_FLAG" ]; then
        rm -f "$_AE_ROUTING_RELOAD_FLAG"
        _ae_load_routing
        qlog_info "alert_engine: routing config reloaded"
    fi
    if [ -f "$_EA_RELOAD_FLAG" ]; then
        rm -f "$_EA_RELOAD_FLAG"
        _ae_refresh_email
        qlog_info "alert_engine: email config reloaded"
    fi
    if [ -f "$_SA_RELOAD_FLAG" ]; then
        rm -f "$_SA_RELOAD_FLAG"
        _ae_refresh_sms
        qlog_info "alert_engine: sms config reloaded"
    fi
    if [ -f "$_DA_RELOAD_FLAG" ]; then
        rm -f "$_DA_RELOAD_FLAG"
        _ae_read_discord_config
        qlog_info "alert_engine: discord config reloaded"
    fi

    local now_up
    now_up=$(_ae_uptime_secs)
    case "$now_up" in
        ''|*[!0-9]*)
            qlog_warn "alert_engine: /proc/uptime unreadable, skipping this cycle"
            return 0
            ;;
    esac

    local did_restore=0

    if [ "$conn_internet_available" = "null" ] || [ -z "$conn_internet_available" ]; then
        # Stale/null ping data: if we're not already tracking an outage, do
        # nothing (don't guess). If we ARE tracking one, leave the timer
        # running untouched — the poller may just be stuck on AT I/O.
        :
    elif [ "$conn_internet_available" = "false" ]; then
        if [ "$_ae_down" != "1" ]; then
            _ae_down=1
            _ae_down_start="$now_up"
            _ae_lost_sent_sms=0
            qlog_debug "alert_engine: downtime tracking started at uptime=${now_up}s"
        fi
    elif [ "$conn_internet_available" = "true" ] && [ "$_ae_down" = "1" ]; then
        _ae_handle_restore "$now_up"
        _ae_down=0
        _ae_down_start=0
        _ae_lost_sent_sms=0
        did_restore=1
    fi

    # While an outage is ongoing, see if the SMS connection_lost threshold
    # has now been crossed.
    if [ "$_ae_down" = "1" ]; then
        _ae_check_connection_lost "$now_up"
    fi

    # A reboot was detected at startup but the device came back up already
    # connected (never observed as "down" by this engine) — e.g. a clean
    # user-initiated reboot with a fast reconnect. Deliver once, here.
    if [ "$did_restore" != "1" ] && [ "$_ae_reboot_pending" = "1" ] \
        && [ "$_ae_down" != "1" ] && [ "$conn_internet_available" = "true" ]; then
        _ae_deliver_reboot
        _ae_reboot_pending=0
    fi
}

# =============================================================================
# alert_engine_init — called once at poller startup
# =============================================================================
alert_engine_init() {
    _ae_reboot_pending=0
    _ae_down=0
    _ae_down_start=0
    _ae_lost_sent_sms=0

    mkdir -p /etc/qmanager 2>/dev/null

    _ae_init_boot_check
    _ae_load_routing
    _ae_refresh_email
    _ae_refresh_sms
    _ae_read_discord_config

    qlog_info "alert_engine: initialized (reboot_pending=$_ae_reboot_pending)"
}
