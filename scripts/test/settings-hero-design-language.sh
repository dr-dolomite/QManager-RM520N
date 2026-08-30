#!/usr/bin/env bash
# Regression harness for the /cellular/settings hero re-authoring and the
# segmented-control motion fix.
#
# WHY THIS EXISTS
# ----------------
# The anchor card on /cellular/settings (`ModemHeroCard`, 826 lines) is composed
# around the wrong question. A settings surface is asked "what is this modem set
# to, and what happens if I touch this?" — the hero instead leads with AMBR, the
# network-granted rate ceiling, across two of its three columns. AMBR is the most
# specialist number on the page, is not settable anywhere on it, and none of the
# six writable fields can move it.
#
# Three findings carry the decision, and most assertions below pin one of them:
#
#   1. THE RAIL RUNS A RETIRED GENERATION. `HERO_RAIL_TONE.NR` is
#      "bg-primary text-primary-foreground" painted across a full-width block.
#      `radio/summary-tiles.tsx` documents five generations of exactly this
#      shape: Gen 2 measured it live at 623x212 = 132,033px^2 carrying 9,526px^2
#      of ink (7.2%) and called it "a large empty purple slab"; Gen 5 removed
#      body tint entirely — "Every tile body is now NEUTRAL_TILE and the disc is
#      the only coloured element on the strip." The hero's own JSDoc cites that
#      file as its precedent.                              -> [2] [3] [4] [5]
#   2. THE CARD CARRIES TWO CLOCKS. The rail and parameters come from the poller
#      (~4s); the two rate columns come from the settings GET, which does not
#      tick. The cost is two readiness flags, two failure branches, a freshness
#      chip deliberately scoped to one band, and `HERO_FOOTNOTE`, whose JSDoc
#      says it "exists because the hero has TWO CLOCKS and one of them does not
#      tick."                                              -> [6] [7] [8] [10]
#   3. TWO FACTS RENDER TWICE. Radio power and Active slot appear as read-only
#      ParamRows in the hero AND as the selected segment of a control ~400px
#      below, both sourced from the same `saved` object.    -> [1] [10]
#
# Eighteen distinct facts render in one card. That is the "bloated / confusing /
# too much" complaint as a number.
#
# The surface is otherwise well built — no raw Tailwind colours, no
# `transition-all`, no bare durations, no Badge doing a Tag's job, no
# untranslated strings, and every skeleton already imports its shape constant.
# [16] exists to keep it that way, not to repair it.
#
# The assertions are text-anchored to the names in the APPROVED plan
# (docs/reference/_handoff-settings-hero-execute.md §4), never to names invented
# while writing the fix. That is what keeps them independent of the fix: a
# builder who renames a symbol, re-gates it, or substitutes a weaker mechanism
# fails the test, which is the point.
#
# This harness is COMMITTED RED, before the fix exists (change-workflow.md,
# Phase 4a). The builder who writes the fix does not edit this file.
#
# THE FOUR VETO ANSWERS (recorded 2026-08-30, user)
# --------------------------------------------------
#   V1  the hero card becomes a TILE STRIP, not a card       -> [2] [3] [4] [5]
#   V2  AMBR drops to a summary line + disclosure            -> [6] [7]
#   V3  the four tiles: Network / SIM / Aggregation / Data path -> [4] [17]
#   V4  the settings.sh seeding defect is tracked SEPARATELY  -> (no assertion;
#       fixing it is a CGI change and would re-tier this to 3)
# Had V1-V3 been declined the corresponding assertions would not exist. They do,
# so they are load-bearing. V4's absence is equally deliberate: this harness must
# not grow a backend assertion, or the change stops being frontend-only.
#
# ONE DOCUMENTED DEPARTURE FROM THE PLAN'S §4
# --------------------------------------------
# The plan's assertion 8 lists `READOUT_ROW` among the shapes.ts exports to
# retire. It is NOT asserted here, and that is a correction, not a relaxation:
# `READOUT_ROW` has three live consumers outside the dying hero —
# `apn-management/apn-settings.tsx`, `imei-settings/imei-settings-card.tsx` and
# `imei-settings/imei-tools-card.tsx`, all importing it from `../shapes`. Those
# are the APN and IMEI sub-routes, which the plan's own §9 places OUT OF SCOPE.
# Asserting its removal would require editing three out-of-scope files to satisfy
# a test. The other nine names in [8] were each verified hero-only before being
# asserted, as were the three in [9].
#
# SCOPINGS, stated openly so they are not mistaken for a weakened test
# ---------------------------------------------------------------------
#  [4] [11] [12] [13] [14] [16] are checked against COMMENT-STRIPPED source.
#      These files carry long rationale comments that quote the very classes and
#      mechanisms being retired — setting-row.tsx's header says "Never
#      `transition-all`", segmented-field.tsx's says "THE FIRST-PAINT GUARD".
#      A comment explaining why something was removed is documentation, not code,
#      and failing on it would push the builder to delete the reasoning.
#  [8] [9] [14b] [15] are checked against RAW source on purpose. [8] and [9] read
#      `export const` declarations, [14b] and [15] are assertions ABOUT comment
#      text — stripping would make them unevaluatable.
#  [12] "no ternary" is checked as the absence of `transition={settled` and of a
#      `?` on the same expression, not as a general ban on ternaries in the file.
#      The segment still branches on `isActive` for its reserved-glyph class,
#      which [13] requires.
#  [13] The plan's §6.A measured the cost of NOT doing this: the check glyph plus
#      `gap-1.5` is worth 21.7px and renders only on the active segment, so the
#      thumb — `absolute inset-0`, therefore the segment's own box — has both
#      ends of its animation change under it. First frame measured
#      `scale(1.13606, 1)`. Widths are not asserted to be EXACTLY stable: a
#      residual 0.3px from `data-[state=on]:font-semibold` survives by design.
#  [16] `duration-[<digit>` is the Tailwind utility form and deliberately does
#      not match the arbitrary CSS property form. `duration-[--duration-standard]`
#      and `duration-[var(--duration-standard)]` are the sanctioned tokens.
#
# Run: bash scripts/test/settings-hero-design-language.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SETTINGS_DIR="$REPO_ROOT/components/cellular/settings"

