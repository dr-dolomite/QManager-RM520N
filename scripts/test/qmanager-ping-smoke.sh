#!/usr/bin/env bash
# Behavioural harness for the four-leg qmanager_ping ICMP daemon.
#
# WHY THIS EXISTS
# ----------------
# The connectivity probe moves from a two-leg chain (target_ipv4 first,
# target_ipv6 as fallback) to a four-leg chain in a fixed probe order:
#
#     1. target_host_1   hostname, the resolver picks the address family
#     2. target_host_2   hostname, same
#     3. target_ip_1     IPv4 literal, DNS-independent
#     4. target_ip_2     IPv4 literal, DNS-independent
#
# with a short-circuit on the first success, a per-leg deadline, a fixed-rate
# loop, and a WALL-CLOCK reachable flip. Four behaviours are pinned here
# because each one is silent when it regresses:
#
#   P1  The cache contract. write_cache() emits exactly thirteen keys and
#       `targets` is exactly four elements IN PROBE ORDER. Consumers cut
#       fields out of this object positionally; a key quietly appearing or
#       vanishing is how a downstream reader starts reading the wrong thing.
#   P2  The short-circuit. A healthy link must cost ONE leg, not four. On a
#       metered bearer a chain that always runs to completion is four times the
#       probe traffic for no extra information.
#   P3  Wall-clock debounce. fail_secs is presented to the user as seconds. The
#       old code turned it into a count of cycles via ceil(secs/interval), so
#       the real time-to-declare-down drifted with however long the chain took.
#       Adding two legs made that drift worse, which is precisely why the
#       threshold had to stop being a cycle count.
#   P4  The latency history belongs to ONE host. last_target names whichever
#       leg produced last_rtt_ms; when that changes, the history file is
#       truncated so the chart draws a GAP rather than a phantom latency step,
#       and jitter is never computed across two different hosts.
#
# HOW IT TESTS
# ------------
# The daemon is run for real, against a stub `ping` placed first on PATH. The
# stub speaks the exact iputils output shape the daemon parses (the
# "PING host (addr)" first line plus an "rtt min/avg/max/mdev" summary), logs
# every invocation, and decides success per target from a fixture file. That
# buys deterministic short-circuit, target-switch and wall-clock assertions
# without any real ICMP, on a workstation as well as on either device.
#
# It also means this harness needs no CAP_NET_RAW and no reachable internet.
# What it DOES need is `timeout` and a readable /proc/uptime (the daemon's
# monotonic clock source); both are gated below and SKIP honestly when absent,
# the convention this suite already uses in auth-lockout-ladder.sh,
# events-quality-thresholds.sh and hw-profile.sh.
#
# NOTE: the daemon hardcodes /tmp/qmanager_ping.json, /tmp/qmanager_ping_history
# and /tmp/qmanager_ping.pid. This harness runs against those production paths --
# stop the live qmanager-ping service before running it on a device, and expect
# those three files to be overwritten.
#
# This harness is COMMITTED RED, before the four-leg chain exists
# (change-workflow.md, Phase 4a). The builder who writes the daemon does not
# edit this file.
#
# Run: bash scripts/test/qmanager-ping-smoke.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${PING_BIN:-$REPO_ROOT/scripts/usr/bin/qmanager_ping}"

pass_count=0
fail_count=0
ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

if ! command -v jq >/dev/null 2>&1; then
    echo "SKIP: jq not on PATH" >&2
    exit 0
fi
if [ ! -f "$BIN" ]; then
    echo "FAIL: $BIN not found" >&2
    exit 1
fi
# `timeout` wraps every leg. Its exit code differs across the two devices
# (143 on the RM520N-GL BusyBox applet, 124 on the RG501Q-EU Entware coreutils
# build), so nothing here or in the daemon may test for a specific code -- only
# for non-zero. Presence, however, is required.
if ! command -v timeout >/dev/null 2>&1; then
    echo "SKIP: timeout not on PATH -- the per-leg deadline cannot be exercised" >&2
    exit 0
fi
# The daemon derives its monotonic clock from /proc/uptime. Without it, mono
# and every wall-clock elapsed value pin to zero and section [7] would fail for
# an environmental reason rather than a real defect.
if [ ! -r /proc/uptime ]; then
    echo "SKIP: /proc/uptime unreadable -- the daemon's monotonic clock is unavailable here" >&2
    exit 0
fi

WORK=$(mktemp -d)
DAEMON_PID=""

