#!/bin/bash
# Workstation fixtures for Phase A / Task 5 — about.sh's firmware-revision read.
# Run from the repo root:  bash scripts/test/about-firmware-revision.sh
#
# WHAT THIS PINS, AND WHAT IT DOES NOT.
#
# There is NO DEFECT here. Unlike the poller's `grep -m1 "^Branch Name"` that
# Task 4 repaired — one space where the vendor file column-aligns with two, so
# it matched nothing on any device that has ever run QManager — about.sh's
# `grep 'Project Rev'` is UNANCHORED and has always matched the real format.
# Measured on the live RM520N-GL (androidboot.serialno=61368cd2) on 2026-08-26,
# both as www-data:
#
#   grep 'Project Rev' F | sed 's/.*: *//' | tr -d ' \r'  -> RM520NGLAAR03A03M4G_A0.304
#   . /usr/lib/qmanager/hw_profile.sh; qm_hw_fw_fingerprint -> RM520NGLAAR03A03M4G_A0.304
#
# So Task 5 is a CONSOLIDATION, not a fix, and this harness does not invent a
# defect to justify itself. What it pins is the thing a consolidation can
# actually break: the wire format of `system.openwrt_version`.
#
# The load-bearing assertions are the ABSENCE cases (section C). The old
# expression produced "" when the vendor file was missing or carried no
# `Project Rev` line; hw_profile.sh's accessor deliberately returns its
# "unknown" sentinel instead (hw_profile.sh:49-51 — "Never a bare empty
# string — a caller must not be able to mistake 'unreadable' for a value").
# Without an explicit unmapping, the string `unknown` would reach the wire and
# render verbatim in components/about-device/device-information-card.tsx:67.
# Each absence test therefore asserts BOTH that the function returns "" AND
# that the raw accessor returns "unknown" — so the test cannot pass by the
# accessor happening to be empty.
#
# THE DIFFERENTIAL ON REAL DEVICE BYTES (section B) IS DELIBERATELY WEAK, and
# saying so is the point: the two expressions were already measured to agree on
# exactly these bytes, so running them side by side re-confirms a known result.
# It is kept as a regression tripwire, not offered as proof.
#
# SIX EDGE DIVERGENCES ARE ACCEPTED, NOT ASSERTED. The migrated parser is not
# byte-identical to the old one in general — it is better, and in each case the
# input required to tell them apart does not occur in the vendor file:
#
#   1. `-m1` — the library takes the first match; the old pipeline concatenated
#      every matching line.
#   2. Anchoring — the library requires `^Project`; the old grep matched the
#      substring anywhere on the line.
#   3. Colon required — the library returns "unknown" for a matching line with
#      no colon; the old pipeline passed the whole line through.
#   4. First vs last colon — `sed 's/.*: *//'` is greedy and strips to the LAST
#      colon; the library strips to the first (hw_profile.sh:70 documents why:
#      `Package Time` legitimately contains a second one).
#   5. Internal spaces — `tr -d ' '` deleted them anywhere in the value; the
#      library trims only leading and trailing whitespace.
#   6. Tabs — the old pipeline left a tab after the colon in place.
#
# A fixture exercising any of these would have to be hand-typed fiction, which
# is exactly what made the pre-Task-4 fixtures worthless. They are documented
# here and in the commit body instead.
#
# FIXTURE BYTES ARE REAL. Captured 2026-08-26 with
#   ssh <device> 'od -c /etc/quectel-project-version'
# on RM520N-GL (serial 61368cd2) and RG501Q-EU (serial b7e3d6f1). Note the
# alignment: `Project Rev :` carries a SPACE BEFORE THE COLON, and
# `Branch  Name:` / `Custom  Name:` carry TWO SPACES between the words.
# NEVER HAND-TYPE A FIXTURE FOR THIS FILE.

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fail=0
pass_count=0
fail_count=0

ok()  { printf '  PASS  %s\n' "$1"; pass_count=$((pass_count + 1)); }
bad() { printf '  FAIL  %s\n' "$1"; fail_count=$((fail_count + 1)); fail=1; }

section() { printf '\n== %s ==\n' "$1"; }

ABOUT="$REPO_ROOT/scripts/www/cgi-bin/quecmanager/device/about.sh"
HW_LIB="$REPO_ROOT/scripts/usr/lib/qmanager/hw_profile.sh"

[ -f "$ABOUT" ]  || { echo "FAIL: about.sh not found at $ABOUT" >&2; exit 1; }
[ -f "$HW_LIB" ] || { echo "FAIL: hw_profile.sh not found at $HW_LIB" >&2; exit 1; }