HERO="$SETTINGS_DIR/modem-hero-card.tsx"
STRIP_FILE="$SETTINGS_DIR/live-state-strip.tsx"
RATE_FILE="$SETTINGS_DIR/rate-ceiling-disclosure.tsx"
SHELL_FILE="$SETTINGS_DIR/cellular-settings.tsx"
SEGMENTED_FILE="$SETTINGS_DIR/segmented-field.tsx"
ROW_FILE="$SETTINGS_DIR/setting-row.tsx"
SHAPES="$SETTINGS_DIR/shapes.ts"
TILE_SHAPE="$REPO_ROOT/components/cellular/tile-shape.ts"
LOCALES="$REPO_ROOT/public/locales"

pass_count=0
fail_count=0

ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

show() { printf '       offending lines:\n'; sed 's/^/         /'; }

# Files that must exist regardless of the fix's state, or the harness cannot run.
for f in "$SHELL_FILE" "$SEGMENTED_FILE" "$ROW_FILE" "$SHAPES" "$TILE_SHAPE"; do
    [ -f "$f" ] || { echo "expected source file not found: $f" >&2; exit 1; }
done

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

# Strip //-to-EOL, /* */ and {/* */} comments so a prose mention of a retired
# class or mechanism cannot fail an assertion about rendered code.
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

# A missing file strips to an empty one, so downstream assertions report the
# real defect ("no LiveStateStrip") instead of dying on a bad path.
strip_or_empty() {
    if [ -f "$1" ]; then strip_comments "$1" > "$2"; else : > "$2"; fi
}

strip_or_empty "$STRIP_FILE"     "$TMPD/strip.code"
strip_or_empty "$RATE_FILE"      "$TMPD/rate.code"
strip_or_empty "$SHELL_FILE"     "$TMPD/shell.code"
strip_or_empty "$SEGMENTED_FILE" "$TMPD/segmented.code"
strip_or_empty "$ROW_FILE"       "$TMPD/row.code"
strip_or_empty "$SHAPES"         "$TMPD/shapes.code"

