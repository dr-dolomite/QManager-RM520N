# Data Counter — Kernel Source of Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the persistent data-usage counter accurate on every modem firmware by sourcing it from the kernel's `rmnet_ipa0` byte counters instead of the firmware-specific `AT+QGDNRCNT` counter and its fragile orientation calibration.

**Architecture:** The poller currently reads `AT+QGDNRCNT` (a 5G-NR AT counter whose TX/RX field order varies per firmware) and runs a one-shot 1 MB "orientation calibration" download to guess that order. That calibration fails or mis-fires on some firmwares, permanently swapping or under-counting the displayed data. We replace the whole AT-counter path with the kernel's `/proc/net/dev` counters for the cellular interface (`$NETWORK_IFACE`, i.e. `rmnet_ipa0`). `/proc/net/dev` is a kernel virtual file: column 2 is always `rx_bytes`, column 10 is always `tx_bytes`, on every firmware — verified present and correctly populated on all four diagnostic modems. The orientation problem ceases to exist. A schema bump (v2 → v3) forces a one-time clean reset, healing the corrupted accumulators on already-broken modems.

**Tech Stack:** Bash (poller daemon on ARMv7 vanilla Linux), POSIX sh + jq (CGI), TypeScript/React (frontend), bash test harnesses under `scripts/test/`.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `scripts/usr/bin/qmanager_poller` | Daemon: `update_data_used`, `write_data_used_state`, `calibrate_orientation`, constants, state vars, status.json emission | Modify |
| `scripts/test/poller-data-used.sh` | Workstation harness for `update_data_used` accumulation/reset/migration logic | Create |
| `scripts/www/cgi-bin/quecmanager/network/data_used.sh` | CGI: serves `.data_used` block, two zeroed-fallback payloads | Modify |
| `types/modem-status.ts` | `DataUsedBlock` TypeScript interface | Modify |
| `CLAUDE.md`, `docs/specs/realtime-traffic-counters.md`, reference docs | Documentation | Modify |

The frontend hook (`hooks/use-data-used.ts`) and component (`components/dashboard/device-metrics.tsx`) read only `accumulated_rx_bytes` / `accumulated_tx_bytes` and pass the block through — they need verification but no code change.

---

## Task 1: Test harness for `update_data_used`

**Files:**
- Create: `scripts/test/poller-data-used.sh`

The harness extracts `update_data_used` + `write_data_used_state` from the poller via `awk` (same technique as `scripts/test/poller-phase-a.sh`), shims `qlog_*`, and drives the function with a fake `/proc/net/dev` and a temp state file. It exercises the **new** kernel-sourced behaviour, so it FAILS against the current AT-counter poller and PASSES once Task 2 lands.

The new function reads an overridable `DATA_USED_PROC_DEV` (Task 2 adds the seam) so the harness can inject a fake interface table.

- [ ] **Step 1: Write the harness**

Create `scripts/test/poller-data-used.sh`:

