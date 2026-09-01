#!/usr/bin/env bash
# Regression harness for the APN Management re-authoring
# (/cellular/settings/apn-management).
#
# WHY THIS EXISTS
# ----------------
# `components/cellular/settings/apn-management/{apn-settings,apn-settings-card,
# mbn-card}.tsx` and `hooks/use-apn-settings.ts` ship six independent defects,
# each pinned below by one or more assertions:
#
#   1. THE STATUS CHIP READS THE WRONG CLOCK. `useApnStatusChip` derives its
#      live/not-live verdict from `cids[].apn` — a PDP-context snapshot the CID
#      Select also reads — instead of the poller's `network.apn`, which is what
#      "What the network granted" already trusts a few lines down the same
#      file. Two readers of "is it live" can disagree.        -> [1] [2]
#   2. THE DEACTIVATE BUTTON IS GATED BACKWARDS. `active !== 0` shows the
#      button whenever `active` is anything but 0 — including `null`, before
#      the first fetch resolves. It should show only on a confirmed `active
#      === 1`.                                                 -> [3]
#   3. THE RESERVED-CONTEXT GUARD CAN BE BYPASSED. `handleCidChange` gates VoLTE
#      / SOS protection on `contexts.find(...)`, where `contexts` is the live
#      `cids` array. When the modem has not reported contexts yet (`cids` is
#      null or empty), the Select still offers `FALLBACK_CIDS` (1-6), `find`
#      always misses, and a data APN can land silently on the IMS or emergency
#      context with no confirmation dialog.                    -> [4]
#   4. THE CARD FABRICATES SELECTIONS IT NEVER READ. On a failed first read the
#      component falls straight past its loading branch into the form body:
#      the APN field honestly shows a placeholder, but the IP-protocol control
#      renders IPv4v6 SELECTED and the CID Select renders CID 1, as
#      confirmed-looking choices on a card that has read nothing. `CARD_NOTICE`
#      (`SETTING_ROW.ROOT` + `.CONSEQUENCE` composed once, shapes.ts:567) is
#      the family's primitive for exactly this never-read state, and
#      apn-settings-card.tsx does not import it.                -> [5]
#   5. THE MBN EMPTY STATE CANNOT TELL "NOT READ YET" FROM "READ, AND EMPTY".
#      `bundles = profiles ?? []` collapses both to the same `.length === 0`
#      branch, so the empty-state copy ("this firmware has no bundles") can
#      render while the fetch is still in flight.               -> [6]
#   6. THE RECALL ORDER IS WRONG, AND ONE CARD IS LOCKED THAT SHOULDN'T BE.
#      `NetworkGrantedCard` — read-only, live truth — renders LAST, after both
#      write cards, and `MBNCard` sits inside the profile-override
#      `<fieldset>` even though a profile owning the APN says nothing about
#      MBN bundle selection.                                    -> [9] [10]
#   7. AN UNCONDITIONAL WARNING BANNER. mbn-card.tsx renders
#      `<TonalBanner tone="warning">` on every render, loaded or not, bundles
#      or not — a banner that never has an off state is not a warning, it is
#      wallpaper.                                                -> [11]
#   8. A LOST HTTP RESPONSE IS REPORTED AS A REFUSAL. `save()`'s catch block
#      cannot distinguish "the modem said no" from "the attach cycle dropped
#      the eth0 link for ~4s and killed the response" (a confirmed RM520N-GL
#      behaviour, see CLAUDE.md's Attach-Cycle note) — both report
#      `setError(...)` and the optimistic write is never reconciled against
#      what actually landed.                                     -> [12]
#
# Two more findings are copy-only and did not need reading past the locale
# packs:
#   9. `save_connection_notice` never mentions the Ethernet/wired-session case
#      — a technician on a USB-Ethernet uplink reads a warning about "the
#      cellular connection" while their actual management session is the one
#      about to be interrupted if they are ALSO the WAN.          -> [13]
#  10. `NetworkGrantedCard` has no staleness signal at all. `useModemStatus()`
#      exports an `isStale` boolean at a 10s threshold, but the card takes only
#      `{ status, isLoading, error }` and never receives it -- so a frozen
#      poller renders identically to a live one. [8] guards the fix from
#      overcorrecting into a "read N seconds ago" counter, which was refuted:
#      this page's writable half is not polled, so such a number would count
#      from a fetch the user cannot see.                        -> [7] [8]
#
# The assertions are text-anchored to the anchors verified directly against
# this tree by the approved plan (docs/reference/_handoff-apn-management-
# execute.md), never to names a fix builder might invent while writing the
# fix. That is what keeps the test independent of the fix it gates.
#
# This harness is COMMITTED RED, before the fix exists (change-workflow.md,
# Phase 4a). The builder who writes the fix does not edit this file.
#
# SCOPINGS, stated openly so they are not mistaken for a weakened test
# ---------------------------------------------------------------------
#  [16] [17] are checked against COMMENT-STRIPPED source. shapes.ts and
#      apn-settings-card.tsx both carry rationale comments that NAME the
#      retired promotion mechanism and the retired shapes.ts symbols while
#      explaining why they are gone (e.g. shapes.ts:574 mentions
#      `CONSEQUENCE_ON_FILL` surviving for an unrelated reason, and its own
#      header explains why `SETTING_ROW_DIRTY.ROOT` no longer exists). Failing
#      on that prose would push a builder to delete the explanation, which is
#      the opposite of what the ratchet is for.
#  [1] [2] [4] [5] [6] [7] [8] [9] [10] [11] [12] [13] [14] [15] [18] are
#      checked against RAW source (or, for [18], the raw locale pack): they
#      either read `export const` declarations, i18n values, JSX offsets, or a
#      named symbol whose only risk is a retired-pattern PROSE mention, which
#      does not apply to any of them.
#  [3] "no `active !== 0`" is checked as the literal token, not as a ban on
#      every use of `!== 0` in the file — `changeCount === 0` and similar are
#      untouched.
#
# ASSERTIONS [16] AND [17] PASS IN THIS RED RUN, BY DESIGN
# ----------------------------------------------------------
# This surface arrived mechanically clean: zero raw Tailwind colours, zero
# legacy radii, zero untokenized durations, zero `transition-all`, and zero
# survivors of the retired row-promotion pattern (`FIELD_SHELL_ON_FILL`,
# `SELECT_TRIGGER_ON_FILL`, `SEGMENTED.*_ON_FILL`, `SETTING_ROW_DIRTY.ROOT`,
# `onFill=`). Two independent agents confirmed this before the plan was
# written. THERE IS NO TOKEN SWEEP IN THIS CHANGE. [16] and [17] exist purely
# as a RATCHET, so the re-authoring itself cannot reintroduce what the
# incumbent already avoided — they are expected to stay green through the fix,
# not to go red and get repaired.
#
# INTERPRETIVE NOTE ON [4]
# -------------------------
# The plan's row 4 names `handleCidChange` "or its replacement" because the
# fix may rename it. The harness anchors on the current name first and falls
# back to scanning the whole card file if that symbol disappears, so a rename
# alone cannot vacuously pass it — the fix still has to add a second gate that
# does not depend solely on `contexts.find(...)` succeeding.
#
# Run: bash scripts/test/apn-management-design-language.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APN_DIR="$REPO_ROOT/components/cellular/settings/apn-management"
SETTINGS_DIR="$REPO_ROOT/components/cellular/settings"

