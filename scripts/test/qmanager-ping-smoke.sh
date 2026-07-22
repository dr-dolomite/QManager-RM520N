#!/bin/sh
# Workstation/on-device smoke test for the shell qmanager_ping ICMP daemon.
# Runs the daemon against a temp JSON config (CONFIG_FILE override) so it
# never touches the real /etc/qmanager/ping_profile.json, then validates the
# slim cache schema. Requires: jq.
#
# NOTE: the daemon hardcodes /tmp/qmanager_ping.json, /tmp/qmanager_ping_history,
# /tmp/qmanager_ping.pid, etc. This smoke runs against those production paths —
# stop the live qmanager-ping service first if it's running on this host, and
# expect /tmp/qmanager_ping.json to be overwritten by the test cycles.
# Run this smoke on a dev machine (WSL2/Linux) or on a device where the
# service is stopped. ICMP probing needs either real root/CAP_NET_RAW or a
# system where unprivileged ping works (ping_group_range) — same requirement
# the production daemon has under systemd (root-owned service).
set -eu

if ! command -v jq >/dev/null; then
    echo "FAIL: jq not found" >&2
    exit 1
fi
if ! command -v ping >/dev/null; then
    echo "FAIL: ping not found" >&2
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${PING_BIN:-$REPO_ROOT/scripts/usr/bin/qmanager_ping}"
if [ ! -x "$BIN" ]; then
    echo "FAIL: $BIN not executable" >&2
    exit 1
fi

WORK=$(mktemp -d)
DAEMON_PID=""

