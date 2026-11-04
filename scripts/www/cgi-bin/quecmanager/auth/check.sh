#!/bin/sh
# check.sh — Auth status check (used by login page for setup detection).
_SKIP_AUTH=1
. /usr/lib/qmanager/cgi_base.sh

qlog_init "cgi_auth_check"
cgi_headers

# Bodies are printf, not jq -n: fixed shapes on a per-page-load endpoint, and
# the layout below is byte-for-byte what jq pretty-prints (2-space, LF).
if is_setup_required; then
    printf '{\n  "authenticated": false,\n  "setup_required": true\n}\n'
    exit 0
fi

qm_cookie_var "$COOKIE_SESSION" _token
if [ -n "$_token" ] && qm_validate_session "$_token"; then
    printf '{\n  "authenticated": true\n}\n'
    exit 0
fi

# Additive disclosure: an anonymous caller may learn the device is currently
# rate-limited (used by app/page.tsx and use-auth.ts to avoid showing an
# enabled login button that would just 429). qm_get_rate_limit_status is the
# READ-ONLY half of the limiter — it never extends or resets a lockout, so a
# page refresh during a lockout cannot itself prolong it.
qm_get_rate_limit_status
_rl_locked=$?

if [ "$_rl_locked" -eq 1 ]; then
    _rate_limited="true"
else
    _rate_limited="false"
fi

printf '{\n  "authenticated": false,\n  "rate_limited": %s,\n  "retry_after": %d,\n  "attempts_remaining": %d\n}\n' \
    "$_rate_limited" "$RATE_LIMIT_RETRY_AFTER" "$RATE_LIMIT_ATTEMPTS_REMAINING"
