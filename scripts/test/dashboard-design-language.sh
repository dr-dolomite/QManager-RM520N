#!/usr/bin/env bash
# Regression harness for the /dashboard design-language adoption pass.
#
# WHY THIS EXISTS
# ----------------
# The dashboard has no token drift. All of its drift is grammar. DESIGN.md was
# written FROM this surface, and then the canon it seeded moved on without it --
# nine other route families were re-authored between 2026-08-17 and 2026-08-31
# onto a grammar this surface never adopted. A token scan of
# components/dashboard/** comes back nearly clean; a grammar scan returns
# seventeen findings.
#
# The pass runs as one pre-step plus ten steps, one commit each. This file grows
# one section per step, and every section is COMMITTED RED before its fix exists
# (change-workflow.md, Phase 4a). The builder who writes a fix does not edit the
# assertions that pin it.
#
# Plan: docs/superpowers/plans/2026-09-01-dashboard-adoption-pass.md
# Contract: docs/reference/dashboard.md
#
# =============================================================================
# SECTION R0 -- One bar thickness, product-wide
# =============================================================================
#
# R0 is NOT a dashboard change, which is exactly why it is its own commit ahead
# of the pass: it reaches 11 call sites across 6 route families, and four of
# them are on system-settings/modem-subsystem-card, a surface the pass never
# otherwise opens.
#
# THE DEFECT. MetricBar's `size` prop defaults to `sm` (h-1, 4px), so the
# product's 20 call sites divided 11 at 4px against 9 at 8px purely by which
# ones passed the prop. That was never a design decision.
#
# WHY 8px IS THE RESOLUTION, and not "consistency". DESIGN.md > Quality bars
# rests the entire five-stop ramp on LENGTH -- adjacent stops sit deliberately
# below the 0.05 CVD separation floor, on the explicit understanding that bar
# length carries the fine distinctions. A 4px hairline is the thinnest mark on
# its card, and asking it to carry the one channel the ramp may not lose was the
# contradiction. Thickening it strengthens the encoding the accessibility
# argument depends on. Approved 2026-09-01.
#
# THE CENSUS THIS HARNESS PINS, measured against 5406568:
#
#   explicit size sm  (5)  antenna-alignment/live-aim x2
#                          antenna-alignment/port-strip
#                          antenna-statistics/tech-card
#                          dashboard/signal-status-card
#   no prop -> sm     (6)  band-locking/live-band-hero
#                          tower-locking/live-strip
#                          system-settings/modem-subsystem-card x4
#   explicit size md  (9)  antenna-alignment/live-aim
#                          antenna-alignment/recorder-card
#                          radio/active-bands-card
#                          sms/summary-tiles
#                          dashboard/device-metrics x4
#                          traffic-engine/verify-card
#
#   5 + 6 = 11 at 4px, 9 at 8px, 20 total.
#
# TWO CORRECTIONS TO THE APPROVED LIST, found by reading the tree rather than
# trusting the grep behind it. Recorded here because a later reader will
# otherwise reconcile this harness against a list that does not match it:
#
#   (a) `dashboard/signal-history` is named in the plan's "11 sites that move"
#       and in DESIGN.md's Migration Deltas row. That file contains NO MetricBar
#       at all. Its size sm is on a SelectTrigger (:327). The list names twelve
#       sites for a count of eleven; strike signal-history and it reconciles.
#   (b) The plan says four sites pass an explicit small size. It is five.
#
# TWO SITES CARRY THE 4px NUMBER LITERALLY, and neither is a MetricBar call
# site, so neither appears on any list built by grepping for the prop. Both move
# in the same commit or the bar overflows a box built to hold it:
#
#   PORT.LANE          components/cellular/antenna-alignment/shapes.ts
#                      A PINNED 4px flex box ("flex h-1 items-center"). Its own
#                      comment says it exists so a bar, a caption and a
#                      not-reported line share one band -- an 8px bar inside it
#                      overflows that band.
#   modem-subsystem    Four Skeleton slivers at h-1 w-full, one per bar and
#                      exact mirrors of them. The Skeleton-Mirror Rule fails by
#                      construction if they stay.
#
# WHICH ASSERTION PINS WHAT
#   [R0-1] SIZE_CLASS has exactly one member and it is the 8px track
#   [R0-2] the default is that member, so a site that passes nothing gets 8px
#   [R0-3] no MetricBar anywhere still asks for the small size
#   [R0-4] no MetricBar anywhere passes the size prop at all -- with one legal
#          value it is redundant, and a redundant prop is how the split
#          reappears
#   [R0-5] the rampFloor stub is unconditional; the size ternary collapsed
#   [R0-6] the two literal 4px mirrors moved
#   [R0-7] DESIGN.md says 8px in both places, and its Migration Deltas row for
#          this change reads Landed
#
# SCOPINGS, stated openly so they are not mistaken for a weakened test
# ---------------------------------------------------------------------
#  [R0-3] [R0-4] extract the <MetricBar ... /> ELEMENT and test inside it. A
#         blanket ban on the small size string across components/** would be
#         wrong: Button, SelectTrigger, Badge and ToggleGroup use the same
#         spelling on 60+ unrelated lines, and one of those false positives is
#         precisely what put signal-history on the approved list.
#  [R0-6] is checked against comment-stripped source. The shapes module and the
#         component carry the reasoning for every value in their JSDoc, and that
#         reasoning necessarily quotes the height being retired. Failing on a
#         comment pushes the author to delete the rationale, which is the most
#         valuable half of a shapes module.
#
# Run: bash scripts/test/dashboard-design-language.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPONENTS="$REPO_ROOT/components"
METRIC_BAR="$COMPONENTS/ui/metric-bar.tsx"
AA_SHAPES="$COMPONENTS/cellular/antenna-alignment/shapes.ts"
SUBSYSTEM="$COMPONENTS/system-settings/modem-subsystem-card.tsx"
DESIGN_MD="$REPO_ROOT/DESIGN.md"

