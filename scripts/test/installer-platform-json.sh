#!/bin/bash
# Workstation fixture for install_rm520n.sh's platform.json generation (Phase A T2).
# Run from repo root:  bash scripts/test/installer-platform-json.sh
#
# ---------------------------------------------------------------------------
# WHY THIS HARNESS EXTRACTS CODE INSTEAD OF SOURCING THE INSTALLER
#
# install_rm520n.sh ends in a bare `main "$@"`, so sourcing it runs a real
# install. preflight() itself also remounts /, probes the network and reads the
# hardcoded /etc/quectel-project-version — none of which belong in a
# workstation test. So this harness lifts the two regions under test out of the
# shipped file BY ANCHOR TEXT (never by line number) and runs them verbatim in a
# sandbox with stubbed logging.
#
# The anchors are themselves asserted: if a region stops matching, the harness
# FAILS rather than silently testing nothing. That is the whole point — the bug
# this task exists to prevent is a silent no-op.
#
# WHAT THIS GUARDS AGAINST — read before "simplifying" it.
#
# T3 will make qmanager_setup regenerate platform.json at boot, and
# start_services() runs `systemctl restart qmanager-setup` on EVERY install. So
# from T3 onward a device ends up with a correct profile whether or not this
# installer code works at all. Combined with T2's three silent failure modes
# (missing parent dir -> return 1; the mandated `|| warn` logging to a file
# rather than the console; the --frontend-only source abort), T2 can be
# completely non-functional on fresh installs while every on-device check still
# passes. This harness is the ONLY thing that observes preflight in isolation,
# before that masking can occur.
# ---------------------------------------------------------------------------
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALLER="$REPO_ROOT/scripts/install_rm520n.sh"
HW_LIB="$REPO_ROOT/scripts/usr/lib/qmanager/hw_profile.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

pass_count=0
fail_count=0
ok()      { printf '  PASS  %s\n' "$1"; pass_count=$((pass_count + 1)); }
bad()     { printf '  FAIL  %s\n' "$1" >&2; fail_count=$((fail_count + 1)); }
section() { printf '\n== %s ==\n' "$1"; }
eq() {
    if [ "$2" = "$3" ]; then ok "$1"
    else bad "$1 (expected '$2', got '$3')"; fi
}

for f in "$INSTALLER" "$HW_LIB"; do
    [ -f "$f" ] || { echo "FAIL: missing $f" >&2; exit 1; }
done

# Real device bytes, same provenance as scripts/test/hw-profile.sh.
FIXTURE_RG501Q=$(printf '%s' \
'UHJvamVjdCBOYW1lOiBSRzUwMVFFVV9WRApQcm9qZWN0IFJldiA6IFJHNTAxUUVVQUFSMTJBMTFNNEdfMDQuMjAyCkJyYW5jaCAgTmFtZTogU0RYNTUKQ3VzdG9tICBOYW1lOiBTVEQKUGFja2FnZSBUaW1lOiAyMDI1LTAyLTIxLDEzOjQzCg==' \
    | base64 -d)

# --- Region extraction -------------------------------------------------------
# extract_range <start-regex> <end-regex> — inclusive of start, EXCLUSIVE of end.
extract_range() {
    awk -v s="$1" -v e="$2" '
        $0 ~ e && started { exit }
        $0 ~ s { started = 1 }
        started { print }
    ' "$INSTALLER"
}

PROFILE_BLOCK=$(extract_range '^    mark_version_pending$' '^    info "Pre-flight checks passed"$')
HEADLESS_BLOCK=$(extract_range '^                    local answer=""$' '^                    ;;$')
MVP_BLOCK=$(awk '/^mark_version_pending\(\) \{$/,/^\}$/' "$INSTALLER")

section "extraction anchors still match the shipped installer"
case "$PROFILE_BLOCK" in
    *qm_hw_write_profile*) ok "profile block extracted and contains qm_hw_write_profile" ;;
    *) bad "profile block missing or does not call qm_hw_write_profile — ANCHOR ROTTED" ;;
esac
case "$HEADLESS_BLOCK" in
    *'answer="y"'*) ok "headless auto-proceed block extracted" ;;
    *) bad "headless block missing or lost its auto-proceed — ANCHOR ROTTED" ;;
