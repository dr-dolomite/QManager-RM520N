#!/bin/sh
# =============================================================================
# install_cancel.sh — CGI Endpoint: Signal the worker to cancel between steps
# =============================================================================
# POST only. Touches the cancel sentinel the worker polls between steps —
# does not kill the worker outright, so a step already in flight (e.g. an
# in-progress curl) finishes cleanly and the worker exits on its own via the
# next bail_if_cancelled check.
#
# Response: 200 {"success":true,"state":"cancelling"}
#       or: 405 {"success":false,"error":"method_not_allowed"}
#
# Endpoint: POST /cgi-bin/quecmanager/system/language-packs/install_cancel.sh
# =============================================================================

. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/language_packs.sh

qlog_init "lp_install_cancel_cgi"

if [ "$REQUEST_METHOD" = "OPTIONS" ]; then
    cgi_headers
    exit 0
fi

if [ "$REQUEST_METHOD" != "POST" ]; then
    echo "Status: 405 Method Not Allowed"
    cgi_headers
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

touch "$LP_CANCEL_FILE"

cgi_headers
jq -n '{"success":true,"state":"cancelling"}'
exit 0
