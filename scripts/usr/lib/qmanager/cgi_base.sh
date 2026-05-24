#!/bin/sh
# CGI base library — HTTP headers, POST parsing, JSON response helpers.
# Source this at the top of every CGI script instead of copy-pasting boilerplate.
#
# Usage:
#   . /usr/lib/qmanager/cgi_base.sh
#   qlog_init "cgi_myname"
#   cgi_headers
#   cgi_handle_options   # call only on scripts that accept POST

[ -n "$_CGI_BASE_LOADED" ] && return 0
_CGI_BASE_LOADED=1

# ---------------------------------------------------------------------------
# PATH — ensure Entware binaries (jq, sudo, etc.) are discoverable.
# lighttpd's CGI environment has a minimal PATH that excludes /opt/bin.
# ---------------------------------------------------------------------------
export PATH="/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin:$PATH"

# ---------------------------------------------------------------------------
# Logging — source qlog.sh with no-op fallbacks if library is missing
# ---------------------------------------------------------------------------
. /usr/lib/qmanager/qlog.sh 2>/dev/null || {
    qlog_init()  { :; }
    qlog_debug() { :; }
    qlog_info()  { :; }
    qlog_warn()  { :; }
    qlog_error() { :; }
}

# ---------------------------------------------------------------------------
# Platform helpers — sudo wrappers, service control, pid_alive
# ---------------------------------------------------------------------------
. /usr/lib/qmanager/platform.sh 2>/dev/null || {
    pid_alive() { [ -n "$1" ] && [ -d "/proc/$1" ]; }
}

# ---------------------------------------------------------------------------
# HTTP Headers
# Emit full JSON + CORS headers followed by the required blank line.
# Call once, before writing any response body.
# MUST be defined before auth enforcement (require_auth calls cgi_headers).
# ---------------------------------------------------------------------------
cgi_headers() {
    echo "Content-Type: application/json"
    echo "Cache-Control: no-cache, no-store, must-revalidate"
    echo "Access-Control-Allow-Origin: *"
    echo "Access-Control-Allow-Methods: GET, POST, OPTIONS"
    echo "Access-Control-Allow-Headers: Content-Type, Authorization"
    echo ""
}

# ---------------------------------------------------------------------------
# Authentication — source cgi_auth.sh with no-op fallbacks if missing
# ---------------------------------------------------------------------------
. /usr/lib/qmanager/cgi_auth.sh 2>/dev/null || {
    require_auth()          { :; }
    is_setup_required()     { return 1; }
    qm_get_cookie()         { :; }
    qm_set_session_cookies(){ :; }
    qm_clear_session_cookies(){ :; }
    qm_create_session()     { :; }
    qm_validate_session()   { return 1; }
    qm_destroy_session()    { :; }
    qm_cleanup_sessions()   { :; }
    qm_verify_password()    { return 1; }
    qm_save_password()      { :; }
    qm_check_rate_limit()   { return 0; }
    qm_record_failed_attempt() { :; }
    qm_clear_attempts()     { :; }
}

# Auto-enforce auth unless the calling script set _SKIP_AUTH=1
if [ "$_SKIP_AUTH" != "1" ]; then
    require_auth
fi

# ---------------------------------------------------------------------------
# CORS Preflight
# Call right after cgi_headers on scripts that accept POST.
# Exits 0 immediately for OPTIONS requests (browser pre-flight).
# ---------------------------------------------------------------------------
cgi_handle_options() {
    [ "$REQUEST_METHOD" = "OPTIONS" ] && exit 0
}

# ---------------------------------------------------------------------------
# POST Body Reader
# Reads stdin into POST_DATA using CONTENT_LENGTH.
# Exits with a JSON error response if the body is missing or empty.
# ---------------------------------------------------------------------------
cgi_read_post() {
    if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
        POST_DATA=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null)
    else
        cgi_error "no_body" "POST body is empty"
        exit 0
    fi
}

# ---------------------------------------------------------------------------
# Method Routing Fallback
# Call at the bottom of the method routing block.
# Returns 405 JSON and exits for any unsupported HTTP method.
# ---------------------------------------------------------------------------
cgi_method_not_allowed() {
    jq -n '{"success":false,"error":"method_not_allowed","detail":"Use GET or POST"}'
    exit 0
}

# ---------------------------------------------------------------------------
# JSON Response Helpers
# ---------------------------------------------------------------------------

# Emit {"success":true}
cgi_success() {
    jq -n '{"success":true}'
}

# cgi_error <error_code> <detail_message>
cgi_error() {
    jq -n --arg error "$1" --arg detail "${2:-}" \
        '{"success":false,"error":$error,"detail":$detail}'
}

# ---------------------------------------------------------------------------
# Reboot After Response
# Emit success JSON, then schedule an async reboot. The async block waits up
# to QM_REBOOT_ACK_TIMEOUT seconds for the static /reboot/ page to confirm it
# has loaded (touches /tmp/qmanager_reboot_ack via update.sh action=reboot_ack)
# so lighttpd doesn't die mid-serve. A closed tab or non-UI caller still
# reboots after the timeout — the wait is bounded and cannot hang.
# Tunable via env: QM_REBOOT_ACK_TIMEOUT, QM_REBOOT_POST_ACK_DELAY.
# ---------------------------------------------------------------------------
: "${QM_REBOOT_ACK_TIMEOUT:=20}"
: "${QM_REBOOT_POST_ACK_DELAY:=1}"

cgi_reboot_response() {
    echo '{"success":true}'
    _reboot_cmd="reboot"
    command -v run_reboot >/dev/null 2>&1 && _reboot_cmd="run_reboot"
    (
        rm -f /tmp/qmanager_reboot_ack 2>/dev/null
        i=0
        while [ "$i" -lt "$QM_REBOOT_ACK_TIMEOUT" ]; do
            if [ -f /tmp/qmanager_reboot_ack ]; then
                rm -f /tmp/qmanager_reboot_ack 2>/dev/null
                break
            fi
            sleep 1
            i=$((i + 1))
        done
        sleep "$QM_REBOOT_POST_ACK_DELAY"
        $_reboot_cmd
    ) </dev/null >/dev/null 2>&1 &
    exit 0
}

# ---------------------------------------------------------------------------
# NDJSON File Server
# Serve an NDJSON file (one JSON object per line) as a JSON array.
# Outputs "[]" if file doesn't exist or is empty.
#
# Usage:
#   serve_ndjson_as_array "/tmp/myfile.json"
# ---------------------------------------------------------------------------
serve_ndjson_as_array() {
    if [ -f "$1" ] && [ -s "$1" ]; then
        jq -s '.' "$1"
    else
        echo "[]"
    fi
}
