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

# ---------------------------------------------------------------------------
# Self-heal: qm_hw_profile_needs_write / qm_hw_self_heal
#
# Each case gets its OWN directory and its OWN QM_HW_LOG_FILE under $work.
# That is deliberate isolation, not just tidiness: without a per-case log,
# the "self_heal logs nothing on the every-boot no-op path" assertion below
# would be contaminated by every earlier case's log lines, and reusing the
# real /tmp/qmanager.log on a developer's own machine would append harness
# noise into it. QM_HW_LOG_FILE is overridable for exactly this reason (see
# hw_profile.sh) — the same pattern QUECTEL_VERSION_FILE already uses.
# ---------------------------------------------------------------------------

# needs_write_check <version-file> <profile-path> <log-file> — exit status
# mirrors qm_hw_profile_needs_write (0 = regenerate, 1 = leave alone).
needs_write_check() {
    (
        QUECTEL_VERSION_FILE="$1"; export QUECTEL_VERSION_FILE
        QM_HW_LOG_FILE="$3"; export QM_HW_LOG_FILE
        # shellcheck disable=SC1090
        . "$LIB"
        qm_hw_profile_needs_write "$2"
    )
}

# self_heal_run <version-file> <profile-path> <log-file> — exit status
# mirrors qm_hw_self_heal.
self_heal_run() {
    (
        QUECTEL_VERSION_FILE="$1"; export QUECTEL_VERSION_FILE
        QM_HW_LOG_FILE="$3"; export QM_HW_LOG_FILE
        # shellcheck disable=SC1090
        . "$LIB"
        qm_hw_self_heal "$2"
    )
}

section "Self-heal: absent profile"
d="$work/heal/absent"; mkdir -p "$d"; log="$d/qmanager.log"; : > "$log"
needs_write_check "$work/rm520n" "$d/platform.json" "$log" \
    && ok "needs_write: absent profile -> regenerate" \
    || bad "needs_write: absent profile should say regenerate"
self_heal_run "$work/rm520n" "$d/platform.json" "$log" \
    && ok "self_heal on an absent profile returns success" \
    || bad "self_heal on an absent profile should return success"
[ -f "$d/platform.json" ] \
    && ok "self_heal created the absent profile" \
    || bad "self_heal did not create the absent profile"
needs_write_check "$work/rm520n" "$d/platform.json" "$log" \
    && bad "profile did not converge after self_heal (absent case)" \
    || ok "profile converges after self_heal (absent case)"

section "Self-heal: schema downgrade (schema: 0)"
d="$work/heal/schema_low"; mkdir -p "$d"; log="$d/qmanager.log"; : > "$log"
cat > "$d/platform.json" <<'EOF'
{
  "schema": 0,
  "model": "RM520NGL_VC",
  "soc": "SDX6X",
  "form_factor": "m2",
  "tier": "official",
  "fw_fingerprint": "RM520NGLAAR03A03M4G_A0.304",
  "caps": {}
}
EOF
needs_write_check "$work/rm520n" "$d/platform.json" "$log" \
    && ok "needs_write: schema 0 (lower than current) -> regenerate" \
    || bad "needs_write: schema downgrade should say regenerate"

section "Self-heal: schema higher than current (schema: 99)"
# Deliberate policy, not a bug: platform.json lives in a www-data-writable
# directory, so a planted higher schema must not be able to freeze the
# profile permanently by looking "already migrated".
d="$work/heal/schema_high"; mkdir -p "$d"; log="$d/qmanager.log"; : > "$log"
cat > "$d/platform.json" <<'EOF'
{
  "schema": 99,
  "model": "RM520NGL_VC",
  "soc": "SDX6X",
  "form_factor": "m2",
  "tier": "official",
  "fw_fingerprint": "RM520NGLAAR03A03M4G_A0.304",
  "caps": {}
}
EOF
needs_write_check "$work/rm520n" "$d/platform.json" "$log" \
    && ok "needs_write: schema 99 (higher than current) -> regenerate" \
    || bad "needs_write: schema-higher should still regenerate, not freeze"