CACHE=/tmp/qmanager_ping.json
HISTORY=/tmp/qmanager_ping_history
PIDFILE=/tmp/qmanager_ping.pid

cleanup() {
    [ -n "$DAEMON_PID" ] && kill -9 "$DAEMON_PID" 2>/dev/null
    rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

# -----------------------------------------------------------------------------
# Stub ping
# -----------------------------------------------------------------------------
# Reproduces the two lines the daemon parses:
#   PING <target> (<addr>) 56(84) bytes of data.      <- last_family comes from
#                                                        the ':' in <addr>
#   rtt min/avg/max/mdev = 12.300/12.300/12.300/0.000 ms
# Reachability comes from QM_STUB_UP, a fixture file of "target|addr" lines.
# Every invocation is appended to QM_STUB_LOG so the short-circuit assertions
# can see exactly which legs ran.
mkdir -p "$WORK/bin"
cat > "$WORK/bin/ping" <<'STUB'
#!/bin/sh
target=""
for a in "$@"; do target="$a"; done
printf '%s\n' "$target" >> "$QM_STUB_LOG"
addr=$(grep "^${target}|" "$QM_STUB_UP" 2>/dev/null | head -n1 | cut -d'|' -f2)
if [ -n "$addr" ]; then
    echo "PING $target ($addr) 56(84) bytes of data."
    echo "64 bytes from $addr: icmp_seq=1 ttl=57 time=12.3 ms"
    echo ""
    echo "--- $target ping statistics ---"
    echo "1 packets transmitted, 1 received, 0% packet loss, time 0ms"
    echo "rtt min/avg/max/mdev = 12.300/12.300/12.300/0.000 ms"
    exit 0
fi
[ "${QM_STUB_DELAY:-0}" != "0" ] && sleep "$QM_STUB_DELAY"
echo "PING $target (203.0.113.9) 56(84) bytes of data."
echo ""
echo "--- $target ping statistics ---"
echo "1 packets transmitted, 0 received, 100% packet loss, time 0ms"
exit 1
STUB
chmod +x "$WORK/bin/ping"

STUB_LOG="$WORK/ping.log"
STUB_UP="$WORK/up"
: > "$STUB_LOG"
: > "$STUB_UP"

# up_set "target|addr" ... -- declares exactly which targets answer.
up_set() {
    : > "$STUB_UP"
    for entry in "$@"; do printf '%s\n' "$entry" >> "$STUB_UP"; done
}

# write_cfg <json> -- the daemon's config file for the next run.
CFG="$WORK/ping_profile.json"
write_cfg() { printf '%s\n' "$1" > "$CFG"; }

# Which interpreter runs the daemon.
#
# The daemon opens with `. /usr/lib/qmanager/qlog.sh 2>/dev/null || { ...stubs }`.
# That fallback works on both devices, where /bin/sh is BusyBox ash and a failed
# dot-source is a plain non-zero return. It does NOT work on a Git Bash
# workstation: there /bin/sh is bash invoked as sh, which puts it in POSIX mode,
# and POSIX mode makes a failed dot-source FATAL to a non-interactive shell --
# the daemon dies on line one, before it can write anything, and every
# assertion below would fail for an environmental reason. Running it under
# plain bash keeps the same script but drops POSIX mode, so the fallback stubs
# are reached exactly as they are on the device. On a device (or anywhere
# qlog.sh really exists) the honest /bin/sh path is used instead.
if [ -r /usr/lib/qmanager/qlog.sh ]; then
    DAEMON_SH="sh"
else
    DAEMON_SH="bash"
fi

start_daemon() {
    rm -f "$CACHE" "$PIDFILE" "$HISTORY"
    : > "$STUB_LOG"
    env PATH="$WORK/bin:$PATH" \
        CONFIG_FILE="$CFG" \
        QM_STUB_LOG="$STUB_LOG" \
        QM_STUB_UP="$STUB_UP" \
        QM_STUB_DELAY="${1:-0}" \
        "$DAEMON_SH" "$BIN" >>"$WORK/daemon.log" 2>&1 &
    DAEMON_PID=$!
}

stop_daemon() {
    [ -n "$DAEMON_PID" ] || return 0
    kill "$DAEMON_PID" 2>/dev/null
    wait "$DAEMON_PID" 2>/dev/null
    DAEMON_PID=""
    rm -f "$PIDFILE"
}

# Did the stub ever probe this exact target?
probed() { grep -qxF "$1" "$STUB_LOG"; }

cache() { jq -r "$1" "$CACHE" 2>/dev/null; }

# Four distinctive fixture targets, chosen so they can never collide with the
# daemon's own compiled-in defaults -- a collision would let a daemon that
# ignores the config still satisfy an assertion.
FOUR_CFG='{
  "profile": "sensitive",
  "interval_sec": 1,
  "fail_secs": 10,
  "recover_secs": 1,
  "history_secs": 60,
  "target_host_1": "leg1.invalid",
  "target_host_2": "leg2.invalid",
  "target_ip_1": "192.0.2.11",
  "target_ip_2": "192.0.2.12"
}'

