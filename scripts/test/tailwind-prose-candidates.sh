#!/usr/bin/env bash
# Tailwind-v4 prose-candidate harness.
#
# WHY THIS EXISTS
# ---------------
# `app/globals.css:1` is a bare `@import "tailwindcss"` with no @source
# narrowing, so Tailwind v4's automatic content detection scans EVERY
# non-gitignored text file in the repo. Measured with Tailwind's own oxide
# Scanner on 2026-08-31: 983 files, 30513 candidates -- components/ (303),
# scripts/ (237), docs/ (124), installer-gui/ (43), hooks/ (59), lib/ (30),
# types/ (27), discord-bot/ (18), ping-daemon/ (15), .impeccable/ (5),
# .github/ (3), plus DESIGN.md, CLAUDE.md, PRODUCT.md, RELEASE_NOTES.md,
# LICENSE and package.json. Only gitignored paths and node_modules are exempt.
#
# The scanner does not parse TypeScript, Markdown or shell. It matches raw
# text. So a utility class written inside a CODE COMMENT, a doc sentence, or
# a shell printf string is extracted and compiled into real CSS exactly as if
# it had been applied to an element.
#
# Most malformed arbitrary values are harmless: an unparseable DECLARATION
# VALUE is stored verbatim and costs one dead rule. Four forms instead abort
# the entire stylesheet, and because `next dev` does not run Lightning CSS
# with error recovery, EVERY route returns 500 -- the app shell, not just the
# page that mentioned the class. That has fired twice in this repo already
# (see toggle-primitive-one-scale.sh's header, and commit 92781f8).
#
# WHAT THIS HARNESS DOES, AND DOES NOT, COVER
# -------------------------------------------
# The four FATAL families are caught mechanically and completely by the build
# gate -- scripts/test/build-css-gate.sh -- which fails on Tailwind's own
# "warnings while optimizing generated CSS" report. That gate is the real
# defense; prefer it. This harness covers the quieter cousin the build gate
# cannot see, because these forms produce warning-free but DEAD rules:
#
#   1. The bare-var arbitrary. Tailwind v4 dropped the shorthand that let a
#      custom property sit naked inside the brackets, so that spelling now
#      compiles to a declaration whose value is the property NAME rather than
#      its value. Parseable, therefore silent -- and discarded by the browser
#      at CSSOM, so it ships as NO transition rather than an off-scale one.
#      The correct spelling wraps the property in var() inside the brackets,
#      and that form is valid and deliberately NOT flagged here.
#
#   2. The placeholder arbitrary. A class written in prose with a stand-in
#      between the brackets instead of a real token -- an ellipsis, three
#      dots, an angle-bracketed word, a lone asterisk. These compile to junk
#      declarations today. They are also the attractive nuisance that causes
#      family 1 of the FATAL set: both live 500s began as someone spelling a
#      placeholder more "helpfully" inside a var().
#
# THE RULE, for anyone adding prose about arbitrary values:
#   Describe the correct spelling in WORDS. A concrete arbitrary value naming
#   a custom property that actually exists is fine -- it costs one dead
#   utility and breaks nothing. A placeholder inside the brackets is not.
#
# NOTE ON THIS FILE'S OWN PATTERNS
# --------------------------------
# Every bracket in every pattern below is composed from the $OB / $CB
# variables rather than written literally, so that this harness cannot itself
# emit the candidates it is policing. That is not stylistic caution: the two
# historical 500s were both caused by files whose SUBJECT was arbitrary-value
# classes, which is precisely where the density of near-miss spellings is
# highest and the blast radius is total. Do not "simplify" these back into
# literal brackets.
#
# Run from repo root: bash scripts/test/tailwind-prose-candidates.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }

# Bracket characters, never written literally. See the note above. These are
# spliced into ERE patterns, so they carry their own backslashes -- an
# unescaped bracket would open a character class instead of matching one.
OB='\['
CB='\]'
# Any run of characters that is not a closing bracket. Written as a negated
# class whose only member is "]", which ERE accepts in first position.
NOTC='[^]]'

# The set Tailwind actually scans: tracked, non-gitignored text files.
# `.claude/` is force-added (see project memory) but IS gitignored, so
# Tailwind's scanner never reads it -- excluding it here keeps this harness
# aligned with what actually compiles. Lockfiles are machine-generated.
mapfile -t SCANNED < <(git ls-files \
    -- '*.ts' '*.tsx' '*.js' '*.mjs' '*.md' '*.sh' '*.css' '*.rs' '*.py' '*.json' \
    | grep -vE '^(node_modules|out|\.claude)/' \
    | grep -vE '(package-lock\.json|bun\.lock)' || true)

if [ "${#SCANNED[@]}" -eq 0 ]; then
    bad "could not enumerate tracked files -- is this a git checkout?"
    printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
    exit 1
fi

# A Tailwind utility prefix followed by an opening bracket: at least one
# letter, then word characters, then a REQUIRED hyphen before the bracket.
# The trailing hyphen is what separates a real utility (`duration-[`) from a
# shell glob or regex character class (`custom-[0-9]*`, `[A-Za-z0-9.-]`),
# which is why this must not be relaxed to an optional one.
UTIL="[A-Za-z][A-Za-z0-9:_-]*-${OB}"
# Tailwind's arbitrary-PROPERTY longhand, `[property:value]` -- a different
# shape from the utility form above and separately able to carry a
# placeholder, so both are matched everywhere a placeholder is searched for.
ARBPROP="${OB}[A-Za-z-]+:"

report() {
    # $1 = human label, $2 = grep -E pattern, $3 = failure sentence
    local label="$1" pattern="$2" msg="$3" hits
    hits=$(grep -nE "$pattern" "${SCANNED[@]}" 2>/dev/null || true)
    if [ -n "$hits" ]; then
        printf '       offending lines:\n'
        printf '%s\n' "$hits" | sed 's/^/         /'
        bad "$msg"
    else
        ok "$label"
    fi
}

printf '\n[1] No bare-var arbitrary anywhere in the scanned tree\n'
# Matches a utility bracket opening directly onto a double dash -- the naked
# custom property. The valid var()-wrapped spelling opens onto "var(" and so
# does not match. Requires a closing bracket, since an unclosed fragment in a
# grep-pattern description is not a Tailwind candidate.
report "no bare-var arbitrary" \
    "${UTIL}--[A-Za-z0-9_-]+${CB}" \
    "a bare-var arbitrary is live -- it compiles to a declaration carrying the property NAME, which the browser discards"

printf '\n[2] No placeholder arbitrary in prose\n'
# Ellipsis (U+2026), three ASCII dots, an angle-bracketed stand-in word, or a
# lone asterisk sitting where a real value belongs.
report "no ellipsis placeholder" \
    "(${UTIL}|${ARBPROP})${NOTC}*…${NOTC}*${CB}" \
    "an ellipsis placeholder is live inside an arbitrary value"

report "no three-dot placeholder" \
    "(${UTIL}|${ARBPROP})${NOTC}*\.\.\.${NOTC}*${CB}" \
    "a three-dot placeholder is live inside an arbitrary value"

report "no angle-bracket placeholder" \
    "(${UTIL}|${ARBPROP})${NOTC}*<[A-Za-z_][A-Za-z0-9_-]*>${NOTC}*${CB}" \
    "an angle-bracketed placeholder is live inside an arbitrary value"

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
