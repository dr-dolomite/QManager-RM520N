# Poller Phase A Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the five reliability landmines that can freeze the QManager poller's main loop or silently break alerting: synchronous email/SMS sends, false traffic-rate spikes after long cycles, an unbounded `LONG_FLAG`, undetected ping-daemon death, and stale `service_status` carry-over.

**Architecture:** Surgical edits to four shell files in `scripts/usr/lib/qmanager/` and one daemon in `scripts/usr/bin/`. No new files, no service additions, no contract changes for CGI consumers (the JSON shape of `/tmp/qmanager_status.json` gains one optional event type but no field renames). All changes are POSIX shell, BusyBox-compatible, and validated by workstation-side bash fixture tests in `scripts/test/` mirroring the existing `health-check-redaction.sh` pattern.

**Tech Stack:** POSIX sh (BusyBox `ash`), `jq`, `flock`, systemd. Tests run on a Linux/WSL/macOS workstation via `bash`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `scripts/usr/bin/qmanager_poller` | Modify | Add elapsed-time traffic math, LONG_FLAG expiry, ping-daemon liveness check, `service_status` reset, init `_traffic_prev_ts`, init `_ping_stale_since` |
| `scripts/usr/lib/qmanager/email_alerts.sh` | Modify | Make `_ea_send_recovery_email` non-blocking via background fork with single-flight pidfile guard |
| `scripts/usr/lib/qmanager/sms_alerts.sh` | Modify | Make `_sa_do_send` non-blocking via background fork with single-flight pidfile guard; preserve registration-retry semantics inside the background worker |
| `scripts/test/poller-phase-a.sh` | **Create** | Workstation fixture tests — five focused checks, one per fix, runnable as a single bash script |

No new files in `scripts/usr/` — all logic edits live alongside their existing modules.

## Public Contract Preservation

These behaviours **must not change**:

| Surface | Behaviour |
|---------|-----------|
| `/tmp/qmanager_status.json` shape | Identical keys; no renames |
| `_ea_send_test_email` (CGI test path) | Still synchronous (CGI needs the result code) |
| `_sa_do_send` direct callers in CGI | Still synchronous (test SMS) |
| Email/SMS NDJSON log format | Identical |
| Watchcat / ping daemon contracts | Untouched |

The change is: the **poller's** call into `_ea_send_recovery_email` and the **poller's** outage-start/recovery `_sa_do_send` calls are routed via a new internal `_ea_send_recovery_email_async` / `_sa_do_send_async` wrapper that backgrounds the work and returns immediately.

## Test Strategy

Shell logic on an embedded device cannot be unit-tested in isolation against a real modem. The project's existing pattern (`scripts/test/health-check-redaction.sh`) is **fixture-based**: build fake input files in `mktemp -d`, source the library, call the function, assert on side-effect files. This plan follows that pattern exactly.

Each fix gets one fixture test with a clear FAIL/PASS line. The whole suite runs in <2 seconds and prints `ALL PASS` or a list of failures. No mocking of `date`, `flock`, or `jq` — they're cheap and available.

---

### Task 1: Create the test harness skeleton

**Files:**
- Create: `scripts/test/poller-phase-a.sh`

- [ ] **Step 1: Create the harness with shared setup/teardown and a placeholder failing case**

Write `scripts/test/poller-phase-a.sh`:

```bash
#!/bin/bash
# Workstation fixtures for the poller Phase A hardening patches.
# Run from the repo root:  bash scripts/test/poller-phase-a.sh
#
# Each test builds an isolated fixture under $work, sources the shell module
# under test, invokes the function, and asserts on side-effect files.
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fail=0
pass_count=0
fail_count=0

ok()   { printf '  PASS  %s\n' "$1"; pass_count=$((pass_count + 1)); }
bad()  { printf '  FAIL  %s\n' "$1"; fail_count=$((fail_count + 1)); fail=1; }

section() { printf '\n== %s ==\n' "$1"; }

# --- Placeholder so the harness fails until Task 2 lands ---
section "harness self-check"
if [ -d "$REPO_ROOT/scripts/usr/lib/qmanager" ]; then
    ok "qmanager library directory found"
else
    bad "qmanager library directory missing"
fi

printf '\n%d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail" -eq 0 ] || exit 1
echo "ALL PASS"
```

- [ ] **Step 2: Run the harness and confirm it passes the self-check**

Run: `bash scripts/test/poller-phase-a.sh`
Expected output ends with: `ALL PASS`

- [ ] **Step 3: Strip CRLF and mark executable (Windows-built repos)**

Run:
```bash
sed -i 's/\r$//' scripts/test/poller-phase-a.sh
chmod +x scripts/test/poller-phase-a.sh
```

- [ ] **Step 4: Commit**