```bash
#!/bin/bash
# Workstation fixture for the kernel-sourced data_used counter.
# Run from repo root:  bash scripts/test/poller-data-used.sh
#
# Extracts update_data_used + write_data_used_state from the poller,
# shims qlog_*, and drives them with a fake /proc/net/dev table and a
# temp state file. Asserts accumulation, counter-reset rebasing, user
# reset, schema migration, and missing-interface handling.
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
POLLER="$REPO_ROOT/scripts/usr/bin/qmanager_poller"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

pass_count=0
fail_count=0
ok()  { printf '  PASS  %s\n' "$1"; pass_count=$((pass_count + 1)); }
bad() { printf '  FAIL  %s\n' "$1" >&2; fail_count=$((fail_count + 1)); }
section() { printf '\n== %s ==\n' "$1"; }

if ! command -v jq >/dev/null 2>&1; then
    echo "SKIP: jq not on PATH" >&2
    exit 0
fi
if [ ! -f "$POLLER" ]; then
    echo "FAIL: poller not found at $POLLER" >&2
    exit 1
fi

# Extract the two functions under test.
awk '/^write_data_used_state\(\)/,/^\}/' "$POLLER" > "$work/fn_write.sh"
awk '/^update_data_used\(\)/,/^\}/'      "$POLLER" > "$work/fn_update.sh"

# run_tick — invokes update_data_used once in an isolated subshell.
# Args: <proc_dev_file> <state_file> [reset_flag_file]
run_tick() {
    local proc_dev="$1" state_file="$2" reset_flag="${3:-/nonexistent/reset/flag}"
    (
        set +eu
        qlog_init()  { :; }
        qlog_debug() { :; }
        qlog_info()  { :; }
        qlog_warn()  { :; }
        qlog_error() { :; }
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
        . "$work/fn_write.sh"
        . "$work/fn_update.sh"
        update_data_used
    )
}

# Helper: write a fake /proc/net/dev with one rmnet_ipa0 row.
# Args: <file> <rx_bytes> <tx_bytes>
make_proc() {
    cat > "$1" <<EOF
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0
rmnet_ipa0: $2 500 0 0 0 0 0 0 $3 400 0 0 0 0 0 0
EOF
}

# --- Test 1: fresh install — baseline only, no accumulation -------------
section "fresh install baselines without accumulating"
proc="$work/proc1"; state="$work/state1.json"
make_proc "$proc" 200000 80000
run_tick "$proc" "$state"
if [ -f "$state" ]; then
    arx=$(jq -r '.accumulated_rx_bytes' "$state")
    atx=$(jq -r '.accumulated_tx_bytes' "$state")
    prx=$(jq -r '.prev_ipa_rx' "$state")
    sch=$(jq -r '.schema' "$state")
    sel=$(jq -r '.selected_counter' "$state")
    [ "$arx" = "0" ] && [ "$atx" = "0" ] && ok "accumulators stay 0 on first tick" \
        || bad "accumulators not 0 (rx=$arx tx=$atx)"
    [ "$prx" = "200000" ] && ok "prev_ipa_rx baselined to current kernel value" \
        || bad "prev_ipa_rx wrong ($prx)"
    [ "$sch" = "3" ] && ok "schema written as 3" || bad "schema wrong ($sch)"
    [ "$sel" = "rmnet_ipa0" ] && ok "selected_counter is rmnet_ipa0" \
        || bad "selected_counter wrong ($sel)"
else
    bad "no state file written on first tick"
fi

# --- Test 2: accumulation — delta added to the running total -----------
section "second tick accumulates the kernel delta"
proc="$work/proc2"; state="$work/state2.json"
jq -n '{schema:3, accumulated_rx_bytes:1000, accumulated_tx_bytes:500,
        selected_counter:"rmnet_ipa0", prev_ipa_rx:200000, prev_ipa_tx:80000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:0}' > "$state"
make_proc "$proc" 205000 80200    # +5000 rx, +200 tx
run_tick "$proc" "$state"
arx=$(jq -r '.accumulated_rx_bytes' "$state")
atx=$(jq -r '.accumulated_tx_bytes' "$state")
[ "$arx" = "6000" ] && ok "rx total = 1000 + 5000 delta" || bad "rx total wrong ($arx)"
[ "$atx" = "700" ]  && ok "tx total = 500 + 200 delta"  || bad "tx total wrong ($atx)"

# --- Test 3: counter reset — rebase, no accumulation -------------------
section "negative delta triggers rebase, not accumulation"
proc="$work/proc3"; state="$work/state3.json"
jq -n '{schema:3, accumulated_rx_bytes:9000000, accumulated_tx_bytes:3000000,
        selected_counter:"rmnet_ipa0", prev_ipa_rx:9000000, prev_ipa_tx:8000000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:2}' > "$state"
make_proc "$proc" 100 50          # counter dropped — modem rebooted
run_tick "$proc" "$state"
arx=$(jq -r '.accumulated_rx_bytes' "$state")
mrc=$(jq -r '.modem_reset_count' "$state")
prx=$(jq -r '.prev_ipa_rx' "$state")
[ "$arx" = "9000000" ] && ok "accumulator unchanged on reset" || bad "accumulator changed ($arx)"
[ "$mrc" = "3" ]       && ok "modem_reset_count incremented" || bad "reset count wrong ($mrc)"
[ "$prx" = "100" ]     && ok "prev_ipa_rx rebased to post-reset value" || bad "prev not rebased ($prx)"

# --- Test 4: user reset flag — accumulators zeroed --------------------
section "user reset flag zeroes the accumulators"
proc="$work/proc4"; state="$work/state4.json"; flag="$work/reset4"
jq -n '{schema:3, accumulated_rx_bytes:5000, accumulated_tx_bytes:3000,
        selected_counter:"rmnet_ipa0", prev_ipa_rx:200000, prev_ipa_tx:80000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:7}' > "$state"
touch "$flag"
make_proc "$proc" 200100 80050    # +100 rx, +50 tx after reset
run_tick "$proc" "$state" "$flag"
arx=$(jq -r '.accumulated_rx_bytes' "$state")
mrc=$(jq -r '.modem_reset_count' "$state")
lrt=$(jq -r '.last_reset_ts' "$state")
[ "$arx" = "100" ] && ok "rx total reset then accrues post-reset delta" || bad "rx after reset wrong ($arx)"
[ "$mrc" = "0" ]   && ok "modem_reset_count zeroed by user reset" || bad "reset count not zeroed ($mrc)"
[ "$lrt" != "0" ]  && ok "last_reset_ts stamped" || bad "last_reset_ts not set"
[ ! -f "$flag" ]   && ok "reset flag consumed" || bad "reset flag not removed"

# --- Test 5: schema migration — old schema discarded ------------------
section "stale schema file is discarded and re-baselined"
proc="$work/proc5"; state="$work/state5.json"
jq -n '{schema:2, accumulated_rx_bytes:999999, accumulated_tx_bytes:888888,
        selected_counter:"qgdnrcnt", prev_qgdnrcnt_tx:1, prev_qgdnrcnt_rx:2,
        orientation:"tx,rx"}' > "$state"
make_proc "$proc" 300000 90000
run_tick "$proc" "$state"
arx=$(jq -r '.accumulated_rx_bytes' "$state")
sch=$(jq -r '.schema' "$state")
[ "$arx" = "0" ] && ok "old-schema accumulator discarded" || bad "stale accumulator survived ($arx)"
[ "$sch" = "3" ] && ok "rewritten at schema 3" || bad "schema not migrated ($sch)"

# --- Test 6: missing interface — tick skipped, state untouched --------
section "missing interface skips the tick safely"
proc="$work/proc6"; state="$work/state6.json"
cat > "$proc" <<'EOF'
Inter-|   Receive                                                |  Transmit
 face |bytes
    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0
EOF
jq -n '{schema:3, accumulated_rx_bytes:4242, accumulated_tx_bytes:2121,
        selected_counter:"rmnet_ipa0", prev_ipa_rx:200000, prev_ipa_tx:80000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:0}' > "$state"
run_tick "$proc" "$state"
arx=$(jq -r '.accumulated_rx_bytes' "$state")
[ "$arx" = "4242" ] && ok "accumulator untouched when interface absent" || bad "accumulator changed ($arx)"

# --- Summary ----------------------------------------------------------
printf '\n%d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ]
```

