# Runner UI Polish — Design

**Status:** Approved (brainstorming) — pending implementation plan.
**Branch:** `feat/pre-build-test-gate` (continuation; commits land on top of the existing 9-commit gate work).

## Problem

`scripts/test/run-all.sh` currently prints plain ASCII output: `== section name ==` headers, `PASS` / `FAIL` / `WARN` words, no color, no glyphs, no end-of-run summary. It's correct but visually flat — section boundaries are hard to scan, the final `gate PASS` line gets lost in the harness chatter, and the operator has to skim the whole log to know what each section actually did.

## Goal

Add a thin presentation layer to `run-all.sh` that:

1. Distinguishes section boundaries with bold headers and Unicode rule lines.
2. Replaces `PASS` / `FAIL` / `WARN` words with `✓` / `✗` / `⚠` glyphs in the runner's own output (Sections 1 and 2; harness sections still emit their own plain output).
3. Color-codes status lines (green / red / yellow + bold for emphasis) using ANSI escapes when stdout is a TTY, falling back to plain ASCII when piped or redirected.
4. Renders an end-of-run summary box that reports each section's status at a glance.
5. Keeps the gate's exit-code contract unchanged (0 on pass, non-zero on fail).

The polish is bounded to one file. No harness changes. No new dependencies.

## Architecture

A small color/glyph helper block is added near the top of `run-all.sh`, after `REPO_ROOT=`. It mirrors the TTY-detection convention already established in `build.sh`. The existing `section()` / `ok()` / `bad()` / `warn()` helpers are rewritten to use the new variables. Three status-tracking variables (`status_glyph_syntax`, `status_glyph_crlf`, `status_glyph_harn`) are populated as each section runs, plus a `gate_failed_at` string and `START_TIME` for elapsed-time reporting. At the end of the file the existing single `gate PASS` / `gate FAIL` line is replaced with a colored block plus a summary box.

Section 1 (syntax check) keeps its fail-fast behavior — on syntax errors the gate exits immediately without rendering the summary box, since downstream sections would be running against known-broken scripts. Sections 2 and 3 always reach the summary block.

## Components

### 1. Color/glyph helper block (top of `run-all.sh`)

Inserted immediately after `REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"`:

```bash
START_TIME=$(date +%s)

# TTY-detected color and glyph helpers — mirrors build.sh convention.
if [ -t 1 ]; then
    GREEN='\033[0;32m' RED='\033[0;31m' YELLOW='\033[0;33m'
    BOLD='\033[1m' DIM='\033[2m' NC='\033[0m'
    GLYPH_OK='\xe2\x9c\x93'    # ✓
    GLYPH_FAIL='\xe2\x9c\x97'  # ✗
    GLYPH_WARN='\xe2\x9a\xa0'  # ⚠
    HRULE='\xe2\x94\x81'       # ━ (heavy horizontal)
    BOX_TL='\xe2\x94\x8c' BOX_TR='\xe2\x94\x90'
    BOX_BL='\xe2\x94\x94' BOX_BR='\xe2\x94\x98'
    BOX_H='\xe2\x94\x80'  BOX_V='\xe2\x94\x82'
else
    GREEN='' RED='' YELLOW='' BOLD='' DIM='' NC=''
    GLYPH_OK='[OK]' GLYPH_FAIL='[FAIL]' GLYPH_WARN='[WARN]'
    HRULE='='
    BOX_TL='+' BOX_TR='+' BOX_BL='+' BOX_BR='+' BOX_H='-' BOX_V='|'
fi

# Status trackers populated by each section; consumed by the summary block.
gate_failed=0
gate_failed_at=""
syntax_total=0
crlf_count=0
crlf_summary=""
status_glyph_syntax=""
status_glyph_crlf=""
status_glyph_harn=""
harness_pass=0
harness_total=0
```

### 2. Updated helpers

```bash
_repeat() {
    # _repeat <char-bytes> <count>
    local i=0
    while [ "$i" -lt "$2" ]; do
        printf '%b' "$1"
        i=$((i + 1))
    done
}

section() {
    local title="$1"
    local pad=$((58 - ${#title}))
    [ "$pad" -lt 4 ] && pad=4
    printf "\n${BOLD}%b%b %s %b${NC}\n" \
        "$HRULE" "$HRULE" "$title" "$(_repeat "$HRULE" "$pad")"
}

ok()   { printf "  ${GREEN}%b${NC} %s\n" "$GLYPH_OK"   "$1"; }
bad()  { printf "  ${RED}%b${NC} %s\n"   "$GLYPH_FAIL" "$1"; }
warn() { printf "  ${YELLOW}%b${NC} %s\n" "$GLYPH_WARN" "$1"; }
```

### 3. Section 1 changes (syntax check)

- After `ok "$syntax_total scripts parsed cleanly"`, set `status_glyph_syntax=$GLYPH_OK`.
- If syntax fails, set `status_glyph_syntax=$GLYPH_FAIL`, `gate_failed=1`, `gate_failed_at="bash -n syntax check"`, **then call the final-block renderer with the fail-fast path** (no summary box) and exit 1. This preserves the current fail-fast behavior.

### 4. Section 2 changes (CRLF detector)

- The existing `crlf_files`/`crlf_count` variables already exist; this commit just wires them into the summary tracker. After the if/else:
  - If warnings: `status_glyph_crlf=$GLYPH_WARN`, set `crlf_summary="$crlf_count warnings"`.
  - If clean: `status_glyph_crlf=$GLYPH_OK`, set `crlf_summary="clean"`.

### 5. Section 3 changes (harnesses)

