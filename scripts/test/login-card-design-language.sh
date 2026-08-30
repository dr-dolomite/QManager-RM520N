#!/usr/bin/env bash
# Regression harness for the /login/ card's design-language adoption.
#
# WHY THIS EXISTS
# ----------------
# /login/ is the LAST surface still built on the Material-3 TONAL language that
# PRODUCT.md replaced on 2026-08-16 with "colour on data-ink over neutral
# surfaces". It is the same migration already shipped by
# `cellular/radio/summary-tiles.tsx`, the SMS strip (084d7c1), the Cell Scanner
# triad (e32258c) and the Overview splash (68e6083, harness
# `overview-splash-design-language.sh`).
#
# On top of the migration this change makes ONE composition decision, and most
# of the assertions below exist to pin it:
#
#   The card currently GREETS, then asks. It should IDENTIFY, then ask. It
#   spends 24px and its only colour on a constant string ("Welcome to
#   QManager") and 14px muted, folded mid-sentence, on the hostname -- the one
#   fact on the screen that varies. login-device-name.tsx's own header comment
#   says its job is to answer "which modem am I signing into?", and the
#   composition gives that answer the least weight on the card. Inverted: the
#   DEVICE is the title, the ACTION is its eyebrow.
#
# The assertions are text-anchored to the names in the APPROVED plan
# (docs/reference/_handoff-login-execute.md), never to names invented while
# writing the fix. That is what keeps them independent of the fix: a builder who
# renames a symbol, substitutes a weaker mechanism, or quietly keeps the tinted
# mark plate fails the test, which is the point.
#
# This harness is COMMITTED RED, before the fix exists (change-workflow.md,
# Phase 4a). The builder who writes the fix does not edit this file.
#
# THE THREE VETO ANSWERS ARE ALL "YES" (recorded 2026-08-30, user)
# ----------------------------------------------------------------
#   A  the hostname becomes the h1                    -> [2] [3] [14]
#   B  the primary-container mark plate is deleted,
#      on /login/ AND on the "/" splash, together     -> [4] [5]
#   C  the login.recovery.* disclosure is built       -> [13]
# Had any been declined the corresponding assertions would not exist. They do,
# so they are load-bearing.
#
# SCOPINGS, stated openly so they are not mistaken for a weakened test
# ---------------------------------------------------------------------
#  [1][3][6][10][12] are checked against COMMENT-STRIPPED source. These files
#      carry long rationale comments that quote the very classes being retired
#      ("this heading shipped at 24px", "the old wording said..."). A comment
#      explaining why `text-2xl` was removed is documentation, not a class, and
#      failing on it would push the builder to delete the reasoning.
#  [6] "no BARE text-destructive" is `text-destructive` NOT followed by `-`, so
#      the intended `text-destructive-on-surface` passes. `ring-destructive` is
#      untouched -- the Three-Layer Rule governs INK, and the error ring is a
#      ring, already correct.
#  [12] The spinner's `[animation-duration:900ms]` is one of the two sanctioned
#      literal-duration exceptions and carries its comment. The pattern here is
#      `duration-[<digit>`, which is the Tailwind utility form and does not
#      match the arbitrary CSS property form. That is deliberate, not an
#      oversight.
#
# Run: bash scripts/test/login-card-design-language.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOGIN="$REPO_ROOT/components/auth/login-component.tsx"
DEVICE="$REPO_ROOT/components/auth/login-device-name.tsx"
PAGE="$REPO_ROOT/app/login/page.tsx"
CARD="$REPO_ROOT/components/public/overview-card.tsx"
TYPE="$REPO_ROOT/components/pre-auth-type.ts"
LOCALES="$REPO_ROOT/public/locales"

pass_count=0
fail_count=0

ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

for f in "$LOGIN" "$DEVICE" "$PAGE" "$CARD" "$TYPE"; do
    [ -f "$f" ] || { echo "expected source file not found: $f" >&2; exit 1; }
done

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

strip_comments "$LOGIN"  > "$TMPD/login.code"
strip_comments "$DEVICE" > "$TMPD/device.code"
strip_comments "$CARD"   > "$TMPD/card.code"

# -----------------------------------------------------------------------------
printf '\n[1] Type steps are IMPORTED from pre-auth-type, never restated\n'
# The two pre-auth cards are the same object seen twice. They agreed about their
# type only by convention until pre-auth-type.ts made it a module; a literal
# `text-2xl` or a raw `text-[0.8125rem]` re-forks them silently.
if grep -q '@/components/pre-auth-type' "$TMPD/login.code"; then
    ok "login-component.tsx imports from @/components/pre-auth-type"