- [ ] **Step 2: Run the harness against the current poller — expect FAIL**

Run: `bash scripts/test/poller-data-used.sh`
Expected: FAIL — the current `update_data_used` reads `AT+QGDNRCNT` and has no `DATA_USED_PROC_DEV` seam, so accumulation assertions do not hold. This confirms the harness is red before implementation.

- [ ] **Step 3: Commit the harness**

```bash
git add scripts/test/poller-data-used.sh
git commit -m "test(poller): add kernel-sourced data_used harness (red)"
```

---

## Task 2: Rewrite the poller data-counter to use the kernel interface

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller`

This task replaces the AT-counter path entirely: constants, state variables, `write_data_used_state`, `update_data_used`, deletes `calibrate_orientation`, and updates the status.json emission. All five edits must land together — a half-converted poller references undefined variables.

- [ ] **Step 1: Replace the constants block**

In `scripts/usr/bin/qmanager_poller`, replace lines 64-80 (the `DATA_USED_DIVERGENCE_*` / `DATA_USED_*CALIBRATION*` constants and `DATA_USED_SCHEMA=2`) with:

```bash
# data_used is sourced directly from the kernel rmnet interface byte
# counters (/proc/net/dev). The kernel labels rx/tx identically on every
# modem firmware, so no AT-counter orientation calibration is needed.
# Schema 3 retires the AT-counter / orientation state from schema 2.
DATA_USED_SCHEMA=3
# Kernel network-stats virtual file. Overridable for the test harness.
: "${DATA_USED_PROC_DEV:=/proc/net/dev}"
```

Keep lines 61-63 (`DATA_USED_FILE`, `DATA_USED_TMP`, `DATA_USED_RESET_FLAG`) unchanged.

- [ ] **Step 2: Replace the state variables**

Replace lines 218-243 (the `du_loaded` … `du_orientation_attempts` block) with:

```bash
# data_used in-memory mirror — initialized from file on first call.
# Sourced from the kernel rmnet interface; no AT counter, no orientation.
du_loaded=false
du_accumulated_rx=0
du_accumulated_tx=0
du_selected_counter=""
du_prev_ipa_rx=0
du_prev_ipa_tx=0
du_last_update_ts=0
du_last_reset_ts=0
du_modem_reset_count=0
```

- [ ] **Step 3: Rewrite `write_data_used_state` and the section header**

Replace the section-header comment at lines 630-633 with:

```bash
# Tracks cumulative rx/tx bytes across modem reboots using the kernel
# rmnet interface counters from /proc/net/dev. State persists atomically
# to DATA_USED_FILE each tick.
```

Replace the entire `write_data_used_state()` function (lines 635-677) with:

```bash
write_data_used_state() {
    mkdir -p /usrdata/qmanager 2>/dev/null
    jq -n \
        --argjson schema    "$DATA_USED_SCHEMA" \
        --argjson acc_rx    "$du_accumulated_rx" \
        --argjson acc_tx    "$du_accumulated_tx" \
        --arg     sel       "$du_selected_counter" \
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
            prev_ipa_rx:          $prev_i_rx,
            prev_ipa_tx:          $prev_i_tx,
            last_update_ts:       $last_upd,
            last_reset_ts:        $last_rst,
            modem_reset_count:    $modem_rst
        }' > "$DATA_USED_TMP" && mv "$DATA_USED_TMP" "$DATA_USED_FILE"
}
```

- [ ] **Step 4: Delete `calibrate_orientation` and rewrite `update_data_used`**

Delete the entire `calibrate_orientation()` function and its header comment (lines 680-822). Replace the entire `update_data_used()` function (lines 824-1028) with:

```bash
update_data_used() {
    # Step 0: lazy-load persisted state on the first call.
    if [ "$du_loaded" = "false" ]; then
        if [ -f "$DATA_USED_FILE" ]; then
            # Schema check — anything older than the current schema is
            # discarded (heals corrupted AT-counter state from schema 2).
            local _on_disk_schema
            _on_disk_schema=$(jq -r '.schema // 0' "$DATA_USED_FILE" 2>/dev/null)
            if [ "${_on_disk_schema:-0}" -lt "$DATA_USED_SCHEMA" ]; then
                qlog_info "data_used: schema v${_on_disk_schema:-0} < v${DATA_USED_SCHEMA}; resetting state"
                rm -f "$DATA_USED_FILE"
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

    # Step 1: honor the user reset flag — zero the accumulators but keep
    # the kernel baseline so the next tick accrues only post-reset bytes.
    if [ -f "$DATA_USED_RESET_FLAG" ]; then
        du_accumulated_rx=0
        du_accumulated_tx=0
        du_last_reset_ts=$(date +%s)
        du_modem_reset_count=0
        rm -f "$DATA_USED_RESET_FLAG"
        qlog_info "data_used: user reset triggered (counters zeroed)"
    fi

    # Step 2: read the kernel cellular-interface byte counters.
    # /proc/net/dev is a kernel virtual file: after the "iface:" token,
    # field 2 is rx_bytes (download) and field 10 is tx_bytes (upload).
    # This column layout is fixed by the Linux kernel and identical on
    # every modem firmware — unlike the AT counter it replaces.
    local _dev_line ipa_rx ipa_tx
    _dev_line=$(grep "${NETWORK_IFACE}:" "$DATA_USED_PROC_DEV" 2>/dev/null)
    if [ -z "$_dev_line" ]; then
        qlog_warn "data_used: ${NETWORK_IFACE} not found in ${DATA_USED_PROC_DEV}; skipping tick"
        return 0
    fi
    ipa_rx=$(printf '%s\n' "$_dev_line" | awk '{print $2}')
    ipa_tx=$(printf '%s\n' "$_dev_line" | awk '{print $10}')

    # Numeric guard — a malformed line must not poison the accumulator.
    case "$ipa_rx" in ''|*[!0-9]*)
        qlog_warn "data_used: non-numeric rx '${ipa_rx}'; skipping tick"; return 0 ;;
    esac
    case "$ipa_tx" in ''|*[!0-9]*)
        qlog_warn "data_used: non-numeric tx '${ipa_tx}'; skipping tick"; return 0 ;;
    esac

    # Step 3: first-time baseline — cannot accumulate without a prev sample.
    if [ "$du_prev_ipa_rx" = "0" ] && [ "$du_prev_ipa_tx" = "0" ]; then
        du_prev_ipa_rx="$ipa_rx"
        du_prev_ipa_tx="$ipa_tx"
        du_selected_counter="rmnet_ipa0"
        du_last_update_ts=$(date +%s)
        write_data_used_state
        return 0
    fi

    # Step 4: delta vs the previous tick.
    local delta_rx delta_tx
    delta_rx=$((ipa_rx - du_prev_ipa_rx))
    delta_tx=$((ipa_tx - du_prev_ipa_tx))

    # Step 5: counter-reset detection. The kernel rmnet counter zeroes on
    # a modem reboot or interface re-creation, so a negative delta means
    # the baseline is stale. Rebase without accumulating — the bytes moved
    # while the modem was rebooting are not measurable.
    if [ "$delta_rx" -lt 0 ] || [ "$delta_tx" -lt 0 ]; then
        qlog_info "data_used: ${NETWORK_IFACE} counter reset detected (delta_rx=${delta_rx} delta_tx=${delta_tx}); rebasing"
        du_modem_reset_count=$((du_modem_reset_count + 1))
    else
        du_accumulated_rx=$((du_accumulated_rx + delta_rx))
        du_accumulated_tx=$((du_accumulated_tx + delta_tx))
    fi

    # Step 6: persist for the next tick.
    du_prev_ipa_rx="$ipa_rx"
    du_prev_ipa_tx="$ipa_tx"
    du_selected_counter="rmnet_ipa0"
    du_last_update_ts=$(date +%s)
    write_data_used_state
}
```

- [ ] **Step 5: Update the status.json emission**

In the status-cache `jq` invocation, replace the `du_*` argument lines (currently lines 2064-2074, `--argjson du_acc_rx` … `--argjson du_orient_att`) with:

```bash
        --argjson du_acc_rx    "${du_accumulated_rx:-0}" \
        --argjson du_acc_tx    "${du_accumulated_tx:-0}" \
        --arg     du_sel       "${du_selected_counter:-}" \
        --argjson du_last_upd  "${du_last_update_ts:-0}" \
        --argjson du_last_rst  "${du_last_reset_ts:-0}" \
        --argjson du_modem_rst "${du_modem_reset_count:-0}" \
