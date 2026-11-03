#!/bin/sh
# monitoring_validate.sh — validators and savers for the watchdog, connection-quality, sites and alerts
# CGIs, shared with the config-backup appliers (config_backup_monitoring.sh) so a restore saves like the UI.

[ -n "${_MONITORING_VALIDATE_LOADED:-}" ] && return 0
_MONITORING_VALIDATE_LOADED=1

_MV_LIB_DIR="${QM_LIB_DIR:-/usr/lib/qmanager}"
. "$_MV_LIB_DIR/config.sh"
. "$_MV_LIB_DIR/platform.sh"
. "$_MV_LIB_DIR/conn_state.sh"

MV_WD_RELOAD_FLAG="/tmp/qmanager_watchcat_reload"
MV_WD_STATE="/tmp/qmanager_watchcat.json"
MV_WD_DISABLED_FLAG="/tmp/qmanager_watchcat_disabled"
MV_PING_CONFIG="${PING_PROFILE_CONFIG:-/etc/qmanager/ping_profile.json}"
MV_PING_RELOAD_FLAG="${PING_PROFILE_RELOAD_FLAG:-/tmp/qmanager_ping_reload}"

MV_SITES_TMP="${QM_SITES_TMP_DIR:-/tmp}"
MV_SITES_CONF="${QM_SITES_CONF:-/etc/qmanager/sites.json}"
MV_SITES_DEFAULT="google.com facebook.com tiktok.com youtube.com roblox.com spotify.com x.com cellmapper.net reddit.com github.com discord.com instagram.com messenger.com"

MV_SMS_RELOAD="/tmp/qmanager_sms_reload"
MV_EMAIL_RELOAD="/tmp/qmanager_email_reload"
MV_DISCORD_RELOAD="/tmp/qmanager_discord_reload"
MV_ROUTING_RELOAD="/tmp/qmanager_alert_routing_reload"
MV_ROUTING_CONFIG="/etc/qmanager/alert_routing.json"

# connection_lost is incapable for email/discord (both need internet); must match alert_engine.sh's _ae_capable.
MV_ROUTING_DEFAULT='{"connection_lost":{"sms":true,"email":false,"discord":false},"connection_restored":{"sms":true,"email":true,"discord":true},"reboot":{"sms":true,"email":true,"discord":true}}'

# =============================================================================
# Watchdog (monitoring/watchdog.sh)
# =============================================================================

# mv_validate_int <val> <min> <max>: unsigned-integer-only range check.
mv_validate_int() {
    local val="$1" min="$2" max="$3"
    case "$val" in ''|*[!0-9]*) return 1 ;; esac
    [ "$val" -ge "$min" ] 2>/dev/null && [ "$val" -le "$max" ] 2>/dev/null
}

# mv_wd_check <field> <value>: rc 0 when valid; else prints the reject reason, rc 1.
mv_wd_check() {
    local f="$1" v="$2" lo hi
    case "$f" in
        fail_threshold)       lo=1;  hi=20 ;;
        probe_interval)       lo=1;  hi=60 ;;
        check_interval)       lo=5;  hi=60 ;;
        cooldown)             lo=10; hi=300 ;;
        max_reboots_per_hour) lo=1;  hi=10 ;;
        backup_sim_slot)
            case "$v" in 1|2) return 0 ;; esac
            echo "must be 1 or 2"
            return 1
            ;;
        *) echo "unknown field"; return 1 ;;
    esac
    mv_validate_int "$v" "$lo" "$hi" && return 0
    echo "must be an integer between $lo and $hi"
    return 1
}

# mv_wd_key_normalize <key> <value>: a wd_common.sh key. Prints the value to store (booleans as 1/0), rc 0;
# on a bad value prints the reject reason, rc 1.
mv_wd_key_normalize() {
    local k="$1" v="$2" spec min max
    spec=$(wd_key_spec "$k") || { echo "unknown key"; return 1; }
    set -- $spec
    min="$2"; max="$3"
    if [ "$min" = "0" ] && [ "$max" = "1" ]; then
        case "$v" in
            true) echo 1 ;;
            false) echo 0 ;;
            *) echo "must be true or false"; return 1 ;;
        esac
    else
        wd_key_valid "$k" "$v" || { echo "must be an integer between $min and $max"; return 1; }
        echo "$v"
    fi
}

