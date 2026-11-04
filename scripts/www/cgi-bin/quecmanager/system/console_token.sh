#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# console_token.sh — CGI Endpoint: Web Console token (GET only)
# =============================================================================
# Issues a single-use, 30-second token that console/console.sh requires before
# it starts the root shell. It is the console's only gate, so this fails closed.
#
# Endpoint: GET /cgi-bin/quecmanager/system/console_token.sh
# =============================================================================

qlog_init "cgi_console_token"

# Re-check the session here too: this token is the console's only gate.
qm_cookie_var "${COOKIE_SESSION:-qm_session}" _qm_tok
if [ -z "$_qm_tok" ] || ! qm_validate_session "$_qm_tok"; then
    echo "Status: 401 Unauthorized"
    cgi_headers
    cgi_error "unauthorized" "Invalid or expired session"
    exit 0
fi

cgi_headers
cgi_handle_options

TOKEN_DIR="/tmp/qmanager_console_tokens"
TOKEN_MAX_AGE=30

if [ "$REQUEST_METHOD" = "GET" ]; then
    umask 077
    mkdir -p "$TOKEN_DIR" 2>/dev/null
    # console.sh trusts only a www-data 0700 dir; refuse one another account planted.
    # Numeric uid: on RG501Q-EU /etc/passwd is 0600, so %U reads UNKNOWN as www-data.
    if [ -L "$TOKEN_DIR" ] || [ "$(stat -c '%u %a' "$TOKEN_DIR" 2>/dev/null)" != "$(id -u) 700" ]; then
        cgi_error "token_failed" "Could not start a console session"
        exit 0
    fi
    now=$(date +%s)
    for f in "$TOKEN_DIR"/*; do
        [ -f "$f" ] || continue
        IFS= read -r issued < "$f"
        case "$issued" in ""|*[!0-9]*) rm -f "$f"; continue ;; esac
        [ $((now - issued)) -gt "$TOKEN_MAX_AGE" ] && rm -f "$f"
    done
    token=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
    if [ ${#token} -ne 64 ] || ! printf '%s\n' "$now" > "$TOKEN_DIR/$token"; then
        cgi_error "token_failed" "Could not start a console session"
        exit 0
    fi
    jq -n --arg token "$token" '{success: true, token: $token}'
    exit 0
fi

cgi_method_not_allowed
