#!/usr/bin/env bash
# Regression harness for the /local-network settings re-authoring:
#   /local-network/ttl-settings
#   /local-network/custom-dns
#   /local-network/ip-passthrough
#
# WHY THIS EXISTS
# ----------------
# These three pages are forms wearing a page. Each one opens with the fields you
# can WRITE; none of them opens with what is in force on the interface RIGHT NOW.
#
# That ordering is backwards for this product specifically. QManager runs on the
# modem it is reconfiguring, and TTL, MTU, DNS and passthrough all change how the
# user's own session routes. "What is true right now" is the first question on
# all three surfaces, and today it is:
#
#   * buried inside the form  -- Custom DNS puts the live upstream in a MetaPanel
#                               BELOW the enable switch
#   * implied by a pre-filled input -- TTL and MTU
#   * entirely absent         -- IP Passthrough shows no live state at all
#
# Target: page header + Refresh pill -> Band A (live read-only tiles) -> Band B
# (write cards). The same grammar /local-network/ethernet landed on (2511953) and
# /local-network/traffic-engine (0fdfc65). Colour on the reading, neutral tile
# bodies, colour on the 52px disc only.
#
# THE SEVENTEEN FINDINGS, and which assertion pins each
# ------------------------------------------------------
#   01 112 user-visible strings, 109 of them hardcoded English.
#      ip-passthrough-card.tsx imports useTranslation ZERO times    -> [12] [13]
#   02 `blockCorrupt` crosses the wire and dies at the hook. Its own
#      JSDoc promises a recovery action that has no call site       -> [14]
#   03 `clearSettings` is implemented and exported; a tree-wide grep
#      returns the hook and nothing else                            -> [14]
#   04 dnsmasq's per-resolver rejection reason (`fieldError`) is
#      destructured at custom-dns-card.tsx:89 and never rendered    -> [14]
#   05 "does this survive a reboot?" (`autostart`) is fetched,
#      typed, and never shown                                       -> [14]
#   06 TTL and MTU cannot retry a failed read -- both hooks export
#      `refresh`, neither card destructures it                      -> [14]
#   07 the error band is a duplicated opacity wash:
#      `border-destructive/50 bg-destructive/10` in two files       -> [9]
#   08 Custom DNS runs a private motion scale
#      (REVEAL_EASE, REVEAL_DURATION = 0.2)                         -> [7]
#   09 TTL & MTU has no motion at all -- no staggerContainer        -> [7]
#   10 all five cards are the raw primitive: card.tsx ships
#      `rounded-xl border shadow-sm` and every card takes it        -> [5]
#   11 every Select renders 36px against a 42px system --
#      select.tsx:40's `data-[size=default]:h-9` wins at (0,2,0)    -> [6]
#   12 no skeleton mirrors its loaded shape                         -> [4]
#   13 there is no shapes.ts -- geometry is restated inline         -> [0] [1]
#   14 legacy radii (rounded-md x4) and retired inks
#      (text-muted-foreground x9)                                   -> [8]
#   15 two of three pages carry NO status indicator at all          -> [1] [10]
#   16 the riskiest sentence on the surface -- "the device's local
#      gateway will no longer be reachable" -- exists only INSIDE
#      the confirm dialog, visible after Apply is pressed           -> [15]
#   17 the TTL save has a silent no-op:
#      `if (isEnabled && ttl === 0 && hl === 0) return;`            -> [15]
#
# THE TWO VETO ANSWERS ARE BOTH "AS PROPOSED" (recorded 2026-08-31, user)
# ------------------------------------------------------------------------
#   A  IP Passthrough is IN SCOPE, and its reboot warning moves out of the
#      confirm dialog onto the control. The DIALOG STAYS -- a reboot is a
#      deferred, deliberate act. What changes is that the consequence is
#      readable BEFORE deciding, not after.                         -> [15]
#   B  Findings 2, 3 and 4 get fixed, which means touching
#      hooks/use-custom-dns.ts to surface a field it drops.          -> [14]
# Had either been declined the corresponding assertions would not exist. They
# do, so they are load-bearing.
#
# CORRECTIONS TO THE APPROVED ARTIFACT, recorded rather than quietly applied
# ---------------------------------------------------------------------------
#  * The artifact says of the retired error band: "TonalBanner exists for this."
#    It does not, for THIS route. components/ui/tonal-banner.tsx takes
#    `icon: MaterialSymbolName`, and /local-network/ is a LUCIDE route
#    (docs/reference/icon-system.md). Following the artifact literally would
#    import Material Symbols onto a lucide route. [11] bans it. The two shipped
#    references each solve it without TonalBanner and they are NOT
#    interchangeable:
#       - a failed read INSIDE the tile grid -> ethernet's NoticeTile spanning
#         the grid via NOTICE_SPAN
#       - a notice that REPLACES the write surface -> traffic-engine's page-level
#         lucide components/ui/banner.tsx
#  * The artifact counts 92 hardcoded strings. The census counts 112 literals,
#    3 already wrapped, 109 hardcoded. The re-author also ADDS strings the old
#    pages never had (tile eyebrows, value and caption variants, a required
#    consequence sentence per row, band labels, notice bodies), so the true new
#    key count is 160-200. [13] asserts five-locale PARITY, not a key count --
#    parity is the property that matters and a count would rot.
#  * The artifact describes Traffic Engine as "in flight, worktree open". It has
#    LANDED: 3338d48 / 0fdfc65 / 5f9d51b are all ancestors of this branch's base
#    and `git worktree list` shows only the main checkout. It is a second
#    reference implementation, not a collision risk. It still gets zero edits.
#
# The assertions are text-anchored to names from the APPROVED artifact and the
# approved plan, never to names invented while writing the fix. A builder who
# renames a symbol, substitutes a weaker mechanism, or quietly keeps a tinted
# tile body fails the test, which is the entire point.
#
# This harness is COMMITTED RED, before the fix exists (change-workflow.md,
# Phase 4a). The builder who writes the fix does not edit this file.
#
# SCOPINGS, stated openly so they are not mistaken for a weakened test
# ---------------------------------------------------------------------
#  [1]..[11] run against COMMENT-STRIPPED source. A shapes.ts carries the
#      reasoning for every value in its JSDoc, and that reasoning necessarily
#      quotes the classes being retired ("this was `bg-destructive/10`").
#      Failing on a comment would push the author to delete the rationale,
#      which is the most valuable half of a shapes module.
#  [12] the retired-literal ban is scoped to the COMPONENT and PAGE files only.
#      "Custom DNS", "TTL and MTU Settings" and friends will legitimately appear
#      as VALUES in public/locales/en/common.json after this change. Asserting
#      their global absence would make a correct fix fail.
#  [10] bans `variant="outline"` on a BADGE only. Both current hits
#      (custom-dns-card.tsx:626, ip-passthrough-card.tsx:462) are icon-only
#      reset BUTTONS, which is legitimate. A blanket ban fails correct code.
#      `Badge variant="muted"` is the correct muted status role and is
#      deliberately absent from the banned list.
#  [13] resolves keys under the ttlMtu / customDns / ipPassthrough roots of
#      common.json in all five shipped locales. sidebar.json is NOT checked for
#      new keys: all three routes are already keyed and translated there at
#      lines 31-33 in every locale, and re-declaring them would duplicate the
#      nav strings.
#
# Run: bash scripts/test/local-network-settings-design-language.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