# make_version_file <path> <project_name> <project_rev> <branch_name>
# Reproduces the device byte layout exactly. Same helper as
# scripts/test/poller-data-used.sh — kept duplicated rather than shared,
# because a fixture generator that drifts silently between harnesses is worse
# than two copies that are each obviously wrong when they are wrong.
make_version_file() {
    printf 'Project Name: %s\nProject Rev : %s\nBranch  Name: %s\nCustom  Name: STD\nPackage Time: 2026-03-23,12:27\n' \
        "$2" "$3" "$4" > "$1"
}

# legacy_fw <version-file> — the PRE-MIGRATION expression from about.sh:113,
# with only the hardcoded /etc/quectel-project-version path parameterized so it
# can be pointed at a fixture. Nothing else about it is changed.
legacy_fw() {
    grep 'Project Rev' "$1" 2>/dev/null | sed 's/.*: *//' | tr -d ' \r'
}

qv_rm520n="$work/quectel_rm520n"
qv_rg501q="$work/quectel_rg501q"
make_version_file "$qv_rm520n" "RM520NGL_VC" "RM520NGLAAR03A03M4G_A0.304" "SDX6X"
make_version_file "$qv_rg501q" "RG501QEU_VD" "RG501QEUAAR12A11M4G_04.202" "SDX55"

# =====================================================================
# A. Extraction guards
#
# The behavioural tests below awk the function out of about.sh. An empty
# extract fails loudly (the function is simply undefined), but a TRUNCATED
# extract — a `}` reaching column 0 inside the body, or a `name ()` form with
# a space before the parens — can still parse and still print something. These
# two guards make that failure mode loud instead of silent.
# =====================================================================
section "the function can be extracted from about.sh"

FN="$work/fn_fw.sh"
awk '/^resolve_firmware_revision\(\)/,/^\}/' "$ABOUT" > "$FN"

if [ -s "$FN" ]; then
    ok "resolve_firmware_revision() extracted from about.sh"
else
    bad "resolve_firmware_revision() not found in about.sh (empty extract)"
fi

if grep -q 'qm_hw_fw_fingerprint' "$FN"; then
    ok "the extracted body calls qm_hw_fw_fingerprint"
else
    bad "the extracted body does not call qm_hw_fw_fingerprint (missing, or extract truncated)"
fi

# run_fw <version-file> — drive the extracted function with the library
# loaded, exactly as about.sh will at runtime.
run_fw() {
    (
        set +eu
        QUECTEL_VERSION_FILE="$1"
        . "$HW_LIB"
        . "$FN"
        resolve_firmware_revision
    ) 2>/dev/null || printf '<not defined>'
}

# raw_accessor <version-file> — the library accessor with no normalization,
# so the absence tests can prove the unmapping is doing real work.
raw_accessor() {
    (
        set +eu
        QUECTEL_VERSION_FILE="$1"
        . "$HW_LIB"
        qm_hw_fw_fingerprint
    ) 2>/dev/null
}

# =====================================================================
# B. Differential against the pre-migration expression, on real device bytes.
#    Weak by construction — see the header. Regression tripwire only.
# =====================================================================
section "real RM520N-GL bytes: migrated output matches the old expression"
new=$(run_fw "$qv_rm520n")
old=$(legacy_fw "$qv_rm520n")
if [ "$new" = "$old" ]; then
    ok "RM520N-GL differential holds ('$new')"
else
    bad "RM520N-GL differential BROKEN: new='$new' old='$old'"
fi
# Asserted literally as well, so that both expressions silently breaking the
# same way cannot show up as a passing differential.
if [ "$new" = "RM520NGLAAR03A03M4G_A0.304" ]; then
    ok "RM520N-GL literal value preserved"
else
    bad "RM520N-GL literal value changed: '$new'"
fi

section "real RG501Q-EU bytes: migrated output matches the old expression"
new=$(run_fw "$qv_rg501q")
old=$(legacy_fw "$qv_rg501q")
if [ "$new" = "$old" ]; then
    ok "RG501Q-EU differential holds ('$new')"
else
    bad "RG501Q-EU differential BROKEN: new='$new' old='$old'"
fi
if [ "$new" = "RG501QEUAAR12A11M4G_04.202" ]; then
    ok "RG501Q-EU literal value preserved"
else
    bad "RG501Q-EU literal value changed: '$new'"
fi

# =====================================================================
# C. Absence cases — the sentinel must never reach the wire.
#    These are the assertions that carry this harness.
# =====================================================================
section "vendor file absent -> empty string, not the sentinel"
qv_missing="$work/does_not_exist"
raw=$(raw_accessor "$qv_missing")
new=$(run_fw "$qv_missing")
if [ "$raw" = "unknown" ]; then
    ok "raw accessor returns the sentinel (so the unmapping below is load-bearing)"