esac
case "$MVP_BLOCK" in
    *'install -d -m 0755 "$CONF_DIR"'*) ok "mark_version_pending still creates \$CONF_DIR with install -d" ;;
    *) bad "mark_version_pending no longer creates \$CONF_DIR — T2's placement premise is BROKEN" ;;
esac

# --- Sandbox -----------------------------------------------------------------
# Writes a runnable script wrapping the extracted region in a function (the
# region uses `local`, which bash rejects at top level) with stubbed logging.
# make_sandbox <out> <body> [skip_mvp]
# skip_mvp omits mark_version_pending's definition AND call, reproducing the
# plan's original placement (generator before $CONF_DIR is created).
make_sandbox() {
    local out="$1" body="$2" skip_mvp="${3:-}"
    cat > "$out" <<'STUBS'
set -e
VERSION="v0.0.0-test"
_log_raw() { printf '%s\n' "$1" >> "$LOG_SINK"; }
info()     { _log_raw "INFO  $1"; }
warn()     { _log_raw "WARN  $1"; }
error()    { _log_raw "ERROR $1"; }
step()     { _log_raw "STEP  $1"; }
die()      { _log_raw "DIE   $1"; exit 9; }
STUBS
    if [ -n "$skip_mvp" ]; then
        printf 'mark_version_pending() { :; }\n' >> "$out"
    else
        printf '%s\n' "$MVP_BLOCK" >> "$out"
    fi
    printf '_t_region() {\n' >> "$out"
    printf '%s\n' "$body" >> "$out"
    printf '}\n_t_region\n' >> "$out"
}

# --- Test 1: the missing-parent case — THE ONE THAT WOULD HAVE SHIPPED BROKEN --
#
# The plan placed the generator before $CONF_DIR exists. qm_hw_write_profile
# refuses to create its own parent, so that placement writes NOTHING on every
# device where QManager was never installed. On an RM520N-GL, where
# /etc/qmanager already exists, it works — which is why no device we own would
# have caught it.
section "generator writes into a \$CONF_DIR that did not exist"

sandbox="$work/t1.sh"
make_sandbox "$sandbox" "$PROFILE_BLOCK"

t1root="$work/t1root"
mkdir -p "$t1root"
printf '%s' "$FIXTURE_RG501Q" > "$t1root/quectel-project-version"

(
    export LOG_SINK="$work/t1.log"
    export CONF_DIR="$t1root/etc/qmanager"
    export VERSION_PENDING="$CONF_DIR/VERSION.pending"
    export SRC_SCRIPTS="$REPO_ROOT/scripts"
    export QUECTEL_VERSION_FILE="$t1root/quectel-project-version"
    [ -d "$CONF_DIR" ] && { echo "sandbox not clean" >&2; exit 1; }
    bash "$sandbox"
) && t1_rc=0 || t1_rc=$?

eq "preflight tail exits 0" "0" "$t1_rc"

profile="$t1root/etc/qmanager/platform.json"
if [ -f "$profile" ]; then
    ok "platform.json created under a previously absent \$CONF_DIR"
else
    bad "platform.json ABSENT — this is the exact bug the corrected placement fixes"
fi

if [ -e "$profile.tmp" ]; then
    bad "platform.json.tmp stranded — atomic write leaked a temp file"
else
    ok "no stranded platform.json.tmp"
fi

# Q8: the first execution of _qm_hw_json_escape's `tr -d '\000-\037'` outside
# T1's sandbox. Assert the emitted bytes, not just that a file appeared.
if [ -f "$profile" ]; then
    expected=$(printf '%s\n' \
'{' \
'  "schema": 1,' \
'  "model": "RG501QEU_VD",' \
'  "soc": "SDX55",' \
'  "form_factor": "lga",' \
'  "tier": "community",' \
'  "fw_fingerprint": "RG501QEUAAR12A11M4G_04.202",' \
'  "caps": {}' \
'}')
    if [ "$(cat "$profile")" = "$expected" ]; then
        ok "emitted JSON is byte-exact for the RG501Q fixture (schema 1, community tier)"
    else
        bad "emitted JSON differs from schema-1 expectation:"
        diff <(printf '%s\n' "$expected") "$profile" >&2 || true
    fi

    if command -v jq >/dev/null 2>&1; then
        if jq -e . "$profile" >/dev/null 2>&1; then
            ok "jq parses the emitted profile"
        else
            bad "jq rejects the emitted profile"
        fi
    else
        printf '  SKIP  jq not on PATH — byte comparison above still covers this\n'
    fi

    if grep -q $'\r' "$profile"; then
        bad "emitted profile contains CR bytes"
    else
        ok "emitted profile is LF-only"
    fi