```

Then replace the `data_used` JSON object (currently lines 2144-2156) with:

```bash
            data_used: {
                accumulated_rx_bytes: $du_acc_rx,
                accumulated_tx_bytes: $du_acc_tx,
                selected_counter:     $du_sel,
                last_update_ts:       $du_last_upd,
                last_reset_ts:        $du_last_rst,
                modem_reset_count:    $du_modem_rst
            },
```

- [ ] **Step 6: Syntax-check the poller**

Run: `bash -n scripts/usr/bin/qmanager_poller`
Expected: no output, exit 0.

- [ ] **Step 7: Verify no orphaned references remain**

Run: `grep -nE 'calibrat|orientation|qgdnrcnt|qgdcnt|divergence|du_prev_qgd|mode_transition|du_orient' scripts/usr/bin/qmanager_poller`
Expected: no matches (empty output). Any match is a missed reference — fix it before continuing.

- [ ] **Step 8: Run the harness — expect PASS**

Run: `bash scripts/test/poller-data-used.sh`
Expected: `6 ... passed, 0 failed`, exit 0.

- [ ] **Step 9: Commit**

```bash
git add scripts/usr/bin/qmanager_poller
git commit -m "feat(poller): source data_used from kernel rmnet counter, drop AT orientation calibration"
```

---

## Task 3: Update the CGI endpoint and the frontend type

**Files:**
- Modify: `scripts/www/cgi-bin/quecmanager/network/data_used.sh`
- Modify: `types/modem-status.ts`

The new `data_used` block no longer carries `divergence_count`, `mode_transition_count`, `orientation`, `orientation_calibrated`, or `orientation_attempts`. The CGI's two zeroed-fallback payloads and the TypeScript interface must match.

- [ ] **Step 1: Update the CGI "status file missing" fallback**

In `scripts/www/cgi-bin/quecmanager/network/data_used.sh`, replace the `jq -n` payload at lines 38-48 with:

```sh
    jq -n '{
        "accumulated_rx_bytes": 0,
        "accumulated_tx_bytes": 0,
        "selected_counter": "",
        "last_update_ts": 0,
        "last_reset_ts": 0,
        "modem_reset_count": 0,
        "stale": true
    }'
