#!/usr/bin/env bash
# Regression harness for the portable `timeout` wrapper (qm_timeout).
#
# WHY THIS EXISTS
# ---------------
# BusyBox changed `timeout`'s CLI in 1.30: SECS moved from an option
# (`-t SECS`) to a positional first argument, and `-t` was dropped. The two
# supported devices straddle that change, so NO single literal invocation
# works on both:
#
#   RG501Q-EU   BusyBox v1.29.3   `timeout 2 echo hi`  -> can't execute '2', rc=127
#   RM520N-GL   BusyBox v1.31.1   `timeout -t 2 echo hi` -> invalid option -- 't'
#
# The original bug was NOT the syntax, though — it was the detector.
# `install_rm520n.sh` guarded its `coreutils-timeout` install with
# `command -v timeout`, which always succeeds because BusyBox ships the
# applet, so the package was never installed on either device and nobody
# noticed for as long as only one device existed. That is the same mistake
# as the wget-symlink guard and the `mountpoint` guard: asking whether a
# NAME RESOLVES when what matters is whether the THING BEHAVES.
#
# So the assertions below are mostly about the detector and about drift:
#   - nothing may go back to `command -v timeout` as a detector;
#   - no bare `timeout N ...` call site may reappear;
#   - the three copies of qm_timeout must not diverge.
#
# The wrapper is also executed for real against fabricated legacy-form,
# positional-form and entirely-absent `timeout` binaries, because dispatch
# is the one part that can be wrong without looking wrong.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PLATFORM="$REPO_ROOT/scripts/usr/lib/qmanager/platform.sh"
HEALTH="$REPO_ROOT/scripts/usr/bin/qmanager_health_check"
INSTALLER="$REPO_ROOT/scripts/install_rm520n.sh"

pass_count=0
fail_count=0
ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

for f in "$PLATFORM" "$HEALTH" "$INSTALLER"; do
    [ -f "$f" ] || { echo "missing: $f" >&2; exit 1; }
done

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

# Extract the qm_timeout function body, normalised for comparison: leading
# whitespace stripped, comment-only lines and blanks dropped.
#
# CODE is what must not diverge. Comments deliberately may — the canonical
# copy in platform.sh carries the full BusyBox-version rationale, and the
# other two abbreviate it with a cross-reference rather than triplicating
# twenty lines of prose that would then have to be kept in sync by hand.
# Comparing comments too would make this harness fail for the one kind of
# difference we actually want.
extract_fn() {
    awk '/^qm_timeout\(\) \{$/,/^\}$/' "$1" \
        | sed 's/^[[:space:]]*//' \
        | grep -v '^#' \
        | grep -v '^$'
}

printf '\n[1] the three copies must not diverge\n'

extract_fn "$PLATFORM"  > "$TMPD/platform.fn"
extract_fn "$HEALTH"    > "$TMPD/health.fn"
extract_fn "$INSTALLER" > "$TMPD/installer.fn"

for n in platform health installer; do
    if [ -s "$TMPD/$n.fn" ]; then
        ok "extracted qm_timeout from $n"
    else
        bad "could not extract qm_timeout from $n"
    fi
done

# Three copies exist on purpose: the installer runs before libs are deployed,
# and the health check is redeployed by OTA independently of the lib, so a
# device mid-upgrade can have a platform.sh that predates qm_timeout. That
# makes drift the real risk, so it is pinned here rather than left to review.
if diff -q "$TMPD/platform.fn" "$TMPD/health.fn" >/dev/null 2>&1; then
    ok "platform.sh and qmanager_health_check copies are identical"
else
    bad "platform.sh and qmanager_health_check copies have DIVERGED"
    diff "$TMPD/platform.fn" "$TMPD/health.fn" | sed 's/^/       /' | head -20
fi

if diff -q "$TMPD/platform.fn" "$TMPD/installer.fn" >/dev/null 2>&1; then
    ok "platform.sh and install_rm520n.sh copies are identical"
else
    bad "platform.sh and install_rm520n.sh copies have DIVERGED"
    diff "$TMPD/platform.fn" "$TMPD/installer.fn" | sed 's/^/       /' | head -20
fi

printf '\n[2] the detector must probe behaviour, never a name\n'

# The regression that started all of this. `command -v timeout` cannot tell
# the two CLI forms apart because BusyBox provides the applet either way.
#
# Comment lines are stripped before matching: all three files legitimately
# discuss `command -v timeout` in prose explaining why it is wrong, and an
# assertion about CODE must not be satisfied — or broken — by a comment.
detector=$(grep -nE 'command -v timeout' "$PLATFORM" "$HEALTH" "$INSTALLER" \
    | grep -v '^[^:]*:[0-9]*:[[:space:]]*#' || true)
if [ -n "$detector" ]; then
    bad "a 'command -v timeout' detector has come back:"
    printf '%s\n' "$detector" | sed 's/^/       /'
else
    ok "no 'command -v timeout' detector in code (comments may discuss it)"
fi

for f in "$PLATFORM" "$HEALTH" "$INSTALLER"; do
    n=$(basename "$f")
    if grep -qF 'timeout 1 true' "$f"; then
        ok "$n probes behaviour (timeout 1 true)"
    else
        bad "$n has no behaviour probe"
    fi
done

# Resolution must be by absolute path: a root helper invoked via
# `setsid sudo -n ...` receives a PATH with no /opt/bin (measured), so a
# PATH-relative lookup would silently miss the binary for the very caller
# that needs it.
for f in "$PLATFORM" "$HEALTH" "$INSTALLER"; do
    n=$(basename "$f")
    if grep -qF '/usr/bin/timeout' "$f" && grep -qF '/opt/bin/timeout' "$f"; then
        ok "$n resolves timeout by absolute path"
    else
        bad "$n does not resolve timeout by absolute path"
    fi