pass_count=0
fail_count=0

ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

# Strip //-to-EOL, /* */ and {/* */} comments so a prose mention of a retired
# value cannot fail an assertion about rendered code.
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

# Emit every <MetricBar ... /> element in a file, one per line, as
#   <path>:<line-of-open-tag>:<flattened element text>
# Comments are stripped first, so a JSDoc mentioning the prop cannot match.
# The element ends at the first line whose stripped text ends the JSX tag.
metric_bar_elements() {
    local file="$1"
    strip_comments "$file" | awk -v f="$file" '
        /<MetricBar/ { inel = 1; start = NR; buf = "" }
        inel {
            t = $0
            gsub(/^[ \t]+|[ \t]+$/, "", t)
            buf = buf " " t
            if (t ~ /\/>$/ || t ~ /^>$/ || t ~ /[^\/]>$/) {
                print f ":" start ":" buf
                inel = 0
            }
        }
    '
}

metric_bar_files() {
    grep -rl "<MetricBar" "$COMPONENTS" --include='*.tsx' 2>/dev/null | sort
}

printf '\n=============================================================\n'
printf 'SECTION R0 -- one bar thickness, product-wide\n'
printf '=============================================================\n'

# -----------------------------------------------------------------------------
printf '\n[R0-1] SIZE_CLASS carries exactly one member, the 8px track\n'
# The small size is DELETED, not deprecated. A size nobody should pick is a
# trap: it survives in autocomplete, in a copied call site, and in the next
# person's mental model of "the bar has two forms".
if [ ! -f "$METRIC_BAR" ]; then
    bad "missing: components/ui/metric-bar.tsx"
