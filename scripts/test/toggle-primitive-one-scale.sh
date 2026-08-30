#!/usr/bin/env bash
# Regression harness for the One-Scale transition leak in the shared toggle
# primitive.
#
# WHY THIS EXISTS
# ----------------
# `components/ui/toggle.tsx:10` — the cva behind `Toggle`, `ToggleGroup` and
# `ToggleGroupItem` — ends its base string with:
#
#     outline-none transition-[color,box-shadow] aria-invalid:ring-destructive/20
#
# A `transition-*` utility with NO `duration-*` and NO `ease-*`. `app/globals.css`
# does not override `--default-transition-duration` (verified: `grep -rn
# "default-transition"` over app/ components/ lib/ returns nothing), so Tailwind's
# own 150ms default stands. Every ink and focus-ring change on every toggle in the
# product therefore runs off the shipped 360/600/800 scale, and is immune to a
# retune of `lib/motion.ts` + the `--duration-*` properties.
#
# That is DESIGN.md > The One-Scale Rule, which CLAUDE.md states as: "A raw
# `duration-200` / `{ duration: 0.25 }` / bare `transition-all` in a component is
# a bug — it silently won't retune." Same class of defect, in a SHARED PRIMITIVE.
#
# Four consumers, and a grep confirms NONE of them overrides it:
#
#   components/cellular/settings/segmented-field.tsx           (travelling thumb)
#   components/dashboard/signal-history.tsx                    (travelling thumb)
#   components/cellular/antenna-alignment/recorder-card.tsx    (no thumb)
#   components/system-settings/scheduled-operations-card.tsx   (plain Toggle)
#
# THREE CORRECTIONS TO THE ORIGINATING HANDOFF, recorded because they moved the
# decision rather than merely annotating it
# ---------------------------------------------------------------------------
#  C1  The handoff says THREE of the four consumers have a travelling fill. It is
#      TWO. `recorder-card.tsx:544` is `variant="outline"` with `SEGMENTED_ITEM`
#      and carries no `layoutId` and no motion node at all — its state change is
#      a static fill swap. So "the ink should track the thumb" argues from 2/4
#      surfaces, not 3/4.
#  C2  "Which single duration token" is the wrong question, and `badge.tsx:7-22`
#      already answered the right one. The transition list is `[color,box-shadow]`
#      — two properties with different jobs: `color` is the ink swap,
#      `box-shadow` is the `focus-visible:ring-[3px]` focus ring. Badge documents
#      why one clock cannot serve both: a ring at the longer duration "lags
#      visibly while tabbing through a settings form."
#  C3  The handoff's prescribed "house form" `duration-[--duration-*]` is the
#      MINORITY spelling. Census over components/: `duration-[var(--duration-*)]`
#      97 uses, `duration-(--duration-*)` 31, `duration-[--duration-*]` only 9.
#      Easing inverts — the bare theme utilities `ease-standard`/`ease-quick`
#      dominate at 81, because `--ease-*` IS in the `@theme` namespace while the
#      durations deliberately are not (globals.css:224). [1] and [2] therefore
#      accept ALL THREE duration spellings and both ease forms. Pinning one would
#      pin a house style that is not the house style.
#
# THE THREE APPROVED DECISIONS (recorded 2026-08-30, user, at the Phase 3 gate)
# -----------------------------------------------------------------------------
#   D1  The badge two-clock recipe: `color` at `--duration-standard` /
#       `--ease-standard`, `box-shadow` at `--duration-quick` / `--ease-quick`.
#       `background-color` is deliberately NOT added — it is live and cutting on
#       recorder-card and scheduled-operations-card, but adding it is a behaviour
#       addition rather than a leak fix, and it was declined at the gate. No
#       assertion below requires it, and none forbids it.        -> [1] [2] [3]
#   D2  Scope is the transition PLUS the one raw-Tailwind-colour line at
#       `scheduled-operations-card.tsx:293`. The rest of toggle.tsx's unmigrated
#       content stays.                                       -> [5] [7] [8]
#   D3  Harness and fix are written by the same author, separated temporally
#       rather than by a second builder. This file is committed RED and frozen
#       before the fix exists; it is not edited afterwards. Stated openly: that
#       rules out a vacuous test but NOT a test shaped by its author's idea of
#       the fix. It is change-workflow.md's "floor for work that skips the plan",
#       applied by choice here.
#
# Had D1 come back as a single clock, [1]/[2] would be unchanged — they are
# written as the general rule, not against the chosen recipe. Had D2 come back
# "transition only", [7] and [8] would not exist. They do, so they are
# load-bearing.
#
# This harness is COMMITTED RED, before the fix exists (change-workflow.md,
# Phase 4a).
#
# SCOPINGS, stated openly so they are not mistaken for a weakened test
# ---------------------------------------------------------------------
#  * Every assertion runs against COMMENT-STRIPPED source. These files gain a
#    comment explaining why the tokens are there, and that comment quotes the
#    retired bare form. A comment explaining a removal is documentation, not
#    code. `strip_comments()` is copied verbatim from the three sibling
#    harnesses rather than rewritten a fourth time.
#  * [1] treats "a transition declaration" as a line matching `transition-` or
#    `transition:`. In these two files, stripped, that token appears only inside
#    the cva class strings, so per-line is exact here. The leading character
#    class excludes `transitionStandard` and any other identifier that merely
#    starts with the word.
#  * [3] is VACUOUS TODAY — `toggle-group.tsx` carries no transition at all. It
#    is a drift guard, and it passes in the red run. So does [6]. The harness is
#    red as a whole on [1], [2], [7] and [8]; that is the point, not every line
#    failing.
#  * [6] anchors on `data-[state=on]` lines plus the `SEGMENTED_ITEM` value,
#    which between them are every string that styles a toggle segment across the
#    four consumers. It cannot see a class injected some other way; it is a guard
#    against the fix being scattered to call sites, not a proof of the negative.
#  * [8] pins `fill-primary`/`stroke-primary` by NAME. That name comes from this
#    plan (`--color-primary` exists at globals.css:137 and `stroke-primary` is
#    already used once in components/), not from the builder — which is what
#    keeps it an independent anchor. [7] is the general rule and is the
#    load-bearing half.
#  * NOT ASSERTED, deliberately: that `fill`/`stroke` join the transition list.
#    They are not in it today, so the day-selector glyph's colour swap cuts
#    instantly both before and after this change. That is a real observation and
#    it is OUT OF SCOPE under D1 — asserting it would smuggle a declined option
#    back in through the test.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UI="$REPO_ROOT/components/ui"

