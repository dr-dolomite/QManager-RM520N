#!/bin/sh
# ssh_password.sh — SSH (root) password change endpoint.
# POST {"current_password":"...","new_password":"...","confirm_password":"...","enforce_strong":true|false}
#      {"current_password":"...","verify_only":true}  (check, change nothing)
# Requires valid session (normal auth via cgi_base.sh).
# current_password is the CURRENT ROOT password, checked by the root helper
# (www-data cannot read /etc/shadow) behind the shared login rate limit.
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
    cgi_error "missing_fields" "current_password and new_password are required"
    exit 0
fi

if [ "$_verify_only" != "true" ]; then
    # Same rule as auth/password.sh: min 6; enforce_strong (absent = true) adds upper + lower + digit.
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

    if [ -n "$_confirm" ] && [ "$_new" != "$_confirm" ]; then
        cgi_headers
        cgi_error "password_mismatch" "Passwords do not match"
        exit 0
    fi
fi

# The root-password check shares the login rate limit (no free oracle).
if ! qm_check_rate_limit; then
    echo "Status: 429 Too Many Requests"
    cgi_headers
    jq -n --argjson retry "${RATE_LIMIT_RETRY_AFTER:-0}" \
        --argjson remaining "${RATE_LIMIT_ATTEMPTS_REMAINING:-0}" \
        '{"success":false,"error":"rate_limited","detail":"Too many failed attempts","retry_after":$retry,"attempts_remaining":$remaining}'
    exit 0
fi

if ! qm_verify_ssh_password "$_current"; then
    case "$QM_SSH_VERIFY_ERR" in
        invalid_password)
            qm_record_failed_attempt
            qm_get_rate_limit_status
            qlog_warn "SSH password change refused: wrong current root password"
            cgi_headers
            jq -n --argjson remaining "${RATE_LIMIT_ATTEMPTS_REMAINING:-0}" \
                '{"success":false,"error":"invalid_password","detail":"Current password is incorrect","attempts_remaining":$remaining}'
            ;;
        no_password_set)
            cgi_headers
            cgi_error "no_password_set" "Root account has no password set or is locked"
            ;;
        hash_tool_missing)
            cgi_headers
            cgi_error "hash_tool_missing" "Password validation tool (openssl) is not installed"
            ;;
        root_hash_unsupported)
            cgi_headers
            cgi_error "root_hash_unsupported" "Root password hash format is not supported"
            ;;
        *)
            qlog_error "Root password check unavailable"
            cgi_headers
            cgi_error "verify_unavailable" "Could not verify the current password"
            ;;
    esac
    exit 0
fi
qm_clear_attempts

if [ "$_verify_only" = "true" ]; then
    cgi_headers
    cgi_success
    exit 0
fi

# Set SSH root password
if ! qm_set_ssh_password "$_new"; then
    cgi_headers
    cgi_error "passwd_failed" "Failed to update SSH password"
    exit 0
fi

qlog_info "SSH root password changed via settings"
cgi_headers
cgi_success
