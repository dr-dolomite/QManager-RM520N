#!/usr/bin/env bash
# Regression harness for the /local-network/ethernet re-authoring.
#
# WHY THIS EXISTS
# ----------------
# The page renders the CGI payload -- one tile each for link, speed, duplex and
# negotiation. That is the shape of `ethernet.sh`'s JSON, not the shape of the
# question. Speed and duplex are properties of ONE negotiated link, and the code
# already knows it (it prints "N/A" into both when the link is down). The tile
# labelled "Negotiation" reports `speed_limit` -- the SAVED setting -- while the
# PHY's real `auto_negotiation` is fetched, typed, stored, and rendered nowhere.
#
# Target: one band that reports the link, one card that governs it. The same
# grammar /cellular/settings landed on 2026-08-30 (a live band with its own clock
# above a writable band with its own), and the composition
# `radio/summary-tiles.tsx` reached through five generations: neutral tile
# bodies, colour on the 52px disc only.
#
# THE TEN FINDINGS, and which assertion pins each
# ------------------------------------------------
#   01 the only animation on the page never runs
#      (`duration-[--duration-standard]` -- Tailwind v4 dropped the bare-var
#      arbitrary, so it compiles to an invalid declaration the browser drops;
#      these are the LAST TWO such sites in the tree)          -> [1] [8]
#   02 three of four tile bodies are large tinted containers    -> [2]
#   03 the speed tile's comment cites a rule DESIGN.md deleted
#      on 2026-08-16 ("Downlink Rose's second meaning")         -> [2]
#   04 live `auto_negotiation` is fetched, typed, rendered nowhere -> [5]
#   05 after one successful load the page can never report a
#      failure again (errors swallowed once hasDataRef is true) -> [6]
#   06 the tile height is a FLOOR mirrored by a fixed skeleton,
#      at the pre-correction 92px number                        -> [3]
#   07 four `opacity-85` ink washes compensating for the tints   -> [2]
#   08 two `rounded-hero` cards and two `shadow-sm`              -> [4]
#   09 the Select's fill is copied from a card it does not live
#      in, and cannot displace `select.tsx`'s own dark: rule     -> [11]
#   10 one caption role, three spellings, because this family
#      has no shapes.ts                                          -> [9] [10]
#
# THE THREE VETO ANSWERS ARE ALL "AS PROPOSED" (recorded 2026-08-31, user)
# -------------------------------------------------------------------------
#   A  the negotiated rate goes NEUTRAL, not coloured           -> [2] [7]
#   B  the PHY ceiling becomes the rate tile's caption          -> [7]
#   C  apply-on-change keeps its in-place confirmation          -> [12]
# Had any been declined the corresponding assertions would not exist. They do,
# so they are load-bearing.
#
# THE ONE OPEN DECISION, answered (recorded 2026-08-31, user)
# ------------------------------------------------------------
# The approved artifact lists a "no controller present" state, which is not
# reachable today: `ethernet.sh` returns success:true with link_status:"down"
# whether the cable is out or `eth0` does not exist. The user chose option (a) --
# one backward-compatible `interface_present` field on the GET, derived from
# `[ -d /sys/class/net/eth0 ]`. That is the ONLY backend touch in the change and
# it re-tiers this to 3.                                        -> [13]
#
# The assertions are text-anchored to the names in the APPROVED plan, never to
# names invented while writing the fix. That is what keeps them independent of
# the fix: a builder who renames a symbol, substitutes a weaker mechanism, or
# quietly keeps a tinted body fails the test, which is the point.
#
# This harness is COMMITTED RED, before the fix exists (change-workflow.md,
# Phase 4a). The builder who writes the fix does not edit this file.
#
# SCOPINGS, stated openly so they are not mistaken for a weakened test
# ---------------------------------------------------------------------
#  [2] [3] [4] [7] [8] [10] [12] are checked against COMMENT-STRIPPED source.
#      shapes.ts carries the reasoning for every value in its JSDoc, and that
#      reasoning necessarily quotes the classes being retired ("this was
#      `downlink-container`", "a bare `duration-[--duration-standard]`").
#      Failing on a comment would push the author to delete the rationale, which
#      is the most valuable half of a shapes module.
#  [2] asserts no ROLE container (`success-container`, `downlink-container`, ...).
#      `surface-container` is the correct neutral body and is deliberately not
#      in the list. `Badge variant="warning"` renders `warning-container` inside
#      badge.tsx, which is where that fill belongs and is not this file's tree.
#  [9] resolves keys under the `ethernet` root of common.json. Every component
#      in this family declares `const K = "ethernet"` so the extraction is
#      uniform; a component that spells its root differently fails here, which
#      is intended.
#
# Run: bash scripts/test/ethernet-design-language.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ETH_DIR="$REPO_ROOT/components/local-network/ethernet"
SHAPES="$ETH_DIR/shapes.ts"
STRIP="$ETH_DIR/link-state-strip.tsx"
CARD="$ETH_DIR/speed-limit-card.tsx"
SHELL_SRC="$ETH_DIR/ethernet-status.tsx"
CGI="$REPO_ROOT/scripts/www/cgi-bin/quecmanager/network/ethernet.sh"
PAGE="$REPO_ROOT/app/local-network/ethernet/page.tsx"
LN_DIR="$REPO_ROOT/components/local-network"
LOCALES="$REPO_ROOT/public/locales"

