#!/usr/bin/env bash
# Regression harness for the Overview splash's design-language adoption.
#
# WHY THIS EXISTS
# ----------------
# The pre-auth splash at "/" is the last surface still built on the Material-3
# TONAL language that PRODUCT.md replaced on 2026-08-16 with "colour on data-ink
# over neutral surfaces". Every other feature center already took the adoption
# pass (`cellular/radio/summary-tiles.tsx`, the SMS strip 084d7c1, the Cell
# Scanner triad e32258c): NEUTRAL TILE BODY, colour surviving only on a
# role-filled disc.
#
# The assertions below are text-anchored to the names in the APPROVED plan
# (docs/reference/_handoff-overview-execute.md), not to names invented while
# writing the fix. That is what keeps them independent of the fix: a builder who
# renames a symbol, substitutes a weaker mechanism, or quietly keeps a tinted
# body fails the test, which is the point.
#
# This harness is COMMITTED RED, before the fix exists (change-workflow.md,
# Phase 4a). The builder who writes the fix does not edit this file.
#
# TWO SCOPINGS, stated openly so they are not mistaken for a weakened test
# -------------------------------------------------------------------------
#  [2] "no *-container in tone.ts" is checked against the FOUR FUNCTIONAL ROLE
#      containers (primary/success/warning/destructive), not against the string
#      "container" as a whole. `bg-surface-container-high` is a NEUTRAL SURFACE
#      step, not a role container, and it is the sanctioned neutral disc fill --
#      `components/cellular/sms/shapes.ts:220` (TILE_DISC_NEUTRAL) ships exactly
#      that. Banning it would forbid the very pattern this change adopts.
#  [2][11] Both are checked against COMMENT-STRIPPED source. A prose "Carrier /
#      Network / Bandwidth" in a header block is not a rendered glue character,
#      and a comment quoting `success-container` while explaining why it was
#      removed is documentation, not a class.
#
# Run: bash scripts/test/overview-splash-design-language.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TONE="$REPO_ROOT/components/public/overview/tone.ts"
TILES="$REPO_ROOT/components/public/overview/tiles.tsx"
ROWS="$REPO_ROOT/components/public/overview/band-rows.tsx"
STATES="$REPO_ROOT/components/public/overview/states.tsx"
CARD="$REPO_ROOT/components/public/overview-card.tsx"
TYPE="$REPO_ROOT/components/pre-auth-type.ts"
LOGIN="$REPO_ROOT/components/auth/login-component.tsx"
FORMAT="$REPO_ROOT/lib/public-overview/format.ts"
PREFS="$REPO_ROOT/hooks/use-public-unit-preferences.ts"

pass_count=0
fail_count=0

ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

for f in "$TONE" "$TILES" "$ROWS" "$STATES" "$CARD" "$LOGIN" "$FORMAT" "$PREFS"; do
    [ -f "$f" ] || { echo "expected source file not found: $f" >&2; exit 1; }
done

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

# Strip //-to-EOL, /* */ and {/* */} comments so a prose mention of a retired
# class or a separator character cannot fail an assertion about rendered code.
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

strip_comments "$TONE" > "$TMPD/tone.code"
strip_comments "$CARD" > "$TMPD/card.code"

printf '\n[1] The Overall tile is DELETED, not restyled\n'
# The Carriers rows already answer "how is the signal", on the ramp, per
# carrier. The tile restated that in one word, cost a full row on a card that
# must hold five carriers, and shipped `signal_cellular_alt` on BOTH `excellent`
# and `good` -- two states in one slot sharing a glyph, which is the one thing
# the status vocabulary forbids.
if grep -q 'OVERALL_TILE' "$TONE"; then
    bad "OVERALL_TILE still declared in tone.ts -- the tile was to be retired by deletion"
else
    ok "OVERALL_TILE is gone from tone.ts"
fi
if grep -q 'OVERALL_TILE\|worstSignalQuality' "$CARD"; then
    bad "overview-card.tsx still references OVERALL_TILE / worstSignalQuality -- the deleted tile's consumer survives"
else
    ok "overview-card.tsx no longer consumes the Overall tile"
fi

printf '\n[2] The tile body is NEUTRAL: no role-container fills left in the tone map\n'
if grep -q 'TILE_CLASSES' "$TONE"; then
    bad "TILE_CLASSES still declared in tone.ts -- the tinted-body map must go with the tinted body"
else
    ok "TILE_CLASSES is gone from tone.ts"
fi
if grep -qE '(primary|success|warning|destructive)-container' "$TMPD/tone.code"; then
    printf '       offending lines:\n'
    grep -nE '(primary|success|warning|destructive)-container' "$TMPD/tone.code" | sed 's/^/         /'
    bad "tone.ts still names a functional ROLE container -- the disc takes the STRONG fill (Glyph-Disc Rule)"
