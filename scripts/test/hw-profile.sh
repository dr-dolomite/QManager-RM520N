#!/bin/bash
# Workstation fixture for scripts/usr/lib/qmanager/hw_profile.sh.
# Run from repo root:  bash scripts/test/hw-profile.sh
#
# Sources the library, repoints $QUECTEL_VERSION_FILE at each fixture, and
# asserts the parser, the tier table and the generator. No jq required — the
# library must work on a device that has none, so neither may this harness.
#
# ---------------------------------------------------------------------------
# FIXTURE PROVENANCE — every device fixture below is REAL DEVICE BYTES, base64
# round-tripped, never hand-typed. The vendor's labels are column-aligned in a
# way no one predicts correctly (`Project Rev :` has a space BEFORE the colon;
# `Branch  Name:` has TWO spaces between the words), and the pre-existing
# poller fixture in scripts/test/poller-data-used.sh:183 uses the OPPOSITE
# convention — `Branch Name      : SDX6X` — which exists on no hardware. That
# fiction is why the poller's one-space grep shipped broken and tested green.
#
# Capture commands, both run 2026-08-24:
#
#   RM520N-GL, over SSH:
#     base64 /etc/quectel-project-version
#     => UHJvamVjdCBOYW1lOiBSTTUyME5HTF9WQwpQcm9qZWN0IFJldiA6IFJNNTIwTkdMQUFSMDNBMDNN
#        NEdfQTAuMzA0CkJyYW5jaCAgTmFtZTogU0RYNlgKQ3VzdG9tICBOYW1lOiBTVEQKUGFja2FnZSBU
#        aW1lOiAyMDI2LTAzLTIzLDEyOjI3Cg==
#
#   RG501Q-EU, over adb (serial b7e3d6f1):
#     adb -s b7e3d6f1 shell 'base64 /etc/quectel-project-version'
#     => UHJvamVjdCBOYW1lOiBSRzUwMVFFVV9WRApQcm9qZWN0IFJldiA6IFJHNTAxUUVVQUFSMTJBMTFN
#        NEdfMDQuMjAyCkJyYW5jaCAgTmFtZTogU0RYNTUKQ3VzdG9tICBOYW1lOiBTVEQKUGFja2FnZSBU
#        aW1lOiAyMDI1LTAyLTIxLDEzOjQzCg==
#
# Both were cross-checked byte-for-byte with `od -c` on the device. The
# synthetic fixtures further down (legacy format, truncated, unknown SoC,
# non-Quectel) are deliberately NOT device captures — they model formats that
# no device produces, which is exactly what makes them worth testing.
# ---------------------------------------------------------------------------
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LIB="$REPO_ROOT/scripts/usr/lib/qmanager/hw_profile.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

pass_count=0
fail_count=0
ok()  { printf '  PASS  %s\n' "$1"; pass_count=$((pass_count + 1)); }
bad() { printf '  FAIL  %s\n' "$1" >&2; fail_count=$((fail_count + 1)); }
section() { printf '\n== %s ==\n' "$1"; }

if [ ! -f "$LIB" ]; then
    echo "FAIL: hw_profile.sh not found at $LIB" >&2
    exit 1
fi

# eq <label> <expected> <actual>
eq() {
    if [ "$2" = "$3" ]; then ok "$1"
    else bad "$1 (expected '$2', got '$3')"; fi
}

# --- Fixtures ----------------------------------------------------------------

# Real device bytes, decoded from the base64 recorded in the header above.
printf '%s' \
'UHJvamVjdCBOYW1lOiBSTTUyME5HTF9WQwpQcm9qZWN0IFJldiA6IFJNNTIwTkdMQUFSMDNBMDNNNEdfQTAuMzA0CkJyYW5jaCAgTmFtZTogU0RYNlgKQ3VzdG9tICBOYW1lOiBTVEQKUGFja2FnZSBUaW1lOiAyMDI2LTAzLTIzLDEyOjI3Cg==' \
    | base64 -d > "$work/rm520n" 2>/dev/null || {
        echo "SKIP: no working 'base64 -d' on PATH" >&2; exit 0; }

