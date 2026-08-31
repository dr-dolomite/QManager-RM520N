# Real-Internet Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ICMP-ping reachability check in `qmanager_ping` with an HTTP `204`-content-validated probe that reliably distinguishes real internet from captive portals, while reducing per-minute CPU by ~55% by eliminating the per-cycle `jq` fork.

**Architecture:** Three-layer change, all inside `scripts/usr/bin/qmanager_ping`. (1) A free 6 ms carrier-state read from `/sys/class/net/rmnet_data0/carrier` short-circuits the probe when the WAN link is down. (2) A `curl` HTTP probe alternates between two `generate_204` endpoints and validates the response code is exactly `204` — captive portals return `200 + HTML` and correctly fail. (3) The slim cache JSON is rendered with `printf` instead of `jq -n`, dropping a 322 KB binary load per cycle. All downstream consumers (`qmanager_poller`, `qmanager_watchcat`, `fetch_ping_history.sh`, `useLatencyHistory`) read the same JSON schema and require no changes. Service name, file paths, and field names are preserved.

**Tech Stack:** BusyBox sh, `curl` (already required by installer), `awk`, systemd unit env-file overrides. Tests use the existing `scripts/test/*.sh` harness convention (function extraction + shimming + `mktemp` fixtures).

**Measured baseline (60 s window, live device):**

| Metric | Current (`ping + jq`) | Target (`curl 204 + printf`) |
|---|---:|---:|
| CPU time | 90 ms | ≤ 50 ms |
| Minor page faults | 1 129 | ≤ 600 |
| Voluntary ctxt sw | 263 | ≤ 200 |
| Daemon RSS (steady) | 700 KB | 700 KB ± 20 KB |
| Captive portal detection | ❌ | ✅ |

**Out of scope:**
- Renaming the daemon, service, or cache files (would touch every consumer; no benefit).
- Frontend chart label cosmetic update ("Ping" → "Internet response time"). Tracked as a follow-up; the cache schema is unchanged so the chart keeps working.
- DNS pre-resolution / IP pinning. The current per-call DNS lookup is amortized by the kernel; not a measured hotspot.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `scripts/usr/bin/qmanager_ping` | Modify | Daemon — probe + carrier gate + printf JSON write |
| `scripts/etc/systemd/system/qmanager-ping.service` | Modify | Add `Environment=` defaults documenting new env vars |
| `scripts/test/qmanager-ping-probe.sh` | Create | Workstation test harness — carrier gate, printf JSON, probe success/failure |

The daemon file stays a single ~250-line script. Splitting into a library was considered and rejected: the helpers are tightly coupled to the loop state (streak counters, cache file path) and only used here.

---

## Task 1: Carrier-state gate

**Files:**
- Modify: `scripts/usr/bin/qmanager_ping` (insert new helper above `do_ping`, line ~65)
- Create: `scripts/test/qmanager-ping-probe.sh` (new test harness)

**Goal:** Add a `carrier_is_up()` helper that reads `/sys/class/net/<iface>/carrier` and returns 0 (up) or 1 (down). Wire it into the main loop later — for now just add and test the helper.

- [ ] **Step 1: Create the test harness with a failing carrier-gate test**

Create `scripts/test/qmanager-ping-probe.sh`:

```bash
#!/bin/bash
# Workstation fixtures for the qmanager_ping real-internet probe.
# Run from repo root:  bash scripts/test/qmanager-ping-probe.sh
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DAEMON="$REPO_ROOT/scripts/usr/bin/qmanager_ping"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fail=0
pass_count=0
fail_count=0
ok()  { printf '  PASS  %s\n' "$1"; pass_count=$((pass_count + 1)); }
bad() { printf '  FAIL  %s\n' "$1"; fail_count=$((fail_count + 1)); fail=1; }
section() { printf '\n== %s ==\n' "$1"; }

# Extract a function from the daemon by name into a sourceable file.
# Matches "name() {" up to the matching closing "}" at column 0.
extract_fn() {
    local name="$1" src="$2" out="$3"
    awk -v name="$name" '
        $0 ~ "^"name"\\(\\) \\{" { in_fn=1 }
        in_fn { print }
        in_fn && /^\}/ { exit }
    ' "$src" > "$out"
}

# ---------------------------------------------------------------------------
section "carrier_is_up — returns 0 when sysfs file contains 1"

extract_fn carrier_is_up "$DAEMON" "$work/carrier_fn.sh"

# Build a fake sysfs file
fake_up="$work/carrier_up"
fake_dn="$work/carrier_dn"
echo 1 > "$fake_up"
echo 0 > "$fake_dn"

result=$(
    set +eu
    CARRIER_FILE="$fake_up"
    . "$work/carrier_fn.sh"
    if carrier_is_up; then echo "up"; else echo "down"; fi
)
case "$result" in
    up) ok "carrier_is_up returns 0 when file contains '1'" ;;
    *)  bad "carrier_is_up returned wrong status for up: '$result'" ;;
esac

result=$(
    set +eu
    CARRIER_FILE="$fake_dn"
    . "$work/carrier_fn.sh"
    if carrier_is_up; then echo "up"; else echo "down"; fi
)
case "$result" in
    down) ok "carrier_is_up returns 1 when file contains '0'" ;;
    *)    bad "carrier_is_up returned wrong status for down: '$result'" ;;
esac

result=$(
    set +eu
    CARRIER_FILE="$work/does_not_exist"
    . "$work/carrier_fn.sh"
    if carrier_is_up; then echo "up"; else echo "down"; fi
)
case "$result" in
    down) ok "carrier_is_up returns 1 when file is missing" ;;
    *)    bad "carrier_is_up returned wrong status for missing file: '$result'" ;;
esac

# ---------------------------------------------------------------------------
printf '\nResult: %d pass, %d fail\n' "$pass_count" "$fail_count"
exit "$fail"
```