else
    ok "tone.ts names no functional role container"
fi
# The disc map is the positive half of the same assertion: deleting the tinted
# bodies without adding the discs would pass [2] while shipping a colourless card.
if grep -qE 'bg-success[^-]' "$TMPD/tone.code" \
    && grep -qE 'bg-warning[^-]' "$TMPD/tone.code" \
    && grep -qE 'bg-destructive[^-]' "$TMPD/tone.code"; then
    ok "tone.ts carries strong-fill disc classes for the three coloured roles"
else
    bad "tone.ts has no strong-fill disc map -- a neutral body with no disc is a colourless card, not an adoption"
fi

printf '\n[3] The eyebrow reads a real ink token, not an alpha\n'
# `opacity-80` only ever existed because a neutral-ramp ink on a TINTED surface
# is a cross-pair and no --on-success-container-variant token exists. A neutral
# body makes `text-on-surface-variant` legal, so the alpha disappears on its own
# -- the same causation the Cell Scanner pass recorded.
if grep -q 'opacity-8' "$TILES"; then
    bad "tiles.tsx still uses an opacity-8x wash where an on-surface-variant ink now belongs"
else
    ok "tiles.tsx carries no opacity-8x wash"
fi

printf '\n[4] TEMPERATURE_TILE separates all four bands, by tone AND by glyph\n'
# Today `unknown` and `normal` are BOTH `{ tone: "neutral" }` with NO icon at
# all, so a healthy 47 C and a modem reporting nothing render identically.
# `unknown` must stay NEUTRAL: a null temperature is NO READING, and painting it
# green is the same class of defect as the antenna that rendered green with
# nothing measured.
TEMP_BLOCK=$(awk '/export const TEMPERATURE_TILE/,/^};/' "$TONE")
if [ -z "$TEMP_BLOCK" ]; then
    bad "TEMPERATURE_TILE block not found in tone.ts"
    bad "TEMPERATURE_TILE glyph count (block absent)"
    bad "TEMPERATURE_TILE.unknown neutrality (block absent)"
    bad "TEMPERATURE_TILE.normal good-news tone (block absent)"
else
    tones=$(printf '%s\n' "$TEMP_BLOCK" | grep -oE 'tone: "[a-z]+"' | sort -u | wc -l | tr -d ' ')
    icons=$(printf '%s\n' "$TEMP_BLOCK" | grep -oE 'icon: "[a-z_0-9]+"' | sort -u | wc -l | tr -d ' ')
    if [ "$tones" -eq 4 ]; then
        ok "TEMPERATURE_TILE has 4 distinct tones"
    else
        bad "TEMPERATURE_TILE has $tones distinct tones, expected 4 (unknown/normal/warn/danger must not collide)"
    fi
    if [ "$icons" -eq 4 ]; then
        ok "TEMPERATURE_TILE has 4 distinct glyphs"
    else
        bad "TEMPERATURE_TILE has $icons distinct glyphs, expected 4 -- the glyph is the only channel that survives CVD"
    fi
    if printf '%s\n' "$TEMP_BLOCK" | grep -qE 'unknown: \{ tone: "neutral"'; then
        ok "TEMPERATURE_TILE.unknown stays neutral"
    else
        bad "TEMPERATURE_TILE.unknown is not neutral -- no reading must never be painted as a healthy reading"
    fi
    if printf '%s\n' "$TEMP_BLOCK" | grep -qE 'normal: \{ tone: "success"'; then
        ok "TEMPERATURE_TILE.normal reports the good news (success)"
    else
        bad "TEMPERATURE_TILE.normal is not success -- temperature must speak when it is healthy, not only when it is wrong"
    fi
fi

printf '\n[5] Every 3-up grid is container-queried\n'
# An unqueried grid-cols-3 puts three tiles side by side at 288px, which is
# where the Italian carrier name loses its first word.
grid3_bad=0
grep -n 'grid-cols-3' "$CARD" > "$TMPD/grid3.txt" || true
while IFS=: read -r ln _; do
    [ -n "$ln" ] || continue
    start=$((ln - 2)); [ "$start" -lt 1 ] && start=1
    if ! sed -n "${start},$((ln + 2))p" "$CARD" | grep -q '@\['; then
        printf '       unqueried grid-cols-3 at overview-card.tsx:%s\n' "$ln"
        grid3_bad=$((grid3_bad + 1))
    fi
done < "$TMPD/grid3.txt"
if [ "$grid3_bad" -eq 0 ]; then
    ok "no unqueried grid-cols-3 in overview-card.tsx"
else
    bad "$grid3_bad unqueried grid-cols-3 in overview-card.tsx"
fi
# The status grid is 2-up now that Overall is gone, and it keeps its query.
if grep -q '@\[18rem\]/overview:grid-cols-2' "$CARD"; then
    ok "the status grid is 2-up behind its container query"
