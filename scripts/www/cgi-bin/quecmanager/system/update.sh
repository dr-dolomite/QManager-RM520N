#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# update.sh — CGI Endpoint: Software Update (GET + POST)
# =============================================================================
# GET:              Check for updates via GitHub Releases API
# GET action=status: Read update progress from status file
# POST action=install: Spawn qmanager_update to download and install
# POST action=rollback: Spawn qmanager_update to restore previous version
# POST action=save_prerelease: Toggle pre-release preference
#
# Config: UCI quecmanager.update.*
# State:  /tmp/qmanager_update.json, /tmp/qmanager_update.pid
#
# Endpoint: GET/POST /cgi-bin/quecmanager/system/update.sh
# =============================================================================

qlog_init "cgi_system_update"
cgi_headers
cgi_handle_options

# --- Configuration -----------------------------------------------------------

GITHUB_REPO="dr-dolomite/QManager"
DOWNLOAD_BRANCH="development-home"
VERSION_FILE="/etc/qmanager/VERSION"
UPDATES_DIR="/etc/qmanager/updates"
STATUS_FILE="/tmp/qmanager_update.json"
PID_FILE="/tmp/qmanager_update.pid"
UPDATER="/usr/bin/qmanager_update"

# --- Helpers -----------------------------------------------------------------

get_current_version() {
    if [ -f "$VERSION_FILE" ]; then
        tr -d '[:space:]' < "$VERSION_FILE"
    else
        echo "0.0.0"
    fi
}

uci_update_get() {
    local val
    val=$(uci -q get "quecmanager.update.$1" 2>/dev/null)
    if [ -z "$val" ]; then echo "$2"; else echo "$val"; fi
}

ensure_update_config() {
    uci -q get quecmanager.update >/dev/null 2>&1 && return
    uci set quecmanager.update=update
    uci set quecmanager.update.include_prerelease=1
    uci commit quecmanager
}

# Check if an update process is already running
check_lock() {
    if [ -f "$PID_FILE" ]; then
        local pid
        pid=$(cat "$PID_FILE" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            cgi_error "update_in_progress" "An update is already in progress"
            exit 0
        fi
        rm -f "$PID_FILE"
    fi
}

# Fetch URL to a file, capturing HTTP status. Returns body in $1, status in $2.
# Uses wget -S to capture headers for rate-limit detection.
http_api_fetch() {
    local url="$1" out_file="$2" header_file="$3" timeout="${4:-15}"
    if command -v wget >/dev/null 2>&1; then
        wget -qO "$out_file" -T "$timeout" -S "$url" 2>"$header_file"
    elif command -v curl >/dev/null 2>&1; then
        curl -sL --max-time "$timeout" -o "$out_file" -D "$header_file" "$url"
    elif command -v uclient-fetch >/dev/null 2>&1; then
        uclient-fetch -qO "$out_file" --timeout="$timeout" "$url" 2>"$header_file"
    else
        return 1
    fi
}

# Semver comparison. Exit codes: 0 = $1 newer, 1 = same, 2 = $1 older
semver_compare() {
    local a="$1" b="$2"
    a="${a#v}"; b="${b#v}"
    local a_ver="${a%%-*}" a_pre="" b_ver="${b%%-*}" b_pre=""
    case "$a" in *-*) a_pre="${a#*-}" ;; esac
    case "$b" in *-*) b_pre="${b#*-}" ;; esac

    local a1 a2 a3 b1 b2 b3
    IFS='.' read a1 a2 a3 <<EOF
$a_ver
EOF
    IFS='.' read b1 b2 b3 <<EOF
