# Runner UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add color, glyphs, and an end-of-run summary box to `scripts/test/run-all.sh` so the pre-build test gate's output is scannable at a glance, while preserving the gate's exit-code contract and fail-fast behavior.

**Architecture:** Single-file modification. Add a TTY-detected color/glyph/tracker helper block at the top of `run-all.sh` (mirrors `build.sh`'s convention), rewrite the four output helpers (`section`/`ok`/`bad`/`warn`) to consume the new variables, wire status trackers into each section, and replace the existing single `gate PASS` / `gate FAIL` line with a colored block plus a summary box. Harness output (Section 3 invocations) stays plain — out of scope per the spec.

**Tech Stack:** POSIX-`bash`, ANSI escape codes, UTF-8 byte-encoded glyphs (`\xe2\x9c\x93` etc.) for cross-platform safety.

---

## Pre-flight

- [ ] **Confirm branch and HEAD.**

  ```bash
  git rev-parse --abbrev-ref HEAD
  git log -1 --oneline
  git status --porcelain
  ```

  Expected: branch is `feat/pre-build-test-gate`, HEAD is `3120692 docs(release-notes): note pre-build test gate under v0.1.7 improvements` (or later if more polish work has landed since), no uncommitted changes besides the gitignored `docs/superpowers/` files.

- [ ] **Confirm gate currently passes.**

  ```bash
  bash scripts/test/run-all.sh
  echo "exit was: $?"
  ```

  Expected: ends with `gate PASS`, exit 0. The current output is the plain-ASCII baseline this work is replacing.

---

## Task 1: Add color/glyph helper block + tracker variables

Add the TTY-detection-driven color/glyph variables, status trackers, and a `_repeat` helper. No behavior change yet — these variables are not yet consumed by anything. The existing helpers and sections continue to work as before.

**Files:**
- Modify: `scripts/test/run-all.sh:12-13` (insert block after `REPO_ROOT=` line)

- [ ] **Step 1: Read the current file to confirm the insertion point.**

  ```bash
  sed -n '10,15p' scripts/test/run-all.sh
  ```

  Expected output:
  ```
  set -eu

  REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

  # Output helpers — same shape as the existing harnesses.
  section() { printf '\n== %s ==\n' "$1"; }
  ```

  The new block lands between line 12 (`REPO_ROOT=`) and line 14 (`# Output helpers`).

- [ ] **Step 2: Insert the helper block.**

  Use the Edit tool to insert the following block after the `REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"` line and before the `# Output helpers — ...` comment. Match indentation (no leading whitespace on the new block):

  ```bash
  REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

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

  # _repeat <byte-string> <count> — emits the byte string N times via printf '%b'.
  _repeat() {
      local i=0
      while [ "$i" -lt "$2" ]; do
          printf '%b' "$1"
          i=$((i + 1))
      done
  }

  # Output helpers — same shape as the existing harnesses.
  ```

  Note: the closing `# Output helpers — same shape as the existing harnesses.` comment line is the existing line 14 — DO NOT duplicate it. Place the new block such that the existing comment becomes the line immediately after `_repeat`'s closing brace + blank line.

- [ ] **Step 3: Verify the file still parses and the gate still passes.**

  ```bash
  bash -n scripts/test/run-all.sh
  bash scripts/test/run-all.sh
  echo "exit was: $?"
  ```

  Expected:
  - `bash -n` exits 0 (no syntax errors introduced).
  - Gate output is identical to before (no visual change yet — the new helpers and trackers are unused so far).
  - Exit code 0.

- [ ] **Step 4: Verify CRLF check.**

  ```bash
  grep -cU $'\r' scripts/test/run-all.sh
  ```

  Expected: 0.

- [ ] **Step 5: Commit.**

  ```bash
  git add scripts/test/run-all.sh
  git commit -m "test(run-all): add color/glyph helper block and status trackers"
  ```

---

## Task 2: Replace `section`/`ok`/`bad`/`warn` helpers to use color + glyphs

Rewrite the four output helpers to consume the variables added in Task 1. After this task, the gate's output gains color and glyphs (TTY) or `[OK]`/`[FAIL]`/`[WARN]` markers (non-TTY). Section banners switch from `==` to `━━` (or `==` on non-TTY).

**Files:**
- Modify: `scripts/test/run-all.sh` (replace the `section`/`ok`/`bad`/`warn` definitions, currently four single-line functions)

- [ ] **Step 1: Locate the current helper definitions.**

  ```bash
  grep -n '^\(section\|ok\|bad\|warn\)()' scripts/test/run-all.sh
  ```

  Expected: four lines reporting the line numbers of the four helper definitions. Before this task they are single-line `printf` wrappers. After Task 1 they sit immediately after the `_repeat` function — line numbers will have shifted from the original 15–18 by the size of the Task 1 insertion.

- [ ] **Step 2: Replace the four helper definitions.**

  Use the Edit tool with the `old_string`:

  ```bash
  # Output helpers — same shape as the existing harnesses.
  section() { printf '\n== %s ==\n' "$1"; }
  ok()      { printf '  PASS  %s\n' "$1"; }
  bad()     { printf '  FAIL  %s\n' "$1"; }
  warn()    { printf '  WARN  %s\n' "$1"; }
  ```

  And the `new_string`:

  ```bash
  # Output helpers — colored + glyph variants. Falls back to ASCII on non-TTY.
  section() {
      local title="$1"
      local pad=$((58 - ${#title}))
      [ "$pad" -lt 4 ] && pad=4
      printf "\n${BOLD}%b%b %s %b${NC}\n" \
          "$HRULE" "$HRULE" "$title" "$(_repeat "$HRULE" "$pad")"
  }
  ok()   { printf "  ${GREEN}%b${NC} %s\n"  "$GLYPH_OK"   "$1"; }
  bad()  { printf "  ${RED}%b${NC} %s\n"    "$GLYPH_FAIL" "$1"; }
  warn() { printf "  ${YELLOW}%b${NC} %s\n" "$GLYPH_WARN" "$1"; }
  ```

  Notes for the implementer:
  - `${BOLD}`, `${GREEN}` etc. expand to literal `\033[...m` text via single-quoted assignment in Task 1 (bash does not interpret backslashes in single quotes). When that text appears in `printf`'s **format-string argument**, `printf` decodes `\033` as ESC — so the terminal sees real escape sequences. This works because `printf`'s first argument is the format string and gets escape interpretation; subsequent `%s`/`%b` arguments do not (which is why `%b` is needed for `$GLYPH_OK` to decode `\xe2\x9c\x93` into UTF-8 bytes).
  - The `section()` function builds a banner like `━━ <title> ━━━━━━━━━━━...` padded to roughly 60 chars. The `${#title}` expansion gives byte length of the title; for ASCII titles this matches visual width. `pad` is clamped to ≥4.

- [ ] **Step 3: Verify the file still parses.**

  ```bash
  bash -n scripts/test/run-all.sh
  ```

  Expected: exits 0.

- [ ] **Step 4: Run the gate on a TTY. Confirm colored output appears.**

  ```bash
  bash scripts/test/run-all.sh
  echo "exit was: $?"
  ```

  Expected:
  - Section headers render in **bold** with `━━` rule lines (or `==` on non-TTY shells).
  - `ok` lines show a green `✓` glyph followed by the message.
  - `warn` lines show a yellow `⚠` glyph followed by the message (CRLF section).
  - The final line is still the plain `gate PASS` (Task 4 replaces it).
  - Exit 0.

  If running over SSH/Git Bash and the glyphs render as boxes or `?`, terminal font may lack the chars — that's a workstation issue, not a code issue. The `[ -t 1 ]` check still detects TTY correctly; you can confirm TTY behavior independently with the next step.

- [ ] **Step 5: Verify the non-TTY fallback.**

  ```bash
  bash scripts/test/run-all.sh > /tmp/gate_out.log 2>&1
  echo "exit was: $?"
  head -20 /tmp/gate_out.log
  ```

  Expected:
  - Output to file shows `==` rule chars (not `━━`).
  - `[OK]` / `[WARN]` markers in place of glyphs.
  - No ANSI escape sequences (`\033[...m`) in the file.
  - Exit 0.

  Spot-check via `cat -v /tmp/gate_out.log | head -20` — `cat -v` makes any control characters visible as `^[[32m` etc. Expected: no such markers.

- [ ] **Step 6: Commit.**

  ```bash
  git add scripts/test/run-all.sh
  git commit -m "test(run-all): colorize section/ok/bad/warn helpers with glyphs"
  ```

---

## Task 3: Wire status trackers into Sections 1, 2, 3

Populate `status_glyph_syntax`, `status_glyph_crlf`, `crlf_summary`, `status_glyph_harn`, `harness_pass`, `harness_total`, and `gate_failed`/`gate_failed_at`. The trackers are populated but not yet consumed by any output — Task 4 wires them into the summary box. Visible behavior unchanged at this point.

**Files:**
- Modify: `scripts/test/run-all.sh` (Section 1 success path, Section 1 fail-fast path, Section 2 if/else, Section 3 loop)

- [ ] **Step 1: Section 1 — success path.**

  Locate the line:

  ```bash
  ok "$syntax_total scripts parsed cleanly"
  ```

  (It's the last line of Section 1's success branch, currently line 50 in the original file; numbers will have shifted by Task 1+2 insertions.)

  Use Edit with `old_string`:

  ```bash
  ok "$syntax_total scripts parsed cleanly"
  ```

  And `new_string`:

  ```bash
  ok "$syntax_total scripts parsed cleanly"
  status_glyph_syntax="$GLYPH_OK"
  ```

- [ ] **Step 2: Section 1 — fail-fast path.**

  Locate the block (currently lines 45–49 in the original):

  ```bash
  if [ "$syntax_failed" -gt 0 ]; then
      bad "$syntax_failed of $syntax_total scripts have syntax errors"
      printf '\ngate FAIL: bash -n syntax check\n'
      exit 1
  fi
  ```

  Replace with:

  ```bash
  if [ "$syntax_failed" -gt 0 ]; then
      bad "$syntax_failed of $syntax_total scripts have syntax errors"
      status_glyph_syntax="$GLYPH_FAIL"
      gate_failed=1
      gate_failed_at="bash -n syntax check"
      printf '\ngate FAIL: bash -n syntax check\n'
      exit 1
  fi
  ```

  (The `printf '\ngate FAIL: ...'` and `exit 1` stay for now — Task 4 replaces them with the colored block.)

- [ ] **Step 3: Section 2 — wire CRLF summary.**

  Locate the if/else block:

  ```bash
  if [ -n "$crlf_files" ]; then
      crlf_count=$(printf '%s\n' "$crlf_files" | wc -l | tr -d ' ')
      warn "CRLF line endings found in $crlf_count file(s):"
      printf '%s\n' "$crlf_files" | sed 's/^/    /'
      warn "Set your editor to LF — installer normalizes on-device, but this is a misconfig signal."
  else
      ok "no CRLF detected"
  fi
  ```

  Replace with:

  ```bash
  if [ -n "$crlf_files" ]; then
      crlf_count=$(printf '%s\n' "$crlf_files" | wc -l | tr -d ' ')
      warn "CRLF line endings found in $crlf_count file(s):"
      printf '%s\n' "$crlf_files" | sed 's/^/    /'
      warn "Set your editor to LF — installer normalizes on-device, but this is a misconfig signal."
      status_glyph_crlf="$GLYPH_WARN"
      crlf_summary="$crlf_count warnings"
  else
      ok "no CRLF detected"
      status_glyph_crlf="$GLYPH_OK"
      crlf_summary="clean"
  fi
  ```

- [ ] **Step 4: Section 3 — count harnesses and track per-loop results.**

  Locate the harness loop (currently lines 92–103 in the original):

  ```bash
  # === Section 3: workstation harnesses ===
  for harness in "$REPO_ROOT/scripts/test/"*.sh; do
      [ -f "$harness" ] || continue
      name=$(basename "$harness")
      case "$name" in run-all.sh) continue ;; esac
      rel="scripts/test/$name"
      section "$rel"
      if ! bash "$harness"; then
          printf '\ngate FAIL: %s\n' "$rel"
          exit 1
      fi
  done
  ```

  Replace with:

  ```bash
  # === Section 3: workstation harnesses ===
  # First pass: count discoverable harnesses (excluding run-all.sh itself).
  for harness in "$REPO_ROOT/scripts/test/"*.sh; do
      [ -f "$harness" ] || continue
      case "$(basename "$harness")" in run-all.sh) continue ;; esac
      harness_total=$((harness_total + 1))
  done

  # Second pass: actually run them.
  for harness in "$REPO_ROOT/scripts/test/"*.sh; do
      [ -f "$harness" ] || continue
      name=$(basename "$harness")
      case "$name" in run-all.sh) continue ;; esac
      rel="scripts/test/$name"
      section "$rel"
      if ! bash "$harness"; then
          status_glyph_harn="$GLYPH_FAIL"
          gate_failed=1
          gate_failed_at="$rel"
          printf '\ngate FAIL: %s\n' "$rel"
          exit 1
      fi
      harness_pass=$((harness_pass + 1))
  done

  if [ "$harness_total" -eq "$harness_pass" ]; then
      status_glyph_harn="$GLYPH_OK"
  fi
  ```

  Note: the two-pass approach is intentional — counting before execution lets the summary box render `4/4 pass` even if a harness exits 1 mid-run. The first pass is cheap (one stat per `*.sh` file) and the values it captures are what the user will see in the summary box on a Section 3 fail.

- [ ] **Step 5: Verify the file still parses and gate still passes.**

  ```bash
  bash -n scripts/test/run-all.sh
  bash scripts/test/run-all.sh
  echo "exit was: $?"
  ```

  Expected:
  - `bash -n` exits 0.
  - Gate output structure is **identical to Task 2's output** — Section 1 still ends with `✓ N scripts parsed cleanly`, Section 2 still shows the `⚠` warnings, Section 3 still runs all harnesses, final line is still the plain `gate PASS`. The trackers are populated but not yet displayed.
  - Exit 0.

- [ ] **Step 6: Commit.**

  ```bash
  git add scripts/test/run-all.sh
  git commit -m "test(run-all): wire status trackers into syntax/CRLF/harness sections"
  ```

---

## Task 4: Replace final gate-PASS/FAIL line with colored block + summary box

Swap the three plain `printf` exit lines (Section 1 fail-fast, Section 3 fail-on-harness, final-success) for the colored block. Section 1's path skips the summary box (fail-fast, no tracker data to display). Sections 2/3 paths render the summary box.

**Files:**
- Modify: `scripts/test/run-all.sh` (three locations)

- [ ] **Step 1: Add the summary-box renderer function.**

  Use the Edit tool to insert the following function after `_repeat`'s closing brace and before the `# Output helpers — colored +` comment (Task 2's renamed comment):

  ```bash
  # _render_summary_box — final summary table.  Reads status_glyph_*, syntax_total,
  # crlf_summary, harness_pass, harness_total.  Always called from the final-block path.
  _render_summary_box() {
      printf "  ${DIM}%b%b%b Summary %b%b${NC}\n" \
          "$BOX_TL" "$BOX_H" "$BOX_H" "$(_repeat "$BOX_H" 28)" "$BOX_TR"
      printf "  ${DIM}%b${NC}  %b ${DIM}%-18s${NC} %16s ${DIM}%b${NC}\n" \
          "$BOX_V" "$status_glyph_syntax" "Syntax check" "$syntax_total scripts" "$BOX_V"
      printf "  ${DIM}%b${NC}  %b ${DIM}%-18s${NC} %16s ${DIM}%b${NC}\n" \
          "$BOX_V" "$status_glyph_crlf"   "CRLF check"   "$crlf_summary" "$BOX_V"
      printf "  ${DIM}%b${NC}  %b ${DIM}%-18s${NC} %16s ${DIM}%b${NC}\n" \
          "$BOX_V" "$status_glyph_harn"   "Harnesses"    "$harness_pass/$harness_total pass" "$BOX_V"
      printf "  ${DIM}%b%b${NC}\n\n" "$BOX_BL" "$(_repeat "$BOX_H" 38)"
  }
  ```

