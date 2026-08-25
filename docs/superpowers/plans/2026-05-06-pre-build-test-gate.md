# Pre-Build Test Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-fast test gate that runs all workstation harnesses, a `bash -n` syntax check, and a CRLF detector before `bun --bun next build` and `bash build.sh`, so backend regressions abort `bun run package` in ~7 seconds instead of landing in a tarball.

**Architecture:** A single thin orchestrator at `scripts/test/run-all.sh` runs three sections — `bash -n` syntax check (fail), CRLF detector (warn-only), then every harness in `scripts/test/*.sh` (fail on first). Wired into `package.json` as the first command in the `package` script so it runs before `next build`. New `parse-at.sh` harness lands as part of this work and is auto-discovered by the orchestrator's harness glob.

**Tech Stack:** POSIX-bash, `bash -n`, `grep -lI`, `find`. Reuses the workstation-harness conventions established in `scripts/test/poller-phase-{a,bcd}.sh` (`set -eu`, `mktemp`+EXIT trap, `ok`/`bad`/`section` helpers). No new tooling deps.

---

## Pre-flight

- [ ] **Confirm branch and baseline.**

  ```bash
  git status
  git log --oneline -1
  git rev-parse --abbrev-ref HEAD
  ```

  Expected: working tree clean (no uncommitted changes), HEAD recent (around `312c93d docs(release-notes): add v0.1.7 SSH bootstrap feature note` or later), branch is `feat/pre-build-test-gate`.

- [ ] **Confirm existing harnesses pass on this workstation.** Belt-and-braces — proves the test toolchain is intact before extending it.

  ```bash
  bash scripts/test/health-check-redaction.sh
  bash scripts/test/poller-phase-a.sh
  bash scripts/test/poller-phase-bcd.sh
  ```

  Expected: each ends with `ALL PASS`. (Tail line wording differs slightly per harness — `health-check-redaction.sh` says `OK`, the poller harnesses say `ALL PASS`. Both are zero-exit.)

---

## Task 1: Create `run-all.sh` orchestrator skeleton with harness auto-discovery

A skeleton runner that does only one thing for now: discover and run every `*.sh` harness in `scripts/test/` (excluding itself), exit 0 if all pass, exit 1 on first failing harness. Subsequent tasks add the `bash -n` and CRLF sections.

**Files:**
- Create: `scripts/test/run-all.sh`

- [ ] **Step 1: Create the file.**

  ```bash
  cat > scripts/test/run-all.sh <<'RUNNER'
  #!/bin/bash
  # Pre-build test gate for QManager. Runs:
  #   1. bash -n syntax check across daemon, library, CGI, and test scripts
  #   2. CRLF detector (warn-only)
  #   3. Every harness in scripts/test/*.sh (auto-discovered)
  #
  # Exits non-zero on first failing check (CRLF section never fails).
  # Run from repo root via `bash scripts/test/run-all.sh` or as part of
  # `bun run package`.
  set -eu

  REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

  # Output helpers — same shape as the existing harnesses.
  section() { printf '\n== %s ==\n' "$1"; }
  ok()      { printf '  PASS  %s\n' "$1"; }
  bad()     { printf '  FAIL  %s\n' "$1"; }
  warn()    { printf '  WARN  %s\n' "$1"; }

  # === Section 3: workstation harnesses ===
  # (Sections 1 and 2 land in subsequent tasks.)
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

  printf '\ngate PASS\n'
  RUNNER
  ```

- [ ] **Step 2: Mark the file executable in git's index.**

  Windows filesystems don't carry the executable bit; this sets it explicitly so the runner is invokable directly on Linux/macOS reviewers' boxes. (The shebang means `bash run-all.sh` always works, but `./run-all.sh` only works with the bit set.)

  ```bash
  git update-index --add --chmod=+x scripts/test/run-all.sh
  ```

- [ ] **Step 3: Run it. Confirm all three existing harnesses are discovered and pass.**

  ```bash
  bash scripts/test/run-all.sh
  ```

  Expected last lines:
  ```
  == scripts/test/poller-phase-bcd.sh ==
  ...
  11 passed, 0 failed, ALL PASS

  gate PASS
  ```

