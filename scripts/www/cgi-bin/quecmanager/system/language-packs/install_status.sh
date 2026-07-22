#!/bin/sh
# =============================================================================
# install_status.sh — CGI Endpoint: Poll current install progress
# =============================================================================
# GET only. Returns the raw progress JSON written by the worker, or an idle
# document if no install has ever run (or its progress file was cleaned up).
#
# Response (200, no-store): {"state":"pending|downloading|verifying|
#   extracting|validating|installing|done|cancelled|failed","code":"..",
#   "progress":0-100,"step":"..","message":"..","updated_at":<epoch>}
#   or when idle: {"state":"idle","code":"","progress":0,"step":"","
#   message":"","updated_at":0}
#
# Endpoint: GET /cgi-bin/quecmanager/system/language-packs/install_status.sh
# =============================================================================

. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/language_packs.sh

cgi_headers
cgi_handle_options

if [ "$REQUEST_METHOD" != "GET" ]; then
    cgi_method_not_allowed
fi

if [ -f "$LP_PROGRESS_FILE" ] && jq -e '.' "$LP_PROGRESS_FILE" >/dev/null 2>&1; then
    cat "$LP_PROGRESS_FILE"
else
    echo '{"state":"idle","code":"","progress":0,"step":"","message":"","updated_at":0}'
fi
exit 0
