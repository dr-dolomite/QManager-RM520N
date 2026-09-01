#!/bin/bash
# Regression harness for the poller/ping-daemon connectivity contract.
#
# WHY THIS EXISTS
# ----------------
# Commit 8f0f8f0 replaced the Rust HTTP-probe ping daemon with a shell ICMP
# daemon (scripts/usr/bin/qmanager_ping). Its write_cache() now emits exactly
# 11 keys into /tmp/qmanager_ping.json: timestamp, mono, profile, targets,
# interval_sec, last_rtt_ms, reachable, streak_success, streak_fail,
# during_recovery, last_family. The poller (scripts/usr/bin/qmanager_poller)
# was never updated to match, so it:
#
#   D1  reads a `.connectivity` key the daemon never writes (jq default
#       "unknown"), and republishes it into /tmp/qmanager_status.json as
#       connectivity.state -- a key that is now PERMANENTLY the string
#       "unknown". Verified on live hardware.
#   D2  never forwards last_family, which the daemon DOES emit. Three UI
#       sites that read connectivity.last_family are permanently blank.
#   D3  emits six fields (limited_reason, down_reason, streak_limited,
#       fail_secs, recover_secs, intercept_secs) read from keys the daemon
#       never writes, so they are pinned at jq defaults forever.
#
# The approved fix: stop emitting `state` (drop the key), forward
# last_family, and drop the six dead fields from the emitted connectivity
# block. connectivity.status is untouched -- the poller ALREADY derives it
# correctly from reachable + packet loss + during_recovery
# (qmanager_poller:~1540-1554); the bug is only in what gets published, not
# in that derivation.
#
# HOW THIS HARNESS DRIVES THE REAL CODE
# --------------------------------------
# qmanager_poller is a ~2300-line daemon, not a library, so it can't be
# `source`d directly. Rather than hand-transcribing the ~80 shell globals
# write_cache() consumes (fragile, and a maintenance trap), this harness
# extracts the file's own top-of-file variable-initialization preamble
# (everything before the "LIBRARY LOADING" section) and sources THAT as the
# default-value shim. Those are the poller's own real startup defaults, not
# fixture guesses. It then extracts read_ping_data() and write_cache() by
# function body and runs them back to back, exactly the way poll_cycle()
# does: read_ping_data() populates the conn_* globals from a fixture
# /tmp-style ping cache + history file, then write_cache() serializes them
# into a status.json in a scratch directory. Assertions read the resulting
# connectivity object with jq.
#
# This harness is COMMITTED RED, before the fix exists (change-workflow.md,
# Phase 4a). The builder who writes the fix does not edit this file.
#
# Run: bash scripts/test/poller-connectivity-emit.sh

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
POLLER="$REPO_ROOT/scripts/usr/bin/qmanager_poller"

if ! command -v jq >/dev/null 2>&1; then
    echo "SKIP: jq not on PATH" >&2
    exit 0
fi
if [ ! -f "$POLLER" ]; then
    echo "FAIL: poller not found at $POLLER" >&2
    exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

pass_count=0
fail_count=0
ok()  { printf '  PASS  %s\n' "$1"; pass_count=$((pass_count + 1)); }
bad() { printf '  FAIL  %s\n' "$1" >&2; fail_count=$((fail_count + 1)); }
section() { printf '\n== %s ==\n' "$1"; }

# --- Extract the poller's own startup-default preamble (everything before
# the LIBRARY LOADING section) so the fixtures below inherit the daemon's
# real defaults instead of a hand-typed subset of them. ---
awk '/^# LIBRARY LOADING/{exit} {print}' "$POLLER" > "$work/preamble.sh"
if [ ! -s "$work/preamble.sh" ]; then
    echo "FAIL: could not extract the poller's variable preamble (LIBRARY LOADING marker not found)" >&2
    exit 1
fi

# Extract the two functions under test.
awk '/^read_ping_data\(\)/,/^\}/' "$POLLER" > "$work/read_ping_fn.sh"
awk '/^write_cache\(\)/,/^\}/'    "$POLLER" > "$work/write_cache_fn.sh"

if [ ! -s "$work/read_ping_fn.sh" ]; then
    echo "FAIL: read_ping_data() not found in qmanager_poller" >&2
    exit 1
fi
if [ ! -s "$work/write_cache_fn.sh" ]; then
    echo "FAIL: write_cache() not found in qmanager_poller" >&2
    exit 1
fi

section "harness self-check"
ok "preamble, read_ping_data() and write_cache() all extracted"

