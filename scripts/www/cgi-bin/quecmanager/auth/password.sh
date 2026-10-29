#!/bin/sh
# password.sh — Password change endpoint.
# POST {"current_password":"...","new_password":"..."}
# Requires valid session (normal auth via cgi_base.sh).
# Destroys current session after change — user must re-login.
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

if [ -z "$_current" ] || [ -z "$_new" ]; then
    cgi_headers
    cgi_error "missing_fields" "Both current_password and new_password are required"
    exit 0
fi

_pw_len=$(printf '%s' "$_new" | wc -c)
if [ "$_pw_len" -lt 6 ]; then
    cgi_headers
    cgi_error "password_too_short" "New password must be at least 6 characters"
    exit 0
fi

if ! qm_verify_password "$_current"; then
    cgi_headers
    cgi_error "invalid_password" "Current password is incorrect"
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
