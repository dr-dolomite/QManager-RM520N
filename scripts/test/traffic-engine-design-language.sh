#!/usr/bin/env bash
# Regression harness for the /local-network/traffic-engine re-authoring.
#
# WHY THIS EXISTS
# ----------------
# The page is organised around the CONFIG FILE: an engine status card, two tabs
# named after the two config keys, a verify card, a QUIC toggle. The user
# arrives with one question -- "is my video throttled, and is the fix on?" --
# and the layout answers a different one.
#
# Two consequences are structural rather than cosmetic:
#
#   * The two modes are backend-enforced MUTUALLY EXCLUSIVE (docs/reference/
#     dpi.md > Modes), and the page draws them as tabs. Tabs say "two
#     independent panes you may browse". The exclusivity surfaces only as a
#     surprise AlertDialog at the instant a switch is flipped.
#   * Because the page has no single answer to "which mode is active", the
#     status card reads `videoOptimizer.data ?? masquerade.data` and then picks
#     its own shape from `"sni_domain" in data`. Both hooks fetch, so the Video
#     Optimizer's payload essentially always wins -- and with MASQUERADE enabled
#     the card still renders "Domains loaded", for a mode that has no domain
#     list. That is a correctness bug, not a style one.
#
# Target: a page header, a live tile strip, and a stack of peer cards ordered by
# cadence -- the same grammar /local-network/ethernet landed on 2026-08-31 and
# /cellular/settings on 2026-08-30. Colour on the reading, neutral bodies,
# colour on the 52px disc only.
#
# THE EIGHTEEN FINDINGS, and which assertion pins each
# -----------------------------------------------------
#   01 the status card can report the WRONG MODE
#      (`videoOptimizer.data ?? masquerade.data`, then branch on
#      `"sni_domain" in data`)                                     -> [5] [6]
#   02 a mutually exclusive choice is drawn as Tabs                -> [5]
#   03 `MUTED_BADGE` hand-writes a class string that reimplements
#      `Badge variant="muted"` -- which the sibling file uses      -> [7] [8]
#   04 ...and that same string is restated INLINE in a second file -> [7]
#   05 `variant="outline"` on a Badge doing status work            -> [8]
#   06 `variant="secondary"` on a Badge doing identity work        -> [8]
#   07 four pseudo-tiles: unpinned, disc-less, restated 4x         -> [3] [4]
#   08 the page skeleton restates h-40 / h-9 / h-[22rem]           -> [4]
#   09 ZERO motion -- the scale is imported by no file here        -> [9]
#   10 the page title is off the Display step (no tracking)        -> [10]
#   11 stock `Alert` where the system ships `Banner`               -> [11]
#   12 two homemade banners, one with a MUTED success glyph        -> [11]
#   13 `text-muted-foreground` x21 instead of on-surface-variant   -> [12]
#   14 viewport breakpoints (`sm:`) inside cards                   -> [13]
#   15 legacy radii in the loading path                            -> [14]
#   16 dead i18n: `trafficEngine.masquerade` is {} in all five
#      locales; `trafficEngine.status.sni` has no consumer         -> [15]
#   17 a control that cannot work simply DISAPPEARS with its tab   -> [6]
#   18 the verify result is a grey list where the canon specifies
#      comparison rows on a shared scale                           -> [16]
#
# THE THREE VETO ANSWERS ARE ALL "AS PROPOSED" (recorded 2026-08-31, user)
# -------------------------------------------------------------------------
#   A  the tabs become ONE three-way mode selector                 -> [5] [6]
#   B  the verify result becomes a shared-scale comparison graphic -> [16]
#   C  the family gets its own shapes.ts                           -> [0] [2]
# Had any been declined the corresponding assertions would not exist. They do,
# so they are load-bearing.
#
# ON CALL C's PREMISE. The proposal described this as the first shapes module
# outside components/cellular/. That was wrong -- `components/local-network/
# ethernet/shapes.ts` landed one commit earlier (2511953), so this is the
# SECOND under /local-network/ and the convention is already set. The decision
# is unaffected; the assertion is the same either way. Recorded here rather
# than quietly corrected, because the harness is the archive.
#
# The assertions are text-anchored to the names in the APPROVED artifact, never
# to names invented while writing the fix. A builder who renames a symbol,
# substitutes a weaker mechanism, or quietly keeps a tinted body fails the test,
# which is the point.
#
# This harness is COMMITTED RED, before the fix exists (change-workflow.md,
# Phase 4a). The builder who writes the fix does not edit this file.
#
# SCOPINGS, stated openly so they are not mistaken for a weakened test
# ---------------------------------------------------------------------
#  [2] [3] [7] [8] [9] [11] [12] [13] [14] run against COMMENT-STRIPPED source.
#      shapes.ts carries the reasoning for every value in its JSDoc, and that
#      reasoning necessarily quotes the classes being retired ("this was
#      `bg-muted/50`", "the retired `variant='outline'` chip"). Failing on a
#      comment would push the author to delete the rationale, which is the most
#      valuable half of a shapes module.
#  [3] bans ROLE containers on the tile constants only. `primary-container` is
#      CORRECT in exactly three places (DESIGN.md: banners, condition state
#      screens, and Highlight-by-Container) and [16] asserts the third one
#      POSITIVELY. A blanket ban would forbid the design that was approved.
#  [8] `Badge variant="muted"` is the correct muted status role and is
#      deliberately absent from the banned list. What is banned is `outline`
#      and `secondary` doing a status or identity job.
#  [15] resolves keys under the `trafficEngine` root of common.json in all five
#      shipped locales.
#
# Run: bash scripts/test/traffic-engine-design-language.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TE_DIR="$REPO_ROOT/components/local-network/traffic-engine"
SHAPES="$TE_DIR/shapes.ts"
SHELL_SRC="$TE_DIR/traffic-engine.tsx"
STRIP_SRC="$TE_DIR/live-strip.tsx"
MODE="$TE_DIR/mode-card.tsx"
TARGETS="$TE_DIR/targets-card.tsx"
VERIFY="$TE_DIR/verify-card.tsx"
FORCETCP="$TE_DIR/force-tcp-card.tsx"
ONBOARD="$TE_DIR/onboarding.tsx"
LOCALES="$REPO_ROOT/public/locales"

# The retired modules. Each is superseded by one of the files above; leaving a
# stale copy behind is how two answers to one question survive in a tree.
RETIRED=(
    "$TE_DIR/engine-status-card.tsx"
    "$TE_DIR/engine-enable-row.tsx"
    "$TE_DIR/engine-check-row.tsx"
    "$TE_DIR/cdn-hostlist-card.tsx"
    "$TE_DIR/video-optimizer-panel.tsx"
    "$TE_DIR/masquerade-panel.tsx"
    "$TE_DIR/full-bypass-panel.tsx"
    "$TE_DIR/result-alert.tsx"
    "$TE_DIR/force-tcp-tile.tsx"
    "$TE_DIR/engine-onboarding.tsx"
)

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

# -----------------------------------------------------------------------------
printf '\n[0] The family owns a shapes module, and the retired ones are gone\n'
# Findings 3, 4, 7, 8: four byte-identical class strings across two files, two
# gap values inside one card, and skeletons that restate their own numbers.
# None of it is visible in any single file, which is why it survived review.
for f in "$SHAPES" "$SHELL_SRC" "$STRIP_SRC" "$MODE" "$TARGETS" "$VERIFY" "$FORCETCP" "$ONBOARD"; do
    if [ -f "$f" ]; then ok "exists: ${f#"$REPO_ROOT/"}"
    else bad "missing: ${f#"$REPO_ROOT/"}"; fi
done
for f in "${RETIRED[@]}"; do
    if [ -f "$f" ]; then bad "retired module still present: ${f#"$REPO_ROOT/"}"
    else ok "retired: ${f#"$REPO_ROOT/"}"; fi