# mv_wd_keys_json: the wd_common.sh keys as one JSON object (a 0-1 range is a boolean).
mv_wd_keys_json() {
    local k v out sep
    out=""; sep=""
    for k in $WD_KEYS; do
        v=$(wd_key_get "$k")
        case "$(wd_key_spec "$k")" in
            *" 0 1") [ "$v" = "1" ] && v=true || v=false ;;
        esac
        out="${out}${sep}\"${k}\":${v}"
        sep=","
    done
    printf '{%s}' "$out"
}

# Defensive runtime migration: copy a legacy watchcat.max_failures across once when
# fail_threshold is unset, then delete the old key. Idempotent.
migrate_fail_threshold() {
    local current legacy
    current=$(qm_config_get watchcat fail_threshold "")
    [ -n "$current" ] && return
    legacy=$(qm_config_get watchcat max_failures "")
    if [ -n "$legacy" ]; then
        qm_config_set watchcat fail_threshold "$legacy"
        qm_config_delete watchcat max_failures
        qlog_info "Migrated watchcat.max_failures -> watchcat.fail_threshold ($legacy)"
    fi
}

# True when the daemon's own heartbeat (uptime delta, the poller's test) is past
# its limit: the unit can be active while the daemon is hung. Unknown reads as live.
watchcat_state_stale() {
    local up mono limit v
    read -r up _ < /proc/uptime 2>/dev/null
    up="${up%%.*}"
    set -- $(jq -r '[(.mono // 0), (.stale_after // 0)] | map(tostring) | join(" ")' "$MV_WD_STATE" 2>/dev/null)
    mono="$1" limit="$2"
    for v in "$up" "$mono" "$limit"; do
        case "$v" in ''|*[!0-9]*) return 1 ;; esac
    done
    [ "$mono" -gt 0 ] && [ "$limit" -gt 0 ] && [ $((up - mono)) -gt "$limit" ]
}

# mv_wd_commit: the watchdog save's apply pass. Reads the caller's validated f_enabled, f_fail_threshold,
# f_probe_interval, f_check_interval, f_cooldown, f_tier1..f_tier4, f_backup_sim_slot, f_max_reboots and
# wd_writes ("key=value ..."). rc 0 ok, 10 boot-enable failed, 11 boot-disable failed (config already saved).
mv_wd_commit() {
    local _kv _pp new_enabled
    qm_config_init
    migrate_fail_threshold

    if [ -n "$f_enabled" ]; then
        case "$f_enabled" in
            true)  qm_config_set watchcat enabled 1 ;;
            false) : ;; # committed only after svc_disable succeeds, below
        esac
    fi

    [ -n "$f_fail_threshold" ] && qm_config_set watchcat fail_threshold "$f_fail_threshold"

    [ -n "$f_check_interval" ] && qm_config_set watchcat check_interval "$f_check_interval"
    [ -n "$f_cooldown" ] && qm_config_set watchcat cooldown "$f_cooldown"

    if [ -n "$f_tier1" ]; then
        case "$f_tier1" in true) qm_config_set watchcat tier1_enabled 1 ;; false) qm_config_set watchcat tier1_enabled 0 ;; esac
    fi

    if [ -n "$f_tier2" ]; then
        case "$f_tier2" in true) qm_config_set watchcat tier2_enabled 1 ;; false) qm_config_set watchcat tier2_enabled 0 ;; esac
    fi

    if [ -n "$f_tier3" ]; then
        case "$f_tier3" in true) qm_config_set watchcat tier3_enabled 1 ;; false) qm_config_set watchcat tier3_enabled 0 ;; esac
    fi

    if [ -n "$f_tier4" ]; then
        case "$f_tier4" in true) qm_config_set watchcat tier4_enabled 1 ;; false) qm_config_set watchcat tier4_enabled 0 ;; esac
    fi

    if [ -n "$f_backup_sim_slot" ] && [ "$f_backup_sim_slot" != "null" ]; then
        qm_config_set watchcat backup_sim_slot "$f_backup_sim_slot"
    else
        qm_config_set watchcat backup_sim_slot ""
    fi

    [ -n "$f_max_reboots" ] && qm_config_set watchcat max_reboots_per_hour "$f_max_reboots"

    for _kv in $wd_writes; do
        qm_config_set watchcat "${_kv%%=*}" "${_kv#*=}"
    done

    if [ -n "$f_probe_interval" ]; then
        _pp='{}'
        [ -f "$MV_PING_CONFIG" ] && _pp=$(cat "$MV_PING_CONFIG" 2>/dev/null)
        printf '%s' "$_pp" | jq -e 'type == "object"' >/dev/null 2>&1 || _pp='{}'
        if printf '%s' "$_pp" | jq --argjson v "$f_probe_interval" '.interval_sec = $v' > "${MV_PING_CONFIG}.tmp" 2>/dev/null &&
            [ -s "${MV_PING_CONFIG}.tmp" ]; then
            mv "${MV_PING_CONFIG}.tmp" "$MV_PING_CONFIG"
            touch /tmp/qmanager_ping_reload
        else
            rm -f "${MV_PING_CONFIG}.tmp"
            qlog_error "Failed to write interval_sec to $MV_PING_CONFIG"
        fi
    fi

    # Signal running watchcat daemon to reload config (if it's already running)
    touch "$MV_WD_RELOAD_FLAG"

    # Desired enabled state: this request's f_enabled if it set one, otherwise whatever is
    # already persisted (enabled=0 for "false" is not yet written, see the deferred commit below).
    new_enabled=""
    if [ "$f_enabled" = "false" ]; then
        new_enabled=0
    else
        new_enabled=$(qm_config_get watchcat enabled 0)
    fi
    if [ "$new_enabled" = "1" ]; then
        rm -f "$MV_WD_DISABLED_FLAG"
        # Enable and start the watchcat service
        svc_enable qmanager_watchcat || return 10
        # A live daemon reloads from the flag touched above (a restart would drop
        # its recovery state); start it when down, restart it when hung.
        if svc_is_running qmanager_watchcat && ! watchcat_state_stale; then
            qlog_info "Watchdog settings saved, running watchcat will reload"
        else
            ( svc_restart qmanager_watchcat & )
            qlog_info "Watchdog settings saved, watchcat enabled and (re)started"
        fi
    else
        # Stop and disable the watchcat service BEFORE persisting enabled=0,
        # so a failed disable never leaves stale "enabled=0" config behind.
        svc_stop qmanager_watchcat
        svc_disable qmanager_watchcat || return 11
        qm_config_set watchcat enabled 0
        qlog_info "Watchdog settings saved, watchcat stopped and disabled"
    fi
    return 0
}

