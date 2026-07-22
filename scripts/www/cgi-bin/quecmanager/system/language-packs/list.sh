#!/bin/sh
# =============================================================================
# list.sh — CGI Endpoint: Installed language packs + remote manifest view
# =============================================================================
# GET only. Query params:
#   manifest_url (optional, urlencoded) — remote manifest URL. If absent,
#     manifest is null and manifest_error is null (client-only degrade).
#     Must be pinned to this project's own GitHub release feed
#     (LP_MANIFEST_URL_PREFIX in language_packs.sh) — anything else yields
#     manifest_error:"untrusted_manifest_url" rather than being fetched.
#
# Response:
#   { "installed": [{code, version, native_name, english_name, completeness,
#                     namespaces}...],
#     "manifest": <RemoteManifest>|null,
#     "manifest_error": <"untrusted_manifest_url"|"unreachable">|null }
#
# "installed" is read from each persistent-store <code>/_pack.json
# (/usrdata/qmanager/locales-packs/) — never from the served web-root copy.
#
# Endpoint: GET /cgi-bin/quecmanager/system/language-packs/list.sh
# =============================================================================

. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/language_packs.sh

qlog_init "lp_list_cgi"
cgi_headers
cgi_handle_options

if [ "$REQUEST_METHOD" != "GET" ]; then
    cgi_method_not_allowed
fi

INSTALLED=$(lp_list_installed)

# --- Parse manifest_url from QUERY_STRING (URL-decode %XX only) -------------
_manifest_url=""
if [ -n "$QUERY_STRING" ]; then
    _manifest_url=$(printf '%s' "$QUERY_STRING" | awk 'BEGIN{RS="&"; FS="="} $1=="manifest_url"{print $2}' | head -1)
    _manifest_url=$(printf '%s' "$_manifest_url" | awk '
        BEGIN { o = "" }
        {
            s = $0
            gsub(/\+/, " ", s)
            while (match(s, /%[0-9A-Fa-f][0-9A-Fa-f]/)) {
                o = o substr(s, 1, RSTART-1)
                hex = substr(s, RSTART+1, 2)
                cmd = "printf \"\\x" hex "\""
                cmd | getline ch
                close(cmd)
                o = o ch
                s = substr(s, RSTART + 3)
            }
            o = o s
        }
        END { print o }
    ')
fi

MANIFEST_JSON="null"
MANIFEST_ERR="null"
if [ -n "$_manifest_url" ]; then
    # SSRF gate — never fetch a manifest_url outside this project's own
    # GitHub release feed, regardless of what the caller supplied.
    if ! lp_manifest_url_is_safe "$_manifest_url"; then
        MANIFEST_ERR='"untrusted_manifest_url"'
    else
        _body=$(lp_fetch_manifest "$_manifest_url" 2>/dev/null)
        if [ -n "$_body" ]; then
            MANIFEST_JSON="$_body"
        else
            MANIFEST_ERR='"unreachable"'
        fi
    fi
fi

jq -n --argjson installed "$INSTALLED" \
      --argjson manifest "$MANIFEST_JSON" \
      --argjson manifest_error "$MANIFEST_ERR" \
      '{installed:$installed, manifest:$manifest, manifest_error:$manifest_error}'
exit 0