TOGGLE="$UI/toggle.tsx"
GROUP="$UI/toggle-group.tsx"

SEGMENTED="$REPO_ROOT/components/cellular/settings/segmented-field.tsx"
SETTINGS_SHAPES="$REPO_ROOT/components/cellular/settings/shapes.ts"
HISTORY="$REPO_ROOT/components/dashboard/signal-history.tsx"
RECORDER="$REPO_ROOT/components/cellular/antenna-alignment/recorder-card.tsx"
ALIGN_SHAPES="$REPO_ROOT/components/cellular/antenna-alignment/shapes.ts"
SCHEDULED="$REPO_ROOT/components/system-settings/scheduled-operations-card.tsx"

pass_count=0
fail_count=0

ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

show() { printf '       offending lines:\n'; sed 's/^/         /'; }

for f in "$TOGGLE" "$GROUP" "$SEGMENTED" "$SETTINGS_SHAPES" "$HISTORY" \
         "$RECORDER" "$ALIGN_SHAPES" "$SCHEDULED"; do
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

strip_comments "$TOGGLE"          > "$TMPD/toggle.code"
strip_comments "$GROUP"           > "$TMPD/group.code"
strip_comments "$SEGMENTED"       > "$TMPD/segmented.code"
strip_comments "$SETTINGS_SHAPES" > "$TMPD/settings-shapes.code"
strip_comments "$HISTORY"         > "$TMPD/history.code"
strip_comments "$RECORDER"        > "$TMPD/recorder.code"
strip_comments "$ALIGN_SHAPES"    > "$TMPD/align-shapes.code"
strip_comments "$SCHEDULED"       > "$TMPD/scheduled.code"

# A Tailwind transition declaration: `transition-[...]`, `transition-colors`,
# `transition-all`, a bare `transition-`, or badge.tsx's arbitrary-property
# longhand `[transition:...]`.
TRANSITION_RE='(^|[^A-Za-z0-9_$])transition[-:]'

# All three spellings Tailwind v4 accepts for a custom property, per C3, plus
# the bare `var(--duration-*)` that badge.tsx's `[transition:...]` longhand uses.
DURATION_TOKEN_RE='duration-(\[--duration-|\(--duration-|\[var\(--duration-)|var\(--duration-'
# Either an arbitrary-value token or the bare `@theme` ease utility.
EASE_TOKEN_RE='ease-(\[--ease-|\(--ease-|\[var\(--ease-)|var\(--ease-|(^|[^A-Za-z0-9_$-])ease-(standard|quick|emphasized|ambient)([^A-Za-z0-9_-]|$)'

