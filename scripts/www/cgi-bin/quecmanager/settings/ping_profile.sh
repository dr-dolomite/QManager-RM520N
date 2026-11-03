#!/bin/sh
# =============================================================================
# ping_profile.sh — CGI Endpoint: Connectivity Sensitivity Profile (GET + POST)
# =============================================================================
# GET:  Returns the current ping profile selection + the FOUR ICMP probe slots.
# POST: Saves the four probe slots plus an OPTIONAL profile label (one of
#       sensitive/regular/relaxed/quiet; preserved from the file when omitted)
#       and an OPTIONAL interval_sec (1-60), merging them into
#       /etc/qmanager/ping_profile.json, then pokes the daemon's reload flag at
#       /tmp/qmanager_ping_reload. A stored interval_sec (the cadence the Watchdog
#       page owns) survives a profile change and shadows the profile's cadence.
#
# --- The four slots, and why they validate differently -----------------------
# The probe chain walks four legs in a fixed order and short-circuits on the
# first success:
#
#   target_host_1  target_host_2  target_ip_1  target_ip_2
#
# A host_ slot takes a HOSTNAME. The resolver, not a config key, decides the
# address family, so there is no v4/v6 slot distinction any more.
#
# An ip_ slot takes an IPv4 LITERAL. Those two legs exist precisely so the
# verdict survives a broken resolver — a hostname there would fail for the same
# reason the two hostname legs already did, and the device would report an
# outage it does not have. That is why a hostname in an ip_ slot is rejected
# rather than quietly accepted.
#
# Targets are ICMP hosts (NOT HTTP URLs) — no scheme is prepended.
#
# --- Ownership ---------------------------------------------------------------
# Connection Quality owns all of ping_profile.json; writes are atomic key-merges.
# GET reports the effective cadence (override, else the profile table).
#
# Endpoint: GET/POST /cgi-bin/quecmanager/settings/ping_profile.sh
# Install location: /www/cgi-bin/quecmanager/settings/ping_profile.sh
# =============================================================================

# Allow tests / dev override of the lib dir, falling back to the real one
LIB_DIR="${QM_LIB_DIR:-/usr/lib/qmanager}"
. "$LIB_DIR/cgi_base.sh"
. "$LIB_DIR/conn_state.sh"
. "$LIB_DIR/monitoring_validate.sh"

qlog_init "cgi_ping_profile"
cgi_headers
cgi_handle_options

CONFIG="${PING_PROFILE_CONFIG:-/etc/qmanager/ping_profile.json}"

DEFAULT_HOST_1="cloudflare.com"
DEFAULT_HOST_2="google.com"
DEFAULT_IP_1="1.1.1.1"
DEFAULT_IP_2="8.8.8.8"

# =============================================================================
# GET — Fetch current profile
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching ping profile selection"

    profile="relaxed"
    host_1="$DEFAULT_HOST_1"
    host_2="$DEFAULT_HOST_2"
    ip_1="$DEFAULT_IP_1"
    ip_2="$DEFAULT_IP_2"

    if [ -f "$CONFIG" ]; then
        v=$(jq -r '.profile // empty' "$CONFIG" 2>/dev/null) || v=""
        case "$v" in
            sensitive|regular|relaxed|quiet) profile="$v" ;;
            *) qlog_warn "ping_profile.json had unexpected profile value '$v', returning default" ;;
        esac

        # Each slot is defaulted INDEPENDENTLY, so a device that has not yet
        # run the installer's migration still reads back a complete, correct
        # chain rather than a half-empty form.
        h1=$(jq -r '.target_host_1 // empty' "$CONFIG" 2>/dev/null) || h1=""
        h2=$(jq -r '.target_host_2 // empty' "$CONFIG" 2>/dev/null) || h2=""
        i1=$(jq -r '.target_ip_1 // empty' "$CONFIG" 2>/dev/null) || i1=""
        i2=$(jq -r '.target_ip_2 // empty' "$CONFIG" 2>/dev/null) || i2=""
        [ -n "$h1" ] && host_1="$h1"
        [ -n "$h2" ] && host_2="$h2"
        [ -n "$i1" ] && ip_1="$i1"
        [ -n "$i2" ] && ip_2="$i2"
    fi

    # Effective cadence, same resolution as the daemon (override, else profile table).
    conn_state_cadence "$CONFIG"

    # The stored override (the Watchdog's cadence), or null when the profile's own applies.
    # Same rule as qmanager_ping and conn_state_cadence: digits only (a numeric or "4"-style string), at least 1.
    interval_override=$(jq -r '(try .interval_sec catch null) | if type == "number" or type == "string" then tostring else "" end' "$CONFIG" 2>/dev/null </dev/null) || interval_override=""
    case "$interval_override" in
        ''|*[!0-9]*|0*) interval_override=null ;;
    esac
    [ "${#interval_override}" -le 5 ] || interval_override=null

    jq -n \
        --arg profile "$profile" \
        --argjson interval_sec "$CQ_CFG_INTERVAL_SEC" \
        --argjson interval_override "$interval_override" \
        --argjson fail_secs "$CQ_CFG_FAIL_SECS" \
        --argjson recover_secs "$CQ_CFG_RECOVER_SECS" \
        --arg target_host_1 "$host_1" \
        --arg target_host_2 "$host_2" \
        --arg target_ip_1 "$ip_1" \
        --arg target_ip_2 "$ip_2" \
        '{success: true, settings: {
            profile: $profile,
            interval_sec: $interval_sec,
            interval_override: $interval_override,
            fail_secs: $fail_secs,
            recover_secs: $recover_secs,
            target_host_1: $target_host_1,
            target_host_2: $target_host_2,
            target_ip_1: $target_ip_1,
            target_ip_2: $target_ip_2
        }}'
    exit 0
