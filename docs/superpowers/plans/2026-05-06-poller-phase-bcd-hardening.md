# Poller Phase B+C Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce per-cycle fork pressure on the poller (Phase B) and tighten its supervision/recovery story (Phase C), so the daemon stays under its 2 s budget on slow ARM and self-recovers cleanly across restarts.

**Architecture:** Same surgical pattern Phase A established — pure-shell rewrites of hot paths plus systemd-unit and main-loop tweaks, every fix backed by a workstation fixture test that extracts the function under test via `awk` and runs it with shimmed globals. Branches from the Phase A branch (`fix/poller-phase-a-hardening`) so the test harness conventions and unmerged Phase A code carry over.

**Tech Stack:** POSIX/`bash` shell, `jq`, `awk`, systemd unit files, workstation `bash` test harness (no device dependency).

---

## Pre-flight

- [ ] **Confirm working tree on the Phase A branch (or its merge into `main`).**

  ```bash
  git status
  git log --oneline -1
  ```

  Expected head: `b9a6b1c refactor(poller): final-review cleanups for Phase A` (or later, if Phase A has progressed).

- [ ] **Create the working branch.**

  ```bash
  git checkout -b fix/poller-phase-bcd-hardening
  ```

- [ ] **Sanity-check that Phase A's harness still passes.** This proves the workstation toolchain is intact before extending it.

  ```bash
  bash scripts/test/poller-phase-a.sh
  ```

  Expected tail: `12 passed, 0 failed, ALL PASS`.

---

## Task 1: Phase B+C test harness skeleton

A new harness file for Phase B+C tests, using the same shape as `scripts/test/poller-phase-a.sh`. Subsequent tasks extend it.

**Files:**
- Create: `scripts/test/poller-phase-bcd.sh`

- [ ] **Step 1: Create the harness file.**

  ```bash
  cat > scripts/test/poller-phase-bcd.sh <<'HARNESS'
  #!/bin/bash
  # Workstation fixtures for the poller Phase B+C hardening patches.
  # Run from the repo root:  bash scripts/test/poller-phase-bcd.sh
  #
  # Each test builds an isolated fixture under $work, sources the shell module
  # under test, invokes the function, and asserts on side-effect files or vars.
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

  # --- Self-check (real fixtures land in subsequent tasks) ---
  section "harness self-check"
  if [ -d "$REPO_ROOT/scripts/usr/lib/qmanager" ]; then
      ok "qmanager library directory found"
  else
      bad "qmanager library directory missing"
  fi

  printf '\n%s passed, %s failed' "$pass_count" "$fail_count"
  if [ $fail -eq 0 ]; then
      printf ', ALL PASS\n'
      exit 0
  else
      printf ', FAILURES\n'
      exit 1
  fi
  HARNESS
  ```

- [ ] **Step 2: Mark the file executable in git's index.**

  Windows filesystems don't carry the executable bit; this is required so the harness runs on Linux/macOS reviewers' boxes.

  ```bash
  git update-index --add --chmod=+x scripts/test/poller-phase-bcd.sh
  ```

- [ ] **Step 3: Run it to confirm the skeleton passes.**

  ```bash
  bash scripts/test/poller-phase-bcd.sh
  ```

  Expected tail: `1 passed, 0 failed, ALL PASS`.

- [ ] **Step 4: Commit.**

  ```bash
  git add scripts/test/poller-phase-bcd.sh
  git commit -m "test(poller): add Phase B+C test harness skeleton"
  ```

---

## Task 2: Move CFUN polling to Tier 2 cadence

