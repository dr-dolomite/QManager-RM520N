#!/bin/sh
# =============================================================================
# ping_profile.sh — CGI Endpoint: Connectivity Sensitivity Profile (GET + POST)
# =============================================================================
# GET:  Returns the current ping profile selection + the FOUR ICMP probe slots.
# POST: Saves the four probe slots plus an OPTIONAL profile label (one of
#       sensitive/regular/relaxed/quiet; preserved from the file when omitted),
#       merging them into /etc/qmanager/ping_profile.json, then pokes the
#       daemon's reload flag at /tmp/qmanager_ping_reload.
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
# --- Split-ownership (probe targets vs. fail cadence) -----------------------
# This endpoint owns ONLY `profile` (label) + the four target slots in
# ping_profile.json. monitoring/watchdog.sh is the SOLE writer of
# `interval_sec` (the Watchdog owns the probe cadence + fail threshold as of
# the split-ownership rework — see docs/reference/connection-watchdog.md).
# Every write here is therefore an ATOMIC KEY-MERGE (read existing JSON, set
# only the owned keys, temp-file + mv) — NEVER a whole-file overwrite, or it
# would silently clobber the interval_sec the Watchdog wrote. The daemon's own
# debounce windows (fail_secs / recover_secs / history_secs) pass through
# untouched on every save for the same reason; `profile` is effectively a label
# paired with the targets, and the daemon's profile table remains the source of
# truth for the threshold values themselves.
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

    jq -n \
        --arg profile "$profile" \
        --arg target_host_1 "$host_1" \
        --arg target_host_2 "$host_2" \
        --arg target_ip_1 "$ip_1" \
        --arg target_ip_2 "$ip_2" \
        '{success: true, settings: {
            profile: $profile,
            target_host_1: $target_host_1,
            target_host_2: $target_host_2,
            target_ip_1: $target_ip_1,
            target_ip_2: $target_ip_2
        }}'
    exit 0
fi

# Validate an ICMP probe slot server-side. Two families:
#
#   host          a hostname: charset [0-9A-Za-z.-], plus label sanity (no
#                 leading/trailing hyphen or dot on the name or on any label,
#                 no empty label).
#   ipv4_literal  a dotted quad: charset [0-9.], exactly four octets, each
#                 1-3 digits and <= 255.
#
# Common rules for both: trimmed, non-empty, length <= 128, no interior
# whitespace, free of shell/HTML metacharacters. No scheme is prepended.
# Echoes the trimmed value on success; prints an error naming the slot and
# returns 1 on failure.
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

    case "$family" in
        host)
            case "$host" in
                *[!0-9A-Za-z.-]*)
                    echo "${label} is not a valid hostname"
                    return 1
                    ;;
            esac
            # Label sanity. A leading or trailing hyphen, a hyphen adjacent to
            # a dot, an empty label (".."), or a leading/trailing dot are all
            # names no resolver will ever answer for.
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
    # valid presets.
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

    new_h1_raw=$(printf '%s' "$POST_DATA" | jq -r '.target_host_1 // empty' 2>/dev/null)
    new_h2_raw=$(printf '%s' "$POST_DATA" | jq -r '.target_host_2 // empty' 2>/dev/null)
    new_i1_raw=$(printf '%s' "$POST_DATA" | jq -r '.target_ip_1 // empty' 2>/dev/null)
    new_i2_raw=$(printf '%s' "$POST_DATA" | jq -r '.target_ip_2 // empty' 2>/dev/null)

    # All four slots are required on every save (kept idempotent + simple).
    if ! new_h1=$(validate_target "target_host_1" "$new_h1_raw" "host"); then
        cgi_error "invalid_target" "$new_h1"
        exit 0
    fi
    if ! new_h2=$(validate_target "target_host_2" "$new_h2_raw" "host"); then
        cgi_error "invalid_target" "$new_h2"
        exit 0
    fi
    if ! new_i1=$(validate_target "target_ip_1" "$new_i1_raw" "ipv4_literal"); then
        cgi_error "invalid_target" "$new_i1"
        exit 0
    fi
    if ! new_i2=$(validate_target "target_ip_2" "$new_i2_raw" "ipv4_literal"); then
        cgi_error "invalid_target" "$new_i2"
        exit 0
    fi

    mkdir -p "$(dirname "$CONFIG")"

    # Atomic key-merge: read the existing file (if any) and set only our own
    # keys, leaving interval_sec (Watchdog-owned) and the daemon's debounce
    # fields (fail_secs / recover_secs / history_secs) untouched. See the
    # file-header note on split ownership.
    existing_json='{}'
    if [ -f "$CONFIG" ]; then
        existing_json=$(cat "$CONFIG" 2>/dev/null)
        # Only reuse the file when it parses AND is an object. The merge below
        # indexes it, so malformed / empty / whitespace / null / scalar / array
        # content aborts jq and fails EVERY future save — while GET keeps
        # serving its own fallback defaults, so the UI looks healthy and the
        # device is quietly unsavable with no way out from the web console.
        # `jq -e .` is the wrong predicate here: it tests output TRUTHINESS,
        # so it passes `5`/`[1,2]` (still unmergeable) and rejects `null`.
        # `type == "object"` is exactly the question the merge is asking.
        if ! printf '%s' "$existing_json" | jq -e 'type == "object"' >/dev/null 2>&1; then
            qlog_warn "Unusable $CONFIG (not a JSON object) — rebuilding from defaults"
            existing_json='{}'
        fi
    fi

    if ! printf '%s' "$existing_json" | jq \
        --arg profile "$new_profile" \
        --arg host_1 "$new_h1" \
        --arg host_2 "$new_h2" \
        --arg ip_1 "$new_i1" \
        --arg ip_2 "$new_i2" \
        '.profile = $profile
         | .target_host_1 = $host_1
         | .target_host_2 = $host_2
         | .target_ip_1 = $ip_1
         | .target_ip_2 = $ip_2' \
        > "${CONFIG}.tmp" 2>/dev/null || [ ! -s "${CONFIG}.tmp" ]; then
        # -s guards the promote: never `mv` a zero-byte temp over a live
        # config. jq can exit 0 having written nothing if the redirect itself
        # failed (a full /etc UBIFS is the realistic case on this device).
        rm -f "${CONFIG}.tmp"
        cgi_error "write_failed" "Failed to generate config JSON"
        exit 0
    fi

    if ! mv "${CONFIG}.tmp" "$CONFIG"; then
        rm -f "${CONFIG}.tmp"
        cgi_error "write_failed" "Failed to write config file"
        exit 0
    fi

    qlog_info "Ping profile saved: profile=$new_profile chain=$new_h1,$new_h2,$new_i1,$new_i2"

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