printf '%s' \
'UHJvamVjdCBOYW1lOiBSRzUwMVFFVV9WRApQcm9qZWN0IFJldiA6IFJHNTAxUUVVQUFSMTJBMTFNNEdfMDQuMjAyCkJyYW5jaCAgTmFtZTogU0RYNTUKQ3VzdG9tICBOYW1lOiBTVEQKUGFja2FnZSBUaW1lOiAyMDI1LTAyLTIxLDEzOjQzCg==' \
    | base64 -d > "$work/rg501q"

# Sanity-check the decode before trusting a single assertion built on it. A
# corrupted fixture would otherwise produce confident, wrong test results.
grep -q 'RM520NGL_VC' "$work/rm520n" || { echo "FAIL: rm520n fixture decode corrupt" >&2; exit 1; }
grep -q 'RG501QEU_VD' "$work/rg501q" || { echo "FAIL: rg501q fixture decode corrupt" >&2; exit 1; }

# Legacy harness convention: one space between the words, padding BEFORE the
# colon. The opposite alignment from every real device. The parser must handle
# it anyway so the existing poller fixtures keep working.
cat > "$work/legacy" <<'EOF'
Project Name    : RM520NGL_VC
Project Rev     : RM520NGLAAR03A03M4G_A0.304
Branch Name      : SDX6X
EOF

# Truncated: the file exists but the labels we need are absent.
printf 'Project Name: ' > "$work/truncated"

# Well-formed vendor file, model and SoC both outside anything we know.
cat > "$work/unknown_soc" <<'EOF'
Project Name: ZZ999XX_VA
Project Rev : ZZ999XXAAR01A01M4G_00.001
Branch  Name: SDX99
EOF

# Known SoC, model that is not a Quectel shape at all.
cat > "$work/known_soc_bad_model" <<'EOF'
Project Name: not-a-modem
Project Rev : whatever
Branch  Name: SDX55
EOF

# A model with JSON metacharacters. No device emits this; it proves the
# generator cannot be talked into producing invalid JSON.
cat > "$work/hostile" <<'EOF'
Project Name: RM520N"evil\x
Project Rev : RM520N"quoted\rev
Branch  Name: SD"X6X
EOF

# --- Driver ------------------------------------------------------------------
#
# Each case runs in its own subshell: the library sets a load guard
# (_HW_PROFILE_LOADED) and memoizes parsed values, so a fresh shell is the
# cleanest isolation. qm_hw_reset_cache() exists for in-process reuse and is
# exercised explicitly at the end.

# probe <fixture-path> — echo "model|soc|fw|form_factor|tier|variant"
probe() {
    (
        QUECTEL_VERSION_FILE="$1"
        export QUECTEL_VERSION_FILE
        # shellcheck disable=SC1090
        . "$LIB"
        printf '%s|%s|%s|%s|%s|%s' \
            "$(qm_hw_model)" "$(qm_hw_soc)" "$(qm_hw_fw_fingerprint)" \
            "$(qm_hw_form_factor)" "$(qm_hw_tier)" "$(qm_hw_variant)"
    )
}

section "RM520N-GL — real device bytes"
eq "rm520n identity" \
   'RM520NGL_VC|SDX6X|RM520NGLAAR03A03M4G_A0.304|m2|official|rm520n' \
   "$(probe "$work/rm520n")"

section "RG501Q-EU — real device bytes"
eq "rg501q identity" \
   'RG501QEU_VD|SDX55|RG501QEUAAR12A11M4G_04.202|lga|community|rg501q' \
   "$(probe "$work/rg501q")"
# Guard the one value most likely to be "helpfully" corrected later.
case "$(probe "$work/rg501q")" in
    *'|official|'*) bad "rg501q tier must be community in Phase A, never official" ;;
    *'|community|'*) ok "rg501q tier is community, not official (Phase A rule)" ;;