# The retired flat-path modules. The family moves into its own directory the way
# every sibling under components/local-network/ already has.
OLD_CARD="$LN_DIR/ethernet-card.tsx"
OLD_SHELL="$LN_DIR/ethernet-status.tsx"

pass_count=0
fail_count=0

ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

# Strip //-to-EOL, /* */ and {/* */} comments so a prose mention of a retired
# class cannot fail an assertion about rendered code.
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

# -----------------------------------------------------------------------------
printf '\n[0] The family owns a directory and a shapes module\n'
# Finding 10: there is no shapes.ts for this family, so one caption role is
# spelled three ways (CAPTION, CAPTION_CLASS, plus a literal at the call sites)
# and the tile geometry is restated inline.
present=1
for f in "$SHAPES" "$STRIP" "$CARD" "$SHELL_SRC"; do
    if [ -f "$f" ]; then
        ok "exists: ${f#"$REPO_ROOT/"}"
    else
        bad "missing: ${f#"$REPO_ROOT/"}"
        present=0
    fi
done
for f in "$OLD_CARD" "$OLD_SHELL"; do
    if [ -f "$f" ]; then
        bad "retired module still present: ${f#"$REPO_ROOT/"}"
    else
        ok "retired: ${f#"$REPO_ROOT/"}"
    fi
done

# Everything downstream reads these files. Emit the code copies that exist and
# let the individual assertions report a missing input as a FAIL rather than
# aborting the run -- a harness that exits early cannot show which half is red.
: > "$TMPD/empty.code"
for pair in "shapes:$SHAPES" "strip:$STRIP" "card:$CARD" "shell:$SHELL_SRC"; do
    name="${pair%%:*}"; path="${pair#*:}"
    if [ -f "$path" ]; then strip_comments "$path" > "$TMPD/$name.code"
    else cp "$TMPD/empty.code" "$TMPD/$name.code"; fi
done
cat "$TMPD/shapes.code" "$TMPD/strip.code" "$TMPD/card.code" "$TMPD/shell.code" \
    > "$TMPD/all.code"

# -----------------------------------------------------------------------------
printf '\n[1] The bare-var arbitrary is extinct under components/local-network/\n'
# Finding 1. Tailwind v4 dropped the bare-var arbitrary shorthand, so
# `duration-[--duration-standard]` compiles to the literal
# `transition-duration: --duration-standard` -- an invalid value the browser
# discards. The class IS generated, so grepping for the class name finds it and
# tsc / eslint / next build all pass. Only the emitted VALUE tells.
#
# Scoped to the whole route family, not to the four files: these were the last
# two such sites in the tree, and the point is that they stay gone.
bare=$(grep -rnE 'duration-\[--|ease-\[--' --include='*.tsx' --include='*.ts' "$LN_DIR" 2>/dev/null || true)
if [ -n "$bare" ]; then
    printf '       offending lines:\n'
    printf '%s\n' "$bare" | sed 's/^/         /'
    bad "components/local-network/ carries a bare-var arbitrary -- it compiles to an invalid declaration"
