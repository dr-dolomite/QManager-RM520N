#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# fetch_ping_history.sh — CGI Endpoint for Ping History Chart Data
# =============================================================================
# Serves the ping history NDJSON file as a JSON array.
# Zero modem contact — reads from RAM only.
#
# The ping history file is NDJSON (one JSON object per line). This script
# converts it to a proper JSON array for the frontend.
#
# Each line format:
#   {"ts":1707900000,"lat":34.2,"avg":38.1,"min":12.3,"max":95.7,"loss":0,"jit":4.8}
#
# Endpoint: GET /cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh[?last=N]
# Response: application/json
# last=N (digits only, else ignored) returns just the newest N rows.
#
# Install location: /www/cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh
# =============================================================================

PING_HISTORY_FILE="/tmp/qmanager_ping_history.json"

qlog_init "cgi_fetch_ping_history"
cgi_headers
cgi_handle_options

# last=N from QUERY_STRING, builtins only (no fork); absent or non-numeric = whole file.
_last=""
_qs="${QUERY_STRING:-}"
while [ -n "$_qs" ]; do
    _kv="${_qs%%&*}"
    case "$_qs" in *\&*) _qs="${_qs#*&}" ;; *) _qs="" ;; esac
    case "$_kv" in
        last=*)
            _v="${_kv#last=}"
            case "$_v" in ''|*[!0-9]*) ;; *) _last="$_v" ;; esac
            break
            ;;
    esac
done

serve_ndjson_as_array "$PING_HISTORY_FILE" "$_last"
