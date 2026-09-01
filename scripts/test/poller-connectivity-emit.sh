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
section "3b. a window too short to measure a ratio emits null loss/jitter, never 0"
# =============================================================================
# ADDED 2026-09-02. qmanager_ping truncates /tmp/qmanager_ping_history on every
# probe-winner change, so a one-sample window is a RECURRING state on a lossy
# link, not a once-per-daemon-start transient. The old awk emitted jitter 0.0
# and loss 0% from that window -- byte-identical to a measured perfect link --
# and four consumers believed it, including the 24h archive.
#
# The floor is MIN_STAT_SAMPLES (10): a window of n samples can only express
# loss in steps of 100/n percent, and 10 is where the smallest threshold any
# consumer compares against becomes representable at all.
history_short=$(printf '12.0\n')
conn=$(run_cycle '{"reachable":true,"last_rtt_ms":12.0,"during_recovery":false,"interval_sec":5,"targets":["1.1.1.1","::1"],"last_family":"ipv4"}' "$history_short")
loss=$(printf '%s' "$conn" | jq -r '.packet_loss_pct')
jit=$(printf '%s' "$conn" | jq -r '.jitter_ms')
avg=$(printf '%s' "$conn" | jq -r '.avg_latency_ms')
status=$(printf '%s' "$conn" | jq -r '.status')

if printf '%s' "$conn" | jq -e '.packet_loss_pct == null' >/dev/null; then
    ok "one-sample window -> packet_loss_pct is a real JSON null"
else
    bad "one-sample window -> packet_loss_pct is $loss, which reads as a measured perfect link"
fi
if printf '%s' "$conn" | jq -e '.jitter_ms == null' >/dev/null; then
    ok "one-sample window -> jitter_ms is a real JSON null"
else
    bad "one-sample window -> jitter_ms is $jit, which reads as a measured perfectly steady link"
fi
# The POINT statistics are still honest at one sample and must NOT be nulled
# alongside the ratios -- that would be an over-correction, not a fix.
if [ "$avg" = "12.0" ]; then
    ok "one-sample window still reports avg_latency_ms (a point statistic, valid at n=1)"
else
    bad "one-sample window nulled avg_latency_ms too (got '$avg') -- only the RATIOS lack a denominator"
fi
# Unknown loss is not evidence of degradation. The verdict this surface owns is
# binary, and reachable is true, so the status is connected -- no third state.
if [ "$status" = "connected" ]; then
    ok "null loss + reachable -> status 'connected' (no third state invented for 'unknown loss')"
else
    bad "null loss + reachable -> status '$status', expected 'connected'"
fi

# The boundary itself: exactly MIN_STAT_SAMPLES readings must produce numbers.
# Without this the fix could satisfy every assertion above by nulling the
# ratios unconditionally.
history_ten=$(printf '10.0\n12.0\n10.0\n12.0\n10.0\n12.0\n10.0\n12.0\n10.0\n12.0\n')
conn=$(run_cycle '{"reachable":true,"last_rtt_ms":12.0,"during_recovery":false,"interval_sec":5,"targets":["1.1.1.1","::1"],"last_family":"ipv4"}' "$history_ten")
if printf '%s' "$conn" | jq -e '.packet_loss_pct == 0 and .jitter_ms == 2.0' >/dev/null; then
    ok "a full 10-sample window reports real numbers again (loss 0, jitter 2.0)"
else
    bad "a 10-sample window did not report measured ratios (loss=$(printf '%s' "$conn" | jq -r '.packet_loss_pct'), jitter=$(printf '%s' "$conn" | jq -r '.jitter_ms'))"
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
    ok "stale ping cache (90s, past any derived threshold) -> status=unknown, internet_available=null"
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

if [ -f "$PING_PROFILE_CGI" ] && grep -q 'fail_secs' "$PING_PROFILE_CGI" && grep -q 'recover_secs' "$PING_PROFILE_CGI"; then
    ok "ping_profile.sh still names fail_secs/recover_secs as daemon-owned debounce fields it must not clobber"
else
    bad "ping_profile.sh no longer names the daemon's debounce fields -- check its merge did not start dropping them"