# =============================================================================
printf '\n[0] harness self-check: the stub ping speaks the iputils shape\n'
# =============================================================================
up_set "self.check|198.51.100.7"
out=$(env QM_STUB_LOG="$STUB_LOG" QM_STUB_UP="$STUB_UP" "$WORK/bin/ping" -c 1 -W 2 self.check)
if printf '%s' "$out" | grep -q 'rtt min/avg/max' && printf '%s' "$out" | grep -q 'PING self.check (198.51.100.7)'; then
    ok "stub emits both the resolved-address line and the rtt summary line"
else
    bad "stub ping output does not match the iputils shape the daemon parses"
fi

# =============================================================================
printf '\n[1] write_cache() emits EXACTLY 13 keys\n'
# =============================================================================
# timestamp mono profile targets interval_sec last_rtt_ms reachable
# streak_success streak_fail during_recovery last_family last_target
# fail_elapsed_sec
EXPECTED_KEYS='["during_recovery","fail_elapsed_sec","interval_sec","last_family","last_rtt_ms","last_target","mono","profile","reachable","streak_fail","streak_success","targets","timestamp"]'

write_cfg "$FOUR_CFG"
up_set "leg1.invalid|198.51.100.1"
start_daemon 0
sleep 3
stop_daemon

if [ ! -f "$CACHE" ]; then
    bad "the daemon never wrote $CACHE -- every assertion below is blocked"
    printf '\n---------------------------------------------\n'
    printf 'qmanager-ping-smoke: %d passed, %d failed\n\n' "$pass_count" "$((fail_count + 1))"
    exit 1
fi

nkeys=$(cache 'keys | length')
if [ "$nkeys" = "13" ]; then
    ok "cache carries 13 keys"
else
    bad "cache carries ${nkeys:-?} keys, expected 13"
fi
got_keys=$(jq -c 'keys' "$CACHE" 2>/dev/null)
if [ "$got_keys" = "$EXPECTED_KEYS" ]; then
    ok "the key set matches the 13-key producer contract exactly"
else
    printf '       got:      %s\n' "$got_keys"
    printf '       expected: %s\n' "$EXPECTED_KEYS"
    bad "the emitted key set does not match the producer contract"
fi

# =============================================================================
printf '\n[2] targets is a 4-element array in probe order\n'
# =============================================================================
want_targets='["leg1.invalid","leg2.invalid","192.0.2.11","192.0.2.12"]'
got_targets=$(jq -c '.targets' "$CACHE" 2>/dev/null)
if [ "$got_targets" = "$want_targets" ]; then
    ok "targets = host_1, host_2, ip_1, ip_2 in probe order"
else
    printf '       got:      %s\n' "$got_targets"
    printf '       expected: %s\n' "$want_targets"
    bad "targets is not the four configured slots in probe order"
fi

# =============================================================================
printf '\n[3] first success SHORT-CIRCUITS the chain (P2)\n'
# =============================================================================
# Leg 1 answers, so legs 2-4 must never be executed. This is the whole reason a
# healthy link stays a one-leg probe on a metered bearer.
if probed "leg1.invalid"; then
    ok "leg 1 was probed"
else
    bad "leg 1 (target_host_1) was never probed -- the chain is not reading the configured slots"
fi
short_ok=1
for later in "leg2.invalid" "192.0.2.11" "192.0.2.12"; do
    if probed "$later"; then
        bad "leg '$later' ran even though leg 1 already succeeded"
        short_ok=0
    fi
done
[ "$short_ok" = "1" ] && ok "no leg after the winner was executed"

