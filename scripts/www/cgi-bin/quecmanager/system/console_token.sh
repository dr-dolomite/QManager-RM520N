#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# console_token.sh — CGI Endpoint: Web Console credential (GET only)
# =============================================================================
# Hands a logged-in browser the per-start ttyd credential written by
# console/ttyd_start.sh. The token is ttyd's only gate, so this fails closed.
#
# Endpoint: GET /cgi-bin/quecmanager/system/console_token.sh
# =============================================================================

qlog_init "cgi_console_token"

# cgi_base.sh's no-op fallback would let this through if cgi_auth.sh were broken.
if ! command -v qm_validate_session >/dev/null 2>&1; then
    echo "Status: 500 Internal Server Error"
    cgi_headers
    cgi_error "auth_unavailable" "Authentication is unavailable"
    exit 0
fi

cgi_headers
cgi_handle_options

TOKEN_FILE="/tmp/qmanager_console.token"

if [ "$REQUEST_METHOD" = "GET" ]; then
    token=""
    [ -r "$TOKEN_FILE" ] && IFS= read -r token < "$TOKEN_FILE"
    if [ -z "$token" ]; then
        cgi_error "console_unavailable" "Web console is not running"
        exit 0
    fi
    jq -n --arg token "$token" '{success: true, token: $token}'
    exit 0
fi

cgi_method_not_allowed