`AT+CFUN?` runs every poll cycle (every 2 s). It rarely changes — the only events that consume it are airplane-mode toggles, which are user-driven and infrequent. Each cycle eats ~50 ms of lock time plus modem RTT. Drop the cadence to Tier 2 (every 30 s) to free 13 of every 15 cycles.

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller` (move CFUN block out of `poll_cycle` body and into the Tier 2 conditional)
- Modify: `scripts/test/poller-phase-bcd.sh` (add fixture)

- [ ] **Step 1: Write the failing test.**

  Append to `scripts/test/poller-phase-bcd.sh` *before* the trailing `printf '\n%s passed...'` block:

  ```bash
  section "CFUN polling moved to Tier 2 cadence"

  poller_src="$REPO_ROOT/scripts/usr/bin/qmanager_poller"

  # Extract the body of poll_cycle().
  pc_body=$(awk '/^poll_cycle\(\)/,/^\}/' "$poller_src")

  # Split into "before the Tier 2 block" vs "Tier 2 block onward".
  pre_tier2=$(printf '%s\n' "$pc_body" | awk '/# Tier 2 \(/ { exit } { print }')
  tier2_on=$(printf '%s\n' "$pc_body" | awk 'f { print } /# Tier 2 \(/ { f=1; print }')

  if printf '%s\n' "$pre_tier2" | grep -q 'AT+CFUN?'; then
      bad "AT+CFUN? still runs on every cycle (found before Tier 2 block)"
  else
      ok "AT+CFUN? no longer runs on every cycle"
  fi

  if printf '%s\n' "$tier2_on" | grep -q 'AT+CFUN?'; then
      ok "AT+CFUN? lives inside the Tier 2 block"
  else
      bad "AT+CFUN? not found in Tier 2 block — was it removed entirely?"
  fi
  ```

- [ ] **Step 2: Run test to verify it fails.**

  ```bash
  bash scripts/test/poller-phase-bcd.sh
  ```

  Expected: failure on `AT+CFUN? still runs on every cycle`.

- [ ] **Step 3: Move the CFUN block.**

  In `scripts/usr/bin/qmanager_poller`, **delete** the standalone CFUN block currently at lines ~1334–1342 (between the QCAINFO `sleep "$SIP_DELAY"` and the Tier 1.5 conditional). It looks like this — remove the entire block including the comment and the trailing `sleep`:

  ```sh
      # CFUN — standalone query every cycle (compound commands timeout in CFUN=0)
      local cfun_result
      cfun_result=$(qcmd 'AT+CFUN?' 2>/dev/null)
      if [ -n "$cfun_result" ]; then
          local cfun_val
          cfun_val=$(printf '%s\n' "$cfun_result" | grep '+CFUN:' | head -1 | tr -d '\r' | awk -F': ' '{print $2}' | tr -d ' ')
          [ -n "$cfun_val" ] && t1_cfun="$cfun_val"
      fi
      sleep "$SIP_DELAY"
  ```

  Then **add** an equivalent block inside the Tier 2 conditional. The Tier 2 block currently reads:

  ```sh
      # Tier 2 (warm data + SIM state)
      if [ $((cycle_count % TIER2_EVERY)) -eq 0 ]; then
          poll_tier2
          read_sim_state
      fi
  ```

  Replace it with:

  ```sh
      # Tier 2 (warm data + SIM state + CFUN)
      if [ $((cycle_count % TIER2_EVERY)) -eq 0 ]; then
          poll_tier2
          read_sim_state

          # CFUN — standalone query (compound commands timeout in CFUN=0).
          # Cadence is Tier 2 because airplane-mode toggles are user-driven and rare.
          local cfun_result
          cfun_result=$(qcmd 'AT+CFUN?' 2>/dev/null)
          if [ -n "$cfun_result" ]; then
              local cfun_val
              cfun_val=$(printf '%s\n' "$cfun_result" | grep '+CFUN:' | head -1 | tr -d '\r' | awk -F': ' '{print $2}' | tr -d ' ')
              [ -n "$cfun_val" ] && t1_cfun="$cfun_val"
          fi
          sleep "$SIP_DELAY"
      fi
  ```

- [ ] **Step 4: Run test to verify it passes.**

  ```bash
  bash scripts/test/poller-phase-bcd.sh
  ```

  Expected: both CFUN assertions PASS.

- [ ] **Step 5: Commit.**

  ```bash
  git add scripts/usr/bin/qmanager_poller scripts/test/poller-phase-bcd.sh
  git commit -m "perf(poller): move AT+CFUN? polling to Tier 2 cadence"
  ```

---

## Task 3: Coalesce `read_sim_state` jq invocations

`read_sim_state` runs at Tier 2 (every 30 s) and forks up to 7 `jq` processes — 3 against `SIM_SWAP_FLAG` (in the active-swap branch) and 4 against `SIM_FAILOVER_FILE`. On the device's slow ARM CPU each fork is ~30 ms. Coalesce into one `jq` call per file using `@tsv` then split with `cut`, matching the established pattern already used by `read_ping_data` (poller line 882).

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller` (rewrite `read_sim_state`)
- Modify: `scripts/test/poller-phase-bcd.sh` (add fixture)

- [ ] **Step 1: Write the failing test.**

  Append to `scripts/test/poller-phase-bcd.sh` (before the final `printf` block):

  ```bash
  section "read_sim_state coalesces jq calls per file"

  # Extract read_sim_state into an isolated file we can source.
  awk '/^read_sim_state\(\)/,/^\}/' "$REPO_ROOT/scripts/usr/bin/qmanager_poller" \
      > "$work/sim_fn.sh"

  # Build fixture flag files.
  swap_file="$work/sim_swap.json"
  fo_file="$work/sim_failover.json"
  cat > "$swap_file" <<'JSON'
  {
    "dismissed": false,
    "matching_profile_id": "prof-42",
    "matching_profile_name": "Home APN"
  }
  JSON
  cat > "$fo_file" <<'JSON'
  {
    "active": true,
    "original_slot": 1,
    "current_slot": 2,
    "switched_at": 1746500000
  }
  JSON

  # Counting jq shim — installs a fake `jq` ahead of the real one on PATH.
  shim_dir="$work/bin"
  mkdir -p "$shim_dir"
  jq_real=$(command -v jq)
  if [ -z "$jq_real" ]; then
      printf '  SKIP  read_sim_state (jq not available on workstation)\n'
  else
      counter="$work/jq_count"
      : > "$counter"
      cat > "$shim_dir/jq" <<SHIM
  #!/bin/sh
  printf 'x' >> "$counter"
  exec "$jq_real" "\$@"
  SHIM
      chmod +x "$shim_dir/jq"

      result=$(
          set +eu
          export PATH="$shim_dir:$PATH"
          SIM_SWAP_FLAG="$swap_file"
          SIM_FAILOVER_FILE="$fo_file"
          . "$work/sim_fn.sh"
          read_sim_state
          printf '%s|%s|%s|%s|%s|%s|%s\n' \
              "$sim_swap_detected" "$sim_swap_profile_id" "$sim_swap_profile_name" \
              "$sim_fo_active" "$sim_fo_original_slot" "$sim_fo_current_slot" \
              "$sim_fo_switched_at"
      )

      jq_calls=$(wc -c < "$counter" | tr -d ' ')

      case "$result" in
          "true|prof-42|Home APN|true|1|2|1746500000")
              ok "read_sim_state populated all 7 fields correctly"
              ;;
          *)
              bad "read_sim_state output mismatch: '$result'"
              ;;
      esac

      if [ "$jq_calls" -le 2 ]; then
          ok "read_sim_state used $jq_calls jq invocation(s) (≤2)"
      else
          bad "read_sim_state used $jq_calls jq invocations (expected ≤2)"
      fi
  fi
  ```

- [ ] **Step 2: Run test to verify it fails.**

  ```bash
  bash scripts/test/poller-phase-bcd.sh
  ```

  Expected: failure on `read_sim_state used 7 jq invocations (expected ≤2)`.