# =============================================================================
# Connection quality: ping profile (settings/ping_profile.sh)
# =============================================================================

mv_ping_profile_ok() {
    case "$1" in
        sensitive|regular|relaxed|quiet) return 0 ;;
        *) return 1 ;;
    esac
}

# mv_ping_interval_ok <val>: empty (absent) or an integer 1-60.
mv_ping_interval_ok() {
    case "$1" in
        '') return 0 ;;
        *[!0-9]*) return 1 ;;
    esac
    if [ "$1" -lt 1 ] || [ "$1" -gt 60 ]; then
        return 1
    fi
    return 0
}

# Validate an ICMP probe slot server-side. Two families:
#   host          a hostname: [0-9A-Za-z.-], no leading/trailing hyphen or dot, no empty label.
#   ipv4_literal  a dotted quad: [0-9.], exactly four octets, each 1-3 digits and <= 255.
# Common: trimmed, non-empty, <= 128 chars, no whitespace or shell/HTML metacharacters.
# Echoes the trimmed value on success; prints an error naming the slot and returns 1 on failure.
mv_validate_target() {
    local label="$1"
    local raw="$2"
    local family="$3"

    local host
    host=$(printf '%s' "$raw" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

    if [ -z "$host" ]; then
        echo "${label} cannot be empty"
        return 1
    fi

    if [ ${#host} -gt 128 ]; then
        echo "${label} exceeds 128 characters"
        return 1
    fi

    # No interior whitespace (space or tab).
    case "$host" in
        *" "*|*"	"*)
            echo "${label} must not contain whitespace"
            return 1
            ;;
    esac

    # Reject shell/HTML metacharacters: ` $ ( ) ; | < > " \
    case "$host" in
        *'`'*|*'$'*|*'('*|*')'*|*';'*|*'|'*|*'<'*|*'>'*|*'"'*|*'\'*)
            echo "${label} contains disallowed characters"
            return 1
            ;;
    esac

    case "$family" in
        host)
            case "$host" in
                *[!0-9A-Za-z.-]*)
                    echo "${label} is not a valid hostname"
                    return 1
                    ;;
            esac
            # Label sanity: a leading or trailing hyphen, a hyphen next to a dot, an empty
            # label ("..") or a leading/trailing dot are names no resolver answers for.
            case "$host" in
                -*|*-|.*|*.|*..*|*-.*|*.-*)
                    echo "${label} is not a valid hostname"
                    return 1
                    ;;
            esac
            ;;
        ipv4_literal)
            case "$host" in
                *[!0-9.]*)
                    echo "${label} must be an IPv4 literal (a hostname is not accepted in this slot)"
                    return 1
                    ;;
            esac
            # Exactly four octets, each 1-3 digits and no greater than 255.
            local _rest _oct _n
            _rest="$host"
            _n=0
            while [ -n "$_rest" ]; do
                case "$_rest" in
                    *.*) _oct="${_rest%%.*}"; _rest="${_rest#*.}" ;;
                    *)   _oct="$_rest";      _rest="" ;;
                esac
                _n=$((_n + 1))
                case "$_oct" in
                    ''|*[!0-9]*)
                        echo "${label} is not a valid IPv4 literal"
                        return 1
                        ;;
                esac
                if [ ${#_oct} -gt 3 ] || [ "$_oct" -gt 255 ]; then
                    echo "${label} is not a valid IPv4 literal"
                    return 1
                fi
            done
            if [ "$_n" -ne 4 ]; then
                echo "${label} is not a valid IPv4 literal"
                return 1
            fi
            ;;
        *)
            echo "${label} has an unknown slot family"
            return 1
            ;;
    esac

    printf '%s' "$host"
    return 0
}