TTL_DIR="$REPO_ROOT/components/local-network/ttl-mtu-settings"
DNS_DIR="$REPO_ROOT/components/local-network/custom-dns"
IPT_DIR="$REPO_ROOT/components/local-network/ip-passthrough"

TTL_SHAPES="$TTL_DIR/shapes.ts"
DNS_SHAPES="$DNS_DIR/shapes.ts"
IPT_SHAPES="$IPT_DIR/shapes.ts"

TTL_SHELL="$TTL_DIR/ttl-settings.tsx"
DNS_SHELL="$DNS_DIR/custom-dns.tsx"
IPT_SHELL="$IPT_DIR/ip-passthrough.tsx"

TTL_CARD="$TTL_DIR/ttl-settings-card.tsx"
MTU_CARD="$TTL_DIR/mtu-settings-card.tsx"
DNS_CARD="$DNS_DIR/custom-dns-card.tsx"
IPT_CARD="$IPT_DIR/ip-passthrough-card.tsx"

DNS_HOOK="$REPO_ROOT/hooks/use-custom-dns.ts"

PAGE_TTL="$REPO_ROOT/app/local-network/ttl-settings/page.tsx"
PAGE_DNS="$REPO_ROOT/app/local-network/custom-dns/page.tsx"
PAGE_IPT="$REPO_ROOT/app/local-network/ip-passthrough/page.tsx"

LOCALES="$REPO_ROOT/public/locales"

pass_count=0
fail_count=0

ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

show() { printf '       offending lines:\n'; printf '%s\n' "$1" | sed 's/^/         /'; }

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

# Strip //-to-EOL, /* */ and {/* */} comments so a prose mention of a retired
# class cannot fail an assertion about rendered code.
strip_comments() {
    awk '
        {
            line = $0; out = ""; i = 1; n = length(line)
            while (i <= n) {
                c = substr(line, i, 2)
                if (inblock) {
                    if (c == "*/") { inblock = 0; i += 2 } else { i++ }
                    continue
                }
                if (c == "/*") { inblock = 1; i += 2; continue }
                if (c == "//") { break }
                out = out substr(line, i, 1); i++
            }
            print out
        }
    ' "$1"
}

# Every opening tag of $2 in file $1, flattened to one line each, so a
# multi-line JSX element can be tested as a single string.
open_tags() {
    tr '\n' ' ' < "$1" | grep -oE "<$2[^>]*>" || true
}

: > "$TMPD/empty.code"
emit() { # emit <name> <path>
    if [ -f "$2" ]; then strip_comments "$2" > "$TMPD/$1.code"
    else cp "$TMPD/empty.code" "$TMPD/$1.code"; fi
}

emit ttlshapes "$TTL_SHAPES"; emit dnsshapes "$DNS_SHAPES"; emit iptshapes "$IPT_SHAPES"
emit ttlshell  "$TTL_SHELL";  emit dnsshell  "$DNS_SHELL";  emit iptshell  "$IPT_SHELL"
emit ttlcard   "$TTL_CARD";   emit mtucard   "$MTU_CARD"
emit dnscard   "$DNS_CARD";   emit iptcard   "$IPT_CARD"
emit dnshook   "$DNS_HOOK"

# Every source file actually present in the three families, comment-stripped.
# Used by the bans so a leftover file cannot smuggle a retired idiom past a
# fixed file list.
: > "$TMPD/family.code"
for d in "$TTL_DIR" "$DNS_DIR" "$IPT_DIR"; do
    [ -d "$d" ] || continue
    for f in "$d"/*.tsx "$d"/*.ts; do
        [ -f "$f" ] || continue
        strip_comments "$f" >> "$TMPD/family.code"
    done
done
for p in "$PAGE_TTL" "$PAGE_DNS" "$PAGE_IPT"; do
    [ -f "$p" ] && strip_comments "$p" >> "$TMPD/family.code"
done

# Entity-normalised copy, for the retired-literal ban ONLY.
# JSX writes `TTL &amp; Hop Limit Configuration`, so a grep -F for the literal
# "TTL & Hop Limit Configuration" silently MISSES it and the assertion passes
# against unfixed code. That false pass was live in the first draft of this
# harness and is exactly the failure mode Phase 4a exists to catch: an assertion
# that agrees with whatever it is pointed at.
sed -e 's/&amp;/\&/g' -e "s/&apos;/'/g" -e 's/&quot;/"/g' -e 's/&mdash;/--/g' \
    -e 's/&ndash;/-/g' -e 's/&nbsp;/ /g' "$TMPD/family.code" > "$TMPD/family.text"

# -----------------------------------------------------------------------------
printf '\n[0] Each family owns a shapes module, and the shells exist\n'
# Finding 13. Nothing in these families shares geometry today, so it is
# restated: the identical page grid appears in ttl-settings.tsx:14 and
# ip-passthrough.tsx:15, and the identical `text-3xl font-bold mb-2` header in
# three files.
#
# custom-dns.tsx is NEW. TTL and IPPT already delegate their whole page body to
# a shell component; Custom DNS inlines its header in app/.../page.tsx, which is
# a server component and therefore cannot own the motion cascade [7] requires.
# All three routes end up structurally identical: page.tsx re-exports a shell.
for f in "$TTL_SHAPES" "$DNS_SHAPES" "$IPT_SHAPES" \
         "$TTL_SHELL" "$DNS_SHELL" "$IPT_SHELL" \
         "$TTL_CARD" "$MTU_CARD" "$DNS_CARD" "$IPT_CARD"; do
    if [ -f "$f" ]; then ok "exists: ${f#"$REPO_ROOT/"}"
    else bad "missing: ${f#"$REPO_ROOT/"}"; fi
done

# The page files must be thin: no inline header markup left behind in app/.
hdr=$(grep -nE 'text-3xl font-bold mb-2' "$PAGE_DNS" "$PAGE_TTL" "$PAGE_IPT" 2>/dev/null || true)
if [ -n "$hdr" ]; then
    show "$hdr"
    bad "a page file still carries the retired inline header markup"
else
    ok "no retired inline page header in app/local-network/*/page.tsx"
fi

# -----------------------------------------------------------------------------
printf '\n[1] Each shapes.ts exports the contract the approved plan names\n'
# These are the names from the approved plan, not names invented while writing
# the fix -- which is what makes the assertion independent of it.
# STATE_BADGE is what pins finding 15: two of three pages carry no status
# indicator at all, and a tone map keyed onto BadgeVariant is how the third one
# stays correct by construction rather than by reviewer discipline.
for pair in "ttlshapes:ttl-mtu-settings" "dnsshapes:custom-dns" "iptshapes:ip-passthrough"; do
    name="${pair%%:*}"; label="${pair#*:}"
    for sym in PAGE_ROOT PAGE_HEAD PILL_ACTION BAND TILE DISC_TONE NOTICE_SPAN \
               CARD_SHELL CARD_PAD CARD_TITLE ROW_GROUP ROW FIELD DELTA \
               PROVENANCE STATE_BADGE; do
        if grep -qE "^export (const|type) ${sym}\b" "$TMPD/$name.code"; then
            ok "$label/shapes.ts exports ${sym}"
        else
            bad "$label/shapes.ts does not export ${sym}"
        fi
    done