fi

# INVERTED 2026-09-02. This used to assert the OPPOSITE -- that the seed still
# carried fail_secs and recover_secs -- and the old expectation was wrong.
#
# The block's own stated purpose (see the comment above) is to prove the daemon
# did not lose its ability to HONOUR a per-field debounce override. The two
# assertions above are what actually prove that, and both still pass untouched.
# This third one confused "the daemon can read an override" with "the shipped
# config must contain one", and shipping one is the defect: resolve_profile()
# lets a per-field JSON value beat the profile table, so a seeded fail_secs
# pinned every device to 15s no matter which of the four profiles the user
# picked. The profiles differed in cadence and in nothing else.
#
# The seed must therefore NOT carry the debounce triple, and the installer must
# carry the migration that retires it from already-deployed configs.
if [ -f "$PING_PROFILE_SEED" ] &&
    ! grep -q '"fail_secs"' "$PING_PROFILE_SEED" &&
    ! grep -q '"recover_secs"' "$PING_PROFILE_SEED" &&
    ! grep -q '"history_secs"' "$PING_PROFILE_SEED"; then
    ok "the seed ping_profile.json ships no debounce override, so the profile table governs"
else
    bad "the seed ping_profile.json still carries a debounce key -- it shadows resolve_profile's table and makes all four profiles share one fail window"
fi

INSTALLER="$REPO_ROOT/scripts/install_rm520n.sh"
if [ -f "$INSTALLER" ] && grep -q 'migrate_ping_debounce_shadow' "$INSTALLER"; then
    ok "install_rm520n.sh carries migrate_ping_debounce_shadow for already-deployed configs"
else
    bad "install_rm520n.sh has no migrate_ping_debounce_shadow -- an OTA device keeps the shadowing debounce keys forever"
fi

# intercept_secs is the ONE member of that same-named trio that does NOT
# survive. It is pruned outright: no shipped code reads it, and none can under
# a binary reachable/not-reachable verdict. Section 5 above removes it from the
# poller's dead read path; these two remove it from the producer side, so a fix
# that only silences the consumer leaves nothing behind.
if [ -f "$PING_PROFILE_CGI" ] && grep -q 'intercept_secs' "$PING_PROFILE_CGI"; then
    bad "ping_profile.sh still names the retired intercept_secs"
else
    ok "ping_profile.sh no longer names intercept_secs"
fi
if [ -f "$PING_PROFILE_SEED" ] && grep -q '"intercept_secs"' "$PING_PROFILE_SEED"; then
    bad "the seed ping_profile.json still carries the retired intercept_secs"
else
    ok "the seed ping_profile.json no longer carries intercept_secs"
fi

# =============================================================================
section "7. staleness is DERIVED from the cache's interval_sec, not hardcoded"
# =============================================================================
# The chain grew from two legs to four, so the worst case a cycle can take grew
# with it. The poller's staleness cliff, however, was a bare 10 -- a number
# derived from nothing. Two consequences, both silent:
#
#   * At the quiet profile (interval_sec 10) the cycle already sat ON the cliff
#     BEFORE this change, so a perfectly healthy device could read "unknown".
#   * During the outage this feature exists to detect, an over-budget cycle
#     flips the verdict to unknown instead of disconnected -- and an unknown
#     verdict is exactly the null that section 9 below shows swallows the
#     internet_lost alert.
#
# The replacement is a threshold each consumer computes for itself:
#
#     stale_threshold = max(3 * interval_sec, 15)
#
# interval 1 -> 15 · interval 5 -> 15 · interval 10 -> 30
#
# run_cycle() deliberately still exports the legacy PING_STALE_THRESHOLD=10
# global. That is the point: the only way the interval-10 case below can read
# fresh is if read_ping_data() computes its own threshold and stops consulting
# a constant handed to it.
stale_case() {
    _label="$1"; _interval="$2"; _age="$3"; _want="$4"
    _conn=$(run_cycle "{\"reachable\":true,\"last_rtt_ms\":9.9,\"during_recovery\":false,\"interval_sec\":$_interval,\"targets\":[\"cloudflare.com\",\"google.com\",\"1.1.1.1\",\"8.8.8.8\"],\"last_target\":\"cloudflare.com\",\"last_family\":\"ipv4\"}" '9.9' "$_age")
    _status=$(printf '%s' "$_conn" | jq -r '.status')
    if [ "$_want" = "fresh" ]; then
        if [ "$_status" != "unknown" ]; then
            ok "$_label"
        else
            bad "$_label -- status went unknown (threshold is still a hardcoded constant, not max(3 * interval_sec, 15))"
        fi
    else
        if [ "$_status" = "unknown" ]; then
            ok "$_label"
        else
            bad "$_label -- status is '$_status', expected unknown"
        fi
    fi
}