- [ ] **Step 3: Rewrite `read_sim_state`.**

  Replace the existing function (poller lines ~1031–1056) with:

  ```sh
  read_sim_state() {
      # SIM swap flag (boot-time, changes rarely)
      sim_swap_detected="false"
      sim_swap_profile_id=""
      sim_swap_profile_name=""
      if [ -f "$SIM_SWAP_FLAG" ]; then
          local _swap_data
          _swap_data=$(jq -r '[
              ((.dismissed) | if . == null then "false" else tostring end),
              (.matching_profile_id // ""),
              (.matching_profile_name // "")
          ] | @tsv' "$SIM_SWAP_FLAG" 2>/dev/null)
          local _dismissed
          _dismissed=$(printf '%s' "$_swap_data" | cut -f1)
          if [ "$_dismissed" != "true" ]; then
              sim_swap_detected="true"
              sim_swap_profile_id=$(printf '%s' "$_swap_data" | cut -f2)
              sim_swap_profile_name=$(printf '%s' "$_swap_data" | cut -f3)
          fi
      fi

      # SIM failover state (written by watchcat Tier 3)
      sim_fo_active="false"
      sim_fo_original_slot="null"
      sim_fo_current_slot="null"
      sim_fo_switched_at="null"
      if [ -f "$SIM_FAILOVER_FILE" ]; then
          local _fo_data
          _fo_data=$(jq -r '[
              ((.active) | if . == null then "false" else tostring end),
              ((.original_slot) | if . == null then "null" else tostring end),
              ((.current_slot) | if . == null then "null" else tostring end),
              ((.switched_at) | if . == null then "null" else tostring end)
          ] | @tsv' "$SIM_FAILOVER_FILE" 2>/dev/null)
          sim_fo_active=$(printf '%s' "$_fo_data" | cut -f1)
          sim_fo_original_slot=$(printf '%s' "$_fo_data" | cut -f2)
          sim_fo_current_slot=$(printf '%s' "$_fo_data" | cut -f3)
          sim_fo_switched_at=$(printf '%s' "$_fo_data" | cut -f4)
      fi
  }
  ```

- [ ] **Step 4: Run test to verify it passes.**

  ```bash
  bash scripts/test/poller-phase-bcd.sh
  ```

  Expected: both `read_sim_state` assertions PASS.

- [ ] **Step 5: Commit.**

  ```bash
  git add scripts/usr/bin/qmanager_poller scripts/test/poller-phase-bcd.sh
  git commit -m "perf(poller): coalesce read_sim_state jq calls (7→2)"
  ```

---

## Task 4: Replace per-line `cut` storms in `parse_ca_info` with IFS field splitting

`parse_ca_info` runs ~10 `cut -d',' -f<N>` forks per QCAINFO line, plus a `sed` and an `awk -F','` to count fields. With LTE-CA active and 4 NR SCCs (typical 5G-NSA), that's ~50–60 forks per Tier 2 cycle — far more than the rest of the parser combined. Replace the per-line forks with POSIX field splitting (`IFS=, set --`), keeping the existing branching logic and tests of `nfields` intact.

