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
if grep -qE 'idle|unavailable|not_in_use|masquerade' "$TMPD/targets.code"; then
    ok "targets-card knows about the masquerade case"
else
    bad "targets-card has no masquerade branch -- it can only disappear"
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
# Tailwind v4 dropped the bare-var arbitrary: `duration-[--x]` compiles to an
# invalid declaration the browser drops. The class IS generated, so grepping the
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
            if (te.masquerade !== undefined && Object.keys(te.masquerade || {}).length === 0) out.push("masquerade:{}");
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

# -----------------------------------------------------------------------------
printf '\n----------------------------------------------------------------\n'
printf 'passed: %d   failed: %d\n' "$pass_count" "$fail_count"
if [ "$fail_count" -gt 0 ]; then
    printf 'RED\n'
    exit 1
fi
printf 'GREEN\n'
exit 0