done

# The tone maps must key onto the exported BadgeVariant type, never onto a class
# string, so a new tone without a matching role fails the build (CLAUDE.md).
for pair in "ttlshapes:ttl-mtu-settings" "dnsshapes:custom-dns" "iptshapes:ip-passthrough"; do
    name="${pair%%:*}"; label="${pair#*:}"
    if grep -qE 'BadgeVariant' "$TMPD/$name.code"; then
        ok "$label/shapes.ts keys STATE_BADGE onto BadgeVariant"
    else
        bad "$label/shapes.ts does not reference BadgeVariant -- a tone map onto a class string is not compiler-enforced"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[2] Geometry is restated per family, never imported across one\n'
# DESIGN.md > Layout: geometry is restated across sibling families, never
# imported from one; anything genuinely family-wide is promoted one level up.
# Both shipped shapes modules carry this rule in their own headers.
cross=$(grep -rnE 'from "@/components/cellular/' --include='*.tsx' --include='*.ts' \
        "$TTL_DIR" "$DNS_DIR" "$IPT_DIR" 2>/dev/null || true)
if [ -n "$cross" ]; then
    show "$cross"
    bad "a family imports from components/cellular/ -- restate the geometry instead"
else
    ok "no import from components/cellular/"
fi

sibling=$(grep -rnE 'from "@/components/local-network/(ethernet|traffic-engine)/shapes"' \
          --include='*.tsx' --include='*.ts' "$TTL_DIR" "$DNS_DIR" "$IPT_DIR" 2>/dev/null || true)
if [ -n "$sibling" ]; then
    show "$sibling"
    bad "a family imports a sibling family's shapes.ts -- restate, do not share"
else
    ok "no cross-family shapes import"
fi

# Traffic Engine is OUT OF SCOPE and landed at 0fdfc65. Nothing here may reach
# into it, and this harness must not be the thing that edits it.
te=$(grep -rnE 'components/local-network/traffic-engine' \
     --include='*.tsx' --include='*.ts' "$TTL_DIR" "$DNS_DIR" "$IPT_DIR" 2>/dev/null || true)
if [ -n "$te" ]; then
    show "$te"
    bad "a family reaches into components/local-network/traffic-engine -- out of scope"
else
    ok "traffic-engine untouched by these families"
fi

# -----------------------------------------------------------------------------
printf '\n[3] The tile is PINNED, neutral-bodied, and carries a 52px disc\n'
# The canon's tile is 104px PINNED (h-[6.5rem]) with a 52px disc
# (size-[3.25rem]) on a NEUTRAL body. A min-h- is a floor, not a pin, and a
# floor cannot be mirrored by a skeleton -- which is exactly why [4] can only
# work if this one holds.
for pair in "ttlshapes:ttl-mtu-settings" "dnsshapes:custom-dns" "iptshapes:ip-passthrough"; do
    name="${pair%%:*}"; label="${pair#*:}"
    tile_block=$(awk '/^export const TILE = \{/,/^\} as const;/' "$TMPD/$name.code")
    if [ -z "$tile_block" ]; then
        bad "$label: no TILE block to check"
        continue
    fi
    if printf '%s\n' "$tile_block" | grep -qE 'h-\[6\.5rem\]'; then
        ok "$label: TILE pins the 104px height (h-[6.5rem])"
    else
        bad "$label: TILE does not pin h-[6.5rem]"
    fi
    if printf '%s\n' "$tile_block" | grep -qE 'min-h-'; then
        show "$(printf '%s\n' "$tile_block" | grep -nE 'min-h-')"
        bad "$label: TILE uses a min-h- floor where the canon pins the height"
    else
        ok "$label: TILE carries no min-h- floor"
    fi
    if printf '%s\n' "$tile_block" | grep -qE 'size-\[3\.25rem\]'; then
        ok "$label: TILE carries the 52px disc"
    else
        bad "$label: TILE has no size-[3.25rem] disc"
    fi
    # The tile BODY is bg-surface-container on every tile, with no tone prop.
    # Colour survives only on the disc.
    if printf '%s\n' "$tile_block" | grep -qE 'bg-surface-container\b'; then
        ok "$label: TILE body is bg-surface-container"
    else
        bad "$label: TILE body is not bg-surface-container -- colour belongs on the disc"
    fi
    roleful=$(printf '%s\n' "$tile_block" | grep -nE '(bg|text)-(on-)?(success|warning|destructive|info|primary|lte|uplink|downlink|spatial)(-container)?' || true)
    if [ -n "$roleful" ]; then
        show "$roleful"
        bad "$label: a role colour survives on the TILE body -- it belongs on the 52px disc"
    else
        ok "$label: no role colour on the TILE body"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[4] The skeleton mirrors the loaded geometry by IMPORTING the height\n'
# Finding 12. ttl-settings-card.tsx promises `h-8 w-48` plus two `h-10`; the
# loaded form is a switch row, two 42px fields and a 42px button.
# custom-dns-card.tsx:319-340 promises `h-[68px]` and four `h-9` boxes -- not
# one of which is a height this system ships.
# The rule (CLAUDE.md): skeletons mirror the loaded geometry by importing the
# same shape constant, never by restating numbers.
for pair in "ttlshapes:ttl-mtu-settings:$TTL_DIR" "dnsshapes:custom-dns:$DNS_DIR" "iptshapes:ip-passthrough:$IPT_DIR"; do
    name="${pair%%:*}"; rest="${pair#*:}"; label="${rest%%:*}"; dir="${rest#*:}"
    if grep -qE '^\s*HEIGHT:' "$TMPD/$name.code"; then
        ok "$label/shapes.ts exports TILE.HEIGHT"
    else
        bad "$label/shapes.ts has no TILE.HEIGHT for a skeleton to mirror"
    fi
    # A component -- not shapes.ts itself -- must reference it.
    ref=$(grep -rlE 'TILE\.HEIGHT' --include='*.tsx' "$dir" 2>/dev/null || true)
    if [ -n "$ref" ]; then
        ok "$label: a component mirrors TILE.HEIGHT"
    else
        bad "$label: no component references TILE.HEIGHT -- the skeleton restates its own numbers"
    fi
done

# The specific retired skeleton heights must be gone.
sk=$(grep -nE 'h-\[68px\]|className="h-9|h-8 w-48' "$TMPD/family.code" || true)
if [ -n "$sk" ]; then
    show "$sk"
    bad "a retired skeleton height survives (h-[68px] / h-9 / h-8 w-48)"
else
    ok "no retired skeleton heights"
fi