**Files:**
- Modify: `scripts/usr/lib/qmanager/parse_at.sh` (rewrite the per-line body of `parse_ca_info`'s `while` loop)
- Modify: `scripts/test/poller-phase-bcd.sh` (add fixture)

- [ ] **Step 1: Write the failing test.**

  Append to `scripts/test/poller-phase-bcd.sh`:

  ```bash
  section "parse_ca_info uses IFS field splitting (no per-line cut storm)"

  jq_real=$(command -v jq)
  if [ -z "$jq_real" ]; then
      printf '  SKIP  parse_ca_info (jq not available on workstation)\n'
  else
      # Source the parser library. It defines parse_ca_info, _lte_rb_to_mhz,
      # _nr_bw_to_mhz, and uses helper variables we have to provide.
      source_lib="$REPO_ROOT/scripts/usr/lib/qmanager/parse_at.sh"

      # Counting cut shim.
      shim_dir="$work/bin_pca"
      mkdir -p "$shim_dir"
      cut_real=$(command -v cut)
      counter="$work/cut_count"
      : > "$counter"
      cat > "$shim_dir/cut" <<SHIM
  #!/bin/sh
  printf 'x' >> "$counter"
  exec "$cut_real" "\$@"
  SHIM
      chmod +x "$shim_dir/cut"

      # Sample QCAINFO output: 1 LTE PCC + 1 LTE SCC + 1 NR SCC long form.
      sample_raw=$'+QCAINFO: "PCC",1350,75,"LTEBAND3",,135,-100,-12,-72,5\n+QCAINFO: "SCC",350,100,"LTEBAND7",1,200,-105,-13,-75,4\n+QCAINFO: "SCC",647424,3,"NR5GBAND78",1,500,0,0,2079167,-1000,-1100,500\nOK'

      result=$(
          set +eu
          export PATH="$shim_dir:$PATH"
          # Provide the few globals parse_ca_info reads.
          network_type="5G-NSA"
          # Source the library (includes _lte_rb_to_mhz, _nr_bw_to_mhz, parse_ca_info).
          . "$source_lib"
          parse_ca_info "$sample_raw"
          printf '%s|%s|%s|%s|%s|%s\n' \
              "$t2_ca_active" "$t2_ca_count" \
              "$t2_nr_ca_active" "$t2_nr_ca_count" \
              "$t2_total_bandwidth_mhz" "$t2_bandwidth_details"
          # carrier_components must contain 3 entries with the expected bands.
          printf '%s' "$t2_carrier_components" | jq -c 'map(.band)'
      )

      cut_calls=$(wc -c < "$counter" | tr -d ' ')

      summary=$(printf '%s\n' "$result" | head -1)
      bands=$(printf '%s\n' "$result" | tail -1)

      case "$summary" in
          'true|1|true|1|'*'|'*)
              ok "parse_ca_info populated CA totals correctly"
              ;;
          *)
              bad "parse_ca_info CA-totals output mismatch: '$summary'"
              ;;
      esac

      case "$bands" in
          '["B3","B7","N78"]')
              ok "parse_ca_info emitted expected band order [B3,B7,N78]"
              ;;
          *)
              bad "parse_ca_info band order mismatch: '$bands'"
              ;;
      esac

      # Before the fix: ~10 cuts per QCAINFO line × 3 lines = 30+ forks.
      # After: 0 cuts on the per-line path (only the final jq still uses cut-like ops indirectly).
      if [ "$cut_calls" -lt 5 ]; then
          ok "parse_ca_info issued $cut_calls cut invocations (<5)"
      else
          bad "parse_ca_info still issues $cut_calls cut invocations (expected <5)"
      fi
  fi
  ```

- [ ] **Step 2: Run test to verify it fails.**

  ```bash
  bash scripts/test/poller-phase-bcd.sh
  ```

  Expected: failure on `parse_ca_info still issues N cut invocations` where N is ~30+.

- [ ] **Step 3: Rewrite the per-line body of `parse_ca_info`.**

  In `scripts/usr/lib/qmanager/parse_at.sh`, locate the `while IFS= read -r line; do ... done < "$tmpfile"` loop inside `parse_ca_info` (lines ~559–666). Replace the loop body with the version below. Everything *outside* the loop (CA-count detection, the prefix-strip pipeline, the final `jq -Rs` rendering, the `t2_*` accumulator vars) stays unchanged.

  ```sh
      while IFS= read -r line; do
          # Strip prefix, quotes, spaces, carriage returns
          local csv
          csv=$(printf '%s' "$line" | sed 's/+QCAINFO: //g' | tr -d '"' | tr -d ' ' | tr -d '\r')

          # POSIX field splitting — one substitution instead of 10 cut forks.
          local _OLD_IFS=$IFS
          IFS=','
          # shellcheck disable=SC2086 # intentional word splitting on commas
          set -- $csv
          IFS=$_OLD_IFS
          local nfields=$#

          [ "$nfields" -lt 4 ] && continue

          local cc_type="$1"
          local freq="$2"
          local bw_raw="$3"
          local band_str="$4"

          local tech="" band_short="" mhz=0
          local cc_pci="null" cc_rsrp="null" cc_rsrq="null" cc_rssi="null" cc_sinr="null"

          case "$band_str" in
              LTEBAND*)
                  # ---- LTE line ----
                  # Positions: type(1),freq(2),bw(3),band(4),state(5),PCI(6),RSRP(7),RSRQ(8),RSSI(9),RSSNR(10)
                  tech="LTE"
                  mhz=$(_lte_rb_to_mhz "$bw_raw")
                  local band_num
                  band_num=$(printf '%s' "$band_str" | sed 's/LTEBAND//')
                  band_short="B${band_num}"

                  [ "$nfields" -ge 6 ]  && cc_pci="$6"
                  [ "$nfields" -ge 7 ]  && cc_rsrp="$7"
                  [ "$nfields" -ge 8 ]  && cc_rsrq="$8"
                  [ "$nfields" -ge 9 ]  && cc_rssi="$9"
                  [ "$nfields" -ge 10 ] && cc_sinr="${10}"
                  ;;
              NR5GBAND*|NRDCBAND*)
                  # ---- NR line ----
                  tech="NR"
                  mhz=$(_nr_bw_to_mhz "$bw_raw")
                  local band_num
                  band_num=$(printf '%s' "$band_str" | sed 's/NR5GBAND//;s/NRDCBAND//')
                  band_short="N${band_num}"

                  if [ "$nfields" -ge 9 ]; then
                      # Long form (SCC with UL info):
                      # type(1),freq(2),bw(3),band(4),state(5),PCI(6),UL_cfg(7),UL_bw(8),UL_ARFCN(9)[,RSRP(10),RSRQ(11)[,SNR(12)]]
                      [ "$nfields" -ge 6 ]  && cc_pci="$6"
                      [ "$nfields" -ge 10 ] && cc_rsrp="${10}"
                      [ "$nfields" -ge 11 ] && cc_rsrq="${11}"
                      if [ "$nfields" -ge 12 ]; then
                          local raw_snr="${12}"
                          case "$raw_snr" in
                              -32768) cc_sinr="null" ;;
                              *) cc_sinr=$(printf '%s' "$raw_snr" | awk '{if($1+0==$1) printf "%.1f", $1/100; else print "null"}') ;;
                          esac
                      fi
                  else
                      # Short form (PCC or old SCC):
                      # type(1),freq(2),bw(3),band(4),PCI(5)[,RSRP(6),RSRQ(7)[,SNR(8)]]
                      [ "$nfields" -ge 5 ] && cc_pci="$5"
                      [ "$nfields" -ge 6 ] && cc_rsrp="$6"
                      [ "$nfields" -ge 7 ] && cc_rsrq="$7"
                      if [ "$nfields" -ge 8 ]; then
                          local raw_snr="$8"
                          case "$raw_snr" in
                              -32768) cc_sinr="null" ;;
                              *) cc_sinr=$(printf '%s' "$raw_snr" | awk '{if($1+0==$1) printf "%.1f", $1/100; else print "null"}') ;;
                          esac
                      fi
                  fi
                  ;;
              *)
                  # Unrecognized band string — skip
                  continue
                  ;;
          esac

          # --- Accumulate bandwidth totals ---
          if [ "$mhz" -gt 0 ] 2>/dev/null; then
              total_mhz=$((total_mhz + mhz))
              if [ -n "$details" ]; then
                  details="${details} + ${band_short}: ${mhz} MHz"
              else
                  details="${band_short}: ${mhz} MHz"
              fi
          fi

          # --- Sanitize numeric fields (empty / dash / non-numeric → null) ---
          case "$cc_pci"  in ''|'-'|*[!0-9-]*) cc_pci="null"  ;; esac
          case "$cc_rsrp" in ''|'-'|*[!0-9-]*) cc_rsrp="null" ;; esac
          case "$cc_rsrq" in ''|'-'|*[!0-9-]*) cc_rsrq="null" ;; esac
          case "$cc_rssi" in ''|'-'|*[!0-9-]*) cc_rssi="null" ;; esac
          # cc_sinr may be a float (NR /100 conversion) — validated by awk above
          case "$cc_sinr" in ''|'-') cc_sinr="null" ;; esac

          # --- Write carrier data for jq processing ---
          printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
              "$cc_type" "$tech" "$band_short" "${freq:-null}" "$mhz" \
              "$cc_pci" "$cc_rsrp" "$cc_rsrq" "$cc_rssi" "$cc_sinr" >> "$cc_tmpfile"

      done < "$tmpfile"
  ```

  Note: positional params `${10}`–`${12}` require brace syntax in POSIX/`bash`; `$10` would parse as `$1` followed by literal `0`.

- [ ] **Step 4: Run test to verify it passes.**

  ```bash
  bash scripts/test/poller-phase-bcd.sh
  ```

  Expected: all three `parse_ca_info` assertions PASS, including the cut-count assertion.

- [ ] **Step 5: Commit.**

  ```bash
  git add scripts/usr/lib/qmanager/parse_at.sh scripts/test/poller-phase-bcd.sh
  git commit -m "perf(parse-at): replace per-line cut forks in parse_ca_info with IFS split"
  ```

---

## Task 5: Persist `events_initialized` across poller restarts

When the poller restarts (crash, OOM, deploy), `events_initialized=false` resets and the first `detect_events` call after restart suppresses all events — so any band/PCI/network-mode change that happened during the restart window is silently dropped. Persist `prev_ev_*` snapshots to `/tmp/qmanager_event_state.json` so a non-reboot restart picks up where the previous instance left off. `/tmp` clears on reboot, which correctly forces a cold start with no events fired.

**Files:**
- Modify: `scripts/usr/lib/qmanager/events.sh` (extend `snapshot_event_state` to persist state; add `restore_event_state`)
- Modify: `scripts/usr/bin/qmanager_poller` (call `restore_event_state` from `main`)
- Modify: `scripts/test/poller-phase-bcd.sh` (add fixture)

- [ ] **Step 1: Read the existing `snapshot_event_state` to understand which vars need to be persisted.**

  ```bash
  awk '/^snapshot_event_state\(\)/,/^\}/' scripts/usr/lib/qmanager/events.sh
  ```

  Note all `prev_ev_*` vars assigned. The new persistence layer must round-trip every one of them.

- [ ] **Step 2: Write the failing test.**

  Append to `scripts/test/poller-phase-bcd.sh`:

  ```bash
  section "events_initialized state persists across restart"

  jq_real=$(command -v jq)
  if [ -z "$jq_real" ]; then
      printf '  SKIP  event-state persistence (jq not available)\n'
  else
      events_lib="$REPO_ROOT/scripts/usr/lib/qmanager/events.sh"
      state_file="$work/event_state.json"

      # First instance: snapshot a known state.
      (
          set +eu
          # Stub qlog helpers and append_event used by the lib.
          qlog_debug() { :; }
          qlog_info() { :; }
          qlog_warn() { :; }
          qlog_error() { :; }
          append_event() { :; }
          EVENT_STATE_FILE="$state_file"
          # Pretend prev_ev_* came from an earlier cycle.
          prev_ev_network_type="5G-NSA"
          prev_ev_lte_band="B3"
          prev_ev_lte_pci="135"
          prev_ev_nr_band="N78"
          prev_ev_nr_pci="500"
          prev_ev_nr_state="connected"
          prev_ev_modem_reachable="true"
          prev_ev_internet="true"
          prev_ev_ca_active="true"
          prev_ev_ca_count="1"
          prev_ev_nr_ca_active="false"
          prev_ev_nr_ca_count="0"
          prev_ev_service_status="optimal"
          prev_ev_carrier_components="[]"
          prev_ev_cfun="1"
          . "$events_lib"
          snapshot_event_state
      )

      if [ -s "$state_file" ]; then
          ok "snapshot_event_state wrote $state_file"
      else
          bad "snapshot_event_state did not write $state_file"
      fi

      # Second instance (simulated restart): restore_event_state should re-populate.
      restored=$(
          set +eu
          qlog_debug() { :; }
          qlog_info() { :; }
          qlog_warn() { :; }
          qlog_error() { :; }
          EVENT_STATE_FILE="$state_file"
          events_initialized=false
          . "$events_lib"
          restore_event_state
          printf '%s|%s|%s|%s\n' \
              "$events_initialized" "$prev_ev_lte_pci" "$prev_ev_nr_band" "$prev_ev_service_status"
      )

      case "$restored" in
          'true|135|N78|optimal')
              ok "restore_event_state re-populated prev_ev_* and set events_initialized=true"
              ;;
          *)
              bad "restore_event_state mismatch: '$restored'"
              ;;
      esac

      # Missing-state-file path (true cold boot, /tmp cleared) must not initialize.
      cold=$(
          set +eu
          qlog_debug() { :; }
          qlog_info() { :; }
          qlog_warn() { :; }
          qlog_error() { :; }
          EVENT_STATE_FILE="$work/nonexistent.json"
          events_initialized=false
          . "$events_lib"
          restore_event_state
          printf '%s' "$events_initialized"
      )

      case "$cold" in
          false) ok "restore_event_state leaves events_initialized=false on cold boot" ;;
          *)     bad "restore_event_state forced events_initialized='$cold' on cold boot (expected false)" ;;
      esac
  fi
  ```

- [ ] **Step 3: Run test to verify it fails.**

  ```bash
  bash scripts/test/poller-phase-bcd.sh
  ```

  Expected: failure on `restore_event_state` (function not defined yet).

- [ ] **Step 4: Add persistence to `snapshot_event_state` and create `restore_event_state`.**

  At the top of `scripts/usr/lib/qmanager/events.sh`, near the existing constants (`EVENTS_FILE`, `MAX_EVENTS`), add:

  ```sh
  EVENT_STATE_FILE="${EVENT_STATE_FILE:-/tmp/qmanager_event_state.json}"
  EVENT_STATE_TMP="${EVENT_STATE_FILE}.tmp"
  ```

  At the *end* of the existing `snapshot_event_state()` body (just before its closing `}`), append a write block. Note: the existing function already assigns `prev_ev_*` from the live state; we mirror those assignments into the JSON snapshot.

  ```sh
      # Persist for restart recovery (atomic .tmp + mv).
      jq -n \
          --arg net   "$prev_ev_network_type" \
          --arg lteb  "$prev_ev_lte_band" \
          --arg ltep  "$prev_ev_lte_pci" \
          --arg nrb   "$prev_ev_nr_band" \
          --arg nrp   "$prev_ev_nr_pci" \
          --arg nrs   "$prev_ev_nr_state" \
          --arg mr    "$prev_ev_modem_reachable" \
          --arg net2  "$prev_ev_internet" \
          --arg caa   "$prev_ev_ca_active" \
          --arg cac   "$prev_ev_ca_count" \
          --arg ncaa  "$prev_ev_nr_ca_active" \
          --arg ncac  "$prev_ev_nr_ca_count" \
          --arg svc   "$prev_ev_service_status" \
          --arg cc    "$prev_ev_carrier_components" \
          --arg cfun  "${prev_ev_cfun:-}" \
          '{
              network_type: $net, lte_band: $lteb, lte_pci: $ltep,
              nr_band: $nrb, nr_pci: $nrp, nr_state: $nrs,
              modem_reachable: $mr, internet: $net2,
              ca_active: $caa, ca_count: $cac,
              nr_ca_active: $ncaa, nr_ca_count: $ncac,
              service_status: $svc, carrier_components: $cc,
              cfun: $cfun
          }' > "$EVENT_STATE_TMP" 2>/dev/null && \
          mv "$EVENT_STATE_TMP" "$EVENT_STATE_FILE" 2>/dev/null
  ```

  Add a new function after `snapshot_event_state`:

  ```sh
  # Restore prev_ev_* from disk on poller startup. Sets events_initialized=true
  # if state was loaded successfully, leaves it false otherwise (cold boot).
  restore_event_state() {
      [ -s "$EVENT_STATE_FILE" ] || return 0

      local _data
      _data=$(jq -r '[
          (.network_type // ""),
          (.lte_band // ""),
          (.lte_pci // ""),
          (.nr_band // ""),
          (.nr_pci // ""),
          (.nr_state // ""),
          (.modem_reachable // ""),
          (.internet // ""),
          (.ca_active // ""),
          (.ca_count // ""),
          (.nr_ca_active // ""),
          (.nr_ca_count // ""),
          (.service_status // ""),
          (.carrier_components // ""),
          (.cfun // "")
      ] | @tsv' "$EVENT_STATE_FILE" 2>/dev/null) || return 0

      [ -z "$_data" ] && return 0

      prev_ev_network_type=$(printf '%s' "$_data" | cut -f1)
      prev_ev_lte_band=$(printf '%s' "$_data" | cut -f2)
      prev_ev_lte_pci=$(printf '%s' "$_data" | cut -f3)
      prev_ev_nr_band=$(printf '%s' "$_data" | cut -f4)
      prev_ev_nr_pci=$(printf '%s' "$_data" | cut -f5)
      prev_ev_nr_state=$(printf '%s' "$_data" | cut -f6)
      prev_ev_modem_reachable=$(printf '%s' "$_data" | cut -f7)
      prev_ev_internet=$(printf '%s' "$_data" | cut -f8)
      prev_ev_ca_active=$(printf '%s' "$_data" | cut -f9)
      prev_ev_ca_count=$(printf '%s' "$_data" | cut -f10)
      prev_ev_nr_ca_active=$(printf '%s' "$_data" | cut -f11)
      prev_ev_nr_ca_count=$(printf '%s' "$_data" | cut -f12)
      prev_ev_service_status=$(printf '%s' "$_data" | cut -f13)
      prev_ev_carrier_components=$(printf '%s' "$_data" | cut -f14)
      prev_ev_cfun=$(printf '%s' "$_data" | cut -f15)

      events_initialized=true
      qlog_info "Event detection state restored from $EVENT_STATE_FILE"
  }
  ```

- [ ] **Step 5: Wire `restore_event_state` into the poller's `main()`.**

  In `scripts/usr/bin/qmanager_poller`, find `main()` (currently around line 1373). Add the `restore_event_state` call after `email_alerts_init` / `sms_alerts_init` and before the first `write_cache`:

  ```sh
      collect_boot_data
      update_proc_metrics
      email_alerts_init
      sms_alerts_init
      restore_event_state
      write_cache
  ```

- [ ] **Step 6: Run test to verify it passes.**

  ```bash
  bash scripts/test/poller-phase-bcd.sh
  ```

  Expected: all three event-state assertions PASS.

- [ ] **Step 7: Commit.**

  ```bash
  git add scripts/usr/lib/qmanager/events.sh scripts/usr/bin/qmanager_poller scripts/test/poller-phase-bcd.sh
  git commit -m "fix(events): persist event-detection state across poller restart"
  ```

---

## Task 6: Bounded `ExecStartPre` wait for `/dev/smd11`

The poller's systemd unit currently fails immediately if `/dev/smd11` is missing at start, relying on `Restart=on-failure` to retry. That works but pollutes journals with a noisy failure on every cold boot where the modem is slow to enumerate. Replace the one-shot existence check with a bounded poll: up to 30 s of `sleep 1` increments, exit 0 on first appearance, exit 1 if still missing after the timeout.

**Files:**
- Modify: `scripts/etc/systemd/system/qmanager-poller.service` (replace `ExecStartPre`)
- Modify: `scripts/test/poller-phase-bcd.sh` (add fixture)

- [ ] **Step 1: Write the failing test.**

  Append to `scripts/test/poller-phase-bcd.sh`:

  ```bash
  section "qmanager-poller ExecStartPre uses bounded wait"

  unit="$REPO_ROOT/scripts/etc/systemd/system/qmanager-poller.service"

  if grep -E '^ExecStartPre=.*while.*\[ ! -e /dev/smd11 \]' "$unit" >/dev/null 2>&1; then
      ok "ExecStartPre polls for /dev/smd11 with a while loop"
  else
      bad "ExecStartPre does not poll for /dev/smd11"
  fi

  # Smoke-test the loop logic against a stub path.
  stub="$work/smd_stub"
  rm -f "$stub"

  loop_body() {
      i=0
      while [ "$i" -lt 5 ] && [ ! -e "$1" ]; do
          sleep 1
          i=$((i + 1))
      done
      [ -e "$1" ]
  }

  # Case A: file never appears → exit 1 after ~5s.
  start=$(date +%s)
  if loop_body "$stub"; then
      bad "loop returned 0 with missing stub file"
  else
      ok "loop returned non-zero when stub never appears"
  fi
  end=$(date +%s)
  elapsed=$((end - start))
  if [ "$elapsed" -ge 4 ] && [ "$elapsed" -le 7 ]; then
      ok "loop slept ~5s before giving up (got ${elapsed}s)"
  else
      bad "loop elapsed ${elapsed}s, expected 4–7s"
  fi

  # Case B: file appears after ~2s → exit 0 promptly.
  ( sleep 2 && touch "$stub" ) &
  spawner=$!
  start=$(date +%s)
  if loop_body "$stub"; then
      ok "loop returned 0 once stub appeared"
  else
      bad "loop returned non-zero despite stub appearance"
  fi
  end=$(date +%s)
  elapsed=$((end - start))
  wait "$spawner" 2>/dev/null || true
  if [ "$elapsed" -le 4 ]; then
      ok "loop exited promptly (~${elapsed}s) once stub appeared"
  else
      bad "loop took ${elapsed}s to notice stub (expected ≤4s)"
  fi
  ```

- [ ] **Step 2: Run test to verify it fails.**

  ```bash
  bash scripts/test/poller-phase-bcd.sh
  ```

  Expected: failure on `ExecStartPre does not poll for /dev/smd11` (the `while` loop isn't there yet).

- [ ] **Step 3: Replace the `ExecStartPre` line.**

  In `scripts/etc/systemd/system/qmanager-poller.service`, replace this line:

  ```ini
  ExecStartPre=/bin/sh -c '[ -e /dev/smd11 ] || { echo "AT device /dev/smd11 not found"; exit 1; }'
  ```

  with:

  ```ini
  ExecStartPre=/bin/sh -c 'i=0; while [ $i -lt 30 ] && [ ! -e /dev/smd11 ]; do sleep 1; i=$((i+1)); done; [ -e /dev/smd11 ] || { echo "AT device /dev/smd11 not found after 30s"; exit 1; }'
  ```

- [ ] **Step 4: Run test to verify it passes.**

  ```bash
  bash scripts/test/poller-phase-bcd.sh
  ```

  Expected: all four ExecStartPre assertions PASS.

- [ ] **Step 5: Commit.**

  ```bash
  git add scripts/etc/systemd/system/qmanager-poller.service scripts/test/poller-phase-bcd.sh
  git commit -m "fix(systemd): bounded wait for /dev/smd11 in poller ExecStartPre"
  ```

---

## Task 7: Cycle-time watchdog

Wrap each `poll_cycle` invocation with start/end timestamps. If a cycle exceeds the budget (5× `POLL_INTERVAL` = 10 s), emit a `qlog_warn` so stuck cycles surface in logs even when they don't actually crash the daemon. This is observability, not control — it doesn't kill the cycle, just reports.

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller` (add `CYCLE_TIME_BUDGET` constant; instrument the main loop)
- Modify: `scripts/test/poller-phase-bcd.sh` (add fixture)

- [ ] **Step 1: Write the failing test.**

  Append to `scripts/test/poller-phase-bcd.sh`:

  ```bash
  section "main loop logs cycle-budget overruns"

  poller_src="$REPO_ROOT/scripts/usr/bin/qmanager_poller"

  # Source-level checks: constant declared, warn block present.
  if grep -E '^CYCLE_TIME_BUDGET=[0-9]+' "$poller_src" >/dev/null; then
      ok "CYCLE_TIME_BUDGET constant declared"
  else
      bad "CYCLE_TIME_BUDGET constant missing"
  fi

  if grep -E 'poll_cycle exceeded budget' "$poller_src" >/dev/null; then
      ok "main loop warns on cycle-budget overrun"
  else
      bad "main loop does not warn on cycle-budget overrun"
  fi

  # Behavioral check: extract the wrapper logic and run it with a stub poll_cycle.
  # We need:
  #   - cycle_start=$(date +%s) before poll_cycle
  #   - cycle_end=$(date +%s) after poll_cycle
  #   - if (cycle_end - cycle_start) > CYCLE_TIME_BUDGET: qlog_warn ...
  cat > "$work/loop_test.sh" <<'LOOP'
  set -eu
  # Stubs.
  warns=""
  qlog_warn() { warns="${warns}|$1"; }
  qlog_info() { :; }
  qlog_debug() { :; }
  qlog_error() { :; }
  CYCLE_TIME_BUDGET=2
  POLL_INTERVAL=0  # don't actually sleep between cycles
  cycles_done=0
  poll_cycle() {
      cycles_done=$((cycles_done + 1))
      [ "$cycles_done" -eq 1 ] && sleep 4   # first cycle blows the budget
      return 0
  }

  # The wrapper logic — should match what the poller's main() uses.
  cycle_count=0
  while [ "$cycle_count" -lt 2 ]; do
      cycle_start=$(date +%s)
      poll_cycle
      cycle_end=$(date +%s)
      cycle_duration=$((cycle_end - cycle_start))
      if [ "$cycle_duration" -gt "$CYCLE_TIME_BUDGET" ]; then
          qlog_warn "poll_cycle exceeded budget: ${cycle_duration}s > ${CYCLE_TIME_BUDGET}s"
      fi
      sleep "$POLL_INTERVAL"
      cycle_count=$((cycle_count + 1))
  done

  printf '%s' "$warns"
  LOOP

  warn_output=$(bash "$work/loop_test.sh")
  case "$warn_output" in
      *'poll_cycle exceeded budget'*)
          ok "wrapper logic emits the expected warning on overrun"
          ;;
      *)
          bad "wrapper logic produced no warning: '$warn_output'"
          ;;
  esac
  ```

- [ ] **Step 2: Run test to verify it fails.**

  ```bash
  bash scripts/test/poller-phase-bcd.sh
  ```

  Expected: failure on `CYCLE_TIME_BUDGET constant missing`.

- [ ] **Step 3: Add the constant.**

  In `scripts/usr/bin/qmanager_poller`, near the other cadence constants (`POLL_INTERVAL`, `TIER1_5_EVERY`, `TIER2_EVERY` around line 35), add:

  ```sh
  CYCLE_TIME_BUDGET=10   # seconds; warn if poll_cycle exceeds this
  ```

- [ ] **Step 4: Instrument the main loop.**

  In the `main()` function, replace the existing main loop block:

  ```sh
      while true; do
          poll_cycle
          sleep "$POLL_INTERVAL"
      done
  ```

  with:

  ```sh
      while true; do
          local cycle_start cycle_end cycle_duration
          cycle_start=$(date +%s)
          poll_cycle
          cycle_end=$(date +%s)
          cycle_duration=$((cycle_end - cycle_start))
          if [ "$cycle_duration" -gt "$CYCLE_TIME_BUDGET" ]; then
              qlog_warn "poll_cycle exceeded budget: ${cycle_duration}s > ${CYCLE_TIME_BUDGET}s"
          fi
          sleep "$POLL_INTERVAL"
      done
  ```

  Note: `local` is only valid inside a function — `main()` is a function, so this is fine. (If your shell ever runs the `while` loop at top level, drop the `local`.)

- [ ] **Step 5: Run test to verify it passes.**

  ```bash
  bash scripts/test/poller-phase-bcd.sh
  ```

  Expected: all three watchdog assertions PASS.

- [ ] **Step 6: Commit.**

  ```bash
  git add scripts/usr/bin/qmanager_poller scripts/test/poller-phase-bcd.sh
  git commit -m "feat(poller): warn when poll_cycle exceeds CYCLE_TIME_BUDGET"
  ```

---

## Task 8: Release notes (consolidate into v0.1.7)

The existing v0.1.7 entry (added by the Phase A plan) is **not yet released** — there is no canonical v0.1.7 in the wild. Replace it with a single unified v0.1.7 that covers both Phase A and Phase B+C, so the whole batch ships as one cohesive release. Do **not** bump to v0.1.8.

**Files:**
- Modify: `RELEASE_NOTES.md` (delete the existing v0.1.7 section and replace with the unified version)

- [ ] **Step 1: Open `RELEASE_NOTES.md` and locate the existing v0.1.7 header** (added by the Phase A plan).

- [ ] **Step 2: Delete the entire existing v0.1.7 section** — its header, its `### Improvements` subsection, and all its bullets, up to (but not including) the next `## v0.1.6` header.

