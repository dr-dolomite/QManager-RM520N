#!/usr/bin/env bash
# Regression harness for run-all.sh's CRLF detector (F18, Phase A tracker).
#
# WHY THIS EXISTS
# ----------------
# The detector reported CRLF on ~211 files — essentially every script in the
# tree — while a byte count (`tr -cd '\r' | wc -c`) said every one of them had
# ZERO CR bytes. A warning that fires on everything is a warning nobody reads,
# and it hides the one real CRLF file it exists to catch.
#
# ROOT CAUSE (measured 2026-08-30, bash 5.2.37 / GNU grep 3.0):
#   $ printf '[%s]' $'\r' | od -c            ->  [  \r  ]     (a real CR)
#   $ echo "$( printf '[%s]' $'\r' )" | od -c ->  [     ]     (EMPTY)
# Inside a command substitution bash re-parses the body, and the raw CR is
# consumed as line whitespace during that re-parse. run-all.sh builds its file
# list as `crlf_files=$( { ... } | sort -u )`, so all three sub-loops inside
# that substitution hand grep an EMPTY PATTERN — which matches every line of
# every file. A CR carried in via a variable (`CR=$(printf '\r')`) survives,
# because it arrives by expansion AFTER parsing. That is the form
# .claude/check-crlf.sh has always used, and it reports zero on the same tree.
#
# Same defect family as F1/F5/F6/F16: a check that cannot distinguish the
# condition from its negation.
#
# Behavioural, and BOTH directions. [1] pins the false positive. [2] plants a
# genuinely CRLF file in each of the three sub-loops' territories, because a
# detector rewritten into "always say OK" would pass [1] perfectly while being
# just as broken.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"
RUN_ALL="scripts/test/run-all.sh"

pass_count=0
fail_count=0
ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

[ -f "$RUN_ALL" ] || { echo "run-all.sh not found at $RUN_ALL" >&2; exit 1; }

# The three fixture paths, one per sub-loop in run-all.sh's detector block:
#   glob include '*.sh'      -> scripts/test/
#   scripts/usr/bin/* loop   -> extension-less, needs a shebang for `bash -n`
#   sudoers.d find loop      -> scripts/etc/sudoers.d/
# NB: non-dot names on purpose. `for f in scripts/usr/bin/*` does not glob
# dotfiles, so a .crlf-fixture there would be silently skipped and [2] would
# report a defect that is really an artefact of the fixture's own name.
FIX_SH="scripts/test/zz_crlf_fixture.sh"
FIX_BIN="scripts/usr/bin/zz_crlf_fixture"
FIX_SUDO="scripts/etc/sudoers.d/zz_crlf_fixture"

cleanup() { rm -f "$FIX_SH" "$FIX_BIN" "$FIX_SUDO"; }
trap cleanup EXIT INT TERM
cleanup

# Extract just the CRLF section of run-all.sh's output. run-all.sh is the real
# gate script and it is run here unmodified — no reimplementation of its logic,
# which is the whole point.
crlf_section() {
    bash "$RUN_ALL" 2>&1 | sed -n '/== CRLF check/,$p'
}

printf '\n[1] a clean tree reports OK (the F18 false positive)\n'

# Independent ground truth, built the way check-crlf.sh does it: count CR
# bytes over the same file set, without going near grep or $'\r'.
real_crlf=0
while IFS= read -r f; do
    [ -f "$f" ] || continue
    [ "$(tr -cd '\r' < "$f" | wc -c | tr -d ' ')" -eq 0 ] || real_crlf=$((real_crlf + 1))
done < <(
    {
        find scripts -type f \( -name '*.sh' -o -name '*.service' -o -name '*.rules' \)
        find scripts/usr/bin -maxdepth 1 -type f
        find scripts -path '*/sudoers.d/*' -type f
    } 2>/dev/null | sort -u
)

if [ "$real_crlf" -ne 0 ]; then
    bad "skipped — the tree really does contain $real_crlf CRLF file(s); fix those first"
else
    SECTION=$(crlf_section)
    if printf '%s\n' "$SECTION" | grep -q 'OK   no CRLF detected'; then
        ok "clean tree reports OK (0 CR bytes measured independently)"
    else
        WARNED=$(printf '%s\n' "$SECTION" | sed -n 's/.*WARN \([0-9]*\) file(s).*/\1/p')
        bad "detector flagged ${WARNED:-?} file(s) on a tree with 0 CR bytes — this is F18: an empty grep pattern matching every line of every file, so a real CRLF file is indistinguishable from the noise"
    fi
fi

printf '\n[2] a genuine CRLF file is still caught, in each of the three sub-loops\n'

# Written with printf so the CRs are unambiguous, and valid shell so the
# `bash -n` stage of run-all.sh still passes and we reach the CRLF stage.
plant() { printf '#!/bin/sh\r\n: crlf fixture\r\n' > "$1"; }

check_caught() {
    local label="$1" path="$2"
    cleanup
    plant "$path"
    if [ "$(tr -cd '\r' < "$path" | wc -c | tr -d ' ')" -eq 0 ]; then
        bad "$label — fixture did not actually get CR bytes; harness bug"
        return
    fi
    if crlf_section | grep -q -- "$path"; then
        ok "$label — real CRLF file is reported"
    else
        bad "$label — a genuinely CRLF file at $path was NOT reported; the detector cannot see the thing it exists to catch"
    fi
}

check_caught "include-glob sub-loop"    "$FIX_SH"
check_caught "scripts/usr/bin sub-loop" "$FIX_BIN"
check_caught "sudoers.d sub-loop"       "$FIX_SUDO"

cleanup

printf '\n[crlf-detector-accuracy] %d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
