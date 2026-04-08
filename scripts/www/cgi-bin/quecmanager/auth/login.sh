#!/bin/sh
# login.sh — Login and first-time password setup endpoint.
# POST {"password":"..."} for login
# POST {"password":"...","confirm":"..."} for first-time setup
#
# On success, sets HttpOnly session cookie + indicator cookie.
_SKIP_AUTH=1
. /usr/lib/qmanager/cgi_base.sh

qlog_init "cgi_auth_login"

# CORS preflight
if [ "$REQUEST_METHOD" = "OPTIONS" ]; then
    cgi_headers
    exit 0
fi

if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_headers
    cgi_method_not_allowed
fi

# Read POST body inline (to defer headers for 429 status)
if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    POST_DATA=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null)
else
    cgi_headers
    cgi_error "no_body" "POST body is empty"
    exit 0
fi

_password=$(printf '%s' "$POST_DATA" | jq -r '.password // empty')
_confirm=$(printf '%s' "$POST_DATA" | jq -r '.confirm // empty')

if [ -z "$_password" ]; then
    cgi_headers
    cgi_error "missing_password" "Password is required"
    exit 0
fi

# ---------------------------------------------------------------------------
# First-time setup mode
# ---------------------------------------------------------------------------
if is_setup_required; then
    if [ -z "$_confirm" ]; then
        cgi_headers
        jq -n '{"success":false,"error":"setup_required","setup_required":true}'
        exit 0
    fi

    _pw_len=$(printf '%s' "$_password" | wc -c)
    if [ "$_pw_len" -lt 6 ]; then
        cgi_headers
        cgi_error "password_too_short" "Password must be at least 6 characters"
        exit 0
    fi

    if [ "$_password" != "$_confirm" ]; then
        cgi_headers
        cgi_error "password_mismatch" "Passwords do not match"
        exit 0
    fi

    qm_save_password "$_password"

    # Also set SSH root password (best-effort — non-fatal if it fails)
    qm_set_ssh_password "$_password" 2>/dev/null || qlog_warn "SSH password sync skipped"

    qlog_info "First-time password configured"

    _token=$(qm_create_session)
    qm_set_session_cookies "$_token"
    cgi_headers
    jq -n '{"success":true}'
    exit 0
fi

# ---------------------------------------------------------------------------
# Normal login
# ---------------------------------------------------------------------------
if ! qm_check_rate_limit; then
    echo "Status: 429 Too Many Requests"
    cgi_headers
    jq -n --argjson retry "$RATE_LIMIT_RETRY_AFTER" \
        '{"success":false,"error":"rate_limited","detail":"Too many failed attempts","retry_after":$retry}'
    exit 0
fi

if ! qm_verify_password "$_password"; then
    qm_record_failed_attempt
    qlog_warn "Failed login attempt"
    cgi_headers
    cgi_error "invalid_password" "Invalid password"
    exit 0
fi

# Success
qm_clear_attempts
qm_cleanup_sessions
_token=$(qm_create_session)
qlog_info "Successful login"

qm_set_session_cookies "$_token"
cgi_headers
jq -n '{"success":true}'