else
    bad "no '@[18rem]/overview:grid-cols-2' in overview-card.tsx -- Internet + Temperature is a PAIR, not a trio"
fi

printf '\n[6] The eyebrow can shrink\n'
# `min-w-0` without `truncate` clips nothing; `truncate` without `min-w-0`
# cannot shrink inside a flex column. Both, or neither works.
eyebrow_sites=0
eyebrow_bad=0
grep -n 'cn(EYEBROW_CLASS' "$TILES" > "$TMPD/eyebrow.txt" || true
while IFS=: read -r ln _; do
    [ -n "$ln" ] || continue
    eyebrow_sites=$((eyebrow_sites + 1))
    window=$(sed -n "${ln},$((ln + 4))p" "$TILES")
    printf '%s\n' "$window" | grep -q 'min-w-0'  || eyebrow_bad=$((eyebrow_bad + 1))
    printf '%s\n' "$window" | grep -q 'truncate' || eyebrow_bad=$((eyebrow_bad + 1))
done < "$TMPD/eyebrow.txt"
if [ "$eyebrow_sites" -eq 0 ]; then
    bad "no cn(EYEBROW_CLASS, ...) call site found in tiles.tsx -- the eyebrow assertion cannot be evaluated"
elif [ "$eyebrow_bad" -eq 0 ]; then
    ok "all $eyebrow_sites eyebrow call sites in tiles.tsx carry both min-w-0 and truncate"
else
    bad "$eyebrow_bad missing min-w-0/truncate across $eyebrow_sites eyebrow call sites in tiles.tsx -- the Italian layout shift"
fi

printf '\n[7] The skeleton mirrors the shape by IMPORT, not by restated numbers\n'
# The Skeleton-Mirror Rule: a skeleton mirrors the loaded geometry by importing
# the same shape constant, never by restating a number that can drift.
if grep -qE 'h-16|h-\[4\.125rem\]' "$STATES"; then
    printf '       offending lines:\n'
    grep -nE 'h-16|h-\[4\.125rem\]' "$STATES" | sed 's/^/         /'
    bad "states.tsx restates a tile height literal instead of importing it"
else
    ok "states.tsx restates no tile height literal"
fi
if grep -q 'TILE_HEIGHT' "$TONE" && grep -q 'TILE_HEIGHT' "$STATES"; then
    ok "TILE_HEIGHT is exported by tone.ts and imported by states.tsx"
else
    bad "TILE_HEIGHT is not exported by tone.ts and/or not imported by states.tsx"
fi
# The Overall row must not survive in the skeleton either, or the handoff shifts.
states_grid3=$(grep -c 'grid-cols-3' "$STATES" || true)
if [ "$states_grid3" -eq 1 ]; then
    ok "states.tsx has exactly one 3-up -- the info trio, and no status trio"
else
    bad "states.tsx has $states_grid3 grid-cols-3 grids, expected exactly 1 (the info trio)"
fi

printf '\n[8] One shadow scale\n'
# `shadow-sm` is Tailwind's own value, not one of the product's shadow tokens,
# so it silently will not retune with the rest of the system.
if grep -q 'shadow-sm' "$CARD"; then
    bad "overview-card.tsx still uses shadow-sm -- a raw Tailwind shadow outside the product scale"
else
    ok "overview-card.tsx uses no raw shadow-sm"
fi
if grep -q 'shadow-whisper' "$CARD"; then
    ok "overview-card.tsx reads --shadow-whisper"
else
    bad "overview-card.tsx does not read --shadow-whisper"
fi

printf '\n[9] Exactly two stagger steps\n'
# STAGGER_SECONDS = 0.04 was a THIRD entrance stagger step. The canon permits
# two: 120ms for cards (STAGGER_STEP) and 80ms for rows (STAGGER_STEP_ROWS).
if grep -q 'STAGGER_SECONDS' "$ROWS"; then
    bad "band-rows.tsx still declares STAGGER_SECONDS -- a third stagger step"
else
    ok "STAGGER_SECONDS is gone from band-rows.tsx"
fi
if grep -q '0\.04' "$ROWS"; then
    printf '       offending lines:\n'
    grep -n '0\.04' "$ROWS" | sed 's/^/         /'
    bad "band-rows.tsx still carries a 0.04 literal"
else
    ok "band-rows.tsx carries no 0.04 literal"
fi
if grep -q 'rowCascadeDelay' "$ROWS"; then
    ok "the meter fill is staggered through rowCascadeDelay()"
else
    bad "band-rows.tsx does not use rowCascadeDelay() -- the row cascade must derive from STAGGER_STEP_ROWS"
