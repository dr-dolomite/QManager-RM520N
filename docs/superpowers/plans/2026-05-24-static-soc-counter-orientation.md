# Static SoC-Based Data Counter Orientation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Schema v4's per-boot Cloudflare orientation probe with a static SoC-to-orientation map read from `/etc/quectel-project-version`, persisted inside `data_used.json` as the new Schema v5.

**Architecture:** Single-layer change to the poller backend. One new function (`detect_orientation_from_soc`) called once at startup wires `orientation_dl_field` / `orientation_ul_field` for the lifetime of the process. The CGI cache block renames `orientation_state` → `orientation` (no frontend consumers today). The v4 probe machinery (function pair, sentinel-file orchestration, history-swap migration) is deleted. v3/v4 → v5 migration resets accumulators.

**Tech Stack:** Bash (with `#!/bin/bash` shebang preserved for 64-bit arithmetic), `jq` for JSON I/O, `awk` for `/proc/net/dev` parsing. Test harness extracts functions via `awk` and shims them — pattern already in `scripts/test/poller-data-used.sh`.

---

## File Structure

**Modified:**
- `scripts/usr/bin/qmanager_poller` — add `detect_orientation_from_soc()`, wire startup detection, remove probe machinery, bump schema to v5, rename CGI emit field, reset accumulators on v3/v4 load
- `scripts/test/poller-data-used.sh` — update fixtures for v5, add new tests for SoC detection and v3/v4-reset behavior

**Documentation (Phase 6):**
- `docs/reference/data-usage-counter.md` — rewrite Schema and Orientation sections for v5
- `docs/reference/data-counter-platform-matrix.md` — replace "Dynamic orientation detection" section with "Static SoC orientation mapping"
- `CLAUDE.md` — update the Data Usage Counter feature bullet

**Not modified:** No CGI scripts, no frontend hooks, no types, no install/systemd files.

---

### Task 1: Add `detect_orientation_from_soc()` function

Adds the SoC-to-orientation mapping function. Accepts a `QUECTEL_VERSION_FILE` env override so the test harness can supply a fixture.

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller` (insert near line 77, before the `# --- Orientation detection (Tier 1)` block that will be deleted in Task 3)
- Test: `scripts/test/poller-data-used.sh` (append new test section)

- [ ] **Step 1: Write the failing test**

Append to `scripts/test/poller-data-used.sh` BEFORE the `# --- Summary` block (after line 168 — line numbers refer to the file as it exists today before this plan begins):

```bash
# --- Test 7: SoC detection — SDX6X returns normal ---------------------
section "detect_orientation_from_soc maps SDX6X to normal"
qv="$work/quectel_sdx6x"
cat > "$qv" <<'EOF'
Project Rev      : RM520NGLAAR03A03M4G_A0.303
Branch Name      : SDX6X
EOF
result=$(
    awk '/^detect_orientation_from_soc\(\)/,/^\}/' "$POLLER" > "$work/fn_det.sh"
    (
        set +eu
        . "$work/fn_det.sh"
        QUECTEL_VERSION_FILE="$qv" detect_orientation_from_soc
    )
)
[ "$result" = "normal" ] && ok "SDX6X -> normal" || bad "SDX6X gave '$result'"

# --- Test 8: SoC detection — SDX55 returns reversed -------------------
section "detect_orientation_from_soc maps SDX55 to reversed"
qv="$work/quectel_sdx55"
cat > "$qv" <<'EOF'
Project Rev      : RM502QAEAAR13A04M4G_01.200
Branch Name      : SDX55
EOF
result=$(
    (
        set +eu
        . "$work/fn_det.sh"
        QUECTEL_VERSION_FILE="$qv" detect_orientation_from_soc
    )
)
[ "$result" = "reversed" ] && ok "SDX55 -> reversed" || bad "SDX55 gave '$result'"

# --- Test 9: SoC detection — unknown branch falls back to normal ------
section "detect_orientation_from_soc unknown branch -> normal"
qv="$work/quectel_unknown"
cat > "$qv" <<'EOF'
Project Rev      : XXX
Branch Name      : SDX99
EOF
result=$(
    (
        set +eu
        . "$work/fn_det.sh"
        QUECTEL_VERSION_FILE="$qv" detect_orientation_from_soc
    )
)
[ "$result" = "normal" ] && ok "unknown SoC -> normal" || bad "unknown gave '$result'"

# --- Test 10: SoC detection — missing file -> normal ------------------
section "detect_orientation_from_soc missing file -> normal"
result=$(
    (
        set +eu
        . "$work/fn_det.sh"
        QUECTEL_VERSION_FILE="/nonexistent/path/version" detect_orientation_from_soc
    )
)
[ "$result" = "normal" ] && ok "missing file -> normal" || bad "missing gave '$result'"
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bash scripts/test/poller-data-used.sh
```

Expected: tests 1–6 pass as before; tests 7–10 fail because `detect_orientation_from_soc` does not yet exist (the awk extraction will produce an empty `fn_det.sh`).

- [ ] **Step 3: Add the function to the poller**

In `scripts/usr/bin/qmanager_poller`, locate the existing block at lines 43–48:

```bash
# Network interface for traffic stats (platform-specific)
if [ -f /etc/quectel-project-version ]; then
    NETWORK_IFACE="rmnet_ipa0"   # RM520N-GL internal modem
else
    NETWORK_IFACE="wwan0"        # RM551E on OpenWRT
fi
```

