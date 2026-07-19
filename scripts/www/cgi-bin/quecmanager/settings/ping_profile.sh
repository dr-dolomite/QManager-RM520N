#!/bin/sh
# =============================================================================
# ping_profile.sh — CGI Endpoint: Connectivity Sensitivity Profile (GET + POST)
# =============================================================================
# GET:  Returns current ping profile selection.
# POST: Saves profile selection (one of sensitive/regular/relaxed/quiet) and
#       the probe targets, merging them into /etc/qmanager/ping_profile.json,
#       then pokes the daemon's reload flag at /tmp/qmanager_ping_reload.
#
# The daemon's for_profile() map is the single source of truth for the actual
# threshold values — this CGI writes only the profile name (+ targets), not
# the thresholds.
#
# --- Split-ownership (probe targets vs. fail cadence) -----------------------
# This endpoint owns ONLY `profile` (label) + `target_1` + `target_2` in
# ping_profile.json. monitoring/watchdog.sh is the SOLE writer of
# `interval_sec` (the Watchdog owns the probe cadence + fail threshold as of
# the split-ownership rework — see docs/reference/connection-watchdog.md).
# Every write here is therefore an ATOMIC KEY-MERGE (read existing JSON, set
# only profile/target_1/target_2, temp-file + mv) — NEVER a whole-file
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
    target_1="http://cp.cloudflare.com/"
    target_2="http://www.gstatic.com/generate_204"

    if [ -f "$CONFIG" ]; then
        v=$(jq -r '.profile // empty' "$CONFIG" 2>/dev/null) || v=""
        case "$v" in
            sensitive|regular|relaxed|quiet) profile="$v" ;;
            *) qlog_warn "ping_profile.json had unexpected profile value '$v', returning default" ;;
        esac

        t1=$(jq -r '.target_1 // empty' "$CONFIG" 2>/dev/null) || t1=""
        t2=$(jq -r '.target_2 // empty' "$CONFIG" 2>/dev/null) || t2=""
        [ -n "$t1" ] && target_1="$t1"
        [ -n "$t2" ] && target_2="$t2"
    fi

    jq -n \
        --arg profile "$profile" \
        --arg target_1 "$target_1" \
        --arg target_2 "$target_2" \
        '{success: true, settings: {profile: $profile, target_1: $target_1, target_2: $target_2}}'
    exit 0
fi

# Validate a target URL string. Echoes the trimmed input on success, prints
# error and returns 1 on failure. Used by both target_1 and target_2.
validate_target_url() {
    local label="$1"
    local raw="$2"

    # Strip leading/trailing whitespace
    local trimmed
    trimmed=$(printf '%s' "$raw" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

    if [ -z "$trimmed" ]; then
        echo "${label} cannot be empty"
        return 1
    fi

    # Length cap
    if [ ${#trimmed} -gt 256 ]; then
        echo "${label} exceeds 256 characters"
        return 1
    fi

    # Reject control chars + shell metacharacters not in URL-safe set
    case "$trimmed" in
        *[\`\;\|\<\>\"\\]*)
            echo "${label} contains disallowed characters"
            return 1
            ;;
    esac

    # Reject dollar-paren injection patterns specifically
    case "$trimmed" in
        *\$\(*)
            echo "${label} contains disallowed characters"
            return 1
            ;;
    esac

    # Allow only URL-safe charset (RFC 3986 reserved + unreserved + percent + IDN-friendly)
    if printf '%s' "$trimmed" | LC_ALL=C grep -qE '[^A-Za-z0-9._:/?#@!$%&'"'"'()*+,;=~-]'; then
        echo "${label} contains invalid characters"
        return 1
    fi

    printf '%s' "$trimmed"
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

    new_profile=$(printf '%s' "$POST_DATA" | jq -r '.profile // empty' 2>/dev/null)
    case "$new_profile" in
        sensitive|regular|relaxed|quiet) ;;
        *)
            cgi_error "invalid_profile" "profile must be one of: sensitive, regular, relaxed, quiet"
            exit 0
            ;;
    esac

    new_t1_raw=$(printf '%s' "$POST_DATA" | jq -r '.target_1 // empty' 2>/dev/null)
    new_t2_raw=$(printf '%s' "$POST_DATA" | jq -r '.target_2 // empty' 2>/dev/null)

    # Both targets are required on every save (kept idempotent + simple).
    if ! new_t1=$(validate_target_url "target_1" "$new_t1_raw"); then
        cgi_error "invalid_target" "$new_t1"
        exit 0
    fi
    if ! new_t2=$(validate_target_url "target_2" "$new_t2_raw"); then
        cgi_error "invalid_target" "$new_t2"
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
        --arg target_1 "$new_t1" \
        --arg target_2 "$new_t2" \
        '.profile = $profile | .target_1 = $target_1 | .target_2 = $target_2' \
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

    qlog_info "Ping profile saved: profile=$new_profile target_1=$new_t1 target_2=$new_t2"

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