PAGE_FILE="$APN_DIR/apn-settings.tsx"
CARD_FILE="$APN_DIR/apn-settings-card.tsx"
MBN_FILE="$APN_DIR/mbn-card.tsx"
HOOK_FILE="$REPO_ROOT/hooks/use-apn-settings.ts"
SHAPES="$SETTINGS_DIR/shapes.ts"
LOCALES="$REPO_ROOT/public/locales"

pass_count=0
fail_count=0

ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

show() { printf '       offending lines:\n'; sed 's/^/         /'; }

# Files that must exist regardless of the fix's state, or the harness cannot run.
for f in "$PAGE_FILE" "$CARD_FILE" "$MBN_FILE" "$HOOK_FILE" "$SHAPES"; do
    [ -f "$f" ] || { echo "expected source file not found: $f" >&2; exit 1; }
done

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

# Strip //-to-EOL and /* */ comments so a rationale comment naming a retired
# class or symbol cannot fail an assertion about rendered/exported code.
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

strip_comments "$PAGE_FILE" > "$TMPD/page.code"
strip_comments "$CARD_FILE" > "$TMPD/card.code"
strip_comments "$MBN_FILE"  > "$TMPD/mbn.code"
strip_comments "$HOOK_FILE" > "$TMPD/hook.code"
strip_comments "$SHAPES"    > "$TMPD/shapes.code"