section "Self-heal: fw_fingerprint drift"
d="$work/heal/fw_drift"; mkdir -p "$d"; log="$d/qmanager.log"; : > "$log"
cat > "$d/platform.json" <<'EOF'
{
  "schema": 1,
  "model": "RM520NGL_VC",
  "soc": "SDX6X",
  "form_factor": "m2",
  "tier": "official",
  "fw_fingerprint": "SOME_OTHER_FIRMWARE_BUILD",
  "caps": {}
}
EOF
needs_write_check "$work/rm520n" "$d/platform.json" "$log" \
    && ok "needs_write: fw_fingerprint drift -> regenerate" \
    || bad "needs_write: fw_fingerprint drift should say regenerate"
self_heal_run "$work/rm520n" "$d/platform.json" "$log" \
    && ok "self_heal succeeds healing a drifted fingerprint" \
    || bad "self_heal should succeed healing a drifted fingerprint"
eq "self_heal corrected the drifted fingerprint to the live value" \
   '  "fw_fingerprint": "RM520NGLAAR03A03M4G_A0.304",' \
   "$(grep '"fw_fingerprint"' "$d/platform.json")"

section "Self-heal: matching profile is left alone (every-boot no-op)"
d="$work/heal/matching"; mkdir -p "$d"; log="$d/qmanager.log"; : > "$log"
gen "$work/rm520n" "$d/platform.json" >/dev/null
before_content=$(cat "$d/platform.json")
before_inode=$(ls -i "$d/platform.json" | awk '{print $1}')
needs_write_check "$work/rm520n" "$d/platform.json" "$log" \
    && bad "needs_write: matching profile should say leave alone" \
    || ok "needs_write: matching profile says leave alone"
self_heal_run "$work/rm520n" "$d/platform.json" "$log" \
    && ok "self_heal on a matching profile returns success" \
    || bad "self_heal on a matching profile should return success"
eq "self_heal left a matching profile's content byte-for-byte untouched" \
   "$before_content" "$(cat "$d/platform.json")"
after_inode=$(ls -i "$d/platform.json" | awk '{print $1}')
eq "self_heal left a matching profile's inode untouched (no rewrite happened)" \
   "$before_inode" "$after_inode"
[ -s "$log" ] \
    && bad "self_heal logged something on the silent every-boot no-op path" \
    || ok "self_heal logged nothing on the every-boot no-op path"

section "Self-heal: compact single-line JSON converges after one call"
# The line-oriented matcher cannot see a compact JSON schema key at all, so
# it reads as "schema absent" and regenerates ONCE. This is the regression
# test for rewrite-every-boot: the regenerated file is always written in
# this library's own line-oriented format, so a SECOND read must converge.
d="$work/heal/compact"; mkdir -p "$d"; log="$d/qmanager.log"; : > "$log"
printf '{"schema":1,"model":"RM520NGL_VC","soc":"SDX6X","form_factor":"m2","tier":"official","fw_fingerprint":"RM520NGLAAR03A03M4G_A0.304","caps":{}}' \
    > "$d/platform.json"
needs_write_check "$work/rm520n" "$d/platform.json" "$log" \
    && ok "needs_write: compact single-line JSON reads as schema-absent -> regenerate" \
    || bad "needs_write: compact JSON should have regenerated (line-matcher limitation)"
self_heal_run "$work/rm520n" "$d/platform.json" "$log" \
    && ok "self_heal succeeds rewriting compact JSON into the line-oriented format" \
    || bad "self_heal should succeed rewriting compact JSON into the line-oriented format"
needs_write_check "$work/rm520n" "$d/platform.json" "$log" \
    && bad "REGRESSION: compact-JSON profile did not converge after one self_heal call -- would rewrite every boot forever" \
    || ok "compact-JSON profile converges after exactly one self_heal call"

section "Self-heal: truncated / zero-byte / non-numeric schema"
d="$work/heal/truncated"; mkdir -p "$d"; log="$d/qmanager.log"; : > "$log"
printf '{\n  "schema": ' > "$d/platform.json"
needs_write_check "$work/rm520n" "$d/platform.json" "$log" \
    && ok "needs_write: truncated profile -> regenerate" \
    || bad "needs_write: truncated profile should regenerate"
self_heal_run "$work/rm520n" "$d/platform.json" "$log" \
    && ok "self_heal recovers a truncated profile" \
    || bad "self_heal should recover a truncated profile"