# mv_ping_clear_interval: drop the stored interval_sec so the profile's own cadence applies. rc 1 on write failure.
mv_ping_clear_interval() {
    local CONFIG="$MV_PING_CONFIG"
    if [ -f "$CONFIG" ]; then
        if ! jq -e 'type == "object"' "$CONFIG" >/dev/null 2>&1 \
            || ! jq 'del(.interval_sec)' "$CONFIG" > "${CONFIG}.tmp" 2>/dev/null \
            || [ ! -s "${CONFIG}.tmp" ] \
            || ! mv "${CONFIG}.tmp" "$CONFIG"; then
            rm -f "${CONFIG}.tmp"
            return 1
        fi
    fi
    qlog_info "Stored interval_sec cleared; the profile's cadence applies"
    touch "$MV_PING_RELOAD_FLAG" 2>/dev/null || qlog_warn "Failed to touch reload flag at $MV_PING_RELOAD_FLAG"
    return 0
}

# mv_ping_save <profile> <interval|""> <host_1> <host_2> <ip_1> <ip_2>: atomic key-merge into ping_profile.json
# (a stored interval_sec survives unless one is passed), then pokes the reload flag.
# rc 1 could not build the JSON, rc 2 could not write the file.
mv_ping_save() {
    local CONFIG="$MV_PING_CONFIG" new_profile="$1" new_interval="$2"
    local new_h1="$3" new_h2="$4" new_i1="$5" new_i2="$6" existing_json

    mkdir -p "$(dirname "$CONFIG")"

    existing_json='{}'
    if [ -f "$CONFIG" ]; then
        existing_json=$(cat "$CONFIG" 2>/dev/null)
        # Reuse the file only when it parses AND is an object: the merge indexes it, and
        # `jq -e .` tests truthiness (passes `5`, rejects `null`), the wrong predicate.
        if ! printf '%s' "$existing_json" | jq -e 'type == "object"' >/dev/null 2>&1; then
            qlog_warn "Unusable $CONFIG (not a JSON object) — rebuilding from defaults"
            existing_json='{}'
        fi
    fi

    if ! printf '%s' "$existing_json" | jq \
        --argjson interval "${new_interval:-null}" \
        --arg profile "$new_profile" \
        --arg host_1 "$new_h1" \
        --arg host_2 "$new_h2" \
        --arg ip_1 "$new_i1" \
        --arg ip_2 "$new_i2" \
        '.profile = $profile
         | .target_host_1 = $host_1
         | .target_host_2 = $host_2
         | .target_ip_1 = $ip_1
         | .target_ip_2 = $ip_2
         | if $interval != null then .interval_sec = $interval else . end' \
        > "${CONFIG}.tmp" 2>/dev/null || [ ! -s "${CONFIG}.tmp" ]; then
        # -s: never `mv` a zero-byte temp over a live config (a full /etc UBIFS can leave one).
        rm -f "${CONFIG}.tmp"
        return 1
    fi

    if ! mv "${CONFIG}.tmp" "$CONFIG"; then
        rm -f "${CONFIG}.tmp"
        return 2
    fi

    qlog_info "Ping profile saved: profile=$new_profile interval=${new_interval:-unchanged} chain=$new_h1,$new_h2,$new_i1,$new_i2"

    # Failure is non-fatal: the daemon keeps the old config; the user can retry.
    if ! touch "$MV_PING_RELOAD_FLAG" 2>/dev/null; then
        qlog_warn "Failed to touch reload flag at $MV_PING_RELOAD_FLAG (daemon may not reload until restart)"
    fi
    return 0
}