else
    ok "no duration-[-- or ease-[-- anywhere under components/local-network/"
fi

# -----------------------------------------------------------------------------
printf '\n[2] No role-container body fill, and no opacity wash (findings 2, 3, 7)\n'
# The Three-Layer Rule: identity and direction have no container job. The
# Data-Ink Rule: neutral card, coloured reading. `surface-container` is the
# correct neutral body and is deliberately absent from this list.
for role in success warning destructive primary info downlink uplink lte spatial; do
    hits=$(grep -nE "(bg-|text-on-)${role}-container" "$TMPD/all.code" || true)
    if [ -n "$hits" ]; then
        printf '       offending lines:\n'
        printf '%s\n' "$hits" | sed 's/^/         /'
        bad "a ${role}-container fill survives on the ethernet surface"
    else
        ok "no ${role}-container fill"
    fi
done
# Finding 7: four `opacity-85` washes compensating for the tinted bodies. Once
# the body is neutral they resolve to a real on-surface-variant ink. Cell Scanner
# deleted the identical pattern on 2026-08-24.
washes=$(grep -nE 'opacity-8[0-9]' "$TMPD/all.code" || true)
if [ -n "$washes" ]; then
    printf '       offending lines:\n'
    printf '%s\n' "$washes" | sed 's/^/         /'
    bad "an opacity-8* ink wash survives -- don't compensate for a mismatched pair with an alpha"
else
    ok "no opacity-8* ink wash"
fi
# The neutral body is a single constant with no `tone` prop to override it.
if grep -q 'bg-surface-container text-on-surface' "$TMPD/shapes.code"; then
    ok "shapes.ts declares the neutral tile body"
else
    bad "shapes.ts declares no 'bg-surface-container text-on-surface' body"
fi
if grep -qE '\btone\s*[?:]' "$TMPD/strip.code"; then
    printf '       offending lines:\n'
    grep -nE '\btone\s*[?:]' "$TMPD/strip.code" | sed 's/^/         /'
    bad "the tile still accepts a tone prop -- a caller can tint a body back"
else
    ok "the tile has no tone prop (making the wrong thing unreachable)"
fi

# -----------------------------------------------------------------------------
printf '\n[3] The tile height is PINNED at the canon 104px, and mirrored by import\n'
# Finding 6. The Skeleton-Mirror Rule: "a floor cannot be a mirror; only a pin
# can." The old ROOT was `min-h-[5.75rem]` with a `h-[5.75rem]` skeleton -- both
# the wrong mechanism AND 12px shorter than every other strip in the product.
if grep -q 'min-h-\[5\.75rem\]\|h-\[5\.75rem\]' "$TMPD/all.code"; then
    printf '       offending lines:\n'
    grep -n 'min-h-\[5\.75rem\]\|h-\[5\.75rem\]' "$TMPD/all.code" | sed 's/^/         /'
    bad "the pre-correction 92px number survives"
else
    ok "the 5.75rem number is gone"
fi
if grep -q 'h-\[6\.5rem\]' "$TMPD/shapes.code"; then
    ok "shapes.ts pins the tile at h-[6.5rem] (104px)"
else
    bad "shapes.ts does not pin the tile at h-[6.5rem]"
fi
# ROOT itself must not carry a floor. Read the ROOT line only, so a `min-h-` on
# an unrelated key (the settings row's legitimate floor) is not a false positive.
root_line=$(grep -n 'ROOT:' "$TMPD/shapes.code" | grep 'rounded-tile' || true)
if [ -z "$root_line" ]; then
    bad "shapes.ts has no TILE ROOT line carrying rounded-tile"
