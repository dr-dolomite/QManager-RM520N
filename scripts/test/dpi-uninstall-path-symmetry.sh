#!/usr/bin/env bash
# Regression harness for Traffic Engine uninstall-path symmetry (F19).
#
# WHY THIS EXISTS
# ----------------
# The Traffic Engine has TWO uninstall paths, and they used to drain
# different iptables chains:
#
#   UI path      qmanager_dpi_install uninstall -> _dpi_uninstall_run
#                (inlined `iptables -D` calls)
#   device path  uninstall_rm520n.sh -> qmanager_dpi_run --clear
#                -> dpi_state.sh's dpi_remove_rule
#
# _dpi_uninstall_run drained `nat PREROUTING` AND a `nat OUTPUT` redirect;
# dpi_remove_rule drained PREROUTING only. So a full-device uninstall never
# cleared the OUTPUT rule. It was inert -- NOTHING in the tree, and nothing
# in git history, ever INSERTED that OUTPUT rule; the `-D` arrived already
# orphaned in 71db6b9, the same commit that created _dpi_uninstall_run --
# but it becomes a real LAN-facing gap the moment anything creates it again.
#
# RESOLVED 2026-08-30 by DELETING the orphan drain, so both paths run the
# same code (dpi_remove_rule). This harness pins that decision from both
# ends, because deleting a drain is only safe while its premise holds:
#
#   [1] the PREMISE -- no site anywhere in the tree inserts a nat OUTPUT
#       REDIRECT. If someone adds one, this section goes red and forces the
#       other half of the F19 decision (teach dpi_remove_rule to own it)
#       rather than letting the tree quietly re-acquire the asymmetry.
#   [2] the SYMMETRY -- the two paths drain the same table/chain SET,
#       measured behaviourally under a stubbed iptables, not grepped.
#   [3] the ROUTE -- qmanager_dpi_run --clear still goes through
#       dpi_remove_rule, which is what makes [2] describe the device path.
#
# Sections [1] and [3] are static (they are statements about call sites);
# [2] runs both drains for real:
#   - dpi_state.sh has a double-source guard and no `main "$@"`, so it can
#     be sourced standalone with run_iptables stubbed.
#   - qmanager_dpi_install dispatches on "$1" at the bottom with no
#     BASH_SOURCE guard, so it cannot be sourced; _dpi_uninstall_run is
#     awk-extracted and run against stubbed iptables/systemctl/pkill/sleep.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DPI_STATE="$REPO_ROOT/scripts/usr/lib/qmanager/dpi_state.sh"
DPI_INSTALL="$REPO_ROOT/scripts/usr/bin/qmanager_dpi_install"
DPI_RUN="$REPO_ROOT/scripts/usr/bin/qmanager_dpi_run"

pass_count=0
fail_count=0

ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

for f in "$DPI_STATE" "$DPI_INSTALL" "$DPI_RUN"; do
    [ -f "$f" ] || { echo "missing: $f" >&2; exit 1; }
done

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

printf '\n[1] premise: nothing in the tree INSERTS a nat OUTPUT redirect\n'

# -I/-A into OUTPUT on the nat table, anywhere under scripts/ except the
# harnesses themselves (they quote the argv they assert on).
INSERTS=$(grep -rn -- '-t nat' "$REPO_ROOT/scripts" 2>/dev/null \
    | grep -v '/scripts/test/' \
    | grep -E -- '-(I|A) OUTPUT' || true)

if [ -z "$INSERTS" ]; then
    ok "no nat OUTPUT REDIRECT is ever inserted (the orphan drain's premise holds)"
else
    bad "something now inserts a nat OUTPUT rule -- the F19 decision to DELETE the drain no longer holds; teach dpi_remove_rule to own that rule so both uninstall paths clear it:
$INSERTS"
fi

printf '\n[2] both uninstall paths drain the same table/chain set (behavioural)\n'

# --- device path: dpi_state.sh's dpi_remove_rule -----------------------------
LIB_LOG="$TMPD/lib.log"
: > "$LIB_LOG"
LIB_LOG="$LIB_LOG" DPI_STATE="$DPI_STATE" bash -c '
    set +e
    DPI_HOSTLIST_DEFAULT=/dev/null
    . "$DPI_STATE"
    # run_iptables normally comes from platform.sh; stub it and return 1 so
    # the bounded drain loop stops after one pass per chain.
    run_iptables() { printf "%s\n" "$*" >> "$LIB_LOG"; return 1; }
    dpi_remove_rule
' >/dev/null 2>&1 || true