# =============================================================================
# Connection quality: thresholds (settings/quality_thresholds.sh)
# =============================================================================

# mv_check_preset <field> <value>: rc 0 when a known preset; else prints the reject reason.
mv_check_preset() {
    case "$2" in
        standard|tolerant|very-tolerant|custom) return 0 ;;
    esac
    echo "$1 must be one of: standard tolerant very-tolerant custom"
    return 1
}

# mv_quality_check_wait <val>: alert_after_min, a whole number of minutes 1-1440. Prints the reason on failure.
mv_quality_check_wait() {
    case "$1" in
        *[!0-9]*) echo "alert_after_min must be a whole number of minutes between 1 and 1440"; return 1 ;;
    esac
    if [ "$1" -lt 1 ] || [ "$1" -gt 1440 ]; then
        echo "alert_after_min must be between 1 and 1440"
        return 1
    fi
    return 0
}

# mv_quality_custom_ok <latency|loss> <val>: the custom preset's integer (latency 1-10000 ms, loss 1-100 %).
mv_quality_custom_ok() {
    local v="$2"
    case "$v" in ''|*[!0-9]*) v="" ;; esac
    if [ "$1" = "latency" ]; then
        if [ -z "$v" ] || [ "${#v}" -gt 5 ] || [ "$v" -lt 1 ] || [ "$v" -gt 10000 ]; then
            return 1
        fi
    else
        if [ -z "$v" ] || [ "${#v}" -gt 3 ] || [ "$v" -lt 1 ] || [ "$v" -gt 100 ]; then
            return 1
        fi
    fi
    return 0
}

# mv_quality_save <wait> <lat_preset> <lat_custom> <loss_preset> <loss_custom>: merge only the non-empty
# keys into quality_thresholds.json (a named preset keeps a stored custom number), then poke the poller and
# watchdog reload flags. rc 1 on write failure.
mv_quality_save() {
    local new_wait="$1" new_lat="$2" new_lat_custom="$3" new_loss="$4" new_loss_custom="$5" filter
    filter='.'
    if [ "$new_lat" = "custom" ]; then
        filter="$filter | .latency = ((if (.latency | type) == \"object\" then .latency else {} end) + {preset: \$lat, custom_ms: \$lat_custom})"
    elif [ -n "$new_lat" ]; then
        filter="$filter | .latency = ((if (.latency | type) == \"object\" then .latency else {} end) + {preset: \$lat})"
    fi
    if [ "$new_loss" = "custom" ]; then
        filter="$filter | .loss = ((if (.loss | type) == \"object\" then .loss else {} end) + {preset: \$loss, custom_pct: \$loss_custom})"
    elif [ -n "$new_loss" ]; then
        filter="$filter | .loss = ((if (.loss | type) == \"object\" then .loss else {} end) + {preset: \$loss})"
    fi
    [ -n "$new_wait" ] && filter="$filter | .alert_after_min = \$wait"

    if ! cq_quality_merge "$filter" --arg lat "$new_lat" --arg loss "$new_loss" --argjson wait "${new_wait:-null}" \
        --argjson lat_custom "${new_lat_custom:-null}" --argjson loss_custom "${new_loss_custom:-null}"; then
        return 1
    fi

    qlog_info "Quality thresholds saved: latency=${new_lat:--} loss=${new_loss:--} alert_after_min=${new_wait:--}"

    # Poke the poller reload (failure non-fatal; old config remains active).
    if ! touch "$QUALITY_RELOAD_FLAG" 2>/dev/null; then
        qlog_warn "Failed to touch reload flag at $QUALITY_RELOAD_FLAG (poller may not reload until restart)"
    fi
    # The poller consumes its own flag; the watchdog's quality trigger needs its own poke.
    touch /tmp/qmanager_watchcat_reload 2>/dev/null || qlog_warn "Failed to touch the watchdog reload flag"
    return 0
}

# =============================================================================
# Sites monitor (monitoring/sites.sh)
# =============================================================================

# Conservative hostname / IPv4 check, no regex (device jq has none).
mv_valid_host() {
    local h="$1"
    [ "${#h}" -ge 3 ] && [ "${#h}" -le 253 ] || return 1
    case "$h" in
        *[!A-Za-z0-9.-]*|-*|.*|*.|*-|*..*|*.-*|*-.*) return 1 ;;
        *.*) return 0 ;;
    esac
    return 1
}