# -----------------------------------------------------------------------------
printf '\n[1] The hero card is DELETED, not merely unmounted (V1)\n'
# A file with no call site is dead code that still has to be reasoned about, and
# 826 lines of it is the largest single thing on this surface. It also holds the
# only remaining call sites for the HERO_* block [8] retires.
if [ -f "$HERO" ]; then
    printf '       still present: %s (%s lines)\n' \
        "components/cellular/settings/modem-hero-card.tsx" "$(wc -l < "$HERO" | tr -d ' ')"
    bad "modem-hero-card.tsx still exists"
else
    ok "modem-hero-card.tsx is gone"
fi

# -----------------------------------------------------------------------------
printf '\n[2] LiveStateStrip exists and borrows the family geometry (V1)\n'
# `components/cellular/tile-shape.ts` is where the 104px pin and the 52px disc
# actually live, precisely so a strip and its skeleton can never drift apart
# (the Skeleton-Mirror Rule). Four surfaces already read from it.
if [ -f "$STRIP_FILE" ]; then
    ok "components/cellular/settings/live-state-strip.tsx exists"
else
    bad "components/cellular/settings/live-state-strip.tsx does not exist"
fi
if grep -qE 'export (function|const) LiveStateStrip' "$TMPD/strip.code"; then
    ok "it exports LiveStateStrip"
else
    bad "no exported LiveStateStrip symbol"
fi
if grep -q '@/components/cellular/tile-shape' "$TMPD/strip.code"; then
    ok "it imports from @/components/cellular/tile-shape"
else
    bad "live-state-strip.tsx does not import the shared tile-shape module"
fi
if grep -q 'TILE_SHAPE' "$TMPD/strip.code"; then
    ok "TILE_SHAPE is referenced"
else
    bad "TILE_SHAPE is never referenced -- the geometry was restated, not borrowed"
fi

# -----------------------------------------------------------------------------
printf '\n[3] The geometry is USED, not re-declared (Skeleton-Mirror Rule)\n'
for member in 'TILE_SHAPE.ROOT' 'TILE_SHAPE.DISC'; do
    if grep -q "$member" "$TMPD/strip.code"; then
        ok "$member is applied"
    else
        bad "$member is not applied -- the tile does not wear the family box"
    fi
done
# TILE_SHAPE.ROOT is `h-[6.5rem]`; TILE_SHAPE.DISC is `size-[3.25rem]`. Restating
# either is exactly the drift the extraction was made to prevent.
for literal in 'h-\[6\.5rem\]' 'size-\[3\.25rem\]'; do
    if grep -q "$literal" "$TMPD/strip.code"; then
        grep -n "$literal" "$TMPD/strip.code" | show
        bad "live-state-strip.tsx restates a TILE_SHAPE number ($literal)"
    else
        ok "no restated $literal literal"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[4] Identity fill lives on the DISC only -- never on a tile body (V1/V3)\n'
# summary-tiles.tsx Gen 5: "Every tile body is now NEUTRAL_TILE and the disc is
# the only coloured element on the strip." An unidentified radio
# (`network.type === ""`) takes the neutral disc -- it must never claim the 5G
# blue.
IDENTITY_FILL='bg-primary([^-]|$)|bg-lte|bg-nr([^-]|$)|bg-spatial'

# 4.1 -- no line carries a tile body AND an identity fill.
if grep -nE "TILE_SHAPE\.ROOT" "$TMPD/strip.code" | grep -qE "$IDENTITY_FILL"; then
    grep -nE "TILE_SHAPE\.ROOT" "$TMPD/strip.code" | grep -E "$IDENTITY_FILL" | show
    bad "a tile body composes TILE_SHAPE.ROOT with an identity fill -- that is the retired slab"
else
    ok "no tile body composes an identity fill"
fi