# -----------------------------------------------------------------------------
printf '\n[1] The status chip reads network.apn, the poller field\n'
# useApnStatusChip is scoped to its own line range so this does not collide
# with the (legitimate) uses of `cids` elsewhere in the file, e.g. the CID
# Select's option list.
awk '/^function useApnStatusChip\(/,/^}/' "$PAGE_FILE" > "$TMPD/chip.raw"
awk '/^function useApnStatusChip\(/,/^}/' "$TMPD/page.code" > "$TMPD/chip.code"
if [ ! -s "$TMPD/chip.raw" ]; then
    bad "useApnStatusChip helper not found -- assertion 1/2 cannot be evaluated"
elif grep -qE '\bnetwork\.apn\b|\bnetwork\?\.apn\b|\bstatus\.network\.apn\b|\bstatus\?\.network\?\.apn\b' "$TMPD/chip.code"; then
    ok "useApnStatusChip references network.apn (the poller's granted APN)"
else
    bad "useApnStatusChip never references network.apn -- it does not read the poller's granted APN"
fi

# -----------------------------------------------------------------------------
printf '\n[2] ...and no longer derives live/not-live from cids[].apn\n'
# The cids.find(...) -> .apn -> compare chain is the defect: it compares two
# readings of the SAME PDP-context snapshot the CID Select also consumes,
# instead of the poller's independent network.apn. Scoped to the helper's own
# line range -- cids is a legitimate prop of the card and the CID Select
# elsewhere in this file, and must not be flagged there.
if [ -s "$TMPD/chip.raw" ] && grep -qE 'cids(\?)?\.find\(' "$TMPD/chip.code"; then
    grep -nE 'cids(\?)?\.find\(' "$TMPD/chip.code" | show
    bad "useApnStatusChip still derives its verdict from cids.find(...).apn"
else
    ok "useApnStatusChip no longer derives its verdict from cids.find(...).apn"
fi

# -----------------------------------------------------------------------------
printf '\n[3] The deactivate button is gated on a positive active state\n'
if grep -q 'active === 1' "$TMPD/card.code"; then
    ok "apn-settings-card.tsx gates the button on active === 1"
else
    bad "no 'active === 1' in apn-settings-card.tsx"
fi
if grep -q 'active !== 0' "$TMPD/card.code"; then
    grep -n 'active !== 0' "$TMPD/card.code" | show
    bad "apn-settings-card.tsx still gates the button on active !== 0 -- true for null too"
else
    ok "'active !== 0' is gone"
fi

# -----------------------------------------------------------------------------
printf '\n[4] The reserved-context guard is reachable with an empty context list\n'
# The Select offers FALLBACK_CIDS (1-6) even when the modem has not reported
# contexts. A guard that relies solely on contexts.find(...) misses on every
# one of those synthetic values, so a data APN can land on the IMS/emergency
# context with no confirmation.
if grep -q 'const handleCidChange' "$TMPD/card.code"; then
    awk '/const handleCidChange = /,/^  \};/' "$TMPD/card.code" > "$TMPD/cid-handler.code"
else
    # The fix may rename the handler; fall back to the whole card file rather
    # than passing vacuously on a symbol that no longer exists.
    cp "$TMPD/card.code" "$TMPD/cid-handler.code"
fi
if grep -qE 'contexts\.length[[:space:]]*===[[:space:]]*0|!contexts\.length|contexts\.length[[:space:]]*<[[:space:]]*1|RESERVED|FALLBACK_RESERVED' "$TMPD/cid-handler.code"; then
    ok "a fallback-reserved path exists alongside contexts.find(...)"
else
    bad "the reserved-context guard is only reachable via contexts.find(...) -- an empty/short cids[] bypasses it entirely"
fi

# -----------------------------------------------------------------------------
printf '\n[5] The card has a never-read branch: CARD_NOTICE is imported and used\n'
if grep -qE 'import[^;]*\bCARD_NOTICE\b[^;]*from ["'"'"']\.\./shapes' "$CARD_FILE" \
    || grep -qE '^\s*CARD_NOTICE,?\s*$' "$CARD_FILE"; then
    ok "apn-settings-card.tsx imports CARD_NOTICE"
else
    bad "apn-settings-card.tsx never imports CARD_NOTICE"
fi
if grep -q 'CARD_NOTICE' "$TMPD/card.code"; then
    ok "CARD_NOTICE is referenced in the component body"
else
    bad "CARD_NOTICE is imported nowhere and used nowhere -- no never-read-branch line exists"
fi

