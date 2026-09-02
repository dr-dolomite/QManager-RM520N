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

# =============================================================================
# SECTION 00 -- shapes module, page header, one clock, one heading
# =============================================================================
#
# Step 00 is the pre-step: it does not touch card grammar, it lays the
# foundation the other nine steps build on. Four things land in one commit:
#
#   1. components/dashboard/shapes.ts is MINTED -- modelled on
#      components/local-network/ethernet/shapes.ts -- to hold every geometry
#      constant this route needs. PillRow, a component currently declared
#      inline in device-metrics.tsx, MOVES into it (not copied -- a copy would
#      leave two definitions to drift).
#
#   2. components/dashboard/page-header.tsx is ADDED -- modelled on
#      components/cellular/radio/page-header.tsx -- giving the route the h1 +
#      description + rail-slot pattern every other route family already has.
#      Two new i18n keys, dashboard:page.title and dashboard:page.description,
#      land in all five locale packs.
#
#   3. home-component.tsx's five independent stagger containers COLLAPSE into
#      ONE parent that declares initial="hidden" animate="visible" over five
#      direct children. Nested containers keep their `variants` prop but must
#      NOT declare their own initial/animate -- a nested container that still
#      declares initial detaches itself from the parent clock and reintroduces
#      the "several independent containers" defect step 00 exists to retire.
#
#   4. The "several independent containers" comment block is deleted along
#      with the containers it was explaining.
#
# WHICH ASSERTION PINS WHAT
#   [00-1] shapes.ts exists
#   [00-2] each of the six contract exports is present, named individually so
#          a partial mint is not read as a pass
#   [00-3] PillRow has exactly one home, components/dashboard/pill-row.tsx,
#          and shapes.ts stays geometry-only. CORRECTED BEFORE THE FIX -- see
#          the note beside the assertion.
#   [00-4] PillRow is no longer declared in device-metrics.tsx -- this is what
#          turns [00-3] from "copied" into "moved"
#   [00-5] CLOCK_TICK_MS is declared exactly once across components/dashboard/**
#          -- today it is declared twice (live-latency.tsx, recent-activities.tsx)
#          and step 00's shapes module is where the single source of truth goes
#   [00-6] home-component.tsx declares initial="hidden" exactly once
#   [00-7] no OTHER file under components/dashboard/** declares its own
#          entrance initial -- the nested containers must inherit the parent
#          clock, not run their own.
#
#          NARROWED BY THE ORCHESTRATOR before this section was committed, and
#          the narrowing is the interesting part. The first draft banned every
#          initial attribute on the surface, which caught two constructions the
#          plan never asked for and which would break if they obeyed it:
#
#            recent-activities.tsx  Its two are event motion, not entrance
#                                   motion -- variant names `pushed` and
#                                   `settled`, driven by a row ARRIVING rather
#                                   than by the page mounting. The file's own
#                                   comment calls this "two entrances, never
#                                   both". A page-wide clock has no opinion
#                                   about an event that fires minutes later.
#            speedtest-dialog.tsx   A portal. It mounts when the dialog opens,
#                                   so it has no cascade parent to inherit
#                                   `visible` from. Strip its initial and the
#                                   dialog opens with no entrance at all.
#
#          So the assertion matches the entrance spelling specifically and
#          exempts the dialog. What remains is exactly the five row groups the
#          plan names: network-status x2, device-status, device-metrics,
#          signal-status-card.
#   [00-8] exactly one <h1 across app/dashboard/page.tsx,
#          components/dashboard/home-component.tsx and
#          components/dashboard/page-header.tsx combined
#   [00-9] components/dashboard/page-header.tsx exists and renders an h1
#   [00-10] components/dashboard/page-header.tsx renders a description element
#           (a second text node beneath the h1, not just the heading alone)
#   [00-11] the page.title / page.description keys exist in the dashboard
#           namespace of all five locale packs (en, zh-CN, zh-TW, it, id)
#
# SCOPINGS, stated openly so they are not mistaken for a weakened test
# ---------------------------------------------------------------------
#  [00-5] [00-7] are checked against comment-stripped source, same rationale
#         as R0-6: a JSDoc explaining why a value moved necessarily quotes the
#         old spelling, and failing on a comment would push the author to
#         delete the most useful sentence in the file.
#  [00-11] does not shell out to `bun run i18n:check` -- that command's own
#          green run is part of the approved contract but belongs to Phase 5
#          validation, not this harness. This assertion checks the two keys
#          directly so the harness stays self-contained and fast.
#  [00-11] locale JSON files on this repo are CRLF. The key search tolerates a
#          trailing carriage return rather than requiring one.
#
# Run: bash scripts/test/dashboard-design-language.sh
# =============================================================================

DASHBOARD="$COMPONENTS/dashboard"
SHAPES_00="$DASHBOARD/shapes.ts"
HOME_00="$DASHBOARD/home-component.tsx"
DEVICE_METRICS_00="$DASHBOARD/device-metrics.tsx"
PAGE_HEADER_00="$DASHBOARD/page-header.tsx"
PILL_ROW_00="$DASHBOARD/pill-row.tsx"
APP_PAGE_00="$REPO_ROOT/app/dashboard/page.tsx"
LOCALES_ROOT="$REPO_ROOT/public/locales"

printf '\n=============================================================\n'
printf 'SECTION 00 -- shapes module, page header, one clock, one heading\n'
printf '=============================================================\n'

# -----------------------------------------------------------------------------
printf '\n[00-1] components/dashboard/shapes.ts exists\n'
if [ -f "$SHAPES_00" ]; then
    ok "shapes.ts exists"
else
    bad "missing: components/dashboard/shapes.ts"
fi

# -----------------------------------------------------------------------------
printf '\n[00-2] the six contract exports are present in shapes.ts\n'
# Named individually rather than lumped so a partial mint is diagnosable from
# the harness output alone -- the reader should not have to open the file to
# learn which export is missing.
if [ ! -f "$SHAPES_00" ]; then
    bad "shapes.ts is missing -- cannot check exports"
else
    shapes_stripped="$TMPD/shapes.stripped"
    strip_comments "$SHAPES_00" > "$shapes_stripped"
    for member in CARD_SHELL HERO_SHELL ROW TILE LANE CLOCK_TICK_MS; do
        if grep -qE "export (const|function) $member\b" "$shapes_stripped"; then
            ok "shapes.ts exports $member"
        else
            bad "shapes.ts does not export $member"
        fi
    done
fi

# -----------------------------------------------------------------------------
printf '\n[00-3] PillRow has one home, and shapes.ts stays geometry-only\n'
# CORRECTED BY THE ORCHESTRATOR before the fix was written, so this section is
# still red-first. The first draft asserted an export of PillRow inside
# shapes.ts. That cannot be built: PillRow is a JSX component and shapes.ts is a
# .ts file, and every one of the thirteen sibling shapes modules in the product
# is geometry-only for exactly that reason. The approved Test Contract never
# listed PillRow among shapes.ts's exports either -- it names CARD_SHELL,
# HERO_SHELL, ROW, TILE, LANE and CLOCK_TICK_MS. What the plan actually asks for
# is that PillRow stop being file-local to device-metrics.tsx and gain ONE home
# that step 06 can import from too. A dedicated pill-row.tsx is that home, and
# shapes.ts keeps the ROW geometry it consumes.
if [ ! -f "$PILL_ROW_00" ]; then
    bad "missing: components/dashboard/pill-row.tsx"
elif ! strip_comments "$PILL_ROW_00" | grep -qE '(export (const|function)|export default function) PillRow\b'; then
    bad "pill-row.tsx does not export PillRow"
else
    ok "PillRow is exported from pill-row.tsx"
fi
if [ -f "$SHAPES_00" ]; then
    if grep -qE '<[A-Za-z]' "$TMPD/shapes.stripped"; then
        bad "shapes.ts contains JSX -- it must stay geometry-only, like its 13 siblings"
    else
        ok "shapes.ts is geometry-only"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[00-4] PillRow is no longer declared in device-metrics.tsx\n'
# Pins the MOVE, not a copy: [00-3] alone would pass if PillRow were merely
# duplicated into shapes.ts while the original definition stayed behind.
if [ ! -f "$DEVICE_METRICS_00" ]; then
    bad "missing: components/dashboard/device-metrics.tsx"