esac

section "Legacy fixture format (padding before the colon)"
eq "legacy soc parses" 'SDX6X' "$(probe "$work/legacy" | cut -d'|' -f2)"
eq "legacy model parses" 'RM520NGL_VC' "$(probe "$work/legacy" | cut -d'|' -f1)"

section "Degenerate inputs"
eq "absent file"    'unknown|unknown|unknown|unknown|fallback|default' \
                    "$(probe "$work/does_not_exist")"
eq "truncated file" 'unknown|unknown|unknown|unknown|fallback|default' \
                    "$(probe "$work/truncated")"
# `ZZ999XX_VA` is well-formed in the file but is not a Quectel model shape, so
# the model axis reports unknown while fw_fingerprint is still returned verbatim
# — the fingerprint is a staleness key, not an identity claim, and self-heal
# needs it even on hardware we cannot name.
eq "unknown SoC and model" 'unknown|SDX99|ZZ999XXAAR01A01M4G_00.001|unknown|fallback|default' \
                    "$(probe "$work/unknown_soc")"
eq "known SoC, unrecognized model -> community" \
                    'unknown|SDX55|whatever|unknown|community|default' \
                    "$(probe "$work/known_soc_bad_model")"

section "Generator"
gen() {
    (
        QUECTEL_VERSION_FILE="$1"
        export QUECTEL_VERSION_FILE
        # shellcheck disable=SC1090
        . "$LIB"
        qm_hw_write_profile "$2"
    )
}

# stderr is discarded here on purpose: the shell reports the failed redirect
# itself, before the library's own 2>/dev/null can apply. That message is the
# expected outcome of this case, not a problem to surface.
gen "$work/rm520n" "$work/out/platform.json" 2>/dev/null \
    && bad "write into a missing parent dir must fail" \
    || ok "write into a missing parent dir returns non-zero"
[ -e "$work/out/platform.json.tmp" ] \
    && bad "failed write left a temp file behind" \
    || ok "failed write leaves no temp file"

mkdir -p "$work/out"
if gen "$work/rm520n" "$work/out/platform.json"; then
    ok "write succeeds into an existing dir"
else
    bad "write failed into an existing dir"
fi

expected_json=$(cat <<'EOF'
{
  "schema": 1,
  "model": "RM520NGL_VC",
  "soc": "SDX6X",
  "form_factor": "m2",
  "tier": "official",
  "fw_fingerprint": "RM520NGLAAR03A03M4G_A0.304",
  "caps": {}
}
EOF
)
eq "emitted JSON is exactly the schema-1 shape" "$expected_json" "$(cat "$work/out/platform.json")"
[ -e "$work/out/platform.json.tmp" ] \
    && bad "successful write left a temp file behind" \
    || ok "successful write leaves no temp file"

# The temp file must be a SIBLING of the destination — mktemp would put it in
# /tmp, and /tmp is tmpfs while /etc is ubi2_0, so the mv would hit EXDEV.
grep -q 'tmp="${dest}.tmp"' "$LIB" \
    && ok "temp file is same-directory, not mktemp" \
    || bad "generator no longer uses a same-directory temp file"

gen "$work/hostile" "$work/out/hostile.json" >/dev/null 2>&1 || true
if command -v jq >/dev/null 2>&1; then
    jq -e . "$work/out/hostile.json" >/dev/null 2>&1 \
        && ok "hostile vendor values still produce parseable JSON" \
        || bad "hostile vendor values produced invalid JSON"
    jq -e . "$work/out/platform.json" >/dev/null 2>&1 \
        && ok "emitted profile parses as JSON" \
        || bad "emitted profile is not valid JSON"
else
    printf '  SKIP  JSON validity (no jq on PATH; library itself needs none)\n'
fi