elif printf '%s' "$root_line" | grep -q 'min-h-'; then
    printf '       offending line:\n         %s\n' "$root_line"
    bad "the tile ROOT still carries a min-h- floor"
else
    ok "the tile ROOT is a pin, not a floor"
fi
# The skeleton mirrors BY IMPORT. A restated height is how a 26px jump at the
# handoff shipped last time.
if grep -qE '(TILE\.HEIGHT|HEIGHT)' "$TMPD/strip.code" && grep -q 'Skeleton' "$TMPD/strip.code"; then
    ok "the skeleton reads its height from the shared constant"
else
    bad "the skeleton does not mirror TILE.HEIGHT by import"
fi

# -----------------------------------------------------------------------------
printf '\n[4] Peer radius and the whisper shadow (finding 8)\n'
# `rounded-hero` is "the ONE card that anchors a surface"; these are peers.
# `shadow-sm` is outside the shadow vocabulary entirely -- the same defect closed
# in the pre-auth pass.
for offender in 'rounded-hero' 'shadow-sm'; do
    hits=$(grep -n "$offender" "$TMPD/all.code" || true)
    if [ -n "$hits" ]; then
        printf '       offending lines:\n'
        printf '%s\n' "$hits" | sed 's/^/         /'
        bad "'$offender' survives on the ethernet surface"
    else
        ok "no '$offender'"
    fi
done
if grep -q 'shadow-\[var(--shadow-whisper)\]' "$TMPD/shapes.code"; then
    ok "shapes.ts uses shadow-[var(--shadow-whisper)]"
else
    bad "shapes.ts does not carry the whisper shadow"
fi
if grep -q 'rounded-card' "$TMPD/shapes.code"; then
    ok "the card shell takes the peer radius (rounded-card)"
else
    bad "the card shell does not take rounded-card"
fi

# -----------------------------------------------------------------------------
printf '\n[5] Live auto_negotiation has a render call site (finding 4)\n'
# The State-Honesty Rule. It is fetched at ethernet-status.tsx:78, typed at
# ethernet-card.tsx:77, and rendered NOWHERE -- the tile labelled "Negotiation"
# prints `speed_limit`, the saved setting, under the live fact's name.
if grep -q 'auto_negotiation' "$TMPD/strip.code"; then
    ok "link-state-strip.tsx reads auto_negotiation"
else
    bad "auto_negotiation still has no render call site -- the live fact is discarded"
fi
# And the saved limit is still shown, as the CAPTION rather than as the value.
if grep -q 'speed_limit' "$TMPD/strip.code"; then
    ok "the saved speed_limit survives as the tile's caption"
else
    bad "speed_limit lost its call site on the strip -- the limit-aware caption is missing"
fi

# -----------------------------------------------------------------------------
printf '\n[6] A failed refresh RAISES a flag rather than being swallowed (finding 5)\n'
# ethernet-status.tsx:83-87 today: `if (mountedRef.current && !hasDataRef.current)`.
# After one successful load a dead 10s poll and a healthy one render
# identically, forever.
if grep -q 'hasDataRef' "$TMPD/shell.code"; then
    printf '       offending lines:\n'
    grep -n 'hasDataRef' "$TMPD/shell.code" | sed 's/^/         /'
    bad "hasDataRef survives -- errors are still gated on 'have we ever had data'"
else
    ok "hasDataRef is gone"
fi
if grep -q 'pollFailed' "$TMPD/shell.code"; then
    ok "the shell carries a pollFailed flag"
else
    bad "the shell has no pollFailed flag -- a failed refresh cannot be reported"
fi
if grep -qE 'setPollFailed\(true\)' "$TMPD/shell.code"; then
    ok "the catch path sets pollFailed(true)"
else
    bad "no setPollFailed(true) on the failure path -- the error is still swallowed"
fi
# The band's warning chip is the thing that says so, and there is NO healthy
# half: the same request retired the "live" chip on /cellular/ and
# /cellular/settings.
if grep -q 'variant="warning"' "$TMPD/strip.code"; then
    ok "the band header carries a warning chip"
