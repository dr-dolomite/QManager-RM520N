#!/bin/sh
# =============================================================================
# ping_profile.sh — CGI Endpoint: Connectivity Sensitivity Profile (GET + POST)
# =============================================================================
# GET:  Returns current ping profile selection + IPv4/IPv6 ICMP probe targets.
# POST: Saves the probe targets (target_ipv4/target_ipv6) plus an OPTIONAL
#       profile label (one of sensitive/regular/relaxed/quiet; preserved from
#       the file when omitted), merging them into
#       /etc/qmanager/ping_profile.json, then pokes the daemon's reload flag
#       at /tmp/qmanager_ping_reload.
#
# The daemon's for_profile() map is the single source of truth for the actual
# threshold values — this CGI writes only the profile name (+ targets), not
# the thresholds.
#
# Targets are ICMP hosts (NOT HTTP URLs) — no scheme is prepended. Both GET
# and POST use the snake_case keys target_ipv4 / target_ipv6.
#
# --- Split-ownership (probe targets vs. fail cadence) -----------------------
# This endpoint owns ONLY `profile` (label) + `target_ipv4` + `target_ipv6` in
# ping_profile.json. monitoring/watchdog.sh is the SOLE writer of
# `interval_sec` (the Watchdog owns the probe cadence + fail threshold as of
# the split-ownership rework — see docs/reference/connection-watchdog.md).
# Every write here is therefore an ATOMIC KEY-MERGE (read existing JSON, set
# only profile/target_ipv4/target_ipv6, temp-file + mv) — NEVER a whole-file
# overwrite, or it would silently clobber the interval_sec the Watchdog wrote.
# One side effect: changing `profile` here no longer resets the daemon's
# internal fail_secs/recover_secs/intercept_secs/history_secs debounce
# windows (previously reset via the old whole-file overwrite's field-absence
# trick) — those keys, once present, now pass through unchanged on every
# save. `profile` is effectively a label paired with the targets.
#
# Endpoint: GET/POST /cgi-bin/quecmanager/settings/ping_profile.sh
# Install location: /www/cgi-bin/quecmanager/settings/ping_profile.sh
# =============================================================================

# Allow tests / dev override of the lib dir, falling back to the real one
LIB_DIR="${QM_LIB_DIR:-/usr/lib/qmanager}"
. "$LIB_DIR/cgi_base.sh"

qlog_init "cgi_ping_profile"
cgi_headers
cgi_handle_options

CONFIG="${PING_PROFILE_CONFIG:-/etc/qmanager/ping_profile.json}"
RELOAD_FLAG="${PING_PROFILE_RELOAD_FLAG:-/tmp/qmanager_ping_reload}"

# =============================================================================
# GET — Fetch current profile
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching ping profile selection"

    profile="relaxed"
    target_ipv4="1.1.1.1"
    target_ipv6="2606:4700:4700::1111"

    if [ -f "$CONFIG" ]; then
        v=$(jq -r '.profile // empty' "$CONFIG" 2>/dev/null) || v=""
        case "$v" in
            sensitive|regular|relaxed|quiet) profile="$v" ;;
            *) qlog_warn "ping_profile.json had unexpected profile value '$v', returning default" ;;
        esac

        t4=$(jq -r '.target_ipv4 // empty' "$CONFIG" 2>/dev/null) || t4=""
        t6=$(jq -r '.target_ipv6 // empty' "$CONFIG" 2>/dev/null) || t6=""
        [ -n "$t4" ] && target_ipv4="$t4"
        [ -n "$t6" ] && target_ipv6="$t6"
    fi

    jq -n \
        --arg profile "$profile" \
        --arg target_ipv4 "$target_ipv4" \
        --arg target_ipv6 "$target_ipv6" \
        '{success: true, settings: {profile: $profile, target_ipv4: $target_ipv4, target_ipv6: $target_ipv6}}'
    exit 0
fi