done

# Emit comment-stripped copies. A missing input becomes an empty file so each
# assertion reports its own FAIL -- a harness that exits early cannot show which
# half is red.
: > "$TMPD/empty.code"
for pair in "shapes:$SHAPES" "shell:$SHELL_SRC" "strip:$STRIP_SRC" "mode:$MODE" \
            "targets:$TARGETS" "verify:$VERIFY" "forcetcp:$FORCETCP" "onboard:$ONBOARD"; do
    name="${pair%%:*}"; path="${pair#*:}"
    if [ -f "$path" ]; then strip_comments "$path" > "$TMPD/$name.code"
    else cp "$TMPD/empty.code" "$TMPD/$name.code"; fi
done
cat "$TMPD/shapes.code" "$TMPD/shell.code" "$TMPD/strip.code" "$TMPD/mode.code" \
    "$TMPD/targets.code" "$TMPD/verify.code" "$TMPD/forcetcp.code" \
    "$TMPD/onboard.code" > "$TMPD/all.code"

# Every .tsx actually present in the family, comment-stripped. Used by the bans
# so a leftover file cannot smuggle a retired idiom past a fixed file list.
: > "$TMPD/family.code"
if [ -d "$TE_DIR" ]; then
    for f in "$TE_DIR"/*.tsx "$TE_DIR"/*.ts; do
        [ -f "$f" ] || continue
        strip_comments "$f" >> "$TMPD/family.code"
    done
fi

# -----------------------------------------------------------------------------
printf '\n[1] shapes.ts exports the contract the approved artifact names\n'
# Call C. These are the names from the approved plan, not names invented while
# writing the fix -- which is what makes the assertion independent of it.
for sym in PAGE_ROOT CARD_SHELL CARD_PAD CARD_TITLE TILE DISC_TONE \
           CHOICE_ROW CMP_ROW HOST_ROW FIELD ENGINE_BADGE PILL_ACTION; do
    if grep -qE "^export (const|type) ${sym}\b" "$TMPD/shapes.code"; then
        ok "shapes.ts exports ${sym}"
    else
        bad "shapes.ts does not export ${sym}"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[2] Geometry is restated here, never imported from components/cellular/\n'
# DESIGN.md > Layout: "Geometry is restated across sibling families, never
# imported from one; anything genuinely family-wide is promoted one level up."
# The ethernet family carries the same rule in CLAUDE.md's routing row.
cross=$(grep -rnE "from \"@/components/cellular/" --include='*.tsx' --include='*.ts' "$TE_DIR" 2>/dev/null || true)
if [ -n "$cross" ]; then
    show "$cross"
    bad "traffic-engine imports from components/cellular/ -- restate the geometry instead"
else
    ok "no import from components/cellular/"
fi

# -----------------------------------------------------------------------------
printf '\n[3] The tile is PINNED, neutral-bodied, and carries a 52px disc\n'
# Finding 7. The canon's tile is 104px pinned (h-[6.5rem]) with a 52px disc
# (size-[3.25rem]) on a NEUTRAL body. The current four are `p-4` blocks with no
# height at all and no disc. A min-h- is not a pin and cannot be mirrored.
if grep -qE 'h-\[6\.5rem\]' "$TMPD/shapes.code"; then
    ok "TILE pins the 104px height (h-[6.5rem])"
else
    bad "TILE does not pin h-[6.5rem] -- a floor cannot be a mirror"
fi
if grep -qE 'min-h-' "$TMPD/shapes.code"; then
    show "$(grep -nE 'min-h-' "$TMPD/shapes.code")"
    bad "shapes.ts uses a min-h- floor where the canon pins the height"
else
    ok "no min-h- floor in shapes.ts"
fi
if grep -qE 'size-\[3\.25rem\]' "$TMPD/shapes.code"; then
    ok "TILE carries the 52px glyph disc (size-[3.25rem])"
else
    bad "TILE has no 52px disc -- the disc is the only coloured element on the strip"
fi
# The tile BODY is neutral. Colour lives on DISC_TONE and nowhere else on the
# strip. Scoped to the TILE block so the three sanctioned container uses (see
# the header, and [16]) are untouched by this ban.
tile_block=$(awk '/^export const TILE = \{/,/^\} as const;/' "$TMPD/shapes.code")
if [ -z "$tile_block" ]; then
    bad "no TILE block to check for a role-container body"
else
    tinted=$(printf '%s\n' "$tile_block" | grep -nE '(bg-|text-on-)(success|warning|destructive|primary|info|downlink|uplink|lte|spatial)-container' || true)
    if [ -n "$tinted" ]; then
        show "$tinted"
        bad "a role-container fill survives on the TILE body -- neutral body, coloured disc"
    else
        ok "TILE body carries no role-container fill"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[4] Skeletons mirror by shared constant, not by restated numbers\n'
# Finding 8. `h-40`, `h-9`, `h-[22rem]` in the page skeleton, and four bare
# `h-16` against tiles that resolve far taller. The Skeleton-Mirror Rule asks
# for the same constant the loaded view reads, never an estimate.
if grep -qE '^\s*HEIGHT:' "$TMPD/shapes.code"; then
    ok "TILE exposes HEIGHT for the skeleton to mirror"
else
    bad "TILE exposes no HEIGHT -- a skeleton has nothing to mirror from"
fi
guessed=$(grep -nE '<Skeleton[^>]*className="[^"]*h-(4|8|9|10|14|16|24|32|40|64)\b' "$TMPD/family.code" || true)
guessed+=$(grep -nE '<Skeleton[^>]*className="[^"]*h-\[[0-9]' "$TMPD/family.code" || true)
if [ -n "$guessed" ]; then
    show "$guessed"
    bad "a Skeleton restates its own height instead of importing the shape constant"
else
    ok "no Skeleton restates a height literal"
fi

# -----------------------------------------------------------------------------
printf '\n[5] Call A: one mode, one source of truth -- and no Tabs\n'
# Findings 1, 2. The `??` chain is the bug: both hooks fetch, so the Video
# Optimizer payload wins and the card renders the wrong mode's shape. A single
# derived `mode` replaces it, and the Tabs go with it.
tabs=$(grep -nE 'from "@/components/ui/tabs"|<Tabs|TabsTrigger|TabsContent|TabsList' "$TMPD/family.code" || true)
if [ -n "$tabs" ]; then
    show "$tabs"
    bad "Tabs survive -- a mutually exclusive choice is not a browse"
else
    ok "no Tabs anywhere in the family"
fi
fallback=$(grep -nE 'videoOptimizer\.data \?\? *masquerade\.data|masquerade\.data \?\? *videoOptimizer\.data' "$TMPD/family.code" || true)
if [ -n "$fallback" ]; then
    show "$fallback"
    bad "the ?? fallback survives -- this is finding 01, the wrong-mode bug"
else
    ok "no ?? fallback between the two hooks' payloads"
fi
shape_sniff=$(grep -nE '"sni_domain" in |sni_domain" in data' "$TMPD/family.code" || true)
if [ -n "$shape_sniff" ]; then
    show "$shape_sniff"
    bad "the card still infers its mode by sniffing for sni_domain"
else
    ok "no mode inference by sniffing sni_domain"
fi
# The selector itself. A radiogroup, keyed on the three real states.
if grep -qE 'role="radiogroup"' "$TMPD/mode.code"; then
    ok "mode-card renders a radiogroup"
else
    bad "mode-card does not render a radiogroup -- the mutex must be visible"
fi

# -----------------------------------------------------------------------------
printf '\n[6] Call A: a control that cannot work explains why\n'
# Finding 17. Switching to Masquerade unmounts the target editor with its tab.
# The saved list still exists and applies again on switching back; the UI's only
# statement about it is its absence. The State-Honesty Rule asks for a sentence.
if grep -qE 'idle|unavailable|not_in_use|full_bypass' "$TMPD/targets.code"; then
    ok "targets-card knows about the full-bypass case"
else
    bad "targets-card has no full_bypass branch -- it can only disappear"
fi
if grep -qE 'trafficEngine\.targets\.(idle|masq)' "$TMPD/targets.code"; then
    ok "targets-card renders a translated explanation for the idle case"
else
    bad "targets-card renders no trafficEngine.targets.idle* explanation"
fi

# -----------------------------------------------------------------------------
printf '\n[7] The hand-written badge wash is extinct\n'
# Findings 3, 4. `MUTED_BADGE` reimplements `Badge variant="muted"` with an
# opacity wash, and the identical string is restated inline in a second file.
# One folder, two answers -- engine-onboarding.tsx already used the variant.
for pat in 'bg-muted/50' 'border-muted-foreground/30' 'MUTED_BADGE'; do
    hits=$(grep -nF "$pat" "$TMPD/family.code" || true)
    if [ -n "$hits" ]; then
        show "$hits"
        bad "'$pat' survives -- Badge variant=\"muted\" is the whole API"
    else
        ok "no '$pat'"
    fi
done
# The Don't-compensate-with-an-alpha rule, generally.
washes=$(grep -nE 'bg-(muted|surface[a-z-]*|primary|success|warning|destructive)[a-z-]*/[0-9]{1,2}\b' "$TMPD/family.code" || true)
if [ -n "$washes" ]; then
    show "$washes"
    bad "an opacity wash on a fill survives -- fix the pair instead"