fi

# validate_target is mv_validate_target in monitoring_validate.sh (shared with the config restore).

# =============================================================================
# POST — Save profile selection
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty' 2>/dev/null)
    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # clear_interval: drop the stored interval_sec (the Watchdog's cadence) so the profile's own applies.
    if [ "$ACTION" = "clear_interval" ]; then
        if ! mv_ping_clear_interval; then
            cgi_error "write_failed" "Failed to clear the stored interval"
            exit 0
        fi
        conn_state_cadence "$CONFIG"
        jq -n --argjson interval_sec "$CQ_CFG_INTERVAL_SEC" '{success: true, interval_sec: $interval_sec}'
        exit 0
    fi

    if [ "$ACTION" != "save_settings" ]; then
        cgi_error "unknown_action" "Unknown action: $ACTION"
        exit 0
    fi

    # `profile` is OPTIONAL as of the split-ownership rework: the Probe Targets
    # card is targets-only and no longer POSTs a profile. When absent, preserve
    # the existing label already in the config (defaulting to "relaxed" if the
    # file is missing or holds an unexpected value) so a targets-only save is
    # never rejected. When a profile IS sent, it must still be one of the four
    # valid presets.
    new_profile=$(printf '%s' "$POST_DATA" | jq -r '.profile // empty' 2>/dev/null)
    if [ -z "$new_profile" ]; then
        new_profile=$(jq -r '.profile // "relaxed"' "$CONFIG" 2>/dev/null)
        mv_ping_profile_ok "$new_profile" || new_profile="relaxed"
    else
        if ! mv_ping_profile_ok "$new_profile"; then
            cgi_error "invalid_profile" "profile must be one of: sensitive, regular, relaxed, quiet"
            exit 0
        fi
    fi

    # Optional interval_sec override: a JSON integer 1-60 when the key is present.
    new_interval=$(printf '%s' "$POST_DATA" | jq -r \
        'if has("interval_sec") then (.interval_sec | if type == "number" and . == floor then tostring else "invalid" end) else empty end' 2>/dev/null)
    if ! mv_ping_interval_ok "$new_interval"; then
        cgi_error "invalid_interval" "interval_sec must be an integer between 1 and 60"
        exit 0
    fi

    new_h1_raw=$(printf '%s' "$POST_DATA" | jq -r '.target_host_1 // empty' 2>/dev/null)
    new_h2_raw=$(printf '%s' "$POST_DATA" | jq -r '.target_host_2 // empty' 2>/dev/null)
    new_i1_raw=$(printf '%s' "$POST_DATA" | jq -r '.target_ip_1 // empty' 2>/dev/null)
    new_i2_raw=$(printf '%s' "$POST_DATA" | jq -r '.target_ip_2 // empty' 2>/dev/null)

    # All four slots are required on every save (kept idempotent + simple).
    if ! new_h1=$(mv_validate_target "target_host_1" "$new_h1_raw" "host"); then
        cgi_error "invalid_target" "$new_h1"
        exit 0
    fi
    if ! new_h2=$(mv_validate_target "target_host_2" "$new_h2_raw" "host"); then
        cgi_error "invalid_target" "$new_h2"
        exit 0
    fi
    if ! new_i1=$(mv_validate_target "target_ip_1" "$new_i1_raw" "ipv4_literal"); then
        cgi_error "invalid_target" "$new_i1"
        exit 0
    fi
    if ! new_i2=$(mv_validate_target "target_ip_2" "$new_i2_raw" "ipv4_literal"); then
        cgi_error "invalid_target" "$new_i2"
        exit 0
    fi

    # Atomic key-merge: label + targets are set; a stored interval_sec (the Watchdog's cadence)
    # survives a profile change and is replaced only when interval_sec is posted.
    mv_ping_save "$new_profile" "$new_interval" "$new_h1" "$new_h2" "$new_i1" "$new_i2"
    case $? in
        1) cgi_error "write_failed" "Failed to generate config JSON"; exit 0 ;;
        2) cgi_error "write_failed" "Failed to write config file"; exit 0 ;;
    esac

    cgi_success
    exit 0
fi

# =============================================================================
# Unsupported method
# =============================================================================
cgi_error "method_not_allowed" "Only GET and POST are supported"
