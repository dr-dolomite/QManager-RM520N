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

# SIM-swap visibility moved from the /tmp flag to the persistent registry on
# 2026-07-27 (qmanager_poller:413, SIM_REGISTRY_FILE). read_sim_state now gates
# `detected` on a registry record for the CURRENT ICCID that has a first_seen
# and is not dismissed; the /tmp flag survives only to supply the two profile
# fields, and is read ONLY while detected is already true. A fixture that sets
# the flag alone therefore exercises the pre-2026-07-27 contract and reports
# detected=false with empty profile fields.
reg_file="$work/sim_registry.json"
boot_iccid_fixture="8901260123456789012"
cat > "$reg_file" <<JSON
{
  "$boot_iccid_fixture": {
    "first_seen": 1746400000,
    "dismissed": false
  }
}
JSON

# Counting jq shim — installs a fake `jq` ahead of the real one on PATH.
shim_dir="$work/bin"
mkdir -p "$shim_dir"
jq_real=$(command -v jq 2>/dev/null || true)
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
        SIM_REGISTRY_FILE="$reg_file"
        boot_iccid="$boot_iccid_fixture"
        # read_sim_state calls sim_db_normalize, which is NOT inside the
        # function body — so the awk extraction above cannot carry it. On a
        # device it always resolves (sim_db.sh, or the poller's own fallback
        # at qmanager_poller:402). Mirror that fallback verbatim; without it
        # the swap branch dies "command not found" and the first three fields
        # come back empty while the failover fields still look correct.
        sim_db_normalize() { printf '%s' "$1" | tr -d ' \r\n'; }
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

    # The invariant is ONE jq call per file, not a per-field storm. The bound
    # was ≤2 when read_sim_state read two files; the registry added a third
    # (2026-07-27), so the same invariant is now ≤3. Raise this only alongside
    # a genuinely new file — never to accommodate extra calls on one file.
    if [ "$jq_calls" -le 3 ]; then
        ok "read_sim_state used $jq_calls jq invocation(s) (≤3, one per file)"
    else
        bad "read_sim_state used $jq_calls jq invocations (expected ≤3, one per file)"
    fi
fi

section "parse_ca_info uses IFS field splitting (no per-line cut storm)"

jq_real=$(command -v jq 2>/dev/null || true)
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

    # Real on-device AT+QCAINFO capture from RM520N-GL: 1 LTE PCC + 1 LTE SCC.
    # Bands use spaced format ("LTE BAND 28") which the per-line parser
    # normalizes via `tr -d ' '` and the CA-count grep at parse_at.sh:507
    # matches via the substring "LTE BAND".
    sample_raw=$'+QCAINFO: "PCC",9485,75,"LTE BAND 28",1,295,-86,-9,-58,19\n+QCAINFO: "SCC",1350,75,"LTE BAND 3",1,295,-95,-6,-79,0,0,-,-\nOK'

    result=$(
        set +eu
        export PATH="$shim_dir:$PATH"
        # Provide the few globals parse_ca_info reads.
        network_type="LTE"
        # Source the library (includes _lte_rb_to_mhz, _nr_bw_to_mhz, parse_ca_info).
        . "$source_lib"
        parse_ca_info "$sample_raw"
        printf '%s|%s|%s|%s|%s|%s\n' \
            "$t2_ca_active" "$t2_ca_count" \
            "$t2_nr_ca_active" "$t2_nr_ca_count" \
            "$t2_total_bandwidth_mhz" "$t2_bandwidth_details"
        # carrier_components must contain 2 entries with the expected bands.
        printf '%s' "$t2_carrier_components" | jq -c 'map(.band)'
    )

    cut_calls=$(wc -c < "$counter" | tr -d ' ')

    summary=$(printf '%s\n' "$result" | head -1)
    bands=$(printf '%s\n' "$result" | tail -1)

    case "$summary" in
        'true|1|false|0|30|B28: 15 MHz + B3: 15 MHz')
            ok "parse_ca_info populated CA totals correctly"
            ;;
        *)
            bad "parse_ca_info CA-totals output mismatch: '$summary'"
            ;;
    esac

    case "$bands" in
        '["B28","B3"]')
            ok "parse_ca_info emitted expected band order [B28,B3]"
            ;;
        *)
            bad "parse_ca_info band order mismatch: '$bands'"
            ;;
    esac

    # Before the fix: ~10 cuts per QCAINFO line × 2 lines = 20+ forks.
    # After: 0 cuts on the per-line path. The threshold 5 leaves headroom for
    # cut invocations issued by the *test harness itself* (e.g., `cut -f1` in
    # the read_sim_state section of this file), since the shim is on PATH for
    # the duration of this section's subshell only.
    if [ "$cut_calls" -lt 5 ]; then
        ok "parse_ca_info issued $cut_calls cut invocations (<5)"
    else
        bad "parse_ca_info still issues $cut_calls cut invocations (expected <5)"
    fi