- [ ] **Step 2: Replace Section 1 fail-fast block.**

  Locate (in Task 3 form):

  ```bash
  if [ "$syntax_failed" -gt 0 ]; then
      bad "$syntax_failed of $syntax_total scripts have syntax errors"
      status_glyph_syntax="$GLYPH_FAIL"
      gate_failed=1
      gate_failed_at="bash -n syntax check"
      printf '\ngate FAIL: bash -n syntax check\n'
      exit 1
  fi
  ```

  Replace with:

  ```bash
  if [ "$syntax_failed" -gt 0 ]; then
      bad "$syntax_failed of $syntax_total scripts have syntax errors"
      status_glyph_syntax="$GLYPH_FAIL"
      gate_failed=1
      gate_failed_at="bash -n syntax check"
      elapsed=$(($(date +%s) - START_TIME))
      printf "\n  ${RED}${BOLD}%b gate FAIL: %s${NC} ${DIM}(${elapsed}s)${NC}\n\n" \
          "$GLYPH_FAIL" "$gate_failed_at"
      exit 1
  fi
  ```

  This path does NOT render the summary box — fail-fast skips it because Sections 2 and 3 never ran, so trackers are empty.

- [ ] **Step 3: Replace Section 3 harness-fail block.**

  Locate (in Task 3 form):

  ```bash
      if ! bash "$harness"; then
          status_glyph_harn="$GLYPH_FAIL"
          gate_failed=1
          gate_failed_at="$rel"
          printf '\ngate FAIL: %s\n' "$rel"
          exit 1
      fi
  ```

  Replace with:

  ```bash
      if ! bash "$harness"; then
          status_glyph_harn="$GLYPH_FAIL"
          gate_failed=1
          gate_failed_at="$rel"
          elapsed=$(($(date +%s) - START_TIME))
          printf "\n  ${RED}${BOLD}%b gate FAIL: %s${NC} ${DIM}(${elapsed}s)${NC}\n\n" \
              "$GLYPH_FAIL" "$gate_failed_at"
          _render_summary_box
          exit 1
      fi
  ```

  This path RENDERS the summary box because Section 1 and Section 2 already populated their trackers, and partial harness data is still informative.

