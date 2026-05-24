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

# Also assert the patched code is in place — both the init and the update
# assignment must exist, not just the bare token (a comment would falsely match).
if grep -qE '^prev_traffic_ts=0$' "$REPO_ROOT/scripts/usr/bin/qmanager_poller" && \
   grep -q 'prev_traffic_ts=\$now_ts' "$REPO_ROOT/scripts/usr/bin/qmanager_poller"; then
    ok "qmanager_poller uses prev_traffic_ts state variable"
else
    bad "qmanager_poller missing prev_traffic_ts init or assignment"
fi

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
# Minimal jq stub for workstation tests that lack jq — handles only the
# timestamp extraction used by read_ping_data.  On devices where real jq
# is present this function is never called because the PATH resolves first.
jq() {
    # Usage: jq -r '<filter>' <file>
    # Supports only: '.timestamp | if . == null then empty else tostring end'
    local file="\${@: -1}"
    awk -F'"timestamp":' 'NF>1{split(\$2,a,","); gsub(/[^0-9]/,"",a[1]); if(a[1]!="") print a[1]}' "\$file"
}
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

section "email recovery dispatch returns immediately (non-blocking)"

# Build a fake config + a mock msmtp that sleeps 5s. If the wrapper
# forks correctly, check_email_alert returns in well under 1s.
fake_etc="$work/etc/qmanager"
mkdir -p "$fake_etc"
cat > "$fake_etc/email_alerts.json" <<JSON
{
  "enabled": true,
  "sender_email": "from@example.com",
  "recipient_email": "to@example.com",
  "app_password": "secret",
  "threshold_minutes": 1
}
JSON
cat > "$fake_etc/msmtprc" <<EOF
# fake msmtprc — mock will short-circuit anyway
EOF

mock_bin="$work/bin"
mkdir -p "$mock_bin"
cat > "$mock_bin/msmtp" <<'EOF'
#!/bin/sh
sleep 5
exit 0
EOF
chmod +x "$mock_bin/msmtp"

# Spawn check_email_alert in a controlled environment.
runner="$work/run_email.sh"
cat > "$runner" <<EOF
#!/bin/bash
set +eu
export PATH="$mock_bin:\$PATH"
qlog_init() { :; }
qlog_debug() { :; }
qlog_info()  { :; }
qlog_warn()  { :; }
qlog_error() { :; }
qlog_state_change() { :; }
# Stub jq so _ea_read_config works on workstations that lack it.
jq() { :; }
. "$REPO_ROOT/scripts/usr/lib/qmanager/email_alerts.sh"
# Override all path constants AFTER sourcing (source resets them via the
# constants block; _LOADED guard only short-circuits on a second source).
_EA_CONFIG="$fake_etc/email_alerts.json"
_EA_MSMTP_CONFIG="$fake_etc/msmtprc"
_EA_LOG_FILE="$work/email_log.json"
_EA_MSMTP_BIN="$mock_bin/msmtp"
_EA_RECOVERY_PIDFILE="$work/email_send.pid"
# Directly inject enabled state — bypasses jq-dependent config parsing so
# the test is hermetic on workstations that do not have jq installed.
_ea_enabled="true"
_ea_sender="from@example.com"
_ea_recipient="to@example.com"
_ea_app_password="secret"
_ea_threshold_minutes=1
# Simulate the poller state: outage just ended after 2 min.
_ea_was_down="true"
_ea_downtime_start=\$(( \$(date +%s) - 120 ))
conn_internet_available="true"
check_email_alert
EOF
chmod +x "$runner"

start_ts=$(date +%s%N 2>/dev/null || date +%s)
bash "$runner" >"$work/email_run.out" 2>&1
end_ts=$(date +%s%N 2>/dev/null || date +%s)

# Compute elapsed in milliseconds. If date supports %N we get ns; else seconds.
if [ "${start_ts}" = "${end_ts%%[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]}" ]; then
    elapsed_ms=$(( (end_ts - start_ts) * 1000 ))
else
    elapsed_ms=$(( (end_ts - start_ts) / 1000000 ))