- [ ] **Step 4: Verify the fail path by deliberately breaking a harness, then revert.**

  Make one harness exit 1 to confirm the runner stops at the first failure.

  ```bash
  # Inject a `false` at the top of poller-phase-a.sh, just to test the gate.
  # Use a marker comment so the revert is unambiguous.
  printf '%s\n' '_TEST_GATE_INJECT_FAIL_=1; false  # TEMP — gate test' \
      | cat - scripts/test/poller-phase-a.sh > /tmp/_pa.sh && \
      mv /tmp/_pa.sh scripts/test/poller-phase-a.sh

  bash scripts/test/run-all.sh
  echo "exit was: $?"
  ```

  Expected: runner stops at `poller-phase-a.sh`, prints `gate FAIL: scripts/test/poller-phase-a.sh`, exit code 1. The `poller-phase-bcd.sh` harness should NOT have run (verified by absence of its banner).

  Revert:

  ```bash
  git checkout -- scripts/test/poller-phase-a.sh
  bash scripts/test/run-all.sh    # confirm clean again
  ```

- [ ] **Step 5: Commit.**

  ```bash
  git add scripts/test/run-all.sh
  git commit -m "test: add run-all.sh orchestrator with harness auto-discovery"
  ```

---

## Task 2: Add `bash -n` syntax check section

The fastest, cheapest line of defense — catches missing `fi`/`done`/`esac` and other parse-time errors across every shell script destined for the tarball. `bash -n` is a superset of POSIX `sh -n` and parses both daemon-style (`#!/bin/bash`) and POSIX-style (`#!/bin/sh`) scripts correctly.

**Files:**
- Modify: `scripts/test/run-all.sh` (add Section 1)

- [ ] **Step 1: Insert Section 1 above the existing "Section 3" comment.**

  In `scripts/test/run-all.sh`, locate the line `# === Section 3: workstation harnesses ===` and insert the following block immediately before it (after the `warn()` helper definition):

  ```bash
  # === Section 1: bash -n syntax check ===
  section "bash -n syntax check"

  # File list. Extension-less daemons in /usr/bin/, library .sh in /usr/lib/qmanager/,
  # CGI handlers in /www/cgi-bin/quecmanager/, and the harnesses themselves.
  list_scripts() {
      ls "$REPO_ROOT/scripts/usr/bin/"* 2>/dev/null || true
      ls "$REPO_ROOT/scripts/usr/lib/qmanager/"*.sh 2>/dev/null || true
      find "$REPO_ROOT/scripts/www/cgi-bin/quecmanager" -type f -name '*.sh' 2>/dev/null || true
      ls "$REPO_ROOT/scripts/test/"*.sh 2>/dev/null || true
  }

  syntax_failed=0
  syntax_total=0
  while IFS= read -r f; do
      [ -z "$f" ] && continue
      [ -f "$f" ] || continue
      syntax_total=$((syntax_total + 1))
      if ! err=$(bash -n "$f" 2>&1); then
          bad "$f"
          printf '%s\n' "$err" | sed 's/^/    /'
          syntax_failed=$((syntax_failed + 1))
      fi
  done < <(list_scripts)

  if [ "$syntax_failed" -gt 0 ]; then
      bad "$syntax_failed of $syntax_total scripts have syntax errors"
      printf '\ngate FAIL: bash -n syntax check\n'
      exit 1
  fi
  ok "$syntax_total scripts parsed cleanly"

  ```

  Notes for the implementer:
  - The `< <(list_scripts)` is bash process substitution — works on bash 3+, available on Git Bash, WSL, and Linux. Required so the `while` loop runs in the parent shell and `syntax_failed` increments propagate.
  - `if ! err=$(bash -n "$f" 2>&1);` — the `if` context inhibits `set -e` errexit for the failing command, so the assignment captures stderr cleanly even when bash -n reports a syntax error.

- [ ] **Step 2: Run on the clean tree. All scripts must parse.**

  ```bash
  bash scripts/test/run-all.sh
  ```

  Expected: section 1 prints `PASS  N scripts parsed cleanly` (N likely around 105–110), then proceeds to harnesses, ends with `gate PASS`.

  If any script fails: that's a real bug — fix the script before continuing. The implementer should NOT skip the offender from the file list.