# -----------------------------------------------------------------------------
printf '\n[6] The MBN empty block is gated on a real read (profiles !== null)\n'
if grep -qE 'profiles[[:space:]]*!==[[:space:]]*null' "$TMPD/mbn.code"; then
    ok "mbn-card.tsx checks profiles !== null"
else
    bad "mbn-card.tsx never checks profiles !== null -- 'not read yet' and 'read, and empty' render the same branch"
fi
# The EMPTY_BLOCK render itself must sit behind that guard, not merely exist
# somewhere in the file alongside it -- checked as "the guard appears in the
# few lines immediately before the EMPTY_BLOCK.ROOT render."
if grep -B3 'EMPTY_BLOCK.ROOT' "$TMPD/mbn.code" | grep -qE 'profiles[[:space:]]*!==[[:space:]]*null'; then
    ok "the EMPTY_BLOCK branch is guarded by profiles !== null nearby"
else
    bad "EMPTY_BLOCK.ROOT does not sit behind a profiles !== null check"
fi

# -----------------------------------------------------------------------------
printf '\n[7] The granted card consumes poller staleness\n'
if grep -qE '\bisStale\b' "$TMPD/page.code"; then
    ok "isStale appears in apn-settings.tsx"
else
    bad "isStale never appears in apn-settings.tsx -- useModemStatus() exposes it but the page never reads it"
fi
if grep -B3 '<NetworkGrantedCard' "$TMPD/page.code" | grep -q 'isStale'; then
    ok "isStale is passed into <NetworkGrantedCard"
else
    bad "isStale is not passed into <NetworkGrantedCard -- the card cannot show a frozen reading"
fi

# -----------------------------------------------------------------------------
printf '\n[8] ...and does not reintroduce a freshness counter\n'
# The elapsed-seconds "N seconds ago" chip was removed by product decision
# (see the page's own header comment). isStale is a boolean signal, not a
# ticking clock -- an "ago" string anywhere in the granted-card i18n keys
# would be that clock coming back.
if grep -oE '"[a-z_]*ago[a-z_]*"[[:space:]]*:' "$LOCALES/en/cellular.json" \
    | grep -viE 'stage|cargo|category' | grep -q .; then
    grep -noE '"[a-z_]*ago[a-z_]*"[[:space:]]*:' "$LOCALES/en/cellular.json" | show
    bad "an 'ago'-style i18n key exists in en/cellular.json"
else
    ok "no 'ago'-style elapsed-seconds i18n key in en/cellular.json"
fi

# -----------------------------------------------------------------------------
printf '\n[9] Band order: the granted card renders before the write card\n'
granted_line=$(grep -n '<NetworkGrantedCard' "$TMPD/page.code" | head -1 | cut -d: -f1 || true)
write_line=$(grep -n '<ApnSettingsCard' "$TMPD/page.code" | head -1 | cut -d: -f1 || true)
if [ -z "$granted_line" ] || [ -z "$write_line" ]; then
    bad "could not locate both <NetworkGrantedCard and <ApnSettingsCard JSX -- assertion 9 cannot be evaluated"
elif [ "$granted_line" -lt "$write_line" ]; then
    ok "<NetworkGrantedCard (line $granted_line) precedes <ApnSettingsCard (line $write_line)"
else
    bad "<NetworkGrantedCard (line $granted_line) renders AFTER <ApnSettingsCard (line $write_line) -- live truth is buried below the write surfaces"
fi

# -----------------------------------------------------------------------------
printf '\n[10] MBN is outside the override <fieldset>\n'
fs_open=$(grep -n '<fieldset' "$TMPD/page.code" | head -1 | cut -d: -f1 || true)
fs_close=$(grep -n '</fieldset>' "$TMPD/page.code" | head -1 | cut -d: -f1 || true)
mbn_line=$(grep -n '<MBNCard' "$TMPD/page.code" | head -1 | cut -d: -f1 || true)
if [ -z "$fs_open" ] || [ -z "$fs_close" ] || [ -z "$mbn_line" ]; then
    bad "could not locate <fieldset>, </fieldset> and <MBNCard -- assertion 10 cannot be evaluated"
elif [ "$mbn_line" -gt "$fs_open" ] && [ "$mbn_line" -lt "$fs_close" ]; then
    bad "<MBNCard (line $mbn_line) is INSIDE the fieldset ($fs_open-$fs_close) -- a profile owning the APN also locks MBN bundle selection"
else
    ok "<MBNCard (line $mbn_line) sits outside the fieldset ($fs_open-$fs_close)"
fi

