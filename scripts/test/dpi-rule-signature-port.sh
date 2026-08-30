#!/usr/bin/env bash
# Regression harness for the Traffic Engine's REDIRECT-rule port literal.
#
# WHY THIS EXISTS
# ----------------
# The DPI engine's rule is identified by its unique `--to-ports N` target
# (the RM520N kernel has no xt_comment module, so the rule can't carry
# -m comment). Two places have historically hardcoded that port instead of
# deriving it from $DPI_PORT:
#
#   [1][2] dpi_state.sh's DPI_RULE_SIG (F16, fixed e0374dc). Before the fix
#          it was the bare literal "--to-ports 989". If DPI_PORT ever
#          changes, dpi_rule_present() keeps grepping for the OLD signature:
#          the idempotence check misses, dpi_apply_rule's -D drain loop
#          matches the NEW spec (nothing to drain), and its -I insert adds a
#          SECOND REDIRECT rule instead of replacing the first — leaving the
#          LAN with two REDIRECTs, one pointing at a dead port.
#
#   [3]    qmanager_dpi_install's own uninstall teardown (F16 follow-up,
#          surfaced by the busybox-portability-checker validator on the
#          e0374dc run). _dpi_uninstall_run inlines its two `iptables -D`
#          calls rather than going through dpi_remove_rule, and hardcoded
#          "--to-ports 989" in both. Same dormant bug, worse blast radius:
#          a teardown that deletes nothing leaves a REDIRECT to a dead port
#          on every LAN client — a LAN OUTAGE, not a leak
#          (see docs/reference/dpi.md > Teardown).
#
# Sections [1] and [3] are executed BEHAVIOURALLY, not grepped:
#   - dpi_state.sh has a double-source guard and no `main "$@"` at the
#     bottom, so it can be sourced standalone and its variables inspected.
#   - qmanager_dpi_install DOES dispatch on "$1" at the bottom with no
#     BASH_SOURCE guard, so it cannot be sourced. _dpi_uninstall_run is
#     awk-extracted and run against stubbed iptables/systemctl/pkill/sleep,
#     with every path it writes to rebound into a scratch dir first.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DPI_STATE="$REPO_ROOT/scripts/usr/lib/qmanager/dpi_state.sh"
DPI_INSTALL="$REPO_ROOT/scripts/usr/bin/qmanager_dpi_install"

pass_count=0
fail_count=0

ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

[ -f "$DPI_STATE" ]   || { echo "dpi_state.sh not found at $DPI_STATE" >&2; exit 1; }
[ -f "$DPI_INSTALL" ] || { echo "qmanager_dpi_install not found at $DPI_INSTALL" >&2; exit 1; }

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

printf '\n[1] DPI_RULE_SIG tracks DPI_PORT (behavioural)\n'

# A copy with DPI_PORT edited to a non-default value. Only the assignment
# line is touched — sed is scoped to the exact `DPI_PORT="989"` literal so a
# stray match elsewhere in the file can't produce a false pass.
sed 's/^DPI_PORT="989"$/DPI_PORT="7777"/' "$DPI_STATE" > "$TMPD/dpi_state_patched.sh"

if ! grep -qF 'DPI_PORT="7777"' "$TMPD/dpi_state_patched.sh"; then
    bad "sed did not patch DPI_PORT in the copy — harness setup is broken, not the fix"