# -----------------------------------------------------------------------------
printf '\n[5] Cards are peers: rounded-card, border-0, whisper -- with the bang\n'
# Finding 10. card.tsx:10 ships `rounded-xl border shadow-sm` and every card on
# these pages takes it unmodified -- 12px radius, a hairline, and a shadow
# outside the vocabulary, on a system whose card role is 36px / border-0 /
# --shadow-whisper.
#
# THE MEASURED COLLISION: cn() reads an arbitrary `shadow-[...]` as a shadow
# COLOUR, so card.tsx's own `shadow-sm` SURVIVES the merge and wins on name
# sort. The whisper needs the important-mark or the card ships shadow-sm while
# the source says otherwise.
for pair in "ttlshapes:ttl-mtu-settings" "dnsshapes:custom-dns" "iptshapes:ip-passthrough"; do
    name="${pair%%:*}"; label="${pair#*:}"
    shell_line=$(grep -E '^export const CARD_SHELL' "$TMPD/$name.code" || true)
    if [ -z "$shell_line" ]; then
        bad "$label: no CARD_SHELL to check"
        continue
    fi
    for want in 'rounded-card' 'border-0'; do
        if printf '%s' "$shell_line" | grep -qF "$want"; then
            ok "$label: CARD_SHELL carries $want"
        else
            bad "$label: CARD_SHELL is missing $want"
        fi
    done
    if printf '%s' "$shell_line" | grep -qF 'shadow-[var(--shadow-whisper)]!'; then
        ok "$label: CARD_SHELL important-marks the whisper (beats card.tsx shadow-sm)"
    else
        bad "$label: CARD_SHELL does not carry shadow-[var(--shadow-whisper)]! -- cn() will let shadow-sm win"
    fi
done

# Every <Card> call site routes through CARD_SHELL. A bare <Card> is the raw
# primitive, which is finding 10 restated.
for pair in "$TTL_CARD:ttl-settings-card" "$MTU_CARD:mtu-settings-card" \
            "$DNS_CARD:custom-dns-card" "$IPT_CARD:ip-passthrough-card"; do
    path="${pair%%:*}"; label="${pair#*:}"
    [ -f "$path" ] || { bad "$label: file missing, cannot check Card call sites"; continue; }
    bare=0
    while IFS= read -r tag; do
        [ -z "$tag" ] && continue
        printf '%s' "$tag" | grep -qF 'CARD_SHELL' || bare=$((bare + 1))
    done <<< "$(open_tags "$path" 'Card')"
    if [ "$bare" -gt 0 ]; then
        bad "$label: $bare <Card> call site(s) do not use CARD_SHELL"
    else
        ok "$label: every <Card> routes through CARD_SHELL"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[6] Controls are 42px pills -- and the Select collision is defeated\n'
# Finding 11. select.tsx:40 ships `data-[size=default]:h-9` at specificity
# (0,2,0). A bare h-[2.625rem] is (0,1,0) and LOSES, rendering 36px on a 42px
# system. The ethernet pass measured exactly this at
# getBoundingClientRect().height === 36.
#
# Same for its `dark:bg-input/30`: write the dark half AND important-mark it,
# because once BOTH are dark:-prefixed they tie and alphabetical emission order
# decides which one ships.
for pair in "ttlshapes:ttl-mtu-settings" "dnsshapes:custom-dns" "iptshapes:ip-passthrough"; do
    name="${pair%%:*}"; label="${pair#*:}"
    field=$(awk '/^(export )?const FIELD(_BOX)? /,/;/' "$TMPD/$name.code")
    if [ -z "$field" ]; then
        bad "$label: no FIELD to check"
        continue
    fi
    if printf '%s\n' "$field" | grep -qF 'h-[2.625rem]!'; then
        ok "$label: FIELD important-marks the 42px height"
    else
        bad "$label: FIELD does not carry h-[2.625rem]! -- select.tsx's data-[size=default]:h-9 wins at (0,2,0)"
    fi
    if printf '%s\n' "$field" | grep -qE 'dark:bg-[a-z-]+!'; then
        ok "$label: FIELD important-marks its dark fill"
    else
        bad "$label: FIELD has no important-marked dark: fill -- ties with dark:bg-input/30 and emission order decides"
    fi
    if printf '%s\n' "$field" | grep -qF 'rounded-pill'; then
        ok "$label: FIELD is a pill"
    else
        bad "$label: FIELD is not rounded-pill"
    fi
done

# Every SelectTrigger call site carries the shaped FIELD, not the bare primitive.
if [ -f "$IPT_CARD" ]; then
    bare=0; total=0
    while IFS= read -r tag; do
        [ -z "$tag" ] && continue
        total=$((total + 1))
        printf '%s' "$tag" | grep -qF 'FIELD' || bare=$((bare + 1))
    done <<< "$(open_tags "$IPT_CARD" 'SelectTrigger')"
    if [ "$total" -eq 0 ]; then
        bad "ip-passthrough-card: no SelectTrigger found -- the five selects are the surface"
    elif [ "$bare" -gt 0 ]; then
        bad "ip-passthrough-card: $bare of $total SelectTrigger call sites are the bare 36px primitive"
    else
        ok "ip-passthrough-card: all $total SelectTrigger call sites carry FIELD"
    fi
else
    bad "ip-passthrough-card missing, cannot check SelectTrigger heights"
fi

# -----------------------------------------------------------------------------
printf '\n[7] Motion: one scale, from lib/motion, on every shell\n'
# Findings 8 and 9. custom-dns-card.tsx:75-76 runs a private scale
# (REVEAL_EASE = [0.16, 1, 0.3, 1], REVEAL_DURATION = 0.2). The shipped scale is
# 360/600/800 with two eases in lib/motion.ts; 200ms is on neither, and a retune
# of the token layer will not reach it. TTL & MTU has NO motion at all.
for pair in "ttlshell:ttl-mtu-settings" "dnsshell:custom-dns" "iptshell:ip-passthrough"; do
    name="${pair%%:*}"; label="${pair#*:}"
    if grep -qE 'staggerContainer' "$TMPD/$name.code"; then
        ok "$label shell uses staggerContainer"
    else
        bad "$label shell has no staggerContainer -- the page snaps in"
    fi
    if grep -qE 'staggerItem' "$TMPD/$name.code"; then
        ok "$label shell uses staggerItem"
    else
        bad "$label shell has no staggerItem children"
    fi
    if grep -qE 'from "@/lib/motion"' "$TMPD/$name.code"; then
        ok "$label shell imports the shared scale"
    else
        bad "$label shell does not import from @/lib/motion"
    fi
done

for sym in REVEAL_DURATION REVEAL_EASE; do
    hit=$(grep -nE "\b${sym}\b" "$TMPD/family.code" || true)
    if [ -n "$hit" ]; then
        show "$hit"
        bad "the private motion constant ${sym} survives"
    else
        ok "${sym} is gone"
    fi
done

# A raw duration utility silently will not retune when the token layer moves.
rawdur=$(grep -nE 'duration-(50|75|100|150|200|300|500|700|1000)\b|transition-all\b' "$TMPD/family.code" || true)
if [ -n "$rawdur" ]; then
    show "$rawdur"
    bad "a raw Tailwind duration / transition-all survives -- it will not retune"
else
    ok "no raw duration utility or transition-all"
fi

# THE TAILWIND V4 TRAP: there is no --duration-* theme namespace, so
# `duration-[--duration-standard]` is INVALID CSS. The declaration is dropped
# and the transition never runs -- but the class IS generated, so grepping the
# class name finds it and tsc/eslint/build/detector all pass. Only the emitted
# VALUE tells. `duration-[var(--duration-standard)]` is the correct spelling.
barevar=$(grep -nE 'duration-\[--' "$TMPD/family.code" || true)
if [ -n "$barevar" ]; then
    show "$barevar"
    bad "duration-[--...] is invalid CSS in Tailwind v4 -- use duration-[var(--...)]"
