#!/bin/sh
# cgi_auth.sh — Cookie-based authentication library for QManager CGI scripts.
# Sourced by cgi_base.sh. Provides require_auth() and password helpers.
#
# Storage:
#   /etc/qmanager/auth.json              — password hash + salt (persistent)
#   /tmp/qmanager_sessions/<token>        — one file per session (RAM, cleared on reboot)
#   /tmp/qmanager_auth_attempts.json      — rate limiting state (RAM)

[ -n "$_CGI_AUTH_LOADED" ] && return 0
_CGI_AUTH_LOADED=1

AUTH_CONFIG="/etc/qmanager/auth.json"
SESSIONS_DIR="/tmp/qmanager_sessions"
ATTEMPTS_FILE="/tmp/qmanager_auth_attempts.json"

SESSION_MAX_AGE=3600  # 1 hour

# Cookie names
COOKIE_SESSION="qm_session"
COOKIE_INDICATOR="qm_logged_in"

# Rate limiting
MAX_ATTEMPTS=5
LOCKOUT_WINDOW=300    # 5-minute window for counting attempts
LOCKOUT_DURATION=300  # 5-minute lockout after max attempts

# ---------------------------------------------------------------------------
# Setup check
# ---------------------------------------------------------------------------
is_setup_required() {
    [ ! -f "$AUTH_CONFIG" ] && return 0
    [ ! -s "$AUTH_CONFIG" ] && return 0
    return 1
}

# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

qm_generate_salt() {
    head -c 16 /dev/urandom | openssl dgst -sha256 -hex 2>/dev/null | awk '{print substr($NF,1,32)}'
}

qm_hash_password() {
    printf '%s' "${2}${1}" | openssl dgst -sha256 -hex 2>/dev/null | awk '{print $NF}'
}