cleanup() {
    [ -n "$DAEMON_PID" ] && kill -9 "$DAEMON_PID" 2>/dev/null || true
    rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

# Remove any stale state from previous runs so we never read old cache data.
rm -f /tmp/qmanager_ping.json /tmp/qmanager_ping.pid /tmp/qmanager_ping_history

# ─── Test: IPv4 loopback reachable ────────────────────────────────────────────
echo "TEST: IPv4 target reachable → reachable=true, last_family=ipv4"

cat > "$WORK/ping_profile.json" <<'JSON'
{
  "profile": "sensitive",
  "interval_sec": 1,
  "fail_secs": 2,
  "recover_secs": 1,
  "history_secs": 10,
  "target_ipv4": "127.0.0.1",
  "target_ipv6": "::1"
}
JSON

CONFIG_FILE="$WORK/ping_profile.json" "$BIN" >/tmp/qping_smoke.log 2>&1 &
DAEMON_PID=$!

sleep 3

if [ ! -f /tmp/qmanager_ping.json ]; then
    echo "FAIL: /tmp/qmanager_ping.json was not created"
    exit 1
fi

REACHABLE=$(jq -r .reachable /tmp/qmanager_ping.json)
LAST_FAMILY=$(jq -r .last_family /tmp/qmanager_ping.json)
RTT_TYPE=$(jq -r '.last_rtt_ms | type' /tmp/qmanager_ping.json)
PROFILE=$(jq -r .profile /tmp/qmanager_ping.json)
MONO_TYPE=$(jq -r '.mono | type' /tmp/qmanager_ping.json)

[ "$REACHABLE" = "true" ] || { echo "FAIL: reachable=$REACHABLE expected true"; exit 1; }
[ "$LAST_FAMILY" = "ipv4" ] || { echo "FAIL: last_family=$LAST_FAMILY expected ipv4"; exit 1; }
[ "$RTT_TYPE" = "number" ] || { echo "FAIL: last_rtt_ms type=$RTT_TYPE expected number"; exit 1; }
[ "$MONO_TYPE" = "number" ] || { echo "FAIL: mono type=$MONO_TYPE expected number"; exit 1; }
[ "$PROFILE" = "sensitive" ] || { echo "FAIL: profile=$PROFILE expected sensitive"; exit 1; }
echo "PASS: IPv4 loopback reachable path"

kill "$DAEMON_PID" 2>/dev/null || true
wait "$DAEMON_PID" 2>/dev/null || true
DAEMON_PID=""

# ─── Test: IPv4 down, IPv6 loopback fallback ──────────────────────────────────
echo
echo "TEST: IPv4 unroutable → fallback to IPv6 loopback"

rm -f /tmp/qmanager_ping.json /tmp/qmanager_ping.pid /tmp/qmanager_ping_history

# 192.0.2.1 is TEST-NET-1 (RFC 5737) — reserved, never routable, always
# times out rather than getting an ICMP unreachable that could short-circuit
# faster than PROBE_TIMEOUT.
cat > "$WORK/ping_profile.json" <<'JSON'
{
  "profile": "sensitive",
  "interval_sec": 1,
  "fail_secs": 2,
  "recover_secs": 1,
  "history_secs": 10,
  "target_ipv4": "192.0.2.1",
  "target_ipv6": "::1"
}
JSON

CONFIG_FILE="$WORK/ping_profile.json" "$BIN" >>/tmp/qping_smoke.log 2>&1 &
DAEMON_PID=$!

sleep 4

if [ ! -f /tmp/qmanager_ping.json ]; then
    echo "FAIL: /tmp/qmanager_ping.json was not created in fallback test"
    exit 1
fi

LAST_FAMILY=$(jq -r .last_family /tmp/qmanager_ping.json)
IPV6_CMD_LINE=$(grep -c "IPv6 probing unavailable" /tmp/qping_smoke.log || true)

kill "$DAEMON_PID" 2>/dev/null || true
wait "$DAEMON_PID" 2>/dev/null || true
DAEMON_PID=""

if [ "$IPV6_CMD_LINE" -gt 0 ]; then
    echo "SKIP: IPv6 ping unavailable on this workstation — cannot verify v6 fallback"
else
    if [ "$LAST_FAMILY" != "ipv6" ]; then
        echo "FAIL: expected last_family=ipv6 with v4 down + v6 loopback up, got '$LAST_FAMILY'"
        exit 1
    fi
    echo "PASS: fallback to IPv6 works"
fi

# ─── Test: both families down → reachable flips false after fail_secs ────────
echo
echo "TEST: both families unreachable → reachable transitions to false"

rm -f /tmp/qmanager_ping.json /tmp/qmanager_ping.pid /tmp/qmanager_ping_history

cat > "$WORK/ping_profile.json" <<'JSON'
{
  "profile": "sensitive",
  "interval_sec": 1,
  "fail_secs": 2,
  "recover_secs": 1,
  "history_secs": 10,
  "target_ipv4": "192.0.2.1",
  "target_ipv6": "100::1"
}
JSON

CONFIG_FILE="$WORK/ping_profile.json" "$BIN" >>/tmp/qping_smoke.log 2>&1 &
DAEMON_PID=$!

# fail_secs=2 at interval_sec=1 => FAIL_THRESHOLD=2 cycles. Give it 3 probe
# cycles (PROBE_TIMEOUT=2s each) plus slack before asserting.
sleep 8

if [ ! -f /tmp/qmanager_ping.json ]; then
    echo "FAIL: /tmp/qmanager_ping.json was not created in total-failure test"
    exit 1
fi

REACHABLE=$(jq -r .reachable /tmp/qmanager_ping.json)
LAST_FAMILY=$(jq -r .last_family /tmp/qmanager_ping.json)
STREAK_FAIL=$(jq -r .streak_fail /tmp/qmanager_ping.json)

kill "$DAEMON_PID" 2>/dev/null || true
wait "$DAEMON_PID" 2>/dev/null || true
DAEMON_PID=""

[ "$REACHABLE" = "false" ] || { echo "FAIL: reachable=$REACHABLE expected false after sustained failure"; exit 1; }
[ "$LAST_FAMILY" = "none" ] || { echo "FAIL: last_family=$LAST_FAMILY expected none"; exit 1; }
[ "$STREAK_FAIL" -ge 2 ] || { echo "FAIL: streak_fail=$STREAK_FAIL expected >= 2"; exit 1; }
echo "PASS: reachable transitions to false, last_family=none"

echo
echo "All smoke checks passed."