Immediately AFTER that block (before the existing `SIP_DELAY=0.1` line on line 49), insert:

```bash

# --- Counter orientation (Tier 1) -------------------------------------------
# /etc/quectel-project-version path. Overridable for the test harness.
: "${QUECTEL_VERSION_FILE:=/etc/quectel-project-version}"

detect_orientation_from_soc() {
    # Print "normal" or "reversed" on stdout based on the SoC Branch Name
    # in $QUECTEL_VERSION_FILE. SDX55 (RM502Q-AE) attributes IPA fast-path
    # bytes to the swapped /proc/net/dev column under live traffic, so it
    # needs reversed mapping. SDX6X (SDX65/x62 — RM520N-GL) and any
    # unrecognized / missing SoC use the Quectel-spec orientation
    # (field 2 = DL, field 10 = UL). See
    # docs/reference/data-counter-platform-matrix.md for the empirical
    # evidence behind this table.
    local _branch=""
    if [ -f "$QUECTEL_VERSION_FILE" ]; then
        _branch=$(awk -F': *' '/^Branch Name/ {print $2; exit}' \
                  "$QUECTEL_VERSION_FILE" 2>/dev/null | tr -d '\r\n ')
    fi
    case "$_branch" in
        SDX55) printf 'reversed\n' ;;
        *)     printf 'normal\n'   ;;
    esac
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bash scripts/test/poller-data-used.sh
```

Expected: tests 1–10 all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/usr/bin/qmanager_poller scripts/test/poller-data-used.sh
git commit -m "feat(poller): add detect_orientation_from_soc helper

Static SoC -> orientation mapping from /etc/quectel-project-version
Branch Name. SDX55 -> reversed; SDX6X / unknown / missing -> normal.
Path is overridable via QUECTEL_VERSION_FILE for the test harness."
```

---

### Task 2: Bump schema to v5 and add the new state variables

Schema constant changes; new state variables for the static-orientation regime are introduced (replacing the probe-era variables). The probe machinery itself is removed in Task 3.

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller`

- [ ] **Step 1: Bump the schema constant**

Locate line 74:

```bash
DATA_USED_SCHEMA=4
```

Replace with:

```bash
DATA_USED_SCHEMA=5
```

- [ ] **Step 2: Update the schema-purpose comment**

Locate lines 71–73:

```bash
# Schema 4 treats accumulated_rx_bytes / accumulated_tx_bytes as semantic
# download/upload regardless of which raw field they came from, and adds
# orientation_history_swapped as a one-shot v3→v4 migration sentinel.
```

Replace with:

```bash
# Schema 5: counter orientation is determined once at startup from the
# SoC Branch Name in /etc/quectel-project-version (see
# detect_orientation_from_soc above). v3/v4 -> v5 upgrade resets
# accumulators to avoid mixing probe-era totals with the static-orientation
# regime.
```

- [ ] **Step 3: Replace state variables**

Locate lines 229–235 (the orientation state block, looks like):

```bash
# Orientation detection state. orientation_history_swapped is the only
# persisted bit; everything else is rebuilt from disk via load_data_used.
orientation_state="pending"           # pending|detected_normal|detected_reversed|fallback
orientation_dl_field=2                # /proc/net/dev field carrying download bytes
orientation_ul_field=10               # /proc/net/dev field carrying upload bytes
orientation_probe_attempted=false     # one probe per state-transition to pending
orientation_history_swapped=false     # persisted: v3→v4 accumulator swap already done
```

Replace the entire block with:

```bash
# Counter orientation. Set once at startup by main() via
# detect_orientation_from_soc; persisted into data_used.json for
# diagnostics but always re-derived from the SoC each startup (the SoC
# does not change at runtime).
orientation="normal"                  # normal|reversed
orientation_dl_field=2                # /proc/net/dev field carrying download bytes
orientation_ul_field=10               # /proc/net/dev field carrying upload bytes
```

- [ ] **Step 4: Manual smoke — confirm the file still parses**

```bash
bash -n scripts/usr/bin/qmanager_poller
```

Expected: no output, exit 0 (syntax OK). The unit will still be broken until Task 3 finishes; that is expected mid-plan.

- [ ] **Step 5: Commit**

```bash
git add scripts/usr/bin/qmanager_poller
git commit -m "feat(poller): bump data_used schema to v5; introduce static orientation state

Schema constant and state-variable rename only. Probe machinery removal
and load/write rewrites land in the next two commits."
```

---

### Task 3: Remove probe machinery

Deletes the two probe functions, the orchestration block inside `update_data_used`, the counter-reset re-probe trigger, and the probe-related constants. This is the bulk of the deletion.

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller`

- [ ] **Step 1: Delete the probe constants block**

Locate lines 78–87 (the entire `# --- Orientation detection (Tier 1)` block ending at `ORIENTATION_RATIO=5`). Delete the entire block. The `# --- State Variables` header on the next line (currently line 89) becomes the immediate successor.

- [ ] **Step 2: Delete `start_orientation_probe()`**

Locate the function definition starting with `start_orientation_probe() {` (around line 593) and ending with the matching `}` on the line that closes the function (around line 660 — the closing `}` immediately before `apply_orientation_result()`). Delete the entire function INCLUDING the preceding banner comment block lines 584–592 that read:

