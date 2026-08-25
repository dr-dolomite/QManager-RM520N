#!/usr/bin/env bash
# Regression harness for the DPI teardown-lockstep defect: a root helper
# under scripts/usr/bin/qmanager_* exposes a teardown-style dispatch verb
# (teardown, --clear, disarm — the shape used by every "arm/disarm a live
# systemd timer or firewall rule" helper in this tree) but the system
# uninstaller never invokes it.
#
# WHY THIS EXISTS
# ----------------
# scripts/usr/lib/qmanager/dpi_state.sh inserts an iptables `nat` PREROUTING
# REDIRECT rule sending LAN tcp/80,443 to the tpws engine's port (989). The
# authoritative teardown for that rule is `qmanager_dpi_run --clear`
# (scripts/usr/bin/qmanager_dpi_run -> dpi_remove_rule). uninstall_rm520n.sh
# already gets this pattern right for three sibling helpers —
# qmanager_scenario_schedule_arm, qmanager_scheduled_reboot_arm,
# qmanager_tower_schedule_arm — each invoked with its `teardown` verb in
# Step 1, explicitly BEFORE Step 3 removes the helper binaries themselves.
# qmanager_dpi_run is the missing fourth: uninstalling QManager with Traffic
# Engine enabled leaves a REDIRECT rule pointing at a port nothing listens
# on anymore, which is a LAN web outage on every device the redirect used
# to protect.
#
# DISCOVERY METHOD
# -----------------
# Rather than hardcode "these are the four helpers", this harness derives
# the obligation mechanically: any root helper whose argument-dispatch case
# arm terminates in a teardown-style verb (teardown, --clear, clear, disarm
# — single-pattern or pipe-separated, e.g. `install|teardown)`) is assumed
# to need a matching invocation in the uninstaller, UNLESS explicitly
# exempted below with a one-sentence justification. This means a FUTURE
# helper that grows a `teardown)` arm and forgets to wire it into the
# uninstaller trips this harness too — it is not a fixed list.
#
# Anchors are matched by TEXT, never by line number. The verb-matching
# regex is anchored at start-of-line (allowing only leading whitespace, an
# optional quote, and pipe-separated bareword alternatives before the
# target verb) specifically so it does NOT fire on a comment or a quoted
# string that happens to contain the word "clear" — e.g.
# qmanager_tower_schedule_arm has both a comment "(apply, clear)" and a
# printf literal "(clear)" that a naive `grep -c 'clear)'` would
# misidentify as dispatch arms. Only real `case` arm lines match.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN_DIR="$REPO_ROOT/scripts/usr/bin"
UNINSTALLER="$REPO_ROOT/scripts/uninstall_rm520n.sh"

pass_count=0
fail_count=0

ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

# A case-arm line: start of line, optional whitespace, zero or more
# pipe-separated bareword alternatives (each optionally quoted, optionally
# prefixed with --), then the target verb (optionally quoted), then the
# closing paren. Anchoring the whole thing at ^ is what keeps comments and
# mid-line string literals from matching.
VERB_RE='^[[:space:]]*"?((--)?[A-Za-z0-9_]+"?\|)*"?(teardown|--clear|clear|disarm)"?\)'

# ---------------------------------------------------------------------------
# [1] Enumerate root helpers exposing a teardown-style dispatch verb
# ---------------------------------------------------------------------------
printf '\n[1] Enumerating scripts/usr/bin/qmanager_* for a teardown-style dispatch verb\n'

DISCOVERED_NAMES=()
DISCOVERED_VERBS=()

for helper_path in "$BIN_DIR"/qmanager_*; do
    [ -f "$helper_path" ] || continue
    arm_line=$(grep -E "$VERB_RE" "$helper_path" | head -n1 || true)
    [ -n "$arm_line" ] || continue
    verb=$(printf '%s\n' "$arm_line" | grep -oE '(teardown|--clear|clear|disarm)' | head -n1)
    name=$(basename "$helper_path")
    DISCOVERED_NAMES+=("$name")
    DISCOVERED_VERBS+=("$verb")
    printf '  found  %-32s verb=%-10s arm=%s\n' "$name" "$verb" "$(printf '%s' "$arm_line" | sed 's/^[[:space:]]*//')"
