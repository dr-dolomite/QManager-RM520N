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
awk '/^detect_orientation_from_soc\(\)/,/^\}/' "$POLLER" > "$work/fn_det.sh"

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
    [ "$sch" = "5" ] && ok "schema written as 5" || bad "schema wrong ($sch)"
    [ "$sel" = "rmnet_ipa0" ] && ok "selected_counter is rmnet_ipa0" \
        || bad "selected_counter wrong ($sel)"
else
    bad "no state file written on first tick"
fi

# --- Test 2: accumulation — delta added to the running total -----------
section "second tick accumulates the kernel delta"
proc="$work/proc2"; state="$work/state2.json"
jq -n '{schema:5, accumulated_rx_bytes:1000, accumulated_tx_bytes:500,
        selected_counter:"rmnet_ipa0", orientation:"normal",
        prev_ipa_rx:200000, prev_ipa_tx:80000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:0}' > "$state"
make_proc "$proc" 205000 80200
run_tick "$proc" "$state"
arx=$(jq -r '.accumulated_rx_bytes' "$state")
atx=$(jq -r '.accumulated_tx_bytes' "$state")
[ "$arx" = "6000" ] && ok "rx total = 1000 + 5000 delta" || bad "rx total wrong ($arx)"
[ "$atx" = "700" ]  && ok "tx total = 500 + 200 delta"  || bad "tx total wrong ($atx)"

# --- Test 3: counter reset — rebase, no accumulation -------------------
section "negative delta triggers rebase, not accumulation"
proc="$work/proc3"; state="$work/state3.json"
jq -n '{schema:5, accumulated_rx_bytes:9000000, accumulated_tx_bytes:3000000,
        selected_counter:"rmnet_ipa0", orientation:"normal",
        prev_ipa_rx:9000000, prev_ipa_tx:8000000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:2}' > "$state"
make_proc "$proc" 100 50
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
jq -n '{schema:5, accumulated_rx_bytes:5000, accumulated_tx_bytes:3000,
        selected_counter:"rmnet_ipa0", orientation:"normal",
        prev_ipa_rx:200000, prev_ipa_tx:80000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:7}' > "$state"
touch "$flag"
make_proc "$proc" 200100 80050
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
[ "$sch" = "5" ] && ok "rewritten at schema 5" || bad "schema not migrated ($sch)"

# --- Test 6: missing interface — tick skipped, state untouched --------
section "missing interface skips the tick safely"
proc="$work/proc6"; state="$work/state6.json"
cat > "$proc" <<'EOF'
Inter-|   Receive                                                |  Transmit
 face |bytes
    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0
EOF
jq -n '{schema:5, accumulated_rx_bytes:4242, accumulated_tx_bytes:2121,
        selected_counter:"rmnet_ipa0", orientation:"normal",
        prev_ipa_rx:200000, prev_ipa_tx:80000,
        last_update_ts:1, last_reset_ts:0, modem_reset_count:0}' > "$state"
run_tick "$proc" "$state"
arx=$(jq -r '.accumulated_rx_bytes' "$state")
[ "$arx" = "4242" ] && ok "accumulator untouched when interface absent" || bad "accumulator changed ($arx)"

# --- Test 7: SoC detection — SDX6X returns normal ---------------------
section "detect_orientation_from_soc maps SDX6X to normal"
qv="$work/quectel_sdx6x"
cat > "$qv" <<'EOF'
Project Rev      : RM520NGLAAR03A03M4G_A0.303
Branch Name      : SDX6X
EOF
result=$(
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

# --- Summary ----------------------------------------------------------
printf '\n%d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ]