```bash
# =============================================================================
# ORIENTATION DETECTION
# =============================================================================
# Empirically determines which /proc/net/dev field carries download bytes by
# running a known-direction 5 MB Cloudflare probe in a backgrounded subshell.
# Result is written to ORIENTATION_STATE_FILE; the poll loop reads it on the
# next tick. Falls back to RM520N defaults (field 2=DL, field 10=UL) on probe
# failure. Re-probes on counter-reset events (modem reattach).
```

- [ ] **Step 3: Delete `apply_orientation_result()`**

Immediately after the deletion in Step 2, locate `apply_orientation_result() {` (was line 662) and delete the entire function up to its closing `}` (was line 704). The next surviving line should be the `# =============================================================================` banner for `PERSISTENT DATA USED COUNTER`.

- [ ] **Step 4: Remove Step 0.5 orchestration block from `update_data_used`**

Inside `update_data_used`, locate the block at lines 795–803:

```bash
    # Step 0.5: orientation orchestration. On pending state, spawn one probe
    # per attempt-cycle; pick up the result file on subsequent ticks. A
    # counter-reset event (Step 5 below) resets these to trigger a re-probe.
    if [ "$orientation_state" = "pending" ]; then
        if [ "$orientation_probe_attempted" = "false" ]; then
            start_orientation_probe
        fi
        apply_orientation_result
    fi
```

Delete it entirely. The block immediately above (the Step 1 user-reset comment block) and the Step 1 code itself stay; Step 1 now sits where Step 0.5 used to be.

- [ ] **Step 5: Remove re-probe trigger in counter-reset path**

Locate lines 866–870 inside the counter-reset detection (negative-delta branch):

```bash
        qlog_info "data_used: ${NETWORK_IFACE} counter reset detected (delta_rx=${delta_rx} delta_tx=${delta_tx}); rebasing"
        du_modem_reset_count=$((du_modem_reset_count + 1))
        # Option B retry: a reset event is the modem reattaching, which is a
        # natural moment for the IPA driver to have re-initialized. Flip
        # state to pending so the next tick spawns a fresh orientation probe.
        orientation_state="pending"
        orientation_probe_attempted=false
```

Replace with:

```bash
        qlog_info "data_used: ${NETWORK_IFACE} counter reset detected (delta_rx=${delta_rx} delta_tx=${delta_tx}); rebasing"
        du_modem_reset_count=$((du_modem_reset_count + 1))
```