# 4.2 -- every identity fill that DOES appear sits on a disc-tone declaration.
# Zero occurrences also passes: the plan's build order puts the disc tones in
# shapes.ts as part of STRIP, and 4.3 checks that block separately.
stray=$(grep -nE "$IDENTITY_FILL" "$TMPD/strip.code" | grep -viE 'disc' || true)
if [ -n "$stray" ]; then
    printf '%s\n' "$stray" | show
    bad "an identity fill in live-state-strip.tsx is not on a disc-tone declaration"
else
    ok "every identity fill in live-state-strip.tsx is on a disc-tone declaration"
fi

# 4.3 -- the same rule inside shapes.ts's STRIP block, wherever the tones landed.
if grep -q '^export const STRIP' "$TMPD/shapes.code"; then
    ok "shapes.ts exports STRIP (the strip's shape module)"
    awk '/^export const STRIP/,/^} as const;/' "$TMPD/shapes.code" > "$TMPD/strip-block.code"
    stray=$(grep -nE "$IDENTITY_FILL" "$TMPD/strip-block.code" | grep -viE 'disc' || true)
    if [ -n "$stray" ]; then
        printf '%s\n' "$stray" | show
        bad "an identity fill inside STRIP is not on a disc-tone key"
    else
        ok "every identity fill inside STRIP is on a disc-tone key"
    fi
else
    bad "shapes.ts does not export STRIP -- the strip's geometry has no home"
fi

# 4.4 -- the tile body is the neutral container, positively asserted.
if grep -qE 'bg-surface-container([^-]|$)' "$TMPD/strip.code" \
   || grep -qE 'bg-surface-container([^-]|$)' "$TMPD/shapes.code"; then
    ok "a neutral bg-surface-container tile body is declared"
else
    bad "no bg-surface-container tile body anywhere -- the tiles have no neutral fill"
fi

# -----------------------------------------------------------------------------
printf '\n[5] The strip skeleton mirrors the pin by IMPORT, not by number\n'
# TILE_SHAPE.HEIGHT exists for exactly this. A restated number is how a 26px jump
# at the skeleton handoff shipped last time.
if grep -q 'TILE_SHAPE.HEIGHT' "$TMPD/strip.code"; then
    ok "the skeleton uses TILE_SHAPE.HEIGHT"
else
    bad "TILE_SHAPE.HEIGHT is never used -- the skeleton cannot mirror the pin"
fi

# -----------------------------------------------------------------------------
printf '\n[6] RateCeilingDisclosure exists (V2)\n'
# AMBR stops being the headline and becomes a governing summary line with the
# per-bearer table for both radios behind a disclosure. It keeps its OWN clock
# and its own provenance line, so no card holds two clocks any more.
if [ -f "$RATE_FILE" ]; then
    ok "components/cellular/settings/rate-ceiling-disclosure.tsx exists"
else
    bad "components/cellular/settings/rate-ceiling-disclosure.tsx does not exist"
fi
if grep -qE 'export (function|const) RateCeilingDisclosure' "$TMPD/rate.code"; then
    ok "it exports RateCeilingDisclosure"
else
    bad "no exported RateCeilingDisclosure symbol"
fi
if grep -q '^export const RATE_CEILING' "$TMPD/shapes.code"; then
    ok "shapes.ts exports RATE_CEILING"
else
    bad "shapes.ts does not export RATE_CEILING -- the disclosure has no shape module"
fi

# -----------------------------------------------------------------------------
printf '\n[7] The disclosure guards its own reduced-motion case\n'
# It animates `grid-template-rows`, which is neither transform nor opacity, so
# the global MotionConfig switch does NOT cover it. Same mechanism and same
# reason as 4b4d688 (the frequency-locking skeleton).
if grep -q 'useReducedMotion' "$TMPD/rate.code"; then
    ok "rate-ceiling-disclosure.tsx calls useReducedMotion()"
else
    bad "no useReducedMotion() -- a grid-template-rows animation is not covered by MotionConfig"
fi