- [ ] **Step 3: Verify the fail path with a deliberate syntax error, then revert.**

  ```bash
  # Inject a syntax error: unclosed `if`.
  printf '\nif true\n' >> scripts/usr/bin/qmanager_ping

  bash scripts/test/run-all.sh
  echo "exit was: $?"
  ```

  Expected: section 1 prints `FAIL  <repo>/scripts/usr/bin/qmanager_ping` plus the bash -n stderr (`syntax error: unexpected end of file`), then `FAIL  1 of N scripts have syntax errors`, then `gate FAIL: bash -n syntax check`, exit 1. Neither the CRLF nor the harness sections should have run.

  Revert:

  ```bash
  git checkout -- scripts/usr/bin/qmanager_ping
  bash scripts/test/run-all.sh    # confirm clean again
  ```

- [ ] **Step 4: Commit.**

  ```bash
  git add scripts/test/run-all.sh
  git commit -m "test(run-all): add bash -n syntax check across daemon/lib/CGI scripts"
  ```

---

## Task 3: Add CRLF detector section (warn-only)

Surface CRLF line endings introduced by Windows editors. Never fails the gate — the installer already strips `\r` from scripts, units, and sudoers rules at install time per `CLAUDE.md`. The detector exists to flag a misconfigured editor early so it doesn't recur.

**Files:**
- Modify: `scripts/test/run-all.sh` (add Section 2)

- [ ] **Step 1: Insert Section 2 between Section 1 and Section 3.**

  Locate the line `# === Section 3: workstation harnesses ===` and insert the following block immediately before it:

  ```bash
  # === Section 2: CRLF detector (warn-only) ===
  section "CRLF check (warn-only)"

  # Tarball-bound files most sensitive to CRLF: shell scripts, systemd units,
  # sudoers rules. The installer normalizes these on-device, so this section
  # never fails the gate — it just nudges the operator to fix their editor.
  list_crlf_candidates() {
      grep -rIl $'\r' "$REPO_ROOT/scripts" \
          --include='*.sh' --include='*.service' \
          2>/dev/null || true
      # Extension-less daemon scripts in scripts/usr/bin/.
      for f in "$REPO_ROOT/scripts/usr/bin/"*; do
          [ -f "$f" ] || continue
          if grep -qI $'\r' "$f" 2>/dev/null; then
              printf '%s\n' "$f"
          fi
      done
      # sudoers.d/ files (unconventional extensions).
      find "$REPO_ROOT/scripts" -path '*/sudoers.d/*' -type f 2>/dev/null \
          | while IFS= read -r f; do
              [ -f "$f" ] || continue
              if grep -qI $'\r' "$f" 2>/dev/null; then
                  printf '%s\n' "$f"
              fi
          done
  }

  crlf_files=$(list_crlf_candidates | sort -u)

  if [ -n "$crlf_files" ]; then
      crlf_count=$(printf '%s\n' "$crlf_files" | wc -l | tr -d ' ')
      warn "CRLF line endings found in $crlf_count file(s):"
      printf '%s\n' "$crlf_files" | sed 's/^/    /'
      warn "Set your editor to LF — installer normalizes on-device, but this is a misconfig signal."
  else
      ok "no CRLF detected"
  fi

  ```

  Notes for the implementer:
  - `$'\r'` is bash ANSI-C quoting — produces a literal CR. Required for `grep` to match Windows-style line endings.
  - `grep -I` skips binary files, preventing false positives on `.ipk`s or other binaries that happen to contain a CR byte.
  - This section never sets a failure flag and never exits — control always falls through to Section 3.

- [ ] **Step 2: Run on the clean tree.**

  ```bash
  bash scripts/test/run-all.sh
  ```

  Expected: section 2 prints `PASS  no CRLF detected` (assuming `.gitattributes eol=lf` is doing its job), then proceeds to harnesses, ends with `gate PASS`.