# Reports every transition-declaring line in $1 that does not also carry a match
# for $2. Written as the general rule, not as a grep for the one string being
# retired: a builder who swaps `transition-[color,box-shadow]` for a DIFFERENT
# bare `transition-*` still fails.
unmetered_lines() {
    file="$1"; want="$2"; out=""
    for n in $(grep -nE "$TRANSITION_RE" "$file" 2>/dev/null | cut -d: -f1 || true); do
        body=$(sed -n "${n}p" "$file")
        if ! printf '%s' "$body" | grep -Eq "$want"; then
            out="$out$n: $(printf '%s' "$body" | cut -c1-160)
"
        fi
    done
    printf '%s' "$out"
}

# -----------------------------------------------------------------------------
printf '\n[1] toggle.tsx: every transition declaration names a --duration-* token\n'
# The defect itself. `transition-[color,box-shadow]` with nothing to meter it
# inherits Tailwind's 150ms and cannot be retuned from globals.css or motion.ts.
offenders=$(unmetered_lines "$TMPD/toggle.code" "$DURATION_TOKEN_RE")
if [ -n "$offenders" ]; then
    printf '%s' "$offenders" | show
    bad "toggle.tsx has a transition with no --duration-* token (the 150ms leak)"
else
    ok "toggle.tsx meters every transition with a --duration-* token"
fi

# -----------------------------------------------------------------------------
printf '\n[2] toggle.tsx: every transition declaration names an --ease-* curve\n'
# Half of the defect statement is the missing ease, not just the missing
# duration. An unmetered curve drifts the same way an unmetered duration does.
offenders=$(unmetered_lines "$TMPD/toggle.code" "$EASE_TOKEN_RE")
if [ -n "$offenders" ]; then
    printf '%s' "$offenders" | show
    bad "toggle.tsx has a transition with no --ease-* / theme ease utility"
else
    ok "toggle.tsx names a curve on every transition"
fi

# -----------------------------------------------------------------------------
printf '\n[3] toggle-group.tsx obeys the same two rules (drift guard, vacuous today)\n'
offenders=$(unmetered_lines "$TMPD/group.code" "$DURATION_TOKEN_RE")
if [ -n "$offenders" ]; then
    printf '%s' "$offenders" | show
    bad "toggle-group.tsx has a transition with no --duration-* token"
else
    ok "toggle-group.tsx meters every transition it has"
fi
offenders=$(unmetered_lines "$TMPD/group.code" "$EASE_TOKEN_RE")
if [ -n "$offenders" ]; then
    printf '%s' "$offenders" | show
    bad "toggle-group.tsx has a transition with no --ease-* curve"
else
    ok "toggle-group.tsx names a curve on every transition it has"
fi

# -----------------------------------------------------------------------------
printf '\n[4] Neither file carries a bare duration or a literal curve\n'
# `duration-150`, `duration-[200ms]`, `duration-(200ms)` — anything metered by a
# number rather than by the scale. And a hand-written cubic-bezier, which is the
# same violation on the curve axis: the three curves are tokens.
for pair in "toggle.tsx:$TMPD/toggle.code" "toggle-group.tsx:$TMPD/group.code"; do
    name="${pair%%:*}"; code="${pair#*:}"
    hits=$(grep -nE 'duration-[[(]?[0-9]' "$code" || true)
    if [ -n "$hits" ]; then
        printf '%s\n' "$hits" | show
        bad "$name carries a bare duration literal"
    else
        ok "$name carries no bare duration literal"
    fi
    hits=$(grep -n 'cubic-bezier' "$code" || true)
    if [ -n "$hits" ]; then
        printf '%s\n' "$hits" | show
        bad "$name carries a literal cubic-bezier instead of an --ease-* token"
    else
        ok "$name carries no literal cubic-bezier"
    fi
done
# `transition-all` is named in CLAUDE.md as a bug in its own right: it silently
# picks up layout properties nobody chose to animate.
hits=$(grep -nE '(^|[^A-Za-z0-9_$-])transition-all([^A-Za-z0-9_-]|$)' \
       "$TMPD/toggle.code" "$TMPD/group.code" || true)
if [ -n "$hits" ]; then
    printf '%s\n' "$hits" | show
    bad "the toggle primitive uses transition-all"
else
    ok "the toggle primitive uses no transition-all"
fi