# =============================================================================
printf '\n[4] healthy cycle: reachable, a numeric rtt, and fail_elapsed_sec 0\n'
# =============================================================================
for pair in "reachable:true" "last_family:ipv4" "last_target:leg1.invalid" "fail_elapsed_sec:0"; do
    key="${pair%%:*}"; want="${pair#*:}"
    got=$(cache ".$key")
    if [ "$got" = "$want" ]; then
        ok "$key = $want"
    else
        bad "$key = '$got', expected '$want'"
    fi
done
if [ "$(cache '.last_rtt_ms | type')" = "number" ]; then
    ok "last_rtt_ms is a number"
else
    bad "last_rtt_ms is not a number on a successful cycle"
fi

# =============================================================================
printf '\n[5] the winner is whichever leg answered, not always leg 1 (P4)\n'
# =============================================================================
# Both hostname legs fail and the FIRST IPv4 literal answers. The fallback pair
# is not gated on a DNS-specific failure: any failure of both hostname legs
# drops through to the literals.
write_cfg "$FOUR_CFG"
up_set "192.0.2.11|192.0.2.11"
start_daemon 0
sleep 3
stop_daemon

got=$(cache '.last_target')
if [ "$got" = "192.0.2.11" ]; then
    ok "last_target names the winning leg (target_ip_1)"
else
    bad "last_target = '$got', expected the winning leg '192.0.2.11'"
fi
if [ "$(cache '.reachable')" = "true" ]; then
    ok "a literal-leg win still reads reachable"
else
    bad "reachable is not true even though target_ip_1 answered"
fi
if probed "192.0.2.12"; then
    bad "leg 4 ran even though leg 3 already succeeded"
else
    ok "leg 4 was skipped once leg 3 won"
fi
for earlier in "leg1.invalid" "leg2.invalid"; do
    if probed "$earlier"; then
        ok "leg '$earlier' was attempted before falling through to the literals"
    else
        bad "leg '$earlier' was never attempted -- the chain skipped a hostname leg"
    fi
done

# =============================================================================
printf '\n[6] all four legs failing: last_target is empty, last_family none\n'
# =============================================================================
write_cfg "$FOUR_CFG"
up_set
start_daemon 0
sleep 4
stop_daemon

got=$(cache '.last_target')
if [ "$got" = "" ]; then
    ok "last_target is the empty string when nothing answered"
else
    bad "last_target = '$got', expected the empty string on total failure"
fi
if [ "$(cache '.last_family')" = "none" ]; then
    ok "last_family = none on total failure"
else
    bad "last_family = '$(cache '.last_family')', expected none"
fi
if [ "$(cache '.last_rtt_ms')" = "null" ]; then
    ok "last_rtt_ms is null on total failure"
else
    bad "last_rtt_ms = '$(cache '.last_rtt_ms')', expected null"
fi
all_four=1
for leg in "leg1.invalid" "leg2.invalid" "192.0.2.11" "192.0.2.12"; do
    probed "$leg" || { bad "leg '$leg' was never attempted during a total outage"; all_four=0; }
done
[ "$all_four" = "1" ] && ok "all four legs ran during a total outage"
fes=$(cache '.fail_elapsed_sec')
case "$fes" in
    ''|*[!0-9]*) bad "fail_elapsed_sec = '$fes', expected a non-negative integer" ;;
    *) ok "fail_elapsed_sec is an integer ($fes) while failing" ;;
esac

# =============================================================================
printf '\n[7] reachable flips false on WALL-CLOCK seconds, not cycle counts (P3)\n'
# =============================================================================
# interval_sec 1, fail_secs 10, and every leg burning one second: the chain
# costs about four seconds, so a fixed-rate cycle is about five.
#
#   wall-clock debounce  -> the second or third cycle already carries ten or
#                           more accumulated failing seconds, so reachable is
#                           false well before the twenty-second mark.
#   cycle-count debounce -> ceil(10/1) = ten cycles at roughly three seconds
#                           each (the old two-leg chain), so about thirty
#                           seconds. Still true at twenty-two.
#
# The two answers are far enough apart that this cannot pass by timing luck.
write_cfg "$FOUR_CFG"
up_set
start_daemon 1
sleep 22
reach=$(cache '.reachable')
fes=$(cache '.fail_elapsed_sec')
sfail=$(cache '.streak_fail')
stop_daemon

if [ "$reach" = "false" ]; then
    ok "reachable is false after 22s of total failure with fail_secs=10 (wall-clock)"
else
    bad "reachable = '$reach' after 22s with fail_secs=10 -- the flip is still counting cycles, not seconds (fail_elapsed_sec=$fes, streak_fail=$sfail)"