else
    bad "login-component.tsx does not import the shared pre-auth type module"
fi
for literal in 'text-2xl' 'text-xs' 'text-\[0\.8125rem\]'; do
    if grep -q "$literal" "$TMPD/login.code"; then
        printf '       offending lines:\n'
        grep -n "$literal" "$TMPD/login.code" | sed 's/^/         /'
        bad "login-component.tsx still restates the type literal '$literal' -- use the pre-auth step"
    else
        ok "login-component.tsx contains no '$literal' literal"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[2] LoginDeviceName gains "title" and loses "sentence"\n'
# The component's own header comment sanctions the addition: "If the Overview
# wants a third form ... that is a new variant, not a redefinition of this one."
# The DELETION is the other half: once the hostname is the h1, the sentence form
# ("Enter your password to manage sdxlemur.") has no call site left, and a
# variant with no caller is dead code that still has to be reasoned about.
if grep -q '"title"' "$TMPD/device.code"; then
    ok 'login-device-name.tsx declares the "title" variant'
else
    bad 'login-device-name.tsx has no "title" variant -- the hostname cannot become the h1 without it'
fi
if grep -q '"sentence"' "$TMPD/device.code"; then
    printf '       offending lines:\n'
    grep -n '"sentence"' "$TMPD/device.code" | sed 's/^/         /'
    bad 'login-device-name.tsx still declares the "sentence" variant -- it lost its only call site'
else
    ok 'the "sentence" variant is gone'
fi
if grep -q 'variant="sentence"' "$TMPD/login.code"; then
    bad 'login-component.tsx still mounts variant="sentence"'
else
    ok 'login-component.tsx no longer mounts the sentence form'
fi
if grep -q 'variant="title"' "$TMPD/login.code"; then
    ok 'login-component.tsx mounts <LoginDeviceName variant="title" />'
else
    bad 'login-component.tsx does not mount the title variant -- Zone 1 was not re-composed'
fi
# Additive only: "/" still mounts the default form and must not be disturbed.
if grep -q '"signin"' "$TMPD/device.code"; then
    ok 'the "signin" default variant is KEPT (the Overview splash still mounts it)'
else
    bad 'the "signin" variant was deleted -- that is the Overview splash call site, a regression'
fi

# -----------------------------------------------------------------------------
printf '\n[3] The shared file drops the app-scale ink and step (findings 3 + 4)\n'
# text-sm is the APP scale; the pre-auth cards use their own. text-muted-
# foreground is the legacy shadcn ink, not the tonal role.
for literal in 'text-sm' 'text-muted-foreground'; do
    if grep -q "$literal" "$TMPD/device.code"; then
        printf '       offending lines:\n'
        grep -n "$literal" "$TMPD/device.code" | sed 's/^/         /'
        bad "login-device-name.tsx still uses '$literal' -- move to the pre-auth step / text-on-surface-variant"
    else
        ok "login-device-name.tsx contains no '$literal'"
    fi
done
if grep -q '@/components/pre-auth-type' "$TMPD/device.code"; then
    ok "login-device-name.tsx imports its steps from pre-auth-type"
else
    bad "login-device-name.tsx does not import the shared pre-auth type module"
fi

# -----------------------------------------------------------------------------
printf '\n[4] The 76px primary-container mark plate is DELETED (question B)\n'
# Measured: the mark's tail renders 1.54:1 against primary-container in dark
# mode. The mark ships bare at 48px -- no disc, no plate.
if grep -q 'bg-primary-container' "$TMPD/login.code"; then
    printf '       offending lines:\n'
    grep -n 'bg-primary-container' "$TMPD/login.code" | sed 's/^/         /'
    bad "login-component.tsx still paints the mark on bg-primary-container (1.54:1 in dark)"
else
    ok "login-component.tsx no longer paints a primary-container mark plate"
fi

# -----------------------------------------------------------------------------
printf '\n[5] The "/" splash disc follows in the SAME commit (question B, half 2)\n'
# DESIGN.md > Typography requires the pre-auth PAIR to move together, and "/"
# ships the identical disc. Leaving it would ship the same 1.54:1 on the other
# pre-auth surface and re-fork the two cards the day after pre-auth-type.ts
# joined them.
if grep -q 'bg-primary-container' "$TMPD/card.code"; then
    printf '       offending lines:\n'
    grep -n 'bg-primary-container' "$TMPD/card.code" | sed 's/^/         /'
    bad "overview-card.tsx still paints the mark on bg-primary-container -- the pair did not move together"
else
    ok "overview-card.tsx no longer paints a primary-container mark plate"