else
    if strip_comments "$DEVICE_METRICS_00" | grep -qE '(function|const) PillRow\b'; then
        bad "device-metrics.tsx still declares PillRow -- it should import it from pill-row.tsx"
    else
        ok "device-metrics.tsx no longer declares PillRow"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[00-5] CLOCK_TICK_MS is declared exactly once across components/dashboard/**\n'
# Today it is declared twice, independently, in live-latency.tsx and
# recent-activities.tsx. Step 00 gives it one home in shapes.ts; the other two
# sites must import it, not keep their own copy.
if [ -d "$DASHBOARD" ]; then
    decl_count=0
    decl_locs=""
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        n=$(strip_comments "$file" | grep -cE '^\s*(export\s+)?const\s+CLOCK_TICK_MS\b')
        if [ "$n" -gt 0 ]; then
            decl_count=$((decl_count + n))
            decl_locs="$decl_locs ${file#"$REPO_ROOT/"}"
        fi
    done <<< "$(grep -rl 'CLOCK_TICK_MS' "$DASHBOARD" --include='*.ts' --include='*.tsx' 2>/dev/null)"
    if [ "$decl_count" -eq 1 ]; then
        ok "CLOCK_TICK_MS is declared exactly once ($decl_locs)"
    else
        bad "CLOCK_TICK_MS is declared $decl_count times, expected 1 ($decl_locs)"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[00-6] home-component.tsx declares initial="hidden" exactly once\n'
if [ ! -f "$HOME_00" ]; then
    bad "missing: components/dashboard/home-component.tsx"
else
    n=$(strip_comments "$HOME_00" | grep -cE 'initial="hidden"')
    if [ "$n" -eq 1 ]; then
        ok "home-component.tsx declares initial=hidden exactly once"
    else
        bad "home-component.tsx declares initial=hidden $n times, expected 1"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[00-7] no nested dashboard container declares its own entrance initial\n'
# A nested stagger container keeps its `variants` prop but must not declare an
# entrance initial of its own -- doing so detaches it from the parent clock,
# which is exactly the "several independent containers" defect this step
# retires.
#
# Matches the ENTRANCE spelling only, and exempts the speedtest dialog. See the
# section header for why both narrowings are load-bearing rather than leniency:
# recent-activities keeps event motion on its own variant names, and a portal
# has no cascade parent to inherit from.
if [ -d "$DASHBOARD" ]; then
    stray=0
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        base="$(basename "$file")"
        [ "$base" = "home-component.tsx" ] && continue
        [ "$base" = "speedtest-dialog.tsx" ] && continue
        n=$(strip_comments "$file" | grep -cE '(^|[[:space:]])initial="hidden"')
        if [ "$n" -gt 0 ]; then
            bad "$base declares its own entrance initial ($n occurrence(s)) -- it should inherit the parent clock"
            stray=1
        fi
    done <<< "$(grep -rl 'initial=' "$DASHBOARD" --include='*.tsx' 2>/dev/null)"
    [ "$stray" -eq 0 ] && ok "every nested container inherits home-component.tsx's clock"
fi

# -----------------------------------------------------------------------------
printf '\n[00-8] exactly one <h1 across the dashboard route\n'
h1_total=0
h1_locs=""
for f in "$APP_PAGE_00" "$HOME_00" "$PAGE_HEADER_00"; do
    [ -f "$f" ] || continue
    n=$(strip_comments "$f" | grep -cE '<h1\b')
    if [ "$n" -gt 0 ]; then
        h1_total=$((h1_total + n))
        h1_locs="$h1_locs ${f#"$REPO_ROOT/"}(=$n)"
    fi
done
if [ "$h1_total" -eq 1 ]; then
    ok "exactly one <h1 across the dashboard route ($h1_locs)"
else
    bad "found $h1_total <h1 elements across the dashboard route, expected 1 ($h1_locs)"
fi

# -----------------------------------------------------------------------------
printf '\n[00-9] components/dashboard/page-header.tsx exists and renders an h1\n'
if [ ! -f "$PAGE_HEADER_00" ]; then
    bad "missing: components/dashboard/page-header.tsx"
else
    ok "page-header.tsx exists"
    if strip_comments "$PAGE_HEADER_00" | grep -qE '<h1\b'; then
        ok "page-header.tsx renders an h1"
    else
        bad "page-header.tsx does not render an h1"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[00-10] components/dashboard/page-header.tsx renders a description\n'
# Looks for a second text-bearing element after the h1 -- a description with
# no heading beside it is not the page-header pattern this step is adopting.
if [ ! -f "$PAGE_HEADER_00" ]; then
    bad "missing: components/dashboard/page-header.tsx -- cannot check description"
else
    stripped_ph=$(strip_comments "$PAGE_HEADER_00")
    if printf '%s\n' "$stripped_ph" | grep -qE '<(p|span|div)\b[^>]*>\s*\{?\s*t\('; then
        ok "page-header.tsx renders a translated description element"
    elif printf '%s\n' "$stripped_ph" | grep -qE '<(p|span)\b'; then
        ok "page-header.tsx renders a description element"
    else
        bad "page-header.tsx does not render a description element beneath the h1"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[00-11] page.title / page.description exist in dashboard.json for all five locales\n'
# Locale packs on this repo are CRLF -- the trailing carriage return is
# tolerated rather than required so the assertion survives either ending.
for loc in en zh-CN zh-TW it id; do
    locale_file="$LOCALES_ROOT/$loc/dashboard.json"
    if [ ! -f "$locale_file" ]; then
        bad "missing locale file: public/locales/$loc/dashboard.json"
        continue
    fi
    if grep -qE '"title"[[:space:]]*:' "$locale_file" && \
       grep -A3 '"page"[[:space:]]*:' "$locale_file" | grep -qE '"title"[[:space:]]*:'; then
        ok "$loc dashboard.json has page.title"
    else
        bad "$loc dashboard.json is missing page.title under a \"page\" section"
    fi
    if grep -A4 '"page"[[:space:]]*:' "$locale_file" | grep -qE '"description"[[:space:]]*:'; then
        ok "$loc dashboard.json has page.description"
    else
        bad "$loc dashboard.json is missing page.description under a \"page\" section"
    fi
done

# =============================================================================
# SECTION 01 -- Network Status
# =============================================================================
#
# The hero card. Step 01 is the first step that changes card grammar, and it is
# the largest single-file step in the pass: seven changes land in one commit.
#
#   1. The hero heading drops from the Display step to the 18px Title step every
#      other card uses, and the card gains a description. The Display step is
#      reserved for the page h1 -- "one per route" -- and step 00 gave the route
#      a real one, so the card no longer has to fake it.
#
#   2. The Card shell at the top of the file is written inline and is
#      BYTE-IDENTICAL to HERO_SHELL. It is re-pointed at the constant.
#
#   3. The SIM orb moves onto the strong fill. The Glyph-Disc Rule: a category
#      icon sits in a filled circle on the role's STRONG fill, never on the pale
#      container -- in light mode the containers collapse under CVD simulation
#      and the fills do not.
#
#   4. CALL B -- the Radio / Internet / Stale rail LEAVES this card. Those three
#      chips answer "is the whole thing up?", which is a question about the
#      route rather than about Network Status, so they render through the page
#      header's rail slot instead. They move UNCHANGED: the tone map, the
#      tooltip, the 44px touch target and the two-clock chip morph all travel
#      with them into components/dashboard/status-rail.tsx.
#
#      This UPHOLDS this card's existing reasoning rather than overturning it.
#      The comment beside the Stale chip argues against promoting it to a
#      BANNER -- "promoting it to a banner would cry wolf" -- and a page-header
#      chip is not a banner. /cellular/settings/apn-management is the precedent
#      for a header chip reporting a live fact.
#
#   5. The legacy full radius goes to the role scale, 18 sites in this file.
#
#   6. ORB / GLYPH / the badge lift stop being file-local. Step 00 minted them
#      in shapes.ts and this file still declared its own identical copies, so
#      until this step the surface carried exactly the drift the module exists
#      to prevent -- two declarations of one number, either of which a future
#      author could change alone.
#
#   7. The unreachable branch is ADDED. Six cards on this surface draw a dash or
#      a zero in the same slot as a real reading while the page banner says the
#      modem is unreachable, so the card and the banner disagree. This is the
#      first of the six to go honest.
#
# R3 -- THE ORBS SCALE AT PHONE WIDTH. Approved 2026-09-01.
# ---------------------------------------------------------------------
# The three orbs were a fixed 152px in a grid that stacked to one column on a
# narrow card, so on a phone they ran roughly 600px of orb and label before the
# reader reached anything else -- on the surface built for a thirty-second
# glance beside the modem. They now sit 3-across at every width and take their
# size from ONE custom property, which steps up at a card container query.
#
# THE ONE-RATIO REQUIREMENT IS THE INTERESTING PART, and it is what [01-11] and
# [01-13] pin between them. The ring stack is four concentric absolutely-
# positioned discs whose sizes only mean anything RELATIVE to each other: an
# outer ring, two inner rings and a core, in the proportions 1 : 0.7368 :
# 0.5263 : 0.3158. Re-typing four numbers at a second size is four chances to
# get one of them wrong, and a wrong one does not fail a build, a typecheck or
# a screenshot -- it just makes the stack very slightly not concentric. So the
# second size is not a second set of numbers at all: one property carries the
# orb size and every other dimension is a calc against it.
#
# WHICH ASSERTION PINS WHAT
#   [01-1]  no legacy full radius survives in the card OR in the rail carved
#           out of it -- the rail is new code on this step's budget, not a file
#           belonging to a later one
#   [01-2]  the heading is off the Display step and on the shared title class
#   [01-3]  the card carries a description, with an EXPLICIT ink class. The
#           shared primitive hardcodes a retired ink, so a description with no
#           class override renders the wrong grey -- see the scoping note below
#   [01-4]  the shell is the imported hero constant, not the inline copy
#   [01-5]  the SIM orb is on the strong fill and the pale container is gone
#   [01-6]  this file contains NO chip rail -- none of the seven symbols that
#           made it, and no tooltip import
#   [01-7]  the rail has exactly one home and it is status-rail.tsx
#   [01-8]  the rail is threaded from home-component.tsx into the page header's
#           slot, and page-header.tsx still accepts one
#   [01-9]  the chips moved UNCHANGED -- the four tone roles, the crossfade and
#           the 44px touch floor all survive the move
#   [01-10] ORB / GLYPH / the badge lift are declared once, in shapes.ts, and
#           imported here -- the skeleton and the loaded orb read one source
#   [01-11] shapes.ts carries BOTH orb sizes and derives every ring from one
#           property, so the four proportions cannot drift apart
#   [01-12] the unreachable branch exists, and it says so in all five locales
#   [01-13] the ring pulse is still gated by the ONE existing service gate, and
#           no hand-typed ring size survived the scaling
#   [01-14] the three recorded icon exceptions are still present, so a drive-by
#           icon sweep through this file goes red
#
# SCOPINGS, stated openly so they are not mistaken for a weakened test
# ---------------------------------------------------------------------
#  [01-3] asserts that the description element carries an ink class, NOT that a
#         retired ink is absent from this directory. Grepping the directory
#         would prove nothing: the retired ink is baked into
#         components/ui/card.tsx, so it never appears here whether the call
#         site overrides it or not. Fixing the primitive touches every card in
#         the product and is its own tracked delta.
#  [01-6] [01-10] [01-13] are checked against comment-stripped source, same
#         rationale as R0-6 and 00-5: the file's JSDoc necessarily quotes the
#         values and symbols being retired, and failing on a comment pushes the
#         author to delete the reasoning rather than the code.
#  [01-11] does not spell complete utility classes in its grep patterns. This
#         harness is a non-gitignored file, so Tailwind's content scan extracts
#         class-shaped strings out of it and compiles them into real CSS. A
#         concrete class naming a property that exists costs one dead rule; a
#         malformed one can make the whole stylesheet unparseable. The patterns
#         below match the calc fragment only.
#  [01-12] checks the locale keys directly rather than shelling out to the
#         i18n parity gate, same as 00-11, and tolerates the CRLF endings the
#         locale packs ship with.
#
# Run: bash scripts/test/dashboard-design-language.sh
# =============================================================================

NS_01="$DASHBOARD/network-status.tsx"
RAIL_01="$DASHBOARD/status-rail.tsx"
SHAPES_01="$SHAPES_00"
HOME_01="$HOME_00"
PAGE_HEADER_01="$PAGE_HEADER_00"

printf '\n=============================================================\n'
printf 'SECTION 01 -- Network Status\n'
printf '=============================================================\n'

ns_stripped="$TMPD/network-status.stripped"
if [ -f "$NS_01" ]; then
    strip_comments "$NS_01" > "$ns_stripped"
else
    : > "$ns_stripped"
fi

rail_stripped="$TMPD/status-rail.stripped"
if [ -f "$RAIL_01" ]; then
    strip_comments "$RAIL_01" > "$rail_stripped"
else
    : > "$rail_stripped"
fi

# -----------------------------------------------------------------------------
printf '\n[01-1] no legacy full radius in the card or in the rail carved out of it\n'
# The role scale is 12/20/28/36/40 plus pill. The legacy chain still RESOLVES,
# which is why this is a grammar defect rather than a visual one: nothing looks
# wrong today, and the next author copies the spelling that was already there.
if [ ! -f "$NS_01" ]; then
    bad "missing: components/dashboard/network-status.tsx"
else
    n=$(grep -c 'rounded-full' "$ns_stripped")
    if [ "$n" -eq 0 ]; then
        ok "network-status.tsx is off the legacy full radius"
    else
        bad "network-status.tsx still has $n legacy full-radius call sites, expected 0"
    fi
fi
if [ -f "$RAIL_01" ]; then
    n=$(grep -c 'rounded-full' "$rail_stripped")
    if [ "$n" -eq 0 ]; then
        ok "status-rail.tsx is off the legacy full radius"
    else
        bad "status-rail.tsx has $n legacy full-radius call sites, expected 0"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[01-2] the hero heading is off the Display step\n'
# The page-title size is the Display step, and Typography > Hierarchy says one
# per route. The route has a real page title now, so a card wearing that size
# is a second one.
if [ -f "$NS_01" ]; then
    if grep -q 'text-\[30px\]' "$ns_stripped"; then
        bad "network-status.tsx still sets its heading at the page-title size"
    else
        ok "the hero heading is no longer at the page-title size"
    fi
    if grep -qE '\bCARD_TITLE\b' "$ns_stripped"; then
        ok "the heading reads CARD_TITLE from shapes.ts"
    else
        bad "network-status.tsx does not use CARD_TITLE"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[01-3] the card carries a description with an explicit ink class\n'
# Written as "the element carries a class", never as "a retired ink is absent".
# See the scoping note in the section header: the retired ink lives inside the
# shared card primitive, so a directory grep is silent either way.
if [ -f "$NS_01" ]; then
    if grep -q 'CardDescription' "$ns_stripped"; then
        ok "network-status.tsx renders a CardDescription"
        if grep 'CardDescription' "$ns_stripped" | grep -qE 'className=\{?(CARD_DESC|`|")'; then
            ok "the description carries an explicit ink class"
        else
            bad "the CardDescription has no explicit ink class -- it inherits the retired ink from the primitive"
        fi
    else
        bad "network-status.tsx renders no CardDescription"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[01-4] the shell is the imported hero constant\n'
# The inline string in this file is byte-identical to HERO_SHELL, which is what
# makes the re-point provably zero-visual-change.
if [ -f "$NS_01" ]; then
    if grep -qE '\bHERO_SHELL\b' "$ns_stripped"; then
        ok "the Card reads HERO_SHELL"
    else
        bad "network-status.tsx does not use HERO_SHELL"
    fi
    if grep -q 'rounded-hero border-0 px-7' "$ns_stripped"; then
        bad "the inline hero shell string still ships alongside the constant"
    else
        ok "the inline hero shell string is gone"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[01-5] the SIM orb is on the strong fill\n'
# The Glyph-Disc Rule. A 152px category disc on the pale container is the one
# place on this surface where the identity colour is least legible -- the
# containers collapse under CVD simulation in light mode and the fills do not.
if [ -f "$NS_01" ]; then
    if grep -q 'bg-primary-container' "$ns_stripped"; then
        bad "network-status.tsx still paints an orb on the pale primary container"
    else
        ok "no orb sits on the pale primary container"
    fi
    if grep -q 'bg-primary text-primary-foreground' "$ns_stripped"; then
        ok "an orb sits on the strong primary fill"
    else
        bad "no orb sits on the strong primary fill"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[01-6] network-status.tsx contains no chip rail\n'
# Named symbol by symbol rather than as one grep, so a partial move is
# diagnosable from the output alone. A rail half-moved is worse than one not
# moved: two files would then own the tone map.
if [ -f "$NS_01" ]; then
    rail_left=0
    for sym in CHIP_BASE CHIP_TONE ChipTone buildRadioChip buildInternetChip InternetChip InternetDot; do
        if grep -qE "(^|[^A-Za-z_])$sym\b" "$ns_stripped"; then
            bad "network-status.tsx still carries the chip rail symbol $sym"
            rail_left=1
        fi
    done
    [ "$rail_left" -eq 0 ] && ok "none of the seven chip-rail symbols remain in network-status.tsx"
    if grep -q 'components/ui/tooltip' "$ns_stripped"; then
        bad "network-status.tsx still imports the tooltip -- only the Internet chip used it"
    else
        ok "network-status.tsx no longer imports the tooltip"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[01-7] the rail has exactly one home\n'
if [ ! -f "$RAIL_01" ]; then
    bad "missing: components/dashboard/status-rail.tsx"
else
    if grep -qE 'export (const|function|default function) DashboardStatusRail\b' "$rail_stripped"; then
        ok "status-rail.tsx exports DashboardStatusRail"
    else
        bad "status-rail.tsx does not export DashboardStatusRail"
    fi
    rail_missing=0
    for sym in CHIP_TONE buildRadioChip buildInternetChip; do
        if ! grep -qE "(^|[^A-Za-z_])$sym\b" "$rail_stripped"; then
            bad "status-rail.tsx does not carry $sym -- the rail did not move whole"
            rail_missing=1
        fi
    done
    [ "$rail_missing" -eq 0 ] && ok "the tone map and both chip builders live in status-rail.tsx"
fi

# -----------------------------------------------------------------------------
printf '\n[01-8] the rail is threaded into the page header from home-component.tsx\n'
# Call B is only done when the chips RENDER in the header. A rail component that
# exists and is never mounted would satisfy [01-6] and [01-7] and ship a page
# header with an empty slot.
if [ -f "$HOME_01" ]; then
    home_stripped="$TMPD/home.stripped"
    strip_comments "$HOME_01" > "$home_stripped"
    if grep -q 'DashboardStatusRail' "$home_stripped"; then
        ok "home-component.tsx renders the status rail"
    else
        bad "home-component.tsx does not render the status rail"
    fi
    if grep -qE 'rail=\{' "$home_stripped"; then
        ok "home-component.tsx passes a rail into the page header"
    else
        bad "home-component.tsx renders the page header with no rail"
    fi
fi
if [ -f "$PAGE_HEADER_01" ]; then
    if strip_comments "$PAGE_HEADER_01" | grep -qE '\brail\b'; then
        ok "page-header.tsx still accepts a rail"
    else
        bad "page-header.tsx no longer accepts a rail"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[01-9] the chips moved unchanged\n'
# The three things most likely to be lost in a move, because each is invisible
# in a screenshot: the four-role tone map, the two-clock morph, and the touch
# target that lifts a 30px chip to the 44px floor without shifting layout.
if [ -f "$RAIL_01" ]; then
    tone_members=$(grep -cE '^\s+(success|warning|destructive|muted):' "$rail_stripped")
    if [ "$tone_members" -eq 4 ]; then
        ok "the chip tone map still carries its four roles"
    else
        bad "the chip tone map has $tone_members roles, expected 4"
    fi
    if grep -q 'SwapLabel' "$rail_stripped"; then
        ok "the chip crossfade survived the move"
    else
        bad "the chips no longer use SwapLabel -- the two-clock morph was lost"
    fi
    if grep -q 'before:-inset-\[7px\]' "$rail_stripped"; then
        ok "the 44px touch floor survived the move"
    else
        bad "the Internet chip lost its 44px touch target"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[01-10] the orb geometry is declared once, in shapes.ts\n'
# Step 00 minted these and this file kept its own identical copies, so until now
# the surface carried two declarations of one number -- the exact failure a
# shapes module exists to remove, sitting inside the module that removed it.
if [ -f "$NS_01" ]; then
    dup=0
    for sym in ORB GLYPH BADGE_SHADOW; do
        if grep -qE "^\s*const\s+$sym\b" "$ns_stripped"; then
            bad "network-status.tsx still declares its own $sym"
            dup=1
        fi
    done
    [ "$dup" -eq 0 ] && ok "network-status.tsx declares no orb geometry of its own"
    if grep -q 'from "./shapes"' "$ns_stripped"; then
        ok "network-status.tsx imports from shapes.ts"
    else
        bad "network-status.tsx does not import from shapes.ts"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[01-11] shapes.ts carries both orb sizes and one ring ratio\n'
# Both sizes in one place is what lets the skeleton read the same pair as the
# loaded orb. One ratio is what stops the four concentric discs drifting: their
# sizes only mean anything relative to each other, and a wrong one fails no
# build, no typecheck and no screenshot.
if [ ! -f "$SHAPES_01" ]; then
    bad "shapes.ts is missing -- cannot check the orb scale"
else
    shapes_01="$TMPD/shapes01.stripped"
    strip_comments "$SHAPES_01" > "$shapes_01"
    orb_block=$(awk '/^export const ORB = \{/{f=1} f{print} /^\} as const;/{if(f) exit}' "$shapes_01")
    if [ -z "$orb_block" ]; then
        bad "shapes.ts does not export an ORB block"
    else
        ok "shapes.ts exports an ORB block"
        if printf '%s\n' "$orb_block" | grep -q '92px' && printf '%s\n' "$orb_block" | grep -q '152px'; then
            ok "the ORB block declares both the compact and the full size"
        else
            bad "the ORB block does not declare both orb sizes"
        fi
        derived=$(printf '%s\n' "$orb_block" | grep -c 'calc(var(--orb)')
        if [ "$derived" -ge 4 ]; then
            ok "the ring stack derives $derived dimensions from the one orb property"
        else
            bad "only $derived orb dimensions are derived from the shared property, expected at least 4"
        fi
        legacy_ring=0
        for legacy in '112px' '80px' '48px' '96px'; do
            if printf '%s\n' "$orb_block" | grep -q "$legacy"; then
                bad "the ORB block still hand-types the $legacy ring -- it must derive from the ratio"
                legacy_ring=1
            fi
        done
        [ "$legacy_ring" -eq 0 ] && ok "no ring dimension is hand-typed in the ORB block"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[01-12] the unreachable branch exists, in all five locales\n'
# The page banner already says the modem is unreachable. Before this step the
# card underneath it drew a full, confident set of orbs from a payload that was
# never read, so the two disagreed.
if [ -f "$NS_01" ]; then
    if grep -qE '(^|[^A-Za-z_])unreachable\b' "$ns_stripped"; then
        ok "network-status.tsx branches on reachability"
    else
        bad "network-status.tsx has no unreachable branch"
    fi
    if grep -q 'signal_cellular_off' "$ns_stripped"; then
        ok "the unreachable orb carries the no-signal glyph"
    else
        bad "the unreachable branch has no no-signal glyph"
    fi
    for key in 'network.description_unreachable' 'network.unreachable'; do
        if grep -q "$key" "$ns_stripped"; then
            ok "network-status.tsx reads $key"
        else
            bad "network-status.tsx does not read $key"
        fi
    done
fi
for loc in en zh-CN zh-TW it id; do
    locale_file="$LOCALES_ROOT/$loc/dashboard.json"
    if [ ! -f "$locale_file" ]; then
        bad "missing locale file: public/locales/$loc/dashboard.json"
        continue
    fi
    # Scoped to the "network" object, not to the whole file. The dashboard pack
    # already carries a page.description from step 00, so a file-wide grep for
    # "description" passes before this step is written -- a false green on the
    # one key most likely to be forgotten.
    net_block=$(awk '/^  "network": \{/{f=1} f{print} f && /^  \},?$/{exit}' "$locale_file")
    miss=0
    if [ -z "$net_block" ]; then
        bad "$loc dashboard.json has no network block"
        miss=1
    else
        for key in description description_unreachable unreachable sim_generic; do
            if ! printf '%s
' "$net_block" | grep -qE "\"$key\"[[:space:]]*:"; then
                bad "$loc dashboard.json is missing network.$key"
                miss=1
            fi
        done
    fi
    [ "$miss" -eq 0 ] && ok "$loc dashboard.json has all four new network keys"
done

# -----------------------------------------------------------------------------
printf '\n[01-13] one pulse gate, and no hand-typed ring size\n'
# The One-Loop Rule: an ambient loop only runs where something is genuinely
# live. The service gate that does this is already correct and this step must
# VERIFY it rather than add a second one -- two gates on one loop is how a
# later author removes the wrong one.
if [ -f "$NS_01" ]; then
    gates=$(grep -c 'isServiceActive ?' "$ns_stripped")
    if [ "$gates" -eq 1 ]; then
        ok "the ring pulse has exactly one gate"
    else
        bad "the ring pulse has $gates gates, expected 1"
    fi
    rings=$(grep -c 'animate-pulse-ring' "$ns_stripped")
    if [ "$rings" -eq 3 ]; then
        ok "all three rings still breathe on the live branch"
    else
        bad "found $rings pulsing rings, expected 3"
    fi
    hand=0
    for legacy in '152px' '112px' '80px' '48px' '96px'; do
        if grep -q "size-\[$legacy\]" "$ns_stripped"; then
            bad "network-status.tsx still hand-types the $legacy orb dimension"
            hand=1
        fi
    done
    [ "$hand" -eq 0 ] && ok "no orb dimension is hand-typed in the component"
fi

# -----------------------------------------------------------------------------
printf '\n[01-14] the three recorded icon exceptions survive\n'
# DESIGN.md > Icons records all three as deliberate: the SIM card and its
# airplane stand-in are landmarks on the one glance surface, and the RAT marks
# are typographic, not pictorial -- Material Symbols has no equivalent. Pinned
# so a drive-by icon sweep through this file goes red rather than quiet.
if [ -f "$NS_01" ]; then
    if grep -qE 'CardSimIcon.*Plane|Plane.*CardSimIcon' "$ns_stripped"; then
        ok "the lucide SIM and airplane landmarks are present"
    else
        bad "the lucide SIM / airplane landmark exception was swept"
    fi
    rat=0
    for mark in MdOutline5G Md4gMobiledata Md4gPlusMobiledata Md3gMobiledata; do
        grep -q "$mark" "$ns_stripped" || { bad "the RAT mark $mark was swept"; rat=1; }
    done
    [ "$rat" -eq 0 ] && ok "all four react-icons RAT marks are present"
fi

# =============================================================================
# SECTION 02 -- NR / LTE signal pair
# =============================================================================
#
# signal-status-card.tsx is the reference implementation DESIGN.md cites under
# Signature surfaces, so the ramp subsystem inside it is deliberately NOT
# rewritten. Four things change, and one of them is a re-authoring.
#
#   R2 -- THE TWO PASS-THROUGH WRAPPERS COLLAPSE INTO ONE BUILDER. Approved
#   2026-09-01. nr-status.tsx (78 lines) and lte-status.tsx (74) render nothing
#   at all. Each maps one poller block to SignalStatusRow[] and forwards the
#   same six props. They differ in which block they read and which labels they
#   use -- and in two rows, not one: NR carries SCS and LTE carries RSSI. Both
#   are replaced by buildSignalRows(family, data, t) in signal-rows.ts, and
#   home-component.tsx renders the card directly.
#
#   The payoff is not the line count. The threshold table and the absent-value
#   formatter stop existing in two copies that can drift, and -- the reason
#   this lands in the same commit as the state work below -- the no-reading
#   state gets written ONCE instead of twice.
#
#   1. The shell comes from shapes.ts. It was inlined twice inside this one
#      file, once for the loaded card and once for its own skeleton, which is
#      the shape of drift that has already been deleted twice elsewhere in the
#      product.
#
#   2. The card gains a description, at the surface's secondary ink. Zero
#      CardDescription shipped on the whole dashboard.
#
#   3. THE NO-READING STATE. This is the substantive change. The card used one
#      predicate -- "does this row have BOTH a threshold set and a live
#      value?" -- to decide the bar, the ink and the screen-reader word
#      together. A measurement whose reading did not arrive therefore came out
#      byte-identical to an identifier that has no scale at all: no bar, no
#      ink, no announced word, and a hyphen. The two must not look the same.
#      An ARFCN has no position on a quality scale; an RSRP has one and we
#      failed to read it.
#
#      The predicate splits. Whether a row is a MEASUREMENT is a property of
#      the row -- it declares a threshold set. Whether it has a READING is a
#      property of this poll. A measurement with no reading draws an EMPTY
#      TRACK, takes the neutral ink, and announces "no reading" -- which is
#      also why the copy for that stop stops saying "No signal". "We did not
#      measure" is not "we measured zero", and qualityInkClass's own comment
#      has said so since the ramp was minted.
#
# WHAT THIS SECTION DELIBERATELY DOES AND DOES NOT PIN
# ---------------------------------------------------------------------
# [02-9] pins the untouched subsystem POSITIVELY -- the glyph ladder import,
#        the meter-tone import, the TickGroup ranking, the identity tag, and
#        the inherited cascade all have to still be there. A step described as
#        "nearly untouched by design" needs an assertion that fails when a
#        future author tidies one of those away, not only assertions on the
#        parts that moved.
# [02-6] cannot assert what renders. It asserts that the two predicates are
#        distinct named symbols and that a render site reaches for the wider
#        one, which is the structural form of the defect.
# [02-7] bans a fallback tone on the same line as the meter tone or the colour
#        override. qualityMeterTone returns null for "none" on purpose, and the
#        bug it replaces was a surface quietly defaulting that null to a colour
#        and painting an unread antenna green. A null-coalesce that only
#        normalises undefined to null is not that, so the ban is scoped to the
#        two expressions that actually carry a tone.
# [02-3] [02-4] [02-5] [02-6] [02-7] [02-8] [02-9] run against comment-stripped
#        source, same rationale as R0-6, 00-5 and 01-6: the file's JSDoc
#        necessarily quotes the symbols and values being retired, and failing
#        on a comment pushes the author to delete the reasoning rather than
#        the code.
# [02-10] checks the locale keys directly and tolerates the CRLF endings the
#        packs ship with, same as 00-11 and 01-12. It extracts the signal_card
#        object first -- a whole-file grep for a common key name is how
#        SECTION 01 nearly shipped a false green.
# EVERY class spelling quoted below is a real utility already emitted
#        elsewhere in this repo, so Tailwind's content scan extracting one out
#        of this file costs nothing. No pattern here invents a class-shaped
#        string that does not already exist.
#
# Run: bash scripts/test/dashboard-design-language.sh
# =============================================================================

CARD_02="$DASHBOARD/signal-status-card.tsx"
ROWS_02="$DASHBOARD/signal-rows.ts"
NR_02="$DASHBOARD/nr-status.tsx"
LTE_02="$DASHBOARD/lte-status.tsx"
SHAPES_02="$SHAPES_00"
HOME_02="$HOME_00"

printf '\n=============================================================\n'
printf 'SECTION 02 -- NR / LTE signal pair\n'
printf '=============================================================\n'

card_stripped="$TMPD/signal-status-card.stripped"
if [ -f "$CARD_02" ]; then
    strip_comments "$CARD_02" > "$card_stripped"
else
    : > "$card_stripped"
fi

rows_stripped="$TMPD/signal-rows.stripped"
if [ -f "$ROWS_02" ]; then
    strip_comments "$ROWS_02" > "$rows_stripped"
else
    : > "$rows_stripped"
fi

home_stripped_02="$TMPD/home-component.02.stripped"
if [ -f "$HOME_02" ]; then
    strip_comments "$HOME_02" > "$home_stripped_02"
else
    : > "$home_stripped_02"
fi

# -----------------------------------------------------------------------------
printf '\n[02-1] R2 -- the two pass-through wrappers are gone\n'
# Neither file rendered anything. A component whose entire body is "map this
# object to that prop bundle" is a function wearing a component's costume, and
# two of them side by side are two copies of one function.
if [ -f "$NR_02" ]; then
    bad "nr-status.tsx still exists -- R2 replaces it with the row builder"
else
    ok "nr-status.tsx is gone"
fi
if [ -f "$LTE_02" ]; then
    bad "lte-status.tsx still exists -- R2 replaces it with the row builder"
else
    ok "lte-status.tsx is gone"
fi
if [ -f "$ROWS_02" ]; then
    ok "components/dashboard/signal-rows.ts exists"
    if grep -q 'buildSignalRows' "$rows_stripped"; then
        ok "signal-rows.ts declares buildSignalRows"
    else
        bad "signal-rows.ts does not declare buildSignalRows"
    fi
    if grep -qE '\bfamily\b' "$rows_stripped"; then
        ok "the builder branches on the radio family rather than on the payload shape"
    else
        bad "signal-rows.ts never mentions family -- the two legs are not the same list"
    fi
else
    bad "missing: components/dashboard/signal-rows.ts"
fi

# -----------------------------------------------------------------------------
printf '\n[02-2] the threshold table is imported in one dashboard file, not three\n'
# Two copies of a threshold set is two chances for one of them to move. This is
# the drift R2 is actually buying, and it is the assertion that fails if a
# future author re-inlines a row list into a card.
if [ -d "$DASHBOARD" ]; then
    n=$(grep -rl 'RSRP_THRESHOLDS' "$DASHBOARD" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$n" -le 2 ]; then
        ok "the threshold table is imported in $n dashboard file(s)"
    else
        bad "the threshold table is imported in $n dashboard files -- R2 collapses the copies"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[02-3] home-component renders the card directly\n'
# The wrappers existed only to be rendered from here. If they are gone and this
# file does not name the card, the pair is not on the page at all.
if [ -f "$HOME_02" ]; then
    if grep -q 'SignalStatusCard' "$home_stripped_02"; then
        ok "home-component.tsx renders SignalStatusCard"
    else
        bad "home-component.tsx does not render SignalStatusCard"
    fi
    if grep -q 'buildSignalRows' "$home_stripped_02"; then
        ok "home-component.tsx builds its rows through the shared builder"
    else
        bad "home-component.tsx does not call buildSignalRows"
    fi
    if grep -qE 'nr-status|lte-status' "$home_stripped_02"; then
        bad "home-component.tsx still imports a retired wrapper"
    else
        ok "no retired wrapper import survives in home-component.tsx"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[02-4] the shell and the row geometry are imported, not inlined\n'
# The shell was written out twice inside this one file -- once for the card and
# once for its own skeleton -- which is the exact pair a shapes module exists
# to keep in step. The skeleton is the half that silently rots: nothing renders
# both at once, so a divergence is invisible until the handoff moves.
if [ ! -f "$CARD_02" ]; then
    bad "missing: components/dashboard/signal-status-card.tsx"
else
    if grep -qE '\bCARD_SHELL\b' "$card_stripped"; then
        ok "the shell reads CARD_SHELL from shapes.ts"
    else
        bad "signal-status-card.tsx does not use CARD_SHELL"
    fi
    n=$(grep -c 'rounded-card border-0' "$card_stripped")
    if [ "$n" -eq 0 ]; then
        ok "no inline copy of the card shell survives"
    else
        bad "signal-status-card.tsx still inlines the shell $n time(s)"
    fi
    if grep -qE '\bROW\.' "$card_stripped"; then
        ok "the metric row reads its geometry from shapes.ts"
    else
        bad "signal-status-card.tsx does not use the ROW shape group"
    fi
    if grep -qE '\bLANE\b' "$card_stripped"; then
        ok "the quality-bar lane is the imported constant"
    else
        bad "signal-status-card.tsx inlines the quality-bar lane width"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[02-5] the skeleton mirrors by importing, not by restating\n'
# The Skeleton-Mirror Rule. Both of these numbers are derived -- 40px is a 20px
# line box plus 10px of padding either side, 30px is a border, 6px of padding,
# a 16px content box and the same back again -- and a derived number restated
# in a second place is a number that can be re-derived wrong.
if [ -f "$CARD_02" ]; then
    if grep -qE '"h-10"|h-10 |h-10"' "$card_stripped"; then
        bad "the skeleton still restates the row height instead of importing it"
    else
        ok "the row skeleton does not restate the row height"
    fi
    if grep -q 'h-\[30px\]' "$card_stripped"; then
        bad "the skeleton still restates the chip height instead of importing it"
    else
        ok "the chip skeleton does not restate the chip height"
    fi
fi
if [ -f "$SHAPES_02" ]; then
    if grep -qE '^export const TAG_HEIGHT' "$SHAPES_02"; then
        ok "shapes.ts carries the chip height for the chip and its skeleton alike"
    else
        bad "shapes.ts does not export TAG_HEIGHT"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[02-6] a measurement and a reading are two different questions\n'
# THE CORE OF THE STEP. One predicate decided the bar, the ink and the
# screen-reader word together, so a measurement that failed to arrive rendered
# byte-identical to an identifier that has no scale at all.
if [ -f "$CARD_02" ]; then
    if grep -q 'isMeasurement' "$card_stripped"; then
        ok "the card names the measurement predicate separately"
    else
        bad "signal-status-card.tsx has no separate measurement predicate"
    fi
    if grep -q 'isTinted' "$card_stripped"; then
        bad "the single combined predicate survives -- a failed reading still looks like an identifier"
    else
        ok "the combined predicate is retired"
    fi
    if grep -q 'sr-only' "$card_stripped"; then
        ok "the screen-reader quality word is still rendered"
    else
        bad "the sr-only quality word was dropped -- colour and length are the only channels left"
    fi
    if grep -q 'isMeasurement &&' "$card_stripped"; then
        ok "a render site is gated on the measurement, not on the reading"
    else
        bad "no render site is gated on the measurement predicate"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[02-7] no fallback tone is defaulted in\n'
# qualityMeterTone returns null for "none" deliberately: a missing reading has
# no correct fill colour, so the absence is a null the caller has to handle.
# active-bands-card.tsx let that null fall through a default arm to success and
# painted an unread antenna green. Never again on this surface.
if [ -f "$CARD_02" ]; then
    if grep -E 'qualityMeterTone|colorOverride' "$card_stripped" | grep -q '??'; then
        bad "a tone expression defaults its null away"
    else
        ok "the meter tone and the colour override carry no fallback"
    fi
    if grep -qE 'value=\{rowPercent\}' "$card_stripped"; then
        ok "the bar's value is the nullable percentage, so no reading draws an empty track"
    else
        bad "the MetricBar value is not the nullable percentage"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[02-8] an absent value is an em dash, matched against a shared sentinel\n'
# The identity pill falls back to plain ink when the band is absent, because a
# pill wrapping a placeholder reads as a broken chip rather than as missing
# data. That guard compared against a hyphen literal, so changing the
# placeholder in the builder without changing the guard would silently ship
# exactly the broken chip the guard exists to prevent.
if [ -f "$CARD_02" ]; then
    if grep -qE '\bABSENT\b' "$card_stripped"; then
        ok "the card matches the absent-value sentinel by name"
    else
        bad "signal-status-card.tsx has no shared absent-value sentinel"
    fi
    if grep -qE '!== "-"' "$card_stripped"; then
        bad "the identity guard still compares against a hyphen literal"
    else
        ok "no hyphen literal survives in the identity guard"
    fi
fi
if [ -f "$ROWS_02" ]; then
    if grep -qE '\bABSENT\b' "$rows_stripped"; then
        ok "the builder emits the shared sentinel"
    else
        bad "signal-rows.ts does not use the shared absent-value sentinel"
    fi
    if grep -qE '"-"' "$rows_stripped"; then
        bad "signal-rows.ts still emits a bare hyphen placeholder"
    else
        ok "no bare hyphen placeholder survives in the builder"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[02-9] the reference subsystem is still intact\n'
# This card is what DESIGN.md cites under Signature surfaces. The step is
# explicitly scoped AWAY from the ramp, so these are pinned positively: an
# assertion that only watches what moved cannot notice a future author tidying
# away what did not.
if [ -f "$CARD_02" ]; then
    keep=0
    for sym in QUALITY_GLYPH qualityMeterTone TickGroup MetricBar SwapLabel TickingValue staggerRows staggerRowItem; do
        grep -q "$sym" "$card_stripped" || { bad "the reference subsystem lost $sym"; keep=1; }
    done
    [ "$keep" -eq 0 ] && ok "the glyph ladder, meter tone, ranking, swap and cascade are all present"
    if grep -q 'identityVariant' "$card_stripped"; then
        ok "the identity-tag treatment survives -- the chip fill still carries the radio"
    else
        bad "the identity tag was swept; the chip fill no longer carries the radio"
    fi
    if grep -qE 'initial=|animate=' "$card_stripped"; then
        bad "this cascade declares its own clock again -- it must inherit the page-wide one"
    else
        ok "the row cascade still inherits the page-wide clock"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[02-10] the locale packs carry the new copy on every language\n'
# The description is new. quality_none changes meaning: "No signal" asserts a
# measurement of zero, which is the one thing this stop explicitly does not
# mean. Extract the signal_card object first.
for lang in en zh-CN zh-TW it id; do
    lf="$REPO_ROOT/public/locales/$lang/dashboard.json"
    if [ ! -f "$lf" ]; then
        bad "missing locale pack: $lang/dashboard.json"
        continue
    fi
    block=$(awk '/^  "signal_card": \{/{f=1} f{print} f && /^  \},?\r?$/{exit}' "$lf")
    if printf '%s' "$block" | grep -q '"description"'; then
        ok "$lang carries signal_card.description"
    else
        bad "$lang is missing signal_card.description"
    fi
    if printf '%s' "$block" | grep -q '"quality_none"'; then
        ok "$lang carries signal_card.quality_none"
    else
        bad "$lang is missing signal_card.quality_none"
    fi
done
if grep -q '"quality_none": "No signal"' "$REPO_ROOT/public/locales/en/dashboard.json"; then
    bad "the no-reading stop still reads as a measurement of zero in English"
else
    ok "the no-reading stop no longer claims a zero measurement"
fi

# =============================================================================
# SECTION 03 -- Device Information
# =============================================================================
#
# The right rail of the hero band. It is the surface's densest card -- nine
# identity rows, a 188px device mark and two uptime figures -- and it carries
# more of the pass's findings than any other single file: 02, 04, 05, 07, 09,
# 12 and 13 all name it.
#
# WHAT CHANGES, AND WHY EACH ONE IS NOT A TASTE CALL
# ---------------------------------------------------------------------
#
#   1. THE HEADING JOINS THE RAMP. `text-2xl @[250px]/card:text-3xl` is a PAGE
#      title's size, and this card wore it while five siblings on the same
#      screen wore `text-lg`. Three page-title-sized headings on one screen is
#      three things claiming to be the top of the hierarchy, which is the same
#      as none of them claiming it. It takes CARD_TITLE, and gains the
#      description the whole surface was missing.
#
#   2. CALL C -- THE 188px SLAB GOES NEUTRAL. Approved 2026-09-01. A
#      `primary-container` disc 188px across is the largest single area of role
#      colour on the route, and what it is encoding is "a photograph of a modem
#      goes here". The Data-Ink Rule spends colour on things that report; the
#      mark reports nothing, so the slab goes `surface-container` and the hue
#      goes back to the cards that are measuring something.
#
#      THE MARK STAYS 188px. Shrinking it was considered and REJECTED ON
#      MEASUREMENT: this card is h-full-locked to a left column carrying the
#      hero PLUS the carrier pair, so it has slack, and the mark is partly what
#      fills it. Neutralising is Call C; shrinking is a different change that
#      was not approved, and [03-2] pins the size so the two do not get
#      conflated by a later reader.
#
#   3. THE UPTIME TILES STOP ENCODING THEIR STATE IN THE BODY FILL. Shipped,
#      the connection tile is a `success-container` slab with NO GLYPH, beside
#      an identically shaped neutral tile. That is colour as the sole channel,
#      on the one pairing where it is least survivable: the two tiles are the
#      same shape, the same size and adjacent, so a reader who cannot separate
#      the fills has nothing else to read. They become the canonical TILE --
#      neutral body, a 52px disc carrying the colour, and A DISTINCT GLYPH
#      EACH.
#
#   4. THE ROWS BECOME THE CANONICAL PILL. `px-[15px]` against the module's
#      `px-4` is divergence 1, recorded in shapes.ts at step 00 and owned here.
#      One pixel is not the point; a second spelling of one row is.
#
#   5. THE UNREACHABLE BRANCH. Finding 13. And the split it makes is the whole
#      value of the branch: an IDENTIFIER does not go stale. A firmware version
#      read four seconds ago is still this modem's firmware version when the
#      next poll fails, so the identity rows KEEP their last-known values. The
#      two uptime figures are the opposite -- they are measurements of a clock
#      that is still running while we cannot see it -- so they go to the absent
#      sentinel on a muted disc. Blanking the rows would throw away nine true
#      facts to report one unknown.
#
# WHAT THIS SECTION DELIBERATELY DOES AND DOES NOT PIN
# ---------------------------------------------------------------------
# [03-3] pins the shell to a shapes export and pins that export's CONTENT,
#        because this card's shell is NOT the grid-peer CARD_SHELL and must not
#        be quietly re-pointed at one. It is a hero-radius side rail. Whether
#        the surface should carry a 40px radius outside its one hero is a real
#        question and it belongs to a later call, not to a step whose contract
#        is grammar; minting the string byte-identical is what step 00 did with
#        every shell it hoisted, and it is what makes this a zero-visual-change
#        re-point rather than a redesign smuggled in under a dedup.
# [03-6] cannot assert what a glyph LOOKS like. It asserts the two tiles carry
#        different names, that neither is the eye toggle, and that every name
#        the file asks for is actually in the subset -- a ligature we do not
#        ship renders as its own literal text on a modem in the field, which no
#        typecheck catches and no screenshot of a dev machine reproduces.
# [03-7] asserts the identity rows are NOT gated on reachability, positively.
#        The failure mode this step is closest to introducing is over-applying
#        its own branch: the honest fix for a failed poll blanks the two
#        measurements and leaves the nine identifiers alone, and an assertion
#        that only checked "an unreachable branch exists" would pass just as
#        happily on a card that blanked everything.
# [03-9] pins the masking, the tick composition and the inherited clock, for
#        the same reason [02-9] pinned the ramp: the comment explaining why one
#        TickGroup spans eleven figures is still correct, and a step that opens
#        the file for other reasons is exactly when a correct subsystem gets
#        tidied away.
# [03-1] [03-2] [03-3] [03-4] [03-5] [03-6] [03-7] [03-8] [03-9] run against
#        comment-stripped source, same rationale as R0-6, 00-5, 01-6 and 02-3.
#        This file's JSDoc necessarily quotes `bg-primary-container`,
#        `px-[15px]` and `h-[62px]` to explain what they were and why they went.
# [03-10] extracts the device_status object before grepping, same as [02-10].
#        A whole-file grep for "description" is how SECTION 01 nearly shipped a
#        false green.
# EVERY class spelling quoted below is a real utility already emitted elsewhere
#        in this repo. No pattern here invents a class-shaped string.
#
# Run: bash scripts/test/dashboard-design-language.sh
# =============================================================================

DEV_03="$DASHBOARD/device-status.tsx"
SHAPES_03="$SHAPES_00"
HOME_03="$HOME_00"
ICONS_03="$COMPONENTS/ui/material-symbol-names.ts"

printf '\n=============================================================\n'
printf 'SECTION 03 -- Device Information\n'
printf '=============================================================\n'

dev_stripped="$TMPD/device-status.stripped"
if [ -f "$DEV_03" ]; then
    strip_comments "$DEV_03" > "$dev_stripped"
else
    : > "$dev_stripped"
fi

shapes_stripped_03="$TMPD/shapes.03.stripped"
if [ -f "$SHAPES_03" ]; then
    strip_comments "$SHAPES_03" > "$shapes_stripped_03"
else
    : > "$shapes_stripped_03"
fi

home_stripped_03="$TMPD/home-component.03.stripped"
if [ -f "$HOME_03" ]; then
    strip_comments "$HOME_03" > "$home_stripped_03"
else
    : > "$home_stripped_03"
fi

# -----------------------------------------------------------------------------
printf '\n[03-1] the heading joins the surface type ramp\n'
# Finding 02, and finding 03 beside it. A card title is `text-lg`; the page
# heading minted in step 00 is the only `text-3xl` on the route.
if [ ! -f "$DEV_03" ]; then
    bad "device-status.tsx is missing"
else
    if grep -q 'CARD_TITLE' "$dev_stripped"; then
        ok "the title reads the shared card-title size"
    else
        bad "the title still sizes itself instead of importing CARD_TITLE"
    fi
    if grep -q 'text-2xl' "$dev_stripped"; then
        bad "a page-title-sized heading survives in device-status.tsx"
    else
        ok "no page-sized heading is left on this card"
    fi
    if grep -q '250px./card:text-3xl' "$dev_stripped"; then
        bad "the card still steps its title up to text-3xl"
    else
        ok "the title no longer steps up to a page size"
    fi
    if grep -q 'CardDescription' "$dev_stripped"; then
        ok "the card carries a description"
    else
        bad "the card still has no CardDescription"
    fi
    if grep -q 'CARD_DESC' "$dev_stripped"; then
        ok "the description speaks the surface's secondary ink"
    else
        bad "the description does not read CARD_DESC"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[03-2] Call C -- the device mark sits on a neutral slab, still 188px\n'
# The largest single area of role colour on the route, behind decoration.
if [ -f "$DEV_03" ]; then
    if grep -q 'bg-primary-container' "$dev_stripped"; then
        bad "the 188px decorative slab is still painted with a role container"
    else
        ok "the device mark's slab is off the role palette"
    fi
    if grep -q 'bg-surface-container' "$dev_stripped"; then
        ok "the neutral surface fill is present"
    else
        bad "nothing neutral replaced the container fill"
    fi
    mark_count=$(grep -c 'w-\[188px\]' "$dev_stripped" || true)
    if [ "$mark_count" -eq 2 ]; then
        ok "the mark is still 188px in both the loaded card and its skeleton"
    else
        bad "the 188px mark changed size or lost its mirror (found $mark_count of 2)"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[03-3] the shell has one home, and it is still this card own shell\n'
# Byte-identical hoist, not a re-point at the grid-peer shell. See the section
# note: demoting a 40px radius to 36px is a visual change and a later call.
if grep -q 'export const SIDE_SHELL' "$shapes_stripped_03"; then
    ok "shapes.ts owns the side-rail shell"
    side_line=$(grep -A2 'export const SIDE_SHELL' "$shapes_stripped_03" | tr -d '\n')
    for frag in 'rounded-hero' 'border-0' 'bg-surface' 'gap-4' 'h-full' '@container/card'; do
        case "$side_line" in
            *"$frag"*) ok "SIDE_SHELL still carries $frag" ;;
            *) bad "SIDE_SHELL lost $frag -- the hoist stopped being byte-identical" ;;
        esac
    done
else
    bad "shapes.ts does not export SIDE_SHELL"
fi
if [ -f "$DEV_03" ]; then
    if grep -q 'SIDE_SHELL' "$dev_stripped"; then
        ok "device-status.tsx imports its shell"
    else
        bad "device-status.tsx does not read SIDE_SHELL"
    fi
    if grep -q 'rounded-hero border-0' "$dev_stripped"; then
        bad "the shell is still written inline in device-status.tsx"
    else
        ok "no inline shell copy survives in device-status.tsx"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[03-4] the rows are the canonical pill, and the skeleton mirrors it\n'
# Divergence 1, recorded in shapes.ts at step 00 and owned here.
if [ -f "$DEV_03" ]; then
    if grep -q 'px-\[15px\]' "$dev_stripped"; then
        bad "the row pill is still written at its own padding"
    else
        ok "the second spelling of the row pill is gone"
    fi
    if grep -q 'ROW\.ROOT' "$dev_stripped"; then
        ok "the row reads ROW.ROOT"
    else
        bad "the row does not read ROW.ROOT"
    fi
    if grep -q 'ROW\.KEY' "$dev_stripped" && grep -q 'ROW\.VALUE' "$dev_stripped"; then
        ok "the row's key and value take the shared type"
    else
        bad "the row's key or value still sizes itself"
    fi
    if grep -q 'h-\[41px\]' "$dev_stripped"; then
        bad "the row skeleton still restates a height it cannot see"
    else
        ok "no restated row height survives"
    fi
    if grep -q 'ROW\.HEIGHT' "$dev_stripped"; then
        ok "the row skeleton mirrors by import"
    else
        bad "the row skeleton does not import ROW.HEIGHT"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[03-5] the uptime tiles are the canonical tile\n'
# Divergence 3 in shapes.ts: TILE was minted at step 00 with no consumer, and
# this is the step that gives it one.
if [ -f "$DEV_03" ]; then
    for frag in 'TILE\.ROOT' 'TILE\.DISC' 'TILE\.TEXT' 'TILE\.EYEBROW' 'TILE\.VALUE' 'TILE\.CAPTION' 'TILE\.HEIGHT'; do
        name=$(printf '%s' "$frag" | tr -d '\\')
        if grep -q "$frag" "$dev_stripped"; then
            ok "the tile reads $name"
        else
            bad "the tile does not read $name"
        fi
    done
    if grep -q 'h-\[62px\]' "$dev_stripped"; then
        bad "the tile skeleton still restates the old floating height"
    else
        ok "no restated tile height survives"
    fi
    if grep -qE 'rounded-tile (px|py)' "$dev_stripped"; then
        bad "a bespoke tile box is still written inline"
    else
        ok "no bespoke tile box survives"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[03-6] the connection state is not carried by colour alone\n'
# Finding 09. success-container against surface-container is not the 1.03:1
# pair, but the two tiles are the same shape, the same size and adjacent, so a
# fill difference is the ONLY thing separating them and a reader who cannot
# resolve it has nothing else to read.
if [ -f "$DEV_03" ]; then
    if grep -qE 'bg-success-container' "$dev_stripped"; then
        bad "the tile BODY still wears the role fill; the colour belongs on the disc"
    else
        ok "the tile body is neutral and the colour moved to the disc"
    fi
    for sym in DISC_SUCCESS DISC_MUTED; do
        if grep -q "export const $sym" "$shapes_stripped_03"; then
            ok "shapes.ts owns $sym"
        else
            bad "shapes.ts does not export $sym"
        fi
        if grep -q "$sym" "$dev_stripped"; then
            ok "the tiles read $sym"
        else
            bad "the tiles do not read $sym"
        fi
    done
    # Every glyph the file asks for, minus the eye toggle, must be distinct and
    # must exist in the shipped subset.
    glyphs=$(grep -oE 'name="[a-z0-9_]+"' "$dev_stripped" \
        | sed 's/name="//; s/"//' \
        | grep -vE '^visibility(_off)?$' | sort -u)
    glyph_n=$(printf '%s\n' "$glyphs" | grep -c . || true)
    if [ "$glyph_n" -ge 3 ]; then
        ok "the tiles carry three distinct marks (up, down, and device uptime)"
    else
        bad "the two tiles do not carry distinct glyphs (found $glyph_n, need 3)"
    fi
    missing=0
    for g in $glyphs; do
        grep -q "\"$g\"," "$ICONS_03" || { bad "glyph '$g' is not in the shipped subset"; missing=1; }
    done
    [ "$missing" -eq 0 ] && [ "$glyph_n" -ge 1 ] \
        && ok "every glyph this card asks for is in the subset"
fi

# -----------------------------------------------------------------------------
printf '\n[03-7] the unreachable branch exists, and stops at the measurements\n'
# Finding 13, and the split that makes the branch worth having. An identifier
# does not go stale; a running clock we cannot see does.
if [ -f "$DEV_03" ]; then
    if grep -q 'modemReachable' "$dev_stripped"; then
        ok "the card is told whether the modem answered"
    else
        bad "the card still cannot tell a failed poll from a real reading"
    fi
    if grep -q 'unreachable' "$dev_stripped"; then
        ok "the card derives an unreachable state"
    else
        bad "no unreachable state is derived"
    fi
    if grep -q 'modemReachable' "$home_stripped_03"; then
        ok "home-component.tsx hands the card its reachability"
    else
        bad "home-component.tsx does not pass modemReachable to the device card"
    fi
    if grep -q 'ABSENT' "$dev_stripped"; then
        ok "the absent sentinel is the one this surface already uses"
    else
        bad "the card does not read the shared ABSENT sentinel"
    fi
    if grep -qE '\|\| "-"|\? "-"|: "-"' "$dev_stripped"; then
        bad "a bare hyphen placeholder survives in device-status.tsx"
    else
        ok "no bare hyphen placeholder survives"
    fi
    # POSITIVE: the identity rows must still take their own last-known value.
    # An assertion that only checked "a branch exists" would pass on a card
    # that blanked all nine identifiers too.
    if grep -qE 'data\?\.manufacturer \|\| ABSENT' "$dev_stripped"; then
        ok "the identity rows keep their last-known values"
    else
        bad "the identity rows no longer take their own value unconditionally"
    fi
    if grep -qE 'unreachable.*data\?\.(manufacturer|firmware|imei|iccid|imsi)' "$dev_stripped"; then
        bad "an identity row was gated on reachability -- identifiers do not go stale"
    else
        ok "no identity row is gated on reachability"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[03-8] the radii are on the role scale\n'
# Finding 12. Two sites in this file.
if [ -f "$DEV_03" ]; then
    if grep -q 'rounded-full' "$dev_stripped"; then
        bad "a legacy rounded-full survives in device-status.tsx"
    else
        ok "no legacy radius survives in device-status.tsx"
    fi
    if grep -q 'rounded-pill' "$dev_stripped"; then
        ok "the pill radius is on the role scale"
    else
        bad "the pill radius is gone entirely"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[03-9] the masking, the ranking and the inherited clock all survive\n'
# The comment explaining why one TickGroup spans eleven figures is still
# correct. A step that opens the file for other reasons is exactly when a
# correct subsystem gets tidied away.
if [ -f "$DEV_03" ]; then
    keep03=0
    for sym in TickGroup TickingValue staggerRows staggerRowItem MASK hidePrivate formatUptime; do
        grep -q "$sym" "$dev_stripped" || { bad "device-status.tsx lost $sym"; keep03=1; }
    done
    [ "$keep03" -eq 0 ] && ok "masking, ticking, ranking and uptime formatting are all present"
    if grep -qE 'initial=|animate=' "$dev_stripped"; then
        bad "this card declares its own clock again -- it must inherit the page-wide one"
    else
        ok "the card's cascade still inherits the page-wide clock"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[03-10] the locale packs carry the new copy on every language\n'
# The description is new; so are the tile captions and the unreachable word.
# Extract the device_status object first -- a whole-file grep for a common key
# name is how SECTION 01 nearly shipped a false green.
for lang in en zh-CN zh-TW it id; do
    lf="$REPO_ROOT/public/locales/$lang/dashboard.json"
    if [ ! -f "$lf" ]; then
        bad "missing locale pack: $lang/dashboard.json"
        continue
    fi
    block03=$(awk '/^  "device_status": \{/{f=1} f{print} f && /^  \},?\r?$/{exit}' "$lf")
    for key in description conn_uptime_caption_up conn_uptime_caption_down device_uptime_caption uptime_unknown; do
        if printf '%s' "$block03" | grep -q "\"$key\""; then
            ok "$lang carries device_status.$key"
        else
            bad "$lang is missing device_status.$key"
        fi
    done
done

# =============================================================================
# SECTION 04 -- Carrier Aggregation
# =============================================================================
#
# The lightest step in the pass, and it is light for a good reason: this card
# is a SIGNATURE surface. The proportional chain, the released-carrier
# contract, the freeze-while-stale rule and the `--meter-index` cascade are all
# already canon -- DESIGN.md quotes this file's width animation as the one
# sanctioned `width` transition in the entire product. Almost everything here
# is on the DO-NOT-TOUCH list, and the assertions below spend as much of their
# weight guarding that as they do on the three things that change.
#
# WHAT CHANGES
# ------------
#
#   1. THE HEADER GAINS A DESCRIPTION (finding 03). Zero CardDescription on the
#      whole surface was the finding; this is the fourth of nine cards to get
#      one. The title also stops spelling its own size and reads CARD_TITLE --
#      byte-identical at 18px semibold, so it is a re-point, not a resize.
#
#   2. THE SHELL HOISTS (finding 04). This file inlines a card shell no other
#      file has, and then writes a SECOND, drifted copy of it eight lines
#      further down for the empty state. Two spellings of one shell inside one
#      file is the narrowest possible version of the finding and the easiest to
#      fix: one exported constant, three call sites.
#
#   3. THE EMPTY STATE STOPS BEING A NEAR-COPY. A 12px gap where every other
#      use of this shell is 16px, and no container query root at all. Neither
#      is a decision anybody made -- it is what happens when a shell is spelled
#      by hand twice.
#
# ONE ASSERTION THAT IS NOT THE OBVIOUS ONE
# -----------------------------------------
#
# [04-5] requires the title and the description to each resolve from EXACTLY
# ONE call site. This card has THREE branches that draw a heading -- loading,
# empty and loaded -- and the loading one is not an ordinary skeleton: it is
# also drawn as a fade-out OVERLAY on top of the real card during the handoff
# (recipe 03). A title placeholder in that overlay is a grey box fading out on
# top of the real title, and a title spelled three times is three places for
# the wording to drift with nothing rendering two of them at once to reveal it.
# Both lines are CONSTANTS -- neither was ever unknown -- so neither is
# skeletoned at all and all three branches read one definition. Same call step
# 03 made, for the same reason.
#
# [04-1] through [04-5] run against comment-stripped source: this file's
# comments necessarily quote the shell they replaced.

CA_04="$DASHBOARD/carrier-aggregation.tsx"
SHAPES_04="$SHAPES_00"

printf '\n=============================================================\n'
printf 'SECTION 04 -- Carrier Aggregation\n'
printf '=============================================================\n'

ca_stripped="$TMPD/carrier-aggregation.stripped"
if [ -f "$CA_04" ]; then
    strip_comments "$CA_04" > "$ca_stripped"
else
    : > "$ca_stripped"
fi

shapes_stripped_04="$TMPD/shapes.04.stripped"
if [ -f "$SHAPES_04" ]; then
    strip_comments "$SHAPES_04" > "$shapes_stripped_04"
else
    : > "$shapes_stripped_04"
fi

# -----------------------------------------------------------------------------
printf '\n[04-1] the header carries a description, and the title reads the ramp\n'
# Finding 03. The surface had none; this is the fourth card to gain one.
if [ ! -f "$CA_04" ]; then
    bad "carrier-aggregation.tsx is missing"
else
    if grep -q 'CardDescription' "$ca_stripped"; then
        ok "the card carries a description"
    else
        bad "the card still has no CardDescription"
    fi
    if grep -q 'CARD_DESC' "$ca_stripped"; then
        ok "the description speaks the surface's secondary ink"
    else
        bad "the description does not read CARD_DESC"
    fi
    if grep -q 'CARD_TITLE' "$ca_stripped"; then
        ok "the title reads the shared card-title size"
    else
        bad "the title still spells its own size instead of importing CARD_TITLE"
    fi
    if grep -q 'text-lg font-semibold' "$ca_stripped"; then
        bad "a hand-spelled card title survives in carrier-aggregation.tsx"
    else
        ok "no hand-spelled title size is left on this card"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[04-2] the card shell hoists to shapes.ts, byte-identical\n'
# Finding 04. Every utility quoted here is one this repo already emits, so
# Tailwind's content scan lifting one out of this harness costs nothing.
if grep -q 'export const CA_SHELL' "$shapes_stripped_04"; then
    ok "shapes.ts exports the aggregation shell"
else
    bad "shapes.ts has no CA_SHELL export"
fi
ca_shell_def=$(grep -A 2 'export const CA_SHELL' "$shapes_stripped_04" || true)
shell_ok=0
for frag in "@container/ca" "gap-4" "rounded-hero" "border-0" "px-7" "py-6" "shadow-[var(--shadow-whisper)]"; do
    if ! printf '%s' "$ca_shell_def" | grep -qF -- "$frag"; then
        bad "CA_SHELL is not byte-identical to the shipped shell -- missing $frag"
        shell_ok=1
    fi
done
if [ "$shell_ok" -eq 0 ]; then
    ok "CA_SHELL still spells the shipped shell exactly"
fi
if [ -f "$CA_04" ]; then
    if grep -q 'CA_SHELL' "$ca_stripped"; then
        ok "the card reads the hoisted shell"
    else
        bad "the card still inlines its own shell"
    fi
    if grep -q 'rounded-hero border-0' "$ca_stripped"; then
        bad "a shell is still spelled inline in carrier-aggregation.tsx"
    else
        ok "no shell is spelled inline any more"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[04-3] the empty state stops being a drifted near-copy of the shell\n'
# A 12px gap against the constant's 16px, and no container query root at all.
# Neither divergence is a decision; both are what a second hand-spelling makes.
if [ -f "$CA_04" ]; then
    if grep -q 'gap-3 rounded-hero' "$ca_stripped"; then
        bad "the empty state still carries its own drifted shell"
    else
        ok "the empty state no longer drifts from the shell"
    fi
    shell_uses=$(grep -c 'CA_SHELL' "$ca_stripped" || true)
    if [ "$shell_uses" -ge 3 ]; then
        ok "all three branches draw the same shell ($shell_uses references)"
    else
        bad "the shell is not read by every branch (found $shell_uses references, need 3+)"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[04-4] everything this card is known for survives the step\n'
# This is a Signature surface. The width animation below is the ONE sanctioned
# width transition in the product; the rest of this list is the released-
# carrier contract, the freeze-while-stale rule and the two cascades.
if [ -f "$CA_04" ]; then
    keep04=0
    for sym in ca-segment-enter ca-meter ca-content-in ca-skeleton-out \
               computeSegmentShares reconcileCarriers releasedForMs isStale \
               segmentTone tileTone roleChipTone meterFillTone \
               TickGroup SwapLabel TickingValue; do
        if ! grep -q -- "$sym" "$ca_stripped"; then
            bad "carrier-aggregation.tsx lost $sym"
            keep04=1
        fi
    done
    if [ "$keep04" -eq 0 ]; then
        ok "the chain, the tiles, the release clock and both cascades are intact"
    fi
    if grep -q -- '--meter-index' "$ca_stripped"; then
        ok "the meter stagger custom property survives"
    else
        bad "the --meter-index cascade is gone"
    fi
    if grep -q 'shares\[i\]' "$ca_stripped"; then
        ok "the proportional chain still drives segment width from the data"
    else
        bad "the segment width is no longer the share it is reporting"
    fi
    if grep -qE 'initial=|animate=' "$ca_stripped"; then
        bad "this card declares its own entrance clock -- it must inherit the page-wide one"
    else
        ok "the card starts no clock of its own"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[04-5] the heading resolves from one definition, not three\n'
# Loading, empty and loaded all draw a heading, and the loading one is ALSO the
# fade-out overlay. Both lines are constants, so neither is skeletoned and all
# three branches read one definition.
if [ -f "$CA_04" ]; then
    title_uses=$(grep -c 'ca\.title' "$ca_stripped" || true)
    if [ "$title_uses" -eq 1 ]; then
        ok "the title is spelled once for all three branches"
    else
        bad "the title is spelled $title_uses times (need exactly 1)"
    fi
    desc_uses=$(grep -c 'ca\.description' "$ca_stripped" || true)
    if [ "$desc_uses" -eq 1 ]; then
        ok "the description is spelled once for all three branches"
    else
        bad "the description is spelled $desc_uses times (need exactly 1)"
    fi
    if grep -q 'h-6 w-48' "$ca_stripped"; then
        bad "the title is still skeletoned -- it is a constant and was never unknown"
    else
        ok "no placeholder stands in for a line the card always knew"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[04-6] the locale packs carry the new copy on every language\n'
# Extract the `ca` object first: "description" is the commonest key name in
# these packs and a whole-file grep is how SECTION 01 nearly shipped a false
# green.
for lang in en zh-CN zh-TW it id; do
    lf="$REPO_ROOT/public/locales/$lang/dashboard.json"
    if [ ! -f "$lf" ]; then
        bad "missing locale pack: $lang/dashboard.json"
        continue
    fi
    block04=$(awk '/^  "ca": \{/{f=1} f{print} f && /^  \},?\r?$/{exit}' "$lf")
    if printf '%s' "$block04" | grep -q '"description"'; then
        ok "$lang carries ca.description"
    else
        bad "$lang is missing ca.description"
    fi
done

# =============================================================================
# SECTION 05 -- Device Metrics
# =============================================================================
#
# The other light step, and its shell work was already done: step 00 hoisted
# CARD_SHELL, METER_H, VALUE_CLASS and FOCUS_RING out of this file and step 03
# moved PillRow to its own module. What is left is the description and the
# unreachable branch, and the second one is the whole section.
#
# WHERE THE UNREACHABLE BRANCH STOPS
# ----------------------------------
#
# `modem_reachable` means ONE thing: the last AT command timed out. It says
# nothing about the box serving the page, and this card reads BOTH -- which is
# why "gate the card on it" would be wrong in three of seven rows.
#
#   AT-SOURCED, AND THE QUANTITY KEEPS MOVING -> the sentinel.
#     Temperature is AT+QTEMP, and the two cell distances derive from the
#     serving cell's timing advance. When the poll fails the poller keeps the
#     previous value rather than clearing it, so the figure on screen is a
#     PHOTOGRAPH of a number that has been free to change ever since. Same
#     argument step 03 made for the two uptimes.
#
#   MEASURED LOCALLY, AND STILL FRESH -> no gate at all.
#     CPU is /proc/stat and memory is /proc/meminfo, both read by
#     `update_proc_metrics()`, which runs UNCONDITIONALLY every cycle and
#     BEFORE the serving-cell poll. Storage arrives on a different hook against
#     a different endpoint. A failed AT command does not make any of them
#     stale, and blanking them would be inventing an outage the machine
#     serving the page is not having.
#
#   ALREADY HAPPENED -> no gate.
#     The data counter is cumulative and monotone. A byte total read four
#     seconds ago is still bytes that were genuinely carried; unlike a
#     temperature it cannot become WRONG, only incomplete. Step 03's
#     identifier argument, applied to a total instead of a name.
#
# [05-3] asserts that split in BOTH directions, because an assertion that only
# checked "an unreachable branch exists" would pass just as happily on a card
# that blanked all seven rows.
#
# [05-1] through [05-5] run against comment-stripped source, same rationale as
# R0-6, 00-5, 01-6, 02-3, 03-1 and 04-1.

DM_05="$DASHBOARD/device-metrics.tsx"
SHAPES_05="$SHAPES_00"
HOME_05="$DASHBOARD/home-component.tsx"

printf '\n=============================================================\n'
printf 'SECTION 05 -- Device Metrics\n'
printf '=============================================================\n'

dm_stripped="$TMPD/device-metrics.stripped"
if [ -f "$DM_05" ]; then
    strip_comments "$DM_05" > "$dm_stripped"
else
    : > "$dm_stripped"
fi

shapes_stripped_05="$TMPD/shapes.05.stripped"
if [ -f "$SHAPES_05" ]; then
    strip_comments "$SHAPES_05" > "$shapes_stripped_05"
else
    : > "$shapes_stripped_05"
fi

home_stripped_05="$TMPD/home-component.05.stripped"
if [ -f "$HOME_05" ]; then
    strip_comments "$HOME_05" > "$home_stripped_05"
else
    : > "$home_stripped_05"
fi

# -----------------------------------------------------------------------------
printf '\n[05-1] the header carries a description, and the title reads the ramp\n'
# Finding 03. The fifth of nine cards to gain one.
if [ ! -f "$DM_05" ]; then
    bad "device-metrics.tsx is missing"
else
    if grep -q 'CardDescription' "$dm_stripped"; then
        ok "the card carries a description"
    else
        bad "the card still has no CardDescription"
    fi
    if grep -q 'CARD_DESC' "$dm_stripped"; then
        ok "the description speaks the surface's secondary ink"
    else
        bad "the description does not read CARD_DESC"
    fi
    if grep -q 'CARD_TITLE' "$dm_stripped"; then
        ok "the title reads the shared card-title size"
    else
        bad "the title still spells its own size instead of importing CARD_TITLE"
    fi
    if grep -q 'text-lg font-semibold' "$dm_stripped"; then
        bad "a hand-spelled card title survives in device-metrics.tsx"
    else
        ok "no hand-spelled title size is left on this card"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[05-2] the shell and the row primitives stay shared, not re-inlined\n'
# Green BEFORE the fix and required to be green after it. Step 00 hoisted these
# and step 03 moved PillRow out; the job here is that a step adding a branch
# does not quietly re-inline one of them.
if [ -f "$DM_05" ]; then
    imports05=0
    for sym in CARD_SHELL FOCUS_RING METER_H VALUE_CLASS; do
        if ! grep -q -- "$sym" "$dm_stripped"; then
            bad "device-metrics.tsx no longer reads $sym from shapes.ts"
            imports05=1
        fi
    done
    if [ "$imports05" -eq 0 ]; then
        ok "the shell, the focus ring, the track height and the value ink are all shared"
    fi
    if grep -q 'className={CARD_SHELL}' "$dm_stripped"; then
        ok "the card draws the hoisted shell"
    else
        bad "the card no longer draws CARD_SHELL"
    fi
    if grep -q 'rounded-card border-0' "$dm_stripped"; then
        bad "a shell is spelled inline in device-metrics.tsx"
    else
        ok "no shell is spelled inline"
    fi
    if grep -q 'PillRow' "$dm_stripped"; then
        ok "the three pill rows still read the shared row"
    else
        bad "device-metrics.tsx lost PillRow"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[05-3] the unreachable branch exists, and it stops where the AT transport does\n'
# Finding 13. Both directions -- see the section header for why the split is
# the assertion rather than the branch's mere existence.
if [ -f "$DM_05" ]; then
    if grep -q 'modemReachable' "$dm_stripped"; then
        ok "the card is told whether the last poll reached the modem"
    else
        bad "device-metrics.tsx still cannot tell a failed poll from a reading"
    fi
    if grep -q 'const unreachable = !modemReachable' "$dm_stripped"; then
        ok "unreachable is spelled exactly as the other two cards spell it"
    else
        bad "the unreachable test is not the surface's shared spelling"
    fi
    if grep -q 'ABSENT' "$dm_stripped"; then
        ok "the card reads the surface's absent sentinel"
    else
        bad "device-metrics.tsx does not use ABSENT"
    fi

    # --- gated: the three AT-sourced readings ---
    for pair in "tempValue:temperature" "lteDistance:the LTE cell distance" \
                "nrDistance:the NR cell distance"; do
        var05=${pair%%:*}
        what05=${pair#*:}
        if grep -A 4 "const $var05" "$dm_stripped" | grep -q 'unreachable'; then
            ok "$what05 goes to the sentinel when the modem cannot be reached"
        else
            bad "$what05 still reports a photograph during an outage"
        fi
    done

    # --- NOT gated: the three read on the box serving the page ---
    for pair in "cpuValue:CPU" "memValue:memory" "storageValue:storage"; do
        var05=${pair%%:*}
        what05=${pair#*:}
        if grep -A 4 "const $var05" "$dm_stripped" | grep -q 'unreachable'; then
            bad "$what05 is blanked by an AT timeout, and it is not read over AT"
        else
            ok "$what05 keeps reporting -- a failed AT command does not make it stale"
        fi
    done

    # --- NOT gated: a cumulative total cannot become wrong ---
    if grep 'accumulated_rx_bytes' "$dm_stripped" | grep -q 'unreachable'; then
        bad "the cumulative data counter is blanked during an outage"
    else
        ok "the data counter keeps its total -- bytes already carried stay carried"
    fi

    # --- the warning chip must not fire off a stale reading ---
    if grep -q 'const isTempHigh' "$dm_stripped" && \
       grep -A 1 'const isTempHigh' "$dm_stripped" | grep -q 'unreachable'; then
        ok "the high-temperature chip cannot fire off a photograph"
    else
        bad "the high-temperature chip still reads the stale temperature"
    fi
fi

if [ -f "$HOME_05" ]; then
    if grep -A 6 'DeviceMetricsComponent' "$home_stripped_05" | grep -q 'modemReachable'; then
        ok "home-component.tsx hands the card its reachability"
    else
        bad "the card takes modemReachable and nothing passes it"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[05-4] a meter with no reading draws an empty track, never a blank gap\n'
# DESIGN.md > Quality bars: "A missing reading is an empty track
# (`MetricBar value={null}`), never a zero-length fill." The shipped card had a
# THIRD spelling -- an invisible spacer holding the height and drawing nothing,
# which says "no meter" where an empty track says "no reading".
if [ -f "$DM_05" ]; then
    bars05=$(grep -c '<MetricBar' "$dm_stripped" || true)
    if [ "$bars05" -eq 4 ]; then
        ok "all four meters draw a track ($bars05 bars for 4 rows)"
    else
        bad "found $bars05 MetricBar call sites for 4 meter rows"
    fi
    # Narrowed to the spacer's own spelling on purpose: the crossfade overlay
    # is also aria-hidden and must stay that way, so a bare grep would be red
    # forever.
    if grep -q 'className={METER_H} aria-hidden' "$dm_stripped"; then
        bad "an invisible spacer still stands in for a track"
    else
        ok "no invisible spacer is left holding a meter height"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[05-5] everything this card is known for survives the step\n'
# The thresholds, the counter reset, the direction ink, the crossfade and the
# 8px bars. The plan's DO-NOT list, made mechanical.
if [ -f "$DM_05" ]; then
    for thr in "TEMP_WARN = 60" "TEMP_DANGER = 75" "CPU_WARN = 70" "CPU_DANGER = 90"; do
        if grep -qF -- "$thr" "$dm_stripped"; then
            ok "threshold intact: $thr"
        else
            bad "a warning threshold moved: expected $thr"
        fi
    done
    keep05=0
    for sym in ca-content-in ca-skeleton-out AlertDialog restart_alt \
               text-downlink-on-surface text-uplink-on-surface \
               TickGroup TickingValue staggerRows MeterRow; do
        if ! grep -q -- "$sym" "$dm_stripped"; then
            bad "device-metrics.tsx lost $sym"
            keep05=1
        fi
    done
    if [ "$keep05" -eq 0 ]; then
        ok "the crossfade, the reset dialog, the direction ink and the cascade are intact"
    fi
    if grep -qE 'initial=|animate=' "$dm_stripped"; then
        bad "this card declares its own entrance clock -- it must inherit the page-wide one"
    else
        ok "the card starts no clock of its own"
    fi
    if grep -q 'TILE\.' "$dm_stripped"; then
        bad "the data-usage row was promoted to tiles -- user-vetoed 2026-09-01"
    else
        ok "the data-usage row stays a row, in the quiet slot"
    fi
fi
if grep -q 'export const METER_H = "h-2"' "$shapes_stripped_05"; then
    ok "the meters are still 8px -- METER_H was not thinned"
else
    bad "METER_H moved off 8px, and the skeleton mirrors it"
fi

# -----------------------------------------------------------------------------
printf '\n[05-6] the locale packs carry the new copy on every language\n'
# Extract the `metrics` object first, same reason as [04-6].
for lang in en zh-CN zh-TW it id; do
    lf="$REPO_ROOT/public/locales/$lang/dashboard.json"
    if [ ! -f "$lf" ]; then
        bad "missing locale pack: $lang/dashboard.json"
        continue
    fi
    block05=$(awk '/^  "metrics": \{/{f=1} f{print} f && /^  \},?\r?$/{exit}' "$lf")
    if printf '%s' "$block05" | grep -q '"description"'; then
        ok "$lang carries metrics.description"
    else
        bad "$lang is missing metrics.description"
    fi
done

# =============================================================================
# SECTION 06 -- Live Latency
# =============================================================================
#
# The headline change: the 88px speedtest TILE becomes a 40px metric ROW, in the
# same form as Device Metrics' Data Used row. User-directed 2026-09-01 -- the
# tile "introduces a huge whitespace gap to other cards."
#
# WHY THE ROW IS THE RIGHT FORM, NOT MERELY THE SMALLER ONE
# ---------------------------------------------------------
#
# Both values are a DOWN/UP PAIR, and they are the only two on the surface.
# Drawing them in two different shapes -- one an 88px tile with tonal figure
# chips, the other a 40px row with inline glyphs -- means a user who learns one
# has not learned the other. That is Product Principle 4 inverted, and it is the
# same argument step 05 made about a third spelling of absence, one level up.
#
# The row form invents nothing. Data Used already puts a CONTROL IN THE LABEL
# CELL (the counter reset), which is why `PillRow.label` is a ReactNode and not
# a string -- step 00 moved the component out of device-metrics.tsx for this
# step specifically, and said so in its own header. The signal cards already put
# a BAR INLINE IN A 40px ROW. The speedtest row wants exactly those two things.
#
# The big result is not lost, it moves to where it belongs: speedtest-dialog.tsx
# is the detail view and already renders it in full. Row summarises, dialog
# details -- progressive disclosure, Product Principle 2.
#
# WHAT THE ROW MAY NOT DROP
# -------------------------
#
# The `agoLabel` is metadata ABOUT a reading, so it renders as a neutral Tag
# rather than a Badge -- the Two-Form Rule's own answer, and the move
# mtu-settings-card.tsx makes when it captions provenance rather than claiming a
# measurement. It is the first thing at risk when the row runs out of width, and
# it is the one thing that may not go: A RESULT WITH NO AGE IS A RESULT CLAIMING
# TO BE CURRENT. [06-4] pins it for that reason and no other.
#
# [06-1] through [06-6] run against comment-stripped source, same rationale as
# R0-6, 00-5, 01-6, 02-3, 03-1, 04-1 and 05-1. [06-7] is the exception and says
# why.

LL_06="$DASHBOARD/live-latency.tsx"
SHAPES_06="$SHAPES_00"

printf '\n=============================================================\n'
printf 'SECTION 06 -- Live Latency\n'
printf '=============================================================\n'

ll_stripped="$TMPD/live-latency.stripped"
if [ -f "$LL_06" ]; then
    strip_comments "$LL_06" > "$ll_stripped"
else
    : > "$ll_stripped"
fi

shapes_stripped_06="$TMPD/shapes.06.stripped"
if [ -f "$SHAPES_06" ]; then
    strip_comments "$SHAPES_06" > "$shapes_stripped_06"
else
    : > "$shapes_stripped_06"
fi

# -----------------------------------------------------------------------------
printf '\n[06-1] the header carries a description, and the title reads the ramp\n'
# Findings 02, 03. The sixth of nine cards to gain one.
if [ ! -f "$LL_06" ]; then
    bad "live-latency.tsx is missing"
else
    if grep -q 'CardDescription' "$ll_stripped"; then
        ok "the card carries a description"
    else
        bad "the card still has no CardDescription"
    fi
    if grep -q 'CARD_DESC' "$ll_stripped"; then
        ok "the description speaks the shared secondary ink"
    else
        bad "the description does not read CARD_DESC"
    fi
    if grep -q 'CARD_TITLE' "$ll_stripped"; then
        ok "the title reads the shared card-title size"
    else
        bad "the title still spells its own size instead of importing CARD_TITLE"
    fi
    if grep -q 'text-lg font-semibold' "$ll_stripped"; then
        bad "a hand-spelled card title survives in live-latency.tsx"
    else
        ok "no hand-spelled title size is left on this card"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[06-2] the shell and the clock stay shared, and the plot box is untouched\n'
# Green BEFORE the fix and required to be green after it. Step 00 hoisted
# CARD_SHELL and CLOCK_TICK_MS (finding 15) out of this file; the job here is
# that a step re-authoring a third of the card does not quietly re-inline one.
#
# CHART_BOX is the DO-NOT. Finding 06 was WITHDRAWN: `min-h-[150px] flex-1` is
# correct as shipped. The floor guarantees recharts a measurable parent on frame
# one (ResponsiveContainer renders NOTHING until it has measured), and the
# flex-1 beside it is what absorbs the slack from Device Metrics being the
# taller row-mate. Converting it to a pin breaks both, and neither failure shows
# in a static screenshot -- which is exactly why it is pinned here instead.
if [ -f "$LL_06" ]; then
    if grep -q 'className={CARD_SHELL}' "$ll_stripped"; then
        ok "the card draws the hoisted shell"
    else
        bad "the card no longer draws CARD_SHELL"
    fi
    if grep -q 'rounded-card border-0' "$ll_stripped"; then
        bad "a shell is spelled inline in live-latency.tsx"
    else
        ok "no shell is spelled inline"
    fi
    if grep -qE 'const CLOCK_TICK_MS' "$ll_stripped"; then
        bad "CLOCK_TICK_MS is declared locally again -- it lives in shapes.ts"
    else
        ok "the 30s clock is read from shapes.ts, declared once"
    fi
    if grep -q 'CLOCK_TICK_MS' "$ll_stripped"; then
        ok "the relative-time clock still ticks"
    else
        bad "live-latency.tsx lost CLOCK_TICK_MS"
    fi
    if grep -qF 'min-h-[150px] flex-1' "$ll_stripped"; then
        ok "CHART_BOX is untouched -- the first-frame floor and the slack absorber both survive"
    else
        bad "CHART_BOX moved; finding 06 was withdrawn and this must not change"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[06-3] the 88px tile is gone and the shared row stands in its place\n'
# The headline change. Both directions: the tile must be GONE, and what replaced
# it must be the SHARED PillRow rather than a second row that merely matches it.
if [ -f "$LL_06" ]; then
    gone06=0
    for sym in SPEEDTEST_TILE_H 'min-h-[88px]' SpeedtestFigure rounded-tile; do
        if grep -qF -- "$sym" "$ll_stripped"; then
            bad "the speedtest tile survives: $sym is still in live-latency.tsx"
            gone06=1
        fi
    done
    if [ "$gone06" -eq 0 ]; then
        ok "the tile, its pinned height and its bespoke figure chips are all gone"
    fi
    if grep -q 'from "./pill-row"' "$ll_stripped"; then
        ok "the row is the SHARED PillRow, not a second copy of it"
    else
        bad "live-latency.tsx does not import PillRow"
    fi
    if grep -q '<PillRow' "$ll_stripped"; then
        ok "the speed test renders as a metric row"
    else
        bad "no PillRow is rendered in live-latency.tsx"
    fi
    # The skeleton mirrors what it stands in for, or the crossfade becomes a
    # jump (the Skeleton-Mirror Rule). A skeleton still reserving 88px for a
    # 40px row is the exact failure the rule names.
    if grep -q 'ROW.HEIGHT' "$ll_stripped"; then
        ok "the skeleton reserves the row height from the same constant the row uses"
    else
        bad "the skeleton does not mirror the new row -- it must read ROW.HEIGHT"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[06-4] the value cell says what Data Used says, in the same words\n'
# The whole reason the tile became a row. A down/up pair rendered two ways on
# one page is the drift this pass exists to remove, so the treatment is asserted
# to be Data Used spelling, not merely "a down/up pair".
if [ -f "$LL_06" ]; then
    pair06=0
    for sym in arrow_circle_down arrow_circle_up \
               text-downlink-on-surface text-uplink-on-surface; do
        if ! grep -qF -- "$sym" "$ll_stripped"; then
            bad "the result pair does not speak Data Used spelling: missing $sym"
            pair06=1
        fi
    done
    if [ "$pair06" -eq 0 ]; then
        ok "the cached result is the same glyph-plus-ink pair Data Used draws"
    fi
    if grep -q 'VALUE_CLASS' "$ll_stripped"; then
        ok "the figures take the shared row-value ink"
    else
        bad "the figures do not read VALUE_CLASS"
    fi
    # Provenance. See the section header: this is the one thing width pressure
    # may not take.
    if grep -q 'variant="neutral"' "$ll_stripped"; then
        ok "the reading age renders as a neutral Tag -- a result with no age claims to be current"
    else
        bad "the agoLabel is gone or is not a neutral Tag"
    fi
    # Never run.
    if grep -q 'ABSENT' "$ll_stripped"; then
        ok "a card that has never run a test says so with the surface sentinel"
    else
        bad "the never-run state does not use ABSENT"
    fi
    # Running: the shared meter, not the bespoke one.
    if grep -q '<MetricBar' "$ll_stripped"; then
        ok "the running progress draws on the shared MetricBar"
    else
        bad "the running state has no MetricBar"
    fi
    if grep -q 'scaleX(' "$ll_stripped"; then
        bad "the bespoke scaleX progress bar survives"
    else
        ok "the bespoke scaleX bar is gone with the tile"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[06-5] the alpha washes and the retired ink are gone\n'
# Findings 10 and 11. `bg-white/45` is a hardcoded white that does not theme --
# it was compensating for a mismatched pair rather than fixing the pair, and the
# MetricBar track token replaces it outright. `opacity-75` washes a real ink to
# fake a quieter one. `text-muted-foreground` is a retired token.
if [ -f "$LL_06" ]; then
    wash06=0
    for sym in 'bg-white/45' 'opacity-75' 'text-muted-foreground'; do
        if grep -qF -- "$sym" "$ll_stripped"; then
            bad "a retired ink or alpha wash survives: $sym"
            wash06=1
        fi
    done
    if [ "$wash06" -eq 0 ]; then
        ok "no hardcoded white, no opacity wash, no retired foreground token"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[06-6] everything this card is known for survives the step\n'
# The DO-NOT list, made mechanical. The chart contract, the clocks, the crossfade
# and the two guards that exist because of real device behaviour.
if [ -f "$LL_06" ]; then
    keep06=0
    for sym in 'pathLength={1}' seriesMotion useChartDrawIn useChartSeriesMotion \
               CHART_POINTS LOSS_WINDOW ABSURD_AGE_SEC animate-live-ping \
               ca-content-in ca-skeleton-out SpeedtestDialog; do
        if ! grep -qF -- "$sym" "$ll_stripped"; then
            bad "live-latency.tsx lost $sym"
            keep06=1
        fi
    done
    if [ "$keep06" -eq 0 ]; then
        ok "the chart contract, the broken-clock guard, the live dot and the crossfade are intact"
    fi
    # The live figure must NOT tick. TickingValue is a 1.4s gesture and the
    # speedtest live cadence is 500ms -- it would strobe. Exactly one call site
    # is legal here, the header chip.
    ticks06=$(grep -c '<TickingValue' "$ll_stripped" || true)
    if [ "$ticks06" -eq 1 ]; then
        ok "one TickingValue -- the header chip ticks, the 500ms live figure does not"
    else
        bad "found $ticks06 TickingValue call sites; only the header chip may tick"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[06-7] no comment in this file quotes a duration the tokens no longer hold\n'
# Finding 16, and the audit under-counted it by five. The tokens are quick
# 360ms, standard 600ms, emphasized 800ms since the 2x retune; the file quotes
# SIX figures from before it -- "emphasized (400ms)" on the tile container (the
# one the finding names), "180ms" for a SwapLabel crossfade that runs `quick`,
# "300ms" three times for a `standard` that is 600ms, and a "700ms dip" for a
# TickingValue pair that is 1.4s. A comment quoting a retired number is worse
# than one quoting none: the next reader trusts it and computes a ratio from it,
# which is precisely what the "3.75x" in the chart-motion note did.
#
# Asserted against the RAW file, not the stripped one: comments are the subject.
if [ -f "$LL_06" ]; then
    stale06=0
    for num in '400ms' '300ms' '180ms' '700ms'; do
        if grep -qF -- "$num" "$LL_06"; then
            bad "a retired duration is still quoted in live-latency.tsx: $num"
            stale06=1
        fi
    done
    if [ "$stale06" -eq 0 ]; then
        ok "every duration this file names is one the tokens actually hold"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[06-8] the locale packs gained the description and lost the dead key\n'
# `speedtest.idle_description` was the tile idle sentence. The row is
# self-evident -- the play control IS the affordance -- so the sentence has no
# reader left. Removing it in the same commit keeps the packs from carrying a
# string no code can reach, which is the same drift one level down.
for lang in en zh-CN zh-TW it id; do
    lf="$REPO_ROOT/public/locales/$lang/dashboard.json"
    if [ ! -f "$lf" ]; then
        bad "missing locale pack: $lang/dashboard.json"
        continue
    fi
    block06=$(awk '/^  "latency": \{/{f=1} f{print} f && /^  \},?\r?$/{exit}' "$lf")
    if printf '%s' "$block06" | grep -q '"description"'; then
        ok "$lang carries latency.description"
    else
        bad "$lang is missing latency.description"
    fi
    if grep -q '"idle_description"' "$lf"; then
        bad "$lang still carries the dead speedtest.idle_description"
    else
        ok "$lang dropped the dead idle sentence"
    fi
done

# =============================================================================
# SECTION 07 -- Recent Activity
# =============================================================================
#
# The plan calls this step's headline "R1 -- let the list fill the card instead
# of clipping at five rows", and prescribes making VISIBLE_ROWS
# container-query-driven: 5 when the trio row is short, 6-7 when Device Metrics
# makes it tall.
#
# THE DEFECT IS REAL AND THE PRESCRIPTION IS WRONG, and the difference is a
# measurement. What follows is that measurement, because the assertions below
# pin the conclusion rather than the plan.
#
# WHERE THE DEAD SPACE ACTUALLY COMES FROM
# ----------------------------------------
#
# All three trio cards are `h-full`-locked, so the row height is whichever card
# is tallest, and every pixel a shorter card cannot absorb is dead space at its
# bottom. Device Metrics drives: 4 MeterRow + 3 PillRow = 340px of content
# against Recent Activity's 332px list. That is an 8px difference, not a 53px
# one.
#
# The other 45px is the HEADER. Device Metrics gained a `CardDescription` in
# step 05; Recent Activity has none. A two-line description plus its header gap
# is 45.5px, and 45.5 + 8 = 53.5 -- which is the dead space, exactly, with
# nothing left over.
#
# Measured on the dev server against 9f9675c, all three cards in `BAND.TRIO`
# inside `PAGE_GRID`, 3-column layout (the ONLY layout where this defect can
# exist -- at 2 columns Recent Activity is alone in the second row and at 1
# column nothing equalises, so in both cases its slack is 0 by construction):
#
#   viewport   Metrics header   Activity slack   Activity slack
#                               (as shipped)     (with a description)
#   --------   --------------   --------------   --------------------
#   1040px     104.3 (3 lines)  76.3             8.0
#   1120px      81.5 (2 lines)  76.3             0    (Metrics gets 14.8)
#   1280px      81.5 (2 lines)  53.5             8.0
#   1440px      81.5 (2 lines)  53.5             8.0
#   1700px      81.5 (2 lines)  53.5             8.0
#   1920px      58.8 (1 line)   30.8             8.0
#
# WHY A SIXTH ROW IS THE WRONG FIX, in one number: a row costs
# ROW_H + ROW_GAP = 68px and the hole is 53.5px. Six rows OVERSHOOT it by
# 14.5px, which does not remove the dead space -- it moves it onto Device
# Metrics, the one card in the trio with nothing to absorb it (Live Latency has
# `CHART_BOX`'s `flex-1`; Device Metrics has seven fixed-height rows). The
# prescription trades a 53px hole under the shortest card for a 15px hole under
# the tallest one, and adds a breakpoint to do it.
#
# That was verified rather than reasoned: raising the clip to six rows in the
# live DOM at 1280px grew the trio from 486px to 500.3px and made Recent
# Activity the driver.
#
# So [07-3] pins VISIBLE_ROWS AT FIVE. It is a guard, and it is the most
# important assertion in this section: the change the plan asked for is the
# change this section exists to prevent.
#
# WHAT CLOSES THE HOLE: the description, which finding 03 requires anyway. The
# residual is at most one text line (0-14.8px) and it cannot be driven to zero
# by any copy, because the two descriptions wrap independently -- Recent
# Activity's `CardAction` chip takes a grid column, so its text column is
# ~100px narrower than Device Metrics' at the same card width, and the packs
# translate to five different lengths. A one-line residual is the same residual
# every card pair on this surface carries.
#
# [07-1] through [07-5] run against comment-stripped source, same rationale as
# R0-6, 00-5, 01-6, 02-3, 03-1, 04-1, 05-1 and 06-1: this file argues with
# itself in prose at length, and a grep that reads a comment is a false green.

RA_07="$DASHBOARD/recent-activities.tsx"
SHAPES_07="$SHAPES_00"

printf '\n=============================================================\n'
printf 'SECTION 07 -- Recent Activity\n'
printf '=============================================================\n'

ra_stripped="$TMPD/recent-activities.stripped"
if [ -f "$RA_07" ]; then
    strip_comments "$RA_07" > "$ra_stripped"
else
    : > "$ra_stripped"
fi

# -----------------------------------------------------------------------------
printf '\n[07-1] the header carries a description, on the shared title size\n'
# Findings 03 and 02. The seventh of nine cards to gain one -- and on this card
# it is load-bearing rather than decorative: it is what closes R1.
if [ ! -f "$RA_07" ]; then
    bad "recent-activities.tsx is missing"
else
    if grep -q 'CardDescription' "$ra_stripped"; then
        ok "the card carries a description"
    else
        bad "the card still has no CardDescription"
    fi
    if grep -q 'CARD_DESC' "$ra_stripped"; then
        ok "the description speaks the surface's secondary ink"
    else
        bad "the description does not read CARD_DESC"
    fi
    if grep -q 'CARD_TITLE' "$ra_stripped"; then
        ok "the title reads the shared card-title size"
    else
        bad "the title still spells its own size instead of importing CARD_TITLE"
    fi
    if grep -q 'text-lg font-semibold' "$ra_stripped"; then
        bad "a hand-spelled card title survives in recent-activities.tsx"
    else
        ok "no hand-spelled title size is left on this card"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[07-2] all four states render ONE header, so all four carry the description\n'
# This card returns four separate subtrees -- loading, error-with-nothing,
# empty, and the list -- and they already share `renderHeader`. That is what
# makes the description a one-line change instead of four, and it is also what
# stops three of the four states from silently keeping the old header height
# and reintroducing the dead space in exactly the states nobody screenshots.
if [ -f "$RA_07" ]; then
    hdr07=$(grep -c 'renderHeader(' "$ra_stripped" || true)
    if [ "$hdr07" -eq 4 ]; then
        ok "four states, four calls to one header helper"
    else
        bad "expected 4 renderHeader( call sites, found $hdr07"
    fi
    desc07=$(grep -c '<CardDescription' "$ra_stripped" || true)
    if [ "$desc07" -eq 1 ]; then
        ok "the description is written once, inside that helper"
    else
        bad "found $desc07 CardDescription call sites -- it belongs in renderHeader only"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[07-3] the row window stays at five, and its arithmetic stays derived\n'
# THE GUARD, and the section's whole point. See the header for the measurement.
# A sixth row is 68px into a 53.5px hole and makes this card the trio's driver.
if [ -f "$RA_07" ]; then
    if grep -q 'const VISIBLE_ROWS = 5;' "$ra_stripped"; then
        ok "the list still shows five rows -- a sixth overshoots the hole by 14.5px"
    else
        bad "VISIBLE_ROWS moved off 5; re-read the measurement in this section's header"
    fi
    if grep -q 'const RENDER_COUNT = VISIBLE_ROWS + 1;' "$ra_stripped"; then
        ok "exactly one spare row, so the push slides under the edge"
    else
        bad "RENDER_COUNT is no longer VISIBLE_ROWS + 1"
    fi
    if grep -q 'VISIBLE_ROWS \* ROW_H' "$ra_stripped"; then
        ok "the clip edge is still derived from the row count, not restated"
    else
        bad "LIST_MAX_H no longer derives from VISIBLE_ROWS"
    fi
    if grep -q 'maxHeight: LIST_MAX_H' "$ra_stripped"; then
        ok "the clip reads the derived height"
    else
        bad "the clip no longer reads LIST_MAX_H"
    fi
    if grep -q 'length: VISIBLE_ROWS' "$ra_stripped"; then
        ok "the skeleton mirrors the row count off the same constant"
    else
        bad "the skeleton no longer derives its row count from VISIBLE_ROWS"
    fi
    for num in 'const ROW_H = 60;' 'const ROW_GAP = 8;' 'const ROW_ADVANCE = ROW_H + ROW_GAP;'; do
        if grep -qF -- "$num" "$ra_stripped"; then
            ok "row geometry intact: $num"
        else
            bad "row geometry moved: expected $num"
        fi
    done
fi

# -----------------------------------------------------------------------------
printf '\n[07-4] the icon disc is on the role radius scale\n'
# Finding 12. The last `rounded-full` on this file -- a 28px disc, so `pill`
# and `full` render identically and this is a pure grammar fix. That is the
# reason to do it rather than a reason to skip it: the next author reads the
# class, not the pixel.
if [ -f "$RA_07" ]; then
    if grep -q 'rounded-full' "$ra_stripped"; then
        bad "a legacy rounded-full survives in recent-activities.tsx"
    else
        ok "no rounded-full is left on this card"
    fi
    if grep -q 'size-7 shrink-0 place-items-center rounded-pill' "$ra_stripped"; then
        ok "the disc draws the role radius"
    else
        bad "the disc is not on rounded-pill"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[07-5] the shell, the clock, and everything this card is known for survive\n'
# CARD_SHELL and CLOCK_TICK_MS were hoisted in step 00 and are green BEFORE the
# fix: the job here is that a step editing the header does not re-inline one.
# The rest is the plan's DO-NOT list, made mechanical -- the age-gated tone
# split, the glyph discriminator, the never-expiring disc, the spoken severity,
# the two-clock reading, and the two entrances.
if [ -f "$RA_07" ]; then
    keep07=0
    for sym in CARD_SHELL CLOCK_TICK_MS presentEvent computeUnresolved isFresh \
               glyphFilled discClass containerClass srSeverityKey \
               historyGroup staggerRowItem transitionEmphasized SwapLabel \
               EmptyDescription 'role="alert"'; do
        if ! grep -q -- "$sym" "$ra_stripped"; then
            bad "recent-activities.tsx lost $sym"
            keep07=1
        fi
    done
    if [ "$keep07" -eq 0 ]; then
        ok "the tone split, the disc, the spoken severity, both entrances and the error branch are intact"
    fi
    if grep -q 'className={CARD_SHELL}' "$ra_stripped"; then
        ok "every state draws the hoisted shell"
    else
        bad "the card no longer draws CARD_SHELL"
    fi
    if grep -q 'rounded-card border-0' "$ra_stripped"; then
        bad "a shell is spelled inline in recent-activities.tsx"
    else
        ok "no shell is spelled inline"
    fi
    if grep -q 'const CLOCK_TICK_MS' "$ra_stripped"; then
        bad "CLOCK_TICK_MS was re-declared locally -- it lives in shapes.ts"
    else
        ok "the clock interval is still read from shapes.ts"
    fi
    # The clamp that stops a modem whose RTC never reached NTP printing
    # "20454 d ago". types/modem-status.ts carries the same one.
    if grep -q 'Math.max(0, nowSec - timestamp)' "$ra_stripped"; then
        ok "the negative-clock clamp survives"
    else
        bad "useTimeAgo lost its Math.max(0, ...) clamp"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[07-6] the locale packs carry the new copy on every language\n'
# Extract the `activities` object first, same reason as [04-6], [05-6] and
# [06-8]: `"description"` appears in several unrelated objects in these packs
# and a whole-file grep is how SECTION 01 nearly shipped a false green.
for lang in en zh-CN zh-TW it id; do
    lf="$REPO_ROOT/public/locales/$lang/dashboard.json"
    if [ ! -f "$lf" ]; then
        bad "missing locale pack: $lang/dashboard.json"
        continue
    fi
    block07=$(awk '/^  "activities": \{/{f=1} f{print} f && /^  \},?\r?$/{exit}' "$lf")
    if printf '%s' "$block07" | grep -q '^    "description"'; then
        ok "$lang carries activities.description"
    else
        bad "$lang is missing activities.description"
    fi
done

# =============================================================================
# SECTION 08 -- Signal History
# =============================================================================
#
# The last card on the surface still spelling its own shell, its own title size
# and no description at all. Three findings land here at once (02, 03, 04) and
# they are the same finding wearing three hats: this file was written against
# the mock directly, before there was a shapes module to write against.
#
# THE TITLE IS THE VISIBLE CHANGE, and it is the biggest single type change in
# the pass. `text-2xl @[250px]/card:text-3xl` puts this card's heading at 30px
# on any dashboard wider than a phone -- the SAME size as `HEADER.TITLE`, the
# route's own h1, which sits a full scroll above it on the same page. Two
# things at the top of a type ramp is no ramp: the card was reading as a second
# page title rather than as the ninth card. `CARD_TITLE` (18px) is what the
# other eight now speak, and after this step the surface has exactly one 30px
# string on it.
#
# `tracking-[-0.02em]` goes with it. Tight tracking is a display-size
# correction -- `HEADER.TITLE` carries it because 30px needs it. At 18px it is
# a hand-tuned number sitting on a shared size, which is the whole category of
# thing this pass removes, so [08-1] pins its absence rather than leaving it to
# taste.
#
# THE SHELL: `px-7` -> `px-6`. This card is a PEER, not the hero. It sits alone
# in a `BAND.FULL` row under the trio, in the same visual class as the eight
# cards that take `CARD_SHELL`, and it took 28px padding only because it was
# authored from the mock's hero measurements. `HERO_SHELL` and `CA_SHELL` keep
# `px-7`; those two earned it.
#
# ONE SECOND-ORDER EFFECT, recorded because it is not obvious: `@container/card`
# is `container-type: inline-size`, which measures the CONTENT box. Dropping 4px
# of padding per side makes this card's queried width 8px LARGER at the same
# rendered width, so the `@[540px]/card` ToggleGroup-vs-Select swap fires 8px
# earlier in viewport terms. That is a shift of the threshold, not a change to
# the mechanism, and 8px on a full-width card is under one column gutter. It is
# pinned in [08-4] as a mechanism guard, not as a pixel.
#
# `h-full` also arrives with `CARD_SHELL`, and here it is inert: this card is
# the only item in its grid row, so `h-full` resolves against a row height that
# is itself content-derived. It is not inert on the trio cards, which is why
# the constant carries it.
#
# THE DESCRIPTION AND THE FOOTER ARE NOT THE SAME LINE, which is the one real
# judgement call in this step. This card already carries two strings under the
# plot: `trend_heading`, which names the metric and unit CURRENTLY plotted and
# changes with the switcher, and `fluctuation_note`, a caveat about reading the
# numbers. Neither says what the card is FOR. The header description does, and
# it is the only one of the three that is true before the chart has any data --
# which matters, because it renders in the loading, error and empty branches
# where the plot itself says nothing at all.
#
# [08-1] through [08-5] run against comment-stripped source, same rationale as
# R0-6, 00-5, 01-6, 02-3, 03-1, 04-1, 05-1, 06-1 and 07-1: this file carries a
# 17-line header comment quoting the very classes under test, and a grep that
# reads a comment is a false green.

SH_08="$DASHBOARD/signal-history.tsx"

printf '\n=============================================================\n'
printf 'SECTION 08 -- Signal History\n'
printf '=============================================================\n'

sh_stripped="$TMPD/signal-history.stripped"
if [ -f "$SH_08" ]; then
    strip_comments "$SH_08" > "$sh_stripped"
else
    : > "$sh_stripped"
fi

# -----------------------------------------------------------------------------
printf '\n[08-1] the title speaks the shared card size, not the page title size\n'
# Finding 02, and the last of the three. See the header: 30px on a card under a
# 30px h1 is not a ramp.
if [ ! -f "$SH_08" ]; then
    bad "signal-history.tsx is missing"
else
    if grep -q 'CARD_TITLE' "$sh_stripped"; then
        ok "the title reads the shared card-title size"
    else
        bad "the title still spells its own size instead of importing CARD_TITLE"
    fi
    if grep -q 'text-2xl' "$sh_stripped"; then
        bad "text-2xl survives on the card title"
    else
        ok "no text-2xl is left on this card"
    fi
    if grep -q 'text-3xl' "$sh_stripped"; then
        bad "text-3xl survives -- the surface must carry exactly one, on the page h1"
    else
        ok "the page h1 is the only 30px string on the surface again"
    fi
    if grep -q 'tracking-\[-0.02em\]' "$sh_stripped"; then
        bad "the display-size tracking correction survives on an 18px title"
    else
        ok "no hand-tuned tracking is left on a shared size"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[08-2] the header carries a description, written once for all four states\n'
# Finding 03, the ninth and last card to gain one. This file already builds its
# header into a single `const header` that all four branches render, which is
# what makes the description a one-line change AND what stops three of the four
# states from keeping the old header height.
if [ -f "$SH_08" ]; then
    if grep -q 'CardDescription' "$sh_stripped"; then
        ok "the card carries a description"
    else
        bad "the card still has no CardDescription"
    fi
    if grep -q 'CARD_DESC' "$sh_stripped"; then
        ok "the description speaks the surface's secondary ink"
    else
        bad "the description does not read CARD_DESC"
    fi
    desc08=$(grep -c '<CardDescription' "$sh_stripped" || true)
    if [ "$desc08" -eq 1 ]; then
        ok "the description is written once, inside the shared header"
    else
        bad "found $desc08 CardDescription call sites -- it belongs in the shared header only"
    fi
    hdr08=$(grep -c '{header}' "$sh_stripped" || true)
    if [ "$hdr08" -eq 4 ]; then
        ok "four states, four renders of that one header"
    else
        bad "expected 4 {header} render sites, found $hdr08"
    fi
    if grep -q 'signal_history.description' "$sh_stripped"; then
        ok "the copy is a locale key, not a literal"
    else
        bad "the description does not read signal_history.description"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[08-3] the shell is the shared one, at peer padding\n'
# Finding 04, the fifth and last copy of the card shell. `px-7` is the hero's
# padding and this card is a peer -- it sits alone in a BAND.FULL row under the
# trio, in the same visual class as the eight cards on CARD_SHELL.
if [ -f "$SH_08" ]; then
    if grep -q 'CARD_SHELL' "$sh_stripped"; then
        ok "the card reads a shell constant"
    else
        bad "the card does not reference CARD_SHELL"
    fi
    if grep -q 'const CARD_SHELL' "$sh_stripped"; then
        bad "CARD_SHELL is still declared locally -- it lives in shapes.ts"
    else
        ok "the shell is imported, not re-declared"
    fi
    if grep -q 'from "./shapes"' "$sh_stripped"; then
        ok "the import points at the dashboard's shapes module"
    else
        bad "signal-history.tsx does not import from ./shapes"
    fi
    if grep -q 'px-7' "$sh_stripped"; then
        bad "hero padding survives on a peer card"
    else
        ok "the card is on peer padding"
    fi
    if grep -q 'rounded-card border-0' "$sh_stripped"; then
        bad "a shell is spelled inline in signal-history.tsx"
    else
        ok "no shell is spelled inline"
    fi
    shell08=$(grep -c 'className={CARD_SHELL}' "$sh_stripped" || true)
    if [ "$shell08" -eq 4 ]; then
        ok "all four states draw the same shell"
    else
        bad "expected 4 CARD_SHELL call sites, found $shell08"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[08-4] everything this card is known for survives\n'
# The plan's DO-NOT list, made mechanical: the responsive control swap, the
# travelling pill, the deselect guard, the axis geometry, the two-hue series
# pairing, the fill-floor arithmetic, the pinned plot height, the keyboard
# layer, the honest gaps, and the dash normalisation the entrance depends on.
if [ -f "$SH_08" ]; then
    keep08=0
    for sym in '@\[540px\]/card' 'layoutId' 'value && setSignalType(value)' \
               'const AXIS_W = 34;' 'const Y_AXIS_PAD = 5;' \
               'const CHART_H = "h-\[250px\]";' \
               'var(--chart-nr)' 'var(--chart-lte)' \
               'baseValue={baseValue}' 'dataMin - ' \
               'accessibilityLayer' 'connectNulls={false}' 'pathLength={1}' \
               'useChartDrawIn' 'useChartSeriesMotion' 'newestDotRenderer'; do
        if ! grep -q -- "$sym" "$sh_stripped"; then
            bad "signal-history.tsx lost $sym"
            keep08=1
        fi
    done
    if [ "$keep08" -eq 0 ]; then
        ok "the control swap, the travelling pill, the axis geometry, the series pairing and both chart clocks are intact"
    fi
    # The fill floor and the axis floor must be the SAME line -- see the long
    # comment on getBaseValue. A mismatch reads as a thin line with a gap under
    # it and produces no error of any kind.
    if grep -q 'getBaseValue() - Y_AXIS_PAD' "$sh_stripped"; then
        ok "the fill floor is still derived from the axis pad, not restated"
    else
        bad "baseValue no longer derives from Y_AXIS_PAD -- the fill floor will drift off the axis floor"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[08-5] the skeleton mirror and the radius scale hold\n'
# The plan is explicit that the `rounded-inline` slivers STAY -- they are on the
# role scale already, and this card's skeleton is the surface's cleanest mirror:
# rail, plot, caption row, legend row, at the loaded height.
if [ -f "$SH_08" ]; then
    if grep -q 'rounded-full' "$sh_stripped"; then
        bad "a legacy rounded-full survives in signal-history.tsx"
    else
        ok "no rounded-full is left on this card"
    fi
    if grep -q 'rounded-inline' "$sh_stripped"; then
        ok "the skeleton slivers keep the inline radius"
    else
        bad "the skeleton lost its rounded-inline slivers"
    fi
    if grep -q 'className={CHART_H}' "$sh_stripped"; then
        ok "the skeleton is pinned at the loaded plot height"
    else
        bad "the skeleton no longer reads CHART_H"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[08-6] the locale packs carry the new copy on every language\n'
# Extract the `signal_history` object first, same reason as [04-6], [05-6],
# [06-8] and [07-6]: `"description"` appears in several unrelated objects in
# these packs and a whole-file grep is how SECTION 01 nearly shipped a false
# green.
for lang in en zh-CN zh-TW it id; do
    lf="$REPO_ROOT/public/locales/$lang/dashboard.json"
    if [ ! -f "$lf" ]; then
        bad "missing locale pack: $lang/dashboard.json"
        continue
    fi
    block08=$(awk '/^  "signal_history": \{/{f=1} f{print} f && /^  \},?\r?$/{exit}' "$lf")
    if printf '%s' "$block08" | grep -q '^    "description"'; then
        ok "$lang carries signal_history.description"
    else
        bad "$lang is missing signal_history.description"
    fi
done

# =============================================================================
# SECTION 09 -- Speed test dialog
# =============================================================================
#
# The last file in the pass, and the only one that is not on the grid: a modal.
# Findings 10, 12 and 17 all land here, and the four things this section pins
# are four different KINDS of defect wearing one heading.
#
# 1. THE METER'S CLOCK IS A COUPLING, NOT A TASTE CALL. `duration-500` is off
#    the 360/600/800 scale, and the file's own comment claims it as a sanctioned
#    exception -- correctly. The bar tracks a real throughput sample arriving on
#    its own clock, so `linear` is right where the system's curves would read as
#    easing the DATA, and the duration must equal the poll cadence rather than a
#    step of the motion scale. Moving it to `--duration-standard` (600ms) would
#    make the fill still travelling when the next sample lands, which is the one
#    thing the bar must not do.
#
#    So the defect is NOT the number. It is that the number is RETYPED. The
#    cadence is `LIVE_INTERVAL_MS` in `hooks/use-speedtest.ts`, and the two
#    500s were coupled by nothing but a comment: retune the poll and the bar
#    silently lags, with no error anywhere and no test that can see it. Same
#    family as `CLOCK_TICK_MS` declared twice (finding 15), which step 00 fixed
#    by hoisting rather than by re-picking a value.
#
#    [09-1] therefore pins the DERIVATION, not a duration: the literal is gone,
#    the constant is exported, the dialog reads it, and `ease-linear` plus
#    `motion-reduce:transition-none` both survive -- the exception is preserved
#    on purpose, only its second copy is removed.
#
# 2. THE MODAL-EXIT RULE, AT THE CALL SITE. `components/ui/dialog.tsx` already
#    gets this right in both halves: `data-[state=open]:` on `emphasized`,
#    `data-[state=closed]:` on `quick`, and the overlay carries the identical
#    pair so the scrim and the panel leave as one object. What the call site
#    added was an UNQUALIFIED `duration-[var(--duration-emphasized)]
#    ease-emphasized`, which applies to the closed state too.
#
#    Whether it actually wins is decided by CSS emission order between two
#    candidates the tooling cannot see as conflicting -- `twMerge` does not
#    read a variant-prefixed arbitrary duration as colliding with a bare one,
#    so both survive into the class list and the cascade decides. That is the
#    same alphabetical trap `lib/utils.ts` documents for radii and DESIGN.md
#    documents for `bg-input` vs `bg-surface-*`. A rule that holds by accident
#    of sort order is not held, and the cost if it flips is 800ms of dead
#    clicks on every close of a dialog whose whole job is to be dismissed.
#
#    [09-2] pins it by COUNT: every `duration-[var(--duration-emphasized)]` in
#    this file must be `data-[state=open]:`-qualified, so an unqualified one
#    cannot be reintroduced. The primitive's own two halves are guarded beside
#    it, because the call site being correct is worth nothing if the base is
#    edited out from under it.
#
# 3. THE HARDCODED WHITE (finding 10). `bg-white/45` is the live meter's
#    progress track, and it does not theme: a fixed white at 45% over
#    `downlink-container` computes to L~0.62 in dark mode against a `downlink`
#    fill at L 0.66 -- track and fill four hundredths apart, which is a
#    progress bar that cannot be read at all in dark. `surface-container-high`
#    (0.938 light / 0.235 dark) sits clear of both direction containers in both
#    themes: lighter than `downlink-container` (0.875) and `uplink-container`
#    (0.915) in light, darker than both (0.285 / 0.345) in dark, so it reads as
#    a recessed groove rather than a veil. This is the same substitution step 06
#    already made in `live-latency.tsx`, whose comment records the reasoning,
#    and it puts this file's two `TrackBar` call sites on the same footing --
#    the ping tile at :629 has always passed a real token.
#
# 4. THE RADIUS SCALE (finding 12). Four `rounded-full`, and after this step
#    they are the last four on the whole surface: `network-status` (18),
#    `device-status` (2) and `recent-activities` (1) went in steps 01, 03 and
#    07. `--radius-pill` is `9999px`, so this is byte-for-byte the same circle;
#    what it buys is that the role scale has no member the reader has to know
#    is a synonym. [09-4] pins zero across `components/dashboard/**`, not just
#    in this file, because "the last four" is only true once.
#
# -----------------------------------------------------------------------------
# TWO ITEMS OF THE PLAN'S STEP ARE PINNED **UNCHANGED**, WITH REASONS
# -----------------------------------------------------------------------------
#
# `bg-primary/90` x2 (:514, :870). The plan reads this as an opacity wash to be
# replaced with "a real token". There is no such token: no `--primary-hover`
# exists in `app/globals.css`, and `hover:bg-primary/90` is the string
# `components/ui/button.tsx` ships as its own `default` variant, repeated
# verbatim at six sites product-wide (`button.tsx`, `badge.tsx`, `banner.tsx`,
# `login-component.tsx`, and these two). Changing two dashboard copies would
# make the dashboard's primary CTA hover differ from every other primary CTA in
# the product -- the exact divergence this pass exists to remove -- to fix a
# convention that lives in a primitive. DESIGN.md's own /dashboard delta agrees
# and says the surface has "no opacity washes on role colours"; its "don't
# compensate with an alpha" rule is about a mismatched FILL pair, and a hover
# step is not a pair. Retiring the pattern is a product-wide primitive change
# with its own gate. [09-5] pins the count at 2 so a drive-by fix goes red.
#
# The `rounded-tile` boxes are NOT re-pointed at `shapes.ts`'s `TILE`. `TILE` is
# minted at the system's pinned 104px horizontal geometry with a 52px disc
# (`TILE.ROOT` = `flex h-[6.5rem] items-center gap-3.5 rounded-tile px-5 py-4`),
# and shapes.ts's own header records that. Not one of this file's five
# `rounded-tile` boxes is that shape: the live meter is a vertical column
# holding a 52px display numeral, the result tile is a centred column, and the
# server line is a horizontal row at `py-3`. They already carry the role-scale
# radius token directly; there is no shared geometry here to hoist, only a
# radius they and `TILE` both happen to use. Importing a grid module into a
# modal to share one class name would be the coupling, not the fix.
#
# [09-1] through [09-5] run against comment-stripped source, same rationale as
# R0-6, 00-5, 01-6, 02-3, 03-1, 04-1, 05-1, 06-1, 07-1 and 08-1 -- and this file
# needs it more than any of them: it carries a 75-line header plus inline
# comments that quote `transition-all`, `duration-500`, `bg-white/45` and
# `rounded-full` while arguing about them. The audit that produced finding 17
# read one of those comments as code (see the report), which is exactly the
# false green a stripped read prevents.

SD_09="$DASHBOARD/speedtest-dialog.tsx"
HOOK_09="$REPO_ROOT/hooks/use-speedtest.ts"
DLG_09="$COMPONENTS/ui/dialog.tsx"

printf '\n=============================================================\n'
printf 'SECTION 09 -- Speed test dialog\n'
printf '=============================================================\n'

sd_stripped="$TMPD/speedtest-dialog.stripped"
if [ -f "$SD_09" ]; then
    strip_comments "$SD_09" > "$sd_stripped"
else
    : > "$sd_stripped"
fi

# -----------------------------------------------------------------------------
printf '\n[09-1] the meter clock derives from the poll cadence instead of retyping it\n'
if [ ! -f "$SD_09" ]; then
    bad "speedtest-dialog.tsx is missing"
else
    if grep -q 'duration-500' "$sd_stripped"; then
        bad "the retyped 500ms literal survives on the meter"
    else
        ok "no retyped poll cadence is left in the class list"
    fi
    if grep -q 'LIVE_INTERVAL_MS' "$sd_stripped"; then
        ok "the dialog reads the poll cadence by name"
    else
        bad "the dialog does not reference LIVE_INTERVAL_MS"
    fi
    if grep -q 'transitionDuration' "$sd_stripped"; then
        ok "the meter sets its duration from that constant"
    else
        bad "the meter does not set transitionDuration from the cadence"
    fi
    # The exception itself is preserved -- only its duplicated number goes.
    if grep -q 'ease-linear' "$sd_stripped"; then
        ok "the linear curve survives: the bar is data arriving, not a flourish"
    else
        bad "ease-linear was lost -- the fill would now ease the DATA"
    fi
    if grep -q 'motion-reduce:transition-none' "$sd_stripped"; then
        ok "motion-reduce still drops the travel entirely"
    else
        bad "the motion-reduce escape was lost from the meter"
    fi
fi
if [ -f "$HOOK_09" ]; then
    if grep -q 'export const LIVE_INTERVAL_MS' "$HOOK_09"; then
        ok "use-speedtest publishes the cadence as one exported constant"
    else
        bad "LIVE_INTERVAL_MS is not exported from hooks/use-speedtest.ts"
    fi
else
    bad "hooks/use-speedtest.ts is missing"
fi

# -----------------------------------------------------------------------------
printf '\n[09-2] the modal-exit rule is state-qualified, at the call site and in the base\n'
if [ -f "$SD_09" ]; then
    emph_all=$(grep -o 'duration-\[var(--duration-emphasized)\]' "$sd_stripped" | wc -l | tr -d ' ')
    emph_open=$(grep -o 'data-\[state=open\]:duration-\[var(--duration-emphasized)\]' "$sd_stripped" | wc -l | tr -d ' ')
    if [ "$emph_all" -eq "$emph_open" ]; then
        ok "every emphasized duration here is scoped to the OPEN state ($emph_open of $emph_all)"
    else
        bad "$((emph_all - emph_open)) unqualified emphasized duration(s) -- these also slow the CLOSE"
    fi
    if grep -q 'data-\[state=open\]:ease-emphasized' "$sd_stripped"; then
        ok "the emphasized curve is scoped to the open state too"
    else
        bad "the emphasized curve is not scoped to data-[state=open]"
    fi
fi
# Guard the primitive: the call site being right is worth nothing if the base
# loses the closed-state half underneath it.
if [ -f "$DLG_09" ]; then
    dlg_closed=$(grep -o 'data-\[state=closed\]:duration-\[var(--duration-quick)\]' "$DLG_09" | wc -l | tr -d ' ')
    if [ "$dlg_closed" -eq 2 ]; then
        ok "the primitive still exits on quick for both the panel and the scrim"
    else
        bad "expected 2 closed-state quick durations in dialog.tsx, found $dlg_closed"
    fi
    if grep -q 'data-\[state=open\]:duration-\[var(--duration-emphasized)\].*data-\[state=closed\]' "$DLG_09"; then
        ok "the primitive keeps both halves of the two-clock pair"
    else
        bad "dialog.tsx no longer pairs an emphasized open with a quick close"
    fi
else
    bad "components/ui/dialog.tsx is missing"
fi

# -----------------------------------------------------------------------------
printf '\n[09-3] the progress track is a themed token, not a hardcoded white\n'
if [ -f "$SD_09" ]; then
    if grep -q 'bg-white' "$sd_stripped"; then
        bad "a hardcoded white survives in speedtest-dialog.tsx"
    else
        ok "no hardcoded white is left in the dialog"
    fi
    if grep -q 'trackClassName="bg-surface-container-high"' "$sd_stripped"; then
        ok "the live meter's track is the neutral step one in from the container"
    else
        bad "the live meter track is not bg-surface-container-high"
    fi
    track09=$(grep -c 'trackClassName="bg-surface-container' "$sd_stripped" || true)
    if [ "$track09" -eq 2 ]; then
        ok "both TrackBar call sites pass a real token"
    else
        bad "expected 2 tokenised TrackBar tracks, found $track09"
    fi
fi
# Finding 10 named two files. live-latency went in step 06; this closes it.
# Stripped, not raw: live-latency.tsx:757 still QUOTES `bg-white/45` in the
# comment recording what its meter replaced, and a raw grep would read that
# prose as code -- the same false green [09-1]'s header warns about, and the
# reason this assertion was rewritten before the red commit.
white09=0
for f in "$DASHBOARD"/*.tsx; do
    [ -f "$f" ] || continue
    if strip_comments "$f" | grep -q 'bg-white'; then
        white09=$((white09 + 1))
    fi
done
if [ "$white09" -eq 0 ]; then
    ok "no file under components/dashboard/ carries a hardcoded white"
else
    bad "$white09 dashboard file(s) still carry bg-white"
fi

# -----------------------------------------------------------------------------
printf '\n[09-4] the radius role scale is complete across the surface\n'
if [ -f "$SD_09" ]; then
    rf09=$(grep -c 'rounded-full' "$sd_stripped" || true)
    if [ "$rf09" -eq 0 ]; then
        ok "the dialog is on the role scale"
    else
        bad "$rf09 rounded-full survive in speedtest-dialog.tsx"
    fi
fi
# The whole surface, not just this file: finding 12 counted 25 across four
# files and this step retires the last four.
rf_all=$(grep -rho 'rounded-full' "$DASHBOARD" --include=*.tsx 2>/dev/null | wc -l | tr -d ' ')
if [ "$rf_all" -eq 0 ]; then
    ok "zero rounded-full remain anywhere under components/dashboard/"
else
    bad "$rf_all rounded-full remain across the dashboard surface"
fi

# -----------------------------------------------------------------------------
printf '\n[09-5] the pipeline, the full result, and the two deliberate non-changes\n'
# The plan's DO-NOT list plus the two items argued in this header. A modal that
# is the DETAIL view is the whole reason step 06 could shrink the dashboard row
# to 40px, so anything that shrinks the result here is a regression in step 06,
# not a tidy-up here.
if [ -f "$SD_09" ]; then
    keep09=0
    for sym in 'const ROLE: Record<SpeedtestStep, RoleTokens>' \
               'const STEP_LABEL_KEY' 'const STEP_STATUS_KEY' \
               'SPEEDTEST_STEPS' 'resolveStepStates' \
               'function ResultTile' 'function MetricPill' 'function TrackBar' \
               'text-\[44px\]' 'text-\[52px\]' 'text-\[26px\]' \
               'bg-downlink-container' 'bg-uplink-container' \
               'metric_jitter' 'metric_packet_loss' 'result_isp'; do
        if ! grep -q -- "$sym" "$sd_stripped"; then
            bad "speedtest-dialog.tsx lost $sym"
            keep09=1
        fi
    done
    if [ "$keep09" -eq 0 ]; then
        ok "the phase machine, the colour contract and the full result display are intact"
    fi
    # Pinned UNCHANGED -- see the header. A drive-by "fix" of either goes red.
    prim09=$(grep -c 'hover:bg-primary/90' "$sd_stripped" || true)
    if [ "$prim09" -eq 2 ]; then
        ok "the two primary CTAs still hover exactly as button.tsx does"
    else
        bad "expected 2 hover:bg-primary/90 (the primitive's own string), found $prim09"
    fi
    tile09=$(grep -c 'rounded-tile' "$sd_stripped" || true)
    if [ "$tile09" -eq 5 ]; then
        ok "all five tonal boxes keep the role radius, and none was re-pointed at TILE"
    else
        bad "expected 5 rounded-tile boxes, found $tile09"
    fi
    if grep -q 'from "./shapes"' "$sd_stripped"; then
        bad "the modal imports the grid's shapes module -- it is off-grid by design"
    else
        ok "the off-grid modal does not reach into the grid's shapes module"
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