fi
if [ -n "$fes" ] && [ "$fes" != "null" ] && [ "$fes" -ge 10 ] 2>/dev/null; then
    ok "fail_elapsed_sec accumulated to $fes seconds"
else
    bad "fail_elapsed_sec = '$fes' after 22s of failure -- it is not accumulating monotonic seconds"
fi
# streak_fail stays a COUNT. The watchdog still reads it; only the reachable
# flip changed its unit.
if [ -n "$sfail" ] && [ "$sfail" -ge 2 ] 2>/dev/null; then
    ok "streak_fail is still a cycle count ($sfail)"
else
    bad "streak_fail = '$sfail' -- the unchanged streak contract regressed"
fi

# =============================================================================
printf '\n[8] a change of winning target TRUNCATES the history file (P4)\n'
# =============================================================================
# Latency history and jitter are only meaningful across ONE host. When the
# winner switches, the samples taken against the old host must be dropped so
# the chart draws a gap rather than a phantom latency step.
write_cfg "$FOUR_CFG"
up_set "leg1.invalid|198.51.100.1"
start_daemon 0
sleep 6
before=$(wc -l < "$HISTORY" 2>/dev/null | tr -d ' ')
# Leg 1 goes away, leg 2 takes over: the winner changes.
up_set "leg2.invalid|198.51.100.2"
sleep 3
after=$(wc -l < "$HISTORY" 2>/dev/null | tr -d ' ')
winner=$(cache '.last_target')
stop_daemon

if [ "${before:-0}" -ge 3 ] 2>/dev/null; then
    ok "history accumulated ${before} samples against the first winner"
else
    bad "history only reached ${before:-0} samples before the switch -- the switch assertion below cannot be trusted"
fi
if [ "$winner" = "leg2.invalid" ]; then
    ok "last_target followed the switch to leg 2"
else
    bad "last_target = '$winner' after the switch, expected leg2.invalid"
fi
if [ "${after:-0}" -le 5 ] 2>/dev/null && [ "${after:-0}" -lt "${before:-0}" ] 2>/dev/null; then
    ok "history was truncated at the switch (${before} -> ${after} samples)"
else
    bad "history went ${before:-0} -> ${after:-0} samples across a target switch -- the old host's samples were carried forward"
fi

# =============================================================================
printf '\n[9] an UNMIGRATED 2-key config still probes all four defaults (P1)\n'
# =============================================================================
# Belt and braces for a device that somehow misses migrate_ping_targets:
# load_config() must default every absent key INDEPENDENTLY, so the daemon
# probes correctly -- not merely without crashing. The legacy target_ipv4 is
# NOT promoted here; carrying a user's customisation across is the migration's
# job, and a daemon that did it too would make the migration untestable.
write_cfg '{"profile":"relaxed","interval_sec":1,"fail_secs":15,"recover_secs":10,"history_secs":300,"target_ipv4":"1.1.1.1","target_ipv6":"2606:4700:4700::1111"}'
up_set
start_daemon 0
sleep 4
got_targets=$(jq -c '.targets' "$CACHE" 2>/dev/null)
stop_daemon

want_defaults='["cloudflare.com","google.com","1.1.1.1","8.8.8.8"]'
if [ "$got_targets" = "$want_defaults" ]; then
    ok "an unmigrated config falls back to the four documented defaults"
else
    printf '       got:      %s\n' "$got_targets"
    printf '       expected: %s\n' "$want_defaults"
    bad "an unmigrated config does not resolve to the four defaults"
fi

# =============================================================================
printf '\n[10] the cycle budget invariant holds NUMERICALLY\n'
# =============================================================================
# n_targets * (PROBE_TIMEOUT + 1) < stale_floor  ->  4 * 3 = 12 < 15
#
# The +1 is the resolution allowance PROBE_DEADLINE adds on top of the per-ping
# wait. The floor of 15 is the staleness floor both the poller and the watchdog
# derive (max of three times interval_sec, and fifteen). If the worst-case chain
# ever exceeds it, an outage makes the cache look STALE, the verdict flips to
# unknown instead of disconnected, and the internet_lost alert is swallowed --
# which is exactly the failure this arithmetic exists to prevent.
daemon_code=$(sed -e 's/#.*$//' "$BIN")
probe_timeout=$(printf '%s\n' "$daemon_code" | grep -oE '^PROBE_TIMEOUT=[0-9]+' | head -n1 | cut -d= -f2)
probe_deadline=$(printf '%s\n' "$daemon_code" | grep -oE '^PROBE_DEADLINE=[0-9]+' | head -n1 | cut -d= -f2)
STALE_FLOOR=15
N_TARGETS=4