# -----------------------------------------------------------------------------
printf '\n[8] The HERO_* block is retired from shapes.ts\n'
# Nine names whose ONLY consumer was the dying hero. (READOUT_ROW is deliberately
# absent from this list -- see the departure note in the header.)
for sym in HERO_SHELL HERO_PAD HERO_RAIL HERO_RAIL_TONE HERO_BODY \
           HERO_BODY_CELL HERO_BODY_PARAMS_CELL HERO_FOOTNOTE HERO_PARAMS; do
    if grep -qE "^export const $sym\b" "$SHAPES"; then
        bad "shapes.ts still exports $sym"
    else
        ok "$sym is retired"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[9] The three consumerless exports are retired\n'
# Verified consumerless before being asserted: the only hits outside shapes.ts
# are prose inside comments (fplmn-settings.tsx:20, imei-settings-card.tsx:71).
# Each sibling shapes.ts carries its own PAGE_TITLE / PAGE_DESCRIPTION.
for sym in PAGE_TITLE PAGE_DESCRIPTION; do
    if grep -qE "^export const $sym\b" "$SHAPES"; then
        bad "shapes.ts still exports the consumerless $sym"
    else
        ok "$sym is retired"
    fi
done
# FIELD_INPUT may SURVIVE as a module-private const -- FIELD_SHELL and
# FIELD_SHELL_ON_FILL compose it, and those two are the real exported API.
if grep -qE "^export const FIELD_INPUT\b" "$SHAPES"; then
    bad "shapes.ts still EXPORTS FIELD_INPUT -- it has no importer; make it module-private"
else
    ok "FIELD_INPUT is no longer exported"
fi
if grep -qE "^export const FIELD_INPUT\b" "$SHAPES"; then
    : # already reported above; do not double-count one defect
elif grep -qE "^const FIELD_INPUT\b" "$SHAPES" || ! grep -q 'FIELD_INPUT' "$SHAPES"; then
    ok "FIELD_INPUT is module-private or gone (both are acceptable)"
else
    grep -n 'FIELD_INPUT' "$SHAPES" | show
    bad "FIELD_INPUT is referenced but neither exported nor declared module-private"
fi
# The two composites it feeds must survive -- imei-settings-card.tsx imports one.
for sym in FIELD_SHELL FIELD_SHELL_ON_FILL; do
    if grep -qE "^export const $sym\b" "$SHAPES"; then
        ok "$sym is KEPT (it is the exported API, and has live importers)"
    else
        bad "$sym was deleted -- that is a live import site, a regression"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[10] The route shell mounts the two new bands and nothing of the hero\n'
for sym in LiveStateStrip RateCeilingDisclosure; do
    if grep -q "<$sym" "$TMPD/shell.code"; then
        ok "cellular-settings.tsx renders <$sym"
    else
        bad "cellular-settings.tsx does not render <$sym"
    fi
done
if grep -q 'ModemHeroCard' "$TMPD/shell.code"; then
    grep -n 'ModemHeroCard' "$TMPD/shell.code" | show
    bad "cellular-settings.tsx still references ModemHeroCard"
else
    ok "no ModemHeroCard reference survives in the shell"
fi
# The cascade is kept -- the plan changes the band ORDER, not the motion.
for sym in staggerContainer staggerItem; do
    if grep -q "$sym" "$TMPD/shell.code"; then
        ok "$sym is KEPT (the card cascade is not part of this change)"
    else
        bad "$sym was dropped -- the cascade is out of scope and must survive"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[11] The first-paint rAF guard is DELETED (§6.C -- dead weight)\n'
# Rendered with `settled` true from first render, the thumb carries only
# `style="opacity: 1;"` at mount -- no transform, no slide-in. A layoutId node
# with no predecessor in its stack has no snapshot to animate from. The
# first-paint fling the comment describes was caused by the MODULE-CONSTANT
# layoutId; `useId` already fixed it and the guard has been redundant since.
# It is a live violation of DESIGN.md > The Non-Load-Bearing Rule.
for token in 'requestAnimationFrame' 'cancelAnimationFrame' 'settled'; do
    if grep -q "$token" "$TMPD/segmented.code"; then
        grep -n "$token" "$TMPD/segmented.code" | show
        bad "segmented-field.tsx still carries '$token'"
    else
        ok "no '$token' survives"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[12] The thumb transition is unconditional (§6.C)\n'