fi

# --- Test 1b: CONTROL — prove the plan's original placement fails ------------
#
# This is the negative control for the finding that drove T2's redesign. Same
# code, same fixture, only difference: $CONF_DIR is not created first. If this
# ever starts PASSING, either qm_hw_write_profile began creating its own parent
# (a real behavior change to review) or this control has stopped testing
# anything.
section "CONTROL: the plan's placement (before \$CONF_DIR exists) writes nothing"

csandbox="$work/t1b.sh"
make_sandbox "$csandbox" "$PROFILE_BLOCK" skip_mvp

t1broot="$work/t1broot"
mkdir -p "$t1broot"
printf '%s' "$FIXTURE_RG501Q" > "$t1broot/quectel-project-version"

(
    export LOG_SINK="$work/t1b.log"
    export CONF_DIR="$t1broot/etc/qmanager"
    export VERSION_PENDING="$CONF_DIR/VERSION.pending"
    export SRC_SCRIPTS="$REPO_ROOT/scripts"
    export QUECTEL_VERSION_FILE="$t1broot/quectel-project-version"
    bash "$csandbox" 2>"$work/t1b.err"
) && t1b_rc=0 || t1b_rc=$?

eq "control still exits 0 (the failure is SILENT — that is the danger)" "0" "$t1b_rc"
if [ -f "$t1broot/etc/qmanager/platform.json" ]; then
    bad "control unexpectedly wrote a profile — this control no longer proves anything"
else
    ok "no profile written, confirming the plan's placement was a silent no-op"
fi
if grep -q "WARN  Could not write hardware profile" "$work/t1b.log" 2>/dev/null; then
    ok "failure surfaced only as a warn in the log, never on the console"
else
    bad "expected the guarded warn in the log"
fi
# qm_hw_write_profile silences its own `mv`, but the shell's redirect failure on
# "$tmp" is emitted by the shell itself and escapes the function's 2>/dev/null.
# Recording it because it is the ONLY console-visible trace the plan's placement
# would have produced — and it names a .tmp path, which reads like a transient
# glitch rather than "no profile was written".
if grep -q 'platform.json.tmp: No such file or directory' "$work/t1b.err" 2>/dev/null; then
    ok "control's only console trace is a misleading .tmp redirect error"
else
    ok "control produced no console trace at all (even quieter than expected)"
fi

# --- Test 2: --frontend-only must not abort the installer --------------------
#
# --frontend-only sets DO_BACKEND=0, and preflight only asserts $SRC_SCRIPTS
# exists when DO_BACKEND=1. An unguarded `.` of a missing file returns non-zero
# and `set -e` kills preflight — which is called bare from main().
section "--frontend-only (absent \$SRC_SCRIPTS) does not abort preflight"

t2root="$work/t2root"
mkdir -p "$t2root"
(
    export LOG_SINK="$work/t2.log"
    export CONF_DIR="$t2root/etc/qmanager"
    export VERSION_PENDING="$CONF_DIR/VERSION.pending"
    export SRC_SCRIPTS="$t2root/nonexistent-staging-tree"
    bash "$sandbox"
) && t2_rc=0 || t2_rc=$?

eq "preflight tail still exits 0 with no staging tree" "0" "$t2_rc"
if grep -q "WARN  Hardware profile library unavailable" "$work/t2.log" 2>/dev/null; then
    ok "warned instead of dying"
else
    bad "expected an 'unavailable' warning in the log"
fi
if [ -e "$t2root/etc/qmanager/platform.json" ]; then
    bad "wrote a profile with no library available"
else
    ok "no profile written, as expected"
