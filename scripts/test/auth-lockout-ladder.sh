#!/bin/sh
# Functional harness for the progressive login lockout in
# scripts/usr/lib/qmanager/cgi_auth.sh.
#
# Exercises the 30/120/300/900 ladder end to end without a modem, plus the two
# regressions that are easy to reintroduce and impossible to see by reading:
#   - a pre-upgrade state file (no `level`/`last_failure`) must still load
#   - qm_get_rate_limit_status must NEVER write, because check.sh calls it on
#     every load of the public overview splash; if it mutated, refreshing the
#     page would extend your own lockout
#
# NOTE: neither `set -e` nor `set -u` is used here, and both are deliberate.
#   -e: qm_check_rate_limit returns 1 as a normal "you are locked" signal, not
#       as an error, so -e would abort on the first CORRECT lockout.
#   -u: cgi_auth.sh guards its own re-entry with [ -n "$_CGI_AUTH_LOADED" ] on a
#       variable that is unset by design. lighttpd never runs CGI under -u, so
#       imposing it here would test a shell the library never actually meets.
# Failures are counted explicitly instead.

if ! command -v jq >/dev/null 2>&1; then
    echo "SKIP: jq not found" >&2
    exit 0
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LIB="$REPO_ROOT/scripts/usr/lib/qmanager/cgi_auth.sh"

if [ ! -f "$LIB" ]; then
    echo "FAIL: library not found at $LIB" >&2
    exit 1
fi

TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT

# flock is present on the device (BusyBox/Entware) but missing on some dev
# hosts. Stub it only when absent, so on a real box we exercise the real lock.
if ! command -v flock >/dev/null 2>&1; then
    echo "  note: flock absent on this host — stubbing it; the lock path is not covered here"
    flock() { return 0; }
fi

. "$LIB"

# Redirect the library's storage into the scratch dir (it set these at source
# time from the real /tmp paths).
ATTEMPTS_FILE="$TEST_DIR/attempts.json"
ATTEMPTS_LOCK="$TEST_DIR/attempts.lock"

PASS=0
FAIL=0

# Lockout deltas are computed as `locked_until - now`, so a wall-clock tick
# between the write and the read-back legitimately costs a second or two.
check() { # check <label> <expected> <actual>
    _ok=1
    if [ "$2" = "$3" ]; then
        _ok=0
    elif [ "$2" -gt 0 ] 2>/dev/null \
        && [ "$3" -ge $(( $2 - 2 )) ] 2>/dev/null \
        && [ "$3" -le "$2" ] 2>/dev/null; then
        _ok=0
    fi

    if [ "$_ok" -eq 0 ]; then
        PASS=$(( PASS + 1 ))
        printf '  ok   %-46s = %s\n' "$1" "$3"
    else
        FAIL=$(( FAIL + 1 ))
        printf '  FAIL %-46s expected %s, got %s\n' "$1" "$2" "$3"
    fi
}

# Fast-forward by rewinding the stored timestamps rather than sleeping.
rewind() {
    [ -f "$ATTEMPTS_FILE" ] || return 0
    jq --argjson d "$1" \
       '.locked_until  = (if .locked_until  > 0 then .locked_until  - $d else 0 end)
        | .first_attempt = (if .first_attempt > 0 then .first_attempt - $d else 0 end)
        | .last_failure  = (if .last_failure  > 0 then .last_failure  - $d else 0 end)' \
       "$ATTEMPTS_FILE" > "${ATTEMPTS_FILE}.r" && mv "${ATTEMPTS_FILE}.r" "$ATTEMPTS_FILE"
}

lvl() { jq -r '.level // 0' "$ATTEMPTS_FILE" 2>/dev/null || echo "-"; }

echo "== 1. the first five failures are allowed, and remaining counts down =="
i=1
while [ "$i" -le 5 ]; do
    qm_check_rate_limit
    check "attempt $i allowed (rc)" "0" "$?"
    qm_record_failed_attempt
    qm_get_rate_limit_status
    check "attempt $i remaining" "$(( 5 - i ))" "$RATE_LIMIT_ATTEMPTS_REMAINING"
    i=$(( i + 1 ))
done

echo "== 2. attempt 6 engages the ladder at 30s, before the password is checked =="
qm_check_rate_limit
check "attempt 6 blocked (rc)" "1" "$?"
check "retry_after" "30" "$RATE_LIMIT_RETRY_AFTER"
check "remaining" "0" "$RATE_LIMIT_ATTEMPTS_REMAINING"
check "level" "1" "$(lvl)"

echo "== 3. once on the ladder, each single failure escalates one rung =="
for expect in 120 300 900; do
    rewind 1000
    qm_check_rate_limit
    check "allowed once the lock expires (rc)" "0" "$?"
    qm_record_failed_attempt
    qm_get_rate_limit_status
    check "escalated retry_after" "$expect" "$RATE_LIMIT_RETRY_AFTER"
done

echo "== 4. the ladder caps rather than growing without bound =="
rewind 1000
qm_check_rate_limit >/dev/null
qm_record_failed_attempt
qm_get_rate_limit_status
check "capped retry_after" "900" "$RATE_LIMIT_RETRY_AFTER"
check "capped level" "4" "$(lvl)"

echo "== 5. a successful login clears the ladder completely =="
qm_clear_attempts
qm_get_rate_limit_status
check "post-success rc" "0" "$?"
check "post-success remaining" "5" "$RATE_LIMIT_ATTEMPTS_REMAINING"
check "state file removed" "gone" \
    "$([ -f "$ATTEMPTS_FILE" ] && echo present || echo gone)"

echo "== 6. an hour of quiet decays the ladder level back to zero =="
i=1
while [ "$i" -le 6 ]; do
    qm_check_rate_limit >/dev/null
    qm_record_failed_attempt
    i=$(( i + 1 ))
done
check "locked before decay" "1" "$(qm_check_rate_limit >/dev/null 2>&1; echo $?)"
rewind 7200
qm_check_rate_limit
check "decayed: allowed again (rc)" "0" "$?"
check "decayed: full budget restored" "5" "$RATE_LIMIT_ATTEMPTS_REMAINING"

echo "== 7. a pre-upgrade state file without level/last_failure still loads =="
printf '%s' '{"count":2,"first_attempt":'"$(date +%s)"',"locked_until":0}' \
    > "$ATTEMPTS_FILE"
qm_get_rate_limit_status
check "legacy file rc" "0" "$?"
check "legacy file remaining" "3" "$RATE_LIMIT_ATTEMPTS_REMAINING"

echo "== 8. the read-only accessor used by check.sh never mutates state =="
_before=$(cat "$ATTEMPTS_FILE")
i=1
while [ "$i" -le 5 ]; do
    qm_get_rate_limit_status
    i=$(( i + 1 ))
done
check "state unchanged after 5 status reads" "same" \
    "$([ "$_before" = "$(cat "$ATTEMPTS_FILE")" ] && echo same || echo MUTATED)"

echo
if [ "$FAIL" -eq 0 ]; then
    echo "PASS: $PASS assertions"
    exit 0
fi
echo "FAIL: $FAIL of $(( PASS + FAIL )) assertions" >&2
exit 1