# --- UI path: _dpi_uninstall_run --------------------------------------------
UNINSTALL_FN=$(awk '/^_dpi_uninstall_run\(\) \{$/,/^\}$/' "$DPI_INSTALL")
UI_LOG="$TMPD/ui.log"
: > "$UI_LOG"

if [ -z "$UNINSTALL_FN" ]; then
    bad "could not extract _dpi_uninstall_run from qmanager_dpi_install -- renamed? (harness setup, not the fix)"
else
    # Rebind the one absolute path the function assigns internally so a run
    # of this harness ON A DEVICE cannot touch the real config.
    printf '%s\n' "$UNINSTALL_FN" \
        | sed 's#^\( *\)QM_CONF="/etc/qmanager/qmanager.conf"$#\1QM_CONF="'"$TMPD"'/qmanager.conf"#' \
        > "$TMPD/uninstall_fn.sh"

    if grep -qF '/etc/qmanager/qmanager.conf' "$TMPD/uninstall_fn.sh"; then
        bad "QM_CONF rebind did not take -- refusing to run the teardown against a real /etc/qmanager path (harness setup, not the fix)"
    else
        UI_LOG="$UI_LOG" TMPD="$TMPD" bash -c '
            set +e
            DPI_PORT="989"
            DPI_BINARY="$TMPD/tpws"
            DPI_INSTALL_FILE="$TMPD/install.json"
            DPI_INSTALL_PID="$TMPD/install.pid"
            # Both spellings are captured: the function may call iptables
            # directly (the old inlined form) or go through the lib.
            iptables()            { printf "%s\n" "$*" >> "$UI_LOG"; return 1; }
            run_iptables()        { printf "%s\n" "$*" >> "$UI_LOG"; return 1; }
            dpi_remove_rule()     { run_iptables -t nat -D PREROUTING -i bridge0 -p tcp -m multiport --dports 80,443 -j REDIRECT --to-ports "$DPI_PORT"; }
            systemctl()           { return 0; }
            pkill()               { return 0; }
            sleep()               { return 0; }
            jq()                  { return 0; }
            mv()                  { return 0; }
            qlog_info()           { return 0; }
            dpi_binary_installed(){ return 1; }
            _dpi_marker_running() { return 0; }
            _dpi_marker_complete(){ return 0; }
            . "$TMPD/uninstall_fn.sh"
            _dpi_uninstall_run
        ' >/dev/null 2>&1 || true
    fi
fi

# Reduce each log to the set of "<table>/<chain>" pairs it drained.
chain_set() {
    sed -n 's/.*-t \([a-z]*\).*-D \([A-Z]*\).*/\1\/\2/p' "$1" | sort -u | tr '\n' ' '
}

LIB_SET=$(chain_set "$LIB_LOG")
UI_SET=$(chain_set "$UI_LOG")

if [ -z "$LIB_SET" ]; then
    bad "dpi_remove_rule issued no iptables calls (harness setup, or the drain was removed)"
elif [ -z "$UI_SET" ]; then
    bad "_dpi_uninstall_run issued no iptables calls (harness setup, or the drain was removed)"
elif [ "$LIB_SET" = "$UI_SET" ]; then
    ok "both paths drain the same chains: $LIB_SET"
else
    bad "the two uninstall paths drain DIFFERENT chains -- a full-device uninstall leaves whatever only the UI path clears.
       dpi_remove_rule (uninstall_rm520n.sh path): $LIB_SET
       _dpi_uninstall_run (UI path):               $UI_SET"
fi

printf '\n[3] qmanager_dpi_run --clear routes through dpi_remove_rule\n'

CLEAR_BRANCH=$(awk '/^    --clear\)/,/^        ;;$/' "$DPI_RUN")
if printf '%s' "$CLEAR_BRANCH" | grep -qF 'dpi_remove_rule'; then
    ok "--clear calls dpi_remove_rule (so [2]'s lib measurement IS the device path)"
else
    bad "--clear no longer calls dpi_remove_rule -- section [2] no longer measures the uninstall_rm520n.sh path"
fi

printf '\n[4] --clear drains EVERY rule the lib owns, not just the REDIRECT (F21)\n'