fi

# --- Test 3: the headless auto-proceed path did not regress ------------------
#
# The plan proposed reproducing this on the RG501Q via `adb shell` with no tty.
# That justification RETIRED THE MOMENT Step 4 added the RG501Q* arm: the device
# no longer reaches the `*` arm at all, so after T2 there is no known device
# that exercises this path. A synthetic harness is now the only reproduction.
section "headless auto-proceed still fires with no tty and no stdin"

hsandbox="$work/t3.sh"
make_sandbox "$hsandbox" "$HEADLESS_BLOCK"

(
    export LOG_SINK="$work/t3.log"
    export CONF_DIR="$work/t3conf"
    export VERSION_PENDING="$work/t3conf/VERSION.pending"
    bash "$hsandbox" </dev/null >/dev/null 2>&1
) && t3_rc=0 || t3_rc=$?

eq "auto-proceed exits 0 (did not die)" "0" "$t3_rc"
if grep -q "INFO  Proceeding on user request" "$work/t3.log" 2>/dev/null; then
    ok "resolved to 'proceed' with no terminal"
else
    bad "did not reach the proceed branch — headless installs/OTA would abort"
fi
if grep -q "WARN  No terminal available" "$work/t3.log" 2>/dev/null; then
    ok "warned that no terminal was available"
else
    bad "missing the no-terminal warning"
fi

# --- Test 4: the two tier tables enumerate the same models -------------------
#
# The plan put the generator in the library because "two implementations would
# drift". T2 then adds an RG501Q* arm to the installer's own case, so two
# model->behavior tables now exist, keyed off two DIFFERENT parsers. Nothing
# else tests that they agree.
section "installer case globs and qm_hw_tier globs cover the same models"

installer_globs=$(awk '/case "\$project_name" in/,/^            esac$/' "$INSTALLER" \
    | grep -oE '^ +(RM|RG|EG|EC)[0-9A-Za-z]+\*\)' | tr -d ' )' | sort -u)
library_globs=$(awk '/^qm_hw_tier\(\) \{$/,/^\}$/' "$HW_LIB" \
    | grep -oE '^ +(RM|RG|EG|EC)[0-9A-Za-z]+\*\)' | tr -d ' )' | sort -u)

if [ "$installer_globs" = "$library_globs" ]; then
    ok "both tables list: $(printf '%s' "$installer_globs" | tr '\n' ' ')"
else
    bad "tier tables have DRIFTED"
    printf '    installer: %s\n' "$(printf '%s' "$installer_globs" | tr '\n' ' ')" >&2
    printf '    library:   %s\n' "$(printf '%s' "$library_globs" | tr '\n' ' ')" >&2
fi

# --- Test 5: the RG501Q arm is informational only ----------------------------
section "RG501Q arm emits info and never prompts"

rg_arm=$(awk '/^                RG501Q\*\)$/,/^                    ;;$/' "$INSTALLER")
# Strip comment-only lines before the prompt check: this arm's comment
# legitimately explains which prompt it exists to AVOID, and matching that text
# is a false positive. Assert against code.
rg_arm_code=$(printf '%s\n' "$rg_arm" | grep -v '^[[:space:]]*#')

case "$rg_arm_code" in
    *'info "Detected: RG501Q-EU'*) ok "emits an info line" ;;
    *) bad "RG501Q arm does not emit the expected info line" ;;
esac
case "$rg_arm_code" in
    *read*|*printf*|*'proceed anyway'*) bad "RG501Q arm prompts — it must not" ;;
    *) ok "no prompt in the RG501Q arm" ;;
esac

# --- Test 6: nothing inside the --force block touches platform.json ----------
#
# Every OTA upgrade passes --force, so that block is skipped on every upgrade.
section "the --force block does not touch platform.json"

force_block=$(awk '/^    if \[ "\$DO_FORCE" = "1" \]; then$/,/^    fi$/' "$INSTALLER")
case "$force_block" in
    *platform.json*|*qm_hw_write_profile*) bad "--force block references the profile — OTA devices would be skipped" ;;
    *) ok "--force block is clean" ;;
esac

# --- Summary -----------------------------------------------------------------
printf '\n%d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ]