```

- [ ] **Step 2: Update the CGI "data_used key absent" fallback**

Replace the `jq -n` payload at lines 67-77 with:

```sh
    jq -n --argjson stale "$stale" '{
        "accumulated_rx_bytes": 0,
        "accumulated_tx_bytes": 0,
        "selected_counter": "",
        "last_update_ts": 0,
        "last_reset_ts": 0,
        "modem_reset_count": 0,
        "stale": $stale
    }'
```

- [ ] **Step 3: Syntax-check the CGI**

Run: `sh -n scripts/www/cgi-bin/quecmanager/network/data_used.sh`
Expected: no output, exit 0.

- [ ] **Step 4: Update the `DataUsedBlock` TypeScript interface**

In `types/modem-status.ts`, replace the `DataUsedBlock` doc comment and interface (lines 258-313) with:

```ts
/**
 * Persistent data-usage counter maintained by the poller across modem
 * reboots and interface flaps. Sourced from the kernel rmnet interface
 * byte counters (/proc/net/dev) — the kernel labels rx/tx identically on
 * every firmware, so no AT-counter orientation calibration is needed.
 * Served by /cgi-bin/quecmanager/network/data_used.sh
 */
export interface DataUsedBlock {
  /** Cumulative received bytes (download), persisted across reboots */
  accumulated_rx_bytes: number;
  /** Cumulative transmitted bytes (upload), persisted across reboots */
  accumulated_tx_bytes: number;
  /** Counter source — "rmnet_ipa0" since v0.1.11 (was "qgdnrcnt"). */
  selected_counter: string;
  /** Unix epoch (seconds) of the last poller write to this block */
  last_update_ts: number;
  /**
   * Unix epoch (seconds) of the last user-triggered reset.
   * 0 means never reset (fresh install).
   */
  last_reset_ts: number;
  /**
   * Times the kernel interface counter reset (modem reboot / interface
   * re-creation) since the last user reset. Each reset rebases the
   * baseline without accumulating the in-flight bytes.
   */
  modem_reset_count: number;
  /**
   * True when the poller has not updated this block recently (cache is
   * stale). CGI sets this when the on-disk file is older than expected.
   */
  stale: boolean;
}
```

- [ ] **Step 5: Verify no frontend code references removed fields**

Run: `grep -rnE 'orientation_calibrated|orientation_attempts|divergence_count|mode_transition_count|\.orientation\b' --include=*.ts --include=*.tsx . | grep -v node_modules`
Expected: no matches. If any appear, that consumer must be updated to stop using the removed field.

- [ ] **Step 6: TypeScript compile check**

Run: `bun run tsc --noEmit` (or the project's typecheck script — check `package.json` `scripts`).
Expected: no errors related to `DataUsedBlock`.

- [ ] **Step 7: Commit**

```bash
git add scripts/www/cgi-bin/quecmanager/network/data_used.sh types/modem-status.ts
git commit -m "refactor(data-used): align CGI fallbacks and DataUsedBlock type with kernel-sourced schema"
```

---

## Task 4: Cross-check and live validation

**Files:** none modified — this task only runs verification.

- [ ] **Step 1: Run the full test suite**

Run: `bash scripts/test/run-all.sh` then `bash scripts/test/run-harnesses.sh`
Expected: all harnesses pass, including `poller-data-used.sh`. CRLF / syntax checks clean.

- [ ] **Step 2: Frontend lint + typecheck**

Run the project's lint and typecheck scripts (from `package.json`).
Expected: clean, no new errors.

- [ ] **Step 3: Live probe the modem (read-only)**

Read SSH credentials from `.env` (`MODEM_IP`, `MODEM_SSH_USER`, `MODEM_SSH_PASSWORD`) — do not print the password. Connect with Posh-SSH. The modem is still running the *old* poller (this plan only changes the repo), so this step validates the *kernel counter itself*, not the new code:

  1. Snapshot `grep rmnet_ipa0 /proc/net/dev` twice, ~30 s apart.
  2. Confirm both rx (field 2) and tx (field 10) advanced monotonically and rx ≥ tx for a normal download-dominant session.
  3. Confirm the values are plain integers and the interface row is well-formed (so the new `awk '{print $2/$10}'` parse and numeric guard behave).

This is a sanity check that the data source the new poller depends on is sound on real hardware.

- [ ] **Step 4: Simulate a poller tick locally against captured data**

Using the rmnet line captured in Step 3, write it into a fake proc file and run the `run_tick` path from the harness once with realistic numbers. Confirm `accumulated_*` and `prev_ipa_*` update as expected. (Optional if Step 1 already passed — it covers the same logic with synthetic data.)

- [ ] **Step 5: Record validation results**

Summarize: harness pass/fail counts, typecheck result, live-probe rx/tx deltas. No commit.

---

## Task 5: Documentation and final commit

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/specs/realtime-traffic-counters.md`
- Modify: any reference doc describing the data counter (search first)