stale_case "interval_sec 10, age 20s -> FRESH (threshold 30)"  10 20 fresh
stale_case "interval_sec 10, age 40s -> stale (threshold 30)"  10 40 stale
stale_case "interval_sec 1,  age 12s -> FRESH (floor of 15)"    1 12 fresh
stale_case "interval_sec 1,  age 20s -> stale (floor of 15)"    1 20 stale
stale_case "interval_sec 5,  age 12s -> FRESH (threshold 15)"   5 12 fresh
stale_case "interval_sec 5,  age 20s -> stale (threshold 15)"   5 20 stale

# The literal must be gone, not merely shadowed. A surviving constant is the
# thing a future reader copies.
if grep -qE '^PING_STALE_THRESHOLD=(10|15)[[:space:]]*(#.*)?$' "$POLLER"; then
    printf '       offending line:\n'
    grep -nE '^PING_STALE_THRESHOLD=(10|15)' "$POLLER" | sed 's/^/         /'
    bad "the poller still carries a hardcoded staleness constant"
else
    ok "no hardcoded staleness constant survives in the poller"
fi
if grep -q 'stale_threshold' "$POLLER"; then
    ok "the poller names a derived stale_threshold"
else
    bad "the poller never names stale_threshold -- nothing computes the derived value"
fi

# =============================================================================
section "8. connectivity.ping_target comes from last_target, not targets[0]"
# =============================================================================
# The chain short-circuits, so targets[0] is only the winner on a link where the
# first leg answers. On a device whose carrier blocks the first target -- the
# RM520N-GL's exact documented regression path -- reporting targets[0] names a
# host that never answered, and the latency chart beside it belongs to a
# different one.
conn=$(run_cycle '{"reachable":true,"last_rtt_ms":12.3,"during_recovery":false,"interval_sec":5,"targets":["cloudflare.com","google.com","1.1.1.1","8.8.8.8"],"last_target":"google.com","last_family":"ipv4"}' '12.3')
got=$(printf '%s' "$conn" | jq -r '.ping_target // "ABSENT"')
if [ "$got" = "google.com" ]; then
    ok "ping_target follows last_target when a later leg won"
else
    bad "ping_target = '$got', expected the winning leg 'google.com'"
fi