# Symlink capability probe. Some Windows Git Bash sessions cannot create a
# real symlink at all (no SeCreateSymbolicLinkPrivilege / Developer Mode
# off): `ln -s` there either silently HARD-COPIES the target's bytes (which
# makes an attack-simulation test meaningless -- there is no link to detect)
# or fails outright for a dangling target. Detected once, here, so the
# symlink-dependent assertions below can SKIP with an honest message on such
# a host instead of reporting a false PASS or FAIL for a mechanism that was
# never actually exercised. This mirrors the file's existing `base64 -d` and
# `jq` capability probes.
HAVE_SYMLINKS=0
mkdir -p "$work/symprobe"
printf 'probe\n' > "$work/symprobe/target"
ln -s "$work/symprobe/target" "$work/symprobe/link" 2>/dev/null
[ -L "$work/symprobe/link" ] && HAVE_SYMLINKS=1

section "Symlink safety (qm_hw_write_profile)"
# These exercise the actual mechanism -- real symlinks on disk, real
# subsequent reads to confirm nothing was touched -- not a grep over the
# source. www-data owns /etc/qmanager (0755, non-sticky, so
# fs.protected_symlinks=1 does not cover it) and can plant any of these.

if [ "$HAVE_SYMLINKS" -eq 1 ]; then
    # --- .tmp path is a symlink to an existing scratch file ---
    mkdir -p "$work/sym1"
    printf 'scratch-original\n' > "$work/sym1/scratch"
    ln -s "$work/sym1/scratch" "$work/sym1/platform.json.tmp"
    gen "$work/rm520n" "$work/sym1/platform.json" 2>/dev/null \
        && bad "write must refuse when .tmp path is a symlink to an existing file" \
        || ok "write refuses when .tmp path is a symlink to an existing file"
    eq "symlink-pointed scratch file untouched by refused write" \
       "scratch-original" "$(cat "$work/sym1/scratch")"
    [ -L "$work/sym1/platform.json.tmp" ] \
        && ok "the .tmp symlink itself is left in place, not deleted (evidence preserved)" \
        || bad "the .tmp symlink was deleted by the refused write"
    [ -e "$work/sym1/platform.json" ] \
        && bad "refused write still created the destination file" \
        || ok "refused write created no destination file"

    # --- .tmp path is a DANGLING symlink (target does not exist) ---
    mkdir -p "$work/sym2"
    ln -s "$work/sym2/nonexistent_target" "$work/sym2/platform.json.tmp"
    gen "$work/rm520n" "$work/sym2/platform.json" 2>/dev/null \
        && bad "write must refuse when .tmp path is a dangling symlink" \
        || ok "write refuses when .tmp path is a dangling symlink"
    [ -e "$work/sym2/nonexistent_target" ] \
        && bad "dangling symlink's target was created by the refused write" \
        || ok "dangling symlink's target was not created"

    # --- destination itself is a symlink ---
    mkdir -p "$work/sym3"
    printf 'dest-target-original\n' > "$work/sym3/real_target"
    ln -s "$work/sym3/real_target" "$work/sym3/platform.json"
    gen "$work/rm520n" "$work/sym3/platform.json" 2>/dev/null \
        && bad "write must refuse when the destination itself is a symlink" \
        || ok "write refuses when the destination itself is a symlink"
    eq "symlinked destination's real target left untouched" \
       "dest-target-original" "$(cat "$work/sym3/real_target")"
else
    printf '  SKIP  .tmp-path-is-a-symlink (this host cannot create real symlinks)\n'
    printf '  SKIP  .tmp-path-is-a-dangling-symlink (this host cannot create real symlinks)\n'
    printf '  SKIP  destination-itself-is-a-symlink (this host cannot create real symlinks)\n'
fi

# --- destination itself is a directory (no symlink involved) ---
mkdir -p "$work/sym4/platform.json"
gen "$work/rm520n" "$work/sym4/platform.json" 2>/dev/null \
    && bad "write must refuse when the destination is a directory" \
    || ok "write refuses when the destination is a directory"