# -----------------------------------------------------------------------------
printf '\n[11] No unconditional warning banner in mbn-card.tsx\n'
# A TonalBanner tone="warning" with no enclosing conditional (ternary or &&)
# renders on every load state -- loaded, loading, empty, error alike.
tr '\n' ' ' < "$TMPD/mbn.code" > "$TMPD/mbn.flat"
if grep -oE '\{[^{}]{0,200}TonalBanner tone="warning"' "$TMPD/mbn.flat" | grep -qE '\?|&&'; then
    ok "the warning TonalBanner is behind a conditional"
else
    if grep -q 'TonalBanner tone="warning"' "$TMPD/mbn.code"; then
        bad "mbn-card.tsx renders <TonalBanner tone=\"warning\"> with no enclosing {cond && ...} / ternary"
    else
        ok "no TonalBanner tone=\"warning\" in mbn-card.tsx"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[12] The save path distinguishes a lost response from a refusal\n'
# save()'s catch block is where a transport failure (HTTP throw, or the
# attach-cycle's ~4s eth0 drop killing the response mid-flight) lands. It must
# call the same reconcile the success path uses, not merely set an error --
# the write likely still landed even though the response never arrived.
awk '/const save = useCallback\(/,/^  \);/' "$TMPD/hook.code" > "$TMPD/save.code"
if [ ! -s "$TMPD/save.code" ]; then
    bad "save() not found in use-apn-settings.ts -- assertion 12 cannot be evaluated"
else
    awk '/} catch \(err\) \{/,/^      \}/' "$TMPD/save.code" > "$TMPD/save-catch.code"
    if grep -q 'scheduleReconcile' "$TMPD/save-catch.code"; then
        ok "save()'s catch block calls scheduleReconcile()"
    else
        bad "save()'s catch block only sets an error -- a lost HTTP response (e.g. the attach cycle's eth0 drop) is reported as a refusal, and the optimistic write is never reconciled"
    fi
fi