else
    # Source in a subshell so DPI_PORT/DPI_RULE_SIG never leak into this
    # process, and so the harness survives a source-time failure cleanly.
    RESULT=$(DPI_STATE_PATCHED="$TMPD/dpi_state_patched.sh" bash -c '
        set -e
        DPI_HOSTLIST_DEFAULT=/dev/null
        . "$DPI_STATE_PATCHED"
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

printf '\n[3] qmanager_dpi_install uninstall teardown drains the CURRENT port (behavioural)\n'

UNINSTALL_FN=$(awk '/^_dpi_uninstall_run\(\) \{$/,/^\}$/' "$DPI_INSTALL")

if [ -z "$UNINSTALL_FN" ]; then
    bad "could not extract _dpi_uninstall_run from qmanager_dpi_install — has it been renamed? (harness setup, not the fix)"
else
    # Rebind the one absolute path the function assigns internally, so a run
    # of this harness ON A DEVICE cannot touch the real config. Asserted
    # below rather than assumed: if the line moves, the harness fails loudly
    # instead of silently exercising /etc/qmanager.
    printf '%s\n' "$UNINSTALL_FN" \
        | sed 's#^\( *\)QM_CONF="/etc/qmanager/qmanager.conf"$#\1QM_CONF="'"$TMPD"'/qmanager.conf"#' \
        > "$TMPD/uninstall_fn.sh"

    if grep -qF '/etc/qmanager/qmanager.conf' "$TMPD/uninstall_fn.sh"; then
        bad "QM_CONF rebind did not take — refusing to run the teardown against a real /etc/qmanager path (harness setup, not the fix)"
    else
        IPT_LOG="$TMPD/iptables.log"
        : > "$IPT_LOG"

        # Stubs: capture iptables argv, neutralise everything with a side
        # effect. iptables returns 1 so the `for i in 1 2 3 ... && break`
        # loop runs every pass and we see all attempts.
        IPT_LOG="$IPT_LOG" TMPD="$TMPD" bash -c '
            set +e
            DPI_PORT="7777"
            DPI_BINARY="$TMPD/tpws"
            DPI_INSTALL_FILE="$TMPD/install.json"
            DPI_INSTALL_PID="$TMPD/install.pid"
            iptables()            { printf "%s\n" "$*" >> "$IPT_LOG"; return 1; }
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

        if [ ! -s "$IPT_LOG" ]; then
            bad "_dpi_uninstall_run issued no iptables calls at all — the teardown did not run (harness setup, or the drain was removed)"
        else
            # The PREROUTING drain is the LAN-outage one; the OUTPUT drain
            # clears the modem-originated 443 redirect. Both must follow the
            # live port.
            PRE=$(grep -e '-D PREROUTING' "$IPT_LOG" || true)
            OUT=$(grep -e '-D OUTPUT' "$IPT_LOG" || true)

            case "$PRE" in
                *"--to-ports 7777"*)
                    ok "PREROUTING drain uses the current DPI_PORT (--to-ports 7777)" ;;
                *"--to-ports 989"*)
                    bad "PREROUTING drain is still the hardcoded literal '--to-ports 989' after DPI_PORT changed to 7777 — uninstall would delete nothing and strand a REDIRECT to a dead port on every LAN client" ;;
                "")
                    bad "no PREROUTING drain was issued by _dpi_uninstall_run" ;;
                *)
                    bad "unexpected PREROUTING drain argv: $PRE" ;;
            esac

            case "$OUT" in
                *"--to-ports 7777"*)
                    ok "OUTPUT drain uses the current DPI_PORT (--to-ports 7777)" ;;
                *"--to-ports 989"*)
                    bad "OUTPUT drain is still the hardcoded literal '--to-ports 989' after DPI_PORT changed to 7777" ;;
                "")
                    bad "no OUTPUT drain was issued by _dpi_uninstall_run" ;;
                *)
                    bad "unexpected OUTPUT drain argv: $OUT" ;;
            esac

            if grep -q -e '--to-ports 989' "$IPT_LOG"; then
                bad "at least one teardown rule still carries the bare literal 989 with DPI_PORT=7777"
            else
                ok "no bare '--to-ports 989' literal survives in the teardown argv"
            fi
        fi
    fi
fi

printf '\n[4] syntax sanity\n'

for f in "$DPI_STATE" "$DPI_INSTALL"; do
    if "${BASH:-bash}" -n "$f" 2>/dev/null; then
        ok "bash -n clean: $(basename "$f")"
    else
        bad "bash -n FAILED: $(basename "$f")"
    fi
done

printf '\n[dpi-rule-signature-port] %d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