if [ -n "$probe_timeout" ]; then
    ok "PROBE_TIMEOUT is declared as a plain integer ($probe_timeout)"
else
    bad "PROBE_TIMEOUT is not a plain integer assignment in qmanager_ping"
fi
if [ -n "$probe_deadline" ]; then
    ok "PROBE_DEADLINE is declared as a plain integer ($probe_deadline)"
else
    bad "PROBE_DEADLINE is not declared in qmanager_ping -- the per-leg deadline has no name"
fi
if [ -n "$probe_timeout" ] && [ -n "$probe_deadline" ] && [ "$probe_deadline" -eq "$((probe_timeout + 1))" ] 2>/dev/null; then
    ok "PROBE_DEADLINE = PROBE_TIMEOUT + 1 ($probe_deadline = $probe_timeout + 1)"
else
    bad "PROBE_DEADLINE ($probe_deadline) is not PROBE_TIMEOUT + 1 ($probe_timeout + 1) -- the resolution allowance is wrong"
fi
if [ -n "$probe_timeout" ] && [ "$((N_TARGETS * (probe_timeout + 1)))" -lt "$STALE_FLOOR" ] 2>/dev/null; then
    ok "budget invariant holds: $N_TARGETS * ($probe_timeout + 1) = $((N_TARGETS * (probe_timeout + 1))) < $STALE_FLOOR"
else
    bad "budget invariant VIOLATED: $N_TARGETS * ($probe_timeout + 1) is not below the $STALE_FLOOR second staleness floor"
fi

# =============================================================================
printf '\n[11] STATIC: every leg runs under the PROBE_DEADLINE timeout wrapper\n'
# =============================================================================
# Comments are stripped first so this file's own prose cannot satisfy the
# assertion. `timeout` takes the POSITIONAL form on both devices; the -t form
# does not exist on either, and its exit code differs across them (143 vs 124),
# so the daemon must test for non-zero and never for a literal code.
if printf '%s\n' "$daemon_code" | grep -qE 'timeout[[:space:]]+"?\$\{?PROBE_DEADLINE'; then
    ok "the probe executor wraps its ping in a positional PROBE_DEADLINE timeout"
else
    bad "no positional 'timeout PROBE_DEADLINE ping' wrapper found -- a hung leg has no deadline"
fi
if printf '%s\n' "$daemon_code" | grep -qE 'timeout[[:space:]]+-t[[:space:]]'; then
    bad "the daemon uses the 'timeout -t' form, which exists on neither device"
else
    ok "no 'timeout -t' form (positional only, correct on both devices)"
fi
if printf '%s\n' "$daemon_code" | grep -qE '\b(124|143)\b'; then
    bad "the daemon tests a literal timeout exit code -- it is 143 on the RM520N-GL and 124 on the RG501Q-EU"
else
    ok "no literal timeout exit code is tested (non-zero only)"
fi

# =============================================================================
printf '\n[12] STATIC: the four config slots and two new keys are named in source\n'
# =============================================================================
for sym in target_host_1 target_host_2 target_ip_1 target_ip_2 last_target fail_elapsed_sec; do
    if printf '%s\n' "$daemon_code" | grep -q "$sym"; then
        ok "qmanager_ping names $sym"
    else
        bad "qmanager_ping never names $sym"
    fi
done
for gone in target_ipv6 intercept_secs; do
    if printf '%s\n' "$daemon_code" | grep -q "$gone"; then
        bad "qmanager_ping still references the retired $gone"
    else
        ok "qmanager_ping no longer references $gone"
    fi
done
# The cycle-count thresholds are deleted outright. Renaming rather than
# repurposing is deliberate: it breaks a stale reader loudly instead of
# silently changing what a number means. ceil_div_min1 survives, but only for
# HISTORY_SIZE.
for gone in FAIL_THRESHOLD RECOVER_THRESHOLD; do
    if printf '%s\n' "$daemon_code" | grep -q "$gone"; then
        bad "qmanager_ping still carries $gone -- the cycle-count threshold was repurposed, not deleted"
    else
        ok "$gone is deleted"
    fi
done

printf '\n---------------------------------------------\n'
printf 'qmanager-ping-smoke: %d passed, %d failed\n\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ]