fi

# -----------------------------------------------------------------------------
printf '\n[6] The inline error takes the on-surface ink (Three-Layer Rule)\n'
# `text-destructive` is the CONTAINER-layer role. Ink on a plain card surface is
# `text-destructive-on-surface`, which is the token that actually clears contrast
# against --card in both themes.
if grep -q 'text-destructive-on-surface' "$TMPD/login.code"; then
    ok "login-component.tsx uses text-destructive-on-surface"
else
    bad "login-component.tsx does not use text-destructive-on-surface"
fi
if grep -qE 'text-destructive([^-]|$)' "$TMPD/login.code"; then
    printf '       offending lines:\n'
    grep -nE 'text-destructive([^-]|$)' "$TMPD/login.code" | sed 's/^/         /'
    bad "login-component.tsx still carries a BARE text-destructive -- wrong layer for ink on --card"
else
    ok "no bare text-destructive survives"
fi

# -----------------------------------------------------------------------------
printf '\n[7] The submit role morph is TOKENIZED (finding 13 -- a repair)\n'
# Today the locked/unlocked swap snaps with no transition at all, while the
# banner announcing the SAME condition eases in over 800ms. The card reports one
# event at two speeds.
if grep -q 'bg-surface-container-high text-on-surface-variant' "$TMPD/login.code"; then
    ok "the locked submit branch is still present (not refactored away)"
else
    bad "the locked submit branch is gone -- assertion 7 can no longer be evaluated"
fi
if grep -q 'transition-colors' "$TMPD/login.code"; then
    ok "login-component.tsx declares transition-colors on the submit"
else
    bad "the submit's locked/unlocked role morph has no transition-colors -- it still snaps"
fi
if [ "$(grep -c 'duration-\[var(--duration-standard)\]' "$TMPD/login.code")" -ge 2 ]; then
    ok "at least two standard-duration transitions declared (submit morph + field dim)"
else
    printf '       found: %s\n' "$(grep -c 'duration-\[var(--duration-standard)\]' "$TMPD/login.code")"
    bad "fewer than two duration-[var(--duration-standard)] transitions -- findings 13 and 14 are both repairs"
fi

# -----------------------------------------------------------------------------
printf '\n[8] The field-group dim is TOKENIZED (finding 14 -- a repair)\n'
if grep -q 'opacity-50' "$TMPD/login.code"; then
    ok "the locked field group still dims (not refactored away)"
else
    bad "the opacity-50 field-dim branch is gone -- assertion 8 can no longer be evaluated"
fi
if grep -qE 'transition-opacity[^"]*duration-\[var\(--duration-standard\)\]|duration-\[var\(--duration-standard\)\][^"]*transition-opacity' "$TMPD/login.code"; then
    ok "the field group's opacity change carries a standard-duration transition"
else
    bad "the field group's opacity-50 dim has no tokenized transition-opacity -- it still snaps"
fi

# -----------------------------------------------------------------------------
printf '\n[9] The surface gets its instrumentation (finding 12)\n'
# The card was the product's only ZERO-instrumentation surface: no container
# query, and a flat p-7 gutter that does not yield on a 375px phone.
if grep -q 'p-4' "$PAGE" && grep -q 'sm:p-7' "$PAGE"; then
    ok "app/login/page.tsx yields its gutter (p-4 sm:p-7)"
else
    bad "app/login/page.tsx does not carry the p-4 / sm:p-7 gutter step"
fi
if grep -q '@container/login' "$TMPD/login.code" || grep -q '@container/login' "$PAGE"; then
    ok "the @container/login context is declared"
else
    bad "no @container/login anywhere -- the card is still uninstrumented"
fi
if grep -q '@\[' "$TMPD/login.code"; then
    ok "login-component.tsx declares at least one container-query step"
else
    bad "login-component.tsx declares no @[...] container-query step"
fi

# -----------------------------------------------------------------------------
printf '\n[10] No middot glue character (the No-Dot-Separator Rule)\n'
# `login.brand_label` is "QManager <middot> Quectel Modem Management". The
# brand footer is replaced by the recovery disclosure, so the glue character
# leaves the render path with it. The KEY is kept -- installed language packs
# must not break -- so this is a call-site assertion, not a locale one.
if grep -q '·' "$TMPD/login.code"; then
    printf '       offending lines:\n'
    grep -n '·' "$TMPD/login.code" | sed 's/^/         /'
    bad "login-component.tsx renders a middot glue character"
else
    ok "login-component.tsx renders no middot glue character"