else
    size_block=$(strip_comments "$METRIC_BAR" \
        | awk '/^const SIZE_CLASS = \{/{f=1} f{print} /^\} as const;/{if(f) exit}')
    if [ -z "$size_block" ]; then
        bad "SIZE_CLASS declaration not found in metric-bar.tsx"
    else
        members=$(printf '%s\n' "$size_block" | grep -cE '^\s+[a-z]+:')
        if [ "$members" -eq 1 ]; then
            ok "SIZE_CLASS has exactly one member"
        else
            bad "SIZE_CLASS has $members members, expected 1"
        fi
        if printf '%s\n' "$size_block" | grep -qE '^\s+sm:'; then
            bad "the small size is still declared in SIZE_CLASS"
        else
            ok "the small size is gone from SIZE_CLASS"
        fi
        if printf '%s\n' "$size_block" | grep -qE '^\s+md:\s*"h-2"'; then
            ok "the surviving member is the 8px track"
        else
            bad "the surviving SIZE_CLASS member is not the 8px track"
        fi
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[R0-2] the default is the 8px track\n'
# This is the assertion that actually moves the six sites which pass no prop at
# all -- live-band-hero, tower-locking/live-strip, and modem-subsystem-card x4.
# They are invisible to any grep for the prop and are moved solely by the
# default flipping.
if [ -f "$METRIC_BAR" ]; then
    if strip_comments "$METRIC_BAR" | grep -qE 'size\s*=\s*"md"\s*,'; then
        ok "size defaults to the 8px track"
    elif strip_comments "$METRIC_BAR" | grep -qE 'size\s*=\s*"sm"\s*,'; then
        bad "size still defaults to the retired 4px track"
    else
        bad "no size default found in the MetricBar signature"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[R0-3] no MetricBar asks for the retired 4px track\n'
found_sm=0
while IFS= read -r file; do
    while IFS= read -r el; do
        [ -z "$el" ] && continue
        if printf '%s' "$el" | grep -qE 'size=\{?"sm"'; then
            loc="${el%%:*}"; rest="${el#*:}"; line="${rest%%:*}"
            bad "MetricBar still passes the retired size: ${loc#"$REPO_ROOT/"}:$line"
            found_sm=1
        fi
    done <<< "$(metric_bar_elements "$file")"
done <<< "$(metric_bar_files)"
[ "$found_sm" -eq 0 ] && ok "no MetricBar in components/** asks for the 4px track"

# -----------------------------------------------------------------------------
printf '\n[R0-4] no MetricBar passes the size prop at all\n'
# With one legal value the prop is dead weight, and dead weight is how the split
# comes back: the next call site copies a neighbour that still spells it out and
# someone eventually adds a second member to satisfy it.
found_size=0
total_els=0
while IFS= read -r file; do
    while IFS= read -r el; do
        [ -z "$el" ] && continue
        total_els=$((total_els + 1))
        if printf '%s' "$el" | grep -qE '(^|[[:space:]])size='; then
            loc="${el%%:*}"; rest="${el#*:}"; line="${rest%%:*}"
            bad "MetricBar still passes a size prop: ${loc#"$REPO_ROOT/"}:$line"
            found_size=1
        fi
    done <<< "$(metric_bar_elements "$file")"
done <<< "$(metric_bar_files)"
if [ "$total_els" -eq 0 ]; then
    bad "no MetricBar elements were extracted -- the extractor is broken, not the tree"
elif [ "$found_size" -eq 0 ]; then
    ok "all $total_els MetricBar call sites take the one thickness by default"
fi

# -----------------------------------------------------------------------------
printf '\n[R0-5] the ramp stub is unconditional\n'
# A ramp reading at a legitimate 0% floors at one track-height stub so it never
# renders byte-identically to value null. With one thickness there is one stub
# width, and the size ternary that chose between two collapses with the size it
# was choosing on.
if [ -f "$METRIC_BAR" ]; then
    stripped="$TMPD/metric-bar.stripped"
    strip_comments "$METRIC_BAR" > "$stripped"
    if grep -qE 'size\s*===\s*"md"' "$stripped"; then
        bad "the rampFloor branch still switches on size"
    else
        ok "the rampFloor branch no longer switches on size"
    fi
    if grep -qE 'rampFloor\s*&&\s*"min-w-2"' "$stripped"; then
        ok "the stub is the unconditional 8px width"
    else
        bad "the ramp stub is not an unconditional 8px width"
    fi
    if grep -q 'min-w-1' "$stripped"; then
        bad "the retired 4px stub width still ships"
    else
        ok "the retired 4px stub width is gone"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[R0-6] the two literal 4px mirrors moved\n'