# Fallback: nothing has answered yet, so last_target is empty and the first
# slot is the honest thing to name.
conn=$(run_cycle '{"reachable":false,"last_rtt_ms":null,"during_recovery":false,"interval_sec":5,"targets":["cloudflare.com","google.com","1.1.1.1","8.8.8.8"],"last_target":"","last_family":"none"}' 'null
null')
got=$(printf '%s' "$conn" | jq -r '.ping_target // "ABSENT"')
if [ "$got" = "cloudflare.com" ]; then
    ok "ping_target falls back to targets[0] when last_target is empty"
else
    bad "ping_target = '$got', expected the targets[0] fallback 'cloudflare.com'"
fi

# =============================================================================
section "9. internet_lost still fires across a true -> null -> false sequence"
# =============================================================================
# events.sh:400 copies prev_ev_internet="$conn_internet_available"
# UNCONDITIONALLY, while the emit guard requires prev == "true". A single cycle
# of null in between -- which is exactly what a stale or dead ping cache
# produces -- therefore rewrites the baseline to "null", and the following
# false compares against "null" instead of "true". No event, and so no SMS, no
# email, no Discord. The adjacent prev_ev_lte_band lines already use the
# preserve-on-blank idiom for this very reason; the internet line was missed.
#
# Any change that lets the cache age past the staleness cliff turns this latent
# bug into a live one, which is why the fix ships alongside the new chain
# rather than after it.
EVENTS_SH="$REPO_ROOT/scripts/usr/lib/qmanager/events.sh"
if [ ! -f "$EVENTS_SH" ]; then
    bad "events.sh not found at $EVENTS_SH"
else
    # ev_sequence <verdict> ... -- run one cycle per argument through the two
    # real functions, in the real order poll_cycle() uses
    # (detect_data_connection_events then snapshot_event_state), and echo the
    # event names that were emitted. append_event is overridden AFTER sourcing
    # so the names land on fd 3 instead of the device event log.
    _ev_seq_n=0
    ev_sequence() {
        _ev_seq_n=$((_ev_seq_n + 1))
        (
            set +eu
            EVENT_STATE_FILE="$work/ev_state_$_ev_seq_n.json"
            EVENTS_FILE="$work/ev_events_$_ev_seq_n.json"
            QUALITY_CONFIG="$work/ev_quality.json"
            QUALITY_RELOAD_FLAG="$work/ev_quality_$_ev_seq_n.flag"
            export EVENT_STATE_FILE EVENTS_FILE QUALITY_CONFIG QUALITY_RELOAD_FLAG
            . "$EVENTS_SH" >/dev/null 2>&1

            append_event() { printf '%s\n' "$1" >&3; }
            qlog_warn()  { :; }
            qlog_info()  { :; }
            qlog_debug() { :; }
            qlog_error() { :; }

            conn_during_recovery="false"
            conn_latency="null"
            conn_avg_latency="null"
            conn_packet_loss="null"

            for _verdict in "$@"; do
                conn_internet_available="$_verdict"
                detect_data_connection_events
                snapshot_event_state >/dev/null 2>&1
            done
        ) 3>&1 1>/dev/null 2>/dev/null
    }

    # Control. This is not decoration: if the plumbing above cannot make
    # events.sh emit anything at all, every "was SWALLOWED" verdict below would
    # be a false red, and the builder would go hunting a bug that is in this
    # file instead. This case works today and must keep working.
    emitted=$(ev_sequence true false)
    if printf '%s\n' "$emitted" | grep -qx 'internet_lost'; then
        ok "CONTROL: a plain true -> false emits internet_lost (the harness plumbing works)"
    else
        bad "CONTROL: even a plain true -> false emitted nothing -- the assertions below cannot be trusted (events emitted: $(printf '%s' "$emitted" | tr '\n' ' '))"
    fi

    # Drive the two real functions in the real order poll_cycle uses:
    # detect_data_connection_events() first, then snapshot_event_state().
    #
    # Cycle 1 healthy, establishing the baseline. Cycle 2 the ping cache is
    # stale or missing, so the poller resets the verdict to null -- nothing
    # should be emitted, and nothing should be FORGOTTEN either. Cycle 3 the
    # outage is confirmed, and that is the alert the user needs.
    emitted=$(ev_sequence true null false)

    if printf '%s\n' "$emitted" | grep -qx 'internet_lost'; then
        ok "internet_lost fires across true -> null -> false"
    else
        bad "internet_lost was SWALLOWED across true -> null -> false (events emitted: $(printf '%s' "$emitted" | tr '\n' ' '))"
    fi
    if printf '%s\n' "$emitted" | grep -qx 'internet_restored'; then
        bad "internet_restored fired on a true -> null -> false sequence"
    else
        ok "no spurious internet_restored on the same sequence"
    fi

    # The mirror case: a null in the middle of an outage must not manufacture a
    # restore either, and must not lose the eventual real one.
    emitted=$(ev_sequence false null true)

    if printf '%s\n' "$emitted" | grep -qx 'internet_restored'; then
        ok "internet_restored fires across false -> null -> true"
    else
        bad "internet_restored was SWALLOWED across false -> null -> true (events emitted: $(printf '%s' "$emitted" | tr '\n' ' '))"
    fi
fi

printf '\n%d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ]