else
    bad "the band header has no warning chip -- a stale band looks current"
fi
if grep -qE 'variant="success"' "$TMPD/strip.code"; then
    printf '       offending lines:\n'
    grep -n 'variant="success"' "$TMPD/strip.code" | sed 's/^/         /'
    bad "the band grew a healthy/live chip -- retired product-wide, only the warning half stays"
else
    ok "no healthy 'live' chip on the band"
fi

# -----------------------------------------------------------------------------
printf '\n[7] The rate tile is neutral and carries the PHY ceiling (vetoes A + B)\n'
# Veto A: no hue in the system is honest for a bidirectional link rate (The
# Neutral-Default Rule), which overturns the current downlink-container and the
# comment defending it. Veto B: `supports_2500` is already fetched and today only
# decides whether one dropdown option exists; as a caption it answers "am I
# getting the port's full speed?"
if grep -q 'supports_2500\|supports2500' "$TMPD/strip.code"; then
    ok "the rate tile reads supports_2500 for its ceiling caption"
else
    bad "supports_2500 has no call site on the strip -- veto B was not built"
fi
# The rate is a live MEASUREMENT, so it is tabular-nums in the UI face and never
# font-mono (The Machine-Voice Rule).
if grep -q 'tabular-nums' "$TMPD/shapes.code"; then
    ok "the VALUE role is tabular-nums"
else
    bad "the VALUE role is not tabular-nums"
fi
if grep -q 'font-mono' "$TMPD/strip.code"; then
    printf '       offending lines:\n'
    grep -n 'font-mono' "$TMPD/strip.code" | sed 's/^/         /'
    bad "a strip figure is font-mono -- a negotiated rate is a measurement, not an identifier"
else
    ok "no font-mono figure on the strip"
fi
# The link tile is the ONLY tile whose disc changes tone at runtime, and the
# three link states never share a glyph (The Every-Chip-Has-A-Glyph Rule at tile
# scale: success-container and warning-container measure 1.03:1 apart).
for disc in DISC_UP DISC_DOWN DISC_NEUTRAL; do
    if grep -q "$disc" "$TMPD/shapes.code"; then
        ok "shapes.ts declares $disc"
    else
        bad "shapes.ts does not declare $disc"
    fi
done
glyphs=$(grep -oE '[A-Za-z0-9]+Icon' "$TMPD/strip.code" | sort -u | wc -l | tr -d ' ')
if [ "$glyphs" -ge 5 ]; then
    ok "the strip renders $glyphs distinct glyphs (>= 3 link states + rate + duplex + negotiation)"
else
    printf '       found: %s\n' "$glyphs"
    bad "only $glyphs distinct glyphs on the strip -- two states are sharing one"
fi

# -----------------------------------------------------------------------------
printf '\n[8] The One-Scale Rule: every duration and ease reads var()\n'
# A bare duration-200, an inline { duration: 0.25 }, or a transition-all with no
# duration is off the scale and will not retune with lib/motion.ts.
if grep -qE 'duration-\[[0-9]|duration-[0-9]' "$TMPD/all.code"; then
    printf '       offending lines:\n'
    grep -nE 'duration-\[[0-9]|duration-[0-9]' "$TMPD/all.code" | sed 's/^/         /'
    bad "a literal Tailwind duration survives -- it will not retune"
else
    ok "no literal duration utility"
fi
if grep -qE 'transition-all' "$TMPD/all.code"; then
    printf '       offending lines:\n'
    grep -nE 'transition-all' "$TMPD/all.code" | sed 's/^/         /'
    bad "a transition-all survives -- it silently inherits Tailwind's 150ms"
else
    ok "no transition-all"
fi
unguarded=$(grep -nE '\{ duration: 0\.' "$TMPD/all.code" | grep -viE 'reduce' || true)
if [ -n "$unguarded" ]; then
    printf '       offending lines:\n'
    printf '%s\n' "$unguarded" | sed 's/^/         /'
    bad "a literal JS duration survives outside a reducedMotion guard"
else
    ok "no literal JS duration outside a reducedMotion guard"