fi

section "events_initialized state persists across restart"

jq_real=$(command -v jq 2>/dev/null || true)
if [ -z "$jq_real" ]; then
    printf '  SKIP  event-state persistence (jq not available)\n'
else
    events_lib="$REPO_ROOT/scripts/usr/lib/qmanager/events.sh"
    state_file="$work/event_state.json"

    # First instance: snapshot a known state.
    # snapshot_event_state copies the *current* state vars (network_type,
    # lte_pci, t1_cfun, etc.) into prev_ev_*, then persists prev_ev_* to disk.
    # So we must set the source vars, NOT prev_ev_* — setting prev_ev_*
    # directly would just be overwritten by the snapshot copy step.
    (
        set +eu
        # Stub qlog helpers and append_event used by the lib.
        qlog_debug() { :; }
        qlog_info() { :; }
        qlog_warn() { :; }
        qlog_error() { :; }
        append_event() { :; }
        EVENT_STATE_FILE="$state_file"
        . "$events_lib"
        # Set the *current* state vars that snapshot_event_state reads.
        network_type="5G-NSA"
        lte_band="B3"
        lte_pci="135"
        nr_band="N78"
        nr_pci="500"
        nr_state="connected"
        modem_reachable="true"
        conn_internet_available="true"
        t2_ca_active="true"
        t2_ca_count="1"
        t2_nr_ca_active="false"
        t2_nr_ca_count="0"
        service_status="optimal"
        t2_carrier_components="[]"
        t1_cfun="1"
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
if [ "$elapsed" -ge 4 ] && [ "$elapsed" -le 10 ]; then
    ok "loop slept ~5s before giving up (got ${elapsed}s)"
else
    bad "loop elapsed ${elapsed}s, expected 4–10s"
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

section "_ev_settle debounce for band and PCI"

# Drive the real helper out of events.sh through synthetic observation
# sequences. Each case runs in its own subshell so the per-channel globals
# (_ev_hold_*, _ev_holdn_*, _ev_last_*, _ev_flap*) start clean.
#
# The helper returns 0 = settled onto a new value, 1 = nothing to report,
# 2 = churning. `feed` replays a sequence and prints one line per announcement,
# which is exactly what detect_events would have appended to the ring.

cat > "$work/settle_harness.sh" <<'HARNESS'
qlog_info()  { :; }
qlog_warn()  { :; }
qlog_debug() { :; }
QUALITY_CONFIG=/nonexistent
. "$REPO_ROOT/scripts/usr/lib/qmanager/events.sh"

# feed <channel> <value>...
# Prints "SETTLED <from> -> <to>" or "FLAP <n>" for each announcement.
feed() {
    ch=$1; shift
    for v in "$@"; do
        [ "$v" = "_" ] && v=""      # "_" stands in for a blank observation
        _ev_settle "$ch" "$v"; rc=$?
        if [ "$rc" -eq 0 ]; then
            printf 'SETTLED %s -> %s\n' "$_EV_SETTLED_FROM" "$_EV_SETTLED_TO"
        elif [ "$rc" -eq 2 ]; then
            printf 'FLAP %s\n' "$_EV_FLAP_N"
        fi
    done
}
HARNESS

settle_case() {
    # settle_case <description> <expected-output> <channel> <values...>
    local desc="$1" expect="$2"; shift 2
    local got
    got=$(REPO_ROOT="$REPO_ROOT" bash -c '
        . "$0"
        feed "$@"
    ' "$work/settle_harness.sh" "$@" 2>&1)
    if [ "$got" = "$expect" ]; then
        ok "$desc"
    else
        bad "$desc — expected [$expect], got [$got]"
    fi
}

# The live capture, replayed exactly: steady on B41, nine blank samples while
# service is gone, a single-sample camp on B8 during re-acquisition, then back
# to B41. The old raw-inequality code emitted one band_change here. The radio
# never left B41 in any way a user cares about, so the correct answer is none.
settle_case "outage then return to the same band is silent" \
    "" \
    lte_band B41 B41 B41 _ _ _ _ _ _ _ _ _ B8 B41 B41 B41

# A real, settled move must still be reported.
settle_case "a band that settles is announced once" \
    "SETTLED B41 -> B8" \
    lte_band B41 B41 B41 B8 B8 B8 B8 B8

# The re-acquisition ladder: intermediate rungs held 1-2 samples each are not
# announced, and the wording the caller uses ("settled on X, was Y") is why
# skipping them does not state a hop that never happened.
settle_case "transient rungs are skipped, destination announced once" \
    "SETTLED B41 -> B28" \
    lte_band B41 B41 B41 B1 B3 B28 B28 B28

# The failure mode a hold-only rule would have introduced: a radio oscillating
# faster than the settle window never settles, so it must NOT go silent.
settle_case "period-2 oscillation reports instability instead of nothing" \
    "FLAP 6" \
    lte_band A B A B A B A B A B A B

# A blank is an absent observation, not a value: it must not reset a settle
# that is already in progress.
settle_case "blanks do not reset an in-progress settle" \
    "SETTLED B41 -> B8" \
    lte_band B41 B41 B41 B8 B8 _ _ _ _ _ B8

# First value after a cold start is adopted silently — there is no previous
# value to have "changed from".
settle_case "cold start adopts the first settled value silently" \
    "" \
    lte_band B41 B41 B41 B41

# An all-blank channel (NR inactive on this SIM) never fires anything.
settle_case "an always-blank channel stays silent" \
    "" \
    nr_band _ _ _ _ _ _ _ _ _ _

# Channels are independent: PCI churn must not consume the band channel's state.
got_multi=$(REPO_ROOT="$REPO_ROOT" bash -c '
    . "$0"
    feed lte_band B41 B41 B41 B8 B8 B8
    feed lte_pci  271 271 271 305 305 305
' "$work/settle_harness.sh" 2>&1)
if [ "$got_multi" = "SETTLED B41 -> B8
SETTLED 271 -> 305" ]; then
    ok "band and PCI channels keep independent state"
else
    bad "channel independence — got [$got_multi]"
fi

section "event ring depth agrees across all producers"

# append_event trims with tail -n "$MAX_EVENTS"; five producers write the same
# file, so a disagreement silently truncates another producer's history.
ring_vals=$(grep -rhn 'MAX_EVENTS=[0-9]' \
    "$REPO_ROOT/scripts/usr/bin/qmanager_poller" \
    "$REPO_ROOT/scripts/usr/bin/qmanager_watchcat" \
    "$REPO_ROOT/scripts/usr/bin/qmanager_profile_apply" \
    "$REPO_ROOT/scripts/usr/lib/qmanager/profile_mgr.sh" \
    "$REPO_ROOT/scripts/www/cgi-bin/quecmanager/profiles/deactivate.sh" \
    | sed 's/.*MAX_EVENTS=\([0-9]*\).*/\1/' | sort -u)
ring_count=$(printf '%s\n' "$ring_vals" | grep -c .)
if [ "$ring_count" -eq 1 ]; then
    ok "all five producers agree on MAX_EVENTS=$ring_vals"
else
    bad "producers disagree on MAX_EVENTS: $(printf '%s' "$ring_vals" | tr '\n' ' ')"
fi

printf '\n%d passed, %d failed' "$pass_count" "$fail_count"
if [ "$fail" -eq 0 ]; then
    printf ', ALL PASS\n'
    exit 0
else
    printf ', FAILURES\n'
    exit 1
fi