# run_cycle <ping_cache_json_or_empty> <history_lines_or_empty> [stale_epoch_offset]
#
# Builds a fixture ping cache + history file, runs read_ping_data() followed
# by write_cache() in one subshell (mirroring poll_cycle()'s own order), and
# prints the resulting connectivity object as compact JSON on stdout.
#
# Args:
#   $1  ping cache JSON body, or the literal string "MISSING" to omit the
#       file entirely.
#   $2  newline-separated ping history samples (numbers or the literal
#       "null"), or "" for none.
#   $3  optional: age in seconds to backdate the cache's "timestamp" field
#       by (simulates a stale/dead ping daemon). 0 or omitted = fresh.
run_cycle() {
    local ping_json="$1" history="$2" age="${3:-0}"
    local id status_file ping_cache history_raw
    id="run_$$_$RANDOM"
    status_file="$work/status_$id.json"
    ping_cache="$work/ping_$id.json"
    history_raw="$work/history_$id"

    if [ "$ping_json" != "MISSING" ]; then
        local ts
        ts=$(( $(date +%s) - age ))
        printf '%s\n' "$ping_json" | jq --argjson ts "$ts" '.timestamp = $ts' > "$ping_cache"
    fi
    if [ -n "$history" ]; then
        printf '%s\n' "$history" > "$history_raw"
    fi

    (
        set +eu
        # Source the preamble FIRST -- it declares CACHE_FILE/CACHE_TMP/
        # PING_CACHE/PING_HISTORY_RAW with the daemon's own hardcoded
        # defaults, so our fixture paths below must be assigned AFTER it
        # runs or it silently clobbers them back to /tmp/qmanager_status.json.
        . "$work/preamble.sh" 2>/dev/null

        # events.sh isn't sourced by the truncated preamble (it lives in the
        # LIBRARY LOADING section we cut). Stub the pieces read_ping_data()
        # calls on the sustained-staleness path -- the same shim
        # poller-phase-a.sh uses for this exact function.
        append_event() { :; }
        qlog_warn() { :; }
        qlog_info() { :; }
        qlog_debug() { :; }

        CACHE_TMP="${status_file}.tmp"
        CACHE_FILE="$status_file"
        PING_CACHE="$ping_cache"
        PING_HISTORY_RAW="$history_raw"
        PING_STALE_THRESHOLD=10
        PING_DAEMON_STALE_EVENT_THRESHOLD=60

        . "$work/read_ping_fn.sh"
        read_ping_data

        . "$work/write_cache_fn.sh"
        write_cache
    ) >/dev/null 2>&1

    if [ -f "$status_file" ]; then
        jq -c '.connectivity // {}' "$status_file" 2>/dev/null
    else
        echo '{}'
    fi
}