fi
if grep -q 'login.brand_label' "$TMPD/login.code"; then
    bad "login.brand_label still has a call site -- the brand footer survived Zone 4"
else
    ok "login.brand_label has no call site (the key itself is kept, by design)"
fi

# -----------------------------------------------------------------------------
printf '\n[11] The lockout unit is translated, not baked in (finding 8)\n'
# `${totalSeconds}s` hardcodes an English unit into a formatter whose OTHER
# branch (mm:ss) is already locale-neutral. Five locales render "28s" today.
if grep -q '${totalSeconds}s' "$TMPD/login.code"; then
    printf '       offending lines:\n'
    grep -n '${totalSeconds}s' "$TMPD/login.code" | sed 's/^/         /'
    bad 'formatLockout still bakes a literal "s" unit into the sub-minute branch'
else
    ok 'formatLockout no longer bakes a literal "s" unit'
fi
if grep -qE 'formatLockout\([^)]*t[,)]' "$TMPD/login.code"; then
    ok "formatLockout resolves its unit through t()"
else
    bad "formatLockout is not passed the translator -- the unit cannot be localized"
fi

# -----------------------------------------------------------------------------
printf '\n[12] The One-Scale Rule: no literal durations\n'
# A raw duration-200 or { duration: 0.25 } silently will not retune when
# lib/motion.ts and the --duration-* properties are retuned together.
if grep -qE 'duration-\[[0-9]' "$TMPD/login.code"; then
    printf '       offending lines:\n'
    grep -nE 'duration-\[[0-9]' "$TMPD/login.code" | sed 's/^/         /'
    bad "login-component.tsx carries a literal Tailwind duration -- it will not retune"
else
    ok "no literal duration-[<n>] utility"
fi
unguarded=$(grep -nE '\{ duration: 0\.' "$TMPD/login.code" | grep -viE 'reduce' || true)
if [ -n "$unguarded" ]; then
    printf '       offending lines:\n'
    printf '%s\n' "$unguarded" | sed 's/^/         /'
    bad "login-component.tsx carries a literal JS duration outside a reducedMotion guard"
else
    ok "no literal JS duration outside a reducedMotion guard"
fi

# -----------------------------------------------------------------------------
printf '\n[13] The recovery disclosure is BUILT, and the markup is reshaped (question C)\n'
# Four translated leaves have been shipping in all five locales with no call
# site. Rendering them is the fix; the cost is that `option_reset` embeds a
# literal <code> tag, and this repo does not render markup from translations --
# it routes styled substrings through interpolation-slot.tsx (SLOT / withSlot).
if grep -q 'login.recovery.toggle' "$TMPD/login.code"; then
    ok "login.recovery.toggle has a call site (the disclosure is mounted)"
else
    bad "login.recovery.toggle still has NO call site -- the four leaves stay unrendered"
fi
for leaf in intro option_reset option_backup; do
    if grep -q "login.recovery.$leaf" "$TMPD/login.code"; then
        ok "login.recovery.$leaf is rendered"
    else
        bad "login.recovery.$leaf has no call site"
    fi
done
for loc in en zh-CN zh-TW it id; do
    f="$LOCALES/$loc/common.json"
    [ -f "$f" ] || { bad "locale pack missing: $f"; continue; }
    if grep -q '<code>' "$f"; then
        bad "$loc/common.json still embeds a literal <code> tag -- reshape it to the SLOT form"
    else
        ok "$loc/common.json embeds no <code> markup"
    fi
done
# The new key, in all five locales. The eyebrow is what makes the visible copy
# and the sr-only line AGREE, retiring the signing_in_as / signing_in_to
# disagreement structurally rather than by picking a word.
for loc in en zh-CN zh-TW it id; do
    if grep -q 'sign_in_to_label' "$LOCALES/$loc/common.json"; then
        ok "$loc/common.json defines login.sign_in_to_label"
    else
        bad "$loc/common.json is missing login.sign_in_to_label"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[14] The zone cascade is FOUR children, not three\n'
# Identity / field / submit / recovery. The card step (120ms), not the 80ms row
# step, so the last zone lands at 360 + 600 = 960ms.
stagger_count=$(grep -c 'variants={staggerItem}' "$TMPD/login.code" || true)
if [ "$stagger_count" -eq 4 ]; then
    ok "login-component.tsx has exactly four staggerItem children"
else
    printf '       found: %s\n' "$stagger_count"
    bad "login-component.tsx has $stagger_count staggerItem children, expected 4 (identity/field/submit/recovery)"
fi

printf '\n---------------------------------------------\n'
printf 'login-card-design-language: %d passed, %d failed\n\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ]