# mv_sites_norm_enabled <json>: "true", "false" or "invalid".
mv_sites_norm_enabled() {
    printf '%s' "$1" | jq -r '.enabled | if type == "boolean" then tostring else "invalid" end' 2>/dev/null
}

# mv_sites_norm_interval <json>: interval_sec clamped to 60-3600, or "invalid".
mv_sites_norm_interval() {
    printf '%s' "$1" | jq -r '.interval_sec
        | if type == "number" then (floor | if . < 60 then 60 elif . > 3600 then 3600 else . end | tostring)
          else "invalid" end' 2>/dev/null
}

# Prints the effective config as compact JSON (defaults when absent/unreadable).
mv_sites_read_config() {
    local defaults cfg
    defaults=$(jq -cn --arg s "$MV_SITES_DEFAULT" '$s | split(" ") | map({host: ., label: .})')
    cfg=""
    if [ -f "$MV_SITES_CONF" ]; then
        cfg=$(jq -c --argjson d "$defaults" '
            {enabled: (if .enabled == false then false else true end),
             interval_sec: (.interval_sec | if type == "number"
                 then (floor | if . < 60 then 60 elif . > 3600 then 3600 else . end)
                 else 300 end),
             sites: (if has("sites") and (.sites | type == "array")
                 then [.sites[:32][] | select(type == "object" and (.host | type) == "string")
                       | {host: (.host | ascii_downcase),
                          label: (if (.label | type) == "string" and (.label | length) > 0
                                  then .label else .host end)}]
                 else $d end)}' "$MV_SITES_CONF" 2>/dev/null)
    fi
    if [ -z "$cfg" ]; then
        cfg=$(jq -cn --argjson d "$defaults" '{enabled: true, interval_sec: 300, sites: $d}')
    fi
    printf '%s' "$cfg"
}

# mv_sites_build <enabled> <interval> <json>: the normalised config (labels cleaned, hosts de-duplicated)
# from a validated enabled/interval and a JSON object whose .sites entries all carry a valid host. rc 1 on failure.
mv_sites_build() {
    printf '%s' "$3" | jq -c --argjson en "$1" --argjson iv "$2" '
        {enabled: $en, interval_sec: $iv,
         sites: ([.sites[] | (.host | ascii_downcase) as $h
                  | {host: $h,
                     label: (((.label | if type == "string" then . else "" end)
                              | explode | map(select(. >= 32 and . != 127)) | implode | .[:40])
                             | if . == "" then $h else . end)}]
                 | reduce .[] as $s ([]; if any(.[]; .host == $s.host) then . else . + [$s] end))}'
}

# mv_sites_write <config-json> <enabled>: atomic write, then nudge the daemon (sweep when enabled, drop the
# live lease when disabled). rc 1 on failure.
mv_sites_write() {
    local new="$1" enabled="$2" tmp
    tmp=$(mktemp "${MV_SITES_CONF}.XXXXXX" 2>/dev/null) || {
        qlog_error "mktemp in $(dirname "$MV_SITES_CONF") failed"
        return 1
    }
    if printf '%s\n' "$new" > "$tmp" && chmod 0644 "$tmp" && mv -f "$tmp" "$MV_SITES_CONF"; then
        [ "$enabled" = "true" ] && : > "$MV_SITES_TMP/qmanager_sites_now" 2>/dev/null
        # Disabling drops the live lease so the daemon stops live ticks at once.
        [ "$enabled" = "false" ] && rm -f "$MV_SITES_TMP/qmanager_sites_live" 2>/dev/null
        return 0
    fi
    rm -f "$tmp"
    return 1
}

# =============================================================================
# Alerts (monitoring/alerts.sh)
# =============================================================================

# mv_check_wait_minutes <label> <val>: 1-1440 minutes, no leading zero. Prints the reason on failure.
mv_check_wait_minutes() {
    local label="$1" val="$2"
    case "$val" in
        ''|0*|?????*|*[!0-9]*)
            echo "${label} must be a number between 1 and 1440"
            return 1
            ;;
    esac
    if [ "$val" -lt 1 ] || [ "$val" -gt 1440 ]; then
        echo "${label} must be between 1 and 1440"
        return 1
    fi
    return 0
}

# mv_check_phone <phone>: the SMS recipient an enabled channel needs. Prints the reason on failure.
mv_check_phone() {
    local _phone_check _plen
    case "$1" in
        '')
            echo "sms.recipient_phone is required when SMS alerts are enabled"
            return 1
            ;;
    esac
    _phone_check="${1#+}"
    case "$_phone_check" in
        ''|*[!0-9]*)
            echo "Phone must contain only digits (with optional leading +)"
            return 1
            ;;
    esac
    _plen=${#_phone_check}
    if [ "$_plen" -lt 7 ] || [ "$_plen" -gt 15 ]; then
        echo "Phone must be 7-15 digits"
        return 1
    fi
    case "$_phone_check" in
        0*)
            echo "Phone must start with a country code (not 0)"
            return 1
            ;;
    esac
    return 0
}

