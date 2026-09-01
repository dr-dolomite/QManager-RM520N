#!/bin/bash
# Workstation fixtures for the poller Phase A hardening patches.
# Run from the repo root:  bash scripts/test/poller-phase-a.sh
#
# Each test builds an isolated fixture under $work, sources the shell module
# under test, invokes the function, and asserts on side-effect files.
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

# --- Placeholder self-check — real fixture tests start in Task 2 ---
section "harness self-check"
if [ -d "$REPO_ROOT/scripts/usr/lib/qmanager" ]; then
    ok "qmanager library directory found"
else
    bad "qmanager library directory missing"
fi

section "service_status resets when entry conditions ambiguous"

# Source only the function under test by extracting it. The poller is a
# daemon, not a library, so we can't `source` it directly — we shim
# qlog_* helpers and define the globals the function reads.
shim="$work/svc_shim.sh"
cat > "$shim" <<'SHIM'
qlog_state_change() { :; }
qlog_info() { :; }
qlog_warn() { :; }
modem_reachable=true
t2_sim_status=ready
lte_state=connected
nr_state=inactive
lte_rsrp=
nr_rsrp=
service_status="optimal"   # stale value from previous cycle
SHIM

# Extract the determine_service_status function body.
awk '/^determine_service_status\(\)/,/^\}/' \
    "$REPO_ROOT/scripts/usr/bin/qmanager_poller" > "$work/svc_fn.sh"

# Run in a subshell so globals don't leak.
result=$(
    set +eu
    . "$shim"
    . "$work/svc_fn.sh"
    determine_service_status
    echo "$service_status"
)

# After the fix: with empty rsrp values, status must NOT remain "optimal"
# carried from the previous cycle. It should reset to a safe default.
case "$result" in
    connected) ok "service_status resolved to 'connected' (registered, no RSRP yet)" ;;
    optimal)   bad "service_status carried stale 'optimal' across cycle" ;;
    *)         bad "service_status unexpected: '$result' (expected 'connected')" ;;
esac

# NOTE: The "traffic rate uses elapsed wall time" test was removed when the
# live traffic-rate computation was deleted from qmanager_poller alongside
# the Live Traffic feature removal. Cumulative bytes are now sourced
# exclusively through update_data_used() and have their own coverage.
#
# A companion assertion that `prev_traffic_ts` was initialised and assigned in
# qmanager_poller was left behind by that removal and outlived the symbol it
# tested — `prev_traffic_ts` occurs zero times in the poller today. It failed
# unconditionally, which is what held run-harnesses.sh red on `development`
# and made the whole suite unusable as a gate. Removed 2026-08-25; the deletion
# it was guarding is documented by the paragraph above.

section "LONG_FLAG older than 5 minutes is auto-cleared"

# Build a fake LONG_FLAG with mtime 10 minutes in the past.
flag="$work/qmanager_long_running"
touch "$flag"
# Set mtime to now - 600s.
old_ts=$(($(date +%s) - 600))
# Cross-platform mtime set: GNU touch supports -d @epoch; BSD uses -t.
touch -d "@$old_ts" "$flag" 2>/dev/null || \
    touch -t "$(date -r "$old_ts" '+%Y%m%d%H%M.%S' 2>/dev/null || echo 197001010000.00)" "$flag"

# Extract the expiry block. After the fix, the poller computes the file
# age and unlinks if > 300s. Simulate that block here by sourcing it.
cat > "$work/expire_shim.sh" <<SHIM
LONG_FLAG="$flag"
LONG_FLAG_MAX_AGE=300
SHIM

# The patched code lives at the top of poll_cycle. We extract it by
# searching for the canonical comment we add: "LONG_FLAG expiry guard".
awk '/# --- LONG_FLAG expiry guard/,/# --- end LONG_FLAG expiry guard/' \
    "$REPO_ROOT/scripts/usr/bin/qmanager_poller" > "$work/expire_block.sh"

if [ ! -s "$work/expire_block.sh" ]; then
    bad "LONG_FLAG expiry guard not found in qmanager_poller"
else
    (
        set +eu
        . "$work/expire_shim.sh"
        qlog_warn() { :; }
        . "$work/expire_block.sh"
    )
    if [ -f "$flag" ]; then
        bad "stale LONG_FLAG (>300s) was not cleared"
    else
        ok "stale LONG_FLAG cleared after expiry"
    fi
fi

# Negative case: a fresh flag must NOT be removed.
fresh="$work/qmanager_long_running_fresh"
touch "$fresh"
(
    set +eu
    LONG_FLAG="$fresh"
    LONG_FLAG_MAX_AGE=300
    qlog_warn() { :; }
    . "$work/expire_block.sh" 2>/dev/null || true
)
if [ -f "$fresh" ]; then
    ok "fresh LONG_FLAG preserved"
else
    bad "fresh LONG_FLAG was wrongly cleared"