else
    ok "no opacity wash on a fill"
fi

# -----------------------------------------------------------------------------
printf '\n[8] The Two-Form Rule: chips are status, tags are identity\n'
# Findings 5, 6. `variant="outline"` on a Badge reporting the redirect rule, and
# `variant="secondary"` on a Badge labelling the reference source.
for v in outline secondary default; do
    hits=$(grep -nE "<Badge[^>]*variant=\"${v}\"" "$TMPD/family.code" || true)
    if [ -n "$hits" ]; then
        show "$hits"
        bad "Badge variant=\"${v}\" survives -- status is a filled role, identity is a Tag"
    else
        ok "no Badge variant=\"${v}\""
    fi
done
if grep -qE 'from "@/components/ui/tag"' "$TMPD/family.code"; then
    ok "the family uses the outline Tag primitive for identity"
else
    bad "no Tag import -- identity and metadata have nowhere correct to render"
fi
# The tone map keys onto the exported type, never onto a class string, so a new
# tone without a matching role fails the build rather than rendering untinted.
if grep -qE 'Record<[^>]*, *BadgeVariant>|: *Record<DpiEngineStatus, *BadgeVariant>' "$TMPD/shapes.code"; then
    ok "ENGINE_BADGE keys onto BadgeVariant, not a class string"
else
    bad "ENGINE_BADGE does not key onto BadgeVariant -- a bad tone must fail the build"
fi

# -----------------------------------------------------------------------------
printf '\n[9] The motion scale is imported, and no duration is off it\n'
# Finding 9. No file under this family imports motion/react or lib/motion. No
# card cascade, no row cascade, no tick, and no ambient loop on an engine that
# is genuinely running.
if grep -qE 'from "@/lib/motion"' "$TMPD/family.code"; then
    ok "the family imports lib/motion"
else
    bad "no lib/motion import -- the surface is outside the One-Scale Rule by omission"
fi
if grep -qE 'staggerContainer|staggerItem' "$TMPD/family.code"; then
    ok "the card cascade uses the shared 120ms variants"
else
    bad "no card cascade -- staggerContainer/staggerItem unused"
fi
if grep -qE 'staggerRows|staggerRowItem|rowCascadeDelay' "$TMPD/family.code"; then
    ok "the row cascade uses the shared 80ms variants"
else
    bad "no row cascade -- staggerRows/staggerRowItem/rowCascadeDelay unused"
fi
# A raw duration will not retune with the scale. Tailwind's own `duration-N`
# utilities and inline framer durations are both off it.
raw=$(grep -nE 'duration-(75|100|150|200|300|500|700|1000)\b|\{ *duration: *[0-9]' "$TMPD/family.code" || true)
if [ -n "$raw" ]; then
    show "$raw"
    bad "a raw duration survives -- it will not retune with the scale"
else
    ok "no raw duration"
fi
# Tailwind v4 dropped the bare-var arbitrary -- a custom property written
# directly in the brackets with no var() wrapper compiles to an invalid
# declaration the browser drops. The class IS generated, so grepping the
# class name finds it and tsc/eslint/build all pass. Only the value tells.
barevar=$(grep -nE 'duration-\[--|ease-\[--' "$TMPD/family.code" || true)
if [ -n "$barevar" ]; then
    show "$barevar"
    bad "a bare-var arbitrary survives -- it compiles to an invalid declaration"
else
    ok "no bare-var arbitrary"
fi
# transition-all with no duration silently inherits Tailwind's 150ms.
tall=$(grep -nE 'transition-all(?![a-z-])' "$TMPD/family.code" 2>/dev/null || grep -nE 'transition-all' "$TMPD/family.code" || true)
if [ -n "$tall" ]; then
    show "$tall"
    bad "transition-all survives -- it inherits an off-scale 150ms"
else
    ok "no bare transition-all"
fi

# -----------------------------------------------------------------------------
printf '\n[10] The page title is on the Display step\n'
# Finding 10. `text-3xl font-bold mb-2` appears in 26 files and is missing the
# `tracking-[-0.02em]` the Display step specifies, so every one of those pages
# renders its title fractionally wider than the migrated surfaces do.
if grep -qE 'tracking-\[-0\.02em\]' "$TMPD/family.code"; then
    ok "the page title carries tracking-[-0.02em]"
else
    bad "the page title is off the Display step -- no tracking-[-0.02em]"
fi
if grep -qE 'text-3xl font-bold mb-2' "$TMPD/family.code"; then
    show "$(grep -nE 'text-3xl font-bold mb-2' "$TMPD/family.code")"
    bad "the untracked 26-file default survives"
else
    ok "the untracked 26-file default is gone"
fi

# -----------------------------------------------------------------------------
printf '\n[11] Banner, not Alert -- and no homemade tonal block\n'
# Findings 11, 12. Six <Alert> mounts across five files. banner.tsx is the
# lucide-side role-tonal primitive with the 36px disc and the entrance; it is
# already used by eight other surfaces including imei-settings.tsx. And
# force-tcp-tile.tsx hand-rolls two of them, one with a success glyph greyed to
# text-muted-foreground -- neither a chip nor a banner.
alerts=$(grep -nE 'from "@/components/ui/alert"|<Alert\b|<AlertDescription|<AlertTitle' "$TMPD/family.code" || true)
if [ -n "$alerts" ]; then
    show "$alerts"
    bad "the stock Alert survives -- the system ships Banner for this"
else
    ok "no stock Alert"
fi
if grep -qE 'from "@/components/ui/banner"' "$TMPD/family.code"; then
    ok "the family uses the Banner primitive"
else
    bad "no Banner import -- notices have nowhere correct to render"
fi

# -----------------------------------------------------------------------------
printf '\n[12] The system ink token, not the legacy shadcn neutral\n'
# Finding 13. 21 occurrences across six files.
muted=$(grep -nE 'text-muted-foreground' "$TMPD/family.code" || true)
if [ -n "$muted" ]; then
    show "$muted"
    bad "text-muted-foreground survives -- the system token is on-surface-variant"
else
    ok "no text-muted-foreground"
fi