else
    ok "no bare-var duration arbitrary"
fi

# A bare numeric duration in a motion/react transition is off the scale too.
numdur=$(grep -nE 'duration:\s*0?\.[0-9]+|duration:\s*[0-9]+\b' "$TMPD/family.code" | grep -vE 'DUR\.' || true)
if [ -n "$numdur" ]; then
    show "$numdur"
    bad "a numeric duration literal survives outside lib/motion"
else
    ok "every duration comes from lib/motion"
fi

# -----------------------------------------------------------------------------
printf '\n[8] Legacy radii and retired inks are gone\n'
# Finding 14. rounded-md at four sites across two cards; text-muted-foreground
# at nine sites where the system's ink is on-surface-variant.
radii=$(grep -nE 'rounded-(sm|md|lg|xl)\b' "$TMPD/family.code" || true)
if [ -n "$radii" ]; then
    show "$radii"
    bad "a legacy radius survives -- the role scale is inline/field/tile/card/hero/pill"
else
    ok "no legacy rounded-(sm|md|lg|xl)"
fi

ink=$(grep -nE 'text-muted-foreground\b' "$TMPD/family.code" || true)
if [ -n "$ink" ]; then
    show "$ink"
    bad "text-muted-foreground survives -- the system's ink is on-surface-variant"
else
    ok "no text-muted-foreground"
fi

# -----------------------------------------------------------------------------
printf '\n[9] No alpha wash on a role colour, no hairline on a fill\n'
# Finding 7. `border-destructive/50 bg-destructive/10 ... text-destructive`
# appears VERBATIM in exactly two files -- custom-dns-card.tsx:414 and
# ip-passthrough-card.tsx:252. An alpha wash on a role colour AND a hairline on
# a fill, both retired. An alpha is a request to whatever happens to be behind
# it rather than to the token, so it renders a different colour on a card than
# on a popover.
wash=$(grep -nE '(bg|border|text)-(success|warning|destructive|info|primary|lte|uplink|downlink|spatial)(-container)?/[0-9]+' "$TMPD/family.code" | grep -vE 'ring-ring/50' || true)
if [ -n "$wash" ]; then
    show "$wash"
    bad "an alpha wash on a role colour survives -- use the container/ink pair"
else
    ok "no alpha wash on a role colour"
fi

# -----------------------------------------------------------------------------
printf '\n[10] The status-chip rule\n'
# Finding 15. Two of three pages carry NO status indicator: nothing on either
# says whether the setting is in force. The band header chip is what fixes it.
#
# Scoped ban: `variant="outline"` on a BADGE only. The two current hits are
# icon-only reset BUTTONS and are legitimate. `Badge variant="muted"` is the
# correct muted status role and is deliberately not banned.
badge_tags=$(printf '%s' "$(cat "$TMPD/family.code")" | tr '\n' ' ' | grep -oE '<Badge[^>]*>' || true)
outline=$(printf '%s\n' "$badge_tags" | grep -E 'variant="(outline|secondary)"' || true)
if [ -n "$outline" ]; then
    show "$outline"
    bad "a Badge does status work with variant=outline/secondary -- use the five status roles"
else
    ok "no outline/secondary Badge doing status work"
fi

# Every status chip carries a glyph. success-container and warning-container
# measure 1.03:1 apart -- the same surface to the eye, identical under
# deuteranopia -- so the glyph is the only thing separating healthy from
# degraded. A self-closing <Badge /> cannot contain one.
selfclosed=$(printf '%s\n' "$badge_tags" | grep -E '/>$' || true)
if [ -n "$selfclosed" ]; then
    show "$selfclosed"
    bad "a self-closing Badge cannot carry a glyph"
else
    ok "no self-closing Badge"
fi

# Each shell renders a band status chip -- the thing finding 15 says is absent.
for pair in "ttlshell:ttl-mtu-settings" "dnsshell:custom-dns" "iptshell:ip-passthrough"; do
    name="${pair%%:*}"; label="${pair#*:}"
    if grep -qE 'STATE_BADGE' "$TMPD/$name.code"; then
        ok "$label shell renders the band status chip"
    else
        bad "$label shell has no STATE_BADGE -- nothing says whether the setting is in force"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[11] The Icon-Boundary Rule: /local-network/ is lucide\n'
# Material Symbols owns the sidebar, /dashboard, the pre-auth routes and all of
# /cellular/. Everything else is lucide. Mixing two icon sets inside one screen
# is precisely what the rule prevents.
#
# This is also the correction to the approved artifact's finding 7: TonalBanner
# takes `icon: MaterialSymbolName`, so reaching for it here would import
# Material Symbols onto a lucide route.
mat=$(grep -nE 'MaterialSymbol|material-symbol|TonalBanner|tonal-banner' "$TMPD/family.code" || true)
if [ -n "$mat" ]; then
    show "$mat"
    bad "a Material Symbol (or TonalBanner, which requires one) survives on a lucide route"
else
    ok "no Material Symbol on this route"
fi

# The failed read is ONE spanning notice, not N identical shimmering tiles.
# A skeleton is a promise that data is coming; holding one over a dead poll is a
# misstatement. All three pages currently ship a skeleton and nothing else.
for pair in "ttlshapes:ttl-mtu-settings:$TTL_DIR" "dnsshapes:custom-dns:$DNS_DIR" "iptshapes:ip-passthrough:$IPT_DIR"; do
    name="${pair%%:*}"; rest="${pair#*:}"; label="${rest%%:*}"; dir="${rest#*:}"
    if grep -qE '^export const NOTICE_SPAN' "$TMPD/$name.code"; then
        ok "$label/shapes.ts exports NOTICE_SPAN"
    else
        bad "$label/shapes.ts has no NOTICE_SPAN -- a failed read would repeat one message N times"
    fi
    ref=$(grep -rlE 'NOTICE_SPAN' --include='*.tsx' "$dir" 2>/dev/null || true)
    if [ -n "$ref" ]; then
        ok "$label: a component renders the spanning notice"
    else
        bad "$label: NOTICE_SPAN has no call site"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[12] i18n: useTranslation everywhere, and the retired literals are gone\n'
# Finding 1. 112 user-visible strings, 3 wrapped, 109 hardcoded.
# ip-passthrough-card.tsx imports useTranslation ZERO times -- all 47 of its
# strings are literals, and its SaveButton is called with no `label` prop at
# all, unlike its three siblings. sidebar.json:31-33 already keys all three
# routes, so the nav is translated and the destination is not.
for pair in "ttlshell:ttl-settings" "dnsshell:custom-dns" "iptshell:ip-passthrough" \
            "ttlcard:ttl-settings-card" "mtucard:mtu-settings-card" \
            "dnscard:custom-dns-card" "iptcard:ip-passthrough-card"; do
    name="${pair%%:*}"; label="${pair#*:}"
    if grep -qE 'useTranslation' "$TMPD/$name.code"; then
        ok "$label imports useTranslation"
    else
        bad "$label does not import useTranslation"
    fi
done

