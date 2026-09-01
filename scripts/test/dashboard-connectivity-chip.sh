#!/bin/bash
# Regression harness for the dashboard Internet chip / latency-null-coercion
# fix, companion to scripts/test/poller-connectivity-emit.sh.
#
# WHY THIS EXISTS
# ----------------
# scripts/usr/bin/qmanager_poller emits connectivity.state as a permanently
# frozen "unknown" (the ICMP ping daemon never writes the `.connectivity`
# key the poller reads it from -- see poller-connectivity-emit.sh). Two
# frontend defects compound that backend bug:
#
#   D4  components/dashboard/network-status.tsx's buildInternetChip() reads
#       `c?.state` FIRST (network-status.tsx:~350). "unknown" is a truthy
#       JS string, so the internet_available fallback branch is dead code
#       and the chip renders muted/gray forever, regardless of the real
#       connection.
#   D5  Two chart sites coerce a null RTT sample (a lost ping) to 0:
#       components/dashboard/live-latency.tsx (~line 478,
#       `latency: rtt !== null ? Math.round(rtt) : 0`) and
#       components/monitoring/latency-monitoring/latency-monitoring-card.tsx
#       (~line 101, `return { timestamp, latency: 0, packet_loss: 100,
#       ok: false }`). A total outage draws as a flat healthy line at zero
#       instead of a gap.
#
# The approved fix: buildInternetChip() reads connectivity.status (the
# ConnectivityState union the poller ALREADY derives correctly --
# recovery/degraded/connected/disconnected/unknown) instead of `state`,
# with a distinct tone + glyph per state (connected->success,
# degraded->warning, recovery->warning, disconnected->destructive,
# unknown->muted -- no two states sharing a glyph). Both chart sites render
# a null sample as a gap (null), never 0. types/modem-status.ts drops
# PingTriState and the `state` member of ConnectivityStatus along with the
# six retired fields poller-connectivity-emit.sh pins server-side.
#
# There is no frontend test runner in this repo (confirmed: no vitest/jest/
# @testing-library dependency in package.json). This harness is
# text-anchored against the shipped source, following the pattern in
# scripts/test/ethernet-design-language.sh: strip comments so prose
# discussing a retired symbol cannot itself trip an assertion, then grep the
# stripped source for the shapes the plan specifies.
#
# This harness is COMMITTED RED, before the fix exists (change-workflow.md,
# Phase 4a). The builder who writes the fix does not edit this file.
#
# Run: bash scripts/test/dashboard-connectivity-chip.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NETWORK_STATUS="$REPO_ROOT/components/dashboard/network-status.tsx"
LIVE_LATENCY="$REPO_ROOT/components/dashboard/live-latency.tsx"
LATENCY_CARD="$REPO_ROOT/components/monitoring/latency-monitoring/latency-monitoring-card.tsx"
TYPES="$REPO_ROOT/types/modem-status.ts"

pass_count=0
fail_count=0
ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

# Strip //-to-EOL, block /* */ and JSX {/* */} comments, same recipe as
# ethernet-design-language.sh, so a prose mention of a retired symbol
# (e.g. this file's own header above) cannot fail an assertion about
# rendered code.
strip_comments() {
    awk '
        {
            line = $0
            out = ""
            i = 1
            n = length(line)
            while (i <= n) {
                c = substr(line, i, 2)
                if (inblock) {
                    if (c == "*/") { inblock = 0; i += 2 } else { i++ }
                    continue
                }
                if (c == "/*") { inblock = 1; i += 2; continue }
                if (c == "//") { break }
                out = out substr(line, i, 1)
                i++
            }
            print out
        }
    ' "$1"
}

for pair in "netstat:$NETWORK_STATUS" "livelat:$LIVE_LATENCY" "latcard:$LATENCY_CARD" "types:$TYPES"; do
    name="${pair%%:*}"; path="${pair#*:}"
    if [ -f "$path" ]; then
        ok "exists: ${path#"$REPO_ROOT/"}"
        strip_comments "$path" > "$TMPD/$name.code"
    else
        bad "missing: ${path#"$REPO_ROOT/"}"
        : > "$TMPD/$name.code"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[1] buildInternetChip() no longer reads a truthy c?.state first (D4)\n'