# -----------------------------------------------------------------------------
printf '\n[13] Container queries, never viewport breakpoints\n'
# Finding 14. `sm:grid-cols-2` twice and `sm:flex-row` once. These key off the
# WINDOW, so they resolve wrong on a tablet and whenever the sidebar expands.
# The page gutter is the one sanctioned viewport breakpoint and lives in the
# route shell, not in a card.
vp=$(grep -nE '(^|[^@a-z-])(sm|md|lg|xl|2xl):' "$TMPD/family.code" || true)
if [ -n "$vp" ]; then
    show "$vp"
    bad "a viewport breakpoint survives inside the family -- use @container/main or @container/card"
else
    ok "no viewport breakpoint"
fi
if grep -qE '@container/main' "$TMPD/shell.code"; then
    ok "the route shell declares @container/main"
else
    bad "the route shell does not declare @container/main"
fi

# -----------------------------------------------------------------------------
printf '\n[14] The role radius scale\n'
# Finding 15. rounded-xl / rounded-lg off the legacy --radius: 0.65rem chain.
legacy=$(grep -nE 'rounded-(sm|md|lg|xl|2xl|3xl|full)\b' "$TMPD/family.code" || true)
if [ -n "$legacy" ]; then
    show "$legacy"
    bad "a legacy radius survives -- new work uses inline/field/tile/card/hero/pill"
else
    ok "no legacy radius"
fi

# -----------------------------------------------------------------------------
printf '\n[15] i18n: the dead subtrees are gone and all five locales agree\n'
# Finding 16. `trafficEngine.masquerade` is {} in en, zh-CN, zh-TW, it and id.
# `trafficEngine.status.sni` has no consumer -- the spoofed-SNI field was
# dropped when tpws replaced nfqws (docs/reference/dpi.md > Modes).
node_bin=""
for c in bun node; do command -v "$c" >/dev/null 2>&1 && { node_bin="$c"; break; }; done
if [ -z "$node_bin" ]; then
    bad "neither bun nor node on PATH -- cannot resolve the locale packs"