$b_ver
EOF
    a1=${a1:-0}; a2=${a2:-0}; a3=${a3:-0}
    b1=${b1:-0}; b2=${b2:-0}; b3=${b3:-0}

    [ "$a1" -gt "$b1" ] 2>/dev/null && return 0
    [ "$a1" -lt "$b1" ] 2>/dev/null && return 2
    [ "$a2" -gt "$b2" ] 2>/dev/null && return 0
    [ "$a2" -lt "$b2" ] 2>/dev/null && return 2
    [ "$a3" -gt "$b3" ] 2>/dev/null && return 0
    [ "$a3" -lt "$b3" ] 2>/dev/null && return 2

    # Equal major.minor.patch — no pre-release > any pre-release
    [ -z "$a_pre" ] && [ -n "$b_pre" ] && return 0
    [ -n "$a_pre" ] && [ -z "$b_pre" ] && return 2
    [ -z "$a_pre" ] && [ -z "$b_pre" ] && return 1

    # Both have pre-release — lexical comparison (POSIX: sort, no \> \< in [ ])
    if [ "$a_pre" != "$b_pre" ]; then
        _lesser=$(printf '%s\n%s\n' "$a_pre" "$b_pre" | sort | head -1)
        if [ "$_lesser" = "$a_pre" ]; then
            return 2  # a_pre is lexically lesser → a is older
        else
            return 0  # b_pre is lexically lesser → a is newer
        fi
    fi
    return 1
}

# =============================================================================
# GET — Check for updates / Read status
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    action=$(echo "$QUERY_STRING" | sed -n 's/.*action=\([^&]*\).*/\1/p')

    # --- Status polling ---
    if [ "$action" = "status" ]; then
        if [ -f "$STATUS_FILE" ]; then
            cat "$STATUS_FILE"
        else
            jq -n '{"status":"idle"}'
        fi
        exit 0
    fi

    # --- Update check ---
    qlog_info "Checking for updates"
    ensure_update_config

    current_version=$(get_current_version)
    include_prerelease=$(uci_update_get include_prerelease "1")

    # Rollback availability — previous version stored locally after each update
    rollback_available="false"
    rollback_version=""
    if [ -f "$UPDATES_DIR/previous_version" ]; then
        rollback_available="true"
        rollback_version=$(cat "$UPDATES_DIR/previous_version" 2>/dev/null)
    fi

    # Query GitHub Releases API with header capture for rate-limit detection
    api_url="https://api.github.com/repos/$GITHUB_REPO/releases"
    tmp_body="/tmp/qm_update_api_body.json"
    tmp_headers="/tmp/qm_update_api_headers.txt"
    rm -f "$tmp_body" "$tmp_headers"

    if ! http_api_fetch "$api_url" "$tmp_body" "$tmp_headers"; then
        rm -f "$tmp_body" "$tmp_headers"
        jq -n \
            --arg cv "$current_version" \
            --argjson prerelease "$include_prerelease" \
            --argjson rb "$rollback_available" \
            --arg rbv "$rollback_version" \
            '{
                success: true, current_version: $cv,
                latest_version: null, update_available: false,
                changelog: null, download_url: null, download_size: null,
                rollback_available: $rb, rollback_version: $rbv,
                include_prerelease: ($prerelease == 1),
                check_error: "Unable to check for updates. Check your internet connection."
            }'
        exit 0
    fi

    # Check for rate limiting (HTTP 403)
    if grep -qi "403 Forbidden\|HTTP/[0-9.]* 403" "$tmp_headers" 2>/dev/null; then
        # Try to parse reset time
        reset_ts=$(grep -i 'x-ratelimit-reset' "$tmp_headers" | sed 's/.*: *//;s/\r//' | head -1)
        wait_msg="Rate limit reached. Try again later."
        if [ -n "$reset_ts" ]; then
            now_ts=$(date +%s 2>/dev/null)
            if [ -n "$now_ts" ] && [ -n "$reset_ts" ] && [ "$reset_ts" -gt "$now_ts" ] 2>/dev/null; then
                wait_mins=$(( (reset_ts - now_ts + 59) / 60 ))
                wait_msg="Rate limit reached. Try again in ${wait_mins} minute(s)."
            fi
        fi
        rm -f "$tmp_body" "$tmp_headers"
        jq -n \
            --arg cv "$current_version" \
            --argjson prerelease "$include_prerelease" \
            --argjson rb "$rollback_available" \
            --arg rbv "$rollback_version" \
            --arg err "$wait_msg" \
            '{
                success: true, current_version: $cv,
                latest_version: null, update_available: false,
                changelog: null, download_url: null, download_size: null,
                rollback_available: $rb, rollback_version: $rbv,
                include_prerelease: ($prerelease == 1),
                check_error: $err
            }'
        exit 0
    fi

    api_response=$(cat "$tmp_body" 2>/dev/null)
    rm -f "$tmp_body" "$tmp_headers"

    # Filter by pre-release preference
    if [ "$include_prerelease" = "1" ]; then
        release_filter='.[0]'
    else
        release_filter='[ .[] | select(.prerelease == false) ] | .[0]'
    fi

    # Extract release info (version + changelog from API, download from raw branch)
    latest_tag=$(echo "$api_response" | jq -r "$release_filter | .tag_name // empty")
    changelog=$(echo "$api_response" | jq -r "$release_filter | .body // empty")

    # Download URL points to raw branch archive (release asset redirects fail on OpenWRT)
    download_url=""
    if [ -n "$latest_tag" ]; then
        download_url="https://github.com/${GITHUB_REPO}/raw/refs/heads/${DOWNLOAD_BRANCH}/qmanager-build/qmanager.tar.gz"
    fi
    download_size=""

    update_available="false"
    if [ -n "$latest_tag" ]; then
        semver_compare "$latest_tag" "$current_version"
        case $? in
            0) update_available="true" ;;
        esac
    fi

    jq -n \
        --arg cv "$current_version" \
        --arg lv "${latest_tag:-}" \
        --argjson ua "$update_available" \
        --arg cl "$changelog" \
        --arg dl "${download_url:-}" \
        --arg ds "$download_size" \
        --argjson rb "$rollback_available" \
        --arg rbv "$rollback_version" \
        --argjson prerelease "$include_prerelease" \
        '{
            success: true,
            current_version: $cv,
            latest_version: (if $lv == "" then null else $lv end),
            update_available: $ua,
            changelog: (if $cl == "" then null else $cl end),
            download_url: (if $dl == "" then null else $dl end),
            download_size: (if $ds == "" then null else $ds end),
            rollback_available: $rb,
            rollback_version: (if $rbv == "" then null else $rbv end),
            include_prerelease: ($prerelease == 1),
            check_error: null
        }'
    exit 0
