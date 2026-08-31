#!/usr/bin/env bash
# Production build, gated on Tailwind's own CSS-optimizer report.
#
# WHY THIS EXISTS
# ---------------
# Tailwind v4 scans every non-gitignored file in the repo, so a utility class
# written inside a code comment, a doc sentence or a shell string is compiled
# into real CSS. Four shapes of malformed arbitrary value do not merely emit a
# dead rule -- they make the stylesheet UNPARSEABLE, and because `next dev`
# hands raw CSS to Turbopack without an error-recovery pass, every route in the
# app returns 500. Not the page that mentioned the class: every route,
# including the shell.
#
#   1. `var()` or `env()` whose first argument is not exactly one valid dashed
#      identifier followed by a comma or a closing paren -- at ANY nesting
#      depth, so a calc() wrapping a bad var() counts too.
#   2. An arbitrary VARIANT that yields an invalid selector.
#   3. An arbitrary PROPERTY whose NAME is invalid. (The value side is
#      tolerated; only the name is validated.)
#   4. An arbitrary MEDIA or CONTAINER query that does not parse.
#
# This has fired twice: once from a `*` wildcard in a comment, and again in
# commit 92781f8 from a `...` placeholder -- both times inside a file whose
# SUBJECT was arbitrary-value classes, which is exactly where near-miss
# spellings cluster and where the blast radius is total.
#
# WHY GATE ON THE BUILD INSTEAD OF GREPPING FOR THE SPELLINGS
# -----------------------------------------------------------
# Because the build already knows. Tailwind's PostCSS plugin runs an
# optimization pass whenever NODE_ENV is production, and that pass runs
# Lightning CSS with error recovery ENABLED -- so `next build` prints
#
#     Found N warnings while optimizing generated CSS
#
# with a full code frame naming the offending class, then DROPS the rule and
# exits 0. The signal is complete and already paid for; nothing consumed it.
# `next dev` skips that pass entirely, which is the whole of the dev/build
# divergence. A grep for known-bad spellings can only ever cover the shapes
# somebody thought to write down; this covers all four families above and any
# future one, with no prose heuristics.
#
# A NOTE FOR WHOEVER HITS THIS NEXT: THE 500 LATCHES.
# Removing the offending text does NOT recover a dev server that has already
# failed. Measured 2026-08-31: after the bad file was deleted, every route
# stayed 500 for 12 consecutive polls across 60 seconds, still logging a rule
# from a file that no longer existed. Only a cold restart cleared it. Do not
# conclude your fix was wrong -- stop the dev server and start it again.
#
# Run from repo root: bash scripts/test/build-css-gate.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# The sentence Tailwind's optimizer prints. Matched loosely enough to survive
# the singular/plural swap at one warning.
MARKER='while optimizing generated CSS'

LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT

echo "[build-css-gate] running production build..."
# The build's own output must still stream to the terminal, so tee rather than
# capture. PIPESTATUS carries the build's exit code past the pipe.
bun --bun next build 2>&1 | tee "$LOG"
build_rc=${PIPESTATUS[0]}

if [ "$build_rc" -ne 0 ]; then
    echo "[build-css-gate] build failed (exit $build_rc) -- not a CSS-gate failure" >&2
    exit "$build_rc"
fi

if grep -q "$MARKER" "$LOG"; then
    echo ""                                                                   >&2
    echo "[build-css-gate] FAIL: the CSS optimizer reported warnings."        >&2
    echo ""                                                                   >&2
    grep -B2 -A12 "$MARKER" "$LOG" >&2
    echo ""                                                                   >&2
    echo "  These are NOT cosmetic. The rule named above is dropped from the" >&2
    echo "  production bundle, so the build exits 0 and the page looks fine"  >&2
    echo "  -- but 'next dev' does not run the pass that recovered from it,"  >&2
    echo "  so EVERY route returns 500 in development."                       >&2
    echo ""                                                                   >&2
    echo "  The class named in the code frame above is almost certainly"      >&2
    echo "  quoted in PROSE -- a code comment, a doc sentence, or a shell"    >&2
    echo "  string -- not applied to an element. Tailwind scans those files"  >&2
    echo "  too. Describe the spelling in words instead of writing it as a"   >&2
    echo "  class, and see scripts/test/tailwind-prose-candidates.sh."        >&2
    echo ""                                                                   >&2
    exit 1
fi

echo "[build-css-gate] PASS: build clean, no CSS optimizer warnings"
