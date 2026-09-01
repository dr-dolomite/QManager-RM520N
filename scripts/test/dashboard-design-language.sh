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

# -----------------------------------------------------------------------------
printf '\n-------------------------------------------------------------\n'
printf 'passed: %d   failed: %d\n' "$pass_count" "$fail_count"
if [ "$fail_count" -gt 0 ]; then
    printf 'RESULT: FAIL\n\n'
    exit 1
fi
printf 'RESULT: PASS\n\n'
exit 0
