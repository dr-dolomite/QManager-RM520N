#!/bin/sh
# =============================================================================
# install.sh — CGI Endpoint: Start a language-pack install
# =============================================================================
# POST body: { "code": "fr", "manifest_url": "https://..." }
# Limits: 4 KiB body cap.
#
# Response: 202 {"success":true,"state":"pending","code":".."}
#       or: 409 {"success":false,"error":"install_in_progress"}
#       or: 400 {"success":false,"error":"..."}
#       or: 405 {"success":false,"error":"method_not_allowed"}
#
# Concurrency is gated by a kernel flock on $LP_LOCK_FILE (fd 9), NOT a PID
# file or a mkdir-based lock directory — see the fork-site comment below for
# why. Double-forks /usr/bin/qmanager_language_install detached, which
# inherits the held lock and keeps it for its whole run.
#
# Endpoint: POST /cgi-bin/quecmanager/system/language-packs/install.sh
# =============================================================================

. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/language_packs.sh

qlog_init "lp_install_cgi"

MAX_BODY_SIZE=$((4 * 1024))
WORKER="/usr/bin/qmanager_language_install"

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

# --- Read + validate body -----------------------------------------------------
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
MANIFEST_URL=$(printf '%s' "$BODY" | jq -r '.manifest_url // empty')

[ -z "$CODE" ] && {
    echo "Status: 400 Bad Request"
    cgi_headers
    cgi_error "missing_code" "code is required"
    exit 0
}

lp_pack_is_code_safe "$CODE" || {
    echo "Status: 400 Bad Request"
    cgi_headers
    cgi_error "invalid_code" "code must match [A-Za-z0-9-]{2,35}"
    exit 0
}

[ -z "$MANIFEST_URL" ] && {
    echo "Status: 400 Bad Request"
    cgi_headers
    cgi_error "missing_manifest_url" "manifest_url is required"
    exit 0
}

# SSRF gate — never let a request reach the worker with a manifest_url
# outside this project's own GitHub release feed.
lp_manifest_url_is_safe "$MANIFEST_URL" || {
    echo "Status: 400 Bad Request"
    cgi_headers
    cgi_error "untrusted_manifest_url" "manifest_url must point to the project's own GitHub release feed"
    exit 0
}

# --- Concurrency guard: kernel flock on fd 9, single non-blocking attempt --
# Neither a PID file nor a mkdir-based lock directory can distinguish "the
# holder died" from "the holder hasn't written its marker yet" — both are
# heuristics with a real TOCTOU window (proven exploitable here under
# parallel-fired requests in two earlier rounds). A kernel flock has no such
# window: the lock is tied to the open file description, the kernel grants
# it to exactly one holder, and auto-releases it if the holder process dies,
# with no reclaim logic needed anywhere. This matches the flock_wait pattern
# already used by scripts/usr/bin/qcmd and
# scripts/usr/lib/qmanager/sms_alerts.sh (BusyBox flock has no -w, hence
# -x -n); those poll in a loop to wait for a busy resource, but install.sh
# wants the old 409-if-busy semantics, so a single non-blocking attempt is
# the correct shape here, not a wait loop.
#
# `exec 9>` (not a subshell redirect) is deliberate: the fd must survive
# into the forked worker below so the lock stays held for the worker's
# entire run, not just this script's lifetime. A shell `exec N>` fd is not
# close-on-exec, so `( "$WORKER" & )` inherits fd 9 automatically — nothing
# here explicitly passes it, and nothing must close it before that fork.
exec 9>"$LP_LOCK_FILE"
if ! flock -x -n 9; then
    echo "Status: 409 Conflict"
    cgi_headers
    cgi_error "install_in_progress" "A language-pack install is already running"
    exit 0
fi

# --- Persist input + clear stale progress/cancel sentinel --------------------
# Fast, no-subprocess-spawn steps only (plain redirect + rm) — kept before
# the fork below so the worker (which blocks on [ -f "$INPUT_FILE" ] at its
# own top) never races the input file.
printf '%s' "$BODY" > "$LP_INPUT_FILE"
rm -f "$LP_CANCEL_FILE" "$LP_PROGRESS_FILE"

# --- Fork the worker so it inherits the held lock (fd 9) ---------------------
# When this script exits below, it closes ITS copy of fd 9, but the open
# file description is now shared with the worker's inherited copy, so the
# flock stays held until the worker itself exits (or is killed — the kernel
# releases it then too). No PID file, no staleness heuristic to get wrong.
( "$WORKER" </dev/null >/dev/null 2>&1 & )

# Emit pending progress so the client's first poll doesn't race the worker.
lp_write_progress "pending" "$CODE" 0 "start" "Starting install..."

# --- Send 202 response ---------------------------------------------------------
echo "Status: 202 Accepted"
cgi_headers
jq -n --arg code "$CODE" '{"success":true,"state":"pending",code:$code}'

exit 0
