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
# HTTP Headers
# Emit full JSON + CORS headers followed by the required blank line.
# Call once, before writing any response body.
# ---------------------------------------------------------------------------
cgi_headers() {
    echo "Content-Type: application/json"
    echo "Cache-Control: no-cache, no-store, must-revalidate"
    echo "Access-Control-Allow-Origin: *"
    echo "Access-Control-Allow-Methods: GET, POST, OPTIONS"
    echo "Access-Control-Allow-Headers: Content-Type"
    echo ""
}

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
    echo '{"success":false,"error":"method_not_allowed","detail":"Use GET or POST"}'
    exit 0
}

# ---------------------------------------------------------------------------
# JSON Response Helpers
# ---------------------------------------------------------------------------

# Emit {"success":true}
cgi_success() {
    echo '{"success":true}'
}

# cgi_error <error_code> <detail_message>
# Values must not contain double-quotes or newlines (safe for all current uses).
cgi_error() {
    printf '{"success":false,"error":"%s","detail":"%s"}\n' "$1" "${2:-}"
}

# ---------------------------------------------------------------------------
# Reboot After Response
# Emit success JSON, then schedule an async reboot so the HTTP response
# flushes to the client before the device goes down.
# ---------------------------------------------------------------------------
cgi_reboot_response() {
    echo '{"success":true}'
    ( ( sleep 1 && reboot ) </dev/null >/dev/null 2>&1 & )
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