fi
# The bare em dash and the raw "dBm"/"dB" in AggregateBandRow: BandRow eleven
# lines up already routes both through t(), so this is a divergence inside one
# file, not a missing convention.
AGG_BLOCK=$(awk '/export function AggregateBandRow/,0' "$ROWS")
if printf '%s\n' "$AGG_BLOCK" | grep -qF '"'"$(printf '\xe2\x80\x94')"'"'; then
    bad "AggregateBandRow still renders a bare, un-keyed em dash -- BandRow uses t(\"overview.field.empty\")"
else
    ok "AggregateBandRow's empty state goes through t()"
fi
if printf '%s\n' "$AGG_BLOCK" | grep -q 'unit'; then
    bad "AggregateBandRow still takes a pre-rendered \`unit\` string -- the unit belongs inside the t() key, as in BandRow"
else
    ok "AggregateBandRow no longer takes a pre-rendered unit string"
fi
if grep -q '"dBm"' "$CARD"; then
    bad "overview-card.tsx still hands down a raw \"dBm\"/\"dB\" literal -- an untranslated unit"
else
    ok "overview-card.tsx hands down no raw unit literal"
fi

printf '\n[10] One pre-auth type scale, shared by both cards\n'
# The splash h1 ships 19px; the login h1 ships 24px. Two pre-auth cards, one
# scale, and the scale should be a module rather than a convention.
if [ -f "$TYPE" ]; then
    ok "components/pre-auth-type.ts exists"
    missing=""
    for c in CARD_TITLE SECTION_TITLE EMPHASIS BODY EYEBROW; do
        grep -q "export const $c" "$TYPE" || missing="$missing $c"
    done
    if [ -z "$missing" ]; then
        ok "pre-auth-type.ts exports all five type steps"
    else
        bad "pre-auth-type.ts is missing type steps:$missing"
    fi
    # Type only -- no geometry. The two cards differ in width, padding and gap,
    # so a shared shapes module would be mostly non-shared.
    if grep -qE '(px|py|pt|pb|gap|max-w|rounded)-' "$TYPE"; then
        bad "pre-auth-type.ts carries geometry -- it is a TYPE module only"
    else
        ok "pre-auth-type.ts carries type only, no geometry"
    fi
else
    bad "components/pre-auth-type.ts does not exist"
    bad "pre-auth-type.ts exports all five type steps (file absent)"
    bad "pre-auth-type.ts carries type only (file absent)"
fi
if grep -q 'pre-auth-type' "$CARD"; then
    ok "overview-card.tsx imports the shared pre-auth type scale"
else
    bad "overview-card.tsx does not import pre-auth-type"
fi
if grep -q 'pre-auth-type' "$LOGIN"; then
    ok "login-component.tsx imports the shared pre-auth type scale"
else
    bad "login-component.tsx does not import pre-auth-type"
fi
if grep -q 'text-2xl' "$LOGIN"; then
    bad "login-component.tsx still ships a text-2xl headline -- the pre-auth card title is the 19px step"
else
    ok "login-component.tsx no longer ships a text-2xl headline"
fi

printf '\n[11] The No-Dot-Separator Rule\n'
# A meta line joining two short facts uses plain spacing, never a middot.
if grep -q "$(printf '\xc2\xb7')" "$TMPD/card.code"; then
    printf '       offending lines:\n'
    grep -n "$(printf '\xc2\xb7')" "$TMPD/card.code" | sed 's/^/         /'
    bad "overview-card.tsx renders a middot glue character"
else
    ok "overview-card.tsx renders no middot glue character"
fi

printf '\n[12] Dead code goes; live code stays\n'
# formatCarrierComponents/CarrierComponentRow have no consumer. formatUptime
# DOES: cellular/radio/cellular-information-card.tsx and dashboard/device-status.tsx.
if grep -q 'formatCarrierComponents' "$FORMAT"; then
    bad "formatCarrierComponents survives in lib/public-overview/format.ts -- it has no consumer"
else
    ok "formatCarrierComponents is gone"
fi
if grep -q 'CarrierComponentRow' "$FORMAT"; then
    bad "CarrierComponentRow survives in lib/public-overview/format.ts -- it has no consumer"
else
    ok "CarrierComponentRow is gone"
fi
if grep -q 'export function formatUptime' "$FORMAT"; then
    ok "formatUptime is KEPT (live consumers on the authed side)"
else
    bad "formatUptime was deleted -- it has two live consumers and this is a regression, not a cleanup"
fi
if grep -q 'distanceUnit' "$PREFS"; then
    bad "use-public-unit-preferences.ts still fetches distanceUnit -- unusable on a card with no distance reading"
else
    ok "distanceUnit is gone from use-public-unit-preferences.ts"
fi

printf '\n---------------------------------------------\n'
printf 'overview-splash-design-language: %d passed, %d failed\n\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ]
