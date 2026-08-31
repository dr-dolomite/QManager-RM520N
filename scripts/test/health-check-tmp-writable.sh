#!/bin/bash
# F7 — pin both defects in qmanager_health_check::t_perm_tmp_writable.
#
# Run from a workstation, not the device:
#   bash scripts/test/health-check-tmp-writable.sh
#
# Two separate bugs lived in this one function:
#
#   1. Universal false-FAIL / false-PASS. The verdict was gated on the exit
#      status of the privilege-drop command (`if su … ; then`), which only
#      proves the transition succeeded — never that the write did. It measured
#      "can the caller su?", not "can www-data write to /tmp?".
#   2. RM520N-GL-only wedge. `su` pulls in Quectel's proprietary
#      /lib/security/loginpw.so (present on the RM520N-GL, absent on the
#      RG501Q-EU), which prints a challenge banner and blocks forever on a
#      terminal read with no timeout whenever su gets a controlling TTY.
#      Production survived only because run.sh:44 uses `setsid`, which strips
#      the TTY; running the check by hand from an interactive shell hung.
#
# The behavioural cases below are the load-bearing ones: they execute the real
# function body with the privilege transition stubbed, so a verdict gated on
# the transition instead of on the file is caught directly.
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HEALTH="${QM_HEALTH_CHECK:-$REPO_ROOT/scripts/usr/bin/qmanager_health_check}"

fail=0
bad() { printf 'FAIL: %s\n' "$1"; fail=1; }
ok()  { printf 'ok: %s\n' "$1"; }

[ -r "$HEALTH" ] || { echo "FAIL: cannot read $HEALTH"; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# --- Part 1: textual — the mechanism, not just the outcome ------------------

# `su -s` was the sole occurrence in the entire tree; it must stay at zero.
# scripts/test/ is excluded so this harness's own prose does not match itself.
su_hits=$(grep -rn --exclude-dir=test -- 'su -s' "$REPO_ROOT/scripts/" 2>/dev/null | wc -l | tr -d ' ')
if [ "$su_hits" = "0" ]; then
    ok "no 'su -s' anywhere under scripts/"
else
    bad "'su -s' still present ($su_hits hit(s)) — su's PAM stack loads loginpw.so on the RM520N-GL"
    grep -rn --exclude-dir=test -- 'su -s' "$REPO_ROOT/scripts/" 2>/dev/null | sed 's/^/      /'
fi

body=$(awk '/^t_perm_tmp_writable\(\)[[:space:]]*\{/,/^\}/' "$HEALTH")
[ -n "$body" ] || { echo "FAIL: could not extract t_perm_tmp_writable from $HEALTH"; exit 1; }

case "$body" in
    *"sudo -n -u www-data"*) ok "privilege drop uses 'sudo -n -u www-data' (no PAM auth stack, no TTY)" ;;
    *) bad "t_perm_tmp_writable does not use 'sudo -n -u www-data'" ;;
esac

case "$body" in
    *qm_timeout*) ok "the privilege transition is bounded by qm_timeout" ;;
    *) bad "t_perm_tmp_writable has no qm_timeout bound — an unbounded transition can wedge the whole check" ;;
esac

case "$body" in
    *'[ -f "$probe" ]'*) ok "the verdict is gated on the probe FILE existing" ;;
    *) bad "the verdict is not gated on [ -f \"\$probe\" ] — it measures the privilege drop, not the write" ;;
esac

# --- Part 2: behavioural — run the real function body under stubs -----------
#
# Harness-supplied stubs shadow the real binaries as shell functions, so the
# function under test can be exercised on a workstation with no www-data, no
# sudo and no /tmp semantics to depend on.

run_case() {
    # run_case NAME SELF_UID STUB_CREATES_FILE STUB_RC
    local name="$1" self_uid="$2" creates="$3" stub_rc="$4"
    local dir="$work/$name"
    mkdir -p "$dir"

    {
        echo 'set -u'
        echo "OUTPUT_FILE=\"$dir/out.log\""
        echo "TMPDIR_UNDER_TEST=\"$dir\""
        echo "STUB_MARKER=\"$dir/transition-was-called\""
        echo "STUB_CREATES=$creates"
        echo "STUB_RC=$stub_rc"
        cat <<'STUBS'
id() {
    case "$*" in
        "-u www-data") echo 33 ;;
        "-u")          echo "$SELF_UID" ;;
        *)             echo "$SELF_UID" ;;
    esac
}
_transition_stub() {
    : > "$STUB_MARKER"
    if [ "$STUB_CREATES" = "1" ]; then
        # Emulate the target user creating the probe. The probe path is the
        # last argument in every form the function may use.
        for _a in "$@"; do :; done
        : > "$_a"
    fi
    return "$STUB_RC"
}
sudo() { _transition_stub "$@"; }
su()   { _transition_stub "$@"; }
qm_timeout() { shift; "$@"; }
STUBS
        echo "SELF_UID=$self_uid"
        # Keep the probe inside the case dir so a workstation /tmp is never touched.
        echo "$body" | sed 's#/tmp/qmanager_health_check_probe#"$TMPDIR_UNDER_TEST"/probe#'
        echo 't_perm_tmp_writable'
    } > "$dir/case.sh"

    QM_CASE_OUT=$(bash "$dir/case.sh" 2>"$dir/stderr.log" || true)
    QM_CASE_MARKER="$dir/transition-was-called"
}

# Case A — the defect shape. The transition reports success but no file appears
# (a locked account whose PAM stack still returns 0, a sudo that execs a no-op).
# Gating on the transition's exit status calls this a PASS; gating on the file
# calls it a FAIL, which is correct.
run_case "a-transition-ok-no-write" 0 0 0
case "$QM_CASE_OUT" in
    fail\|*) ok "case A: transition rc=0 but no file written -> fail (verdict follows the write)" ;;
    *)       bad "case A: transition rc=0 with NO file written reported '$QM_CASE_OUT' — the verdict is following the privilege drop, not the write" ;;
esac

# Case B — the honest success path.
run_case "b-transition-writes" 0 1 0
case "$QM_CASE_OUT" in
    pass\|writable) ok "case B: transition writes the probe -> pass|writable" ;;
    *)              bad "case B: expected 'pass|writable', got '$QM_CASE_OUT'" ;;
esac

# Case C — already running as www-data (uid 33). www-data->www-data sudo is
# refused by sudoers on both devices (measured), so the function must write
# directly instead of transitioning, or it re-creates the false-FAIL on exactly
# the "validate as www-data" path this project mandates.
run_case "c-already-www-data" 33 0 1
case "$QM_CASE_OUT" in
    pass\|writable) ok "case C: running as www-data -> writes directly, pass|writable" ;;
    *)              bad "case C: running as www-data reported '$QM_CASE_OUT' (expected 'pass|writable')" ;;
esac
if [ -e "$QM_CASE_MARKER" ]; then
    bad "case C: attempted a privilege transition while already www-data — sudoers refuses www-data->www-data"
else
    ok "case C: no privilege transition attempted while already www-data"
fi

if [ "$fail" = "0" ]; then
    echo "PASS: health-check-tmp-writable"
else
    echo "FAILED: health-check-tmp-writable"
    exit 1
fi