# =============================================================================
section "1. connectivity.state is gone from the emitted block (D1)"
# =============================================================================
# The daemon never writes .connectivity, so the poller's own read of it
# (defaulted to "unknown") republishes a permanently-frozen "state" key.
# The fix removes the key outright -- it must not merely go null.
conn=$(run_cycle '{"reachable":true,"last_rtt_ms":12.3,"during_recovery":false,"interval_sec":5,"targets":["1.1.1.1","::1"],"last_family":"ipv4"}' '12.3
11.9
13.0')
has_state=$(printf '%s' "$conn" | jq 'has("state")')
if [ "$has_state" = "false" ]; then
    ok "connectivity.state key is absent"
else
    bad "connectivity.state key is still present (value: $(printf '%s' "$conn" | jq -c '.state'))"
fi

# =============================================================================
section "2. connectivity.last_family is forwarded from the ping daemon (D2)"
# =============================================================================
# The daemon emits last_family in every write_cache() call; the poller's
# read_ping_data() jq extraction (qmanager_poller:~1465) never asks for it,
# so it is silently dropped on the floor every cycle.
for family in ipv4 ipv6 none; do
    if [ "$family" = "none" ]; then
        reachable=false
    else
        reachable=true
    fi
    conn=$(run_cycle "{\"reachable\":$reachable,\"last_rtt_ms\":null,\"during_recovery\":false,\"interval_sec\":5,\"targets\":[\"1.1.1.1\",\"::1\"],\"last_family\":\"$family\"}" 'null
null')
    got=$(printf '%s' "$conn" | jq -r '.last_family // "ABSENT"')
    if [ "$got" = "$family" ]; then
        ok "last_family '$family' forwarded into connectivity.last_family"
    else
        bad "last_family '$family' not forwarded (connectivity.last_family: $got)"
    fi
done

# =============================================================================
section "3. reachable + high loss -> status stays 'degraded', not 'connected' (regression guard)"
# =============================================================================
# This pins the specific regression an earlier proposed fix would have
# introduced: deriving status from .reachable alone would call a 90%-loss
# link "connected" and light a success chip with a live pulse over it. The
# poller's existing derivation (qmanager_poller:~1533-1553) already gates on
# packet loss >= 10 as well as reachable -- this guards that logic surviving
# the emit fix untouched.
history_lossy=$(printf 'null\nnull\nnull\nnull\nnull\nnull\nnull\nnull\nnull\n12.0\n')
conn=$(run_cycle '{"reachable":true,"last_rtt_ms":12.0,"during_recovery":false,"interval_sec":5,"targets":["1.1.1.1","::1"],"last_family":"ipv4"}' "$history_lossy")
status=$(printf '%s' "$conn" | jq -r '.status')
loss=$(printf '%s' "$conn" | jq -r '.packet_loss_pct')
if [ "$status" = "degraded" ]; then
    ok "reachable + ${loss}% loss -> status is 'degraded' (loss=$loss)"
else
    bad "reachable + ${loss}% loss -> status is '$status', expected 'degraded'"
fi

# =============================================================================
section "4. dead ping daemon -> status 'unknown' + internet_available null (both reset paths)"
# =============================================================================
# Guard, not a currently-broken assertion: both paths already reset
# correctly today. Kept here so a future refactor of read_ping_data()'s
# reset logic cannot regress it silently alongside the D1-D3 fix.
conn=$(run_cycle 'MISSING' '')
avail=$(printf '%s' "$conn" | jq -r '.internet_available')
status=$(printf '%s' "$conn" | jq -r '.status')
if [ "$status" = "unknown" ] && [ "$avail" = "null" ]; then
    ok "missing ping cache -> status=unknown, internet_available=null"
else
    bad "missing ping cache -> status=$status, internet_available=$avail (expected unknown/null)"
fi

conn=$(run_cycle '{"reachable":true,"last_rtt_ms":9.9,"during_recovery":false,"interval_sec":5,"targets":["1.1.1.1","::1"],"last_family":"ipv4"}' '9.9' 90)
avail=$(printf '%s' "$conn" | jq -r '.internet_available')
status=$(printf '%s' "$conn" | jq -r '.status')
if [ "$status" = "unknown" ] && [ "$avail" = "null" ]; then
    ok "stale ping cache (90s > 10s threshold) -> status=unknown, internet_available=null"
else
    bad "stale ping cache -> status=$status, internet_available=$avail (expected unknown/null)"
fi

# =============================================================================
section "5. the six retired fields are gone from the emitted connectivity block (D3)"
# =============================================================================
conn=$(run_cycle '{"reachable":true,"last_rtt_ms":12.3,"during_recovery":false,"interval_sec":5,"targets":["1.1.1.1","::1"],"last_family":"ipv4"}' '12.3')
for field in limited_reason down_reason streak_limited fail_secs recover_secs intercept_secs; do
    present=$(printf '%s' "$conn" | jq "has(\"$field\")")
    if [ "$present" = "false" ]; then
        ok "connectivity.$field is absent"
    else
        bad "connectivity.$field is still present (value: $(printf '%s' "$conn" | jq -c ".$field")) -- read from a key the daemon never writes"
    fi
done

# =============================================================================
section "6. GUARD: the ping daemon's OWN fail_secs/recover_secs/intercept_secs survive (same-named-different-thing)"
# =============================================================================
# ping_profile.json carries a same-named but UNRELATED trio: the ping
# DAEMON's runtime debounce config, consumed by qmanager_ping itself and
# written (or deliberately left alone) by ping_profile.sh's CGI. A fix that
# deletes fail_secs/recover_secs/intercept_secs from the wrong place --
# qmanager_ping's config consumption, or ping_profile.sh's write path --
# instead of (or in addition to) the poller's dead status.json read path
# would pass assertion 5 above while silently breaking live threshold
# tuning. This is checked textually: qmanager-ping-smoke.sh already drives
# the runtime behavior end to end.
PING_DAEMON="$REPO_ROOT/scripts/usr/bin/qmanager_ping"
PING_PROFILE_CGI="$REPO_ROOT/scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh"
PING_PROFILE_SEED="$REPO_ROOT/scripts/etc/qmanager/ping_profile.json"

if [ -f "$PING_DAEMON" ] && grep -q 'JSON_FAIL_SECS' "$PING_DAEMON" && grep -q 'JSON_RECOVER_SECS' "$PING_DAEMON"; then
    ok "qmanager_ping still reads fail_secs/recover_secs from its own profile config"
else
    bad "qmanager_ping no longer reads its own fail_secs/recover_secs config -- the same-named daemon config was deleted, not just the poller's dead read"
fi

if [ -f "$PING_PROFILE_CGI" ] && grep -q 'fail_secs' "$PING_PROFILE_CGI" && grep -q 'recover_secs' "$PING_PROFILE_CGI" && grep -q 'intercept_secs' "$PING_PROFILE_CGI"; then
    ok "ping_profile.sh still names fail_secs/recover_secs/intercept_secs as daemon-owned debounce fields it must not clobber"
else
    bad "ping_profile.sh no longer names the daemon's debounce fields -- check its merge did not start dropping them"
fi

if [ -f "$PING_PROFILE_SEED" ] && grep -q '"fail_secs"' "$PING_PROFILE_SEED" && grep -q '"recover_secs"' "$PING_PROFILE_SEED" && grep -q '"intercept_secs"' "$PING_PROFILE_SEED"; then
    ok "the seed ping_profile.json still carries all three daemon debounce keys"
else
    bad "the seed ping_profile.json is missing one of fail_secs/recover_secs/intercept_secs"
fi

printf '\n%d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ]
