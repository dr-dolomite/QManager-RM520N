#!/bin/sh
# check.sh — Auth status check (used by login page for setup detection).
_SKIP_AUTH=1
. /usr/lib/qmanager/cgi_base.sh

qlog_init "cgi_auth_check"
cgi_headers

if is_setup_required; then
    jq -n '{"authenticated":false,"setup_required":true}'
    exit 0
fi

_token=$(qm_get_cookie "$COOKIE_SESSION")
if [ -n "$_token" ] && qm_validate_session "$_token"; then
    jq -n '{"authenticated":true}'
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

jq -n --argjson limited "$_rate_limited" \
    --argjson retry "$RATE_LIMIT_RETRY_AFTER" \
    --argjson remaining "$RATE_LIMIT_ATTEMPTS_REMAINING" \
    '{"authenticated":false,"rate_limited":$limited,"retry_after":$retry,"attempts_remaining":$remaining}'