- [ ] **Step 1: Find all docs describing the data counter**

Run: `grep -rlnE 'QGDNRCNT|orientation calibration|data_used|Data Usage Counter' docs CLAUDE.md`
List every file. Each one that describes the AT-counter / orientation-calibration design must be updated.

- [ ] **Step 2: Update `CLAUDE.md`**

Locate the data-usage counter section (search `Data Usage Counter` / `QGDNRCNT`). Replace the description of the AT-counter + orientation-calibration design with the kernel-sourced design:

- data_used is sourced from `/proc/net/dev` `rmnet_ipa0` (kernel counters: field 2 = rx_bytes, field 10 = tx_bytes), not `AT+QGDNRCNT`.
- No orientation calibration — the kernel labels rx/tx identically on every firmware.
- Schema v3 (v2 → v3 migration discards the old AT-counter state, healing modems whose orientation calibration mis-fired).
- Counter-reset detection: a negative kernel delta means a modem reboot; the poller rebases without accumulating, and increments `modem_reset_count`.
- Keep the existing note that the poller shebang must remain `#!/bin/bash` for 64-bit arithmetic.
- Remove the now-obsolete claims about `du_orientation`, the 1 MB calibration download, `data_calibration_failed` events, and `divergence_count`.

- [ ] **Step 3: Update `docs/specs/realtime-traffic-counters.md`**