# -----------------------------------------------------------------------------
printf '\n[5] SCOPE PIN (D2): the rest of the cva base is NOT touched\n'
# The transition is one of several unmigrated things in this file. D2 scoped them
# OUT. A drive-by tone/shape migration is a wider blast radius on two live
# consumers and deserves its own gate — so it goes red here rather than riding
# along on this approval.
for cls in 'rounded-md' \
           'hover:bg-muted' \
           'hover:text-muted-foreground' \
           'data-\[state=on\]:bg-primary/10' \
           'data-\[state=on\]:text-accent-foreground'; do
    plain=$(printf '%s' "$cls" | tr -d '\\')
    if grep -q "$cls" "$TMPD/toggle.code"; then
        ok "toggle.tsx still carries '$plain' (out of scope, left alone)"
    else
        bad "toggle.tsx lost '$plain' — a tone/shape migration D2 did not approve"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[6] The fix lives in the PRIMITIVE, not scattered to the call sites\n'
# Every string that styles a toggle segment across the four consumers is either a
# `data-[state=on]` class string or the `SEGMENTED_ITEM` value. None of them may
# grow its own transition — the whole point is that one primitive retunes all
# four surfaces at once.
scattered=""
for pair in "segmented-field.tsx:$TMPD/segmented.code" \
            "settings/shapes.ts:$TMPD/settings-shapes.code" \
            "signal-history.tsx:$TMPD/history.code" \
            "recorder-card.tsx:$TMPD/recorder.code" \
            "scheduled-operations-card.tsx:$TMPD/scheduled.code"; do
    name="${pair%%:*}"; code="${pair#*:}"
    hits=$(grep -n 'data-\[state=on\]' "$code" | grep -E 'transition-|duration-' || true)
    if [ -n "$hits" ]; then
        scattered="$scattered$name -> $hits
"
    fi
done
hits=$(grep -A2 'SEGMENTED_ITEM' "$TMPD/align-shapes.code" | grep -E 'transition-|duration-' || true)
if [ -n "$hits" ]; then
    scattered="${scattered}antenna-alignment/shapes.ts -> $hits
"
fi
if [ -n "$scattered" ]; then
    printf '%s' "$scattered" | show
    bad "a consumer overrides the primitive's transition instead of inheriting it"
else
    ok "all four consumers still inherit the primitive's transition"
fi

# -----------------------------------------------------------------------------
printf '\n[7] scheduled-operations-card.tsx carries no raw Tailwind palette colour\n'
# CLAUDE.md: "semantic color tokens only, never raw Tailwind colors." The day
# selector ships `fill-blue-500` / `stroke-blue-500` at :293. This is the general
# rule; [8] pins the replacement.
PALETTE='(bg|text|fill|stroke|border|ring|from|via|to|decoration|outline|shadow|accent|caret|divide)-(slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(50|[1-9]00|950)'
hits=$(grep -nE "$PALETTE" "$TMPD/scheduled.code" || true)
if [ -n "$hits" ]; then
    printf '%s\n' "$hits" | show
    bad "scheduled-operations-card.tsx uses raw Tailwind palette colours"
else
    ok "scheduled-operations-card.tsx uses semantic tokens only"
fi

# -----------------------------------------------------------------------------
printf '\n[8] The day selector paints its active glyph with the primary role\n'
# The name comes from this plan, not from the builder: --color-primary exists
# (globals.css:137) and stroke-primary is already used once in components/.
for cls in 'fill-primary' 'stroke-primary'; do
    if grep -qE "(^|[^A-Za-z0-9_-])$cls([^A-Za-z0-9_-]|$)" "$TMPD/scheduled.code"; then
        ok "scheduled-operations-card.tsx paints the active day with $cls"
    else
        bad "scheduled-operations-card.tsx does not use $cls for the active day"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[9] KEEP: the primitive still exports what four consumers import\n'
# An over-broad rewrite that "cleans up" the API goes red here rather than at
# `next build`.
for sym in 'Toggle' 'toggleVariants'; do
    if grep -qE "export \{[^}]*$sym" "$TMPD/toggle.code"; then
        ok "toggle.tsx still exports $sym"
    else
        bad "toggle.tsx no longer exports $sym"
    fi
done
for sym in 'ToggleGroup' 'ToggleGroupItem'; do
    if grep -qE "export \{[^}]*$sym" "$TMPD/group.code"; then
        ok "toggle-group.tsx still exports $sym"
    else
        bad "toggle-group.tsx no longer exports $sym"
    fi
done
# The cva contract itself: two variants, three sizes. A consumer passes
# `variant="outline"` (recorder-card, scheduled-operations-card) and
# `size="sm"` (scheduled-operations-card).
for key in 'default:' 'outline:' 'sm:' 'lg:'; do
    if grep -q "$key" "$TMPD/toggle.code"; then
        ok "toggleVariants still declares '$key'"
    else
        bad "toggleVariants lost '$key' — a consumer passes it"
    fi
done

printf '\n---------------------------------------------\n'
printf 'toggle-primitive-one-scale: %d passed, %d failed\n\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ]