# network-status.tsx:~350 today: `if (c?.state) { state = c.state; }` runs
# BEFORE the internet_available fallback. "unknown" is a truthy JS string,
# so that fallback branch is permanently dead and the chip never leaves
# muted/gray.
if grep -qE '\bc\?\.state\b' "$TMPD/netstat.code" || grep -qE '\.state\s*\?\?' "$TMPD/netstat.code"; then
    printf '       offending lines:\n'
    grep -nE '\bc\?\.state\b|\.state\s*\?\?' "$TMPD/netstat.code" | sed 's/^/         /'
    bad "network-status.tsx still reads connectivity.state"
else
    ok "network-status.tsx no longer reads connectivity.state"
fi

# -----------------------------------------------------------------------------
printf '\n[2] buildInternetChip() reads connectivity.status instead (D4)\n'
# The poller already derives this correctly (qmanager_poller:~1533-1553);
# the fix is purely about what the frontend reads.
if grep -qE '\bc\?\.status\b|connectivity(Status)?\??\.status\b' "$TMPD/netstat.code"; then
    ok "network-status.tsx reads connectivity.status"
else
    bad "network-status.tsx does not read connectivity.status -- the ConnectivityState union is unused"
fi

# -----------------------------------------------------------------------------
printf '\n[3] All five ConnectivityState values are handled\n'
# recovery / degraded / connected / disconnected / unknown -- the union
# types/modem-status.ts already declares. A switch/if-chain that only
# handles a subset silently falls through to a default for the others.
for state in connected degraded recovery disconnected unknown; do
    if grep -q "\"$state\"" "$TMPD/netstat.code"; then
        ok "network-status.tsx has a branch for '$state'"
    else
        bad "network-status.tsx has no branch for '$state'"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[4] Each state maps to the specified tone (success/warning/warning/destructive/muted)\n'
# Tone assignment is checked loosely (state literal and tone literal both
# present in the file) rather than pinning exact adjacency, since the
# builder may reshape the function into a lookup table or a switch. What
# must NOT happen is a tone this plan did not assign.
for tone in success warning destructive muted; do
    if grep -q "\"$tone\"" "$TMPD/netstat.code"; then
        ok "network-status.tsx uses the '$tone' tone"
    else
        bad "network-status.tsx never uses the '$tone' tone -- one of the five states has no home"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[5] The five states never share an icon glyph (Every-Chip-Has-A-Glyph Rule)\n'
# success-container and warning-container measure 1.03:1 apart -- the same
# surface to the eye -- so recovery/degraded (both warning-toned) MUST carry
# different glyphs from each other and from every other state, or the
# colour becomes the only channel distinguishing them.
glyph_lines=$(grep -nE 'name="[a-z_]+"' "$TMPD/netstat.code" | grep -iE 'icon|Symbol' || true)
glyphs=$(printf '%s' "$glyph_lines" | grep -oE 'name="[a-z_]+"' | sort -u | wc -l | tr -d ' ')
if [ "${glyphs:-0}" -ge 5 ]; then
    ok "network-status.tsx uses $glyphs distinct icon glyphs (>= 5 states)"
else
    printf '       found: %s distinct MaterialSymbol name= glyphs\n' "${glyphs:-0}"
    bad "only ${glyphs:-0} distinct glyphs found -- two of the five connectivity states are sharing one"
fi

# -----------------------------------------------------------------------------
printf '\n[6] live-latency.tsx no longer coerces a null RTT sample to 0 (D5)\n'
if grep -qE 'rtt !== null \? Math\.round\(rtt\) : 0' "$TMPD/livelat.code"; then
    printf '       offending line:\n'
    grep -nE 'rtt !== null \? Math\.round\(rtt\) : 0' "$TMPD/livelat.code" | sed 's/^/         /'
    bad "live-latency.tsx still draws a lost ping as latency 0"