- [ ] **Step 2: Run test to verify it fails (function not yet defined)**

Run: `bash scripts/test/qmanager-ping-probe.sh`
Expected: FAIL with empty `carrier_fn.sh` (awk extracts nothing because `carrier_is_up` doesn't exist) — sourcing an empty file is fine, but invoking `carrier_is_up` then errors with "command not found", which the test catches as `down`. Two of three cases will incorrectly pass; one will fail. Confirm test runs and at least one case reports FAIL.

- [ ] **Step 3: Add the helper to `qmanager_ping`**

Open `scripts/usr/bin/qmanager_ping`. After the `# --- File Paths ---` block (around line 50) add:

```sh
# --- Carrier state ----------------------------------------------------------
# Path to the WAN interface's carrier sysfs file. Override via env to point
# at a different netdev (e.g. eth0 in dev environments).
CARRIER_FILE="${CARRIER_FILE:-/sys/class/net/rmnet_data0/carrier}"
```

Then in the helpers section (between `do_ping` and `get_target`, around line 86) add:

```sh
# --- Check WAN-side link carrier (free, no fork) ----------------------------
# Returns: 0 = link up, 1 = link down or sysfs unreadable.
# Used as an early-exit gate before the network probe — when carrier is 0 the
# probe will fail anyway, so we skip it and write reachable=false directly.
carrier_is_up() {
    local c=
    read -r c < "$CARRIER_FILE" 2>/dev/null || return 1
    [ "$c" = "1" ]
}
```

- [ ] **Step 4: Run test to verify all three cases pass**

Run: `bash scripts/test/qmanager-ping-probe.sh`
Expected output includes:
```
== carrier_is_up — returns 0 when sysfs file contains 1 ==
  PASS  carrier_is_up returns 0 when file contains '1'
  PASS  carrier_is_up returns 1 when file contains '0'
  PASS  carrier_is_up returns 1 when file is missing
```

- [ ] **Step 5: Run the full pre-build gate**

Run: `bash scripts/test/run-all.sh`
Expected: all sections green; the new `qmanager-ping-probe.sh` is auto-discovered by section 3.

- [ ] **Step 6: Commit**

```bash
git add scripts/usr/bin/qmanager_ping scripts/test/qmanager-ping-probe.sh
git commit -m "feat(ping): add carrier_is_up helper for free WAN-link probe gate"
```

---

## Task 2: Replace `jq -n` cache write with `printf`

**Files:**
- Modify: `scripts/usr/bin/qmanager_ping` lines 100–131 (replace `write_cache` body)
- Modify: `scripts/test/qmanager-ping-probe.sh` (add JSON-fidelity test)

**Goal:** Replace the `jq -n` cache-render call with a `printf` template. The output JSON must remain byte-equivalent (modulo whitespace) to what `jq` produces — the poller and watchcat parse the same field names and types.

- [ ] **Step 1: Add a JSON-fidelity test to the harness**

Append to `scripts/test/qmanager-ping-probe.sh` before the final result block:

```bash
# ---------------------------------------------------------------------------
section "write_cache — printf JSON parses with identical scalar fields"

# Source the function. write_cache reads several globals that the loop
# normally maintains; we set them explicitly here.
extract_fn write_cache "$DAEMON" "$work/wc_fn.sh"

result_file="$work/cache.json"
(
    set +eu
    CACHE_FILE="$result_file"
    CACHE_TMP="$result_file.tmp"
    PING_TARGET_1="http://www.gstatic.com/generate_204"
    PING_TARGET_2="http://cp.cloudflare.com/"
    PING_INTERVAL=5
    RECOVERY_FLAG="$work/__no_such_flag__"
    streak_success=12
    streak_fail=0
    reachable="true"
    . "$work/wc_fn.sh"
    write_cache "185.0"
)

# Validate it parses
if ! jq -e . "$result_file" >/dev/null 2>&1; then
    bad "write_cache did not produce valid JSON"
    cat "$result_file"
else
    ok "write_cache produced valid JSON"
fi

# Validate scalars and types
check_field() {
    local field="$1" expected="$2" got
    got=$(jq -r "$field" "$result_file" 2>/dev/null)
    if [ "$got" = "$expected" ]; then
        ok "$field == $expected"
    else
        bad "$field expected '$expected' got '$got'"
    fi
}

check_field '.targets[0]' 'http://www.gstatic.com/generate_204'
check_field '.targets[1]' 'http://cp.cloudflare.com/'
check_field '.interval_sec' '5'
check_field '.last_rtt_ms' '185'
check_field '.reachable' 'true'
check_field '.streak_success' '12'
check_field '.streak_fail' '0'
check_field '.during_recovery' 'false'

# during_recovery flips when RECOVERY_FLAG file exists
recovery_file="$work/recovery_flag"
touch "$recovery_file"
(
    set +eu
    CACHE_FILE="$result_file"
    CACHE_TMP="$result_file.tmp"
    PING_TARGET_1="x"; PING_TARGET_2="y"; PING_INTERVAL=5
    RECOVERY_FLAG="$recovery_file"
    streak_success=1; streak_fail=0; reachable="true"
    . "$work/wc_fn.sh"
    write_cache "null"
)
if [ "$(jq -r '.during_recovery' "$result_file")" = "true" ]; then
    ok "during_recovery=true when recovery flag file exists"
else
    bad "during_recovery did not flip with recovery flag"
fi

# null RTT must be JSON null (not the string "null")
if [ "$(jq -r '.last_rtt_ms | type' "$result_file")" = "null" ]; then
    ok "last_rtt_ms=null is JSON null type, not string"
else
    bad "last_rtt_ms type wrong: $(jq -r '.last_rtt_ms | type' "$result_file")"
fi
```

- [ ] **Step 2: Run test to verify the new tests fail or are flaky**

Run: `bash scripts/test/qmanager-ping-probe.sh`
Expected: All 11 new assertions PASS against the existing `jq` implementation (we want this — proves the test fixture is correct against the *current* output before we change implementation). If any FAIL, the test has a bug — fix the test before proceeding.

- [ ] **Step 3: Replace `write_cache` body with printf**

In `scripts/usr/bin/qmanager_ping`, replace lines 100–131 (the entire `write_cache` function) with:

```sh
# --- Write slim JSON cache atomically ----------------------------------------
# Renders the 8-scalar schema with printf — no fork, no 322 KB jq binary load.
# Output is consumed by qmanager_poller (read_ping_data) and qmanager_watchcat.
# Field names and types are exactly as before.
write_cache() {
    local rtt="$1"          # numeric like "34.2", or the literal string "null"
    local timestamp during_recovery
    timestamp=$(date +%s)
    during_recovery="false"
    [ -f "$RECOVERY_FLAG" ] && during_recovery="true"

    # Targets and interval are bare config values; we don't escape them because
    # they are operator-controlled (env file) and never contain JSON metachars
    # in any supported configuration. If you change PING_TARGET_* to accept
    # arbitrary user input from a CGI, switch to jq here.
    printf '{"timestamp":%d,"targets":["%s","%s"],"interval_sec":%d,"last_rtt_ms":%s,"reachable":%s,"streak_success":%d,"streak_fail":%d,"during_recovery":%s}\n' \
        "$timestamp" \
        "$PING_TARGET_1" "$PING_TARGET_2" \
        "$PING_INTERVAL" \
        "$rtt" \
        "$reachable" \
        "$streak_success" "$streak_fail" \
        "$during_recovery" \
        > "$CACHE_TMP"
    mv "$CACHE_TMP" "$CACHE_FILE"
}
```

- [ ] **Step 4: Run test to verify all 11 assertions still pass**

Run: `bash scripts/test/qmanager-ping-probe.sh`
Expected: All assertions in both sections pass.

- [ ] **Step 5: Run pre-build gate**

Run: `bash scripts/test/run-all.sh`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add scripts/usr/bin/qmanager_ping scripts/test/qmanager-ping-probe.sh
git commit -m "perf(ping): render slim cache JSON with printf, drop per-cycle jq fork"
```

---

## Task 3: Add `do_real_internet_probe` HTTP-204 probe

**Files:**
- Modify: `scripts/usr/bin/qmanager_ping` (add new function next to `do_ping`)
- Modify: `scripts/test/qmanager-ping-probe.sh` (add probe tests with stubbed `curl`)

**Goal:** Implement the new probe function. It must validate response code is exactly `204` and emit RTT in milliseconds when successful. We add it side-by-side with `do_ping` for now; Task 4 wires it into the main loop.

- [ ] **Step 1: Add probe-success and probe-failure tests**

Append to `scripts/test/qmanager-ping-probe.sh`:

```bash
# ---------------------------------------------------------------------------
section "do_real_internet_probe — success and failure paths"

extract_fn do_real_internet_probe "$DAEMON" "$work/probe_fn.sh"

# Stub curl: writes "<code> <time_total>" to stdout based on exec name.
# We point PATH at $work/bin/ where stub-curl lives, so the daemon's
# `curl` resolves to our stub regardless of system curl.
mkdir -p "$work/bin"

# Stub: returns 204 + 0.18s — a healthy 204 response
cat > "$work/bin/curl" <<'STUB'
#!/bin/sh
# Stub returns the canned response captured in $STUB_BODY (default: 204 0.180000)
echo "${STUB_BODY:-204 0.180000}"
exit "${STUB_EXIT:-0}"
STUB
chmod +x "$work/bin/curl"

# Case 1: 204 + 180ms → success, RTT="180.0"
result=$(
    set +eu
    PATH="$work/bin:$PATH"
    STUB_BODY="204 0.180000"
    STUB_EXIT=0
    . "$work/probe_fn.sh"
    do_real_internet_probe "http://example/204"
    echo "exit=$?"
)
echo "$result" | grep -q '^180\.0$' && ok "200ms 204 → emits '180.0'" || bad "204 RTT extraction wrong: $result"
echo "$result" | grep -q '^exit=0$' && ok "204 → returns 0" || bad "204 did not return 0: $result"

# Case 2: HTTP 200 (captive-portal style) → failure
result=$(
    set +eu
    PATH="$work/bin:$PATH"
    STUB_BODY="200 0.040000"
    STUB_EXIT=0
    . "$work/probe_fn.sh"
    do_real_internet_probe "http://portal/login"
    echo "exit=$?"
)
echo "$result" | grep -q '^exit=1$' && ok "200 (captive portal) → returns 1" || bad "200 did not return 1: $result"
echo "$result" | grep -qE '^[0-9]' && bad "200 emitted RTT (should be silent on failure)" || ok "200 → no RTT on stdout"

# Case 3: curl exit non-zero (DNS fail, timeout) → failure
result=$(
    set +eu
    PATH="$work/bin:$PATH"
    STUB_BODY=""
    STUB_EXIT=28   # curl's CURLE_OPERATION_TIMEDOUT
    . "$work/probe_fn.sh"
    do_real_internet_probe "http://timeout/204"
    echo "exit=$?"
)
echo "$result" | grep -q '^exit=1$' && ok "curl timeout → returns 1" || bad "timeout did not return 1: $result"

# Case 4: 204 + 0s (cache hit, near-zero RTT) → emits "0.0" not crash
result=$(
    set +eu
    PATH="$work/bin:$PATH"
    STUB_BODY="204 0.000123"
    STUB_EXIT=0
    . "$work/probe_fn.sh"
    do_real_internet_probe "http://example/204"
    echo "exit=$?"
)
echo "$result" | grep -q '^0\.1$' && ok "0.000123s → emits '0.1' (rounded)" || bad "tiny RTT formatting wrong: $result"
```

- [ ] **Step 2: Run test to verify failures**

Run: `bash scripts/test/qmanager-ping-probe.sh`
Expected: New section's assertions FAIL because `do_real_internet_probe` doesn't exist yet — the extracted function file is empty, sourcing succeeds but invocation hits "command not found". Test should report 4+ FAILs in the new section.

- [ ] **Step 3: Add `do_real_internet_probe` to the daemon**

In `scripts/usr/bin/qmanager_ping`, after the `do_ping` function (around line 86), add:

```sh
# --- HTTP /generate_204 probe — validates "real internet, not portal" -------
# Returns: 0 = success (RTT in ms written to stdout), 1 = failure (silent).
#
# Why HTTP 204: a captive portal cannot fake a 204 + empty body. Portals
# intercept HTTP and serve their own login page (200 + HTML), which fails
# the explicit code check below. ICMP, TCP-SYN, and DNS all pass through
# portals — only an HTTP content check actually proves real internet.
do_real_internet_probe() {
    local target="$1"
    local code tsec
    # -fsS: fail on HTTP errors, silent except errors, show errors only.
    # -m2: 2-second total timeout (probe budget).
    # -o /dev/null: discard body — we only need code + timing.
    # -w "%{http_code} %{time_total}\n": write code + time-in-seconds.
    set -- $(curl -fsS -m2 -o /dev/null \
        -w '%{http_code} %{time_total}' "$target" 2>/dev/null)
    code="${1:-000}"
    tsec="${2:-0}"
    [ "$code" = "204" ] || return 1
    # tsec is float seconds (e.g. "0.184321"). Convert to ms with one
    # decimal — matches the precision the previous ICMP path emitted.
    awk -v t="$tsec" 'BEGIN{ printf "%.1f", t * 1000 }'
}
```

- [ ] **Step 4: Run test to verify all 4 cases pass**

Run: `bash scripts/test/qmanager-ping-probe.sh`
Expected:
```
== do_real_internet_probe — success and failure paths ==
  PASS  200ms 204 → emits '180.0'
  PASS  204 → returns 0
  PASS  200 (captive portal) → returns 1
  PASS  200 → no RTT on stdout
  PASS  curl timeout → returns 1
  PASS  0.000123s → emits '0.1' (rounded)
```

- [ ] **Step 5: Run pre-build gate**

Run: `bash scripts/test/run-all.sh`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add scripts/usr/bin/qmanager_ping scripts/test/qmanager-ping-probe.sh
git commit -m "feat(ping): add do_real_internet_probe (HTTP 204 captive-portal-aware)"
```

---

## Task 4: Wire new probe + carrier gate into main loop

**Files:**
- Modify: `scripts/usr/bin/qmanager_ping` lines 37–43 (defaults), 165–219 (main loop)

**Goal:** Switch the active probe to `do_real_internet_probe`, gate it on `carrier_is_up`, change default targets to URLs, and remove the now-dead `do_ping` function.

- [ ] **Step 1: Change default targets and add probe-timeout knob**

In `scripts/usr/bin/qmanager_ping`, replace lines 37–43:

Before:
```sh
PING_TARGET_1="${PING_TARGET_1:-google.com}"
PING_TARGET_2="${PING_TARGET_2:-cloudflare.com}"
PING_INTERVAL="${PING_INTERVAL:-5}"
FAIL_THRESHOLD="${FAIL_THRESHOLD:-3}"
RECOVER_THRESHOLD="${RECOVER_THRESHOLD:-2}"
HISTORY_SIZE="${HISTORY_SIZE:-60}"
PING_TIMEOUT=2          # BusyBox ping -W timeout in seconds
```

After:
```sh
# Targets are HTTP URLs that return 204 No Content on real internet.
# They MUST be plain http:// (not https://) — captive portals transparently
# intercept HTTP, which is precisely what this probe is designed to detect.
# Additional validated 204 endpoints: http://clients3.google.com/generate_204,
# http://detectportal.firefox.com/success.txt (returns "success" not 204).
PING_TARGET_1="${PING_TARGET_1:-http://www.gstatic.com/generate_204}"
PING_TARGET_2="${PING_TARGET_2:-http://cp.cloudflare.com/}"
PING_INTERVAL="${PING_INTERVAL:-5}"
FAIL_THRESHOLD="${FAIL_THRESHOLD:-3}"
RECOVER_THRESHOLD="${RECOVER_THRESHOLD:-2}"
HISTORY_SIZE="${HISTORY_SIZE:-60}"
```

(`PING_TIMEOUT` is removed — `curl -m2` carries it inside `do_real_internet_probe`.)

- [ ] **Step 2: Replace the probe call in the main loop**

In `scripts/usr/bin/qmanager_ping`, the main loop body currently runs lines 165–219. Replace the inner block that calls `do_ping` with a carrier-gated call to `do_real_internet_probe`. The new while-loop body (replacing existing lines 165–219) is:

```sh
    while true; do
        local target rtt rc

        if ! carrier_is_up; then
            # WAN link is down — skip the network probe entirely.
            rtt="null"
            rc=1
            qlog_debug "carrier=0, skipping probe"
        else
            target=$(get_target)
            rtt=$(do_real_internet_probe "$target")
            rc=$?
        fi

        if [ "$rc" -eq 0 ] && [ -n "$rtt" ]; then
            # --- probe succeeded ---
            streak_success=$((streak_success + 1))
            streak_fail=0
            qlog_debug "PROBE OK: ${target} rtt=${rtt}ms (streak_success=${streak_success})"
            if [ "$reachable" = "false" ] && [ "$streak_success" -ge "$RECOVER_THRESHOLD" ]; then
                prev_reachable="$reachable"
                reachable="true"
                qlog_state_change "reachable" "false" "true"
            fi
            echo "$rtt" >> "$HISTORY_FILE"
        else
            # --- probe failed (carrier down OR HTTP code != 204 OR curl error) ---
            rtt="null"
            streak_fail=$((streak_fail + 1))
            streak_success=0
            qlog_debug "PROBE FAIL: ${target:-<carrier_down>} (streak_fail=${streak_fail})"
            if [ "$reachable" = "true" ] && [ "$streak_fail" -ge "$FAIL_THRESHOLD" ]; then
                prev_reachable="$reachable"
                reachable="false"
                qlog_state_change "reachable" "true" "false"
                qlog_warn "Internet unreachable after ${FAIL_THRESHOLD} consecutive probe failures"
            fi
            echo "null" >> "$HISTORY_FILE"
        fi

        # Trim history using shell counter (no wc -l fork)
        history_count=$((history_count + 1))
        if [ "$history_count" -gt "$HISTORY_SIZE" ]; then
            tail -n "$HISTORY_SIZE" "$HISTORY_FILE" > "${HISTORY_FILE}.tmp"
            mv "${HISTORY_FILE}.tmp" "$HISTORY_FILE"
            history_count=$HISTORY_SIZE
        fi

        write_cache "$rtt"
        sleep "$PING_INTERVAL"
    done
```

- [ ] **Step 3: Delete the now-unused `do_ping` function**

In `scripts/usr/bin/qmanager_ping`, delete the `do_ping` function (the entire block from `# --- Execute a single ping against a target` through the closing `}` near line 86). Also update the `qlog_info` startup banner (currently at lines 153–158) to reflect the new probe:

Before:
```sh
    qlog_info "Targets: ${PING_TARGET_1}, ${PING_TARGET_2}"
    qlog_info "Interval: ${PING_INTERVAL}s, Fail threshold: ${FAIL_THRESHOLD}, Recover threshold: ${RECOVER_THRESHOLD}"
    qlog_info "History size: ${HISTORY_SIZE}, Timeout: ${PING_TIMEOUT}s"
```

After:
```sh
    qlog_info "Targets (HTTP 204): ${PING_TARGET_1}, ${PING_TARGET_2}"
    qlog_info "Interval: ${PING_INTERVAL}s, Fail threshold: ${FAIL_THRESHOLD}, Recover threshold: ${RECOVER_THRESHOLD}"
    qlog_info "History size: ${HISTORY_SIZE}, Carrier file: ${CARRIER_FILE}"
```

- [ ] **Step 4: Add a smoke-test that runs the daemon for 2 cycles with stubs**

Append to `scripts/test/qmanager-ping-probe.sh`:

```bash
# ---------------------------------------------------------------------------
section "main loop integration — 2 cycles with stubbed curl + carrier"

# Smoke test: run the daemon with PING_INTERVAL=1, stubbed curl, and a
# fake carrier file. After 3 seconds (≥ 2 cycles), kill it and check that
# the cache file is fresh and reachable=true.

mkdir -p "$work/run/bin"

cat > "$work/run/bin/curl" <<'STUB'
#!/bin/sh
# Always-204 stub
echo "204 0.150000"
exit 0
STUB
chmod +x "$work/run/bin/curl"

mkdir -p "$work/run/sys"
echo 1 > "$work/run/sys/carrier"

# We can't run the real /usr/bin/qmanager_ping locally because it sources
# /usr/lib/qmanager/qlog.sh. The daemon already has a fallback shim for
# missing qlog (see lines ~25–32) — we set HOME and a fake qlog dir to
# force the fallback path.
cache="$work/run/cache.json"
hist="$work/run/hist"

(
    set +eu
    PATH="$work/run/bin:$PATH"
    CARRIER_FILE="$work/run/sys/carrier"
    PING_TARGET_1="http://x/204"
    PING_TARGET_2="http://y/204"
    PING_INTERVAL=1
    FAIL_THRESHOLD=3
    RECOVER_THRESHOLD=2
    HISTORY_SIZE=10
    # Redirect cache + history + pid into the fixture
    export PATH CARRIER_FILE PING_TARGET_1 PING_TARGET_2 PING_INTERVAL \
           FAIL_THRESHOLD RECOVER_THRESHOLD HISTORY_SIZE
    # Trick the daemon's built-in CACHE_FILE/HISTORY_FILE with a custom
    # invocation: copy the script and rewrite paths.
    sed -e "s|/tmp/qmanager_ping.json|$cache|g" \
        -e "s|/tmp/qmanager_ping.json.tmp|$cache.tmp|g" \
        -e "s|/tmp/qmanager_ping_history|$hist|g" \
        -e "s|/tmp/qmanager_recovery_active|$work/run/no_recovery|g" \
        -e "s|/tmp/qmanager_ping.pid|$work/run/pid|g" \
        "$DAEMON" > "$work/run/daemon.sh"
    chmod +x "$work/run/daemon.sh"
    bash "$work/run/daemon.sh" >/dev/null 2>&1 &
    daemon_pid=$!
    sleep 3
    kill "$daemon_pid" 2>/dev/null
    wait "$daemon_pid" 2>/dev/null
)

if [ -f "$cache" ] && jq -e . "$cache" >/dev/null 2>&1; then
    ok "daemon wrote valid JSON cache after 2 cycles"
else
    bad "cache file missing or invalid"
fi

reach=$(jq -r '.reachable' "$cache" 2>/dev/null)
[ "$reach" = "true" ] && ok "reachable=true after 2 successful probes" \
                      || bad "reachable was '$reach' (expected true)"

ss=$(jq -r '.streak_success' "$cache" 2>/dev/null)
[ "$ss" -ge 2 ] 2>/dev/null && ok "streak_success >= 2" \
                            || bad "streak_success=$ss (expected >=2)"

# Now flip carrier to 0, run another cycle, expect reachable to NOT change
# yet (FAIL_THRESHOLD=3) but streak_fail to increment.
echo 0 > "$work/run/sys/carrier"
(
    set +eu
    PATH="$work/run/bin:$PATH"
    CARRIER_FILE="$work/run/sys/carrier"
    PING_TARGET_1="http://x/204"
    PING_TARGET_2="http://y/204"
    PING_INTERVAL=1
    FAIL_THRESHOLD=3
    RECOVER_THRESHOLD=2
    HISTORY_SIZE=10
    export PATH CARRIER_FILE PING_TARGET_1 PING_TARGET_2 PING_INTERVAL \
           FAIL_THRESHOLD RECOVER_THRESHOLD HISTORY_SIZE
    bash "$work/run/daemon.sh" >/dev/null 2>&1 &
    daemon_pid=$!
    sleep 2
    kill "$daemon_pid" 2>/dev/null
    wait "$daemon_pid" 2>/dev/null
)

last_rtt_type=$(jq -r '.last_rtt_ms | type' "$cache" 2>/dev/null)
[ "$last_rtt_type" = "null" ] && ok "last_rtt_ms is null when carrier=0" \
                              || bad "last_rtt_ms type = '$last_rtt_type' (expected null)"
```

- [ ] **Step 5: Run all tests**

Run: `bash scripts/test/qmanager-ping-probe.sh`
Expected: every section reports PASS, no FAILs.

- [ ] **Step 6: Run pre-build gate**

Run: `bash scripts/test/run-all.sh`
Expected: green across all sections.

- [ ] **Step 7: Commit**

```bash
git add scripts/usr/bin/qmanager_ping scripts/test/qmanager-ping-probe.sh
git commit -m "feat(ping): switch to HTTP 204 probe with carrier-gated short-circuit"
```

---

## Task 5: Surface new env vars in the systemd unit

**Files:**
- Modify: `scripts/etc/systemd/system/qmanager-ping.service`

**Goal:** Document the carrier-file and target overrides directly in the unit so `journalctl -u qmanager-ping` and `systemctl cat qmanager-ping` show the configurable knobs without operators having to read the daemon source. The `EnvironmentFile=-` already lets them override at `/etc/qmanager/environment`; this just makes the knobs discoverable.

- [ ] **Step 1: Add Environment lines to the unit**

Edit `scripts/etc/systemd/system/qmanager-ping.service`. Replace the `[Service]` section with:

```
[Service]
Type=simple
ExecStart=/usr/bin/qmanager_ping
EnvironmentFile=-/etc/qmanager/environment
# Documented defaults — override in /etc/qmanager/environment
Environment=PING_TARGET_1=http://www.gstatic.com/generate_204
Environment=PING_TARGET_2=http://cp.cloudflare.com/
Environment=PING_INTERVAL=5
Environment=FAIL_THRESHOLD=3
Environment=RECOVER_THRESHOLD=2
Environment=HISTORY_SIZE=60
Environment=CARRIER_FILE=/sys/class/net/rmnet_data0/carrier
TimeoutStopSec=10
Restart=on-failure
RestartSec=5s
StartLimitIntervalSec=3600
StartLimitBurst=5
```

(`Environment=` lines have lower priority than `EnvironmentFile=`; operator overrides still win.)

- [ ] **Step 2: Run pre-build gate to verify unit syntax**

Run: `bash scripts/test/run-all.sh`
Expected: green. The CRLF section flags any LF/CRLF issues with the unit file.

- [ ] **Step 3: Commit**

```bash
git add scripts/etc/systemd/system/qmanager-ping.service
git commit -m "chore(ping): document new probe env vars in systemd unit"
```

---

## Task 6: On-device verification

**Files:** none (operational task — no source changes)

**Goal:** Build, deploy, and verify the new probe behaves correctly on the live device. Includes a captive-portal simulation to prove the qualitative win.

- [ ] **Step 1: Build the package**

Run: `bun run package`
Expected: package builds; pre-build gate runs green; tarball lands in `dist/`.

- [ ] **Step 2: Deploy to the live device**

Run from a shell with SSH access:
```bash
scp -O dist/qmanager-*.tar.gz root@192.168.225.1:/tmp/
ssh root@192.168.225.1 'cd / && tar xzf /tmp/qmanager-*.tar.gz && /usr/bin/qmanager_install --update'
```
Expected: installer reports `Step N/M` lines; service restart at the end is clean.

- [ ] **Step 3: Verify the daemon is running and emitting fresh cache**

Run on device:
```sh
systemctl status qmanager-ping
journalctl -u qmanager-ping -n 30 --no-pager
cat /tmp/qmanager_ping.json
```
Expected:
- `systemctl status` shows `active (running)`.
- Journal shows `Targets (HTTP 204): http://www.gstatic.com/generate_204, http://cp.cloudflare.com/`.
- `/tmp/qmanager_ping.json` is well-formed JSON; `targets` array contains the URLs; `reachable=true`; `last_rtt_ms` is a number around 100–250.

- [ ] **Step 4: Confirm CPU drop matches the benchmark target**

Run on device:
```sh
PID=$(pgrep -f /usr/bin/qmanager_ping)
awk -v hz="$(getconf CLK_TCK)" 'NR==1{
    n=length($0); for(i=n;i>=1;i--) if(substr($0,i,1)==")"){r=substr($0,i+2);break}
    nf=split(r,a," "); printf "u+s = %d ms\n",(a[12]+a[13])*1000/hz
}' /proc/$PID/stat
sleep 60
awk -v hz="$(getconf CLK_TCK)" 'NR==1{
    n=length($0); for(i=n;i>=1;i--) if(substr($0,i,1)==")"){r=substr($0,i+2);break}
    nf=split(r,a," "); printf "u+s = %d ms\n",(a[12]+a[13])*1000/hz
}' /proc/$PID/stat
```
Expected: delta ≤ 50 ms across the 60 s window (current baseline is ~90 ms).

- [ ] **Step 5: Verify captive-portal-style failure path**

Run on device:
```sh
PING_TARGET_1='http://example.com/' \
PING_TARGET_2='http://example.com/' \
systemctl set-environment PING_TARGET_1=http://example.com/
systemctl set-environment PING_TARGET_2=http://example.com/
systemctl restart qmanager-ping
sleep 20
cat /tmp/qmanager_ping.json
```
`http://example.com/` returns HTTP 200, mimicking what a captive portal would. Expected: after `FAIL_THRESHOLD=3` cycles (~15 s) the cache shows `reachable=false`. This is the captive-portal detection working.

Reset:
```sh
systemctl unset-environment PING_TARGET_1
systemctl unset-environment PING_TARGET_2
systemctl restart qmanager-ping
sleep 10
jq -r '.reachable' /tmp/qmanager_ping.json
```
Expected: `true` again.

- [ ] **Step 6: Verify poller and watchcat keep working**

Run on device:
```sh
jq '.connectivity' /tmp/qmanager_status.json
journalctl -u qmanager-watchcat -n 10 --no-pager
```
Expected: `qmanager_status.json.connectivity` shows `internet_available=true`, `latency` populated, no schema errors. Watchcat journal has no parse errors.

- [ ] **Step 7: Commit a release note**

Edit `RELEASE_NOTES.md` (top of file, under the next pending version). Add under "New Features":

```
- Internet-reachability check now uses HTTP `204` content validation instead of
  ICMP ping — captive portals (e.g. tethered hotspots, guest Wi-Fi backhaul) are
  now correctly detected as "no real internet" rather than reporting a false
  positive. Per-minute CPU drops by ~55% on RM520N-GL because the per-cycle
  `jq` invocation is replaced with a `printf`-rendered cache.
```

```bash
git add RELEASE_NOTES.md
git commit -m "docs: release note for HTTP 204 internet probe"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Implemented in |
|---|---|
| Reliable real-internet check (captive-portal aware) | Task 3 (probe), Task 4 (wiring), Task 6 step 5 (verification) |
| Lower CPU than current ping+jq | Task 2 (printf), Task 6 step 4 (verification) |
| Backward-compatible cache schema | Task 2 (test asserts identical fields), Task 6 step 6 (poller verification) |
| Carrier-state short-circuit | Task 1 (helper), Task 4 (wiring) |
| Operator overrideable targets | Task 4 step 1 (env-var defaults preserved), Task 5 (unit `Environment=`) |
| TDD-style implementation | Tasks 1–4 each follow test → fail → implement → pass |

**Placeholder scan:** No "TBD", "TODO", "implement later", "similar to Task N" or "add appropriate validation" anywhere. All shell + test code is complete and copy-pasteable.

**Type / name consistency:**
- `carrier_is_up` is the function name in Task 1 and Task 4. ✓
- `do_real_internet_probe` is the function name in Task 3 and Task 4. ✓
- `CARRIER_FILE` env var is defined in Task 1, used by tests in Task 1 + 4, surfaced in unit in Task 5. ✓
- JSON field names (`timestamp`, `targets`, `interval_sec`, `last_rtt_ms`, `reachable`, `streak_success`, `streak_fail`, `during_recovery`) match the existing schema in `qmanager_poller` lines 1056–1060. ✓
- `RECOVERY_FLAG`, `CACHE_FILE`, `CACHE_TMP`, `HISTORY_FILE`, `PING_TARGET_1`, `PING_TARGET_2` all preserved from current code. ✓

---

**Plan complete and saved to `docs/plans/2026-05-08-real-internet-probe.md`.**