needs_write_check "$work/rm520n" "$d/platform.json" "$log" \
    && bad "truncated-profile recovery did not converge" \
    || ok "truncated-profile recovery converges"

d="$work/heal/zerobyte"; mkdir -p "$d"; log="$d/qmanager.log"; : > "$log"
: > "$d/platform.json"
needs_write_check "$work/rm520n" "$d/platform.json" "$log" \
    && ok "needs_write: zero-byte profile -> regenerate" \
    || bad "needs_write: zero-byte profile should regenerate"
self_heal_run "$work/rm520n" "$d/platform.json" "$log" \
    && ok "self_heal recovers a zero-byte profile" \
    || bad "self_heal should recover a zero-byte profile"
needs_write_check "$work/rm520n" "$d/platform.json" "$log" \
    && bad "zero-byte-profile recovery did not converge" \
    || ok "zero-byte-profile recovery converges"

d="$work/heal/schema_string"; mkdir -p "$d"; log="$d/qmanager.log"; : > "$log"
cat > "$d/platform.json" <<'EOF'
{
  "schema": "1",
  "model": "RM520NGL_VC",
  "soc": "SDX6X",
  "form_factor": "m2",
  "tier": "official",
  "fw_fingerprint": "RM520NGLAAR03A03M4G_A0.304",
  "caps": {}
}
EOF
needs_write_check "$work/rm520n" "$d/platform.json" "$log" \
    && ok 'needs_write: quoted-string schema ("1") -> regenerate' \
    || bad "needs_write: non-numeric schema should regenerate, not error out"
self_heal_run "$work/rm520n" "$d/platform.json" "$log" \
    && ok "self_heal recovers a non-numeric-schema profile" \
    || bad "self_heal should recover a non-numeric-schema profile"
needs_write_check "$work/rm520n" "$d/platform.json" "$log" \
    && bad "non-numeric-schema recovery did not converge" \
    || ok "non-numeric-schema recovery converges"

section "Self-heal: symlink at the profile path is refused, never touched"
if [ "$HAVE_SYMLINKS" -eq 1 ]; then
    d="$work/heal/symlink_profile"; mkdir -p "$d"; log="$d/qmanager.log"; : > "$log"
    printf 'symlink-target-original\n' > "$d/real_profile"
    ln -s "$d/real_profile" "$d/platform.json"
    needs_write_check "$work/rm520n" "$d/platform.json" "$log" \
        && bad "needs_write must refuse when the profile path is a symlink" \
        || ok "needs_write refuses when the profile path is a symlink"
    eq "symlinked profile's real target left untouched by needs_write" \
       "symlink-target-original" "$(cat "$d/real_profile")"
    self_heal_run "$work/rm520n" "$d/platform.json" "$log" \
        && ok "self_heal returns success (nothing-to-do) over a symlinked profile path" \
        || bad "self_heal must return success (nothing-to-do) over a symlinked profile path"
    eq "symlinked profile's real target left untouched by self_heal" \
       "symlink-target-original" "$(cat "$d/real_profile")"
    grep -q 'refusing to touch' "$log" \
        && ok "refusal over a symlinked profile path was logged" \
        || bad "refusal over a symlinked profile path was NOT logged"
else
    printf '  SKIP  symlink-at-profile-path (this host cannot create real symlinks)\n'
fi

section "Self-heal: directory at the profile path is refused, never written into"
d="$work/heal/dir_profile"; mkdir -p "$d/platform.json"; log="$d/qmanager.log"; : > "$log"
needs_write_check "$work/rm520n" "$d/platform.json" "$log" \
    && bad "needs_write must refuse when the profile path is a directory" \
    || ok "needs_write refuses when the profile path is a directory"
self_heal_run "$work/rm520n" "$d/platform.json" "$log" \
    && ok "self_heal returns success (nothing-to-do) over a directory profile path" \
    || bad "self_heal must return success (nothing-to-do) over a directory profile path"
[ "$(ls -A "$d/platform.json" 2>/dev/null)" ] \
    && bad "self_heal wrote something inside the directory at the profile path" \
    || ok "self_heal wrote nothing inside the directory at the profile path"

