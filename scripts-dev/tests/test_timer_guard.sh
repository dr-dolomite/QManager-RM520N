#!/bin/sh
# test_timer_guard.sh — off-device unit tests for the issue #9 clock-step
# fire guard in scripts/usr/lib/qmanager/schedule_timer.sh.
#
# Plain sh, no framework. Runs on the dev machine (Git Bash) and on-device
# (BusyBox ash) unmodified. Drives the guard purely through QM_TEST_* env
# injection (see schedule_timer.sh header) — never touches the real clock,
# filesystem, or systemd. Prints PASS/FAIL per case; exits non-zero if any
# case failed.
#
# Usage: sh scripts-dev/tests/test_timer_guard.sh

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
LIB="$REPO_ROOT/scripts/usr/lib/qmanager/schedule_timer.sh"

if [ ! -f "$LIB" ]; then
    echo "FAIL: cannot find $LIB"
    exit 1
fi

# shellcheck source=/dev/null
. "$LIB"

fail_count=0
case_num=0

# reset_env — clear every test-injection var so cases never leak into
# each other. Called before every case.
reset_env() {
    unset QM_TEST_YEAR
    unset QM_TEST_UPTIME
    unset QM_TEST_NOW_HHMM
    unset QM_TIMER_GUARD_BYPASS
}

# expect_allow <desc> <sched_hhmm>
expect_allow() {
    desc="$1"
    sched="$2"
    case_num=$((case_num + 1))
    if _qm_timer_fire_allowed "$sched"; then
        echo "PASS: [$case_num] $desc"
    else
        echo "FAIL: [$case_num] $desc (expected allow, got deny)"
        fail_count=$((fail_count + 1))
    fi
}

# expect_deny <desc> <sched_hhmm>
expect_deny() {
    desc="$1"
    sched="$2"
    case_num=$((case_num + 1))
    if _qm_timer_fire_allowed "$sched"; then
        echo "FAIL: [$case_num] $desc (expected deny, got allow)"
        fail_count=$((fail_count + 1))
    else
        echo "PASS: [$case_num] $desc"
    fi
}

# --- Case 1: insane clock (1970) denies regardless of uptime/schedule ------
reset_env
QM_TEST_YEAR=1970
QM_TEST_UPTIME=4000
export QM_TEST_YEAR QM_TEST_UPTIME
expect_deny "insane clock (1970) denies regardless of settled uptime" ""

# --- Case 2: non-numeric year denies ---------------------------------------
reset_env
QM_TEST_YEAR=abcd
QM_TEST_UPTIME=4000
export QM_TEST_YEAR QM_TEST_UPTIME
expect_deny "non-numeric year denies" ""

# --- Case 3: settled boot, no schedule, allows -----------------------------
reset_env
QM_TEST_YEAR=2026
QM_TEST_UPTIME=4000
export QM_TEST_YEAR QM_TEST_UPTIME
expect_allow "settled boot (uptime 4000s), no schedule minute, allows" ""

# --- Case 4: boot window, no schedule, denies (the issue #9 case) ---------
reset_env
QM_TEST_YEAR=2026
QM_TEST_UPTIME=24
export QM_TEST_YEAR QM_TEST_UPTIME
expect_deny "boot window (uptime 24s), no schedule minute, denies" ""

# --- Case 5: boot window, matching schedule, allows ------------------------
reset_env
QM_TEST_YEAR=2026
QM_TEST_UPTIME=60
QM_TEST_NOW_HHMM=04:03
export QM_TEST_YEAR QM_TEST_UPTIME QM_TEST_NOW_HHMM
expect_allow "boot window, now 04:03 matches sched 04:00 (within tol), allows" "04:00"

# --- Case 6: boot window, mismatching schedule, denies ---------------------
reset_env
QM_TEST_YEAR=2026
QM_TEST_UPTIME=60
QM_TEST_NOW_HHMM=10:29
export QM_TEST_YEAR QM_TEST_UPTIME QM_TEST_NOW_HHMM
expect_deny "boot window, now 10:29 mismatches sched 04:00, denies" "04:00"

# --- Case 7: midnight wrap allows -------------------------------------------
reset_env
QM_TEST_YEAR=2026
QM_TEST_UPTIME=60
QM_TEST_NOW_HHMM=00:03
export QM_TEST_YEAR QM_TEST_UPTIME QM_TEST_NOW_HHMM
expect_allow "midnight wrap: sched 23:58, now 00:03, allows" "23:58"

# --- Case 8: tolerance boundary ---------------------------------------------
reset_env
QM_TEST_YEAR=2026
QM_TEST_UPTIME=60
QM_TEST_NOW_HHMM=04:10
export QM_TEST_YEAR QM_TEST_UPTIME QM_TEST_NOW_HHMM
expect_allow "tolerance boundary: sched 04:00, now 04:10 (exactly 10min), allows" "04:00"

reset_env
QM_TEST_YEAR=2026
QM_TEST_UPTIME=60
QM_TEST_NOW_HHMM=04:11
export QM_TEST_YEAR QM_TEST_UPTIME QM_TEST_NOW_HHMM
expect_deny "tolerance boundary: sched 04:00, now 04:11 (11min, over tol), denies" "04:00"

# --- Case 9: bypass short-circuits to allow regardless of everything else --
reset_env
QM_TEST_YEAR=1970
QM_TEST_UPTIME=0
QM_TIMER_GUARD_BYPASS=1
export QM_TEST_YEAR QM_TEST_UPTIME QM_TIMER_GUARD_BYPASS
expect_allow "QM_TIMER_GUARD_BYPASS=1 allows despite deny-shaped clock/uptime" ""

# --- Case 10: leading-zero fields parse without error -----------------------
reset_env
QM_TEST_YEAR=2026
QM_TEST_UPTIME=60
QM_TEST_NOW_HHMM=08:09
export QM_TEST_YEAR QM_TEST_UPTIME QM_TEST_NOW_HHMM
expect_allow "leading-zero fields (08:09) parse without octal error, allows" "08:09"

reset_env

echo ""
if [ "$fail_count" -eq 0 ]; then
    echo "ALL PASS ($case_num cases)"
    exit 0
else
    echo "$fail_count of $case_num case(s) FAILED"
    exit 1
fi