fi

# =============================================================================
# POST — Install / Rollback / Save preferences
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')
    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # --- Save pre-release preference ---
    if [ "$ACTION" = "save_prerelease" ]; then
        ensure_update_config
        enabled=$(printf '%s' "$POST_DATA" | jq -r '.enabled // empty')
        case "$enabled" in
            true)  uci set quecmanager.update.include_prerelease=1 ;;
            false) uci set quecmanager.update.include_prerelease=0 ;;
            *) cgi_error "invalid_value" "enabled must be true or false"; exit 0 ;;
        esac
        uci commit quecmanager
        cgi_success
        exit 0
    fi

    # --- Install update ---
    if [ "$ACTION" = "install" ]; then
        check_lock

        download_url=$(printf '%s' "$POST_DATA" | jq -r '.download_url // empty')
        version=$(printf '%s' "$POST_DATA" | jq -r '.version // empty')
        download_size=$(printf '%s' "$POST_DATA" | jq -r '.download_size // empty')

        if [ -z "$download_url" ]; then
            cgi_error "missing_url" "download_url is required"; exit 0
        fi

        # Respond immediately, spawn background updater (double-fork)
        jq -n '{"success":true,"status":"starting"}'
        ( "$UPDATER" install "$download_url" "$version" "$download_size" </dev/null >>/tmp/qmanager_update.log 2>&1 & )
        exit 0
    fi

    # --- Rollback ---
    if [ "$ACTION" = "rollback" ]; then
        check_lock

        if [ ! -f "$UPDATES_DIR/previous_version" ]; then
            cgi_error "no_rollback" "No previous version available for rollback"
            exit 0
        fi

        rollback_version=$(cat "$UPDATES_DIR/previous_version" 2>/dev/null)
        rollback_url="https://github.com/${GITHUB_REPO}/raw/refs/heads/${DOWNLOAD_BRANCH}/qmanager-build/qmanager.tar.gz.old"
        jq -n --arg v "$rollback_version" '{"success":true,"status":"starting","version":$v}'
        ( "$UPDATER" rollback "$rollback_url" "$rollback_version" </dev/null >>/tmp/qmanager_update.log 2>&1 & )
        exit 0
    fi

    cgi_error "unknown_action" "Unknown action: $ACTION"
    exit 0
fi

cgi_method_not_allowed