else
    bad "raw accessor returned '$raw', expected 'unknown' — this test would pass vacuously"
fi
if [ "$new" = "" ]; then
    ok "resolve_firmware_revision -> '' when the vendor file is absent"
else
    bad "resolve_firmware_revision -> '$new', expected '' (the sentinel would render verbatim on the About page)"
fi

section "vendor file present but carrying no 'Project Rev' line -> empty string"
qv_norev="$work/quectel_norev"
printf 'Project Name: RM520NGL_VC\nBranch  Name: SDX6X\nCustom  Name: STD\nPackage Time: 2026-03-23,12:27\n' > "$qv_norev"
raw=$(raw_accessor "$qv_norev")
new=$(run_fw "$qv_norev")
if [ "$raw" = "unknown" ]; then
    ok "raw accessor returns the sentinel for a file with no Project Rev line"
else
    bad "raw accessor returned '$raw', expected 'unknown'"
fi
if [ "$new" = "" ]; then
    ok "resolve_firmware_revision -> '' when the line is missing"
else
    bad "resolve_firmware_revision -> '$new', expected ''"
fi

section "'Project Rev :' with an empty value -> empty string"
qv_empty="$work/quectel_empty"
printf 'Project Name: RM520NGL_VC\nProject Rev : \nBranch  Name: SDX6X\nCustom  Name: STD\nPackage Time: 2026-03-23,12:27\n' > "$qv_empty"
new=$(run_fw "$qv_empty")
old=$(legacy_fw "$qv_empty")
if [ "$new" = "" ]; then
    ok "empty value -> ''"
else
    bad "empty value -> '$new', expected ''"
fi
if [ "$new" = "$old" ]; then
    ok "empty-value differential holds"
else
    bad "empty-value differential BROKEN: new='$new' old='$old'"
fi

# =====================================================================
# D. hw_profile.sh not loaded — partial install, mid-OTA, rollback.
#
# TEST 2 OF THIS SECTION IS THE ONE THAT MATTERS. A fallback written as
# `exit 0` instead of `return 0` would terminate the whole CGI — and because
# cgi_headers has already run by then (about.sh:24), lighttpd would emit
# headers and a ZERO-LENGTH BODY. Every field on the About page dies, not just
# this one. The first assertion cannot see that: inside a command-substitution
# subshell, `exit 0` yields status 0 and empty stdout, which is exactly what a
# correct `return 0` yields. Only the sentinel echo distinguishes them.
# =====================================================================
section "hw_profile.sh not loaded -> empty string, and the CGI survives"
new=$(
    (
        set +eu
        . "$FN"
        resolve_firmware_revision
    ) 2>/dev/null
) || new='<nonzero exit>'
if [ "$new" = "" ]; then
    ok "resolve_firmware_revision -> '' when the accessor is undefined"
else
    bad "resolve_firmware_revision -> '$new', expected ''"
fi

reached=$(
    (
        set +eu
        . "$FN"
        resolve_firmware_revision >/dev/null
        printf 'REACHED'
    ) 2>/dev/null
)
if [ "$reached" = "REACHED" ]; then
    ok "the function RETURNS — execution continues past the call"
else
    bad "execution did NOT continue past the call (got '$reached') — an 'exit' in the fallback would blank the entire About response"
fi

# =====================================================================
# E. Wiring — text assertions over about.sh itself.
# =====================================================================
section "about.sh wiring"

if grep -q '/usr/lib/qmanager/hw_profile\.sh' "$ABOUT"; then
    ok "about.sh sources hw_profile.sh"
else
    bad "about.sh does not reference /usr/lib/qmanager/hw_profile.sh"
fi

# Whole-file greps, so they also cover the header comment block at
# about.sh:8,16 — which describes /etc/openwrt_release as a data source and
# has to be rewritten along with the code. A red result on a comment here is
# correct, not a false positive.
if grep -q "grep 'Project Rev'" "$ABOUT"; then
    bad "about.sh still hand-rolls a 'Project Rev' parser"
else
    ok "no hand-written 'Project Rev' parser remains in about.sh"
fi

if grep -q 'openwrt_release' "$ABOUT"; then
    bad "about.sh still references /etc/openwrt_release (code or header comment)"
else
    ok "the legacy /etc/openwrt_release branch is gone"
fi

if grep -q 'sys_openwrt=\$(resolve_firmware_revision)' "$ABOUT"; then
    ok "sys_openwrt is populated from resolve_firmware_revision"
else
    bad "sys_openwrt is not assigned from resolve_firmware_revision"
fi

# =====================================================================
printf '\n== summary ==\n'
printf '  %d passed, %d failed\n\n' "$pass_count" "$fail_count"
exit "$fail"