# mv_email_addr_ok <addr>: no control characters and an address-shaped string.
mv_email_addr_ok() {
    case "$1" in *[[:cntrl:]]*) return 1 ;; esac
    printf '%s' "$1" | grep -qE '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
}

# mv_check_email_fields <sender> <recipient> <new-password-or-empty>: prints the reason on failure.
# The control-character gate runs first: a newline would inject msmtp directives.
mv_check_email_fields() {
    if [ -z "$1" ] || [ -z "$2" ]; then
        echo "email.sender_email and email.recipient_email are required when email alerts are enabled"
        return 1
    fi
    case "${1}${2}${3}" in
        *[[:cntrl:]]*)
            echo "email fields must not contain control characters"
            return 1
            ;;
    esac
    if ! mv_email_addr_ok "$1"; then
        echo "email.sender_email is not a valid email address"
        return 1
    fi
    if ! mv_email_addr_ok "$2"; then
        echo "email.recipient_email is not a valid email address"
        return 1
    fi
    return 0
}

# mv_check_discord_owner <id>: a numeric snowflake, 15-25 digits. Prints the reason on failure.
mv_check_discord_owner() {
    local _dlen
    case "$1" in
        ''|*[!0-9]*)
            echo "discord.owner_discord_id must be a numeric Discord user ID"
            return 1
            ;;
    esac
    _dlen=${#1}
    if [ "$_dlen" -lt 15 ] || [ "$_dlen" -gt 25 ]; then
        echo "discord.owner_discord_id does not look like a Discord snowflake ID"
        return 1
    fi
    return 0
}

# mv_alert_email_pw_set: "true"/"false", the non-secret marker the root helper keeps in email_alerts.json.
mv_alert_email_pw_set() {
    local v="false"
    if [ -f "$CQ_EMAIL_CONFIG" ]; then
        v=$(jq -r '(.app_password_set) | if . == true then "true" else "false" end' "$CQ_EMAIL_CONFIG" 2>/dev/null)
    fi
    case "$v" in true) ;; *) v="false" ;; esac
    printf '%s' "$v"
}

# mv_alert_discord_prev: the stored Discord state into MV_DP_TOKEN (token_set), MV_DP_EN, MV_DP_OWNER.
mv_alert_discord_prev() {
    local _dprev _dp_tok _dp_en _dp_owner
    MV_DP_TOKEN="false"; MV_DP_EN="false"; MV_DP_OWNER=""
    if [ -f "$CQ_DISCORD_CONFIG" ]; then
        _dprev=$(jq -r '[(.token_set == true), ((.enabled | tostring) == "true"), (.owner_discord_id // "" | tostring)] | map(tostring) | join(" ")' "$CQ_DISCORD_CONFIG" 2>/dev/null)
        read -r _dp_tok _dp_en _dp_owner <<EOF
$_dprev
EOF
        [ "$_dp_tok" = "true" ] && MV_DP_TOKEN="true"
        [ "$_dp_en" = "true" ] && MV_DP_EN="true"
        MV_DP_OWNER="$_dp_owner"
    fi
}