# WHY: dpi_state.sh owns three iptables rules, but only one of them is a
# rule the ENGINE installs. The other two are the standalone QUIC handles:
#
#   nat/PREROUTING     REDIRECT --to-ports 989                     (engine)
#   filter/FORWARD     REJECT --reject-with icmp-port-unreachable  (Force-TCP)
#   mangle/POSTROUTING DSCP --set-dscp 0x2e                        (legacy purge)
#
# The QUIC rules are deliberately ungated on the engine's enabled state:
# `qmanager_dpi_run --ensure` reconciles them every 60s even when the engine
# is off, so they survive QCMAP's iptables flush on every re-dial. That is
# correct while QManager is installed -- and it is exactly what makes their
# absence from teardown fatal. Before F21, `--clear` drained ONLY the
# REDIRECT, so a full-device uninstall with Force-TCP previously on left a
# `filter FORWARD -i bridge0 -p udp --dport 443 -j REJECT` rule in place with
# QManager gone and nothing left to remove it -- every LAN client's QUIC
# REJECTed indefinitely.
#
# `--clear` is the right home for the drain, and not merely a convenient one:
# it is invoked from exactly ONE site in the tree (uninstall_rm520n.sh), so
# it is unconditional whole-product teardown. The Traffic Engine's own UI
# uninstall reaches dpi_remove_rule DIRECTLY via _dpi_uninstall_run and never
# goes through this verb -- which is what preserves the lib's "engine
# install/uninstall never touch these rules" invariant. Section [5] pins that
# separation, because a future refactor routing the UI uninstall through
# --clear would silently kill a live user's Force-TCP toggle.
#
# Measured behaviourally, not grepped: the --clear branch is awk-extracted
# and executed against a stubbed run_iptables, so a drain that is present in
# the source but unreachable at runtime still fails.

CLEAR_BODY=$(awk '/^    --clear\)/,/^        ;;$/' "$DPI_RUN" | sed '1d;$d')
CLEAR_LOG="$TMPD/clear.log"
: > "$CLEAR_LOG"

if [ -z "$CLEAR_BODY" ]; then
    bad "could not extract the --clear branch from qmanager_dpi_run -- renamed? (harness setup, not the fix)"
else
    printf '%s\n' "$CLEAR_BODY" > "$TMPD/clear_body.sh"
    CLEAR_LOG="$CLEAR_LOG" DPI_STATE="$DPI_STATE" TMPD="$TMPD" bash -c '
        set +e
        DPI_HOSTLIST_DEFAULT=/dev/null
        . "$DPI_STATE"
        # Return 1 so every bounded drain loop stops after one logged pass.
        run_iptables() { printf "%s\n" "$*" >> "$CLEAR_LOG"; return 1; }
        qlog_info()    { return 0; }
        qlog_warn()    { return 0; }
        svc_stop()     { return 0; }
        . "$TMPD/clear_body.sh"
    ' >/dev/null 2>&1 || true

    # Assert on the rule SIGNATURES, not just chain names: a drain that
    # touched filter/FORWARD for some unrelated rule would satisfy a
    # chain-only check while leaving the REJECT in place.
    while IFS='|' read -r probe_label probe_sig; do
        [ -n "$probe_label" ] || continue
        if grep -qF -- "$probe_sig" "$CLEAR_LOG"; then
            ok "--clear drains the $probe_label rule"
        else
            bad "--clear does NOT drain the $probe_label rule ($probe_sig) -- a full-device uninstall strands it on the device with QManager gone and nothing left to remove it"
        fi
    done <<'PROBES'
nat/PREROUTING REDIRECT|--to-ports
filter/FORWARD Force-TCP REJECT|--reject-with icmp-port-unreachable
mangle/POSTROUTING legacy DSCP|--set-dscp 0x2e
PROBES
fi

printf '\n[5] the engine UI uninstall does NOT go through --clear\n'

# The complement of [4]. The QUIC rules are standalone by contract, so an
# engine-only uninstall must leave them alone. Routing _dpi_uninstall_run
# through `qmanager_dpi_run --clear` would look like tidy deduplication and
# would silently kill a live user's Force-TCP toggle.
if grep -qE 'qmanager_dpi_run.*--clear' "$DPI_INSTALL"; then
    bad "qmanager_dpi_install now routes through 'qmanager_dpi_run --clear' -- that verb drains the standalone QUIC rules, so an ENGINE-only uninstall would also kill the user's Force-TCP toggle. Call dpi_remove_rule directly instead."
else
    ok "the UI uninstall path reaches dpi_remove_rule directly (QUIC rules stay standalone)"
fi

printf '\n[6] syntax sanity\n'

for f in "$DPI_STATE" "$DPI_INSTALL" "$DPI_RUN"; do
    if "${BASH:-bash}" -n "$f" 2>/dev/null; then
        ok "bash -n clean: $(basename "$f")"
    else
        bad "bash -n FAILED: $(basename "$f")"
    fi
done

printf '\n[dpi-uninstall-path-symmetry] %d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
