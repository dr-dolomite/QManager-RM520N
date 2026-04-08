#!/bin/sh
# ssh_password.sh — SSH (root) password change endpoint.
# POST {"current_password":"...","new_password":"...","confirm_password":"..."}
# Requires valid session (normal auth via cgi_base.sh).
# Verifies current web UI password before allowing SSH password change.
# Does NOT destroy session — changing SSH password doesn't affect web login.
. /usr/lib/qmanager/cgi_base.sh

qlog_init "cgi_auth_ssh_password"

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
_confirm=$(printf '%s' "$POST_DATA" | jq -r '.confirm_password // empty')

if [ -z "$_current" ] || [ -z "$_new" ]; then
    cgi_headers
    cgi_error "missing_fields" "current_password and new_password are required"
    exit 0
fi

# Validate new password length
_pw_len=$(printf '%s' "$_new" | wc -c)
if [ "$_pw_len" -lt 6 ]; then
    cgi_headers
    cgi_error "password_too_short" "SSH password must be at least 6 characters"
    exit 0
fi

# Validate confirmation matches
if [ -n "$_confirm" ] && [ "$_new" != "$_confirm" ]; then
    cgi_headers
    cgi_error "password_mismatch" "Passwords do not match"
    exit 0
fi

# Verify current web UI password (security gate)
if ! qm_verify_password "$_current"; then
    cgi_headers
    cgi_error "invalid_password" "Current password is incorrect"
    exit 0
fi

# Set SSH root password
if ! qm_set_ssh_password "$_new"; then
    cgi_headers
    cgi_error "ssh_password_failed" "Failed to update SSH password"
    exit 0
fi

qlog_info "SSH root password changed via settings"
cgi_headers
cgi_success