# The specific retired literals, scoped to component + page files only. These
# will legitimately appear as VALUES in en/common.json after this change.
RETIRED_LITERALS=(
    "TTL and MTU Settings"
    "IP Passthrough Settings (IPPT)"
    "Enable Custom TTL/HL"
    "Enable Custom MTU"
    "Device Will Reboot Immediately"
    "Enter a valid MAC address"
    "Add at least one resolver"
    "Maximum Transmission Unit (MTU) Configuration"
    "TTL & Hop Limit Configuration"
    "IP Passthrough Configuration"
    "Custom Upstream DNS"
    "Apply & Reboot"
)
for lit in "${RETIRED_LITERALS[@]}"; do
    hit=$(grep -nF "$lit" "$TMPD/family.text" || true)
    if [ -n "$hit" ]; then
        show "$hit"
        bad "retired English literal survives in a component: \"$lit\""
    else
        ok "retired literal gone: \"$lit\""
    fi
done

# "Custom DNS" needs its own scoping note: it is the page title, so it must be
# gone from the COMPONENTS but present in en/common.json. Checked both ways.
hit=$(grep -nF '>Custom DNS<' "$TMPD/family.code" || true)
if [ -n "$hit" ]; then
    show "$hit"
    bad "the literal page title \"Custom DNS\" survives as a JSX text node"
else
    ok "\"Custom DNS\" is no longer a bare JSX text node"
fi

# Attribute literals are the quiet half of the problem: a hardcoded
# placeholder / aria-label is invisible to a reader scanning JSX text.
attr=$(grep -nE '(placeholder|aria-label|title)="[A-Za-z][^"]*"' "$TMPD/family.code" || true)
if [ -n "$attr" ]; then
    show "$attr"
    bad "a hardcoded attribute string survives -- placeholder/aria-label/title must be t()"
else
    ok "no hardcoded placeholder/aria-label/title"
fi

# Toasts are user-visible too and are the easiest to miss.
toast=$(grep -nE 'toast\.(success|error|info|warning)\(\s*"' "$TMPD/family.code" || true)
if [ -n "$toast" ]; then
    show "$toast"
    bad "a hardcoded toast string survives"
else
    ok "no hardcoded toast strings"
fi

# -----------------------------------------------------------------------------
printf '\n[13] i18n: all five locales agree on the three new roots\n'
# Parity is asserted, NOT a key count. The approved artifact counted 92
# hardcoded strings; the census counts 109, and the re-author ADDS strings the
# old pages never had (tile eyebrows, value and caption variants, a required
# consequence sentence per row, band labels, notice bodies). A hardcoded count
# would rot on the first copy edit. Parity does not.
node_bin=""
for c in bun node; do command -v "$c" >/dev/null 2>&1 && { node_bin="$c"; break; }; done
if [ -z "$node_bin" ]; then
    bad "neither bun nor node on PATH -- cannot resolve the locale packs"