fi

section "dead ping daemon emits ping_daemon_stale event after 60s"

# Setup: create a stale ping cache (timestamp 90s in the past).
ping_cache="$work/qmanager_ping.json"
events_file="$work/qmanager_events.json"
old_ts=$(($(date +%s) - 90))
cat > "$ping_cache" <<JSON
{"timestamp":$old_ts,"reachable":true,"last_rtt_ms":12.3,"during_recovery":false,"interval_sec":5,"targets":["google.com","cloudflare.com"]}
JSON

# Stub the events.sh append_event function and required globals.
shim="$work/ping_stale_shim.sh"
cat > "$shim" <<SHIM
PING_CACHE="$ping_cache"
PING_HISTORY_RAW="$work/nope"
PING_STALE_THRESHOLD=10
PING_DAEMON_STALE_EVENT_THRESHOLD=60
EVENTS_FILE="$events_file"
MAX_EVENTS=50
qlog_warn() { :; }
qlog_info() { :; }
qlog_debug() { :; }
append_event() {
    printf '{"type":"%s","message":"%s","severity":"%s"}\n' "\$1" "\$2" "\$3" >> "$events_file"
}
# jq shim for workstations without jq.
#
# REWRITTEN 2026-09-02. The previous version was defined unconditionally and
# IGNORED THE FILTER, printing only the timestamp digits. Two things followed.
# First, a shell function beats PATH in command lookup, so it ran even here
# where a real jq is installed -- the old comment claiming "PATH resolves
# first" had it backwards. Second, its output carried no tab, and cut on a
# line with no delimiter returns the whole line, so read_ping_data's second
# field came back as the epoch, was rejected by the 1-300 plausibility clamp,
# and silently fell back to 5. The derived staleness threshold was therefore
# never exercised at all: deleting the two-field read outright would have left
# this harness green.
#
# Now: defer to the real jq whenever there is one, and otherwise emulate the
# ONE filter read_ping_data uses before it can return -- emitting a genuine
# tab-separated pair, so the cut -f2 path is real either way.
if ! command -v jq >/dev/null 2>&1; then
jq() {
    # Usage: jq -r '<filter>' <file>. Only the two-field metadata filter
    # (timestamp + interval_sec) is emulated; anything else is a hole the
    # assertions below would have to grow into.
    local file="\${@: -1}"
    awk '
        {
            line = line \$0
        }
        END {
            ts = ""; iv = ""
            if (match(line, /"timestamp":[ ]*[0-9]+/)) {
                ts = substr(line, RSTART, RLENGTH); sub(/^.*:[ ]*/, "", ts)
            }
            if (match(line, /"interval_sec":[ ]*[0-9]+/)) {
                iv = substr(line, RSTART, RLENGTH); sub(/^.*:[ ]*/, "", iv)
            }
            if (iv == "") iv = "5"
            printf "%s\t%s\n", ts, iv
        }' "\$file"
}
fi
_ping_stale_since=0
conn_internet_available="null"
conn_status=""
conn_latency=""
conn_avg_latency=""
conn_min_latency=""
conn_max_latency=""
conn_jitter=""
conn_packet_loss=0
conn_history=""
conn_history_interval=5
conn_during_recovery=""
conn_ping_target=""
_last_ping_ts=0
SHIM

# Extract read_ping_data from the poller.
awk '/^read_ping_data\(\)/,/^\}/' \
    "$REPO_ROOT/scripts/usr/bin/qmanager_poller" > "$work/read_ping_fn.sh"

# Skip the "first detection" step by pre-seeding _ping_stale_since to
# 90s ago (> 60s threshold). A single call to read_ping_data should
# then emit the event immediately.
(
    set +eu
    . "$shim"
    . "$work/read_ping_fn.sh"
    # Seed: stale since 90s ago (>60s threshold)
    _ping_stale_since=$(($(date +%s) - 90))
    read_ping_data
)

if grep -q 'ping_daemon_stale' "$events_file" 2>/dev/null; then
    ok "ping_daemon_stale event emitted after sustained staleness"
else
    bad "no ping_daemon_stale event emitted (events file: $(cat "$events_file" 2>/dev/null || echo MISSING))"
fi

# Negative: fresh stale (< 60s) must NOT emit a duplicate.
: > "$events_file"
(
    set +eu
    . "$shim"
    . "$work/read_ping_fn.sh"
    # Seed: stale only 5s ago (< 60s threshold)
    _ping_stale_since=$(($(date +%s) - 5))
    read_ping_data
)
if grep -q 'ping_daemon_stale' "$events_file" 2>/dev/null; then
    bad "ping_daemon_stale fired too early (<60s threshold)"
else
    ok "no spurious ping_daemon_stale event under threshold"
fi

section "staleness threshold is DERIVED from the cache's own interval_sec"