# -----------------------------------------------------------------------------
printf '\n[13] The save notice names the Ethernet/wired session\n'
notice=$(node -e '
    const p = require(process.argv[1]);
    process.stdout.write(p?.core_settings?.apn?.save_connection_notice ?? "");
' "$LOCALES/en/cellular.json")
if [ -z "$notice" ]; then
    bad "core_settings.apn.save_connection_notice is missing from en/cellular.json"
elif printf '%s' "$notice" | grep -qiE 'ethernet|wired|usb'; then
    ok "save_connection_notice mentions the Ethernet/wired case: \"$notice\""
else
    printf '       current value: %s\n' "$notice"
    bad "save_connection_notice never mentions the Ethernet/wired session -- a USB-Ethernet-uplinked technician is not warned that THEIR session is the one about to drop"
fi

# -----------------------------------------------------------------------------
printf '\n[14] READOUT_ROW is still exported from shapes.ts and imported by apn-settings.tsx (KEEP)\n'
if grep -qE '^export const READOUT_ROW\b' "$SHAPES"; then
    ok "shapes.ts still exports READOUT_ROW"
else
    bad "shapes.ts no longer exports READOUT_ROW -- this is a live regression, not a cleanup"
fi
if grep -qE '\bREADOUT_ROW\b' "$PAGE_FILE"; then
    ok "apn-settings.tsx still imports/uses READOUT_ROW"
else
    bad "apn-settings.tsx no longer references READOUT_ROW -- guards against an over-broad delete"
fi

# -----------------------------------------------------------------------------
printf '\n[15] PAGE_GRID stays removed (REMOVED)\n'
# This used to be a KEEP for an export that no longer exists: the two-column
# PAGE_GRID was deliberately retired from the settings family's shapes.ts (the
# only surviving mentions are the explanatory comments in apn-settings.tsx that
# record why). Inverted rather than deleted, so the removal stays guarded and
# the assertion numbering does not shift.
if grep -qE '^export const PAGE_GRID\b' "$SHAPES"; then
    bad "shapes.ts re-exports PAGE_GRID -- the two-column page grid was removed on purpose"
else
    ok "shapes.ts still has no PAGE_GRID export"
fi
if grep -qE '^[[:space:]]*import\b.*\bPAGE_GRID\b' "$PAGE_FILE"; then
    bad "apn-settings.tsx imports PAGE_GRID -- the removed two-column grid is back"
else
    ok "apn-settings.tsx does not import PAGE_GRID"
fi

# -----------------------------------------------------------------------------
printf '\n[16] The One-Scale, Tone and Shape ratchet -- comment-stripped source\n'
# This surface arrived clean: no lucide imports, no raw Tailwind colours, no
# legacy radii, no untokenized durations, no transition-all, no alpha washes.
# There is no token sweep in this change -- this assertion exists purely so
# the re-authoring cannot introduce what the incumbent already avoided.
for pair in "page.code:apn-settings.tsx" \
            "card.code:apn-settings-card.tsx" \
            "mbn.code:mbn-card.tsx"; do
    code="$TMPD/${pair%%:*}"
    name="${pair##*:}"
    hits=$(grep -nE 'duration-\[[0-9]|transition-all|ease-\[cubic-bezier|rounded-(sm|md|lg|xl)([^a-z-]|$)|variant="outline"|(text|bg|border|ring)-(red|green|blue|yellow|orange|amber|purple|violet|pink|gray|grey|slate|zinc|neutral|stone|emerald|teal|cyan|sky|indigo|rose|lime|fuchsia)-[0-9]' \
        "$code" || true)
    if [ -n "$hits" ]; then
        printf '%s\n' "$hits" | show
        bad "$name violates a One-Scale / Tone / Shape rule"
    else
        ok "$name is clean of literal durations, transition-all, raw colours, off-scale radii and outline-as-status-chip"
    fi
done
# variant="outline" used as a STATUS chip specifically: any variant="outline"
# on a <Badge is the violation; on a plain shadcn control (e.g. a ghost-style
# Button) it would not be. None of the three files use outline on Badge at all
# today, so this passes vacuously and correctly in the red run.
for pair in "page.code:apn-settings.tsx" "card.code:apn-settings-card.tsx" "mbn.code:mbn-card.tsx"; do
    code="$TMPD/${pair%%:*}"
    name="${pair##*:}"
    if grep -qE '<Badge[^>]*variant="outline"' "$code"; then
        grep -nE '<Badge[^>]*variant="outline"' "$code" | show
        bad "$name uses variant=\"outline\" on a Badge -- status chips are never outline"
    else
        ok "$name never uses variant=\"outline\" on a Badge"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[17] The retired row-promotion pattern stays retired -- comment-stripped source\n'
for pair in "page.code:apn-settings.tsx" \
            "card.code:apn-settings-card.tsx" \
            "mbn.code:mbn-card.tsx" \
            "shapes.code:shapes.ts"; do
    code="$TMPD/${pair%%:*}"
    name="${pair##*:}"
    hits=$(grep -nE 'FIELD_SHELL_ON_FILL|SELECT_TRIGGER_ON_FILL|SEGMENTED\.SEGMENT_ON_FILL|SEGMENTED\.TRACK_ON_FILL|SETTING_ROW_DIRTY\.ROOT|onFill=' \
        "$code" || true)
    if [ -n "$hits" ]; then
        printf '%s\n' "$hits" | show
        bad "$name still carries the retired row-promotion pattern"
    else
        ok "$name carries none of the retired row-promotion symbols"
    fi
done

# -----------------------------------------------------------------------------
printf '\n[18] The CID chip wording is unchanged\n'
# Hardcoded expected values from the CURRENT tree -- this pins the copy so a
# fix touching the chip logic (assertion 1/2) cannot also silently reword it.
EXPECT_CID_IN_USE='CID {{cid}} in use for Internet'
EXPECT_CID_UNKNOWN='Internet context not reported'
actual_in_use=$(node -e '
    const p = require(process.argv[1]);
    process.stdout.write(p?.core_settings?.apn?.cid_in_use ?? "");
' "$LOCALES/en/cellular.json")
actual_unknown=$(node -e '
    const p = require(process.argv[1]);
    process.stdout.write(p?.core_settings?.apn?.cid_unknown ?? "");
' "$LOCALES/en/cellular.json")
if [ "$actual_in_use" = "$EXPECT_CID_IN_USE" ]; then
    ok "cid_in_use is byte-identical to its current form"
else
    printf '       expected: %s\n       actual:   %s\n' "$EXPECT_CID_IN_USE" "$actual_in_use"
    bad "cid_in_use changed"
fi
if [ "$actual_unknown" = "$EXPECT_CID_UNKNOWN" ]; then
    ok "cid_unknown is byte-identical to its current form"
else
    printf '       expected: %s\n       actual:   %s\n' "$EXPECT_CID_UNKNOWN" "$actual_unknown"
    bad "cid_unknown changed"
fi

printf '\n---------------------------------------------\n'
printf 'apn-management-design-language: %d passed, %d failed\n\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ]
