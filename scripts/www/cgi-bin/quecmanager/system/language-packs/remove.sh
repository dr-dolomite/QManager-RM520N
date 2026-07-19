#!/bin/sh
# =============================================================================
# remove.sh — CGI Endpoint: Remove an installed (non-bundled) language pack
# =============================================================================
# POST body: { "code": "fr" }
# Refuses bundled codes (en, zh-CN, zh-TW, it, id) with a clear error.
# Removal itself goes through the root helper (qmanager_language_pack_apply
# --remove) so www-data never writes directly into the root-owned stores.
#
# Response: 200 {"success":true}
#       or: 400 {"success":false,"error":"cannot_remove_bundled|invalid_code|..."}
#       or: 405 {"success":false,"error":"method_not_allowed"}
#       or: 500 {"success":false,"error":"remove_failed"}
#
# Endpoint: POST /cgi-bin/quecmanager/system/language-packs/remove.sh
# =============================================================================

. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/language_packs.sh

qlog_init "lp_remove_cgi"

MAX_BODY_SIZE=$((4 * 1024))

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

if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt "$MAX_BODY_SIZE" ] 2>/dev/null; then
    echo "Status: 413 Payload Too Large"
    cgi_headers
    cgi_error "payload_too_large" "Request body exceeds 4 KiB"
    exit 0
fi

if [ -z "$CONTENT_LENGTH" ] || [ "$CONTENT_LENGTH" -le 0 ] 2>/dev/null; then
    echo "Status: 400 Bad Request"
    cgi_headers
    cgi_error "no_body" "POST body is empty"
    exit 0
fi
BODY=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null)

printf '%s' "$BODY" | jq -e '.' >/dev/null 2>&1 || {
    echo "Status: 400 Bad Request"
    cgi_headers
    cgi_error "invalid_json" "Body is not valid JSON"
    exit 0
}

CODE=$(printf '%s' "$BODY" | jq -r '.code // empty')

[ -z "$CODE" ] && {
    echo "Status: 400 Bad Request"
    cgi_headers
    cgi_error "missing_code" "code is required"
    exit 0
}

for _b in $LP_BUNDLED_CODES; do
    if [ "$CODE" = "$_b" ]; then
        echo "Status: 400 Bad Request"
        cgi_headers
        cgi_error "cannot_remove_bundled" "Bundled languages cannot be removed"
        exit 0
    fi
done

lp_pack_is_code_safe "$CODE" || {
    echo "Status: 400 Bad Request"
    cgi_headers
    cgi_error "invalid_code" "code must match [A-Za-z0-9-]{2,35}"
    exit 0
}

if ! lp_remove_pack "$CODE"; then
    echo "Status: 500 Internal Server Error"
    cgi_headers
    cgi_error "remove_failed" "Failed to remove language pack"
    exit 0
fi

cgi_headers
cgi_success
exit 0
