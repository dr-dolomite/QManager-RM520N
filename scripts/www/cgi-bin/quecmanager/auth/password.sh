#!/bin/sh
# password.sh — Password change endpoint.
# POST {"current_password":"...","new_password":"...","enforce_strong":true|false}
#      {"current_password":"...","verify_only":true}  (check, change nothing)
# Requires valid session (normal auth via cgi_base.sh).
# Destroys current session after change — user must re-login. verify_only
# leaves the session and the password alone.
. /usr/lib/qmanager/cgi_base.sh

qlog_init "cgi_auth_password"

if [ "$REQUEST_METHOD" = "OPTIONS" ]; then
    cgi_headers
    exit 0
fi

if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_headers
    cgi_method_not_allowed
fi

cgi_read_post

_current=$(printf '%s' "$POST_DATA" | jq -r '.current_password // empty')
_new=$(printf '%s' "$POST_DATA" | jq -r '.new_password // empty')
_enforce_strong=$(printf '%s' "$POST_DATA" | jq -r 'if .enforce_strong == false then "false" else "true" end')
_verify_only=$(printf '%s' "$POST_DATA" | jq -r 'if .verify_only == true then "true" else "false" end')

if [ "$_verify_only" = "true" ]; then
    _new=""
    if [ -z "$_current" ]; then
        cgi_headers
        cgi_error "missing_fields" "current_password is required"
        exit 0
    fi
elif [ -z "$_current" ] || [ -z "$_new" ]; then
    cgi_headers
    cgi_error "missing_fields" "Both current_password and new_password are required"
    exit 0
fi

# Min length 6 always; enforce_strong (absent = true) adds upper + lower + digit.
if [ "$_verify_only" != "true" ]; then
    _pw_len=$(printf '%s' "$_new" | wc -c)
    if [ "$_pw_len" -lt 6 ]; then
        cgi_headers
        cgi_error "password_weak" "New password must be at least 6 characters"
        exit 0
    fi
    if [ "$_enforce_strong" != "false" ] && ! qm_password_is_strong "$_new"; then
        cgi_headers
        cgi_error "password_weak" "New password must include uppercase, lowercase, and a number"
        exit 0
    fi
fi

# The current-password check shares the login rate limit (no free oracle).
if ! qm_check_rate_limit; then
    echo "Status: 429 Too Many Requests"
    cgi_headers
    jq -n --argjson retry "${RATE_LIMIT_RETRY_AFTER:-0}" \
        --argjson remaining "${RATE_LIMIT_ATTEMPTS_REMAINING:-0}" \
        '{"success":false,"error":"rate_limited","detail":"Too many failed attempts","retry_after":$retry,"attempts_remaining":$remaining}'
    exit 0
fi

if ! qm_verify_password "$_current"; then
    qm_record_failed_attempt
    qm_get_rate_limit_status
    qlog_warn "Password change refused: wrong current password"
    cgi_headers
    jq -n --argjson remaining "${RATE_LIMIT_ATTEMPTS_REMAINING:-0}" \
        '{"success":false,"error":"invalid_password","detail":"Current password is incorrect","attempts_remaining":$remaining}'
    exit 0
fi
qm_clear_attempts

if [ "$_verify_only" = "true" ]; then
    cgi_headers
    cgi_success
    exit 0
fi

if ! qm_save_password "$_new"; then
    qlog_error "Password change failed: could not write auth.json"
    cgi_headers
    cgi_error "save_failed" "Could not save the new password"
    exit 0
fi
qlog_info "Password changed successfully"

# Destroy current session and clear cookies
_token=$(qm_get_cookie "$COOKIE_SESSION")
[ -n "$_token" ] && qm_destroy_session "$_token"

qm_clear_session_cookies
cgi_headers
cgi_success
