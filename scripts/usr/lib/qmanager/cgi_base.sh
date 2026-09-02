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
# Method Routing Fallback
# Call at the bottom of the method routing block.
# Returns 405 JSON and exits for any unsupported HTTP method.
# ---------------------------------------------------------------------------
cgi_method_not_allowed() {
    local _mna_out
    _mna_out=$(jq -n '{"success":false,"error":"method_not_allowed","detail":"Use GET or POST"}' 2>/dev/null)
    if [ -n "$_mna_out" ]; then
        printf '%s\n' "$_mna_out"
    else
        printf '{\n  "success": false,\n  "error": "method_not_allowed",\n  "detail": "Use GET or POST"\n}\n'
    fi
    exit 0
}

# ---------------------------------------------------------------------------
# JSON Response Helpers
# ---------------------------------------------------------------------------

# Emit {"success":true}
#
# Same jq-primary / behaviour-probe-detector shape as cgi_error below. The
# payload is a constant, so the fallback needs no escaper. Widened from F2's
# cgi_error-only scope by F17: a device that answers 200 with an empty body
# is mute regardless of which helper produced the emptiness.
cgi_success() {
    local _ok_out
    _ok_out=$(jq -n '{"success":true}' 2>/dev/null)
    if [ -n "$_ok_out" ]; then
        printf '%s\n' "$_ok_out"
    else
        printf '{\n  "success": true\n}\n'
    fi
}

# _cgi_json_escape <string> — escape a string for use as a JSON string body.
# Only needed by the jq-free path below; jq does its own escaping.
#
# Order matters: backslash first, then double-quote, or the backslash pass
# would re-escape the ones the quote pass just added. Tab/CR/LF fold to
# spaces and every other control byte is dropped, because a raw control
# character inside a JSON string is a parse error — and details here often
# come from multi-line command output. sed runs LAST so the trailing newline
# it appends is absorbed by the caller's $( ), rather than being folded into
# a trailing space inside the value.
#
# Probed identical on both targets, 2026-08-30: BusyBox 1.31.1 (RM520N-GL,
# 61368cd2) and 1.29.3 (RG501Q-EU, b7e3d6f1) agree on `tr -d '\000-\037'`,
# on the two sed passes, and on `printf '%s'` leaving backslashes alone.
_cgi_json_escape() {
    printf '%s' "$1" \
        | tr '\n\r\t' '   ' \
        | tr -d '\000-\037' \
        | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# cgi_error <error_code> <detail_message>
#
# jq is the primary path; the fallback exists because cgi_error is the ONE
# error reporter behind 53 CGI scripts and used to be nothing BUT a `jq -n`
# call. On a device whose Entware bootstrap failed there is no /opt/bin/jq,
# so every endpoint answered 200 with the right Content-Type and a
# completely empty body — the web UI went mute with nothing to trace,
# because the error reporter depended on the exact thing that was missing.
#
# The detector is the jq call itself: run it, and fall back when it produced
# no output. That is a behaviour probe, deliberately not `command -v jq` — a
# presence check cannot tell "a thing named jq" from "a jq that works",
# which is the defect shape behind F1/F5/F6/F16 in the same tracker. It also
# covers a jq that exists but is broken, not just a jq that is absent.
#
# The fallback envelope is byte-identical to jq's: same key order, same
# 2-space pretty-printing, same LF terminator (jq's on-device output was
# captured to confirm this), so the ~40 frontend call sites reading
# `data.detail || data.error` need no special case.
#
# SCOPE (widened by F17): cgi_success, cgi_method_not_allowed and
# cgi_auth.sh's require_auth all have a jq-free path now. F2 covered
# cgi_error only, which left the PRE-AUTH path mute — require_auth is the
# first thing a browser hits, so on a bootstrap-broken device the UI died
# before this fallback could ever be reached.
#
# require_auth can call cgi_error only because this whole block was moved
# ABOVE the auth section: cgi_base.sh invokes require_auth at LOAD TIME, so
# anything require_auth calls must already be defined. cgi_headers has
# always lived above it for exactly this reason (see its own comment). Do
# not move this block back down.
cgi_error() {
    local _err_out
    _err_out=$(jq -n --arg error "$1" --arg detail "${2:-}" \
        '{"success":false,"error":$error,"detail":$detail}' 2>/dev/null)

    if [ -n "$_err_out" ]; then
        printf '%s\n' "$_err_out"
    else
        printf '{\n  "success": false,\n  "error": "%s",\n  "detail": "%s"\n}\n' \
            "$(_cgi_json_escape "$1")" "$(_cgi_json_escape "${2:-}")"
    fi
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
    qm_get_rate_limit_status() { RATE_LIMIT_RETRY_AFTER=0; RATE_LIMIT_ATTEMPTS_REMAINING=5; return 0; }
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
# An optional second argument caps the response to the newest N lines. Omit it
# (or pass 0) to serve the whole file, which is what the existing callers do.
serve_ndjson_as_array() {
    local _file="$1" _limit="${2:-0}"
    if [ -f "$_file" ] && [ -s "$_file" ]; then
        if [ "$_limit" -gt 0 ] 2>/dev/null; then
            tail -n "$_limit" "$_file" | jq -s '.'
        else
            jq -s '.' "$_file"
        fi
    else
        echo "[]"
    fi
}