fi

if [ "$elapsed_ms" -lt 2000 ]; then
    ok "check_email_alert returned in ${elapsed_ms}ms (non-blocking)"
else
    bad "check_email_alert blocked for ${elapsed_ms}ms — send should have been backgrounded"
fi

# Confirm a background process was actually launched (pidfile written).
sleep 1  # give the forked child a moment to write its pidfile
if [ -f "$work/email_send.pid" ] || [ -f "$work/email_log.json" ]; then
    ok "background email worker created pidfile or log entry"
else
    bad "no evidence background email worker started"
fi

# Cleanup any lingering background msmtp from the test.
pkill -P $$ msmtp 2>/dev/null || true

section "SMS dispatch from check_sms_alert returns immediately"

fake_etc2="$work/etc/qmanager"
mkdir -p "$fake_etc2"
cat > "$fake_etc2/sms_alerts.json" <<JSON
{
  "enabled": true,
  "recipient_phone": "+15551234567",
  "threshold_minutes": 1
}
JSON

mock_bin2="$work/bin2"
mkdir -p "$mock_bin2"
cat > "$mock_bin2/sms_tool" <<'EOF'
#!/bin/sh
sleep 4
exit 0
EOF
chmod +x "$mock_bin2/sms_tool"

runner2="$work/run_sms.sh"
cat > "$runner2" <<EOF
#!/bin/bash
set +eu
qlog_init() { :; }
qlog_debug() { :; }
qlog_info()  { :; }
qlog_warn()  { :; }
qlog_error() { :; }
qlog_state_change() { :; }
. "$REPO_ROOT/scripts/usr/lib/qmanager/sms_alerts.sh"
_SA_CONFIG="$fake_etc2/sms_alerts.json"
_SA_LOG_FILE="$work/sms_log.json"
_SA_RELOAD_FLAG="$work/sms_reload"
_SA_LOCK_FILE="$work/sms_lock"
_SA_SMS_TOOL="$mock_bin2/sms_tool"
_SA_AT_DEVICE="/dev/null"
_SA_DISPATCH_PIDFILE="$work/sms_send.pid"
touch "\$_SA_LOCK_FILE"
sms_alerts_init
# Force registration check to pass in this test context.
_sa_is_registered() { return 0; }
# Test environment lacks jq; inject the state directly.
_sa_enabled="true"
_sa_recipient="+15551234567"
_sa_threshold_minutes=1
# Simulate: outage was 2 min, recovered now.
_sa_was_down="true"
_sa_downtime_sms_status="sent"   # pretend downtime SMS succeeded
_sa_downtime_start=\$(( \$(date +%s) - 120 ))
conn_internet_available="true"
modem_reachable="true"
lte_state="connected"
nr_state="inactive"
check_sms_alert
EOF
chmod +x "$runner2"

start_ts=$(date +%s%N 2>/dev/null || date +%s)
bash "$runner2" >"$work/sms_run.out" 2>&1
end_ts=$(date +%s%N 2>/dev/null || date +%s)

if [ "${#start_ts}" -gt 12 ]; then
    elapsed_ms=$(( (end_ts - start_ts) / 1000000 ))
else
    elapsed_ms=$(( (end_ts - start_ts) * 1000 ))
fi

if [ "$elapsed_ms" -lt 2000 ]; then
    ok "check_sms_alert recovery dispatch returned in ${elapsed_ms}ms"
else
    bad "check_sms_alert blocked for ${elapsed_ms}ms — send should have been backgrounded"
fi

# Confirm a background process was actually launched (pidfile written by parent).
sleep 1  # give the forked child a moment to be scheduled
if [ -f "$work/sms_send.pid" ] || [ -f "$work/sms_log.json" ]; then
    ok "background SMS worker created pidfile or log entry"
else
    bad "no evidence background SMS worker started"
fi

# Cleanup any lingering mock sms_tool processes.
pkill -P $$ sms_tool 2>/dev/null || true

printf '\n%d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail" -eq 0 ] || exit 1
echo "ALL PASS"