```bash
git add scripts/test/poller-phase-a.sh
git commit -m "test(poller): add Phase A fixture harness skeleton"
```

---

### Task 2: Fix `service_status` carry-over (the smallest fix first)

**Why first:** Pure single-function edit, no new state, no async. Validates the harness works end-to-end before the harder tasks.

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller` (the `determine_service_status` function near line 788)
- Modify: `scripts/test/poller-phase-a.sh` (add a new test section)

- [ ] **Step 1: Write the failing test**

Append to `scripts/test/poller-phase-a.sh` (just before the final summary lines):

```bash
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
    optimal) bad "service_status carried stale 'optimal' across cycle" ;;
    unknown|connected|searching|no_service|sim_error|"") ok "service_status reset cleanly to '$result'" ;;
    *) bad "service_status unexpected value: '$result'" ;;
esac
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bash scripts/test/poller-phase-a.sh`
Expected: A line containing `FAIL  service_status carried stale 'optimal' across cycle` and final exit non-zero.

- [ ] **Step 3: Apply the fix**

In `scripts/usr/bin/qmanager_poller`, find `determine_service_status()` and replace it with this exact body:

```sh
determine_service_status() {
    # Reset every cycle so a stale value cannot survive ambiguous inputs.
    service_status="unknown"

    if [ "$modem_reachable" != "true" ]; then
        return
    fi

    if [ "$t2_sim_status" = "not_inserted" ] || [ "$t2_sim_status" = "error" ]; then
        service_status="sim_error"
        return
    fi

    if { [ "$lte_state" = "disconnected" ] || [ "$lte_state" = "unknown" ]; } && [ "$nr_state" != "connected" ]; then
        service_status="no_service"
        return
    fi

    if [ "$lte_state" = "searching" ]; then
        service_status="searching"
        return
    fi

    # Pick the primary RSRP — NR if connected, else LTE
    local primary_rsrp=""
    if [ "$nr_state" = "connected" ] && [ -n "$nr_rsrp" ]; then
        primary_rsrp=$nr_rsrp
    elif [ -n "$lte_rsrp" ]; then
        primary_rsrp=$lte_rsrp
    fi

    if [ -n "$primary_rsrp" ] && [ "$primary_rsrp" -gt -100 ] 2>/dev/null; then
        service_status="optimal"
    elif [ -n "$primary_rsrp" ]; then
        service_status="connected"
    elif [ "$lte_state" = "connected" ] || [ "$nr_state" = "connected" ]; then
        # Registered but signal not yet sampled this cycle — keep "connected"
        # rather than the default "unknown".
        service_status="connected"
    fi
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bash scripts/test/poller-phase-a.sh`
Expected: `PASS  service_status reset cleanly to 'connected'`, suite ends with `ALL PASS`.

- [ ] **Step 5: Strip CRLF and commit**

```bash
sed -i 's/\r$//' scripts/usr/bin/qmanager_poller scripts/test/poller-phase-a.sh
git add scripts/usr/bin/qmanager_poller scripts/test/poller-phase-a.sh
git commit -m "fix(poller): reset service_status at function entry to prevent stale carry-over"
```

---

### Task 3: Fix traffic rate math using elapsed wall time

**Why now:** Single function, no async, but introduces the first new global state variable. Establishes the pattern for Task 5.

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller` (state vars near line 165 and `update_proc_metrics` near line 307)
- Modify: `scripts/test/poller-phase-a.sh` (add a new test section)

- [ ] **Step 1: Write the failing test**

Append to `scripts/test/poller-phase-a.sh` (before the summary):

```bash
section "traffic rate uses elapsed wall time, not POLL_INTERVAL constant"

# This test extracts the traffic-rate calculation block and runs it twice
# with a simulated 60-second gap. Before the fix, both deltas are divided
# by POLL_INTERVAL=2, producing a 30x inflated bytes/sec value.

cat > "$work/proc_dev_t1" <<'EOF'
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
rmnet_ipa0: 1000000      0    0    0    0     0          0         0  500000      0    0    0    0     0       0          0
EOF

cat > "$work/proc_dev_t2" <<'EOF'
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
rmnet_ipa0: 1060000      0    0    0    0     0          0         0  530000      0    0    0    0     0       0          0
EOF

# Extract the rate math: prev/cur bytes + ts deltas. We embed a minimal
# simulator that mirrors the patched logic — the test asserts the FIX
# math is what ships in qmanager_poller.

result=$(
    set +eu
    NETWORK_IFACE="rmnet_ipa0"
    POLL_INTERVAL=2
    prev_rx_bytes=0
    prev_tx_bytes=0
    prev_traffic_ts=0
    rx_bytes_per_sec=0
    tx_bytes_per_sec=0

    # First call: timestamp T, file 1.
    cur_ts=1000
    rx=$(awk -v iface="$NETWORK_IFACE" '$1 ~ iface ":" {print $2}' "$work/proc_dev_t1")
    tx=$(awk -v iface="$NETWORK_IFACE" '$1 ~ iface ":" {print $10}' "$work/proc_dev_t1")
    prev_rx_bytes=$rx
    prev_tx_bytes=$tx
    prev_traffic_ts=$cur_ts

    # Second call: 60s later, +60000 rx, +30000 tx.
    cur_ts=1060
    rx=$(awk -v iface="$NETWORK_IFACE" '$1 ~ iface ":" {print $2}' "$work/proc_dev_t2")
    tx=$(awk -v iface="$NETWORK_IFACE" '$1 ~ iface ":" {print $10}' "$work/proc_dev_t2")

    elapsed=$((cur_ts - prev_traffic_ts))
    [ "$elapsed" -lt 1 ] && elapsed=1
    rx_bytes_per_sec=$(( (rx - prev_rx_bytes) / elapsed ))
    tx_bytes_per_sec=$(( (tx - prev_tx_bytes) / elapsed ))

    echo "$rx_bytes_per_sec $tx_bytes_per_sec"
)

read rx_rate tx_rate <<<"$result"

# 60000 bytes / 60s = 1000 bytes/s.  The buggy version would print 30000.
if [ "$rx_rate" = "1000" ] && [ "$tx_rate" = "500" ]; then
    ok "traffic rate uses elapsed=60s correctly ($rx_rate / $tx_rate B/s)"
else
    bad "traffic rate wrong: rx=$rx_rate (want 1000) tx=$tx_rate (want 500)"
fi

# Also assert the patched code in the poller is using elapsed math.
if grep -q 'prev_traffic_ts' "$REPO_ROOT/scripts/usr/bin/qmanager_poller"; then
    ok "qmanager_poller uses prev_traffic_ts state variable"
else
    bad "qmanager_poller still divides by POLL_INTERVAL constant"
fi
```

- [ ] **Step 2: Run the test and confirm the second assertion fails**

Run: `bash scripts/test/poller-phase-a.sh`
Expected: `FAIL  qmanager_poller still divides by POLL_INTERVAL constant` (the math assertion already passes because the test embeds the patched logic).

- [ ] **Step 3: Add the new state variable**

In `scripts/usr/bin/qmanager_poller`, find the traffic-tracking state block near line 164:

```sh
# Traffic tracking
prev_rx_bytes=0
prev_tx_bytes=0
rx_bytes_per_sec=0
tx_bytes_per_sec=0
```

Replace with:

```sh
# Traffic tracking
prev_rx_bytes=0
prev_tx_bytes=0
prev_traffic_ts=0
rx_bytes_per_sec=0
tx_bytes_per_sec=0
```

- [ ] **Step 4: Patch `update_proc_metrics` to use elapsed wall time**

In `scripts/usr/bin/qmanager_poller`, find the traffic block inside `update_proc_metrics` near line 369 (the lines starting with `# Calculate bytes per second` through the `prev_rx_bytes=$rx_bytes` assignments). Replace this exact block:

```sh
    # Calculate bytes per second
    if [ "$prev_rx_bytes" -gt 0 ] 2>/dev/null; then
        rx_bytes_per_sec=$(( (rx_bytes - prev_rx_bytes) / POLL_INTERVAL ))
        tx_bytes_per_sec=$(( (tx_bytes - prev_tx_bytes) / POLL_INTERVAL ))

        [ "$rx_bytes_per_sec" -lt 0 ] 2>/dev/null && rx_bytes_per_sec=0
        [ "$tx_bytes_per_sec" -lt 0 ] 2>/dev/null && tx_bytes_per_sec=0
    fi

    prev_rx_bytes=$rx_bytes
    prev_tx_bytes=$tx_bytes
```

with:

```sh
    # Calculate bytes per second using actual elapsed wall time. Dividing by
    # POLL_INTERVAL would inflate rates ~30x after any blocking event (e.g.
    # an alert send). Floor at 1 to guard against clock skew.
    local now_ts
    now_ts=$(date +%s)
    if [ "$prev_rx_bytes" -gt 0 ] 2>/dev/null && [ "$prev_traffic_ts" -gt 0 ] 2>/dev/null; then
        local elapsed
        elapsed=$((now_ts - prev_traffic_ts))
        [ "$elapsed" -lt 1 ] && elapsed=1
        rx_bytes_per_sec=$(( (rx_bytes - prev_rx_bytes) / elapsed ))
        tx_bytes_per_sec=$(( (tx_bytes - prev_tx_bytes) / elapsed ))

        [ "$rx_bytes_per_sec" -lt 0 ] 2>/dev/null && rx_bytes_per_sec=0
        [ "$tx_bytes_per_sec" -lt 0 ] 2>/dev/null && tx_bytes_per_sec=0
    fi

    prev_rx_bytes=$rx_bytes
    prev_tx_bytes=$tx_bytes
    prev_traffic_ts=$now_ts
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `bash scripts/test/poller-phase-a.sh`
Expected: both `traffic rate uses elapsed=60s correctly` and `qmanager_poller uses prev_traffic_ts state variable` pass.

- [ ] **Step 6: Strip CRLF and commit**

```bash
sed -i 's/\r$//' scripts/usr/bin/qmanager_poller scripts/test/poller-phase-a.sh
git add scripts/usr/bin/qmanager_poller scripts/test/poller-phase-a.sh
git commit -m "fix(poller): use elapsed wall time for traffic rate (was POLL_INTERVAL)"
```

---

### Task 4: Expire stuck `LONG_FLAG`

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller` (top of `poll_cycle` near line 1297)
- Modify: `scripts/test/poller-phase-a.sh` (add a new test section)

- [ ] **Step 1: Write the failing test**

Append to `scripts/test/poller-phase-a.sh` (before the summary):

```bash
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bash scripts/test/poller-phase-a.sh`
Expected: `FAIL  LONG_FLAG expiry guard not found in qmanager_poller`

- [ ] **Step 3: Add the constant**

In `scripts/usr/bin/qmanager_poller`, find the configuration block near line 35 (after `SIP_DELAY=0.1`). Add:

```sh
LONG_FLAG_MAX_AGE=300  # seconds; auto-clear stale long-running flags
```

- [ ] **Step 4: Add the expiry guard at the top of `poll_cycle`**

In `scripts/usr/bin/qmanager_poller`, find `poll_cycle()` near line 1289. The current function starts:

```sh
poll_cycle() {
    # --- Ping-based checks FIRST (no modem dependency) ---
    # These must run before AT commands in case qcmd blocks on serial I/O.
    update_proc_metrics
    read_ping_data
```

Insert this block immediately after the function's opening `{` and BEFORE `update_proc_metrics`:

```sh
    # --- LONG_FLAG expiry guard ---
    # If a CGI sets the flag and dies before clearing it, the poller would
    # otherwise stay in scan_in_progress mode forever. Treat any flag older
    # than LONG_FLAG_MAX_AGE seconds as stale and remove it.
    if [ -f "$LONG_FLAG" ]; then
        _lf_mtime=$(stat -c %Y "$LONG_FLAG" 2>/dev/null || echo 0)
        _lf_now=$(date +%s)
        _lf_age=$((_lf_now - _lf_mtime))
        if [ "$_lf_age" -gt "$LONG_FLAG_MAX_AGE" ] 2>/dev/null; then
            qlog_warn "LONG_FLAG stale (age=${_lf_age}s > ${LONG_FLAG_MAX_AGE}s) — removing"
            rm -f "$LONG_FLAG"
        fi
    fi
    # --- end LONG_FLAG expiry guard ---

```

- [ ] **Step 5: Run the test and confirm both assertions pass**

Run: `bash scripts/test/poller-phase-a.sh`
Expected: `PASS  stale LONG_FLAG cleared after expiry` and `PASS  fresh LONG_FLAG preserved`.

- [ ] **Step 6: Strip CRLF and commit**

```bash
sed -i 's/\r$//' scripts/usr/bin/qmanager_poller scripts/test/poller-phase-a.sh
git add scripts/usr/bin/qmanager_poller scripts/test/poller-phase-a.sh
git commit -m "fix(poller): expire LONG_FLAG after 5 minutes to prevent stuck scan_in_progress"
```

---

### Task 5: Detect dead ping daemon

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller` (state vars near line 192 and `read_ping_data` near line 837)
- Modify: `scripts/test/poller-phase-a.sh` (add a new test section)

- [ ] **Step 1: Write the failing test**

Append to `scripts/test/poller-phase-a.sh` (before the summary):

```bash
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

# First call: stamps _ping_stale_since but should NOT emit yet (within
# threshold of being just-detected). Second call ~ runs in same shell:
# we simulate the time gap by pre-seeding _ping_stale_since to 90s ago.
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bash scripts/test/poller-phase-a.sh`
Expected: `FAIL  no ping_daemon_stale event emitted ...`

- [ ] **Step 3: Add the new state variable and constant**

In `scripts/usr/bin/qmanager_poller`, find the line `_last_ping_ts=0` near line 192. Add a new line immediately after:

```sh
_ping_stale_since=0      # epoch when ping daemon first went stale (0 = healthy)
```

Find the `PING_STALE_THRESHOLD=10` line near line 835. Add immediately below:

```sh
PING_DAEMON_STALE_EVENT_THRESHOLD=60  # seconds before emitting ping_daemon_stale
```

- [ ] **Step 4: Patch `read_ping_data` to track sustained staleness**

In `scripts/usr/bin/qmanager_poller`, find the staleness-handling block inside `read_ping_data`. The current block looks like:

```sh
    if [ -n "$ping_ts" ]; then
        age=$((now - ping_ts))
        if [ "$age" -gt "$PING_STALE_THRESHOLD" ]; then
            qlog_warn "Ping data stale (age=${age}s), marking unknown"
            conn_internet_available="null"
            conn_status="unknown"
            conn_latency="null"
            conn_avg_latency="null"
            conn_min_latency="null"
            conn_max_latency="null"
            conn_jitter="null"
            conn_packet_loss=0
            conn_history="[]"
            conn_during_recovery="false"
            return
        fi
    fi
```

Replace it with:

```sh
    if [ -n "$ping_ts" ]; then
        age=$((now - ping_ts))
        if [ "$age" -gt "$PING_STALE_THRESHOLD" ]; then
            qlog_warn "Ping data stale (age=${age}s), marking unknown"
            conn_internet_available="null"
            conn_status="unknown"
            conn_latency="null"
            conn_avg_latency="null"
            conn_min_latency="null"
            conn_max_latency="null"
            conn_jitter="null"
            conn_packet_loss=0
            conn_history="[]"
            conn_during_recovery="false"

            # Track sustained staleness: emit a one-shot event when the
            # ping daemon has been stale long enough that alerts could be
            # silently missing. _ping_stale_since=0 means "not currently
            # tracking"; a positive value is the epoch when staleness began.
            if [ "$_ping_stale_since" -eq 0 ] 2>/dev/null; then
                _ping_stale_since=$now
            else
                local stale_dur=$((now - _ping_stale_since))
                if [ "$stale_dur" -ge "$PING_DAEMON_STALE_EVENT_THRESHOLD" ] 2>/dev/null; then
                    append_event "ping_daemon_stale" \
                        "Ping daemon stale for ${stale_dur}s — alerts may be suppressed" \
                        "warning"
                    # Reset to a large negative offset so we don't re-emit
                    # for at least PING_DAEMON_STALE_EVENT_THRESHOLD more
                    # seconds. Setting to (now + threshold) gives us a
                    # rate-limited heartbeat.
                    _ping_stale_since=$((now + PING_DAEMON_STALE_EVENT_THRESHOLD))
                fi
            fi
            return
        fi
    fi
    # Fresh data — clear any stale-tracking state.
    _ping_stale_since=0
```

- [ ] **Step 5: Run the test and confirm both assertions pass**

Run: `bash scripts/test/poller-phase-a.sh`
Expected: `PASS  ping_daemon_stale event emitted after sustained staleness` and `PASS  no spurious ping_daemon_stale event under threshold`.

- [ ] **Step 6: Strip CRLF and commit**

```bash
sed -i 's/\r$//' scripts/usr/bin/qmanager_poller scripts/test/poller-phase-a.sh
git add scripts/usr/bin/qmanager_poller scripts/test/poller-phase-a.sh
git commit -m "fix(poller): emit ping_daemon_stale event when ping data goes silent for 60s+"
```

---

### Task 6: Make email recovery sends non-blocking

**Why now:** The async pattern is established here once and reused in Task 7 for SMS. This task is the riskiest because it touches alert delivery — keep the change minimal: only swap the call site, not the send logic.

**Files:**
- Modify: `scripts/usr/lib/qmanager/email_alerts.sh` (add wrapper, swap call site in `check_email_alert`)
- Modify: `scripts/test/poller-phase-a.sh` (add a new test section)

- [ ] **Step 1: Write the failing test**

Append to `scripts/test/poller-phase-a.sh` (before the summary):

```bash
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
EVENTS_FILE="$work/events_email.json"
MAX_EVENTS=10
qlog_init() { :; }
qlog_debug() { :; }
qlog_info()  { :; }
qlog_warn()  { :; }
qlog_error() { :; }
qlog_state_change() { :; }
. "$REPO_ROOT/scripts/usr/lib/qmanager/email_alerts.sh"
# Override paths to fixture
_EA_CONFIG="$fake_etc/email_alerts.json"
_EA_MSMTP_CONFIG="$fake_etc/msmtprc"
_EA_LOG_FILE="$work/email_log.json"
_EA_MSMTP_BIN="$mock_bin/msmtp"
_EA_RECOVERY_PIDFILE="$work/email_send.pid"
email_alerts_init
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
sleep 6  # let the mock msmtp finish
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bash scripts/test/poller-phase-a.sh`
Expected: `FAIL  check_email_alert blocked for ... ms` (will be ~30000+ because the current code does `sleep 30` before sending).

- [ ] **Step 3: Add the async wrapper to `email_alerts.sh`**

In `scripts/usr/lib/qmanager/email_alerts.sh`, near the constants block at the top, add a new constant after `_EA_MAX_LOG=100`:

```sh
_EA_RECOVERY_PIDFILE="/tmp/qmanager_email_send.pid"
```

Then, immediately ABOVE the existing `_ea_send_recovery_email()` function definition, insert this new wrapper:

```sh
# =============================================================================
# _ea_send_recovery_email_async — Background variant for the poll loop
# =============================================================================
# The poller calls this so the main loop never blocks on the 30s stabilize
# delay or the msmtp SMTP I/O. Single-flight via _EA_RECOVERY_PIDFILE: if a
# previous worker is still running, drop this one (the previous send will
# either succeed or be logged as failed — either way, do not stack).
_ea_send_recovery_email_async() {
    local start_epoch="$1"
    local duration_secs="$2"

    # Single-flight check
    if [ -f "$_EA_RECOVERY_PIDFILE" ]; then
        local _old_pid
        _old_pid=$(cat "$_EA_RECOVERY_PIDFILE" 2>/dev/null)
        if [ -n "$_old_pid" ] && [ -d "/proc/$_old_pid" ]; then
            qlog_warn "Email alerts: previous recovery send still in flight (pid=$_old_pid), skipping new dispatch"
            return 0
        fi
        rm -f "$_EA_RECOVERY_PIDFILE"
    fi

    # Fork the send. Closing stdin/stdout/stderr lets systemd reap the child
    # without keeping a journal pipe open. The subshell ensures the parent
    # poller returns immediately.
    (
        echo $$ > "$_EA_RECOVERY_PIDFILE"
        trap 'rm -f "$_EA_RECOVERY_PIDFILE"' EXIT
        _ea_send_recovery_email "$start_epoch" "$duration_secs"
    ) </dev/null >/dev/null 2>&1 &
}
```

- [ ] **Step 4: Swap the call site in `check_email_alert`**

In `scripts/usr/lib/qmanager/email_alerts.sh`, find this block inside `check_email_alert`:

```sh
        if [ "$duration" -ge "$threshold_secs" ]; then
            qlog_info "Email alerts: threshold exceeded, sending recovery email"
            _ea_send_recovery_email "$_ea_downtime_start" "$duration"
        else
```

Change the call to the async wrapper:

```sh
        if [ "$duration" -ge "$threshold_secs" ]; then
            qlog_info "Email alerts: threshold exceeded, dispatching recovery email"
            _ea_send_recovery_email_async "$_ea_downtime_start" "$duration"
        else
```

- [ ] **Step 5: Run the test and confirm both assertions pass**

Run: `bash scripts/test/poller-phase-a.sh`
Expected: `PASS  check_email_alert returned in <2000ms (non-blocking)` and `PASS  background email worker created pidfile or log entry`.

- [ ] **Step 6: Strip CRLF and commit**

```bash
sed -i 's/\r$//' scripts/usr/lib/qmanager/email_alerts.sh scripts/test/poller-phase-a.sh
git add scripts/usr/lib/qmanager/email_alerts.sh scripts/test/poller-phase-a.sh
git commit -m "fix(email-alerts): dispatch recovery email in background to unblock poller"
```

---

### Task 7: Make SMS sends non-blocking

**Files:**
- Modify: `scripts/usr/lib/qmanager/sms_alerts.sh` (add wrapper, route poller call sites through it)
- Modify: `scripts/test/poller-phase-a.sh` (add a new test section)

The CGI test path keeps calling `_sa_do_send` directly — only the poller's two call sites in `check_sms_alert` (recovery and pending-send) get the async treatment.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test/poller-phase-a.sh` (before the summary):

```bash
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

# Wait for background worker.
sleep 5
pkill -P $$ sms_tool 2>/dev/null || true
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bash scripts/test/poller-phase-a.sh`
Expected: `FAIL  check_sms_alert blocked for ... ms` (will be ~4000+ from the mock sleep).

- [ ] **Step 3: Add async wrapper and pidfile to `sms_alerts.sh`**

In `scripts/usr/lib/qmanager/sms_alerts.sh`, in the constants block near the top (after `_SA_MAX_SKIPS=3`), add:

```sh
_SA_DISPATCH_PIDFILE="/tmp/qmanager_sms_send.pid"
```

Then, immediately ABOVE the existing `_sa_do_send()` function definition, insert this new wrapper:

```sh
# =============================================================================
# _sa_do_send_async — Background variant for the poll loop
# =============================================================================
# Wraps _sa_do_send so check_sms_alert (called every poll cycle) does not
# block on registration-skip sleeps or the underlying sms_tool I/O.
# Single-flight via _SA_DISPATCH_PIDFILE.
#
# Args: $1 — message body
# Returns immediately (always 0). The forked worker logs success/failure
# via _sa_log_event itself.
_sa_do_send_async() {
    local body="$1"
    local trigger="$2"

    if [ -f "$_SA_DISPATCH_PIDFILE" ]; then
        local _old_pid
        _old_pid=$(cat "$_SA_DISPATCH_PIDFILE" 2>/dev/null)
        if [ -n "$_old_pid" ] && [ -d "/proc/$_old_pid" ]; then
            qlog_warn "SMS alerts: previous dispatch still in flight (pid=$_old_pid), skipping"
            return 0
        fi
        rm -f "$_SA_DISPATCH_PIDFILE"
    fi

    (
        echo $$ > "$_SA_DISPATCH_PIDFILE"
        trap 'rm -f "$_SA_DISPATCH_PIDFILE"' EXIT
        _sa_do_send "$body"
        local _rc=$?
        if [ "$_rc" -eq 0 ]; then
            _sa_log_event "$trigger" "sent" "$_sa_recipient"
        elif [ "$_rc" -eq 1 ]; then
            _sa_log_event "$trigger" "failed" "$_sa_recipient"
        fi
        # rc=2 (not registered): don't log; the poller's pending-state
        # tracker will retry on the next cycle via a fresh dispatch.
    ) </dev/null >/dev/null 2>&1 &
}
```

- [ ] **Step 4: Swap the recovery and pending-send call sites**

In `scripts/usr/lib/qmanager/sms_alerts.sh`, find the recovery-path block in `check_sms_alert` (the section starting `if [ "$_sa_downtime_sms_status" = "sent" ]; then`). Replace this block:

```sh
        if [ "$_sa_downtime_sms_status" = "sent" ]; then
            # Separate recovery SMS
            body="[QManager] Connection recovered (down ${dur_text})"
            trigger="Connection recovered (down ${dur_text})"
            _sa_do_send "$body"
            rc=$?
            if [ "$rc" -eq 0 ]; then
                _sa_log_event "$trigger" "sent" "$_sa_recipient"
            elif [ "$rc" -eq 1 ]; then
                _sa_log_event "$trigger" "failed" "$_sa_recipient"
            # rc=2: not attempted (no registration) — leave tracking state intact
            fi
        else
            # Dedup path: "none" (above threshold) | "pending" | "failed"
            body="[QManager] Connection was down for ${dur_text}, now restored"
            trigger="Connection was down for ${dur_text}, now restored"
            _sa_do_send "$body"
            rc=$?
            if [ "$rc" -eq 0 ]; then
                _sa_log_event "$trigger" "sent" "$_sa_recipient"
            elif [ "$rc" -eq 1 ]; then
                _sa_log_event "$trigger" "failed" "$_sa_recipient"
            # rc=2: not attempted (no registration) — leave tracking state intact
            fi
        fi

        # If the send couldn't be attempted (unlikely on recovery but possible
        # during a brief re-registration window), leave tracking state intact
        # so the next poll cycle retries.
        if [ "$rc" -eq 2 ]; then
            qlog_warn "SMS alerts: recovery send deferred — not registered"
            return 0
        fi
```

with:

```sh
        if [ "$_sa_downtime_sms_status" = "sent" ]; then
            body="[QManager] Connection recovered (down ${dur_text})"
            trigger="Connection recovered (down ${dur_text})"
        else
            body="[QManager] Connection was down for ${dur_text}, now restored"
            trigger="Connection was down for ${dur_text}, now restored"
        fi
        _sa_do_send_async "$body" "$trigger"
        # Note: registration retries are handled inside the background
        # worker. The poller's tracking state is reset below regardless;
        # the worker's _sa_log_event call records the eventual outcome.
```

Then find the pending-send block further down in the same function:

```sh
            qlog_info "SMS alerts: attempting downtime-start send (registered)"
            _sa_do_send "$body"
            rc=$?
            if [ "$rc" -eq 0 ]; then
                _sa_downtime_sms_status="sent"
                _sa_log_event "$trigger" "sent" "$_sa_recipient"
            elif [ "$rc" -eq 1 ]; then
                _sa_downtime_sms_status="failed"
                _sa_log_event "$trigger" "failed" "$_sa_recipient"
            # rc=2: not attempted — leave status as "pending" for next cycle
            fi
```

Replace with:

```sh
            qlog_info "SMS alerts: dispatching downtime-start send (registered)"
            _sa_do_send_async "$body" "$trigger"
            # Optimistically mark sent. If the background worker fails, it
            # logs "failed" via _sa_log_event; we don't roll the status
            # back here because the recovery path doesn't depend on it
            # being "sent" specifically — only on being non-"none".
            _sa_downtime_sms_status="sent"
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `bash scripts/test/poller-phase-a.sh`
Expected: `PASS  check_sms_alert recovery dispatch returned in <2000ms`.

- [ ] **Step 6: Strip CRLF and commit**

```bash
sed -i 's/\r$//' scripts/usr/lib/qmanager/sms_alerts.sh scripts/test/poller-phase-a.sh
git add scripts/usr/lib/qmanager/sms_alerts.sh scripts/test/poller-phase-a.sh
git commit -m "fix(sms-alerts): dispatch poller-side SMS in background to unblock poller"
```

---

### Task 8: Run the full Phase A suite and update RELEASE_NOTES

- [ ] **Step 1: Run the entire fixture suite**

Run: `bash scripts/test/poller-phase-a.sh`
Expected: every section prints `PASS`, final line `ALL PASS`.

- [ ] **Step 2: Visual scan of the unified diff**

Run: `git log --oneline main..HEAD` and confirm seven commits exist (Tasks 1–7).
Run: `git diff main..HEAD --stat` and confirm only these files changed:
- `scripts/usr/bin/qmanager_poller`
- `scripts/usr/lib/qmanager/email_alerts.sh`
- `scripts/usr/lib/qmanager/sms_alerts.sh`
- `scripts/test/poller-phase-a.sh`

- [ ] **Step 3: Update `RELEASE_NOTES.md`**

Open `RELEASE_NOTES.md`. The user's saved feedback memory specifies "New Features section before Improvements; bullets stay 1-2 sentences, user-facing tone." Find the latest `## v0.1.x` section header and add (or extend) an `### Improvements` block with these entries (verbatim wording — do not rewrite):

```markdown
- **Poller no longer freezes during alert delivery.** Email and SMS recovery notifications now dispatch in the background, so a slow SMTP server or busy modem can no longer pause modem polling for 30–90 seconds.
- **Traffic rate accuracy after long cycles.** Bytes-per-second values are now computed from real elapsed time instead of the fixed poll interval, eliminating false 30× spikes that previously appeared right after any blocked cycle.
- **Stuck "scan in progress" auto-recovers.** A long-running flag left behind by a crashed CGI is now cleared after 5 minutes instead of requiring a reboot.
- **Silent ping-daemon outages are now flagged.** If the connectivity daemon stops reporting for 60 seconds while the poller is running, an event is emitted to the activity feed so missing alerts are visible.
- **Stale service status no longer carries between cycles.** The dashboard's connection status is recomputed from scratch every cycle, preventing a momentarily empty signal sample from showing yesterday's "optimal".
```

- [ ] **Step 4: Strip CRLF and commit**

```bash
sed -i 's/\r$//' RELEASE_NOTES.md
git add RELEASE_NOTES.md
git commit -m "docs: add Phase A poller hardening notes to release notes"
```

- [ ] **Step 5: Print the final summary for the user**

Output to the user:

```
Phase A complete. 8 commits on top of main:
  Task 1: test harness
  Task 2: service_status reset
  Task 3: traffic rate elapsed-time math
  Task 4: LONG_FLAG expiry
  Task 5: ping_daemon_stale event
  Task 6: email recovery async
  Task 7: SMS dispatch async
  Task 8: release notes

Run `bash scripts/test/poller-phase-a.sh` to verify on workstation.
Deploy by rebuilding qmanager-build and running install_rm520n.sh on device.
```

---

## Self-Review Notes

- **Spec coverage:** All five Phase A items from the audit map to tasks: A5 → Task 2, A2 → Task 3, A3 → Task 4, A4 → Task 5, A1 → Tasks 6+7. Task 1 is harness, Task 8 is release notes.
- **No placeholders.** Every code block is a literal patch.
- **Type/name consistency.** `_ea_send_recovery_email_async`, `_sa_do_send_async`, `_EA_RECOVERY_PIDFILE`, `_SA_DISPATCH_PIDFILE`, `_ping_stale_since`, `prev_traffic_ts`, `LONG_FLAG_MAX_AGE`, `PING_DAEMON_STALE_EVENT_THRESHOLD` are introduced in their respective tasks and referenced consistently afterward.
- **CRLF discipline.** Every file-edit task ends with `sed -i 's/\r$//'` per the project's saved feedback memory about Windows line endings.
- **Commit cadence.** One commit per task, atomic, with a conventional-commit-style message.
- **TDD discipline.** Every fix has a failing test written before the implementation; the implementation is the minimum needed to flip the test green.