(The Option-B re-probe trigger is gone — the SoC doesn't change across a modem reattach, so orientation stays fixed.)

- [ ] **Step 6: Syntax-check**

```bash
bash -n scripts/usr/bin/qmanager_poller
```

Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add scripts/usr/bin/qmanager_poller
git commit -m "refactor(poller): remove dynamic orientation probe machinery

Drops start_orientation_probe, apply_orientation_result, the Step 0.5
orchestration in update_data_used, the counter-reset re-probe trigger,
and the ORIENTATION_* constants. Static SoC mapping replaces the probe
in the load/write rewrites that follow."
```

---

### Task 4: Rewrite `write_data_used_state` for v5

Drop the `orientation_history_swapped` field; add the `orientation` field.

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller`

- [ ] **Step 1: Locate the function**

The current `write_data_used_state()` body (lines 713–744) builds the JSON via `jq`. Replace its entire body (between the function-opening `{` and the closing `}`) with the v5 form below.

- [ ] **Step 2: Replace the function body**

Replace the entire function with:

```bash
write_data_used_state() {
    mkdir -p /usrdata/qmanager 2>/dev/null
    jq -n \
        --argjson schema    "$DATA_USED_SCHEMA" \
        --argjson acc_rx    "$du_accumulated_rx" \
        --argjson acc_tx    "$du_accumulated_tx" \
        --arg     sel       "$du_selected_counter" \
        --arg     orient    "$orientation" \
        --argjson prev_i_rx "$du_prev_ipa_rx" \
        --argjson prev_i_tx "$du_prev_ipa_tx" \
        --argjson last_upd  "$du_last_update_ts" \
        --argjson last_rst  "$du_last_reset_ts" \
        --argjson modem_rst "$du_modem_reset_count" \
        '{
            schema:               $schema,
            accumulated_rx_bytes: $acc_rx,
            accumulated_tx_bytes: $acc_tx,
            selected_counter:     $sel,
            orientation:          $orient,
            prev_ipa_rx:          $prev_i_rx,
            prev_ipa_tx:          $prev_i_tx,
            last_update_ts:       $last_upd,
            last_reset_ts:        $last_rst,
            modem_reset_count:    $modem_rst
        }' > "$DATA_USED_TMP" && mv "$DATA_USED_TMP" "$DATA_USED_FILE"
}
```

- [ ] **Step 3: Syntax-check**

```bash
bash -n scripts/usr/bin/qmanager_poller
```

Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/usr/bin/qmanager_poller
git commit -m "refactor(poller): write_data_used_state emits v5 fields

Drops orientation_history_swapped; adds orientation (normal|reversed)."
```

---

### Task 5: Rewrite the load / migration branch in `update_data_used`

The first-call lazy-load block at the top of `update_data_used` (Step 0 in the inline comments) needs to:
- discard files with `schema < 3` (unchanged)
- reset accumulators on `schema == 3` or `schema == 4` (new)
- load `schema == 5` directly (new)

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller`

- [ ] **Step 1: Locate the block**

The block to replace is the entire `if [ "$du_loaded" = "false" ]; then ... fi` body, currently lines 748–793. It contains the schema decision, the jq read of historical fields, and the v3→v4 in-place upgrade.

- [ ] **Step 2: Replace with the v5 form**

Replace the block (from `if [ "$du_loaded" = "false" ]; then` down to the matching `fi` and `du_loaded=true`) with:

```bash
    # Step 0: lazy-load persisted state on the first call.
    if [ "$du_loaded" = "false" ]; then
        if [ -f "$DATA_USED_FILE" ]; then
            # Schema policy (v5):
            #   < v3  -> discard (pre-Schema-3 state is incompatible)
            #   v3/v4 -> RESET accumulators on upgrade; historic totals
            #            may have been recorded against a probe misverdict
            #            and must not be carried into the static regime
            #   = v5  -> load directly
            local _on_disk_schema
            _on_disk_schema=$(jq -r '.schema // 0' "$DATA_USED_FILE" 2>/dev/null)
            if [ "${_on_disk_schema:-0}" -lt 3 ]; then
                qlog_info "data_used: schema v${_on_disk_schema:-0} too old; resetting state"
                rm -f "$DATA_USED_FILE"
            elif [ "${_on_disk_schema:-0}" -lt 5 ]; then
                qlog_info "data_used: schema v${_on_disk_schema:-0} -> v5 migration; counters reset (orientation now static)"
                du_accumulated_rx=0
                du_accumulated_tx=0
                du_prev_ipa_rx=0
                du_prev_ipa_tx=0
                du_last_update_ts=0
                du_last_reset_ts=$(date +%s)
                du_modem_reset_count=0
                write_data_used_state
            else
                local _jv
                _jv=$(jq -r '
                    (.accumulated_rx_bytes // 0 | tostring) + " " +
                    (.accumulated_tx_bytes // 0 | tostring) + " " +
                    (.prev_ipa_rx          // 0 | tostring) + " " +
                    (.prev_ipa_tx          // 0 | tostring) + " " +
                    (.last_update_ts       // 0 | tostring) + " " +
                    (.last_reset_ts        // 0 | tostring) + " " +
                    (.modem_reset_count    // 0 | tostring)
                ' "$DATA_USED_FILE" 2>/dev/null)
                if [ -n "$_jv" ]; then
                    du_accumulated_rx=$(   printf '%s' "$_jv" | awk '{print $1}')
                    du_accumulated_tx=$(   printf '%s' "$_jv" | awk '{print $2}')
                    du_prev_ipa_rx=$(      printf '%s' "$_jv" | awk '{print $3}')
                    du_prev_ipa_tx=$(      printf '%s' "$_jv" | awk '{print $4}')
                    du_last_update_ts=$(   printf '%s' "$_jv" | awk '{print $5}')
                    du_last_reset_ts=$(    printf '%s' "$_jv" | awk '{print $6}')
                    du_modem_reset_count=$(printf '%s' "$_jv" | awk '{print $7}')
                fi
            fi
        fi
        if [ ! -f "$DATA_USED_FILE" ]; then
            mkdir -p /usrdata/qmanager 2>/dev/null
        fi
        du_loaded=true
    fi
```

- [ ] **Step 3: Syntax-check**

```bash
bash -n scripts/usr/bin/qmanager_poller
```

Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/usr/bin/qmanager_poller
git commit -m "refactor(poller): v3/v4 -> v5 migration resets accumulators

Pre-v3 still discards. v3/v4 now reset accumulated_rx/tx + baselines to
0 and stamp last_reset_ts on first load; previous probe-era totals are
not carried into the static-orientation regime. v5 loads directly."
```

---

### Task 6: Wire startup orientation detection

Call `detect_orientation_from_soc` once at poller startup and set `orientation`, `orientation_dl_field`, `orientation_ul_field`.

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller`

- [ ] **Step 1: Find the right call site**

Search for the poller's main entry / initialization. Look for the function that runs `collect_boot_data` and starts the main loop. Find a line that runs early at startup — typically right after `qlog_init` or before `collect_boot_data`. Use:

```bash
grep -n "^main\|collect_boot_data\|qlog_init" scripts/usr/bin/qmanager_poller | head -20
```

Identify the earliest sensible startup point (before the first `update_data_used` tick). Most likely a `main()` function near the bottom of the file or a top-level call sequence.

- [ ] **Step 2: Add the wiring**

Immediately AFTER the `qlog_init` call (or before `collect_boot_data` — whichever is the first non-trivial startup line you identified), insert:

```bash
# Resolve counter orientation from SoC once at startup.
orientation=$(detect_orientation_from_soc)
if [ "$orientation" = "reversed" ]; then
    orientation_dl_field=10
    orientation_ul_field=2
else
    orientation_dl_field=2
    orientation_ul_field=10
fi
qlog_info "data_used: counter orientation = ${orientation} (DL=field${orientation_dl_field}, UL=field${orientation_ul_field})"
```

- [ ] **Step 3: Syntax-check**

```bash
bash -n scripts/usr/bin/qmanager_poller
```

Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/usr/bin/qmanager_poller
git commit -m "feat(poller): wire startup orientation detection from SoC

Calls detect_orientation_from_soc once at startup and sets
orientation_dl_field / orientation_ul_field accordingly. Logs the
resolved orientation to journald for diagnostics."
```

---

### Task 7: Update the CGI cache block field name

Rename `orientation_state` → `orientation` in the JSON emitted to `/tmp/qmanager_status.json`. Frontend does not consume this field today, so this is a clean rename.

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller`

- [ ] **Step 1: Update the jq arg binding**

Locate line 1920:

```bash
        --arg     du_orient    "${orientation_state:-pending}" \
```

Replace with:

```bash
        --arg     du_orient    "${orientation:-normal}" \
```

- [ ] **Step 2: Update the JSON key**

Locate line 1993:

```bash
                orientation_state:    $du_orient
```

Replace with:

```bash
                orientation:          $du_orient
```

- [ ] **Step 3: Syntax-check**

```bash
bash -n scripts/usr/bin/qmanager_poller
```

Expected: no output, exit 0.

- [ ] **Step 4: Search for any remaining `orientation_state` references**

```bash
grep -n "orientation_state\|orientation_history_swapped\|orientation_probe" scripts/usr/bin/qmanager_poller
```

Expected: no matches. If anything turns up, delete it — it is dead code left over from Tasks 2–6.

- [ ] **Step 5: Commit**

```bash
git add scripts/usr/bin/qmanager_poller
git commit -m "refactor(poller): rename CGI orientation_state -> orientation

Field is emitted in the data_used cache block. No frontend consumer
today; rename is internal."
```

---

### Task 8: Update the test harness for v5 schema

The existing tests in `scripts/test/poller-data-used.sh` use schema `3` fixtures. They need to handle the new v5 contract (orientation field, v3/v4 reset migration). Also add a regression test for the migration behavior.

**Files:**
- Modify: `scripts/test/poller-data-used.sh`

- [ ] **Step 1: Update `run_tick` to shim new state**

Locate `run_tick` (lines 37–62). Inside the subshell block (between `set +eu` and the `update_data_used` call), find the existing variable declarations:

```bash
        NETWORK_IFACE="rmnet_ipa0"
        DATA_USED_SCHEMA=3
        DATA_USED_PROC_DEV="$proc_dev"
        DATA_USED_FILE="$state_file"
        DATA_USED_TMP="${state_file}.tmp"
        DATA_USED_RESET_FLAG="$reset_flag"
        du_loaded=false
        du_accumulated_rx=0; du_accumulated_tx=0
        du_selected_counter=""
        du_prev_ipa_rx=0; du_prev_ipa_tx=0
        du_last_update_ts=0; du_last_reset_ts=0
        du_modem_reset_count=0
```

Replace with:

```bash
        NETWORK_IFACE="rmnet_ipa0"
        DATA_USED_SCHEMA=5
        DATA_USED_PROC_DEV="$proc_dev"
        DATA_USED_FILE="$state_file"
        DATA_USED_TMP="${state_file}.tmp"
        DATA_USED_RESET_FLAG="$reset_flag"
        du_loaded=false
        du_accumulated_rx=0; du_accumulated_tx=0
        du_selected_counter=""
        du_prev_ipa_rx=0; du_prev_ipa_tx=0
        du_last_update_ts=0; du_last_reset_ts=0
        du_modem_reset_count=0
        orientation="normal"
        orientation_dl_field=2
        orientation_ul_field=10
```

- [ ] **Step 2: Update Test 1's schema assertion**

Locate the existing line (around line 90):

```bash
    [ "$sch" = "3" ] && ok "schema written as 3" || bad "schema wrong ($sch)"
```

Replace with:

```bash
    [ "$sch" = "5" ] && ok "schema written as 5" || bad "schema wrong ($sch)"
```

- [ ] **Step 3: Update Test 2's fixture schema**

Locate the existing line (around line 100):

```bash
jq -n '{schema:3, accumulated_rx_bytes:1000, accumulated_tx_bytes:500,
        selected_counter:"rmnet_ipa0", prev_ipa_rx:200000, prev_ipa_tx:80000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:0}' > "$state"
```

Replace with:

```bash
jq -n '{schema:5, accumulated_rx_bytes:1000, accumulated_tx_bytes:500,
        selected_counter:"rmnet_ipa0", orientation:"normal",
        prev_ipa_rx:200000, prev_ipa_tx:80000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:0}' > "$state"
```

- [ ] **Step 4: Update Test 3's fixture schema**

Locate the existing fixture (around line 113):

```bash
jq -n '{schema:3, accumulated_rx_bytes:9000000, accumulated_tx_bytes:3000000,
        selected_counter:"rmnet_ipa0", prev_ipa_rx:9000000, prev_ipa_tx:8000000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:2}' > "$state"
```

Replace with:

```bash
jq -n '{schema:5, accumulated_rx_bytes:9000000, accumulated_tx_bytes:3000000,
        selected_counter:"rmnet_ipa0", orientation:"normal",
        prev_ipa_rx:9000000, prev_ipa_tx:8000000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:2}' > "$state"
```

- [ ] **Step 5: Update Test 4's fixture schema**

Locate the existing fixture (around line 128):

```bash
jq -n '{schema:3, accumulated_rx_bytes:5000, accumulated_tx_bytes:3000,
        selected_counter:"rmnet_ipa0", prev_ipa_rx:200000, prev_ipa_tx:80000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:7}' > "$state"
```

Replace with:

```bash
jq -n '{schema:5, accumulated_rx_bytes:5000, accumulated_tx_bytes:3000,
        selected_counter:"rmnet_ipa0", orientation:"normal",
        prev_ipa_rx:200000, prev_ipa_tx:80000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:7}' > "$state"
```

- [ ] **Step 6: Update Test 5 (rename from "stale schema discarded" to "v2 schema discarded")**

Test 5 currently writes a v2 fixture and asserts re-baseline. Keep that. But also update the assertion:

```bash
[ "$sch" = "3" ] && ok "rewritten at schema 3" || bad "schema not migrated ($sch)"
```

Replace with:

```bash
[ "$sch" = "5" ] && ok "rewritten at schema 5" || bad "schema not migrated ($sch)"
```

- [ ] **Step 7: Update Test 6's fixture schema**

Locate the existing fixture (around line 163):

```bash
jq -n '{schema:3, accumulated_rx_bytes:4242, accumulated_tx_bytes:2121,
        selected_counter:"rmnet_ipa0", prev_ipa_rx:200000, prev_ipa_tx:80000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:0}' > "$state"
```

Replace with:

```bash
jq -n '{schema:5, accumulated_rx_bytes:4242, accumulated_tx_bytes:2121,
        selected_counter:"rmnet_ipa0", orientation:"normal",
        prev_ipa_rx:200000, prev_ipa_tx:80000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:0}' > "$state"
```

- [ ] **Step 8: Add v3/v4 reset migration regression tests**

Append these tests AFTER Test 10 (added in Task 1) and BEFORE the `# --- Summary` block:

```bash
# --- Test 11: v3 -> v5 upgrade resets accumulators --------------------
section "v3 fixture triggers reset on first load"
proc="$work/proc11"; state="$work/state11.json"
jq -n '{schema:3, accumulated_rx_bytes:123456789, accumulated_tx_bytes:987654321,
        selected_counter:"rmnet_ipa0", prev_ipa_rx:200000, prev_ipa_tx:80000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:0}' > "$state"
make_proc "$proc" 200000 80000
run_tick "$proc" "$state"
arx=$(jq -r '.accumulated_rx_bytes' "$state")
atx=$(jq -r '.accumulated_tx_bytes' "$state")
sch=$(jq -r '.schema' "$state")
lrt=$(jq -r '.last_reset_ts' "$state")
[ "$arx" = "0" ] && ok "v3 rx reset to 0"  || bad "v3 rx not reset ($arx)"
[ "$atx" = "0" ] && ok "v3 tx reset to 0"  || bad "v3 tx not reset ($atx)"
[ "$sch" = "5" ] && ok "rewritten at v5"   || bad "schema wrong ($sch)"
[ "$lrt" != "0" ] && ok "last_reset_ts stamped on v3 upgrade" || bad "last_reset_ts not set"

# --- Test 12: v4 -> v5 upgrade resets accumulators --------------------
section "v4 fixture (with orientation_state/history fields) triggers reset"
proc="$work/proc12"; state="$work/state12.json"
jq -n '{schema:4, accumulated_rx_bytes:55555555, accumulated_tx_bytes:11111111,
        selected_counter:"rmnet_ipa0", prev_ipa_rx:200000, prev_ipa_tx:80000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:3,
        orientation_state:"detected_reversed", orientation_history_swapped:true}' > "$state"
make_proc "$proc" 200000 80000
run_tick "$proc" "$state"
arx=$(jq -r '.accumulated_rx_bytes' "$state")
atx=$(jq -r '.accumulated_tx_bytes' "$state")
sch=$(jq -r '.schema' "$state")
hist=$(jq -r '.orientation_history_swapped // "absent"' "$state")
ost=$(jq -r '.orientation_state // "absent"' "$state")
ori=$(jq -r '.orientation' "$state")
[ "$arx" = "0" ] && ok "v4 rx reset to 0"  || bad "v4 rx not reset ($arx)"
[ "$atx" = "0" ] && ok "v4 tx reset to 0"  || bad "v4 tx not reset ($atx)"
[ "$sch" = "5" ] && ok "rewritten at v5"   || bad "schema wrong ($sch)"
[ "$hist" = "absent" ] && ok "orientation_history_swapped dropped" || bad "v4 field survived ($hist)"
[ "$ost" = "absent" ]  && ok "orientation_state dropped"           || bad "v4 field survived ($ost)"
[ "$ori" = "normal" ]  && ok "v5 orientation set to normal"        || bad "orientation wrong ($ori)"

# --- Test 13: v5 fixture loads directly without reset -----------------
section "v5 fixture loads and accumulates without reset"
proc="$work/proc13"; state="$work/state13.json"
jq -n '{schema:5, accumulated_rx_bytes:7777, accumulated_tx_bytes:3333,
        selected_counter:"rmnet_ipa0", orientation:"normal",
        prev_ipa_rx:200000, prev_ipa_tx:80000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:0}' > "$state"
make_proc "$proc" 201000 80100
run_tick "$proc" "$state"
arx=$(jq -r '.accumulated_rx_bytes' "$state")
atx=$(jq -r '.accumulated_tx_bytes' "$state")
[ "$arx" = "8777" ] && ok "v5 rx accrues 1000-byte delta on existing total" || bad "v5 rx wrong ($arx)"
[ "$atx" = "3433" ] && ok "v5 tx accrues 100-byte delta on existing total"  || bad "v5 tx wrong ($atx)"
```

- [ ] **Step 9: Run the full harness**

```bash
bash scripts/test/poller-data-used.sh
```

Expected: all tests (1–13) pass; the trailing line reads `13 passed, 0 failed`.

- [ ] **Step 10: Commit**

```bash
git add scripts/test/poller-data-used.sh
git commit -m "test(poller): cover schema v5 migration and orientation

Bumps fixtures to v5, asserts v3/v4 reset on upgrade, and confirms the
orientation_state / orientation_history_swapped fields are dropped."
```

---

### Task 9: Validate with busybox-portability-checker

Dispatch the `busybox-portability-checker` subagent on the modified poller. Required by the change workflow for any backend shell-script change.

**Files:**
- Validate: `scripts/usr/bin/qmanager_poller`

- [ ] **Step 1: Dispatch the validator**

Run via the Agent tool:

```
Agent(
  description: "BusyBox portability check on poller",
  subagent_type: "busybox-portability-checker",
  prompt: "Review scripts/usr/bin/qmanager_poller for RM520N-GL compatibility, focusing on the recent static-orientation changes:
- New function detect_orientation_from_soc (uses awk -F, tr, case)
- Rewritten write_data_used_state (jq -n)
- Rewritten Step 0 load block in update_data_used (jq, awk per-field extract)
- Removed: start_orientation_probe, apply_orientation_result, ORIENTATION_* constants

Specifically confirm: (1) shebang remains #!/bin/bash and arithmetic is 64-bit-safe; (2) the new awk usage is portable; (3) no BusyBox-incompatible bashisms were accidentally introduced. The file MUST end with LF line endings, no CRLF. Report any blockers."
)
```

- [ ] **Step 2: Address any findings**

If the validator reports blockers, fix them inline before continuing. Common findings to watch for: accidental CRLF line endings on Windows, `printf '%(...)T'` (not in BusyBox), unbalanced `local` declarations.

If clean: continue. If any change was needed, commit it:

```bash
git add scripts/usr/bin/qmanager_poller
git commit -m "fix(poller): address busybox-portability-checker findings"
```

---

### Task 10: Update reference docs

Rewrite the orientation-detection sections of the two reference docs and update the CLAUDE.md bullet.

**Files:**
- Modify: `docs/reference/data-usage-counter.md`
- Modify: `docs/reference/data-counter-platform-matrix.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Rewrite `docs/reference/data-usage-counter.md`**

Open `docs/reference/data-usage-counter.md`. Replace the top blockquote (line 3) and the "Schema v4" section (lines 17–37) with the v5 description below. Then delete the entire "Orientation detection" section (lines 41–67). The "Source of truth" section (lines 9–13), "Counter-reset detection" section (lines 71–73), and "Critical shebang warning" section (lines 77–84) stay.

Replace lines 3 and 17–37 with:

```markdown
> The persistent data-usage counter reads directly from the kernel's `/proc/net/dev` byte counters for the cellular interface. Schema v5 uses a **static SoC-based orientation map** (read once at startup from `/etc/quectel-project-version`) instead of the per-boot Cloudflare probe that v4 ran.

Kernel-sourced design landed in v0.1.11 (schema v3). Schema v4 added a per-boot probe; v5 replaces the probe with a static SoC-keyed table after observed probe misclassifications on RM520N-GL. See [`data-counter-platform-matrix.md`](./data-counter-platform-matrix.md) for the cross-SoC evidence behind the static map.

---

## Source of truth: /proc/net/dev

(... unchanged section ...)

---

## Schema v5

Schema v5 keeps the v3 storage model and adds an `orientation` field. **v3/v4 → v5 upgrade resets accumulators** because previous totals may have been recorded against an incorrect (probe-derived) orientation. Users see this as a one-time fresh start of the Data Used counter after upgrading to v5.

**`data_used.json` persisted fields (schema v5):**

| Field | Description |
|-------|-------------|
| `schema` | `5` — version guard; v2 and older are discarded; v3/v4 trigger an accumulator reset on upgrade |
| `accumulated_rx_bytes` | Running total of RX bytes since last reset |
| `accumulated_tx_bytes` | Running total of TX bytes since last reset |
| `selected_counter` | Kernel interface name used as source (e.g. `rmnet_ipa0`) |
| `orientation` | `normal` \| `reversed` — replaces v4's `orientation_state` |
| `last_update_ts` | Unix timestamp of the last successful counter update |
| `last_reset_ts` | Unix timestamp of the last user-triggered reset (also stamped on v3/v4 upgrade) |
| `modem_reset_count` | How many times a negative kernel delta was detected (modem reboots) |
| `prev_ipa_rx` | Last raw kernel RX value — baseline for next delta computation |
| `prev_ipa_tx` | Last raw kernel TX value — baseline for next delta computation |

**Removed in v5:** `orientation_state`, `orientation_history_swapped`, `orientation_attempts`, and the entire async probe state.

**CGI response:** the `data_used` block in `fetch_data.sh` output includes `stale: true` when the file mtime is stale and surfaces `orientation` for diagnostics.

---

## Orientation map

| SoC `Branch Name` in `/etc/quectel-project-version` | Orientation | `/proc/net/dev` DL field | UL field |
|---|---|---|---|
| `SDX6X` (SDX65 / x62 — RM520N-GL) | `normal` | 2 | 10 |
| `SDX55` (RM502Q-AE) | `reversed` | 10 | 2 |
| anything else / missing / blank | `normal` | 2 | 10 |

The mapping is resolved once at poller startup by `detect_orientation_from_soc()` and held in memory for the process lifetime. The SoC does not change at runtime; modem reboots do not re-evaluate the map.

```

- [ ] **Step 2: Update `docs/reference/data-counter-platform-matrix.md`**

Open `docs/reference/data-counter-platform-matrix.md`. Locate the "Dynamic orientation detection" section (starts at line 197 with the `## Dynamic orientation detection` heading). Replace the entire section through the end of the paragraph at line 203 with:

```markdown
## Static SoC orientation mapping

Schema v5 of the Data Used counter (see [`data-usage-counter.md`](./data-usage-counter.md)) maps the SoC's `Branch Name` from `/etc/quectel-project-version` directly to a `/proc/net/dev` field orientation:

- `SDX6X` → `normal` (field 2 = RX, field 10 = TX) — matches Quectel spec
- `SDX55` → `reversed` (field 2 = TX, field 10 = RX) — IPA fast-path attributes bytes to the swapped column
- anything else / missing → `normal` (safe default)

This replaces the per-boot Cloudflare probe shipped in v4. The probe was observed misclassifying real RM520N-GL devices under live traffic — concurrent background flows, asymmetric signaling, and IPA flush timing could push the field-delta ratio outside the 5:1 classification threshold and produce a reversed verdict on a normal device. The static map eliminates that class of error and is correct for every device empirically probed in this matrix.

If a new SoC ships and turns out to disagree with the table, update the map in `scripts/usr/bin/qmanager_poller`'s `detect_orientation_from_soc()` — there is no runtime override.
```

- [ ] **Step 3: Update the CLAUDE.md feature bullet**

Open `CLAUDE.md`. Locate the line in the Feature-Specific Notes section that reads:

```markdown
- **Data Usage Counter** (kernel `/proc/net/dev`-sourced, schema v4 with per-boot dynamic orientation detection via 5 MB probe, `modem_reset_count`, `orientation_state`) — `docs/reference/data-usage-counter.md`
```

Replace with:

```markdown
- **Data Usage Counter** (kernel `/proc/net/dev`-sourced, schema v5 with static SoC-based orientation map from `/etc/quectel-project-version`, `modem_reset_count`, `orientation`) — `docs/reference/data-usage-counter.md`
```

- [ ] **Step 4: Verify docs**

```bash
grep -n "schema v4\|orientation_state\|orientation_history_swapped\|5 MB probe\|Cloudflare probe" docs/reference/data-usage-counter.md docs/reference/data-counter-platform-matrix.md CLAUDE.md
```

Expected: only references that explicitly describe v5 in historical context ("v4 added a per-boot probe; v5 replaces..."). Any line that still endorses v4 as current is stale — fix it.

- [ ] **Step 5: Commit**

```bash
git add docs/reference/data-usage-counter.md docs/reference/data-counter-platform-matrix.md CLAUDE.md
git commit -m "docs: schema v5 — static SoC-based data counter orientation

Drops the per-boot Cloudflare probe documentation. Adds the SoC map
table to data-usage-counter and replaces the dynamic-detection section
in the platform matrix with a static-map note. CLAUDE.md feature bullet
updated."
```

---

## Self-Review

**Spec coverage check** against `docs/superpowers/specs/2026-05-24-static-soc-counter-orientation-design.md`:

- SoC-to-orientation map (SDX55 reversed, SDX6X normal, unknown normal) — Task 1
- Schema v5 fields + removed fields — Tasks 2, 4, 5
- v3/v4 → v5 reset migration — Task 5, validated by Tasks 8 (tests 11 + 12)
- Delete probe machinery (functions, constants, orchestration block, counter-reset re-probe) — Task 3
- Wire startup detection — Task 6
- CGI field rename — Task 7
- Schema bump to 5 — Task 2
- Phase 5 validator (busybox-portability-checker) — Task 9
- Phase 6 docs (data-usage-counter, platform-matrix, CLAUDE.md) — Task 10

All spec requirements have a task. No gaps.

**Placeholder scan:** none — every step shows exact code or an exact command. No TBDs.

**Type/name consistency:**
- `orientation` (the bash variable and the JSON field) is consistent across Tasks 2, 4, 5, 6, 7, 8.
- `orientation_dl_field` / `orientation_ul_field` consistent across Tasks 2, 6, harness (Task 8 Step 1).
- `detect_orientation_from_soc` referenced identically in Tasks 1, 6, 10.
- `QUECTEL_VERSION_FILE` override consistent between Task 1 (introduced) and Task 1 test cases.
- `DATA_USED_SCHEMA=5` consistent across Tasks 2 and 8 (harness shim).

No inconsistencies found.