- [ ] **Step 3: Verify the warn path with a deliberate CRLF, then revert.**

  ```bash
  # Inject CRLF line endings into a temporary test script.
  printf '#!/bin/sh\r\necho hi\r\n' > scripts/test/_crlf_probe.sh

  bash scripts/test/run-all.sh
  echo "exit was: $?"
  ```

  Expected:
  - Section 2 prints `WARN  CRLF line endings found in 1 file(s):` followed by the path to `_crlf_probe.sh`.
  - Gate continues — Section 3 still runs.
  - Final line is `gate PASS` (or the harness section's normal output) — exit 0 unless a harness fails for unrelated reasons.

  Revert:

  ```bash
  rm scripts/test/_crlf_probe.sh
  bash scripts/test/run-all.sh    # confirm clean again
  ```

- [ ] **Step 4: Commit.**

  ```bash
  git add scripts/test/run-all.sh
  git commit -m "test(run-all): add CRLF detector (warn-only) for tarball-bound files"
  ```

---

## Task 4: Wire the gate into `package.json`

Make `bun run package` run the gate before the frontend build and `build.sh`. `bun run build` (frontend dev iteration) is intentionally left ungated.

**Files:**
- Modify: `package.json:10` (the `package` script)

- [ ] **Step 1: Update the `package` script.**

  Open `package.json` and locate the line:

  ```json
      "package": "bun --bun next build && bash build.sh"
  ```

  Replace it with:

  ```json
      "package": "bash scripts/test/run-all.sh && bun --bun next build && bash build.sh"
  ```

- [ ] **Step 2: Confirm `bun run` lists the new pipeline.**

  ```bash
  bun run
  ```

  Expected: the listed `package` script reflects the new command. (The exact format depends on Bun's output, but the new command string should appear verbatim.)

- [ ] **Step 3: Verify `bun run package` runs the gate first and aborts on failure.**

  Inject a deliberate harness failure to prove the gate stops the pipeline before `next build`.

  ```bash
  # Inject failure into one harness.
  printf '%s\n' '_GATE_TEST_=1; false' \
      | cat - scripts/test/poller-phase-a.sh > /tmp/_pa.sh && \
      mv /tmp/_pa.sh scripts/test/poller-phase-a.sh

  bun run package
  echo "exit was: $?"
  ```

  Expected: gate fails on `poller-phase-a.sh`, exit non-zero. `next build` should NOT have started (no Next.js build banner in output, no `out/` directory created or modified).

  Revert:

  ```bash
  git checkout -- scripts/test/poller-phase-a.sh
  ```

- [ ] **Step 4: Commit.**

  ```bash
  git add package.json
  git commit -m "build: gate bun run package on scripts/test/run-all.sh"
  ```

---

## Task 5: Add `scripts/test/parse-at.sh` harness

A new harness covering the parsers in `scripts/usr/lib/qmanager/parse_at.sh` not already covered by `poller-phase-bcd.sh`. Same shape as the existing harnesses — sources the library, calls each function with fixture input, asserts on the resulting global vars. jq-dependent assertions guarded with the `command -v jq` SKIP pattern.

**Coverage:** `parse_serving_cell` (LTE-only and 5G-SA), `parse_qrsrp`, `parse_qrsrq`, `parse_qsinr`, `parse_temperature`. 5G-NSA two-line servingcell coverage is intentionally deferred — its EN-DC fixture format requires device captures to validate.

**Files:**
- Create: `scripts/test/parse-at.sh`

- [ ] **Step 1: Create the harness.**

  ```bash
  cat > scripts/test/parse-at.sh <<'HARNESS'
  #!/bin/bash
  # Workstation fixtures for parse_at.sh parsers not covered by poller-phase-bcd.sh.
  # Run from repo root: bash scripts/test/parse-at.sh
  #
  # Each test sources scripts/usr/lib/qmanager/parse_at.sh in a subshell, calls
  # the parser with fixture AT-command output, and asserts on the resulting
  # global vars. jq-dependent assertions are guarded so the harness runs
  # cleanly on workstations without jq (Windows dev box).
  set -eu

  REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT

  fail=0
  pass_count=0
  fail_count=0

  ok()   { printf '  PASS  %s\n' "$1"; pass_count=$((pass_count + 1)); }
  bad()  { printf '  FAIL  %s\n' "$1"; fail_count=$((fail_count + 1)); fail=1; }
  section() { printf '\n== %s ==\n' "$1"; }

  PARSE_AT="$REPO_ROOT/scripts/usr/lib/qmanager/parse_at.sh"

  section "harness self-check"
  if [ -f "$PARSE_AT" ]; then
      ok "parse_at.sh found"
  else
      bad "parse_at.sh missing at $PARSE_AT"
  fi

  # ---------------------------------------------------------------------------
  section "parse_serving_cell — LTE-only mode"

  sample_lte=$'+QENG: "servingcell","CONNECT","LTE","FDD",515,03,FCB04A0,222,1350,3,5,5,1A2B,-95,-12,-58,11,0\nOK'

  result=$(
      set +eu
      qlog_warn() { :; }
      qlog_info() { :; }
      qlog_debug() { :; }
      qlog_error() { :; }
      service_status="unknown"
      . "$PARSE_AT"
      parse_serving_cell "$sample_lte"
      printf '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n' \
          "$network_type" "$lte_state" "$nr_state" \
          "$lte_band" "$lte_pci" "$lte_earfcn" "$lte_bandwidth" \
          "$lte_rsrp" "$lte_rsrq" "$lte_sinr"
  )

  case "$result" in
      'LTE|connected|inactive|B3|222|1350|5|-95|-12|11')
          ok "parse_serving_cell populated LTE fields correctly"
          ;;
      *)
          bad "parse_serving_cell LTE output mismatch: '$result'"
          ;;
  esac

  # ---------------------------------------------------------------------------
  section "parse_serving_cell — 5G-SA mode"

  # Single +QENG: line — servingcell,state,NR5G-SA,duplex,MCC,MNC,cellID,PCID,
  #                     TAC,ARFCN,band,NR_DL_bw,RSRP,RSRQ,SINR,scs,srxlev
  # Field positions:    1           2     3       4      5   6   7      8
  #                     9   10     11   12       13   14   15   16  17
  sample_sa=$'+QENG: "servingcell","CONNECT","NR5G-SA","TDD",515,03,12345AB,500,5A2B,627264,78,2,-90,-10,15,1,32\nOK'

  result=$(
      set +eu
      qlog_warn() { :; }
      qlog_info() { :; }
      qlog_debug() { :; }
      qlog_error() { :; }
      service_status="unknown"
      . "$PARSE_AT"
      parse_serving_cell "$sample_sa"
      printf '%s|%s|%s|%s|%s|%s|%s|%s|%s\n' \
          "$network_type" "$lte_state" "$nr_state" \
          "$nr_band" "$nr_pci" "$nr_arfcn" \
          "$nr_rsrp" "$nr_rsrq" "$nr_sinr"
  )

  case "$result" in
      '5G-SA|inactive|connected|N78|500|627264|-90|-10|15')
          ok "parse_serving_cell populated 5G-SA fields correctly"
          ;;
      *)
          bad "parse_serving_cell 5G-SA output mismatch: '$result'"
          ;;
  esac

  # ---------------------------------------------------------------------------
  section "parse_qrsrp — per-antenna LTE + NR"

  jq_real=$(command -v jq 2>/dev/null || true)
  if [ -z "$jq_real" ]; then
      printf '  SKIP  parse_qrsrp (jq not available on workstation)\n'
  else
      sample_qrsrp=$'+QRSRP: -95,-91,-89,-93,LTE\n+QRSRP: -90,-88,-86,-92,NR5G\nOK'

      result=$(
          set +eu
          qlog_warn() { :; }
          qlog_info() { :; }
          qlog_debug() { :; }
          qlog_error() { :; }
          . "$PARSE_AT"
          parse_qrsrp "$sample_qrsrp"
          printf '%s\n%s\n' "$sig_lte_rsrp" "$sig_nr_rsrp"
      )

      lte_json=$(printf '%s\n' "$result" | sed -n '1p')
      nr_json=$(printf '%s\n' "$result" | sed -n '2p')

      lte_first=$(printf '%s' "$lte_json" | jq '.[0]' 2>/dev/null)
      lte_last=$(printf '%s' "$lte_json" | jq '.[3]' 2>/dev/null)
      nr_first=$(printf '%s' "$nr_json" | jq '.[0]' 2>/dev/null)
      nr_last=$(printf '%s' "$nr_json" | jq '.[3]' 2>/dev/null)

      if [ "$lte_first" = "-95" ] && [ "$lte_last" = "-93" ]; then
          ok "sig_lte_rsrp first/last antennas match (-95, -93)"
      else
          bad "sig_lte_rsrp antenna mismatch: first='$lte_first' last='$lte_last' (json='$lte_json')"
      fi

      if [ "$nr_first" = "-90" ] && [ "$nr_last" = "-92" ]; then
          ok "sig_nr_rsrp first/last antennas match (-90, -92)"
      else
          bad "sig_nr_rsrp antenna mismatch: first='$nr_first' last='$nr_last' (json='$nr_json')"
      fi
  fi

  # ---------------------------------------------------------------------------
  section "parse_qrsrq — per-antenna LTE + NR"

  jq_real=$(command -v jq 2>/dev/null || true)
  if [ -z "$jq_real" ]; then
      printf '  SKIP  parse_qrsrq (jq not available on workstation)\n'
  else
      sample_qrsrq=$'+QRSRQ: -12,-13,-11,-14,LTE\n+QRSRQ: -10,-11,-9,-12,NR5G\nOK'

      result=$(
          set +eu
          qlog_warn() { :; }
          qlog_info() { :; }
          qlog_debug() { :; }
          qlog_error() { :; }
          . "$PARSE_AT"
          parse_qrsrq "$sample_qrsrq"
          printf '%s\n%s\n' "$sig_lte_rsrq" "$sig_nr_rsrq"
      )

      lte_json=$(printf '%s\n' "$result" | sed -n '1p')
      nr_json=$(printf '%s\n' "$result" | sed -n '2p')

      lte_first=$(printf '%s' "$lte_json" | jq '.[0]' 2>/dev/null)
      nr_first=$(printf '%s' "$nr_json" | jq '.[0]' 2>/dev/null)

      if [ "$lte_first" = "-12" ] && [ "$nr_first" = "-10" ]; then
          ok "parse_qrsrq populated LTE and NR JSON arrays"
      else
          bad "parse_qrsrq mismatch: lte_first='$lte_first' nr_first='$nr_first'"
      fi
  fi

  # ---------------------------------------------------------------------------
  section "parse_qsinr — per-antenna LTE + NR"

  jq_real=$(command -v jq 2>/dev/null || true)
  if [ -z "$jq_real" ]; then
      printf '  SKIP  parse_qsinr (jq not available on workstation)\n'
  else
      sample_qsinr=$'+QSINR: 11,12,10,9,LTE\n+QSINR: 15,14,16,13,NR5G\nOK'

      result=$(
          set +eu
          qlog_warn() { :; }
          qlog_info() { :; }
          qlog_debug() { :; }
          qlog_error() { :; }
          . "$PARSE_AT"
          parse_qsinr "$sample_qsinr"
          printf '%s\n%s\n' "$sig_lte_sinr" "$sig_nr_sinr"
      )

      lte_json=$(printf '%s\n' "$result" | sed -n '1p')
      nr_json=$(printf '%s\n' "$result" | sed -n '2p')

      lte_first=$(printf '%s' "$lte_json" | jq '.[0]' 2>/dev/null)
      nr_first=$(printf '%s' "$nr_json" | jq '.[0]' 2>/dev/null)

      if [ "$lte_first" = "11" ] && [ "$nr_first" = "15" ]; then
          ok "parse_qsinr populated LTE and NR JSON arrays"
      else
          bad "parse_qsinr mismatch: lte_first='$lte_first' nr_first='$nr_first'"
      fi
  fi

  # ---------------------------------------------------------------------------
  section "parse_temperature — average across active sensors"

  # Includes -273 (unavailable) and 0 (idle PA) sentinels that must be excluded.
  # Active values: 30, 45, 60. Average = (30 + 45 + 60) / 3 = 45.
  sample_qtemp=$'+QTEMP: "modem-tsens","-273"\n+QTEMP: "qfe_lb","30"\n+QTEMP: "tsens-pa","45"\n+QTEMP: "tsens-mmw","0"\n+QTEMP: "modem-cpu","60"\nOK'

  result=$(
      set +eu
      qlog_warn() { :; }
      qlog_info() { :; }
      qlog_debug() { :; }
      qlog_error() { :; }
      . "$PARSE_AT"
      parse_temperature "$sample_qtemp"
      printf '%s' "$t2_temperature"
  )

  case "$result" in
      45) ok "parse_temperature averaged active sensors (excluding -273 and 0)" ;;
      *)  bad "parse_temperature mismatch: got '$result' (expected 45)" ;;
  esac

  # ---------------------------------------------------------------------------
  printf '\n%d passed, %d failed' "$pass_count" "$fail_count"
  if [ "$fail" -eq 0 ]; then
      printf ', ALL PASS\n'
      exit 0
  else
      printf ', FAILURES\n'
      exit 1
  fi
  HARNESS
  ```

- [ ] **Step 2: Mark the file executable in git's index.**

  ```bash
  git update-index --add --chmod=+x scripts/test/parse-at.sh
  ```

- [ ] **Step 3: Run the harness directly to confirm it passes.**

  ```bash
  bash scripts/test/parse-at.sh
  ```

  Expected (with jq present):
  ```
  ...
  8 passed, 0 failed, ALL PASS
  ```
  (Self-check + 2 parse_serving_cell + 2 parse_qrsrp + 1 parse_qrsrq + 1 parse_qsinr + parse_temperature = 8.)

  Expected (without jq, e.g. Windows dev box without it installed):
  ```
  ...
  4 passed, 0 failed, ALL PASS
  ```
  (Self-check + 2 parse_serving_cell + parse_temperature = 4. The three Q-parser sections SKIP cleanly.)

  If any assertion fails: the parser's expected output may not match the fixture. Verify against the parser source at `scripts/usr/lib/qmanager/parse_at.sh:97` (`parse_serving_cell`), `:740` (`parse_qrsrp`), `:753` (`parse_qrsrq`), `:766` (`parse_qsinr`), `:279` (`parse_temperature`). Adjust the fixture or assertion to match real behavior — do not weaken assertions to silence failures.

- [ ] **Step 4: Run via the orchestrator to confirm auto-discovery picks it up.**

  ```bash
  bash scripts/test/run-all.sh
  ```

  Expected: section banner `== scripts/test/parse-at.sh ==` appears in the output. Final line `gate PASS`.

- [ ] **Step 5: Commit.**

  ```bash
  git add scripts/test/parse-at.sh
  git commit -m "test(parse-at): add fixture coverage for serving_cell/qrsrp/qrsrq/qsinr/temp parsers"
  ```

---

## Task 6: Update RELEASE_NOTES.md

Add a single bullet under the existing v0.1.7 *Improvements* section. v0.1.7 has not yet shipped (`package.json` still pins `version: v0.1.6`), so this work folds into the v0.1.7 release rather than starting v0.1.8.

**Files:**
- Modify: `RELEASE_NOTES.md` (append one bullet to the v0.1.7 *Improvements* list)

- [ ] **Step 1: Open `RELEASE_NOTES.md`. Locate the v0.1.7 `## 🛠️ Improvements` section.**

  The last existing bullet ends with: `…ending the noisy "AT device not found" entries on the very first boot after a flash.`

- [ ] **Step 2: Append a new bullet at the end of that section, immediately before the `## 📥 Installation` header:**

  ```markdown
  - **Build-time test gate.** Workstation tests, shell-syntax checks, and line-ending detection now run before every tarball is assembled, so backend regressions are caught at build time instead of after install.
  ```

- [ ] **Step 3: Confirm the file still parses as well-formed Markdown** (no broken indentation, headers intact).

  ```bash
  head -25 RELEASE_NOTES.md
  ```

  Expected: the new bullet appears at the end of the *Improvements* list, separated from the next `## 📥 Installation` header by a blank line.

- [ ] **Step 4: Run the gate one last time to confirm nothing regressed.**

  ```bash
  bash scripts/test/run-all.sh
  ```

  Expected: `gate PASS`.

- [ ] **Step 5: Commit.**

  ```bash
  git add RELEASE_NOTES.md
  git commit -m "docs(release-notes): note pre-build test gate under v0.1.7 improvements"
  ```

---

## Done criteria

- All six tasks committed on `feat/pre-build-test-gate`.
- `bash scripts/test/run-all.sh` exits 0 with all four sections (3 existing harnesses + new `parse-at.sh`) passing.
- Deliberate syntax error → gate fails at section 1.
- Deliberate CRLF → gate warns but continues.
- Deliberate harness failure → gate fails at section 3 with the offending harness path.
- `bun run package` runs the gate before `next build` and aborts the pipeline on any gate failure.
- New `parse-at.sh` harness passes on workstation (5 sections covered when jq present, 3 SKIPs when jq absent).
- v0.1.7 *Improvements* bullet added to `RELEASE_NOTES.md`.
- Branch ready for review/merge — no test bypasses, no commented-out assertions, no skipped sections.

## Out of scope (deferred — see spec)

- Deeper coverage of `email_alerts.sh` / `sms_alerts.sh` registration-guard branches.
- Harnesses for `profile_mgr.sh` / `tower_lock_mgr.sh` / `ttl_state.sh`.
- 5G-NSA two-line `parse_serving_cell` fixture (needs device capture).
- Auto-fixing CRLF — installer normalizes on-device.
- Moving `build.sh`'s service-unit lint into the gate — different concern, stays where it is.
- CI hook / pre-commit hook — separate concern.
- TypeScript validation gate — `next build` already type-checks.