# Validate an ICMP probe host server-side (IPv4 literal / IPv6 literal /
# hostname). Common rules: trimmed, non-empty, length <= 128, no interior
# whitespace, free of shell/HTML metacharacters. The per-family charset is
# passed as $3:
#   ipv4 -> [0-9A-Za-z.-]   (IPv4 literal or hostname)
#   ipv6 -> [0-9A-Fa-f:.%]  (IPv6 literal incl. zone id)
# No scheme is prepended. Echoes the trimmed host on success, prints an
# error and returns 1 on failure. Used by both target_ipv4 and target_ipv6.
validate_target() {
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

    # Per-family charset whitelist. Reject any character outside the allowed set.
    case "$family" in
        ipv4)
            case "$host" in
                *[!0-9A-Za-z.-]*)
                    echo "${label} is not a valid IPv4 address or hostname"
                    return 1
                    ;;
            esac
            ;;
        ipv6)
            case "$host" in
                *[!0-9A-Fa-f:.%]*)
                    echo "${label} is not a valid IPv6 address"
                    return 1
                    ;;
            esac
            case "$host" in
                *:*) ;;
                *)
                    echo "${label} must be a valid IPv6 address (missing ':')"
                    return 1
                    ;;
            esac
            ;;
        *)
            echo "${label} has an unknown address family"
            return 1
            ;;
    esac

    printf '%s' "$host"
    return 0
}

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

    if [ "$ACTION" != "save_settings" ]; then
        cgi_error "unknown_action" "Unknown action: $ACTION"
        exit 0
    fi

    # `profile` is OPTIONAL as of the split-ownership rework: the Probe Targets
    # card is targets-only and no longer POSTs a profile. When absent, preserve
    # the existing label already in the config (defaulting to "relaxed" if the
    # file is missing or holds an unexpected value) so a targets-only save is
    # never rejected. When a profile IS sent, it must still be one of the four
    # valid presets. profile is just a label paired with the targets — the
    # daemon's for_profile() map remains the source of truth for thresholds.
    new_profile=$(printf '%s' "$POST_DATA" | jq -r '.profile // empty' 2>/dev/null)
    if [ -z "$new_profile" ]; then
        new_profile=$(jq -r '.profile // "relaxed"' "$CONFIG" 2>/dev/null)
        case "$new_profile" in
            sensitive|regular|relaxed|quiet) ;;
            *) new_profile="relaxed" ;;
        esac
    else
        case "$new_profile" in
            sensitive|regular|relaxed|quiet) ;;
            *)
                cgi_error "invalid_profile" "profile must be one of: sensitive, regular, relaxed, quiet"
                exit 0
                ;;
        esac
    fi

    new_t4_raw=$(printf '%s' "$POST_DATA" | jq -r '.target_ipv4 // empty' 2>/dev/null)
    new_t6_raw=$(printf '%s' "$POST_DATA" | jq -r '.target_ipv6 // empty' 2>/dev/null)

    # Both targets are required on every save (kept idempotent + simple).
    if ! new_t4=$(validate_target "target_ipv4" "$new_t4_raw" "ipv4"); then
        cgi_error "invalid_target" "$new_t4"
        exit 0
    fi
    if ! new_t6=$(validate_target "target_ipv6" "$new_t6_raw" "ipv6"); then
        cgi_error "invalid_target" "$new_t6"
        exit 0
    fi

    mkdir -p "$(dirname "$CONFIG")"

    # Atomic key-merge: read the existing file (if any) and set only our
    # three owned keys, leaving interval_sec (Watchdog-owned) and any daemon
    # debounce fields (fail_secs/recover_secs/intercept_secs/history_secs)
    # untouched. See the file-header note on split ownership.
    existing_json='{}'
    if [ -f "$CONFIG" ]; then
        existing_json=$(cat "$CONFIG" 2>/dev/null)
        [ -z "$existing_json" ] && existing_json='{}'
    fi

    if ! printf '%s' "$existing_json" | jq \
        --arg profile "$new_profile" \
        --arg target_ipv4 "$new_t4" \
        --arg target_ipv6 "$new_t6" \
        '.profile = $profile | .target_ipv4 = $target_ipv4 | .target_ipv6 = $target_ipv6' \
        > "${CONFIG}.tmp"; then
        rm -f "${CONFIG}.tmp"
        cgi_error "write_failed" "Failed to generate config JSON"
        exit 0
    fi

    if ! mv "${CONFIG}.tmp" "$CONFIG"; then
        rm -f "${CONFIG}.tmp"
        cgi_error "write_failed" "Failed to write config file"
        exit 0
    fi

    qlog_info "Ping profile saved: profile=$new_profile target_ipv4=$new_t4 target_ipv6=$new_t6"

    # Poke daemon to reload at the start of its next cycle.
    # Failure is non-fatal — daemon still has the old config; user can retry.
    if ! touch "$RELOAD_FLAG" 2>/dev/null; then
        qlog_warn "Failed to touch reload flag at $RELOAD_FLAG (daemon may not reload until restart)"
    fi

    cgi_success
    exit 0
fi

# =============================================================================
# Unsupported method
# =============================================================================
cgi_error "method_not_allowed" "Only GET and POST are supported"