- [ ] **Step 4: Replace final success line.**

  Locate the last line of the file:

  ```bash
  printf '\ngate PASS\n'
  ```

  Replace with:

  ```bash
  elapsed=$(($(date +%s) - START_TIME))
  printf "\n  ${GREEN}${BOLD}%b gate PASS${NC} ${DIM}(${elapsed}s)${NC}\n\n" "$GLYPH_OK"
  _render_summary_box
  ```

- [ ] **Step 5: Verify file parses.**

  ```bash
  bash -n scripts/test/run-all.sh
  ```

  Expected: exits 0.

- [ ] **Step 6: Run the gate on TTY. Confirm full polished output.**

  ```bash
  bash scripts/test/run-all.sh
  echo "exit was: $?"
  ```

  Expected:
  - Section banners are bold with `━━` rules.
  - Section 1: green `✓ 110 scripts parsed cleanly`.
  - Section 2: yellow `⚠ CRLF line endings found in 5 file(s):` with file list and the `Set your editor to LF` nudge.
  - Section 3: each harness banner appears, harness output runs and shows its own `ALL PASS`.
  - Final line: bold green `✓ gate PASS  (Ns)`.
  - Summary box with 3 rows: Syntax check ✓ / CRLF check ⚠ / Harnesses ✓ — values match (110 scripts / 5 warnings / 4/4 pass).
  - Exit 0.