done

printf '\n[3] no bare timeout call sites may reappear\n'

# Every call site must go through qm_timeout. Exclude the wrapper's own
# internals (which legitimately invoke the resolved binary by variable) and
# comments.
bare=$(grep -nE '(^|[^-[:alnum:]_/$"])timeout[[:space:]]+[0-9]' "$PLATFORM" "$HEALTH" "$INSTALLER" \
    | grep -v '^[^:]*:[0-9]*:[[:space:]]*#' \
    | grep -v 'timeout 1 true' || true)
if [ -n "$bare" ]; then
    bad "bare 'timeout N ...' call site(s) found:"
    printf '%s\n' "$bare" | sed 's/^/       /'
else
    ok "all call sites go through qm_timeout"
fi

printf '\n[4] platform.sh must stay safe to source under set -u\n'

# Its load guard used to be `[ -n "$_PLATFORM_LOADED" ]`, which killed any
# `set -u` caller on line 1 — and a `. lib || { fallback; }` guard cannot
# rescue that, because the shell is already gone.
if bash -c "set -u; . '$PLATFORM'" >/dev/null 2>&1; then
    ok "platform.sh sources cleanly under set -u"
else
    bad "platform.sh aborts a set -u caller (check the load guard uses \${VAR:-})"
fi

printf '\n[5] the dead getent branch must stay removed\n'

# getent was measured ABSENT on both supported devices, so that arm was
# unreachable everywhere and nslookup is the only live DNS path. A fix that
# had touched only the getent arm would have reviewed as correct and changed
# nothing on hardware.
if grep -qE 'command -v getent' "$HEALTH"; then
    bad "the unreachable getent branch has been restored"
else
    ok "no getent branch in qmanager_health_check"
fi

printf '\n[6] wrapper behaviour (executed against fabricated timeouts)\n'

# Build a harness that sources only the wrapper block, with the probe pointed
# at a fake binary, so dispatch can be tested without either real device.
make_fake() {
    # $1 = dir, $2 = form ("legacy"|"positional")
    mkdir -p "$1"
    if [ "$2" = "legacy" ]; then
        cat > "$1/timeout" <<'FAKE'
#!/bin/sh
# BusyBox <1.30: SECS is an option. A positional first arg is treated as the
# program to exec, which is why the real thing returns 127.
if [ "$1" = "-t" ]; then shift 2; exec "$@"; fi
echo "timeout: can't execute '$1': No such file or directory" >&2
exit 127
FAKE
    else
        cat > "$1/timeout" <<'FAKE'
#!/bin/sh
# BusyBox >=1.30 / coreutils: SECS positional, -t rejected.
if [ "$1" = "-t" ]; then echo "timeout: invalid option -- 't'" >&2; exit 1; fi
shift
exec "$@"
FAKE
    fi
    chmod 755 "$1/timeout"
}

# Drive the real wrapper with an overridden resolution, exercising the same
# dispatch/remap code the devices run.
run_wrapper() {
    # $1 = form, $2 = bin path (may be empty for the fail-open branch), rest = args
    local form="$1" bin="$2"; shift 2
    {
        awk '/^qm_timeout\(\) \{$/,/^\}$/' "$PLATFORM"
        printf '_QM_TIMEOUT_FORM=%s\n_QM_TIMEOUT_BIN=%s\n' "$form" "$bin"
        printf 'qm_timeout "$@"; echo "RC=$?"\n'
    } > "$TMPD/drive.sh"
    sh "$TMPD/drive.sh" "$@" 2>&1
}

make_fake "$TMPD/legacy" legacy
make_fake "$TMPD/positional" positional

out=$(run_wrapper legacy "$TMPD/legacy/timeout" 5 echo hello)
case "$out" in
    *hello*RC=0*) ok "legacy form: dispatches as -t SECS and succeeds" ;;
    *) bad "legacy dispatch wrong: $out" ;;
esac

out=$(run_wrapper positional "$TMPD/positional/timeout" 5 echo hello)
case "$out" in
    *hello*RC=0*) ok "positional form: dispatches as SECS and succeeds" ;;
    *) bad "positional dispatch wrong: $out" ;;
esac

# A wrapper that dispatched the WRONG form would produce the device symptom:
# the 127 / invalid-option error instead of the command's output.
out=$(run_wrapper positional "$TMPD/legacy/timeout" 5 echo hello)
case "$out" in
    *"can't execute"*) ok "negative control: wrong form reproduces the device failure" ;;
    *) bad "negative control did not reproduce the mismatch: $out" ;;
esac

# Exit-status passthrough: a command's own failure must survive the wrapper.
out=$(run_wrapper positional "$TMPD/positional/timeout" 5 sh -c 'exit 3')
case "$out" in
    *RC=3*) ok "propagates the command's own exit status" ;;
    *) bad "exit status not propagated: $out" ;;
esac

# Fail-open branch: no usable timeout binary at all. Must still bound the
# command (never exec unbounded — an unbounded call inside the set -e
# installer would hang the whole install) and must still run it.
out=$(run_wrapper none "" 5 echo hello)
case "$out" in
    *hello*RC=0*) ok "fail-open branch still runs the command" ;;
    *) bad "fail-open branch did not run the command: $out" ;;
esac

# ...and must actually kill an overrunning command, reporting 124 rather than
# BusyBox's raw 143, because callers test for 124 (qmanager_health_check's
# DNS test does).
out=$(run_wrapper none "" 1 sleep 20)
case "$out" in
    *RC=124*) ok "fail-open branch bounds an overrun and reports 124" ;;
    *) bad "fail-open branch did not bound/remap an overrun: $out" ;;
esac

printf '\n[timeout-portability] %d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