else
    ok "live-latency.tsx no longer coerces a null RTT to 0"
fi
# A gap, not a zero: the replacement must still be able to carry null
# through to the chart datum.
if grep -qE 'rtt !== null \? Math\.round\(rtt\) : null' "$TMPD/livelat.code"; then
    ok "live-latency.tsx renders a lost ping as a null (gap) datum"
else
    bad "live-latency.tsx has no null-preserving replacement for the RTT coercion"
fi

# -----------------------------------------------------------------------------
printf '\n[7] latency-monitoring-card.tsx no longer coerces a null sample to latency 0 (D5)\n'
if grep -qE 'latency:\s*0,\s*packet_loss:\s*100,\s*ok:\s*false' "$TMPD/latcard.code"; then
    printf '       offending line:\n'
    grep -nE 'latency:\s*0,\s*packet_loss:\s*100,\s*ok:\s*false' "$TMPD/latcard.code" | sed 's/^/         /'
    bad "latency-monitoring-card.tsx still draws a lost ping as latency 0"
else
    ok "latency-monitoring-card.tsx no longer coerces a null sample to latency 0"
fi
if grep -qE 'latency:\s*null,\s*packet_loss:\s*100,\s*ok:\s*false' "$TMPD/latcard.code"; then
    ok "latency-monitoring-card.tsx renders a lost ping as a null (gap) datum"
else
    bad "latency-monitoring-card.tsx has no null-preserving replacement for the coercion"
fi

# -----------------------------------------------------------------------------
printf '\n[8] types/modem-status.ts drops PingTriState and the state member (D1 companion)\n'
# The type-level half of the same defect: PingTriState only ever described
# the dead "state" field. Its ConnectivityState replacement already exists
# and is untouched by this assertion.
if grep -qE 'export type PingTriState' "$TMPD/types.code"; then
    printf '       offending line:\n'
    grep -nE 'export type PingTriState' "$TMPD/types.code" | sed 's/^/         /'
    bad "types/modem-status.ts still exports PingTriState"
else
    ok "types/modem-status.ts no longer exports PingTriState"
fi
# The `state` member of ConnectivityStatus specifically -- not a false
# positive on ConnectivityState (the status union) or unrelated `state`
# fields on sibling interfaces (e.g. WatchcatState).
conn_iface=$(awk '/export interface ConnectivityStatus/,/^}/' "$TMPD/types.code")
if printf '%s\n' "$conn_iface" | grep -qE '^\s*state\s*:'; then
    printf '       offending line inside ConnectivityStatus (line number relative to the extracted interface, not the file):\n'
    printf '%s\n' "$conn_iface" | grep -E '^\s*state\s*:' | sed 's/^/         /'
    bad "ConnectivityStatus still declares a 'state' member"
else
    ok "ConnectivityStatus no longer declares a 'state' member"
fi
# The six retired fields (D3's type-level half) -- pinned here too so a
# frontend-only fix cannot leave stale optional fields nothing populates.
for field in limited_reason down_reason streak_limited fail_secs recover_secs intercept_secs; do
    if printf '%s\n' "$conn_iface" | grep -qE "^\s*${field}\s*:"; then
        bad "ConnectivityStatus still declares '$field'"
    else
        ok "ConnectivityStatus no longer declares '$field'"
    fi
done
# ConnectivityState (the 5-value status union) must survive untouched --
# this assertion exists so a builder cannot satisfy [8] by deleting the
# wrong type.
if grep -qE 'export type ConnectivityState' "$TMPD/types.code"; then
    ok "ConnectivityState (the status union) still exists"
else
    bad "ConnectivityState is gone -- the wrong type was deleted"
fi

printf '\n---------------------------------------------\n'
printf 'dashboard-connectivity-chip: %d passed, %d failed\n\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ]