fi
# Every arbitrary custom property takes var(). Counted, so the link disc's own
# tone transition cannot silently vanish along with the bare-var spelling.
varforms=$(grep -cE 'duration-\[var\(--duration-(quick|standard|emphasized)\)\]' "$TMPD/all.code" || true)
if [ "${varforms:-0}" -ge 1 ]; then
    ok "$varforms tokenized duration(s) in the var() form"
else
    bad "no duration-[var(--duration-*)] anywhere -- the link tone transition is missing"
fi
if grep -q 'transition-\[background-color,color\]' "$TMPD/all.code"; then
    ok "the link disc's tone change is a scoped property transition"
else
    bad "no transition-[background-color,color] -- the link disc still repaints rather than transitions"
fi

# -----------------------------------------------------------------------------
printf '\n[9] Geometry is IMPORTED from shapes.ts, never restated (finding 10)\n'
# One caption role, ONE spelling. The old module had CAPTION, CAPTION_CLASS and
# a third literal at the call sites.
for consumer in strip card; do
    if grep -qE 'from "\./shapes"|from "@/components/local-network/ethernet/shapes"' "$TMPD/$consumer.code"; then
        ok "$consumer imports its geometry from shapes.ts"
    else
        bad "$consumer does not import from shapes.ts -- geometry is restated inline"
    fi
done
for name in CAPTION_CLASS ETH_TILE_SHAPE NEUTRAL_TILE NEUTRAL_DISC SPEED_TILE NEGOTIATION_TILE LINK_UP_TILE LINK_DOWN_TILE; do
    if grep -q "$name" "$TMPD/all.code"; then
        printf '       offending lines:\n'
        grep -n "$name" "$TMPD/all.code" | sed 's/^/         /'
        bad "the retired constant '$name' survives"
    else
        ok "retired: $name"
    fi
done
# /local-network/ must NOT reach into components/cellular/ for its geometry.
if grep -q 'components/cellular' "$TMPD/all.code"; then
    printf '       offending lines:\n'
    grep -n 'components/cellular' "$TMPD/all.code" | sed 's/^/         /'
    bad "the ethernet family imports from components/cellular/ -- restate, do not reach across families"
else
    ok "no cross-family import from components/cellular/"
fi
# The named exports the plan specifies.
for exp in 'TILE' 'DISC_UP' 'DISC_DOWN' 'DISC_NEUTRAL' 'EYEBROW' 'VALUE' 'CAPTION' 'BAND' 'CARD_SHELL' 'CARD_PAD' 'CARD_TITLE' 'ROW_GROUP' 'ROW' 'FIELD' 'NOTICE_SPAN' 'NOTICE_TITLE'; do
    if grep -qE "^export const ${exp}\b" "$TMPD/shapes.code"; then
        ok "shapes.ts exports $exp"
    else
        bad "shapes.ts does not export $exp"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[10] The bespoke error card is replaced by ONE spanning notice tile\n'
# Four identical "couldn't read" tiles would be one message repeated four times;
# a bespoke centred error card is a second vocabulary for the same event. The
# band keeps the family box and goes neutral, exactly as live-state-strip.tsx
# does.
if grep -q 'EthernetErrorState' "$TMPD/all.code" || grep -q 'EthernetErrorState' "$PAGE" 2>/dev/null; then
    bad "EthernetErrorState survives -- the bespoke error card was not replaced"
else
    ok "EthernetErrorState is gone"
fi
if grep -q 'NOTICE_SPAN' "$TMPD/strip.code"; then
    ok "the failed-read branch renders the spanning notice tile"
else
    bad "the strip does not use NOTICE_SPAN -- the failed-read state is missing"
fi