# ADDED 2026-09-02 to close a real coverage hole. read_ping_data computes
#     stale_threshold = max(3 * interval_sec, 15)
# from a two-field TSV read of the ping cache. Nothing tested the second
# field: the old jq stub emitted a delimiterless line, cut -f2 handed back the
# whole thing, the 1-300 clamp rejected it, and the code fell back to 5 -- so
# every case below would have looked identical and the derivation could have
# been deleted outright without turning this harness red.
#
# The observable is the warning text on the stale branch, which names the
# threshold it actually computed. Asserting on it needs nothing from the
# payload read that follows, so these cases behave the same with a real jq and
# with the emulation above.
derived_probe() {
    # $1 = interval_sec in the cache, $2 = age of the cache in seconds.
    # Echoes whatever read_ping_data logged as a warning (empty = not stale).
    local iv="$1" age="$2"
    local cache="$work/derived_${iv}_${age}.json"
    local ts=$(( $(date +%s) - age ))
    printf '{"timestamp":%s,"reachable":true,"last_rtt_ms":12.3,"during_recovery":false,"interval_sec":%s,"targets":["a","b","c","d"],"last_target":"a","profile":"relaxed","last_family":"ipv4"}\n' \
        "$ts" "$iv" > "$cache"
    (
        set +eu
        . "$shim"
        PING_CACHE="$cache"
        PING_HISTORY_RAW="$work/nope"
        qlog_warn() { printf '%s\n' "$*" >&3; }
        . "$work/read_ping_fn.sh"
        _ping_stale_since=0
        read_ping_data
    ) 3>&1 1>/dev/null 2>/dev/null
}

# interval 5 -> max(15,15) = 15. An age of 20s is over it.
warn=$(derived_probe 5 20)
if printf '%s' "$warn" | grep -q '> 15s'; then
    ok "interval_sec=5 derives a 15s staleness threshold (age 20s is stale)"
else
    bad "interval_sec=5 did not derive 15s (warning was: ${warn:-<none, so it was not judged stale at all>})"
fi

# interval 10 -> max(30,15) = 30. The SAME 20s age is now fresh. This is the
# case the hardcoded 10 got wrong, and the one a dropped second field would
# still get wrong -- it is the whole point of the derivation.
warn=$(derived_probe 10 20)
if [ -z "$warn" ]; then
    ok "interval_sec=10 derives a 30s threshold, so a 20s-old cache is NOT stale"
else
    bad "interval_sec=10 still judged a 20s-old cache stale -- the second TSV field is not reaching the derivation (warning: $warn)"
fi

# ...and the same interval DOES go stale past its own derived threshold, which
# pins the number rather than merely proving staleness got switched off.
warn=$(derived_probe 10 40)
if printf '%s' "$warn" | grep -q '> 30s'; then
    ok "interval_sec=10 goes stale past 30s (threshold named in the warning)"
else
    bad "interval_sec=10 at 40s did not report a 30s threshold (warning was: ${warn:-<none>})"
fi

# The stub itself must emit a tab. Without this guard the emulation could
# regress to a delimiterless line and quietly restore the original hole on
# every workstation that lacks jq.
if ! command -v jq >/dev/null 2>&1; then
    probe_line=$(
        set +eu
        . "$shim"
        jq -r '.' "$ping_cache"
    )
    case "$probe_line" in
        *"$(printf '\t')"*) ok "the jq emulation emits a real tab-separated pair" ;;
        *) bad "the jq emulation emitted no tab -- cut -f2 will return the whole line again" ;;
    esac
else
    ok "real jq present, so the metadata filter under test is the production one"
fi

# ---------------------------------------------------------------------------
# REMOVED 2026-08-25 — two sections deleted, not ported. They asserted that
# check_email_alert and check_sms_alert dispatch their sends in the background
# and return to the poll cycle immediately (< 2s against a mock that sleeps).
#
# Both functions no longer exist. They were replaced by a single unified
# check_alerts in alert_engine.sh — see qmanager_poller:380-381 and
# alert_engine.sh:465-466, which both record the replacement explicitly.
# The runner therefore called an undefined function, exited 127, and `set -eu`
# at the top of this file killed the harness. Because the runner's stderr was
# redirected into a temp file that is cleaned up on exit, the 127 was silent:
# this harness failed with no diagnostic, and the failure was misattributed
# for some time to the (separate, now-fixed) prev_traffic_ts assertion above.
#
# ⚠ COVERAGE GAP, deliberately accepted: nothing now tests that alert dispatch
# is non-blocking. That property is real and worth testing — a synchronous
# send would stall every poll cycle behind an SMTP or sms_tool timeout.
# Re-establish it against check_alerts when alerting is next touched.
# Tracked as F3 in the Phase A tracker.
# ---------------------------------------------------------------------------

printf '\n%d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail" -eq 0 ] || exit 1
echo "ALL PASS"