Update any section describing the `data_used` block schema and its AT-counter origin to reflect the kernel-sourced design and the v3 schema. Remove references to `orientation`, `divergence_count`, `mode_transition_count`.

- [ ] **Step 4: Update any other reference docs found in Step 1**

Apply the same correction to each remaining doc.

- [ ] **Step 5: Final commit**

```bash
git add CLAUDE.md docs
git commit -m "docs: describe kernel-sourced data_used counter (v0.1.11)"
```

---

## Self-Review Notes

- **Spec coverage:** counter strategy (kernel source of truth) → Tasks 1-2; regression patching (CGI, type, status emission) → Tasks 2-3; cross-check & validation → Task 4; docs + commit → Task 5. UI health indicators were explicitly out of scope (user chose backend-only).
- **Type consistency:** the persisted JSON keys (`schema`, `accumulated_rx_bytes`, `accumulated_tx_bytes`, `selected_counter`, `prev_ipa_rx`, `prev_ipa_tx`, `last_update_ts`, `last_reset_ts`, `modem_reset_count`) are identical across `write_data_used_state`, the harness fixtures, the status.json `data_used` block, the CGI fallbacks, and `DataUsedBlock` (minus the persistence-only `prev_ipa_*` and `schema`, plus the CGI-only `stale`).
- **Healing:** the schema v2 → v3 bump means every already-deployed modem (including the broken modems 1 and 3) discards its corrupted accumulator on first run of the new poller and re-baselines cleanly from the kernel counter.