# -----------------------------------------------------------------------------
printf '\n[11] The field fill is a light/dark PAIR, dark half important-marked\n'
# Finding 9. `select.tsx` ships `dark:bg-input/30`. Tailwind v4 compiles `dark`
# to `&:is(.dark *)` -- (0,2,0) against a bare call-site fill's (0,1,0) -- so a
# light-only override simply loses in dark mode, and tailwind-merge cannot dedupe
# the two because they sit in different modifier groups. Once BOTH are `dark:`
# they TIE, and a tie is decided by Tailwind's name sort (`bg-input` before
# `bg-surface-…` only because i precedes s). The important modifier is what makes
# the rule win by construction.
field_line=$(grep -n 'FIELD' "$TMPD/shapes.code" | grep -E 'bg-surface-container' || true)
if [ -z "$field_line" ]; then
    bad "shapes.ts declares no explicit FIELD fill"
else
    ok "shapes.ts declares an explicit FIELD fill"
fi
if grep -qE 'dark:bg-surface-container(-high)?!' "$TMPD/shapes.code"; then
    ok "the dark half is written and important-marked"
else
    printf '       (looking for dark:bg-surface-container! or dark:bg-surface-container-high!)\n'
    bad "no important-marked dark: field fill -- dark mode reverts to select.tsx's own bg-input/30"
fi

# -----------------------------------------------------------------------------
printf '\n[12] The write card keeps apply-on-change, and states the consequence (veto C)\n'
# Product Principle 6 -- make the dangerous obvious. Applying drops the link for
# about 8 seconds while the PHY renegotiates, and the user is on that link.
if grep -q 'onValueChange' "$TMPD/card.code"; then
    ok "the Select still applies on change"
else
    bad "the Select no longer applies on change -- veto C was overturned"
fi
if grep -qE 'SaveButton|save_button' "$TMPD/card.code"; then
    printf '       offending lines:\n'
    grep -nE 'SaveButton|save_button' "$TMPD/card.code" | sed 's/^/         /'
    bad "a Save button was added -- veto C says the in-place confirmation stays"
else
    ok "no Save button was added"
fi
for state in applying saved; do
    if grep -q "\.$state" "$TMPD/card.code"; then
        ok "the trigger still carries its '$state' state"
    else
        bad "the trigger lost its '$state' state -- the in-place confirmation is broken"
    fi
done
if grep -q 'consequence' "$TMPD/card.code"; then
    ok "the row renders a consequence sentence"
else
    bad "the row renders no consequence sentence"
fi
# A control that cannot currently work explains why (The State-Honesty Rule).
if grep -qE 'disabled=' "$TMPD/card.code"; then
    ok "the control has a disabled path"
else
    bad "the control has no disabled path -- it cannot be held while the poll is failing"
fi
# The provenance line names where the value is read back from, in machine voice.
if grep -q 'provenance' "$TMPD/card.code" && grep -q 'font-mono' "$TMPD/card.code"; then
    ok "the card carries a font-mono provenance line"
else
    bad "no font-mono provenance line naming /etc/qmanager/ethernet_speed"
fi

# -----------------------------------------------------------------------------
printf '\n[13] interface_present: the one backward-compatible CGI field (decision a)\n'
# `ethernet.sh` returns success:true with link_status:"down" whether the cable is
# out or eth0 does not exist, so the frontend cannot tell "unplugged" from "no
# NIC". docs/reference/ethernet.md calls a missing eth0 a DESIGNED outcome (it is
# why qmanager-ethernet.service's ConditionPathExists lives in [Unit]), so the UI
# should be able to say so.
#
# Backward-compatible in BOTH directions: older frontends ignore the extra field,
# and a frontend seeing an older backend must treat a missing field as true --
# never as "no NIC", which would blank a working page on an un-updated device.
if [ ! -f "$CGI" ]; then
    bad "CGI not found: ${CGI#"$REPO_ROOT/"}"
else
    if grep -q 'interface_present' "$CGI"; then
        ok "ethernet.sh emits interface_present"
    else
        bad "ethernet.sh does not emit interface_present"
    fi
    if grep -qE '\-d "?/sys/class/net' "$CGI" || grep -qE '\-d "\$\{?SYS' "$CGI"; then
        ok "interface_present is derived from a sysfs directory test"
    else
        bad "no [ -d /sys/class/net/... ] test -- the field is derived from something else"
    fi
    if grep -q 'argjson interface_present' "$CGI"; then
        ok "interface_present is emitted as a JSON boolean (--argjson), not a string"
    else
        bad "interface_present is not emitted via --argjson -- a quoted \"false\" is truthy in JS"
    fi