# The correct replacement for the guard is to DELETE it and pass the token
# unconditionally -- not to substitute a prop for it.
if grep -q 'transition={transitionStandard}' "$TMPD/segmented.code"; then
    ok "transition={transitionStandard} is passed unconditionally"
else
    bad "the thumb does not carry an unconditional transition={transitionStandard}"
fi
if grep -nE 'transition=\{[^}]*\?' "$TMPD/segmented.code" | grep -q .; then
    grep -nE 'transition=\{[^}]*\?' "$TMPD/segmented.code" | show
    bad "the thumb's transition is still a ternary"
else
    ok "no ternary on the transition prop"
fi
# `initial={false}` is a RED HERRING: it governs enter animations of animated
# VALUES, not layout projection. Adding it would be cargo -- a prop substituted
# for a mechanism, which is what §6.C says not to do.
if grep -q 'initial={false}' "$TMPD/segmented.code"; then
    grep -n 'initial={false}' "$TMPD/segmented.code" | show
    bad "initial={false} was added -- it does not govern layout projection (§6.C)"
else
    ok "no initial={false} cargo"
fi

# -----------------------------------------------------------------------------
printf '\n[13] The check glyph is RESERVED on every segment (§6.A -- the primary cause)\n'
# The glyph plus gap-1.5 is worth 21.7px and renders only on the active segment.
# The thumb is `absolute inset-0`, so its box IS the segment's box: changing the
# segment width changes BOTH ends of the animation Framer is computing. Measured
# first frame: translate3d(-266.99px, 0, 0) scale(1.13606, 1) -- on rounded-pill
# a 1.14 scaleX makes the caps visibly elliptical in flight, and the label you
# clicked slides 21.8px out from under your cursor, un-animated.
if grep -q 'GLYPH_RESERVED' "$TMPD/shapes.code"; then
    ok "shapes.ts declares SEGMENTED.GLYPH_RESERVED"
else
    bad "no GLYPH_RESERVED in shapes.ts -- there is no class to hide the reserved glyph with"
fi
if grep -q 'GLYPH_RESERVED' "$TMPD/segmented.code"; then
    ok "segmented-field.tsx applies GLYPH_RESERVED"
else
    bad "segmented-field.tsx never applies GLYPH_RESERVED"
fi
# The conditional-render pattern must be gone. Checked on the newline-joined
# stripped source so a reformat across lines cannot hide it.
tr '\n' ' ' < "$TMPD/segmented.code" > "$TMPD/segmented.flat"
if grep -qE 'isActive[[:space:]]*\?[[:space:]]*\(?[[:space:]]*<MaterialSymbol' "$TMPD/segmented.flat"; then
    bad "the check glyph is still rendered conditionally (isActive ? <MaterialSymbol)"
else
    ok "no isActive-gated <MaterialSymbol> survives"
fi
if grep -q '<MaterialSymbol' "$TMPD/segmented.code"; then
    ok "a <MaterialSymbol> check is still rendered (not simply deleted)"
else
    bad "the check glyph was DELETED rather than reserved -- that is a DESIGN.md grayscale-survival call, escalated to the user, not a mechanical one"
fi

# -----------------------------------------------------------------------------
printf '\n[14] The delta chip reserves its own line (§6.B -- the vertical half)\n'
# Measured on the real page: at 760px and 1500px body width the dirty promotion
# wraps the chip onto its own line and the row grows exactly 30px. The control is
# @2xl/card:items-center, so it drops half -- 15px. And Framer does NOT animate
# it: at rest thumb y 679.8, first frame y 694.8, transform y component 0px. The
# thumb teleports vertically and then glides horizontally. Reverse the direction
# and the first frame appears 15px BELOW target: a highlight arriving from
# lower-left, which is the reported symptom verbatim.
if grep -q 'SETTING_ROW_DIRTY.DELTA_CHIP' "$TMPD/row.code"; then
    ok "setting-row.tsx still renders the DELTA_CHIP node"