# mv_alert_routing_final <events-json|"">: merge over the defaults, then hard-clamp connection_lost
# (email and discord are always false, server-authoritative like alert_engine.sh's capability table).
mv_alert_routing_final() {
    local _routing_usr="null" _final
    if [ -n "$1" ] && [ "$1" != "null" ]; then
        _routing_usr="$1"
    fi
    _final=$(jq -n --argjson def "$MV_ROUTING_DEFAULT" --argjson usr "$_routing_usr" '
        ($def * ($usr // {}))
        | .connection_lost.email = false
        | .connection_lost.discord = false
    ' 2>/dev/null)
    if [ -z "$_final" ]; then
        _final="$MV_ROUTING_DEFAULT"
    fi
    printf '%s' "$_final"
}

# mv_alert_write_wait <minutes>: the single alert wait, merged into quality_thresholds.json. rc 1 on failure.
mv_alert_write_wait() {
    mkdir -p /etc/qmanager
    cq_quality_merge '.alert_after_min = $wait' --argjson wait "$1"
}

# The four config writers are atomic (.tmp then mv): rc 1 = JSON build failed (CGI write_failed), rc 2 = mv failed.
# mv_alert_write_sms <enabled> <phone> <wait>
mv_alert_write_sms() {
    if ! jq -n \
        --argjson enabled "$1" \
        --arg recipient_phone "$2" \
        --argjson threshold_minutes "$3" \
        '{enabled:$enabled, recipient_phone:$recipient_phone, threshold_minutes:$threshold_minutes}' \
        > "${CQ_SMS_CONFIG}.tmp"; then
        rm -f "${CQ_SMS_CONFIG}.tmp"
        return 1
    fi
    mv "${CQ_SMS_CONFIG}.tmp" "$CQ_SMS_CONFIG" || return 2
}

# mv_alert_write_email <enabled> <sender> <recipient> <app_password_set> <wait>: the JSON goes down before
# the root helper runs (it reads sender_email here and owns the marker).
mv_alert_write_email() {
    if ! jq -n \
        --argjson enabled "$1" \
        --arg sender_email "$2" \
        --arg recipient_email "$3" \
        --argjson app_password_set "$4" \
        --argjson threshold_minutes "$5" \
        '{enabled:$enabled, sender_email:$sender_email, recipient_email:$recipient_email, app_password_set:$app_password_set, threshold_minutes:$threshold_minutes}' \
        > "${CQ_EMAIL_CONFIG}.tmp"; then
        rm -f "${CQ_EMAIL_CONFIG}.tmp"
        return 1
    fi
    mv "${CQ_EMAIL_CONFIG}.tmp" "$CQ_EMAIL_CONFIG" || return 2
}

# mv_alert_write_discord <enabled> <owner> <wait> <token_set>
mv_alert_write_discord() {
    if ! jq -n \
        --argjson enabled "$1" \
        --arg owner_discord_id "$2" \
        --argjson threshold_minutes "$3" \
        --argjson token_set "$4" \
        '{enabled:$enabled, owner_discord_id:$owner_discord_id, threshold_minutes:$threshold_minutes, token_set:$token_set}' \
        > "${CQ_DISCORD_CONFIG}.tmp"; then
        rm -f "${CQ_DISCORD_CONFIG}.tmp"
        return 1
    fi
    mv "${CQ_DISCORD_CONFIG}.tmp" "$CQ_DISCORD_CONFIG" || return 2
}

# mv_alert_write_routing <routing_final-json>: wrapped under version+events.
mv_alert_write_routing() {
    if ! jq -n --argjson events "$1" '{version:1, events:$events}' \
        > "${MV_ROUTING_CONFIG}.tmp" 2>/dev/null; then
        rm -f "${MV_ROUTING_CONFIG}.tmp"
        return 1
    fi
    mv "${MV_ROUTING_CONFIG}.tmp" "$MV_ROUTING_CONFIG" || return 2
}

# mv_alert_discord_service <enabled> <prev_enabled> <owner> <prev_owner> <token_new:0|1>: drive the Discord daemon.
# It caches token/owner/dmChannel at startup, so it restarts when one changed or it was just enabled.
# Failures land in MV_DISCORD_SVC_ERR / MV_DISCORD_RESTART_ERR (config is already saved).
mv_alert_discord_service() {
    MV_DISCORD_SVC_ERR=""
    MV_DISCORD_RESTART_ERR=""
    if [ "$1" = "true" ]; then
        if ! svc_enable qmanager_discord; then
            MV_DISCORD_SVC_ERR="Discord alert settings were saved, but the discord service could not be enabled on boot (rootfs may be read-only)"
            qlog_warn "svc_enable qmanager_discord failed"
        fi
        if [ "$2" != "true" ] \
            || [ "$3" != "$4" ] \
            || [ "$5" = "1" ] \
            || ! svc_is_running qmanager_discord; then
            svc_reset_failed qmanager_discord
            if ! svc_restart qmanager_discord; then
                MV_DISCORD_RESTART_ERR="Discord alert settings were saved, but the Discord service could not be restarted"
                qlog_warn "svc_restart qmanager_discord failed"
            fi
        fi
    else
        svc_stop qmanager_discord
        svc_disable qmanager_discord || qlog_warn "svc_disable qmanager_discord failed"
    fi
}

# mv_alert_touch_reload: signal alert_engine.sh (and the channel libs) to reload.
mv_alert_touch_reload() {
    touch "$MV_SMS_RELOAD" "$MV_EMAIL_RELOAD" "$MV_DISCORD_RELOAD" "$MV_ROUTING_RELOAD" "$QUALITY_RELOAD_FLAG" 2>/dev/null
}