fi
if grep -q 'interface_present' "$TMPD/all.code"; then
    ok "the frontend consumes interface_present"
else
    bad "the frontend does not consume interface_present -- the no-controller state is unreachable"
fi
# The missing-field default. `?? true` / `!== false` are both correct; a bare
# truthiness test on an absent field is not.
if grep -qE 'interface_present\s*(\?\?\s*true|!==\s*false|===\s*false)' "$TMPD/all.code"; then
    ok "a missing interface_present is treated as true"
else
    bad "a missing interface_present is not defaulted to true -- an un-updated backend blanks the page"
fi

# -----------------------------------------------------------------------------
printf '\n[14] Every i18n key referenced resolves in ALL FIVE locales\n'
# Checked at the CALL SITE rather than by diffing packs: a key added to en/ but
# never rendered, or rendered but missing from id/, both fail here. `bun run
# i18n:check` catches the pack-to-pack half; this catches the call-site half.
KEY_SRC="$TMPD/keys.txt"
: > "$KEY_SRC"
for code in "$TMPD/strip.code" "$TMPD/card.code" "$TMPD/shell.code"; do
    grep -oE '\$\{K\}\.[A-Za-z0-9_.]+' "$code" 2>/dev/null | sed 's/^\${K}\.//' >> "$KEY_SRC" || true
done
sort -u "$KEY_SRC" -o "$KEY_SRC"

if [ ! -s "$KEY_SRC" ]; then
    bad "no \${K}.* i18n keys found in the ethernet components -- either they are unbuilt, or they hardcode their strings"
else
    ok "$(wc -l < "$KEY_SRC" | tr -d ' ') distinct i18n keys referenced"
    for loc in en zh-CN zh-TW it id; do
        pack="$LOCALES/$loc/common.json"
        if [ ! -f "$pack" ]; then bad "locale pack missing: $pack"; continue; fi
        missing=$(node -e '
            const fs = require("fs");
            const pack = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
            const base = pack?.ethernet ?? {};
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
            printf '%s\n' "$missing" | fold -s -w 100 | sed 's/^/         /'
            bad "$loc/common.json is missing ethernet.* keys"
        else
            ok "$loc/common.json resolves every referenced key"
        fi
    done
fi
# The retired leaves go with the composition. Keeping them is how a pack
# accumulates strings nothing renders.
#   tiles.speed.label      "Active speed"          -> the tile is now "Negotiated rate"
#   tiles.*.value_na       "N/A"                   -> the em-dash placeholder is one key
#   tiles.negotiation.*    value_manual/caption_*  -> the tile reads live autoneg now
#   error.*                the bespoke error card  -> replaced by the notice tile
for loc in en zh-CN zh-TW it id; do
    pack="$LOCALES/$loc/common.json"
    [ -f "$pack" ] || continue
    dead=$(node -e '
        const fs = require("fs");
        const pack = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const eth = pack?.ethernet ?? {};
        const at = (p) => p.split(".").reduce((n, k) => (n && typeof n === "object" ? n[k] : undefined), eth);
        const dead = [
            "tiles.speed.value_na",
            "tiles.duplex.value_na",
            "tiles.negotiation.value_na",
            "tiles.negotiation.value_manual",
            "tiles.negotiation.caption_manual",
            "tiles.negotiation.caption_na",
            "error.title",
            "error.body",
        ].filter((k) => at(k) !== undefined);
        process.stdout.write(dead.join(" "));
    ' "$pack")
    if [ -n "$dead" ]; then
        printf '         %s\n' "$dead"
        bad "$loc/common.json still carries retired ethernet.* leaves"
    else
        ok "$loc/common.json carries no retired ethernet.* leaves"
    fi
done

printf '\n---------------------------------------------\n'
printf 'ethernet-design-language: %d passed, %d failed\n\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ]