[ "$(ls -A "$work/sym4/platform.json" 2>/dev/null)" ] \
    && bad "refused directory-destination write left something inside the directory" \
    || ok "refused directory-destination write created nothing inside it"

# --- stranded REGULAR .tmp file from a "previous crash" ---
mkdir -p "$work/crash"
printf 'stale partial write from a crashed run\n' > "$work/crash/platform.json.tmp"
if gen "$work/rm520n" "$work/crash/platform.json"; then
    ok "write recovers past a stranded regular .tmp file"
else
    bad "write did not recover past a stranded regular .tmp file"
fi
[ -e "$work/crash/platform.json.tmp" ] \
    && bad "stranded-temp recovery left a temp file behind" \
    || ok "stranded-temp recovery leaves no temp file"

# --- deterministic mode 0644 regardless of the caller's umask ---
mkdir -p "$work/mode"
( umask 000; gen "$work/rm520n" "$work/mode/platform.json" ) >/dev/null 2>&1
if command -v stat >/dev/null 2>&1 && stat -c %a "$work/mode/platform.json" >/dev/null 2>&1; then
    eq "emitted file is mode 0644 even at umask 0 (via stat)" \
       "644" "$(stat -c %a "$work/mode/platform.json")"
else
    # No GNU-style `stat -c` on this workstation (e.g. some BSD/BusyBox
    # builds) -- fall back to parsing the permission string out of `ls -l`.
    # Only the rwx triads are checked; the leading file-type character
    # ('-') is stripped first.
    perm_str=$(ls -l "$work/mode/platform.json" | awk '{print $1}' | cut -c2-10)
    case "$perm_str" in
        rw-r--r--) ok "emitted file is mode 0644 even at umask 0 (via ls -l, no stat on PATH)" ;;
        *) bad "emitted file mode is not 0644 (ls -l perms: $perm_str)" ;;
    esac
fi

section "No stale state between reads"
# Accessors must re-read the file every call, with no memoization. This is what
# lets the self-heal path compare a LIVE firmware fingerprint against the one
# recorded in platform.json — a cached pre-reflash value is precisely the bug
# that path exists to catch.
(
    QUECTEL_VERSION_FILE="$work/rm520n"; export QUECTEL_VERSION_FILE
    # shellcheck disable=SC1090
    . "$LIB"
    first=$(qm_hw_model)
    QUECTEL_VERSION_FILE="$work/rg501q"
    second=$(qm_hw_model)
    [ "$first" = "RM520NGL_VC" ]  || { echo "  first read wrong: $first" >&2; exit 1; }
    [ "$second" = "RG501QEU_VD" ] || { echo "  second read stale: $second" >&2; exit 1; }
) && ok "a repointed version file is picked up immediately (no cache)" \
  || bad "accessor returned a stale value after the version file changed"

if grep -q '_QM_HW_MODEL\|_QM_HW_SOC\|_QM_HW_FW\|qm_hw_reset_cache' "$LIB"; then
    bad "memoization reintroduced — see the NO MEMOIZATION note in the library"
else
    ok "no memo variables in the library"
fi

section "Name-collision guard"
if grep -q 'hw_profile\|Project Name\|Branch' "$REPO_ROOT/scripts/usr/lib/qmanager/platform.sh"; then
    bad "platform.sh (init-system abstraction) contains hardware identity logic"
else
    ok "platform.sh untouched — no hardware identity logic leaked into it"
fi

section "No jq dependency in the library"
# Strip comment lines first: the file's own header explains at length WHY it
# must not use jq, and a naive word-grep would flag that prose forever.
if sed 's/#.*$//' "$LIB" | grep -q '\bjq\b'; then
    bad "hw_profile.sh invokes jq — qmanager_setup and the RG501Q have none"
else
    ok "hw_profile.sh has no jq dependency (comments excluded)"
fi

printf '
%d passed, %d failed
' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ]