- [ ] **Step 3: Insert the unified v0.1.7 section in its place.** Same position (immediately above v0.1.6). Match the existing tone: user-facing, "what changed and why it matters", no implementation details. New Features go before Improvements per the project convention.

  ```markdown
  ## v0.1.7 — Poller Reliability & Performance Hardening

  ### New Features

  - **Cycle-budget watchdog.** The background poller now records each cycle's wall-clock time and logs a warning when one exceeds the 10-second budget. Stuck cycles that don't actually crash the daemon are now visible to anyone tailing the logs.
  - **Ping-daemon liveness event.** When the ping daemon goes silent for 60+ seconds the poller now surfaces a `ping_daemon_stale` event in the activity feed instead of failing silently. Also auto-recovers when the daemon resumes.

  ### Improvements

  - **Alerts no longer block the poller.** Email and SMS notifications dispatch in the background, so a slow SMTP server, a stuck registration retry, or a 30-second TCP timeout can't pause data collection any more. Status reflects this within a couple of cycles either way.
  - **Accurate traffic rate after slow cycles.** The bytes-per-second math now uses elapsed wall time rather than a fixed 2-second divisor, so the false 30× spikes that used to appear after a long-running scan or AT-command stall are gone.
  - **Self-healing scan-in-progress flag.** The "long-running operation" marker now expires automatically after 5 minutes, so a CGI script that crashed mid-scan can no longer wedge the poller into a permanent `scan_in_progress` state.
  - **Stale "optimal" no longer bleeds across cycles.** The connection status is now reset on every poll, so a transient registration loss can't leave a misleading "optimal" badge behind.
  - **Faster, cheaper polling.** Carrier-aggregation parsing no longer fork-spams `cut`/`sed` for every QCAINFO line, SIM-state reads use a single `jq` call per file, and `AT+CFUN?` runs every 30 seconds instead of every 2. On slow ARM hardware this trims around 50 ms off most cycles and keeps the daemon comfortably inside its 2-second budget under CA-heavy 5G-NSA conditions.
  - **No more lost events on poller restart.** Network-type, band, PCI, and CA state are now persisted to `/tmp` and restored on the next start, so a crash, OOM, or deploy no longer silently drops events that happened during the restart window. A real reboot still starts cold (events suppressed), as before.
  - **Cleaner cold boots.** The poller's systemd unit now waits up to 30 seconds for `/dev/smd11` to appear before failing, ending the noisy "AT device not found" entries on the very first boot after a flash.
  ```