else
    bad "the DELTA_CHIP node is gone -- assertion 14 can no longer be evaluated"
fi
if grep -nE '\{[[:space:]]*dirty[[:space:]]*&&[[:space:]]*delta' "$TMPD/row.code" | grep -q .; then
    grep -nE '\{[[:space:]]*dirty[[:space:]]*&&[[:space:]]*delta' "$TMPD/row.code" | show
    bad "the chip element is still gated on {dirty && delta -- its line is not reserved"
else
    ok "no {dirty && delta gate around the chip element"
fi
if grep -q 'invisible' "$TMPD/row.code"; then
    ok "the chip is hidden with 'invisible' (reserved, not removed)"
else
    bad "no 'invisible' in setting-row.tsx -- the chip is not occupying reserved space when clean"
fi

# -----------------------------------------------------------------------------
printf '\n[14b] The min-h comment no longer claims a reservation it does not make\n'
# Raw source on purpose: this is an assertion ABOUT comment text. The floor is
# 76px and the CLEAN row already measures 98.1px at the affected widths, so the
# floor is inert -- it reserves nothing. Leaving the claim in place is how the
# next reader concludes §6.B was already handled.
# Flattened, because the claim is wrapped across two comment lines in the
# incumbent ("...that already accounts\n// for the chip's line"). A line-oriented
# grep passes vacuously on it -- which it did, on the first run of this harness.
stale=""
for f in "$ROW_FILE" "$SHAPES"; do
    [ -f "$f" ] || continue
    if tr '\n' ' ' < "$f" | grep -qE 'accounts[[:space:]]*(//)?[[:space:]]*for the chip'; then
        stale="$stale $(basename "$f")"
    fi
done
if [ -n "$stale" ]; then
    printf '       claim still present in:%s\n' "$stale"
    bad "the 'min-h floor already accounts for the chip's line' claim survives -- it is false"
else
    ok "the false min-h reservation claim is corrected"
fi

# -----------------------------------------------------------------------------
printf '\n[15] The "THREE segmented controls" comment is corrected to six\n'
# Raw source on purpose. The page now holds six rows across two cards, not three
# in one. A comment that miscounts the very hazard it warns about ("sharing an id
# makes their thumbs fly across each other") is worse than none.
# Flattened for the same reason as [14b]: shapes.ts wraps the claim as
# "renders THREE\n *      segmented controls at once", so a line-oriented grep
# sees neither half.
for f in "$SEGMENTED_FILE" "$SHAPES"; do
    name=$(basename "$f")
    flat=$(tr '\n' ' ' < "$f")
    if printf '%s' "$flat" | grep -qiE 'three[[:space:]*/]*(of these|segmented)'; then
        grep -niE 'three' "$f" | grep -iE 'of these|segmented|renders' | show
        bad "$name still says THREE segmented controls"
    else
        ok "$name no longer says THREE"
    fi
    if printf '%s' "$flat" | grep -qiE 'six[[:space:]*/]*(of these|segmented)'; then
        ok "$name says SIX"
    else
        bad "$name does not say SIX -- the count was deleted rather than corrected"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[16] The One-Scale, Tone and Shape rules hold across every touched file\n'
# The surface arrived clean on all of these. This assertion is a ratchet, not a
# repair: it exists so the re-authoring cannot introduce what the incumbent
# avoided.
for pair in "strip.code:live-state-strip.tsx" \
            "rate.code:rate-ceiling-disclosure.tsx" \
            "shell.code:cellular-settings.tsx" \
            "segmented.code:segmented-field.tsx" \
            "row.code:setting-row.tsx" \
            "shapes.code:shapes.ts"; do
    code="$TMPD/${pair%%:*}"
    name="${pair##*:}"
    # A file that does not exist yet strips to empty and trivially passes here;
    # [2] and [6] are what fail in that case.
    hits=$(grep -nE 'duration-\[[0-9]|transition-all|ease-\[cubic-bezier|rounded-(md|lg)([^a-z-]|$)|(text|bg|border|ring)-(red|green|blue|yellow|orange|amber|purple|violet|pink|gray|grey|slate|zinc|neutral|stone|emerald|teal|cyan|sky|indigo|rose|lime|fuchsia)-[0-9]' \
        "$code" || true)
    if [ -n "$hits" ]; then
        printf '%s\n' "$hits" | show
        bad "$name violates a One-Scale / Tone / Shape rule"
    else
        ok "$name is clean of literal durations, transition-all, raw colours and off-scale radii"
    fi