- [ ] **Step 7: Verify Section 1 fail-fast (no summary box).**

  Inject a syntax error:

  ```bash
  printf '\nif true\n' >> scripts/usr/bin/qmanager_ping
  bash scripts/test/run-all.sh
  echo "exit was: $?"
  ```

  Expected:
  - Section 1 banner appears.
  - One `✗ <path>` FAIL line plus indented `bash -n` stderr.
  - `✗ 1 of 110 scripts have syntax errors`.
  - Bold red `✗ gate FAIL: bash -n syntax check  (Ns)`.
  - **No summary box** (fail-fast path).
  - Section 2 and Section 3 banners absent.
  - Exit 1.

  Revert:

  ```bash
  git checkout -- scripts/usr/bin/qmanager_ping
  ```

- [ ] **Step 8: Verify Section 3 fail (with summary box).**

  Inject a harness failure:

  ```bash
  sed -i '1a exit 1' scripts/test/poller-phase-a.sh
  bash scripts/test/run-all.sh
  echo "exit was: $?"
  ```

  Expected:
  - Section 1 ✓ pass.
  - Section 2 either ✓ clean or ⚠ warning.
  - First harness section runs and exits 1 immediately.
  - Bold red `✗ gate FAIL: scripts/test/poller-phase-a.sh  (Ns)`.
  - Summary box with 3 rows: Syntax ✓, CRLF ✓ or ⚠, Harnesses ✗ (with partial pass count e.g. `0/4 pass` or `1/4 pass` depending on order).
  - Exit 1.

  Revert:

  ```bash
  git checkout -- scripts/test/poller-phase-a.sh
  bash scripts/test/run-all.sh    # confirm back to clean PASS
  ```

