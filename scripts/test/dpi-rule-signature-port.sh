#!/usr/bin/env bash
# Regression harness for DPI_RULE_SIG in scripts/usr/lib/qmanager/dpi_state.sh
# (F16, filed 2026-08-26 by the T3.5 installer-safety-auditor as a
# non-blocking design note).
#
# WHY THIS EXISTS
# ----------------
# DPI_RULE_SIG identifies the DPI engine's REDIRECT rule by its unique
# `--to-ports N` target (the RM520N kernel has no xt_comment module, so the
# rule can't carry -m comment). Before this fix it was a bare literal,
# "--to-ports 989", instead of being built from $DPI_PORT. If DPI_PORT ever
# changes, dpi_rule_present() keeps grepping for the OLD signature: the
# idempotence check misses, dpi_apply_rule's -D drain loop matches the NEW
# spec (nothing to drain), and its -I insert adds a SECOND REDIRECT rule
# instead of replacing the first — leaving the LAN with two REDIRECTs, one
# of them pointing at a dead port.
#
# This is executed behaviourally, not just grepped: dpi_state.sh has a
# double-source guard (_DPI_STATE_LOADED) and no `main "$@"` at the bottom
# (unlike install_rm520n.sh), so it CAN be sourced standalone and its
# variables inspected directly — no stub/fixture needed for this particular
# assertion.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DPI_STATE="$REPO_ROOT/scripts/usr/lib/qmanager/dpi_state.sh"

pass_count=0
fail_count=0

ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

[ -f "$DPI_STATE" ] || { echo "dpi_state.sh not found at $DPI_STATE" >&2; exit 1; }

printf '\n[1] DPI_RULE_SIG tracks DPI_PORT (behavioural)\n'

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

# A copy with DPI_PORT edited to a non-default value. Only the assignment
# line is touched — sed is scoped to the exact `DPI_PORT="989"` literal so a
# stray match elsewhere in the file can't produce a false pass.
sed 's/^DPI_PORT="989"$/DPI_PORT="7777"/' "$DPI_STATE" > "$TMPD/dpi_state_patched.sh"

if ! grep -qF 'DPI_PORT="7777"' "$TMPD/dpi_state_patched.sh"; then
    bad "sed did not patch DPI_PORT in the copy — harness setup is broken, not the fix"
else
    # Source in a subshell so DPI_PORT/DPI_RULE_SIG never leak into this
    # process, and so the harness survives a source-time failure cleanly.
    RESULT=$(bash -c '
        set -e
        DPI_HOSTLIST_DEFAULT=/dev/null
        . "'"$TMPD"'/dpi_state_patched.sh"
        printf "%s" "$DPI_RULE_SIG"
    ' 2>/dev/null || true)

    case "$RESULT" in
        "--to-ports 7777")
            ok "DPI_RULE_SIG interpolates the current DPI_PORT (got: $RESULT)" ;;
        "--to-ports 989")
            bad "DPI_RULE_SIG is still the hardcoded literal '--to-ports 989' after DPI_PORT changed to 7777 — the signature and the port have drifted apart" ;;
        *)
            bad "unexpected DPI_RULE_SIG after patching DPI_PORT: '$RESULT'" ;;
    esac
fi

printf '\n[2] dpi_rule_present() still detects via $DPI_RULE_SIG, not a re-hardcoded literal\n'

PRESENT_FN=$(awk '/^dpi_rule_present\(\) \{$/,/^\}$/' "$DPI_STATE")
if printf '%s' "$PRESENT_FN" | grep -qF '"$DPI_RULE_SIG"'; then
    ok "dpi_rule_present() greps for \$DPI_RULE_SIG (inherits the interpolated value)"
else
    bad "dpi_rule_present() no longer references \$DPI_RULE_SIG"
fi

printf '\n[3] syntax sanity\n'

if "${BASH:-bash}" -n "$DPI_STATE" 2>/dev/null; then
    ok "bash -n clean: $(basename "$DPI_STATE")"
else
    bad "bash -n FAILED: $(basename "$DPI_STATE")"
fi

printf '\n[dpi-rule-signature-port] %d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