section "Self-heal: unreadable vendor file defers, never clobbers a good profile"
d="$work/heal/vendor_unreadable"; mkdir -p "$d"; log="$d/qmanager.log"; : > "$log"
cat > "$d/platform.json" <<'EOF'
{
  "schema": 1,
  "model": "RM520NGL_VC",
  "soc": "SDX6X",
  "form_factor": "m2",
  "tier": "official",
  "fw_fingerprint": "SOME_OTHER_FIRMWARE_BUILD",
  "caps": {}
}
EOF
before_content=$(cat "$d/platform.json")
# "Vendor file unreadable" is modeled as a NONEXISTENT path rather than a
# chmod-0000 file: chmod-based unreadability is not portable to this
# workstation harness (a Windows Git Bash session can run with permissions
# that ignore a 0000 mode), and a missing file already puts _qm_hw_field's
# `[ -r ]` guard into exactly the same "cannot read" state a genuinely
# unreadable file would. Synthetic, not a device capture; the real-world
# case it models is a vendor file that exists but is unreadable for some
# other reason (bad mode, unmounted overlay, ...).
needs_write_check "$d/does_not_exist_vendor_file" "$d/platform.json" "$log" \
    && bad "needs_write must NOT regenerate over a good profile when the vendor file is unreadable" \
    || ok "needs_write defers regeneration when the vendor file is unreadable"
eq "deferred (needs_write): existing profile content is completely untouched" \
   "$before_content" "$(cat "$d/platform.json")"
grep -q 'DEFERRED' "$log" \
    && ok "deferred regeneration was logged, naming the trigger" \
    || bad "deferred regeneration was NOT logged"
self_heal_run "$d/does_not_exist_vendor_file" "$d/platform.json" "$log" \
    && ok "self_heal returns success (nothing-to-do) on a deferred profile" \
    || bad "self_heal must return success (nothing-to-do) on a deferred profile"
eq "deferred (self_heal): existing profile content is completely untouched" \
   "$before_content" "$(cat "$d/platform.json")"

section "Self-heal: hostile-fixture round-trip pins the escaper/extractor coupling"
# If anyone changes _qm_hw_json_escape without updating the line matchers
# above (or vice versa), THIS is the assertion that catches it -- otherwise
# every hostile-valued fielded device would silently regenerate its profile
# on every single boot forever.
d="$work/heal/hostile_roundtrip"; mkdir -p "$d"; log="$d/qmanager.log"; : > "$log"
gen "$work/hostile" "$d/platform.json" >/dev/null 2>&1
needs_write_check "$work/hostile" "$d/platform.json" "$log" \
    && bad "hostile-fixture profile did not round-trip -- would rewrite every boot on real hardware" \
    || ok "hostile-fixture profile round-trips: needs_write immediately says leave alone"

section "Caller contract (qmanager_setup)"
SETUP="$REPO_ROOT/scripts/usr/bin/qmanager_setup"
if [ -f "$SETUP" ]; then
    grep -q '/usr/lib/qmanager/hw_profile\.sh' "$SETUP" \
        && ok "qmanager_setup sources hw_profile.sh" \
        || bad "qmanager_setup does not source hw_profile.sh"
    grep -q 'qm_hw_self_heal' "$SETUP" \
        && ok "qmanager_setup calls qm_hw_self_heal" \
        || bad "qmanager_setup does not call qm_hw_self_heal"
    if sed 's/#.*$//' "$SETUP" | grep -q '\bjq\b'; then
        bad "qmanager_setup invokes jq — it has no PATH to /opt at boot"
    else
        ok "qmanager_setup has no jq dependency (comments excluded)"
    fi
    heal_line=$(grep -n 'qm_hw_self_heal ' "$SETUP" | head -n 1 | cut -d: -f1)
    chown_line=$(grep -n 'chown -R www-data:www-data /etc/qmanager' "$SETUP" | head -n 1 | cut -d: -f1)
    if [ -n "$heal_line" ] && [ -n "$chown_line" ] && [ "$heal_line" -lt "$chown_line" ]; then
        ok "qm_hw_self_heal call appears before the recursive /etc/qmanager chown"
    else
        bad "qm_hw_self_heal call does not appear before the recursive /etc/qmanager chown (heal=$heal_line chown=$chown_line)"
    fi
else
    bad "qmanager_setup not found at $SETUP"
fi

printf '\n%d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ]