else
    for root in ttlMtu customDns ipPassthrough; do
        for loc in en zh-CN zh-TW it id; do
            f="$LOCALES/$loc/common.json"
            if [ ! -f "$f" ]; then bad "missing locale pack: $loc/common.json"; continue; fi
            present=$("$node_bin" -e '
                const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
                const r = j[process.argv[2]];
                const n = r && typeof r === "object" ? Object.keys(r).length : 0;
                process.stdout.write(String(n));
            ' "$f" "$root" 2>/dev/null)
            if [ "${present:-0}" -gt 0 ]; then
                ok "$loc/common.json carries the $root root"
            else
                bad "$loc/common.json has no $root root"
            fi
        done
    done

    parity=$("$node_bin" -e '
        const fs = require("fs");
        const root = process.argv[1];
        const flat = (o, p = "") => Object.entries(o || {}).flatMap(([k, v]) =>
            v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]);
        const en = JSON.parse(fs.readFileSync(root + "/en/common.json", "utf8"));
        const miss = [];
        for (const blk of ["ttlMtu", "customDns", "ipPassthrough"]) {
            const want = flat(en[blk]);
            if (!want.length) { miss.push("en: " + blk + " empty"); continue; }
            for (const loc of ["zh-CN", "zh-TW", "it", "id"]) {
                const o = JSON.parse(fs.readFileSync(root + "/" + loc + "/common.json", "utf8"))[blk];
                const have = new Set(flat(o));
                const gone = want.filter((k) => !have.has(k));
                if (gone.length) miss.push(loc + "/" + blk + ": " + gone.slice(0, 6).join(", ") + (gone.length > 6 ? " (+" + (gone.length - 6) + ")" : ""));
            }
        }
        process.stdout.write(miss.join(" | "));
    ' "$LOCALES" 2>/dev/null)
    if [ -n "$parity" ]; then
        show "$parity"
        bad "the three new roots are not at parity across the five locales"
    else
        ok "ttlMtu / customDns / ipPassthrough at parity across all five locales"
    fi

    # PARITY ALONE IS GAMEABLE, and the Done bar would not catch it.
    # `i18n:check` treats an untranslated passthrough (value identical to
    # English) as a WARNING, never an error, and exits 0. So an agent mirroring
    # ~180 keys into four locales can paste the English verbatim and satisfy
    # every other gate while warnings silently climb from 12 into the hundreds.
    #
    # Checked on zh-CN and zh-TW only. Those are the two locales where an
    # English string is unambiguously untranslated; `it` and `id` legitimately
    # keep some values identical ("IP Passthrough", "MTU", "DNS"), which is why
    # the shipped passthrough allowlist exists at all.
    engpaste=$("$node_bin" -e '
        const fs = require("fs");
        const root = process.argv[1];
        const flat = (o, p = "") => Object.entries(o || {}).flatMap(([k, v]) =>
            v && typeof v === "object" ? flat(v, p + k + ".") : [[p + k, v]]);
        const en = JSON.parse(fs.readFileSync(root + "/en/common.json", "utf8"));
        const out = [];
        for (const blk of ["ttlMtu", "customDns", "ipPassthrough"]) {
            const enPairs = flat(en[blk]);
            if (!enPairs.length) continue;
            for (const loc of ["zh-CN", "zh-TW"]) {
                const o = JSON.parse(fs.readFileSync(root + "/" + loc + "/common.json", "utf8"))[blk];
                const have = new Map(flat(o));
                // A value is "pasted" when it is identical to English AND
                // contains a Latin letter -- a bare number or a token like
                // "1.1.1.1" is correctly identical in every locale.
                const same = enPairs.filter(([k, v]) =>
                    typeof v === "string" && /[A-Za-z]{3}/.test(v) && have.get(k) === v);
                if (same.length) out.push(loc + "/" + blk + ": " + same.length + " English value(s) e.g. " + same.slice(0, 3).map(([k]) => k).join(", "));
            }
        }
        process.stdout.write(out.join(" | "));
    ' "$LOCALES" 2>/dev/null)
    if [ -n "$engpaste" ]; then
        show "$engpaste"
        bad "English values were pasted into a CJK locale -- parity is met but nothing was translated"
    else
        ok "no English values pasted into zh-CN / zh-TW"
    fi

    # The locale packs are 100% CRLF and core.autocrlf=true, so `git diff` is
    # BLIND to an accidental LF conversion introduced by a naive
    # JSON.parse -> JSON.stringify round-trip. Only a byte read tells.
    for loc in en zh-CN zh-TW it id; do
        f="$LOCALES/$loc/common.json"
        [ -f "$f" ] || continue
        lone=$("$node_bin" -e '
            const b = require("fs").readFileSync(process.argv[1]);
            let lone = 0;
            for (let i = 0; i < b.length; i++)
                if (b[i] === 10 && (i === 0 || b[i - 1] !== 13)) lone++;
            process.stdout.write(String(lone));
        ' "$f" 2>/dev/null)
        if [ "${lone:-1}" -eq 0 ]; then
            ok "$loc/common.json is still pure CRLF (0 lone LF)"
        else
            bad "$loc/common.json has ${lone} lone LF -- a JSON round-trip rewrote the line endings"
        fi
    done
fi

# -----------------------------------------------------------------------------
printf '\n[14] Honesty: the capabilities the backend reports are RENDERED\n'
# Findings 2-6, and veto answer B. These are defects in honesty, not styling:
# the backend already reports all of it and the UI discards it. Fixing them
# means editing hooks/use-custom-dns.ts to surface a field it drops.

# Finding 2: custom_dns.sh:250 emits blockCorrupt; types/custom-dns.ts:38
# declares it and its JSDoc says "Frontend offers a recovery action".
# No component reads it -- so a malformed dnsmasq block renders IDENTICALLY to
# a healthy one.
#
# NO HOOK ASSERTION. `blockCorrupt?: boolean` is already on
# CustomDnsSettingsResponse (types/custom-dns.ts:38) and use-custom-dns.ts:213
# already returns `settings` verbatim, so the field is reachable TODAY without
# any hook edit. An assertion that the hook mentions it would mandate a
# redundant duplicate field and be satisfied by a dead local. What matters is
# that a COMPONENT renders it.
if grep -qE '\bblockCorrupt\b' "$TMPD/dnscard.code" || grep -qE '\bblockCorrupt\b' "$TMPD/dnsshell.code"; then
    ok "a component reads blockCorrupt"
else
    bad "no component reads blockCorrupt -- a damaged config renders as healthy"
fi
# It is rendered as a NON-BLOCKING notice (see the clearSettings ban below), so
# the lucide Banner must be present to carry it.
if grep -qE 'from "@/components/ui/banner"' "$TMPD/dnscard.code" || grep -qE 'from "@/components/ui/banner"' "$TMPD/dnsshell.code"; then
    ok "custom-dns imports the lucide Banner for the corruption notice"
else
    bad "custom-dns has no Banner -- blockCorrupt has nothing to render into"
fi

# Finding 3, INVERTED by measurement. The proposal wired clearSettings to a
# "Rebuild the block" button. The verb is DESTRUCTIVE in exactly the state that
# button would be offered:
#
#   custom_dns.sh:280-284  action=clear -> save with enabled=false
#   custom_dns.sh:139-151  strip_sentinel_block sets in_block=1 on BEGIN and
#                          clears it only on END
#
# blockCorrupt is DEFINED as one sentinel without the other (custom_dns.sh:
# 132-133). With BEGIN-without-END, in_block never returns to 0 and every
# subsequent line is dropped -- listen-address, dhcp-authoritative, conf-dir.
# `dnsmasq --test` (:405) does NOT catch it: the truncated file is syntactically
# valid, merely missing directives. Then sudo /bin/mv (:417) installs it and
# killall -HUP (:427) makes it live, on a device reached over that LAN.
#
# The proposed copy -- "Nothing outside the markers is touched" -- is the exact
# inverse of the behaviour.
#
# Compounding it, blockCorrupt has a FALSE-POSITIVE path: parse_sentinel_block
# (:116-134) uses `while IFS= read -r line`, whose body never runs for a final
# line with no trailing newline. A healthy file ending at the END marker
# returns 2. custom_dns.sh:423 deliberately chowns the file back to radio:radio
# so QCMAP can keep rewriting it.
#
# USER DECISION 2026-08-31: warn only, no button. So this assertion is a BAN.
callsite=$(grep -rnE '\bclearSettings\b' --include='*.tsx' "$DNS_DIR" 2>/dev/null || true)
if [ -n "$callsite" ]; then
    show "$callsite"
    bad "clearSettings is wired -- it destroys config outside the markers (custom_dns.sh:139-151)"
else
    ok "clearSettings stays unwired -- the destructive verb is not offered"
fi

# Finding 4: fieldError is destructured at custom-dns-card.tsx:89 and never
# rendered. The user gets a generic band where the backend supplied the reason.
#
# SCOPED BY MEASUREMENT: `field` is only ever "enabled", "ignore_carrier" or
# "servers" (custom_dns.sh:301,310,332,353,361,372) -- NEVER a row index. Six
# other failure paths carry no `field` at all. Per-row targeting would require
# string-parsing the prose message, so what is required is that the MESSAGE is
# rendered, keyed to the resolver group when field === "servers".
#
# A count >= 2 would be satisfied by `disabled={!!fieldError}` rendering
# nothing, so the assertion requires the token inside a JSX expression.
fe=$(grep -nE '\{[^}]*fieldError|fieldError\?\.message|fieldError\.message' "$TMPD/dnscard.code" || true)
if [ -n "$fe" ]; then
    ok "fieldError.message is rendered, not merely destructured"
else
    bad "fieldError is not rendered in a JSX expression -- destructured but unused"
fi

# Finding 5, INVERTED by measurement. The proposal rendered `autostart` as an
# "ON REBOOT -> Reapplied / Nothing set" tile.
#
#   ttl.sh:48-51          autostart = svc_is_enabled "$TTL_INIT"
#   platform.sh:130-133   svc_is_enabled() { [ -L "$_WANTS_DIR/$unit" ]; }
#
# That is purely "does the boot symlink exist". install_rm520n.sh:3106-3161
# globs every qmanager-*.service and qmanager-ttl is in neither the skip list
# nor UCI_GATED_SERVICES (:118), so EVERY install and EVERY OTA re-creates it.
# The field is true on every device, forever.
#
# It is also not sufficient for reapplication: the unit carries
# ConditionPathExists=/etc/qmanager/ttl_state, and ttl_state_write_persisted
# (ttl_state.sh:119-122) DELETES that file when ttl and hl are both 0. A fresh
# device is autostart:true with nothing to reapply -- the tile would read
# "Reapplied" while nothing is set.
#
# USER DECISION 2026-08-31: drop the tile. Three-tile band. So this is a BAN --
# rendering a constant as if it were a reading is worse than not showing it.
auto=$(grep -nE '\bautostart\b' "$TMPD/ttlcard.code" "$TMPD/mtucard.code" "$TMPD/ttlshell.code" || true)
if [ -n "$auto" ]; then
    show "$auto"
    bad "autostart is rendered -- it is a compile-time constant true, so the tile would be a confident lie"
else
    ok "autostart stays unrendered -- the band is three honest tiles"
fi

# Same class of defect: get_passthrough_bypass (custom_dns.sh:70-75) is a stub
# that returns the literal "false" with a TODO. Rendering it draws a constant.
pb=$(grep -nE '\bpassthroughBypass\b' "$TMPD/dnscard.code" "$TMPD/dnsshell.code" || true)
if [ -n "$pb" ]; then
    show "$pb"
    bad "passthroughBypass is rendered -- custom_dns.sh:70-75 hardcodes it to false"
else
    ok "passthroughBypass stays unrendered -- it is a stub, not a reading"
fi

# Finding 6: both hooks export refresh; neither card destructures it, so a
# failed GET leaves a permanent skeleton with no way out.
#
# CARD **OR** SHELL. The reference puts the fetch and the Refresh pill in the
# SHELL (ethernet-status.tsx:90 owns fetchStatus, :290 wires the pill;
# speed-limit-card.tsx owns no hook at all), and the TTL band needs BOTH hooks,
# which forces them up into ttl-settings.tsx. Requiring `refresh` in the cards
# specifically would FAIL a build that correctly follows the reference -- an
# assertion that fails against correct code, which is as bad as one that passes
# against broken code. Caught by the devil's advocate before any builder ran.
if grep -qE '\brefresh\b' "$TMPD/ttlshell.code"; then
    ok "the TTL shell owns refresh -- a failed read can be retried"
elif grep -qE '\brefresh\b' "$TMPD/ttlcard.code" && grep -qE '\brefresh\b' "$TMPD/mtucard.code"; then
    ok "both TTL cards destructure refresh"
else
    bad "neither the TTL shell nor both cards expose refresh -- a failed GET is a permanent skeleton"
fi

# refresh takes an argument: use-ttl-settings.ts:220 returns `refresh: fetchTtl`
# and fetchTtl is `useCallback(async (silent = false) => ...)`. `onClick={refresh}`
# passes a MouseEvent as `silent`, suppressing the loading state. The reference
# gets this right: onClick={() => fetchStatus()} (ethernet-status.tsx:290).
badwire=$(grep -nE 'onClick=\{refresh\}|onClick=\{fetch[A-Za-z]*\}' "$TMPD/family.code" || true)
if [ -n "$badwire" ]; then
    show "$badwire"
    bad "onClick={refresh} passes a MouseEvent as the silent flag -- wrap it: onClick={() => refresh()}"
else
    ok "no bare onClick={refresh} -- the silent flag is not clobbered"
fi

# The cross-page claim the design proposed is FALSE and must not ship.
# A tree-wide grep finds exactly ONE file mentioning mobileap_cfg
# (custom_dns.sh) and it only READS <DNSMode> (:58 xmlstarlet sel, :60 grep).
# docs/reference/custom-dns.md:223 documents the field as a read-time
# availability gate. Nothing in QManager can change it, so a button sending the
# user to IP Passthrough to "switch DNS mode" leads to a page with no such
# control.
xlink=$(grep -nE '/local-network/ip-passthrough' "$TMPD/dnscard.code" "$TMPD/dnsshell.code" || true)
if [ -n "$xlink" ]; then
    show "$xlink"
    bad "custom-dns links to ip-passthrough to change DNS mode -- no such control exists"
else
    ok "no false cross-page DNS-mode link"
fi

# -----------------------------------------------------------------------------
printf '\n[15] Consequence before decision, and no silent no-op\n'
# Finding 16 and veto answer A. ip-passthrough-card.tsx:491 -- "the device's
# local gateway will no longer be reachable" -- is visible only AFTER Apply is
# pressed. Product Principle 6 puts it on the control. The DIALOG STAYS; what
# changes is that the consequence is readable before deciding.
for pair in "ttlshapes:ttl-mtu-settings" "dnsshapes:custom-dns" "iptshapes:ip-passthrough"; do
    name="${pair%%:*}"; label="${pair#*:}"
    row_block=$(awk '/^export const ROW = \{/,/^\} as const;/' "$TMPD/$name.code")
    if printf '%s\n' "$row_block" | grep -qE 'CONSEQUENCE'; then
        ok "$label: ROW carries a CONSEQUENCE slot"
    else
        bad "$label: ROW has no CONSEQUENCE -- a row without one is a field, not a decision"
    fi
done

# The delta chip RESERVES its line: rendered `invisible` when clean, so
# promoting a row moves nothing. Same trade SETTING_ROW makes.
for pair in "ttlshapes:ttl-mtu-settings" "dnsshapes:custom-dns" "iptshapes:ip-passthrough"; do
    name="${pair%%:*}"; label="${pair#*:}"
    delta_block=$(awk '/^export const DELTA/,/;/' "$TMPD/$name.code")
    if printf '%s\n' "$delta_block" | grep -qE '\binvisible\b'; then
        ok "$label: DELTA reserves its line (invisible when clean)"
    else
        bad "$label: DELTA does not reserve its line -- promoting a row will shift the layout"
    fi
done

# The confirm dialog SURVIVES (veto A: a reboot is a deliberate act).
if grep -qE 'AlertDialog' "$TMPD/iptcard.code"; then
    ok "ip-passthrough keeps the reboot confirm dialog"
else
    bad "the reboot confirm dialog was removed -- veto A kept it deliberately"
fi

# THE REBOOT HANDOFF IS LOAD-BEARING AND THE DIALOG CHECK DOES NOT COVER IT.
# ip-passthrough-card.tsx:180-182 does three things in order, and cgi_base.sh:
# 216-235 returns {"success":true} immediately and then polls in a backgrounded
# subshell for /tmp/qmanager_reboot_ack before actually rebooting -- the
# /reboot/ page writes that marker on mount.
#
# The existing path is ALREADY the correct deferred-reboot contract (CLAUDE.md:
# no in-flight reboot). A re-author that keeps the dialog but drops any one of
# these three lines ships GREEN with a broken reboot: a dead page, a stale login
# cookie, or a reboot delayed to QM_REBOOT_ACK_TIMEOUT.
for tok in 'qm_rebooting' 'qm_logged_in=' '"/reboot/"'; do
    if grep -qF "$tok" "$TMPD/iptcard.code"; then
        ok "the reboot handoff keeps $tok"
    else
        bad "the reboot handoff lost $tok -- the deferred-reboot contract breaks silently"
    fi
done

# Finding 17: the silent no-op. ttl-settings-card.tsx:175 --
# `if (isEnabled && ttl === 0 && hl === 0) return;` -- the form is dirty so the
# button is live, the click does nothing, and the only feedback is a field error
# already on screen before the press.
#
# Banned in every spelling that preserves the behaviour. Anchoring to one
# literal spelling would let `!ttl && !hl` or a whitespace change pass while the
# defect survives.
noop=$(grep -nE 'ttl\s*===?\s*0\s*&&\s*hl\s*===?\s*0|hl\s*===?\s*0\s*&&\s*ttl\s*===?\s*0|!\s*ttl\s*&&\s*!\s*hl|!\s*hl\s*&&\s*!\s*ttl' "$TMPD/ttlcard.code" "$TMPD/ttlshell.code" || true)
if [ -n "$noop" ]; then
    show "$noop"
    bad "the silent no-op survives -- a live button whose click does nothing"
else
    ok "the silent no-op is gone, in every spelling"
fi

# -----------------------------------------------------------------------------
printf '\n----------------------------------------------------------------\n'
printf 'passed: %d   failed: %d\n' "$pass_count" "$fail_count"
if [ "$fail_count" -gt 0 ]; then
    printf 'RED\n'
    exit 1
fi
printf 'GREEN\n'
exit 0