# Neither of these is a MetricBar call site, so neither appears on any list
# built by grepping for the prop -- and both are boxes sized to hold a 4px bar.
if [ ! -f "$AA_SHAPES" ]; then
    bad "missing: components/cellular/antenna-alignment/shapes.ts"
else
    lane=$(strip_comments "$AA_SHAPES" | grep -E '^\s+LANE:.*items-center' | head -1)
    if [ -z "$lane" ]; then
        bad "PORT.LANE not found in antenna-alignment/shapes.ts"
    elif printf '%s' "$lane" | grep -qE '\bh-1\b'; then
        bad "PORT.LANE is still a pinned 4px band, which an 8px bar overflows"
    elif printf '%s' "$lane" | grep -qE '\bh-2\b'; then
        ok "PORT.LANE is an 8px band"
    else
        bad "PORT.LANE carries no pinned height"
    fi
fi

if [ ! -f "$SUBSYSTEM" ]; then
    bad "missing: components/system-settings/modem-subsystem-card.tsx"
else
    slivers=$(strip_comments "$SUBSYSTEM" | grep -cE 'Skeleton className="h-1 ')
    if [ "$slivers" -gt 0 ]; then
        bad "modem-subsystem-card still mirrors its bars with $slivers 4px skeleton slivers"
    else
        ok "modem-subsystem-card has no 4px skeleton sliver"
    fi
    mirrors=$(strip_comments "$SUBSYSTEM" | grep -cE 'Skeleton className="h-2 w-full')
    if [ "$mirrors" -eq 4 ]; then
        ok "modem-subsystem-card mirrors all four bars at 8px"
    else
        bad "modem-subsystem-card has $mirrors 8px bar mirrors, expected 4"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[R0-7] DESIGN.md records the one thickness, and the row is Landed\n'
# The canon is amended in the SAME commit as the code. A doc that still
# describes the retired thickness is not a stale sentence here -- it is the
# binding spec disagreeing with the tree, and the next reader believes the doc.
if [ ! -f "$DESIGN_MD" ]; then
    bad "missing: DESIGN.md"
else
    if grep -qE '^\s+quality-bar: ".*8px' "$DESIGN_MD"; then
        ok "frontmatter quality-bar reads the 8px track"
    else
        bad "frontmatter quality-bar does not read the 8px track"
    fi
    if grep -q 'one thickness, everywhere' "$DESIGN_MD"; then
        ok "Quality bars states one thickness everywhere"
    else
        bad "Quality bars does not state one thickness everywhere"
    fi
    row=$(grep -n 'The quality bar ships two thicknesses' "$DESIGN_MD" | head -1)
    if [ -z "$row" ]; then
        bad "the bar-thickness Migration Deltas row is missing"
    else
        rowtext="${row#*:}"
        if printf '%s' "$rowtext" | grep -qE '\| Open \|?\s*$'; then
            bad "the bar-thickness Migration Deltas row still reads Open"
        elif printf '%s' "$rowtext" | grep -q 'Landed'; then
            ok "the bar-thickness Migration Deltas row reads Landed"
        else
            bad "the bar-thickness Migration Deltas row has no recognisable status"
        fi
    fi
fi

# -----------------------------------------------------------------------------
printf '\n-------------------------------------------------------------\n'
printf 'passed: %d   failed: %d\n' "$pass_count" "$fail_count"
if [ "$fail_count" -gt 0 ]; then
    printf 'RESULT: FAIL\n\n'
    exit 1
fi
printf 'RESULT: PASS\n\n'
exit 0