# Timing-safe string comparison via awk
qm_timing_safe_compare() {
    _result=$(printf '%s\n%s' "$1" "$2" | awk '
        NR==1 { a=$0 }
        NR==2 {
            b=$0
            len = length(a)
            if (length(b) > len) len = length(b)
            diff = (length(a) != length(b))
            for (i=1; i<=len; i++)
                if (substr(a,i,1) != substr(b,i,1)) diff=1
            print diff
        }')
    [ "$_result" = "0" ]
}

qm_verify_password() {
    _input_password="$1"
    [ ! -f "$AUTH_CONFIG" ] && return 1

    _auth_fields=$(jq -r '[.salt // "", .hash // ""] | @tsv' "$AUTH_CONFIG" 2>/dev/null)
    _stored_salt=$(printf '%s' "$_auth_fields" | cut -f1)
    _stored_hash=$(printf '%s' "$_auth_fields" | cut -f2)

    [ -z "$_stored_salt" ] && return 1
    [ -z "$_stored_hash" ] && return 1

    _computed_hash=$(qm_hash_password "$_input_password" "$_stored_salt")
    qm_timing_safe_compare "$_computed_hash" "$_stored_hash"
}

qm_save_password() {
    _new_salt=$(qm_generate_salt)
    _new_hash=$(qm_hash_password "$1" "$_new_salt")

    jq -n --arg hash "$_new_hash" --arg salt "$_new_salt" \
        '{"hash":$hash,"salt":$salt,"version":1}' > "$AUTH_CONFIG"
    chmod 600 "$AUTH_CONFIG"
}

# ---------------------------------------------------------------------------
# Cookie helpers
# ---------------------------------------------------------------------------

# Extract a named cookie value from HTTP_COOKIE
# Usage: _cookie_val=$(qm_get_cookie "cookie_name")
qm_get_cookie() {
    _cookie_name="$1"
    # HTTP_COOKIE format: "name1=val1; name2=val2"
    printf '%s' "$HTTP_COOKIE" | awk -v name="$_cookie_name" '
    BEGIN { RS=";[ \t]*"; FS="=" }
    $1 == name { print $2; exit }
    '
}

# Emit Set-Cookie headers for both session and indicator cookies
# Usage: qm_set_session_cookies <token>
qm_set_session_cookies() {
    echo "Set-Cookie: ${COOKIE_SESSION}=${1}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}"
    echo "Set-Cookie: ${COOKIE_INDICATOR}=1; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}"
}

# Emit Set-Cookie headers that clear both cookies
qm_clear_session_cookies() {
    echo "Set-Cookie: ${COOKIE_SESSION}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
    echo "Set-Cookie: ${COOKIE_INDICATOR}=; SameSite=Strict; Path=/; Max-Age=0"
}

# ---------------------------------------------------------------------------
# Session management (directory-based, one file per session)
# ---------------------------------------------------------------------------

qm_generate_token() {
    head -c 32 /dev/urandom | openssl dgst -sha256 -hex 2>/dev/null | awk '{print $NF}'
}

# Validate token is safe for use as a filename (hex chars only)
_is_valid_token() {
    printf '%s' "$1" | grep -qE '^[0-9a-f]{64}$'
}

# Create a new session. Prints the token to stdout.
qm_create_session() {
    mkdir -p "$SESSIONS_DIR"
    _token=$(qm_generate_token)
    date +%s > "${SESSIONS_DIR}/${_token}"
    printf '%s' "$_token"
}

# Validate a session token: check file exists and not expired.
# Returns 0 if valid, 1 if invalid/expired.
qm_validate_session() {
    _check_token="$1"
    [ -z "$_check_token" ] && return 1
    _is_valid_token "$_check_token" || return 1

    _session_file="${SESSIONS_DIR}/${_check_token}"
    [ ! -f "$_session_file" ] && return 1

    _created=$(cat "$_session_file" 2>/dev/null)
    [ -z "$_created" ] && return 1

    _now=$(date +%s)
    _age=$(( _now - _created ))
    [ "$_age" -gt "$SESSION_MAX_AGE" ] && {
        rm -f "$_session_file"
        return 1
    }

    return 0
}

# Destroy a specific session
qm_destroy_session() {
    _token="$1"
    [ -z "$_token" ] && return
    _is_valid_token "$_token" || return
    rm -f "${SESSIONS_DIR}/${_token}"
}

# Clean up expired sessions (called on login)
qm_cleanup_sessions() {
    [ ! -d "$SESSIONS_DIR" ] && return
    _now=$(date +%s)
    for _f in "${SESSIONS_DIR}"/*; do
        [ ! -f "$_f" ] && continue
        _created=$(cat "$_f" 2>/dev/null)
        [ -z "$_created" ] && { rm -f "$_f"; continue; }
        _age=$(( _now - _created ))
        [ "$_age" -gt "$SESSION_MAX_AGE" ] && rm -f "$_f"
    done
}

# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

qm_check_rate_limit() {
    RATE_LIMIT_RETRY_AFTER=0

    [ ! -f "$ATTEMPTS_FILE" ] && return 0

    _now=$(date +%s)
    _locked_until=$(jq -r '.locked_until // 0' "$ATTEMPTS_FILE" 2>/dev/null)
    _first_attempt=$(jq -r '.first_attempt // 0' "$ATTEMPTS_FILE" 2>/dev/null)
    _count=$(jq -r '.count // 0' "$ATTEMPTS_FILE" 2>/dev/null)

    if [ "$_locked_until" -gt "$_now" ] 2>/dev/null; then
        RATE_LIMIT_RETRY_AFTER=$(( _locked_until - _now ))
        return 1
    fi

    _window_age=$(( _now - _first_attempt ))
    if [ "$_window_age" -gt "$LOCKOUT_WINDOW" ] 2>/dev/null; then
        rm -f "$ATTEMPTS_FILE"
        return 0
    fi

    if [ "$_count" -ge "$MAX_ATTEMPTS" ] 2>/dev/null; then
        _new_locked_until=$(( _now + LOCKOUT_DURATION ))
        jq -n --argjson count "$_count" --argjson first "$_first_attempt" \
            --argjson locked "$_new_locked_until" \
            '{"count":$count,"first_attempt":$first,"locked_until":$locked}' > "$ATTEMPTS_FILE"
        RATE_LIMIT_RETRY_AFTER=$LOCKOUT_DURATION
        return 1
    fi

    return 0
}

qm_record_failed_attempt() {
    _now=$(date +%s)

    if [ ! -f "$ATTEMPTS_FILE" ]; then
        jq -n --argjson now "$_now" \
            '{"count":1,"first_attempt":$now,"locked_until":0}' > "$ATTEMPTS_FILE"
        return
    fi

    _first_attempt=$(jq -r '.first_attempt // 0' "$ATTEMPTS_FILE" 2>/dev/null)
    _window_age=$(( _now - _first_attempt ))

    if [ "$_window_age" -gt "$LOCKOUT_WINDOW" ] 2>/dev/null; then
        jq -n --argjson now "$_now" \
            '{"count":1,"first_attempt":$now,"locked_until":0}' > "$ATTEMPTS_FILE"
    else
        jq '.count += 1' "$ATTEMPTS_FILE" > "${ATTEMPTS_FILE}.tmp" \
            && mv "${ATTEMPTS_FILE}.tmp" "$ATTEMPTS_FILE"
    fi
}

qm_clear_attempts() {
    rm -f "$ATTEMPTS_FILE"
}

# ---------------------------------------------------------------------------
# SSH (root) password management
# ---------------------------------------------------------------------------

# Set the system root password for SSH access.
# Pipes password to the privileged helper via sudo (password never in args).
# Returns 0 on success, 1 on failure.
qm_set_ssh_password() {
    _ssh_pw="$1"
    [ -z "$_ssh_pw" ] && return 1

    # Source platform.sh for $_SUDO if not already loaded
    if [ -z "$_PLATFORM_LOADED" ]; then
        . /usr/lib/qmanager/platform.sh
    fi

    _result=$(printf '%s\n' "$_ssh_pw" | $_SUDO /usr/bin/qmanager_set_ssh_password 2>/dev/null)
    _rc=$?

    if [ "$_rc" -eq 0 ]; then
        qlog_info "SSH root password updated"
        return 0
    else
        qlog_error "SSH password update failed: $_result"
        return 1
    fi
}

# ---------------------------------------------------------------------------
# Auth enforcement — called by cgi_base.sh on every request
# ---------------------------------------------------------------------------

# Main auth gate — rejects unauthenticated requests
require_auth() {
    # Setup mode
    if is_setup_required; then
        echo "Status: 401 Unauthorized"
        cgi_headers
        jq -n '{"success":false,"error":"setup_required","detail":"No password configured"}'
        exit 0
    fi

    # CORS preflight passes without auth
    [ "$REQUEST_METHOD" = "OPTIONS" ] && return 0

    # Read session token from cookie
    _token=$(qm_get_cookie "$COOKIE_SESSION")
    if [ -z "$_token" ] || ! qm_validate_session "$_token"; then
        echo "Status: 401 Unauthorized"
        cgi_headers
        jq -n '{"success":false,"error":"unauthorized","detail":"Invalid or expired session"}'
        exit 0
    fi
}
