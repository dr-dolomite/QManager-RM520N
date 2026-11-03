#!/bin/sh
# sms_sent.sh — log of SMS sent from QManager (sourced by cellular/sms.sh).
#
# The modem keeps received messages only, so outbound bubbles live here:
#   SMS_SENT_FILE (/etc/qmanager/sms_sent.json), a JSON array of
#   {seq, addr, content, time, status:"success"|"failed"}, newest 300 kept.
# /etc/qmanager is www-data-owned; /usrdata/qmanager is root-only. Every write
# is read-modify-write under SMS_SENT_LOCK, via a same-dir temp + rename. A
# missing or corrupt file reads as []. Created on the first send.

[ -n "$_QM_SMS_SENT_LOADED" ] && return 0
_QM_SMS_SENT_LOADED=1

: "${SMS_SENT_FILE:=/etc/qmanager/sms_sent.json}"
: "${SMS_SENT_LOCK:=/tmp/qmanager_sms_sent.lock}"
SMS_SENT_CAP=300
SMS_SENT_LOCK_WAIT=3

# sms_sent_read — print the log as a valid JSON array ([] when missing/corrupt).
sms_sent_read() {
    _ss_out=""
    if [ -s "$SMS_SENT_FILE" ]; then
        _ss_out=$(jq -c 'if type == "array" then [.[] | select(type == "object")] else empty end' "$SMS_SENT_FILE" 2>/dev/null)
    fi
    [ -n "$_ss_out" ] || _ss_out="[]"
    printf '%s\n' "$_ss_out"
}

# Write stdin to SMS_SENT_FILE atomically (same-dir temp, then rename).
_sms_sent_store() {
    _ss_tmp="${SMS_SENT_FILE}.tmp.$$"
    if cat > "$_ss_tmp" && chmod 644 "$_ss_tmp" && mv -f "$_ss_tmp" "$SMS_SENT_FILE"; then
        return 0
    fi
    rm -f "$_ss_tmp" 2>/dev/null
    return 1
}

# _sms_sent_locked <jq filter> [jq args...] — apply a filter to the log under
# the lock and store the result. A subshell, so the lock fd closes however it
# exits. rc 1 on lock timeout or write error.
_sms_sent_locked() {
    (
        [ -e "$SMS_SENT_LOCK" ] || : > "$SMS_SENT_LOCK" 2>/dev/null
        chmod 666 "$SMS_SENT_LOCK" 2>/dev/null
        exec 8<"$SMS_SENT_LOCK" || exit 1
        # BusyBox flock has no -w: poll -n for SMS_SENT_LOCK_WAIT s.
        _ss_i=0
        _ss_n=$((SMS_SENT_LOCK_WAIT * 10))
        until flock -x -n 8 2>/dev/null; do
            _ss_i=$((_ss_i + 1))
            [ "$_ss_i" -ge "$_ss_n" ] && exit 1
            sleep 0.1
        done
        _ss_filter="$1"
        shift
        _ss_new=$(sms_sent_read | jq -c "$@" "$_ss_filter" 2>/dev/null)
        [ -n "$_ss_new" ] || exit 1
        printf '%s\n' "$_ss_new" | _sms_sent_store
    )
}

# sms_sent_append <addr> <content> <status> [epoch]
sms_sent_append() {
    _ssa_status="$3"
    [ "$_ssa_status" = "success" ] || _ssa_status="failed"
    _ssa_time="${4:-$(date +%s)}"
    case "$_ssa_time" in ''|*[!0-9]*) _ssa_time=$(date +%s) ;; esac
    _sms_sent_locked '
        (([.[].seq | numbers] | max) // 0) as $last
        | . + [{seq: ($last + 1), addr: $addr, content: $content,
                time: $time, status: $status}]
        | .[-($cap):]' \
        --arg addr "$1" --arg content "$2" --arg status "$_ssa_status" \
        --argjson time "$_ssa_time" --argjson cap "$SMS_SENT_CAP"
}

# sms_sent_delete_identities <json array of "S<seq>:<time>" strings>
# Identities already gone count as deleted.
sms_sent_delete_identities() {
    _sms_sent_locked '
        [.[] | select(("S" + (.seq | tostring) + ":" + (.time | tostring)) as $id
                      | any($ids[]; . == $id) | not)]' \
        --argjson ids "$1"
}

# sms_sent_delete_addr <addr> — drop every record sent to addr.
sms_sent_delete_addr() {
    _sms_sent_locked '[.[] | select(.addr != $addr)]' --arg addr "$1"
}

# sms_sent_clear — empty the log (no-op when it does not exist yet).
sms_sent_clear() {
    [ -e "$SMS_SENT_FILE" ] || return 0
    _sms_sent_locked '[]'
}