- Count total harnesses ahead of the loop (one extra `for` to count `*.sh` files matching, excluding `run-all.sh`).
- Increment `harness_pass` after each successful harness invocation.
- On failure: `status_glyph_harn=$GLYPH_FAIL`, `gate_failed=1`, `gate_failed_at="$rel"`, break the loop, fall through to the final block.
- On all-pass: `status_glyph_harn=$GLYPH_OK`.

### 6. Final block (replaces existing `printf '\ngate PASS\n'`)

```bash
elapsed=$(($(date +%s) - START_TIME))

if [ "$gate_failed" -eq 0 ]; then
    printf "\n  ${GREEN}${BOLD}%b gate PASS${NC} ${DIM}(${elapsed}s)${NC}\n\n" "$GLYPH_OK"
else
    printf "\n  ${RED}${BOLD}%b gate FAIL: %s${NC} ${DIM}(${elapsed}s)${NC}\n\n" \
        "$GLYPH_FAIL" "$gate_failed_at"
fi

# Summary box (38-char interior).
printf "  ${DIM}%b%b%b Summary %b%b${NC}\n" "$BOX_TL" "$BOX_H" "$BOX_H" "$(_repeat "$BOX_H" 28)" "$BOX_TR"
printf "  ${DIM}%b${NC}  %b ${DIM}%-18s${NC} %16s ${DIM}%b${NC}\n" "$BOX_V" "$status_glyph_syntax" "Syntax check" "$syntax_total scripts" "$BOX_V"
printf "  ${DIM}%b${NC}  %b ${DIM}%-18s${NC} %16s ${DIM}%b${NC}\n" "$BOX_V" "$status_glyph_crlf"   "CRLF check"   "$crlf_summary"        "$BOX_V"
printf "  ${DIM}%b${NC}  %b ${DIM}%-18s${NC} %16s ${DIM}%b${NC}\n" "$BOX_V" "$status_glyph_harn"   "Harnesses"    "$harness_pass/$harness_total pass" "$BOX_V"
printf "  ${DIM}%b%b${NC}\n\n" "$BOX_BL" "$(_repeat "$BOX_H" 38)"
exit "$gate_failed"
```

The `exit "$gate_failed"` at the end replaces the implicit-success exit. `gate_failed` is 0 (success) or 1 (failure).

The Section 1 fail-fast path bypasses the summary box but still uses the colored gate-FAIL line and `exit 1`.

## Failure UX

### Happy path
```
━━ bash -n syntax check ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ 110 scripts parsed cleanly

━━ CRLF check (warn-only) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ⚠ CRLF line endings found in 5 file(s):
    scripts/etc/sudoers.d/qmanager
    [...]
  ⚠ Set your editor to LF — installer normalizes on-device, but this is a misconfig signal.

━━ scripts/test/health-check-redaction.sh ━━━━━━━━━━━━━━━━━━
OK: all redactions applied

[remaining harnesses...]

  ✓ gate PASS  (7s)

  ┌── Summary ────────────────────────────┐
  │  ✓ Syntax check          110 scripts  │
  │  ⚠ CRLF check             5 warnings  │
  │  ✓ Harnesses               4/4 pass   │
  └────────────────────────────────────────┘
```

### Section 1 fail (fast — no summary)
```
━━ bash -n syntax check ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✗ /path/scripts/usr/bin/qmanager_poller
    syntax error: unexpected end of file
  ✗ 1 of 110 scripts have syntax errors

  ✗ gate FAIL: bash -n syntax check  (1s)
```

### Section 3 fail (full summary)
Last harness fails, summary shows partial state. `gate_failed_at` carries the offending harness path.

### Non-TTY fallback
All colors stripped, glyphs replaced with `[OK]`/`[FAIL]`/`[WARN]`, `━` becomes `=`, box characters become `+--+|`. Output remains valid plain text in pipes, log files, and CI capture.

## Scope

### In scope
- Single-file modification: `scripts/test/run-all.sh`
- TTY detection, color helpers, glyph helpers, status trackers, summary box
- Updated `section/ok/bad/warn` helpers
- New `_repeat` helper
- Single commit on top of `feat/pre-build-test-gate`

### Out of scope
- Modifying any harness's own output (the four files in `scripts/test/*.sh` other than `run-all.sh`)
- `.gitattributes` rules for `*.rules` and `sudoers.d/*` (separate follow-up; was raised by the previous final reviewer)
- Changes to `package.json`, `build.sh`, `RELEASE_NOTES.md`, or any other file
- New harnesses or new test coverage
- Refactoring the runner's section structure beyond what's needed to populate status trackers

### Open at plan time
- Exact final box-summary column widths — will tune during implementation to match the longest expected status text without truncation
- Whether `printf '%b'` with the `\xe2\x9c\x93`-style byte-escapes renders correctly on the local Git Bash (will verify during the first run; if the encoded bytes don't decode, switch to literal `✓` glyphs)

## Done criteria

- `bash scripts/test/run-all.sh` on a TTY shows colored output, glyphs, bold section headers, and the end summary box.
- Same command piped to a file (`bash scripts/test/run-all.sh > /tmp/out.log`) shows clean ASCII fallback (no escape codes, glyphs as `[OK]`/`[FAIL]`/`[WARN]`, ASCII box).
- Existing exit-code contract preserved: 0 on full pass, non-zero on any Section 1/Section 3 failure.
- Section 1 failure still aborts before Section 2/Section 3 — fail-fast preserved.
- Section 2 warnings (CRLF) no longer cause non-zero exit.
- `bun run package` integration unchanged — gate runs first, fails-fast, and produces the new pretty output.
- All 4 harnesses still execute and pass under the runner.
- Single commit, conventional message.