else
    for loc in en zh-CN zh-TW it id; do
        f="$LOCALES/$loc/common.json"
        if [ ! -f "$f" ]; then bad "missing locale pack: $loc/common.json"; continue; fi
        dead=$("$node_bin" -e '
            const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
            const te = j.trafficEngine || {};
            const out = [];
            // Renamed with the mode (2026-09-01): the dead empty subtree this
            // pins is now `trafficEngine.full_bypass`. The finding is the same
            // one -- an empty namespace nothing reads -- only its name moved.
            if (te.full_bypass !== undefined && Object.keys(te.full_bypass || {}).length === 0) out.push("full_bypass:{}");
            if (te.masquerade !== undefined) out.push("masquerade (retired namespace)");
            if (te.status && te.status.sni !== undefined) out.push("status.sni");
            process.stdout.write(out.join(","));
        ' "$f" 2>/dev/null)
        if [ -n "$dead" ]; then
            bad "$loc/common.json still carries dead keys: $dead"
        else
            ok "$loc/common.json: no dead trafficEngine keys"
        fi
    done
    # Parity: every key the shipped English pack has, the other four have.
    parity=$("$node_bin" -e '
        const fs = require("fs");
        const root = process.argv[1];
        const flat = (o, p = "") => Object.entries(o || {}).flatMap(([k, v]) =>
            v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]);
        const en = flat(JSON.parse(fs.readFileSync(root + "/en/common.json", "utf8")).trafficEngine);
        const miss = [];
        for (const loc of ["zh-CN", "zh-TW", "it", "id"]) {
            const o = JSON.parse(fs.readFileSync(root + "/" + loc + "/common.json", "utf8")).trafficEngine;
            const have = new Set(flat(o));
            const gone = en.filter((k) => !have.has(k));
            if (gone.length) miss.push(loc + ": " + gone.slice(0, 6).join(", ") + (gone.length > 6 ? " (+" + (gone.length - 6) + ")" : ""));
        }
        process.stdout.write(miss.join(" | "));
    ' "$LOCALES" 2>/dev/null)
    if [ -n "$parity" ]; then
        show "$parity"
        bad "trafficEngine keys are not at parity across the five locales"
    else
        ok "trafficEngine keys at parity across all five locales"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[16] Call B: the verify result is a shared-scale comparison\n'
# Finding 18. DESIGN.md > Signature surfaces: where a surface exists to answer
# "which of these won", the candidates are pill rows whose MetricBar lengths
# share ONE 0-100 composite, so the answer is read by length rather than by
# comparing three numerals. The winner is a primary-container row per
# Highlight-by-Container, and its numeral drops the ramp ink for
# on-primary-container.
if grep -qE '^export const CMP_ROW' "$TMPD/shapes.code"; then
    ok "shapes.ts exports CMP_ROW"
else
    bad "no CMP_ROW -- the comparison has no shared geometry"
fi
cmp_block=$(awk '/^export const CMP_ROW = \{/,/^\} as const;/' "$TMPD/shapes.code")
if [ -z "$cmp_block" ]; then
    bad "no CMP_ROW block to check for the winner promotion"
else
    if printf '%s\n' "$cmp_block" | grep -qE 'bg-primary-container'; then
        ok "CMP_ROW promotes the winner to primary-container"
    else
        bad "CMP_ROW does not promote the winner -- Highlight-by-Container"
    fi
    if printf '%s\n' "$cmp_block" | grep -qE 'text-on-primary-container'; then
        ok "the winner row takes on-primary-container ink"
    else
        bad "the winner row keeps ramp ink on a tinted ground -- the ramp is computed for a card ground"
    fi
fi
# Length is the primary encoding. A numeral carrying quality with no bar beside
# it is the named bug.
if grep -qE 'MetricBar|from "@/components/ui/metric-bar"' "$TMPD/verify.code"; then
    ok "verify-card renders MetricBar, so length carries the comparison"
else
    bad "verify-card has no MetricBar -- ramp ink on a numeral with no bar is a bug"
fi

# -----------------------------------------------------------------------------
printf '\n[17] Every status chip carries a glyph\n'
# The Every-Chip-Has-A-Glyph Rule. success-container and warning-container
# measure 1.03:1 apart -- the same surface to the eye and identical under
# deuteranopia -- so the glyph is the only thing separating healthy from
# degraded. A self-closing <Badge .../> cannot contain one.
selfclosed=$(grep -nE '<Badge[^>]*/>' "$TMPD/family.code" || true)
if [ -n "$selfclosed" ]; then
    show "$selfclosed"
    bad "a self-closing Badge cannot carry a glyph"
else
    ok "no self-closing Badge"
fi

# -----------------------------------------------------------------------------
printf '\n[18] The Icon-Boundary Rule: /local-network/ is lucide\n'
# Material Symbols owns the sidebar, /dashboard, the pre-auth routes and all of
# /cellular/. Everything else is lucide. Mixing two icon sets inside one screen
# is precisely what the rule prevents.
mat=$(grep -nE 'MaterialSymbol|material-symbol' "$TMPD/family.code" || true)
if [ -n "$mat" ]; then
    show "$mat"
    bad "a Material Symbol survives on a lucide route"
else
    ok "no Material Symbol on this route"
fi

# =============================================================================
# THE 2026-08-31 POLISH PASS — assertions [19] through [28]
# =============================================================================
# A second round on the same surface, from five user reports plus three defects
# a devil's-advocate pass found while attacking the plan for them. The reports
# and the found defects are interleaved below, because two of them turn out to
# be one defect seen from opposite ends.
#
#   R1  switching Bypass Mode shows no in-progress state: "it just
#       refreshes then shows the toasts"                     -> [19] [20] [21]
#   R2  Bypass mode and Test bypass should sit side by side
#       on a wide screen                                     -> [23]
#   R3  fewer em dashes                                      -> [27]
#   R4  Optimizer targets eats vertical AND horizontal space;
#       show about five and scroll                           -> [24]
#   R5  the target list should export to .txt and import back -> [26]
#
#   A THIRD ROUND, same surface, two more reports:
#
#   R6  the Test bypass card should stand the same height as Bypass mode,
#       with the Run test button centred in an `Empty`-style layout -> [23] [29]
#   R7  the loading skeleton "doesnt really show the true content once
#       loaded"                                                     -> [30]
#
#   D1  R1's cause is not a missing animation. `selectMode` ends in `retry()`,
#       which calls `refresh()` on both hooks; `refresh` IS `fetchStatus`, whose
#       `silent` parameter defaults FALSE, so both set isLoading and the shell's
#       render branch UNMOUNTS the strip, the mode card, the targets card and
#       the verify card for two CGI round-trips. There is nothing to animate
#       because the host is gone. Fixing this first is what makes [20] and [21]
#       mean anything at all.                                -> [19]
#   D2  ...and the same unmount silently kills a RUNNING Test Bypass: the poll
#       loop aborts on `!mountedRef.current`, so up to a twelve-minute test dies
#       and the card returns reading "idle" while saying nothing about it. [19]
#       cures this too, which is why it gets no separate assertion: it has no
#       separate fix.
#   D3  arrow keys in the mode radiogroup call `commit()` on every row they
#       pass, so arrowing from Off to Masquerade fires a real `svc_start` and an
#       iptables insert for Video Optimizer on the way past. ARIA radiogroups do
#       select-on-arrow, but "select" here restarts the service carrying the
#       user's own connection.                               -> [22]
#   D4  the targets list staggers every child at 80ms with NO cap, while
#       lib/motion.ts already exports `rowCascadeDelay` and
#       `ROW_CASCADE_MAX_INDEX` for exactly this and says why in its own JSDoc.
#       At 300 domains the last row lands 24s late. R4's scroll cap and R5's
#       bulk import both make it visible.                    -> [25]
#
# SCOPINGS, stated so they are not mistaken for a weakened test
# --------------------------------------------------------------
#  [27] sweeps USER-VISIBLE copy only: the trafficEngine subtree of the five
#       locale packs. The em dashes in this family's design-rationale COMMENTS
#       are deliberately untouched (user decision) -- rewriting them churns a
#       recently re-authored file for no user-visible effect and makes the blame
#       on it useless. The one em dash in shapes.ts is `TILE.NONE`, the
#       no-reading absence glyph. It is a value rather than prose, and it stays.
#  [23] REVERSES ITS OWN EARLIER FORM, and the reversal is recorded rather than
#       edited away. Round two asserted `items-start` and BANNED the height
#       lock, because symmetry was not a property of the pair: the verify card
#       was one footnote line when idle. R6 asks for the lock, and the right
#       answer is not to force one -- it is to remove the premise. The verify
#       card now has a resting state built to FILL ([29]), so the pair is
#       symmetric for real. DESIGN.md never banned equal heights; it requires
#       them to be explicit and names the spelling, which [23] now asserts.
#  [30] asserts the skeleton by STRUCTURE, never by size. A skeleton pinned to a
#       measured height passes on the day it is written and drifts silently
#       afterwards, which is finding 08 on this page. So the checks are that
#       each mirror lives beside the card it mirrors, that the band reuses the
#       loaded band's own constant, and that the unpinned mode row is mirrored
#       by the row box itself rather than by a number someone read off a screen.
#
# This block is COMMITTED RED, before the fix exists (change-workflow.md, Phase
# 4a). The builders who write the fix do not edit this file.
# =============================================================================

VO_HOOK="$REPO_ROOT/hooks/use-video-optimizer.ts"
TM_HOOK="$REPO_ROOT/hooks/use-full-bypass.ts"
HL_HOOK="$REPO_ROOT/hooks/use-cdn-hostlist.ts"
for pair in "vohook:$VO_HOOK" "tmhook:$TM_HOOK" "hlhook:$HL_HOOK"; do
    name="${pair%%:*}"; path="${pair#*:}"
    if [ -f "$path" ]; then strip_comments "$path" > "$TMPD/$name.code"
    else cp "$TMPD/empty.code" "$TMPD/$name.code"; fi
done

# -----------------------------------------------------------------------------
printf '\n[19] D1: the post-switch refetch is SILENT, so the page does not unmount\n'
# The whole of R1 rests on this. `refresh()` with no argument runs
# fetchStatus(silent=false), which sets isLoading on both hooks; the shell then
# renders its loading branch instead of its content branch, and every card on
# the page is destroyed and rebuilt. A spinner added inside ModeCard would
# survive for one frame and then vanish along with its host.
if grep -qE 'refresh\(true\)' "$TMPD/shell.code"; then
    ok "the shell refetches silently after a mode write"
else
    bad "the post-switch refetch is not silent -- the page unmounts and there is nothing to animate"
fi
# The parameter has to exist in the TYPE, not only at the call site: both hooks
# publish `refresh` through an exported interface, and a bare no-argument
# signature there makes the call above a type error rather than a fix.
for pair in "use-video-optimizer:vohook" "use-full-bypass:tmhook"; do
    label="${pair%%:*}"; key="${pair#*:}"
    if grep -qE 'refresh: *\(silent\?: *boolean\) *=>' "$TMPD/$key.code"; then
        ok "$label types refresh as accepting the silent flag"
    else
        bad "$label still types refresh as taking no argument -- refresh(true) will not typecheck"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[20] R1: the card is told WHICH mode is being switched to\n'
# A boolean cannot say which of three rows the user picked. `isSaving` reached
# the card as one flag and was spent entirely on `disabled`, which fires the
# group-wide disabled opacity -- so all three rows dimmed equally and the
# interface had no way to name the pending choice.
if grep -qE 'pendingMode' "$TMPD/mode.code"; then
    ok "ModeCard accepts a pendingMode"
else
    bad "ModeCard still receives only a boolean -- it cannot name the pending mode"
fi
if grep -qE 'pendingMode: *DpiMode *\| *null' "$TMPD/mode.code"; then
    ok "pendingMode is typed DpiMode or null"
else
    bad "pendingMode is not typed DpiMode or null -- null is the no-switch-in-flight state"
fi
if grep -qE 'pendingMode=\{' "$TMPD/shell.code"; then
    ok "the shell passes pendingMode down"
else
    bad "the shell derives a pending mode but never passes it -- the card still cannot show it"
fi

# -----------------------------------------------------------------------------
printf '\n[21] R1: the pending row carries a spinner, and the group reports busy\n'
# The in-progress precedent in this family is a spinner swapped into the control
# that is acting -- the Add button, the Run test button, the Uninstall pill --
# not a new status chip. A separate Switching chip in the card header would also
# put the header and the engine tile on two different answers to one question
# for the duration of the switch, which is finding 01, the exact defect this
# surface was re-authored to kill.
if grep -qE 'Loader2Icon' "$TMPD/mode.code"; then
    ok "mode-card renders a spinner"
else
    bad "mode-card has no spinner -- nothing marks the row that is switching"
fi
if grep -qE 'aria-busy' "$TMPD/mode.code"; then
    ok "the radiogroup reports aria-busy while a write is in flight"
else
    bad "no aria-busy -- a screen reader is told nothing for the duration of the switch"
fi

# -----------------------------------------------------------------------------
printf '\n[22] D3: arrow keys move focus, they do not restart the engine\n'
# Extract the key handler and assert it commits nothing. Arrowing through the
# group must not fire a service start for every row it passes over.
keyblock=$(awk '/const onKeyDown = /,/^  \};/' "$TMPD/mode.code")
if [ -z "$keyblock" ]; then
    bad "no onKeyDown handler found in mode-card -- cannot verify the arrow-key path"
else
    if printf '%s\n' "$keyblock" | grep -qE '\bcommit\('; then
        show "$keyblock"
        bad "arrow keys still call commit -- every mode passed over fires a real engine restart"
    else
        ok "arrow keys move focus without committing"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[23] R6: the mode and verify cards share one height, honestly\n'
# THIS ASSERTION IS THE INVERSE OF THE ONE COMMITTED HOURS EARLIER, AND THAT IS
# DELIBERATE. The original required `items-start` and BANNED `h-full` /
# `items-stretch`, reasoning that the verify card is "a single footnote line
# when idle and a headline plus three comparison bars when complete", so a lock
# would strand dead space in whichever card had less to say.
#
# The reasoning was sound and its premise has been removed. The verify card is
# no longer a footnote line when idle: it is a centred resting state built to
# FILL the height it is given, which is what makes symmetry a real property of
# this pair rather than one forced onto it. DESIGN.md does not ban equal heights
# -- it requires them to be explicit (DESIGN.md > Layout, "Equal heights are
# explicit") and names the spelling. That spelling is what is asserted here.
#
# The Radio Information failure DESIGN.md records is NOT this shape: there a
# static reference card was locked to a live telemetry card and neither had a
# fill state, so ~200px of dead air moved between them with the carrier count.
# Here both cards fill, and the last check in this block is what holds that
# true.
pair_block=$(awk '/^export const CARD_PAIR/,/;$/' "$TMPD/shapes.code")
if [ -z "$pair_block" ]; then
    bad "shapes.ts exports no CARD_PAIR -- the pair geometry has no home"
else
    if printf '%s\n' "$pair_block" | grep -qE 'items-start'; then
        show "$pair_block"
        bad "CARD_PAIR still aligns to the start -- the two cards size independently and the heights diverge"
    else
        ok "CARD_PAIR does not pin the cards to the start"
    fi
    # The stretch has to be WRITTEN, not inherited. `stretch` is the grid
    # default, so an unstated one is indistinguishable from nobody having
    # decided -- and the next `items-start` tidy-up removes it in silence.
    if printf '%s\n' "$pair_block" | grep -qE 'items-stretch'; then
        ok "CARD_PAIR states its stretch rather than inheriting the grid default"
    else
        bad "CARD_PAIR does not state items-stretch -- an inherited default is indistinguishable from an undecided one"
    fi
    # DESIGN.md > Layout names the spelling: the cell stretches, and the card
    # inside it is told to fill the cell. Without the second half a stretched
    # cell holds a content-height card and nothing visible changes.
    if printf '%s\n' "$pair_block" | grep -qE 'data-\[slot=card\]:h-full'; then
        ok "CARD_PAIR fills each stretched cell with its card"
    else
        bad "CARD_PAIR stretches the cells but never fills them -- the cards keep their own heights inside taller cells"
    fi
    if printf '%s\n' "$pair_block" | grep -qE '@5xl/main:grid-cols-2'; then
        ok "the pair splits at the 5xl container step"
    else
        bad "the pair does not split at the 5xl container step -- the 6xl step needs a viewport past 1480px, which a 1440px laptop never reaches"
    fi
fi
if grep -qE 'CARD_PAIR' "$TMPD/shell.code"; then
    ok "the shell uses CARD_PAIR"
else
    bad "CARD_PAIR is exported but the shell never uses it"
fi
# A height lock with no growing child IS the Radio Information bug. Both cards
# must hand their spare height to their content, or the taller card's extra
# pixels pool at the bottom of the shorter one as dead air.
# The grow is accepted in EITHER spelling, and the looser form is the stricter
# test. The mode card writes `flex-1` at the call site; the verify card takes it
# through `RESTING.CONTENT`, whose own `flex-1` [29] asserts separately. Naming
# only the literal would have forced the verify card to restate geometry that
# already has a home in shapes.ts -- failing it for being MORE correct than the
# assertion imagined. Widening a test to admit a better implementation is not
# the same act as widening one to admit a worse one.
for pair in "mode:mode-card" "verify:verify-card"; do
    name="${pair%%:*}"; label="${pair#*:}"
    if grep -qE 'flex-1|RESTING\.CONTENT' "$TMPD/$name.code"; then
        ok "$label grows its content into the stretched card"
    else
        bad "$label locks to its sibling height with no growing child -- the spare height becomes dead air"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[24] R4: the target list is a capped, scrolling, multi-column viewport\n'
# Both halves of the complaint are one shape. Columns reclaim the horizontal run
# of dead pill beside an eleven-character domain; the cap bounds the vertical.
# The cap is a CEILING on grid rows, so a short list still collapses well under
# it rather than sitting at a fixed height.
host_block=$(awk '/^export const HOST_ROW = \{/,/^\} as const;/' "$TMPD/shapes.code")
if [ -z "$host_block" ]; then
    bad "no HOST_ROW block to check for the scroll viewport"
else
    if printf '%s\n' "$host_block" | grep -qE 'overflow-y-auto'; then
        ok "HOST_ROW scrolls on the vertical axis"
    else
        bad "HOST_ROW does not scroll -- the list still grows without bound"
    fi
    if printf '%s\n' "$host_block" | grep -qE 'max-h-'; then
        ok "HOST_ROW caps its height"
    else
        bad "HOST_ROW has no height cap -- a scroll container with no ceiling never scrolls"
    fi
    if printf '%s\n' "$host_block" | grep -qE 'grid-cols'; then
        ok "HOST_ROW flows its chips into columns"
    else
        bad "HOST_ROW is still one chip per row -- the horizontal half of the report is unfixed"
    fi
fi
# The Skeleton-Mirror Rule. The loading state and the loaded state must read the
# SAME constants; a skeleton that restates a number is a skeleton that drifts,
# and this family already paid for that once.
inline_geom=$(grep -nE 'max-h-|grid-cols-|h-10' "$TMPD/targets.code" || true)
if [ -n "$inline_geom" ]; then
    show "$inline_geom"
    bad "targets-card restates list geometry inline instead of importing it from HOST_ROW"
else
    ok "targets-card restates no list geometry"
fi

# -----------------------------------------------------------------------------
printf '\n[25] D4: the row cascade is capped\n'
# lib/motion.ts already exports the cap and the delay function, and its own
# JSDoc explains why: an uncapped cascade makes row 180 wait fourteen seconds,
# which is not choreography. The list this runs on holds up to 300 entries.
if grep -qE 'rowCascadeDelay|ROW_CASCADE_MAX_INDEX' "$TMPD/targets.code"; then
    ok "the target list caps its cascade through the shared helper"
else
    bad "the target list staggers every child uncapped -- at 300 domains the last row lands 24s late"
fi

# -----------------------------------------------------------------------------
printf '\n[26] R5: export and import, with the backend rules mirrored client-side\n'
# The CGI validates charset, the dot, a 253-character ceiling AND that the
# extracted entry count matches the declared one, then rewrites the file
# ATOMICALLY -- so one bad line in an imported file rejects the entire merge. A
# toast that has already claimed "N added" would be lying about a write the
# modem refused.
if grep -qE 'createObjectURL' "$TMPD/targets.code"; then
    ok "targets-card exports the list as a file"
else
    bad "no export path in targets-card"
fi
if grep -qE 'revokeObjectURL' "$TMPD/targets.code"; then
    ok "the object URL is revoked after the download"
else
    bad "the object URL is never revoked -- the blob is held for the life of the document"
fi
if grep -qE 'type="file"' "$TMPD/targets.code"; then
    ok "targets-card accepts a file for import"
else
    bad "no import path in targets-card"
fi
if grep -qE '253' "$TMPD/targets.code"; then
    ok "the 253-character ceiling is mirrored client-side"
else
    bad "the 253-character ceiling is not enforced client-side -- one long line rejects the whole atomic write after the toast has claimed success"
fi
# The list is stored independently of the mode, so importing while masquerade
# owns the engine is legitimate. What must not happen is a merge that silently
# discards what was already saved.
if grep -qE 'restoreDefaults' "$TMPD/hlhook.code"; then
    ok "the hook exposes the backend's restore action"
else
    bad "restore_hostlist ships in the CGI and the hook still drops it"
fi
# -----------------------------------------------------------------------------
printf '\n[29] R6: the verify card has a resting state that fills, not a footnote\n'
# This is what makes [23] honest rather than forced. A height lock over a card
# whose idle content is one sentence produces the Radio Information failure;
# a height lock over a card with a designed resting state produces a pair.
#
# The layout is the `Empty` primitive's -- media disc, title, description,
# action, centred -- but the PRIMITIVE cannot be used here and the reason is
# not taste. `components/ui/empty.tsx` ships `md:p-12`, a VIEWPORT breakpoint,
# inside a family whose entire responsive contract is container queries ([13]).
# This family already refused the `Input` primitive for exactly that defect
# (shapes.ts > FIELD, "the size reverts at a 768px VIEWPORT"), and the one
# in-repo consumer that did take `Empty` had to neutralise it with a
# `md:` class of its own. So the layout is restated as a family shape beside
# CONDITION, which is the same call, made the same way, one section above.
rest_block=$(awk '/^export const RESTING = \{/,/^\} as const;/' "$TMPD/shapes.code")
if [ -z "$rest_block" ]; then
    bad "shapes.ts exports no RESTING block -- the verify card has no resting layout to fill with"
else
    for need in "items-center" "justify-center" "text-center" "flex-1"; do
        if printf '%s\n' "$rest_block" | grep -qF -- "$need"; then
            ok "RESTING carries $need"
        else
            bad "RESTING is missing $need -- a resting state that does not centre and grow is a footnote with more markup"
        fi
    done
fi
# The primitive stays unimported in this family, for the reason above.
if grep -qE 'components/ui/empty|from "@/components/ui/empty"' "$TMPD/family.code"; then
    bad "the family imports ui/empty, whose md:p-12 is a viewport breakpoint inside a container-query surface"
else
    ok "the family does not import ui/empty"
fi
# The CTA moves. In the resting states it lives INSIDE the block; the header
# action returns only once there is a result to run again against. Two buttons
# for one action in one state is the failure this checks for, and it is the
# obvious way to get here by accident.
if grep -qE 'RESTING\.ACTION|RESTING\.' "$TMPD/verify.code"; then
    ok "verify-card renders the resting layout"
else
    bad "verify-card does not use RESTING -- the idle state is still a footnote line"
fi
if grep -qE 'complete \?|complete &&' "$TMPD/verify.code"; then
    ok "verify-card gates on a completed result"
else
    bad "verify-card no longer distinguishes a completed result"
fi
# A spinning disc, not a spinner beside a button: the run takes minutes, so the
# screen has to be readable for that long. Same call `onboarding.tsx` made for
# the install, and the same reason.
if grep -qE 'animate-spin' "$TMPD/verify.code"; then
    ok "the running state spins"
else
    bad "the running state has no motion -- a twelve-minute wait with a static card reads as a hang"
fi

# -----------------------------------------------------------------------------
printf '\n[30] R7: the loading skeleton mirrors the band, not four tiles\n'
# The reported defect: the skeleton "doesnt really show the true content once
# loaded". It rendered four tiles and stopped, so the handoff grew three whole
# cards out of nothing -- roughly 800px of layout arriving after the fact.
#
# The Skeleton-Mirror Rule is the fix AND the trap. A skeleton that restates
# `h-40` is worse than none, because it looks maintained while drifting; that
# is finding 08 on this very page. So each card's skeleton is asserted to live
# beside the card it mirrors and to be built from the shared constants.
for pair in "mode:ModeCardSkeleton" "verify:VerifyCardSkeleton" "targets:TargetsCardSkeleton"; do
    name="${pair%%:*}"; sym="${pair#*:}"
    if grep -qE "export (function|const) $sym" "$TMPD/$name.code"; then
        ok "$sym is exported beside the card it mirrors"
    else
        bad "$sym does not exist -- the skeleton for that card has nowhere to live but the shell, away from the geometry it copies"
    fi
    if grep -qE "$sym" "$TMPD/shell.code"; then
        ok "the shell renders $sym"
    else
        bad "the shell does not render $sym -- the loading state is still missing that card"
    fi
done
# The band's geometry is shared by construction: the skeleton band is laid out
# by the SAME constant as the loaded band, so the two can never disagree about
# the column split or the gap.
skel_pair=$(grep -cF 'className={CARD_PAIR}' "$TMPD/shell.code" || true)
if [ "${skel_pair:-0}" -ge 2 ]; then
    ok "the skeleton band and the loaded band are laid out by the same CARD_PAIR"
else
    bad "CARD_PAIR is applied $skel_pair time(s) -- the skeleton band is not laid out by the loaded band's own constant"
fi
# The mode rows mirror BY CONSTRUCTION rather than by a guessed height:
# CHOICE_ROW.ROOT has no pin (its hint wraps), so the only mirror that cannot
# drift is the row box itself, filled with line boxes.
row_uses=$(grep -cF 'CHOICE_ROW.ROOT' "$TMPD/mode.code" || true)
if [ "${row_uses:-0}" -ge 2 ]; then
    ok "the mode skeleton reuses the real row box"
else
    bad "CHOICE_ROW.ROOT appears $row_uses time(s) -- the skeleton does not reuse the real row box, and an unpinned row cannot be mirrored by a number"
fi
# The line boxes are named once, in shapes.ts, rather than three times inline.
skel_block=$(awk '/^export const SKELETON = \{/,/^\} as const;/' "$TMPD/shapes.code")
if [ -z "$skel_block" ]; then
    bad "shapes.ts exports no SKELETON block -- every skeleton line box is a restated number"
else
    ok "shapes.ts names the skeleton line boxes once"
fi


# -----------------------------------------------------------------------------
printf '\n[27] R3: no em dashes in the user-visible copy\n'
# Seven across the five packs, and the counts are NOT at parity (en 6, zh-CN 5,
# zh-TW 5, it 2, id 6) -- so this is five hand-rewritten sets of sentences, not
# one find-and-replace. Two of the English ones are PAIRED, doing parenthetical
# work, where a dropped-in period breaks the sentence. The Chinese ones use a
# spaced Western dash that is wrong for CJK typography regardless of this pass.
if [ -z "${node_bin:-}" ]; then
    bad "neither bun nor node on PATH -- cannot resolve the locale packs for the dash sweep"
else
    for loc in en zh-CN zh-TW it id; do
        f="$LOCALES/$loc/common.json"
        if [ ! -f "$f" ]; then bad "missing locale pack: $loc/common.json"; continue; fi
        dashes=$("$node_bin" -e '
            const fs = require("fs");
            const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
            const hits = [];
            const walk = (o, p) => {
                for (const [k, v] of Object.entries(o || {})) {
                    if (v && typeof v === "object") walk(v, p + k + ".");
                    else if (typeof v === "string" && v.includes("—")) hits.push(p + k);
                }
            };
            walk(j.trafficEngine, "trafficEngine.");
            process.stdout.write(hits.join(", "));
        ' "$f" 2>/dev/null)
        if [ -n "$dashes" ]; then
            show "$dashes"
            bad "$loc/common.json still has em dashes in trafficEngine copy"
        else
            ok "$loc/common.json: no em dashes in trafficEngine copy"
        fi
    done
fi

# -----------------------------------------------------------------------------
printf '\n[28] The locale packs are still CRLF after the rewrite\n'
# The packs ship CRLF. A naive parse-and-stringify round-trip converts all of
# them to LF, which is a three-thousand-line diff per pack that no reviewer will
# read and that git can hide entirely when autocrlf is on. Only a byte read
# tells: count the newlines NOT preceded by a carriage return.
if [ -z "${node_bin:-}" ]; then
    bad "neither bun nor node on PATH -- cannot byte-check the locale packs"
else
    for loc in en zh-CN zh-TW it id; do
        f="$LOCALES/$loc/common.json"
        if [ ! -f "$f" ]; then bad "missing locale pack: $loc/common.json"; continue; fi
        lone=$("$node_bin" -e '
            const b = require("fs").readFileSync(process.argv[1]);
            let lone = 0;
            for (let i = 0; i < b.length; i++)
                if (b[i] === 0x0a && (i === 0 || b[i - 1] !== 0x0d)) lone++;
            process.stdout.write(String(lone));
        ' "$f" 2>/dev/null)
        if [ "$lone" = "0" ]; then
            ok "$loc/common.json is still CRLF throughout"
        else
            bad "$loc/common.json has $lone bare newlines -- the pack was silently converted to LF"
        fi
    done
fi

# =============================================================================
# [31] THE RENAME: "Traffic Masquerade" -> "Full Bypass"
# =============================================================================
# The name described a capability this platform does not have. On the RM551E,
# nfqws rewrote the outgoing ClientHello's SNI to a spoofed identity, so the
# mode genuinely masqueraded. The RM520N-GL runs tpws, which has no fake-SNI
# mode at all -- it splits and reorders the connection's REAL ClientHello. The
# mode never impersonated anything; it ran the same recipe unscoped. Users
# reasonably went looking for what it was masquerading AS, and there was
# nothing there.
#
# `masquerade` is a MODE DISCRIMINANT, not a label: dpi_active_mode() prints
# it, dpi_build_args() cases on it, the CGI routes on it, DpiMode carries it,
# and four components compare against it. So this section asserts across all
# four layers -- a rename that lands in the UI and not in the shell leaves the
# selector unable to select anything.
#
# The persisted-config half of the rename is pinned separately and
# behaviourally by scripts/test/full-bypass-config-migration.sh. That is the
# dangerous half (a silent state reset on every deployed device); this one is
# the consistency half.
#
# COMMITTED RED, before the rename exists (change-workflow.md, Phase 4a).
printf '\n[31] the rename lands in every layer, not just the label\n'

# --- the frontend discriminant ---
if grep -qE '"full_bypass"' "$TMPD/family.code" && grep -q '"full_bypass"' "$REPO_ROOT/types/traffic-engine.ts"; then
    ok "DpiMode carries \"full_bypass\" and the family compares against it"
else
    bad "the family/DpiMode does not use \"full_bypass\" -- the mode discriminant was not renamed"
fi
if grep -qE '"masquerade"' "$TMPD/family.code" "$REPO_ROOT/types/traffic-engine.ts"; then
    bad "the \"masquerade\" discriminant survives in the family or DpiMode -- two names for one mode"
else
    ok "no \"masquerade\" discriminant left in the family or DpiMode"
fi
if grep -qE 'MasqueradeStatus|MASQUERADE_SNI|useTrafficMasquerade' "$TMPD/family.code" "$REPO_ROOT/types/traffic-engine.ts"; then
    bad "a Masquerade-named export is still referenced (MasqueradeStatus / MASQUERADE_SNI / useTrafficMasquerade)"
else
    ok "no Masquerade-named exports remain"
fi

# --- the hook file itself ---
# Left in place it would be the single file in the tree still carrying the
# retired name -- exactly the "two answers to one question" residue the RETIRED
# list above exists to prevent.
if [ -f "$REPO_ROOT/hooks/use-traffic-masquerade.ts" ]; then
    bad "hooks/use-traffic-masquerade.ts still exists -- it is superseded by hooks/use-full-bypass.ts"
else
    ok "hooks/use-traffic-masquerade.ts is retired"
fi
if [ -f "$REPO_ROOT/hooks/use-full-bypass.ts" ]; then
    ok "hooks/use-full-bypass.ts exists"
else
    bad "hooks/use-full-bypass.ts does not exist"
fi

# --- the backend discriminant and the wire contract ---
DPI_STATE_SH="$REPO_ROOT/scripts/usr/lib/qmanager/dpi_state.sh"
VO_CGI="$REPO_ROOT/scripts/www/cgi-bin/quecmanager/network/video_optimizer.sh"
if grep -qE '^[[:space:]]*echo "full_bypass"' "$DPI_STATE_SH" && grep -qE '^[[:space:]]*full_bypass\)' "$DPI_STATE_SH"; then
    ok "dpi_active_mode prints full_bypass and dpi_build_args cases on it"
else
    bad "dpi_state.sh still speaks the old mode string -- the shell and the UI would disagree on what mode is running"
fi
if grep -qE 'qm_config_get[[:space:]]+traffic_masquerade' "$DPI_STATE_SH" "$VO_CGI" "$REPO_ROOT/scripts/usr/bin/qmanager_dpi_install"; then
    bad "the backend still READS the traffic_masquerade config section"
else
    ok "no backend reads of the traffic_masquerade config section"
fi
if grep -qE 'save_full_bypass' "$VO_CGI"; then
    ok "the CGI handles the save_full_bypass action"
else
    bad "the CGI has no save_full_bypass action"
fi
# The one-release deprecation alias, approved 2026-09-01. An OTA replaces the
# CGI and the JS bundle together, so the DEVICE is never half-updated -- but a
# browser tab left open across the OTA holds the old bundle and would POST
# save_masquerade into a CGI that no longer knows it. Remove the alias, and
# this assertion, one release after the rename ships.
if grep -qE 'save_masquerade' "$VO_CGI"; then
    ok "the CGI still accepts save_masquerade as a deprecated alias (stale-tab safety)"
else
    bad "no save_masquerade alias -- a browser tab open across the OTA gets unknown_action"
fi

# --- i18n: the keys moved AND the copy was really re-translated ---
if [ -z "$node_bin" ]; then
    bad "neither bun nor node on PATH -- cannot check the renamed locale keys"
else
    # Each locale's own word for the retired mode. The targets-card idle copy
    # names the mode in prose, so a pack that only had its KEYS renamed still
    # tells the user about a mode that no longer exists. This is the assertion
    # that makes a copy-paste of the English string insufficient.
    for spec in "en:Masquerade" "zh-CN:伪装" "zh-TW:偽裝" "it:Mascheramento" "id:Penyamaran"; do
        loc="${spec%%:*}"; oldword="${spec#*:}"
        f="$LOCALES/$loc/common.json"
        if [ ! -f "$f" ]; then bad "missing locale pack: $loc/common.json"; continue; fi
        res=$("$node_bin" -e '
            const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
            const te = j.trafficEngine || {}, m = te.mode || {}, tg = te.targets || {};
            const out = [];
            for (const k of ["full_bypass", "full_bypass_hint", "toast_full_bypass"])
                if (!m[k]) out.push("missing mode." + k);
            for (const k of ["masquerade", "masquerade_hint", "toast_masquerade"])
                if (m[k] !== undefined) out.push("stale mode." + k);
            // Case-insensitively: the Italian body says "mascheramento" in
            // lower case mid-sentence while its title capitalises it, and a
            // case-sensitive match would pass the file with the retired name
            // still in two of its three strings. toLowerCase is a no-op on the
            // two CJK packs.
            const old = process.argv[2].toLowerCase();
            for (const k of ["idle_title", "idle_body", "idle_body_empty"])
                if (typeof tg[k] === "string" && tg[k].toLowerCase().includes(old))
                    out.push("targets." + k + " still says " + process.argv[2]);
            process.stdout.write(out.join("; "));
        ' "$f" "$oldword" 2>/dev/null)
        if [ -n "$res" ]; then
            bad "$loc/common.json: $res"
        else
            ok "$loc/common.json: mode keys renamed and the idle copy re-translated"
        fi
    done
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