done

if [ "${#DISCOVERED_NAMES[@]}" -eq 0 ]; then
    bad "no helpers with a teardown-style verb were discovered — the discovery regex is broken (it must find at least the three sibling arm helpers)"
fi

# ---------------------------------------------------------------------------
# [2] Allowlist — helpers with a teardown-style verb but NO teardown
#     obligation on the system uninstaller. Every entry needs a one-sentence
#     justification; an entry that cannot be justified this briefly is a
#     finding, not an exemption.
# ---------------------------------------------------------------------------
printf '\n[2] Allowlist (verb present, but no system-uninstall obligation)\n'

is_exempt() {
    case "$1" in
        # qmanager_logread is a manual SSH-session diagnostic CLI (log
        # viewer/tail/grep), never invoked by any daemon, timer, or CGI
        # action. Its --clear truncates rotated log files under /tmp — a
        # content operation, not a persistent-state teardown — and those
        # files are already unconditionally removed by uninstall_rm520n.sh
        # Step 10's `rm -f /tmp/qmanager.log*` regardless. No sibling
        # relationship to the arm/disarm-a-live-rule pattern this harness
        # targets.
        qmanager_logread) return 0 ;;
        *) return 1 ;;
    esac
}

exempt_count=0
i=0
while [ "$i" -lt "${#DISCOVERED_NAMES[@]}" ]; do
    name="${DISCOVERED_NAMES[$i]}"
    if is_exempt "$name"; then
        printf '  exempt %-32s (see is_exempt() comment)\n' "$name"
        exempt_count=$((exempt_count + 1))
    fi
    i=$((i + 1))
done
ok "$exempt_count helper(s) allowlisted with an inline justification"

# ---------------------------------------------------------------------------
# [3] Every non-exempt helper's teardown verb must be invoked by the
#     uninstaller, naming BOTH the helper's basename AND its verb.
# ---------------------------------------------------------------------------
printf '\n[3] uninstall_rm520n.sh invokes every non-exempt helper with its teardown verb\n'

i=0
while [ "$i" -lt "${#DISCOVERED_NAMES[@]}" ]; do
    name="${DISCOVERED_NAMES[$i]}"
    verb="${DISCOVERED_VERBS[$i]}"
    i=$((i + 1))

    if is_exempt "$name"; then
        continue
    fi

    helper_lines=$(grep -F -- "$name" "$UNINSTALLER" || true)
    if [ -n "$helper_lines" ] && printf '%s\n' "$helper_lines" | grep -qF -- "$verb"; then
        ok "$name $verb is invoked by the uninstaller"
    else
        bad "$name $verb is NOT invoked by the uninstaller — a live rule/timer this helper owns survives uninstall"
    fi
done

# ---------------------------------------------------------------------------
# [4] syntax sanity
# ---------------------------------------------------------------------------
printf '\n[4] syntax sanity\n'

if "${BASH:-bash}" -n "$UNINSTALLER" 2>/dev/null; then
    ok "bash -n clean: $(basename "$UNINSTALLER")"
else
    bad "bash -n FAILED: $(basename "$UNINSTALLER")"
fi

i=0
while [ "$i" -lt "${#DISCOVERED_NAMES[@]}" ]; do
    name="${DISCOVERED_NAMES[$i]}"
    i=$((i + 1))
    helper_path="$BIN_DIR/$name"
    # These helpers are #!/bin/sh (POSIX dash-compatible), not bash — sanity
    # check with sh, matching how they actually run on-device.
    if sh -n "$helper_path" 2>/dev/null; then
        ok "sh -n clean: $name"
    else
        bad "sh -n FAILED: $name"
    fi
done

printf '\n[installer-teardown-lockstep] %d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