- [ ] **Step 9: Verify non-TTY fallback.**

  ```bash
  bash scripts/test/run-all.sh > /tmp/gate_out.log 2>&1
  echo "exit was: $?"
  cat /tmp/gate_out.log | tail -20
  ```

  Expected (in the output file):
  - Section banners use `==` (not `━━`).
  - `[OK]` / `[WARN]` markers (not `✓`/`⚠`).
  - Final line: `[OK] gate PASS  (Ns)` with no ANSI escapes.
  - Summary box uses `+`, `-`, `|` ASCII (not `┌─┐│└┘`).
  - Exit 0.

  Verify no leaked ANSI codes:

  ```bash
  grep -c $'\x1b\[' /tmp/gate_out.log || echo "no ANSI escapes found"
  ```

  Expected: `no ANSI escapes found` (or `grep` returns 0 matches).

- [ ] **Step 10: Verify CRLF discipline on the runner itself.**

  ```bash
  grep -cU $'\r' scripts/test/run-all.sh
  ```

  Expected: 0.

- [ ] **Step 11: Commit.**

  ```bash
  git add scripts/test/run-all.sh
  git commit -m "test(run-all): replace plain gate line with colored block + summary box"
  ```

---

## Done criteria

- All four implementation tasks committed on `feat/pre-build-test-gate`.
- TTY run: section banners bold with `━━`, glyphs `✓ ⚠ ✗`, colored final line, summary box with 3 rows.
- Non-TTY run: clean ASCII output, no escape codes, `[OK]`/`[WARN]`/`[FAIL]` markers, ASCII box.
- Section 1 syntax failure exits with colored FAIL line and **no summary box** (fail-fast preserved).
- Section 3 harness failure exits with colored FAIL line and **summary box rendered** (with partial pass count).
- Happy path: bold green `✓ gate PASS` followed by summary box.
- Existing exit-code contract preserved: 0 on full pass, 1 on any failure.
- `bun run package` integration unchanged.
- All 4 harnesses still execute and pass under the runner.
- Branch ready for review/merge — no test bypasses, no commented-out assertions.

## Out of scope (deferred — see spec)

- Modifying any harness's own output (the four files in `scripts/test/*.sh` other than `run-all.sh`).
- `.gitattributes` rules for `*.rules` and `sudoers.d/*` (separate follow-up).
- Changes to `package.json`, `build.sh`, `RELEASE_NOTES.md`, or any other file.
- New harnesses or new test coverage.
- A test for the runner itself — the runner's output is verified by the implementer running it, not by an automated test.