done
# The JS half of the One-Scale Rule: a literal { duration: 0.25 } will not retune
# when lib/motion.ts and the --duration-* properties are retuned together.
for pair in "strip.code:live-state-strip.tsx" "rate.code:rate-ceiling-disclosure.tsx"; do
    code="$TMPD/${pair%%:*}"
    name="${pair##*:}"
    hits=$(grep -nE '\{ duration: [0-9]' "$code" | grep -viE 'reduce' || true)
    if [ -n "$hits" ]; then
        printf '%s\n' "$hits" | show
        bad "$name carries a literal JS duration outside a reducedMotion guard"
    else
        ok "$name carries no literal JS duration outside a reducedMotion guard"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[17] Every new i18n key resolves in ALL FIVE locales\n'
# The 100%%-parity gate, checked at the CALL SITE rather than by diffing packs:
# a key added to en/ but never rendered, or rendered but missing from id/, both
# fail here. Dynamic keys (a second ${...} inside the literal) are skipped --
# they cannot be resolved statically and are not what this change adds.
KEY_SRC="$TMPD/keys.txt"
: > "$KEY_SRC"
for code in "$TMPD/strip.code" "$TMPD/rate.code"; do
    grep -oE '\$\{K\}\.[A-Za-z0-9_.]+' "$code" 2>/dev/null \
        | sed 's/^\${K}\.//' >> "$KEY_SRC" || true
done
sort -u "$KEY_SRC" -o "$KEY_SRC"

if [ ! -s "$KEY_SRC" ]; then
    bad "no \${K}.* i18n keys found in the two new components -- either they are unbuilt, or they hardcode their strings"
else
    ok "$(wc -l < "$KEY_SRC" | tr -d ' ') distinct i18n keys referenced by the new components"
    for loc in en zh-CN zh-TW it id; do
        pack="$LOCALES/$loc/cellular.json"
        if [ ! -f "$pack" ]; then bad "locale pack missing: $pack"; continue; fi
        missing=$(node -e '
            const fs = require("fs");
            const pack = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
            const base = pack?.core_settings?.basic ?? {};
            const keys = fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter(Boolean);
            const miss = keys.filter((k) => {
                let node = base;
                for (const part of k.split(".")) {
                    if (node === null || typeof node !== "object" || !(part in node)) return true;
                    node = node[part];
                }
                return typeof node !== "string" || node.trim() === "";
            });
            process.stdout.write(miss.join(" "));
        ' "$pack" "$KEY_SRC")
        if [ -n "$missing" ]; then
            printf '         %s\n' "$missing" | fold -s -w 100 | sed 's/^/       /'
            bad "$loc/cellular.json is missing core_settings.basic keys"
        else
            ok "$loc/cellular.json resolves every referenced key"
        fi
    done
fi
# The retired leaves go with the card. Keeping them is how a pack accumulates
# strings nothing renders -- the same debt login.recovery.* was found in.
for loc in en zh-CN zh-TW it id; do
    pack="$LOCALES/$loc/cellular.json"
    [ -f "$pack" ] || continue
    dead=$(node -e '
        const pack = require(process.argv[1]);
        const base = pack?.core_settings?.basic ?? {};
        process.stdout.write(["hero"].filter((k) => k in base).join(" "));
    ' "$pack")
    if [ -n "$dead" ]; then
        bad "$loc/cellular.json still carries the retired core_settings.basic.$dead group"
    else
        ok "$loc/cellular.json no longer carries the retired 'hero' group"
    fi
done

printf '\n---------------------------------------------\n'
printf 'settings-hero-design-language: %d passed, %d failed\n\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ]
