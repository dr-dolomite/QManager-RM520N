#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/config_backup_sections.sh
# apply.sh — Config Backup restore: validate the decrypted payload, spawn the worker.
# POST {schema:1, platform, format_version, source_model,
#       options:{imei_confirmed}, sections:{...}}

qlog_init "cgi_config_backup_apply"

MAX_BODY=$((256 * 1024))
PID_FILE="/tmp/qmanager_config_restore.pid"
INPUT_FILE="/tmp/qmanager_config_restore_input.json"
STATE_FILE="/tmp/qmanager_config_restore.json"
CANCEL_FILE="/tmp/qmanager_config_restore.cancel"
APPLY_BIN="/usr/bin/qmanager_config_restore"

fail() {
    [ -n "$1" ] && echo "Status: $1"
    cgi_headers
    cgi_error "$2" "${3:-}"
    exit 0
}

live_pid() {
    local p
    p=$(cat "$1" 2>/dev/null)
    case "$p" in ''|*[!0-9]*) return 1 ;; esac
    [ -d "/proc/$p" ] && echo "$p"
}

[ "$REQUEST_METHOD" = "OPTIONS" ] && { cgi_headers; exit 0; }
[ "$REQUEST_METHOD" = "POST" ] || fail "405 Method Not Allowed" "method_not_allowed" "Use POST"

case "$CONTENT_LENGTH" in ''|0|*[!0-9]*) fail "" "no_body" "POST body is empty" ;; esac
[ "$CONTENT_LENGTH" -le "$MAX_BODY" ] || fail "413 Payload Too Large" "payload_too_large" "Limit is 256 KiB"

# Held until this CGI exits (the worker is spawned without it): serialises
# the live-pid check, the input-file write and the spawn against a second POST.
SPAWN_LOCK="/tmp/qmanager_config_restore.spawn.lock"
( : >> "$SPAWN_LOCK" ) 2>/dev/null || fail "" "persist_failed" ""
exec 8>> "$SPAWN_LOCK"
if ! flock -x -n 8; then
    fail "409 Conflict" "restore_in_progress" "$(live_pid "$PID_FILE")"
fi

if pid=$(live_pid "$PID_FILE"); then
    fail "409 Conflict" "restore_in_progress" "$pid"
fi
live_pid /tmp/qmanager_update.pid >/dev/null && fail "409 Conflict" "update_in_progress" ""
live_pid /tmp/qmanager_profile_apply.pid >/dev/null && fail "409 Conflict" "profile_apply_in_progress" ""

BODY_FILE=$(mktemp /tmp/qmanager_cfgbk_body.XXXXXX) || fail "" "persist_failed" ""
trap 'rm -f "$BODY_FILE"' EXIT
head -c "$CONTENT_LENGTH" > "$BODY_FILE"

jq -e 'type == "object" and (.sections | type) == "object"' "$BODY_FILE" >/dev/null 2>&1 ||
    fail "" "invalid_json" ""
[ "$(jq -r '.schema // empty' "$BODY_FILE")" = "1" ] || fail "" "wrong_schema" ""

# RM551E and other-platform backups are refused before any write.
[ "$(jq -r '.platform // empty' "$BODY_FILE")" = "$CFG_BACKUP_PLATFORM" ] ||
    fail "" "foreign_platform" "$(jq -r '.platform // "unknown"' "$BODY_FILE")"
fv=$(jq -r '.format_version // empty | tostring' "$BODY_FILE")
major=${fv%%.*}
case "$major" in ''|*[!0-9]*) fail "" "wrong_version" "$fv" ;; esac
[ "$major" -le "$CFG_BACKUP_FORMAT_MAJOR" ] || fail "" "backup_too_new" "$fv"

KEYS=""
for k in $(jq -r '.sections | keys[]' "$BODY_FILE"); do
    cfg_backup_valid_key "$k" || fail "" "invalid_section_key" ""
    KEYS="$KEYS $k"
done
[ -n "$KEYS" ] || fail "" "no_sections" ""
if clash=$(cfg_backup_conflict "$KEYS"); then
    fail "" "sections_conflict" "$clash"
fi

[ -x "$APPLY_BIN" ] || fail "" "not_installed" "Restore worker not found"

umask 077
jq -c '{schema, platform, format_version, source_model: (.source_model // ""),
        options: (.options // {}), sections}' "$BODY_FILE" > "$INPUT_FILE.tmp.$$" 2>/dev/null &&
    mv -f "$INPUT_FILE.tmp.$$" "$INPUT_FILE" || {
    rm -f "$INPUT_FILE.tmp.$$"
    fail "" "persist_failed" ""
}
rm -f "$CANCEL_FILE" "$STATE_FILE"

JOB_ID=$(date +%s)
( "$APPLY_BIN" "$JOB_ID" </dev/null >/dev/null 2>&1 8>&- & )

# The worker writes its PID within ~1 s; report a start that died at once.
i=0
while [ "$i" -lt 10 ]; do
    live_pid "$PID_FILE" >/dev/null && break
    [ -f "$STATE_FILE" ] && break
    sleep 0.2 2>/dev/null || sleep 1
    i=$((i + 1))
done
if ! live_pid "$PID_FILE" >/dev/null && [ ! -f "$STATE_FILE" ]; then
    fail "" "start_failed" "Restore worker did not start"
fi

cgi_headers
jq -n --arg job "$JOB_ID" '{success:true, status:"started", job_id:$job}'