- [ ] **Step 4: Run the harness one last time to confirm nothing regressed.**

  ```bash
  bash scripts/test/poller-phase-a.sh
  bash scripts/test/poller-phase-bcd.sh
  ```

  Expected: both harnesses end with `ALL PASS`.

- [ ] **Step 4: Commit.**

  ```bash
  git add RELEASE_NOTES.md
  git commit -m "docs: add v0.1.8 release notes for Phase B+C poller hardening"
  ```

---

## Done criteria

- All seven implementation tasks committed on `fix/poller-phase-bcd-hardening`.
- `bash scripts/test/poller-phase-bcd.sh` passes with no failures.
- `bash scripts/test/poller-phase-a.sh` still passes (Phase A regressions caught).
- Branch ready to push, PR, and stack on top of (or merge after) Phase A.

## Out of scope (deferred)

These items were considered during the audit and intentionally dropped:

- **Standalone `ping_stale` event.** Already covered by Phase A's `ping_daemon_stale`.
- **Atomic `events.json` appends.** A single `jq -n … >> file` of <4 KB is already kernel-atomic per POSIX; no fix needed.
- **Full `awk` port of `parse_ca_info`.** IFS field splitting (Task 4) eliminates the per-line fork storm with a fraction of the risk; reserve a full awk rewrite for a future phase only if profiling still flags it.
