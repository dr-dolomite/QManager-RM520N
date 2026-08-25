# Phase 2 Ping Profile UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the Phase 1 Rust ping daemon's tri-state connectivity and profile-driven probe cadence to end users via a System Settings card and a third state on the Network Status Internet badge.

**Architecture:** Three additive layers — a new CGI endpoint that reads/writes `/etc/qmanager/ping_profile.json` and pokes the daemon's reload flag; an additive extension to `qmanager_poller` that forwards 8 new keys into `/tmp/qmanager_status.json`'s `connectivity` block (existing fields unchanged); two new frontend components plus a modification to the existing Network Status badge.

**Tech Stack:** POSIX sh + jq (CGI, poller, tests). TypeScript + React + ShadCN UI + React Query + sonner (frontend). Direct file writes (no sudo — `/etc/qmanager/` is www-data-owned).

**Spec:** `docs/superpowers/specs/2026-05-09-ping-profile-ui-design.md`

---

## File Map

| File | Action | Owner |
|---|---|---|
| `scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh` | CREATE | Task 1 |
| `scripts/test/ping-profile-cgi.sh` | CREATE | Task 1 |
| `scripts/usr/bin/qmanager_poller` | MODIFY (additive) | Tasks 2 + 3 |
| `types/modem-status.ts` | MODIFY (additive) | Task 4 |
| `hooks/use-ping-profile.ts` | CREATE | Task 5 |
| `components/system-settings/connectivity-sensitivity-card.tsx` | CREATE | Task 6 |
| `components/system-settings/system-settings.tsx` | MODIFY (one-line add) | Task 7 |
| `components/dashboard/network-status.tsx` | MODIFY (badge logic) | Task 8 |

**Naming note:** the spec proposed a new TS type `ConnectivityState`, but `types/modem-status.ts:328` already exports a type by that exact name (used by the derived `connectivity.status` field). To avoid the collision the plan uses **`PingTriState`** for the new daemon tri-state (`"connected" | "limited" | "disconnected" | "unknown"`).

---

## Task 1: CGI endpoint + smoke test (TDD)

**Files:**
- Create: `scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh`
- Create: `scripts/test/ping-profile-cgi.sh`

**Why TDD here:** the CGI is testable in isolation — invoke directly with `REQUEST_METHOD=GET` env vars and `_SKIP_AUTH=1` to bypass session cookies. The test exercises GET, POST (each profile), invalid-profile rejection, and missing-action rejection. We write the test first, watch it fail, then implement.

- [ ] **Step 1: Write the failing smoke test**

Create `scripts/test/ping-profile-cgi.sh`:

```sh
#!/bin/sh
# Smoke test for /cgi-bin/quecmanager/settings/ping_profile.sh
# Invokes the CGI script directly (no HTTP / no auth) and validates output.
#
# Run on the device or on a host with the script + dependencies present.
# Requires: jq.
#
# Test files use /tmp paths so this is non-destructive to the running daemon.
set -eu

if ! command -v jq >/dev/null; then
    echo "FAIL: jq not found" >&2
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CGI="$REPO_ROOT/scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh"

if [ ! -f "$CGI" ]; then
    echo "FAIL: CGI script not found at $CGI" >&2
    exit 1
fi

# Use a sandboxed config + reload flag so the test doesn't touch live state
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT
export PING_PROFILE_CONFIG="$TEST_DIR/ping_profile.json"
export PING_PROFILE_RELOAD_FLAG="$TEST_DIR/ping_profile_reload"
export _SKIP_AUTH=1

# Stub cgi_base.sh so the CGI runs without the device's qlog/auth setup
STUB_LIB="$TEST_DIR/usr/lib/qmanager"
mkdir -p "$STUB_LIB"
cat > "$STUB_LIB/cgi_base.sh" <<'STUB'
[ -n "$_CGI_BASE_LOADED" ] && return 0
_CGI_BASE_LOADED=1
qlog_init()  { :; }
qlog_debug() { :; }
qlog_info()  { :; }
qlog_warn()  { :; }
qlog_error() { :; }
cgi_headers()        { :; }
cgi_handle_options() { :; }
cgi_read_post() {
    POST_DATA=""
    if [ -n "${CONTENT_LENGTH:-}" ] && [ "$CONTENT_LENGTH" -gt 0 ]; then
        POST_DATA=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null)
    fi
}
cgi_success() { printf '{"success":true}\n'; }
cgi_error()   { printf '{"success":false,"error":"%s","message":"%s"}\n' "$1" "$2"; }
STUB

# Re-execute the CGI with our stub library on PATH for sourcing.
# The CGI sources /usr/lib/qmanager/cgi_base.sh — we override via env.
run_cgi() {
    # shellcheck disable=SC2086
    env REQUEST_METHOD="$1" \
        CONTENT_TYPE="${2:-}" \
        CONTENT_LENGTH="${3:-0}" \
        QM_LIB_DIR="$STUB_LIB" \
        PING_PROFILE_CONFIG="$PING_PROFILE_CONFIG" \
        PING_PROFILE_RELOAD_FLAG="$PING_PROFILE_RELOAD_FLAG" \
        _SKIP_AUTH=1 \
        sh "$CGI"
}

PASS=0
FAIL=0
pass() { PASS=$((PASS+1)); echo "PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "FAIL: $1" >&2; }

# Test 1: GET with no config file returns relaxed default
rm -f "$PING_PROFILE_CONFIG"
RES=$(run_cgi GET)
if echo "$RES" | jq -e '.success == true and .settings.profile == "relaxed"' >/dev/null; then
    pass "GET with no config returns relaxed default"
else
    fail "GET with no config returns relaxed default — got: $RES"
fi

# Test 2: POST each valid profile, verify file + reload flag
for p in sensitive regular relaxed quiet; do
    rm -f "$PING_PROFILE_RELOAD_FLAG"
    BODY="{\"action\":\"save_settings\",\"profile\":\"$p\"}"
    LEN=${#BODY}
    RES=$(printf '%s' "$BODY" | run_cgi POST application/json "$LEN")
    if ! echo "$RES" | jq -e '.success == true' >/dev/null; then
        fail "POST profile=$p — got: $RES"
        continue
    fi
    if [ "$(jq -r .profile "$PING_PROFILE_CONFIG")" != "$p" ]; then
        fail "POST profile=$p — config not updated"
        continue
    fi
    if [ ! -f "$PING_PROFILE_RELOAD_FLAG" ]; then
        fail "POST profile=$p — reload flag not touched"
        continue
    fi
    pass "POST profile=$p (config+flag)"
done

# Test 3: GET after POST returns the saved profile
RES=$(run_cgi GET)
if echo "$RES" | jq -e '.success == true and .settings.profile == "quiet"' >/dev/null; then
    pass "GET after POST reflects saved profile"
else
    fail "GET after POST — got: $RES"
fi

# Test 4: Invalid profile rejected
BODY='{"action":"save_settings","profile":"bogus"}'
LEN=${#BODY}
RES=$(printf '%s' "$BODY" | run_cgi POST application/json "$LEN")
if echo "$RES" | jq -e '.success == false and .error == "invalid_profile"' >/dev/null; then
    pass "Invalid profile rejected"
else
    fail "Invalid profile rejected — got: $RES"
fi

# Test 5: Missing action rejected
BODY='{}'
LEN=${#BODY}
RES=$(printf '%s' "$BODY" | run_cgi POST application/json "$LEN")
if echo "$RES" | jq -e '.success == false' >/dev/null; then
    pass "Missing action rejected"
else
    fail "Missing action rejected — got: $RES"
fi

# Test 6: Atomic write — verify no .tmp file lingers after success
if [ -f "${PING_PROFILE_CONFIG}.tmp" ]; then
    fail "Atomic write — .tmp file lingers after success"
else
    pass "Atomic write — no .tmp file lingers"
fi

# Test 7: Malformed JSON config falls back to relaxed on GET
echo 'this is not valid json' > "$PING_PROFILE_CONFIG"
RES=$(run_cgi GET)
if echo "$RES" | jq -e '.success == true and .settings.profile == "relaxed"' >/dev/null; then
    pass "GET with malformed config falls back to relaxed"
else
    fail "GET with malformed config — got: $RES"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Make the test executable, run it, expect failure**

```sh
chmod +x scripts/test/ping-profile-cgi.sh
bash scripts/test/ping-profile-cgi.sh
```

Expected: `FAIL: CGI script not found at ...` (the script doesn't exist yet — that's the failing-test moment).

- [ ] **Step 3: Implement the CGI script**

Create `scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh`:

```sh
#!/bin/sh
# =============================================================================
# ping_profile.sh — CGI Endpoint: Connectivity Sensitivity Profile (GET + POST)
# =============================================================================
# GET:  Returns current ping profile selection.
# POST: Saves profile selection (one of sensitive/regular/relaxed/quiet),
#       writes /etc/qmanager/ping_profile.json atomically, pokes the daemon's
#       reload flag at /tmp/qmanager_ping_reload.
#
# The daemon's for_profile() map is the single source of truth for the actual
# threshold values — this CGI writes only the profile name, not the thresholds.
#
# Endpoint: GET/POST /cgi-bin/quecmanager/settings/ping_profile.sh
# Install location: /www/cgi-bin/quecmanager/settings/ping_profile.sh
# =============================================================================

# Allow tests / dev override of the lib dir, falling back to the real one
LIB_DIR="${QM_LIB_DIR:-/usr/lib/qmanager}"
. "$LIB_DIR/cgi_base.sh"

qlog_init "cgi_ping_profile"
cgi_headers
cgi_handle_options

CONFIG="${PING_PROFILE_CONFIG:-/etc/qmanager/ping_profile.json}"
RELOAD_FLAG="${PING_PROFILE_RELOAD_FLAG:-/tmp/qmanager_ping_reload}"

# =============================================================================
# GET — Fetch current profile
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching ping profile selection"

    profile="relaxed"
    if [ -f "$CONFIG" ]; then
        # jq returns "null" for missing keys; map that and any malformed-JSON
        # error back to the safe default.
        v=$(jq -r '.profile // empty' "$CONFIG" 2>/dev/null) || v=""
        case "$v" in
            sensitive|regular|relaxed|quiet) profile="$v" ;;
            *) qlog_warn "ping_profile.json had unexpected profile value '$v', returning default" ;;
        esac
    fi

    jq -n --arg profile "$profile" '{success: true, settings: {profile: $profile}}'
    exit 0
fi

# =============================================================================
# POST — Save profile selection
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty' 2>/dev/null)
    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    if [ "$ACTION" != "save_settings" ]; then
        cgi_error "unknown_action" "Unknown action: $ACTION"
        exit 0
    fi

    new_profile=$(printf '%s' "$POST_DATA" | jq -r '.profile // empty' 2>/dev/null)
    case "$new_profile" in
        sensitive|regular|relaxed|quiet) ;;
        *)
            cgi_error "invalid_profile" "profile must be one of: sensitive, regular, relaxed, quiet"
            exit 0
            ;;
    esac

    mkdir -p "$(dirname "$CONFIG")"

    # Atomic write: jq into .tmp, then mv. Avoids zero-byte config on jq failure.
    if ! jq -n --arg profile "$new_profile" '{profile: $profile}' > "${CONFIG}.tmp" 2>/dev/null; then
        rm -f "${CONFIG}.tmp"
        cgi_error "write_failed" "Failed to generate config JSON"
        exit 0
    fi

    if ! mv "${CONFIG}.tmp" "$CONFIG"; then
        rm -f "${CONFIG}.tmp"
        cgi_error "write_failed" "Failed to write config file"
        exit 0
    fi

    qlog_info "Ping profile saved: $new_profile"

    # Poke daemon to reload at the start of its next cycle.
    # Failure is non-fatal — daemon still has the old config; user can retry.
    if ! touch "$RELOAD_FLAG" 2>/dev/null; then
        qlog_warn "Failed to touch reload flag at $RELOAD_FLAG (daemon may not reload until restart)"
    fi

    cgi_success
    exit 0
fi

# =============================================================================
# Unsupported method
# =============================================================================
cgi_error "method_not_allowed" "Only GET and POST are supported"
```

- [ ] **Step 4: Make the CGI executable, ensure LF line endings**

```sh
chmod +x scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh
# Strip any CRLF in case Windows-built tools added \r
sed -i 's/\r$//' scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh
sed -i 's/\r$//' scripts/test/ping-profile-cgi.sh
```

- [ ] **Step 5: Run the smoke test, expect all PASS**

```sh
bash scripts/test/ping-profile-cgi.sh
```

Expected output ends with:
```
Results: 9 passed, 0 failed
```

If anything fails, fix the CGI and rerun. Do not move on until all 9 tests pass.

- [ ] **Step 6: Commit**

```sh
git add scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh scripts/test/ping-profile-cgi.sh
git commit -m "feat(cgi): add ping_profile.sh endpoint for connectivity sensitivity selection

GET returns currently-saved profile from /etc/qmanager/ping_profile.json
(falls back to 'relaxed' if missing/malformed). POST validates profile
against the four named presets (sensitive/regular/relaxed/quiet), writes
atomically via .tmp+mv, and pokes /tmp/qmanager_ping_reload so the Rust
daemon picks up the change on its next cycle. Mirrors sms_alerts.sh
patterns; no sudo (writes to www-data-owned /etc/qmanager/).

Adds direct-invocation smoke test (scripts/test/ping-profile-cgi.sh)
covering GET defaults, all four valid POSTs, invalid-profile rejection,
missing-action rejection, atomic-write cleanup, and malformed-config
fallback. Test sandboxes paths via env vars so it doesn't touch live state."
```

---

## Task 2: Poller forwarding — extend `read_ping_data()`

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller` (around lines 985-1120)

**Why no automated test:** the poller is a long-running daemon that the test harness folder doesn't unit-test today. We rely on (a) the existing `scripts/test/poller-phase-a.sh` etc. continuing to pass, and (b) manual SSH verification after deploy.

- [ ] **Step 1: Locate the `@tsv` extract block**

Run:
```sh
grep -n '_pdata=$(jq' scripts/usr/bin/qmanager_poller
```

Expected: one match around line 1055. The block is inside `read_ping_data()` and currently extracts 5 fields.

- [ ] **Step 2: Extend the `@tsv` extract to 13 fields**

Find this block (around lines 1054-1067):
```sh
    # Step A: Extract slim scalar fields from ping JSON (single jq call)
    # ping.json no longer carries stats/history — those are computed here from raw file.
    local _pdata
    _pdata=$(jq -r '[
        ((.reachable) | if . == null then "null" else tostring end),
        ((.last_rtt_ms) | if . == null then "null" else tostring end),
        ((.during_recovery) | if . == null then "false" else tostring end),
        ((.interval_sec) | if . == null then "5" else tostring end),
        (.targets[0] // "")
    ] | @tsv' "$PING_CACHE" 2>/dev/null)

    conn_internet_available=$(printf '%s' "$_pdata" | cut -f1)
    conn_latency=$(printf '%s' "$_pdata" | cut -f2)
    conn_during_recovery=$(printf '%s' "$_pdata" | cut -f3)
    conn_history_interval=$(printf '%s' "$_pdata" | cut -f4)
    conn_ping_target=$(printf '%s' "$_pdata" | cut -f5)
```

Replace the entire block with:

```sh
    # Step A: Extract slim scalar fields from ping JSON (single jq call)
    # ping.json no longer carries stats/history — those are computed here from raw file.
    # Phase 2 additions: tri-state connectivity + runtime profile/threshold fields.
    local _pdata
    _pdata=$(jq -r '[
        ((.reachable) | if . == null then "null" else tostring end),
        ((.last_rtt_ms) | if . == null then "null" else tostring end),
        ((.during_recovery) | if . == null then "false" else tostring end),
        ((.interval_sec) | if . == null then "5" else tostring end),
        (.targets[0] // ""),
        (.connectivity // "unknown"),
        ((.limited_reason) | if . == null then "null" else tostring end),
        (.down_reason // "null"),
        ((.streak_limited) | if . == null then "0" else tostring end),
        (.profile // "unknown"),
        ((.fail_secs) | if . == null then "0" else tostring end),
        ((.recover_secs) | if . == null then "0" else tostring end),
        ((.intercept_secs) | if . == null then "0" else tostring end)
    ] | @tsv' "$PING_CACHE" 2>/dev/null)

    conn_internet_available=$(printf '%s' "$_pdata" | cut -f1)
    conn_latency=$(printf '%s' "$_pdata" | cut -f2)
    conn_during_recovery=$(printf '%s' "$_pdata" | cut -f3)
    conn_history_interval=$(printf '%s' "$_pdata" | cut -f4)
    conn_ping_target=$(printf '%s' "$_pdata" | cut -f5)
    conn_connectivity=$(printf '%s' "$_pdata" | cut -f6)
    conn_limited_reason=$(printf '%s' "$_pdata" | cut -f7)
    conn_down_reason=$(printf '%s' "$_pdata" | cut -f8)
    conn_streak_limited=$(printf '%s' "$_pdata" | cut -f9)
    conn_profile=$(printf '%s' "$_pdata" | cut -f10)
    conn_fail_secs=$(printf '%s' "$_pdata" | cut -f11)
    conn_recover_secs=$(printf '%s' "$_pdata" | cut -f12)
    conn_intercept_secs=$(printf '%s' "$_pdata" | cut -f13)
```

- [ ] **Step 3: Extend the missing-file fallback (around line 988)**

Find this block (the early-return when `$PING_CACHE` doesn't exist):
```sh
    # Reset to defaults if ping file missing or stale
    if [ ! -f "$PING_CACHE" ]; then
        conn_internet_available="null"
        conn_status="unknown"
        conn_latency="null"
        conn_avg_latency="null"
        conn_min_latency="null"
        conn_max_latency="null"
        conn_jitter="null"
        conn_packet_loss=0
        conn_ping_target=""
        conn_history="[]"
        conn_during_recovery="false"
        _ping_stale_since=0
        return
    fi
```

Add 8 new defaults before the `return`:

```sh
    # Reset to defaults if ping file missing or stale
    if [ ! -f "$PING_CACHE" ]; then
        conn_internet_available="null"
        conn_status="unknown"
        conn_latency="null"
        conn_avg_latency="null"
        conn_min_latency="null"
        conn_max_latency="null"
        conn_jitter="null"
        conn_packet_loss=0
        conn_ping_target=""
        conn_history="[]"
        conn_during_recovery="false"
        conn_connectivity="unknown"
        conn_limited_reason="null"
        conn_down_reason="null"
        conn_streak_limited=0
        conn_profile="unknown"
        conn_fail_secs=0
        conn_recover_secs=0
        conn_intercept_secs=0
        _ping_stale_since=0
        return
    fi
```

- [ ] **Step 4: Extend the stale-data fallback (around line 1012)**

Find the block inside `if [ "$age" -gt "$PING_STALE_THRESHOLD" ]; then` that resets connectivity defaults. It currently sets the same fields as Step 3 (without `_ping_stale_since=0`). Add the same 8 new defaults after `conn_during_recovery="false"`:

Find:
```sh
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
```

Replace with:
```sh
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
            conn_connectivity="unknown"
            conn_limited_reason="null"
            conn_down_reason="null"
            conn_streak_limited=0
            conn_profile="unknown"
            conn_fail_secs=0
            conn_recover_secs=0
            conn_intercept_secs=0
```

(Do NOT touch the rest of the stale-data block — only insert the 8 new lines after `conn_during_recovery="false"`.)

- [ ] **Step 5: Verify the script still parses**

```sh
sh -n scripts/usr/bin/qmanager_poller && echo "OK"
```

Expected: `OK`. If you get a syntax error, check the indentation and brace matching.

- [ ] **Step 6: Strip CRLF (Windows safety)**

```sh
sed -i 's/\r$//' scripts/usr/bin/qmanager_poller
```

- [ ] **Step 7: Commit**

```sh
git add scripts/usr/bin/qmanager_poller
git commit -m "feat(poller): extract 8 new fields from qmanager_ping.json into read_ping_data

Adds tri-state connectivity (connectivity, limited_reason, down_reason,
streak_limited) and runtime profile/threshold values (profile, fail_secs,
recover_secs, intercept_secs) to the @tsv extract. Same single-jq cost
per cycle. Missing-file and stale-data fallbacks reset all 8 new fields
to safe defaults so the badge cleanly degrades to muted 'Internet'
whenever the daemon is dead.

This is half of the poller forwarding work — the next commit wires the
extracted vars into the status.json builder."
```

---

## Task 3: Poller forwarding — extend `connectivity:` block in status.json builder

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller` (around lines 1576 and the surrounding `--arg` bindings)

- [ ] **Step 1: Locate the jq variable bindings for the connectivity block**

Run:
```sh
grep -n 'arg inet\|arg conn_st\|arg pkt_loss\|arg during_rec' scripts/usr/bin/qmanager_poller
```

These bindings are listed alongside many others in the big jq invocation that builds `/tmp/qmanager_status.json`. Find the section where they're declared (search for `--arg inet "$conn_internet_available"`):

```sh
grep -n 'arg inet "$conn_internet_available"' scripts/usr/bin/qmanager_poller
```

- [ ] **Step 2: Add 8 new jq variable bindings**

Find the existing connectivity-related `--arg` lines. They look like:
```sh
        --arg inet "$conn_internet_available" \
        --arg conn_st "$conn_status" \
        --arg lat "$conn_latency" \
        ...
        --arg during_rec "$conn_during_recovery" \
```

After the last existing connectivity binding (`--arg during_rec ...`), add 8 new bindings. Use `--arg` for strings and `--argjson` for numerics (jq's numeric-vs-string handling matters for the resulting JSON shape):

```sh
        --arg conn_state "$conn_connectivity" \
        --argjson conn_limited_reason "$conn_limited_reason" \
        --arg conn_down_reason "$conn_down_reason" \
        --argjson conn_streak_limited "$conn_streak_limited" \
        --arg conn_profile "$conn_profile" \
        --argjson conn_fail_secs "$conn_fail_secs" \
        --argjson conn_recover_secs "$conn_recover_secs" \
        --argjson conn_intercept_secs "$conn_intercept_secs" \
```

**Rationale for `--argjson`:** `conn_limited_reason` carries either a string `"null"` (literal characters n-u-l-l) or a numeric string. With `--argjson`, the literal `"null"` becomes JSON null and the number string becomes a JSON number — matching the spec's `int|null` type. `conn_down_reason` stays as `--arg` because it's always a string ("null" or "carrier_down" etc.) and the receiver knows to treat the string `"null"` as the absence sentinel; this matches the existing pattern for fields like `conn_latency` which uses `--arg lat`. To make `down_reason` a true JSON null on absence, see Step 3's jq expression.

- [ ] **Step 3: Add 8 new keys inside the `connectivity:` block**

Find the connectivity block in the jq script:
```jq
            connectivity: {
                internet_available: $inet, status: $conn_st,
                latency_ms: $lat, avg_latency_ms: $avg_lat,
                min_latency_ms: $min_lat, max_latency_ms: $max_lat,
                jitter_ms: $jit, packet_loss_pct: $pkt_loss,
                ping_target: $ping_tgt, latency_history: $lat_hist,
                history_interval_sec: $hist_int, history_size: $hist_size,
                during_recovery: $during_rec
            },
```

Replace with:
```jq
            connectivity: {
                internet_available: $inet, status: $conn_st,
                latency_ms: $lat, avg_latency_ms: $avg_lat,
                min_latency_ms: $min_lat, max_latency_ms: $max_lat,
                jitter_ms: $jit, packet_loss_pct: $pkt_loss,
                ping_target: $ping_tgt, latency_history: $lat_hist,
                history_interval_sec: $hist_int, history_size: $hist_size,
                during_recovery: $during_rec,
                state: $conn_state,
                limited_reason: $conn_limited_reason,
                down_reason: (if $conn_down_reason == "null" then null else $conn_down_reason end),
                streak_limited: $conn_streak_limited,
                profile: $conn_profile,
                fail_secs: $conn_fail_secs,
                recover_secs: $conn_recover_secs,
                intercept_secs: $conn_intercept_secs
            },
```

The inline `(if ... then null else ... end)` for `down_reason` converts the literal string `"null"` into a real JSON null. `state` and `profile` stay as strings (`"unknown"` is a meaningful sentinel, not absence).

- [ ] **Step 4: Verify the script still parses**

```sh
sh -n scripts/usr/bin/qmanager_poller && echo "OK"
```

Expected: `OK`.

- [ ] **Step 5: Strip CRLF (Windows safety)**

```sh
sed -i 's/\r$//' scripts/usr/bin/qmanager_poller
```

- [ ] **Step 6: Commit**

```sh
git add scripts/usr/bin/qmanager_poller
git commit -m "feat(poller): forward 8 new ping fields into status.json connectivity block

Adds state, limited_reason, down_reason, streak_limited, profile,
fail_secs, recover_secs, intercept_secs to the connectivity block in
/tmp/qmanager_status.json. Numeric fields use --argjson so the JSON
shape matches the spec (int|null vs string). down_reason converts the
literal string 'null' (poller's missing-data sentinel) to a real JSON
null inside the jq expression.

internet_available and every existing field stay byte-identical, so
watchcat / Discord bot / any other consumer keep working unchanged."
```

---

## Task 4: TypeScript type extensions

**Files:**
- Modify: `types/modem-status.ts` (around lines 328-360)

- [ ] **Step 1: Read the existing type definitions to confirm placement**

```sh
grep -n 'export type ConnectivityState\|export interface ConnectivityStatus\|history_size:' types/modem-status.ts
```

Expected: existing `ConnectivityState` type at line ~328, `ConnectivityStatus` interface starting line ~335, ending around line 360.

- [ ] **Step 2: Add `PingTriState` and `PingProfile` types right above the existing `ConnectivityState` declaration (line ~328)**

Insert this block immediately before the `export type ConnectivityState =` line:

```ts
/** Daemon's authoritative tri-state connectivity outcome (from qmanager_ping.json's `connectivity` field). */
export type PingTriState = "connected" | "limited" | "disconnected" | "unknown";

/** User-selectable ping daemon sensitivity profile. */
export type PingProfile = "sensitive" | "regular" | "relaxed" | "quiet";

/** Display-order list of the four named profiles. */
export const PING_PROFILES: readonly PingProfile[] = [
  "sensitive",
  "regular",
  "relaxed",
  "quiet",
] as const;

```

(Keep the existing `ConnectivityState` type unchanged — it is a different enum used for the derived `status` field.)

- [ ] **Step 3: Extend `ConnectivityStatus` with 8 new fields**

Find the closing brace of the existing `ConnectivityStatus` interface. The last existing field is `during_recovery: boolean;`. Add the 8 new fields just before the closing `}`:

```ts
  /** Phase 2 — daemon's tri-state connectivity outcome. null means the field is missing
      from status.json (rolling-upgrade fallback). */
  state: PingTriState | null;
  /** When state == "limited", the HTTP code seen by the probe (e.g., 200, 302). null otherwise. */
  limited_reason: number | null;
  /** When state == "disconnected", the failure reason: "carrier_down" | "timeout" | "refused"
      | "reset" | "dns" | "malformed". null otherwise. */
  down_reason: string | null;
  /** Consecutive limited-outcome probes. Resets on any other outcome. */
  streak_limited: number;
  /** Daemon's runtime profile string. Can be one of PingProfile, or "custom" (env-var override),
      or "unknown" (daemon dead/stale). Typed as string to admit all three. */
  profile: string;
  /** Runtime fail-threshold in seconds (active in the daemon). 0 if daemon dead/stale. */
  fail_secs: number;
  /** Runtime recover-threshold in seconds. 0 if daemon dead/stale. */
  recover_secs: number;
  /** Runtime intercept-threshold in seconds. 0 if daemon dead/stale. */
  intercept_secs: number;
```

- [ ] **Step 4: Run `bunx tsc --noEmit` to confirm no project-wide type errors**

```sh
bunx tsc --noEmit
```

Expected: no errors. If existing call sites of `ConnectivityStatus` break (e.g., destructured in a way that demands the new fields exist), fix only the obvious mismatches — do NOT update components that aren't part of this plan.

- [ ] **Step 5: Commit**

```sh
git add types/modem-status.ts
git commit -m "types(modem-status): add PingTriState, PingProfile + 8 ConnectivityStatus fields

Extends ConnectivityStatus with the 8 new fields forwarded by the poller
(state, limited_reason, down_reason, streak_limited, profile, fail_secs,
recover_secs, intercept_secs). Adds new types PingTriState (the daemon's
tri-state) and PingProfile (the four user-selectable presets), plus a
PING_PROFILES const tuple for the display-order list.

Existing ConnectivityState type (used by the derived 'status' field) is
intentionally left unchanged; PingTriState is a separate enum to avoid
collision."
```

---

## Task 5: `usePingProfile` hook

**Files:**
- Create: `hooks/use-ping-profile.ts`

- [ ] **Step 1: Confirm `authFetch` import path**

```sh
grep -rn "from \"@/lib/auth-fetch\"" hooks/ | head -3
```

Expected: existing hooks import from `@/lib/auth-fetch`. Use the same path.

- [ ] **Step 2: Create the hook**

Create `hooks/use-ping-profile.ts`:

```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-fetch";
import type { PingProfile } from "@/types/modem-status";

// =============================================================================
// usePingProfile — Fetch & Save Hook for Connectivity Sensitivity
// =============================================================================
// Backend: GET/POST /cgi-bin/quecmanager/settings/ping_profile.sh
//
// GET returns { success: true, settings: { profile: PingProfile } }.
// POST { action: "save_settings", profile: PingProfile } writes the file
// and pokes /tmp/qmanager_ping_reload; daemon picks up the change on its
// next probe cycle (1-10s depending on the previous profile's interval).
// =============================================================================

const ENDPOINT = "/cgi-bin/quecmanager/settings/ping_profile.sh";

interface PingProfileSettings {
  profile: PingProfile;
}

interface PingProfileResponse {
  success: boolean;
  settings?: PingProfileSettings;
  error?: string;
  message?: string;
}

export interface UsePingProfileReturn {
  profile: PingProfile | undefined;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  saveError: string | null;
  save: (profile: PingProfile) => Promise<PingProfileResponse>;
}

export function usePingProfile(): UsePingProfileReturn {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["ping-profile"],
    queryFn: async (): Promise<PingProfileSettings> => {
      const res = await authFetch(ENDPOINT);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: PingProfileResponse = await res.json();
      if (!json.success || !json.settings) {
        throw new Error(json.message ?? json.error ?? "Failed to load profile");
      }
      return json.settings;
    },
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: async (profile: PingProfile): Promise<PingProfileResponse> => {
      const res = await authFetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_settings", profile }),
      });
      const json: PingProfileResponse = await res.json();
      if (!json.success) {
        throw new Error(json.message ?? json.error ?? "Save failed");
      }
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ping-profile"] });
    },
  });

  return {
    profile: query.data?.profile,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    isSaving: mutation.isPending,
    saveError: mutation.error instanceof Error ? mutation.error.message : null,
    save: mutation.mutateAsync,
  };
}
```

- [ ] **Step 3: Verify type-checks**

```sh
bunx tsc --noEmit
```

Expected: no new errors. If the project's React Query version doesn't accept this exact shape, mirror the patterns from another hook (e.g., `hooks/use-modem-status.ts`).

- [ ] **Step 4: Commit**

```sh
git add hooks/use-ping-profile.ts
git commit -m "feat(hook): add usePingProfile React Query hook

Wraps GET/POST /cgi-bin/quecmanager/settings/ping_profile.sh. GET reads
the saved profile (cached 30s); POST mutation invalidates the cache on
success. No optimistic update — saves are <200ms typical and the next
modem-status poll surfaces the new runtime thresholds within ~10s."
```

---

## Task 6: `ConnectivitySensitivityCard` component

**Files:**
- Create: `components/system-settings/connectivity-sensitivity-card.tsx`

- [ ] **Step 1: Verify the ToggleGroup component exists and accepts `type="single"`**

```sh
grep -n 'ToggleGroupPrimitive.Root\|ToggleGroupItem' components/ui/toggle-group.tsx | head -5
```

Expected: ShadCN ToggleGroup wrapping Radix `@radix-ui/react-toggle-group`. The Radix `Root` accepts `type="single"` with `value` + `onValueChange` props.

- [ ] **Step 2: Create the card**

Create `components/system-settings/connectivity-sensitivity-card.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { motion, type Variants } from "motion/react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangleIcon } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";

import { usePingProfile } from "@/hooks/use-ping-profile";
import { useModemStatus } from "@/hooks/use-modem-status";
import { PING_PROFILES, type PingProfile } from "@/types/modem-status";

// ─── Animation variants ────────────────────────────────────────────────────

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
};

// ─── Profile metadata (UI labels and per-preset blurbs) ────────────────────

const PROFILE_META: Record<
  PingProfile,
  { label: string; blurb: string; intervalLabel: string }
> = {
  sensitive: {
    label: "Sensitive",
    blurb:
      "Fastest UI feedback. Best for hardwired or strong-signal setups.",
    intervalLabel: "1s",
  },
  regular: {
    label: "Regular",
    blurb: "Balanced default. Good for most users.",
    intervalLabel: "2s",
  },
  relaxed: {
    label: "Relaxed",
    blurb: "Conservative. Matches the previous QManager default.",
    intervalLabel: "5s",
  },
  quiet: {
    label: "Quiet",
    blurb: "Battery and data conscious. Slowest reaction time.",
    intervalLabel: "10s",
  },
};

// 30 seconds — how long after a save we wait before showing the
// "daemon hasn't picked up the change yet" footnote.
const STUCK_THRESHOLD_MS = 30_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatSecs(value: number | null | undefined): string {
  if (value === undefined || value === null || value === 0) return "—";
  return `${value}s`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ConnectivitySensitivityCard() {
  const { profile, isLoading, error, isSaving, saveError, save } =
    usePingProfile();
  const { data: modemStatus } = useModemStatus();
  const { saved, markSaved } = useSaveFlash();

  // Local selection state — initialized from saved profile, syncs on remount
  const [selected, setSelected] = useState<PingProfile | undefined>(profile);

  // When the saved profile finishes loading or changes after save, re-sync local state
  useEffect(() => {
    if (profile && selected === undefined) setSelected(profile);
  }, [profile, selected]);

  // After a successful save, sync local selection to whatever was just saved
  // (prevents stale dirty state if user clicks a profile twice)
  const lastSavedAtRef = useRef<number | null>(null);
  const lastSavedProfileRef = useRef<PingProfile | null>(null);

  // Dirty detection
  const isDirty = useMemo(() => {
    if (!profile || !selected) return false;
    return selected !== profile;
  }, [profile, selected]);

  const canSave = isDirty && !isSaving;

  // Daemon-stuck detection: after a save, if the daemon's runtime profile
  // doesn't match within STUCK_THRESHOLD_MS, surface a footnote.
  const [stuckHint, setStuckHint] = useState(false);
  useEffect(() => {
    if (lastSavedAtRef.current === null) return;
    const interval = setInterval(() => {
      if (lastSavedAtRef.current === null) return;
      const elapsed = Date.now() - lastSavedAtRef.current;
      if (elapsed < STUCK_THRESHOLD_MS) return;
      const runtime = modemStatus?.connectivity?.profile;
      const target = lastSavedProfileRef.current;
      if (runtime && target && runtime !== target) {
        setStuckHint(true);
      } else {
        setStuckHint(false);
        lastSavedAtRef.current = null;
        lastSavedProfileRef.current = null;
      }
    }, 2_000);
    return () => clearInterval(interval);
  }, [modemStatus?.connectivity?.profile]);

  // Save handler
  const handleSave = async () => {
    if (!canSave || !selected) return;
    try {
      await save(selected);
      markSaved();
      lastSavedAtRef.current = Date.now();
      lastSavedProfileRef.current = selected;
      setStuckHint(false);
      toast.success("Sensitivity profile updated");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      toast.error(msg);
    }
  };

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Connectivity Sensitivity</CardTitle>
          <CardDescription>
            How aggressively the modem checks if your internet is working.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-20 w-full rounded-md" />
            <div className="flex justify-end">
              <Skeleton className="h-9 w-32" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Error variant ──────────────────────────────────────────────────────
  if (error && !profile) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Connectivity Sensitivity</CardTitle>
          <CardDescription>
            How aggressively the modem checks if your internet is working.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangleIcon className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const activeMeta = selected ? PROFILE_META[selected] : null;
  const runtime = modemStatus?.connectivity ?? null;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Connectivity Sensitivity</CardTitle>
        <CardDescription>
          How aggressively the modem checks if your internet is working.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {saveError && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangleIcon className="size-4" />
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}

        <motion.div
          className="grid gap-3"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* ── Segmented control ────────────────────────────────────── */}
          <motion.div variants={itemVariants}>
            <ToggleGroup
              type="single"
              value={selected ?? ""}
              onValueChange={(v) => {
                if (v && (PING_PROFILES as readonly string[]).includes(v)) {
                  setSelected(v as PingProfile);
                }
              }}
              className="grid grid-cols-4 gap-1 rounded-md bg-muted p-1"
              aria-label="Connectivity sensitivity profile"
            >
              {PING_PROFILES.map((p) => (
                <ToggleGroupItem
                  key={p}
                  value={p}
                  className="data-[state=on]:bg-background data-[state=on]:shadow-sm rounded-sm text-sm"
                  aria-label={`${PROFILE_META[p].label} (${PROFILE_META[p].intervalLabel} probe)`}
                >
                  {PROFILE_META[p].label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </motion.div>

          {/* ── Active-profile meta panel ────────────────────────────── */}
          {activeMeta && (
            <motion.div
              variants={itemVariants}
              className="rounded-md border bg-muted/40 px-3 py-2.5 text-sm"
            >
              <p className="text-foreground">
                <span className="font-semibold">{activeMeta.label}</span>
                <span className="text-muted-foreground"> — {activeMeta.blurb}</span>
              </p>
              <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1">
                <MetaPair label="Probe interval" value={formatSecs(runtime?.history_interval_sec)} />
                <MetaPair label="Fail threshold" value={formatSecs(runtime?.fail_secs)} />
                <MetaPair label="Recover after" value={formatSecs(runtime?.recover_secs)} />
              </div>
              {stuckHint && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Daemon hasn&apos;t picked up the change yet — check{" "}
                  <code className="font-mono text-[0.7rem]">systemctl status qmanager-ping</code>{" "}
                  if this persists.
                </p>
              )}
            </motion.div>
          )}

          {/* ── Save button ──────────────────────────────────────────── */}
          <motion.div variants={itemVariants} className="flex justify-end">
            <Separator className="hidden" />
            <SaveButton
              onClick={handleSave}
              isSaving={isSaving}
              saved={saved}
              disabled={!canSave}
            />
          </motion.div>
        </motion.div>
      </CardContent>
    </Card>
  );
}

// ─── Sub-component ──────────────────────────────────────────────────────────

function MetaPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

```sh
bunx tsc --noEmit
```

Expected: no errors. If `useModemStatus`'s return type doesn't expose `data` directly, mirror the consumer pattern from `home-component.tsx:33` (`const { data, isLoading } = useModemStatus()`).

- [ ] **Step 4: Commit**

```sh
git add components/system-settings/connectivity-sensitivity-card.tsx
git commit -m "feat(ui): add ConnectivitySensitivityCard for System Settings

Segmented control across 4 ping profiles (Sensitive/Regular/Relaxed/Quiet)
with an active-profile meta panel showing live runtime thresholds from the
daemon's qmanager_ping.json (forwarded by the poller). Save button with
dirty detection, sonner toast on success/error, loading skeleton, and an
error variant alert.

Includes a 'daemon stuck' diagnostic footnote that surfaces 30s after a
save if the daemon's runtime profile string still doesn't match what was
saved — points the user at 'systemctl status qmanager-ping' rather than
silently leaving the impression nothing happened."
```

---

## Task 7: Wire the new card into the System Settings page

**Files:**
- Modify: `components/system-settings/system-settings.tsx`

- [ ] **Step 1: Add the import**

Open `components/system-settings/system-settings.tsx`. Add this import alongside the existing card imports:

```ts
import ConnectivitySensitivityCard from "@/components/system-settings/connectivity-sensitivity-card";
```

- [ ] **Step 2: Add the component to the grid**

Find the existing `<div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">` block. Add `<ConnectivitySensitivityCard />` as the last child:

Find:
```tsx
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
        <SystemSettingsCard {...hookData} />
        <ScheduledOperationsCard {...hookData} />
        <SSHPasswordCard />
        <ModemSubsystemCard />
      </div>
```

Replace with:
```tsx
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
        <SystemSettingsCard {...hookData} />
        <ScheduledOperationsCard {...hookData} />
        <SSHPasswordCard />
        <ModemSubsystemCard />
        <ConnectivitySensitivityCard />
      </div>
```

- [ ] **Step 3: Build and type-check**

```sh
bunx tsc --noEmit
bun run build
```

Expected: clean build. If `bun run build` script isn't named that, fall back to `bun build` per project memory.

- [ ] **Step 4: Commit**

```sh
git add components/system-settings/system-settings.tsx
git commit -m "feat(ui): mount ConnectivitySensitivityCard on System Settings page"
```

---

## Task 8: Update Network Status badge for "Carrier Limited" state

**Files:**
- Modify: `components/dashboard/network-status.tsx`

- [ ] **Step 1: Add helper imports and type import**

Open `components/dashboard/network-status.tsx`. Find the existing imports:

```ts
import type {
  NetworkStatus,
  ConnectivityStatus,
  ServiceStatus,
} from "@/types/modem-status";
```

Add `PingTriState`:

```ts
import type {
  NetworkStatus,
  ConnectivityStatus,
  ServiceStatus,
  PingTriState,
} from "@/types/modem-status";
```

Add the Tooltip imports (these are likely already not in this file — verify with `grep TooltipTrigger`):

```ts
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
```

- [ ] **Step 2: Add the badge-builder helpers above the component**

Find the existing helper section (around `getServiceColor`). Add these helpers right above the `serviceColorMap` constant:

```ts
// ─── Internet badge — tri-state with optional tooltip ──────────────────────

interface InternetBadge {
  cls: string;
  label: string;
  state: PingTriState;
  tooltip: string | null;
}

function buildInternetBadge(c: ConnectivityStatus | null): InternetBadge {
  // Prefer the new tri-state field; fall back to internet_available for
  // rolling-upgrade safety (poller without Phase 2 forwarding).
  let state: PingTriState = "unknown";
  if (c?.state) {
    state = c.state;
  } else if (c?.internet_available === true) {
    state = "connected";
  } else if (c?.internet_available === false) {
    state = "disconnected";
  }

  switch (state) {
    case "connected":
      return {
        cls: "bg-success/15 text-success hover:bg-success/20 border-success/30",
        label: "Online",
        state,
        tooltip: null,
      };
    case "limited":
      return {
        cls: "bg-warning/15 text-warning hover:bg-warning/20 border-warning/30",
        label: "Carrier Limited",
        state,
        tooltip: limitedTooltip(c?.limited_reason ?? null),
      };
    case "disconnected":
      return {
        cls: "bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30",
        label: "Offline",
        state,
        tooltip: downTooltip(c?.down_reason ?? null),
      };
    default:
      return {
        cls: "bg-muted/50 text-muted-foreground hover:bg-muted/70 border-muted-foreground/30",
        label: "Internet",
        state,
        tooltip: null,
      };
  }
}

function limitedTooltip(code: number | null): string {
  if (code === null) {
    return "Carrier is intercepting probes — billing or activation page likely.";
  }
  if (code >= 300 && code < 400) {
    return `Carrier is redirecting probes (HTTP ${code}). Likely walled-garden or activation page.`;
  }
  if (code >= 400) {
    return `Carrier returned HTTP ${code}. Probe path is intercepted but not by a redirect.`;
  }
  return `Network reachable but probe returned HTTP ${code}, not 204. Carrier may be redirecting traffic to a billing or activation page.`;
}

function downTooltip(reason: string | null): string {
  switch (reason) {
    case "carrier_down":
      return "Cellular carrier link is down (sysfs reports no carrier).";
    case "timeout":
      return "Probe timed out — connection may be stalled.";
    case "refused":
      return "Connection refused by probe target.";
    case "reset":
      return "Connection reset by carrier or peer.";
    case "dns":
      return "DNS resolution failed.";
    case "malformed":
      return "Probe response was malformed.";
    default:
      return "Internet unreachable.";
  }
}
```

- [ ] **Step 3: Replace the existing Internet badge block**

Find the existing Internet-status badge (currently around lines 254-282 in `network-status.tsx`). It looks like:

```tsx
              {/* Internet status — green/red/gray based on ping daemon */}
              <Badge
                variant="outline"
                className={
                  internetAvailable === true
                    ? "bg-success/15 text-success hover:bg-success/20 border-success/30"
                    : internetAvailable === false
                      ? "bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted/70 border-muted-foreground/30"
                }
              >
                {/* Sonar ping — only when online */}
                {internetAvailable === true ? (
                  <span className="relative flex size-2 shrink-0">
                    <span className="absolute inline-flex size-full rounded-full bg-success opacity-75 animate-ping" />
                    <span className="relative inline-flex size-2 rounded-full bg-success" />
                  </span>
                ) : (
                  <span
                    className={`inline-flex size-2 rounded-full shrink-0 ${
                      internetAvailable === false ? "bg-destructive" : "bg-muted-foreground"
                    }`}
                  />
                )}
                {internetAvailable === true
                  ? "Online"
                  : internetAvailable === false
                    ? "Offline"
                    : "Internet"}
              </Badge>
```

Replace the entire block with this tri-state-aware version. (Note: the `connectivity` prop is already destructured at the top of the component — `internetAvailable` was derived from it. We'll compute `internetBadge` from `connectivity` directly and remove the `internetAvailable` derivation.)

```tsx
              {/* Internet status — tri-state from ping daemon */}
              {(() => {
                const b = buildInternetBadge(connectivity);
                const dot =
                  b.state === "connected" ? (
                    <span className="relative flex size-2 shrink-0">
                      <span className="absolute inline-flex size-full rounded-full bg-success opacity-75 animate-ping" />
                      <span className="relative inline-flex size-2 rounded-full bg-success" />
                    </span>
                  ) : b.state === "limited" ? (
                    <span className="relative flex size-2 shrink-0">
                      <span className="absolute inline-flex size-full rounded-full bg-warning opacity-75 animate-ping" />
                      <span className="relative inline-flex size-2 rounded-full bg-warning" />
                    </span>
                  ) : b.state === "disconnected" ? (
                    <span className="inline-flex size-2 rounded-full shrink-0 bg-destructive" />
                  ) : (
                    <span className="inline-flex size-2 rounded-full shrink-0 bg-muted-foreground" />
                  );
                const badge = (
                  <Badge variant="outline" className={b.cls}>
                    {dot}
                    {b.label}
                  </Badge>
                );
                if (b.tooltip) {
                  return (
                    <Tooltip>
                      <TooltipTrigger asChild>{badge}</TooltipTrigger>
                      <TooltipContent>{b.tooltip}</TooltipContent>
                    </Tooltip>
                  );
                }
                return badge;
              })()}
```

- [ ] **Step 4: Remove the now-unused `internetAvailable` derivation**

Find this line (around line 197):
```ts
  const internetAvailable = connectivity?.internet_available ?? null;
```

Delete it. The variable is no longer referenced.

- [ ] **Step 5: Build and type-check**

```sh
bunx tsc --noEmit
bun run build
```

Expected: clean. If `bun run build` script isn't found, use `bun build`.

- [ ] **Step 6: Commit**

```sh
git add components/dashboard/network-status.tsx
git commit -m "feat(ui): add 'Carrier Limited' state to Network Status Internet badge

Replaces the existing 2-state (Online/Offline) Internet badge with a
4-state tri-state read of connectivity.state forwarded by the poller.
The new yellow 'Carrier Limited' state surfaces HTTP-intercept failure
modes (billing portal, activation page, walled garden) that previously
collapsed silently into 'Offline'. Hover tooltip names the HTTP code
seen and the likely cause.

Falls back to internet_available boolean when the new tri-state field
is missing (rolling-upgrade safety)."
```

---

## Task 9: End-to-end manual UAT (no commit)

**Files:** none — runtime verification only.

This task validates everything wired together on real hardware. It does not produce a commit; if any step fails, fix the implementation in the relevant earlier task and re-run.

- [ ] **Step 1: Build the frontend**

```sh
bun run build
```

Expected: clean build. If type errors appear, return to Task 4/5/6/8 and fix.

- [ ] **Step 2: Deploy to the device**

(Use whatever deploy mechanism the project normally uses — `scripts/install_rm520n.sh` from the device, or `scp` of just the changed files. The test-deploy choice is independent of this plan.)

After deploy, on the device:
```sh
ssh root@192.168.225.1 'systemctl restart qmanager-poller && systemctl status qmanager-poller --no-pager | head -20'
```

Expected: `active (running)`.

- [ ] **Step 3: Verify poller forwarding**

```sh
ssh root@192.168.225.1 'jq .connectivity /tmp/qmanager_status.json'
```

Expected: the `connectivity` block contains all 8 new keys (`state`, `limited_reason`, `down_reason`, `streak_limited`, `profile`, `fail_secs`, `recover_secs`, `intercept_secs`) alongside existing fields. `state` should be `"connected"` if the device has internet, and `profile` should be a non-empty string (likely `"relaxed"` or whatever the daemon currently uses).

- [ ] **Step 4: Verify the Sensitivity card**

Open the QManager web UI in a browser. Navigate to System Settings.

Expected:
- A new "Connectivity Sensitivity" card appears as the 5th card.
- The currently-saved profile is shown selected in the segmented control.
- The meta panel below shows the active profile's name + blurb + three threshold values (e.g., "Probe interval: 5s, Fail threshold: 15s, Recover after: 10s" for Relaxed).
- Save button is disabled (no pending changes).

- [ ] **Step 5: Save a different profile**

Click a different profile (e.g., switch from Relaxed to Regular). Click Save.

Expected:
- Toast appears: "Sensitivity profile updated".
- SaveButton briefly shows the "Saved!" flash.
- Within ~10 seconds, the meta panel's threshold values update to the new profile's runtime values (e.g., "Probe interval: 2s, Fail threshold: 10s, Recover after: 6s").

Verify on the device:
```sh
ssh root@192.168.225.1 'cat /etc/qmanager/ping_profile.json'
```

Expected: `{"profile":"regular"}` (or whatever profile you selected).

```sh
ssh root@192.168.225.1 'ls -la /tmp/qmanager_ping_reload 2>/dev/null || echo "flag not present"'
```

The flag should EITHER (a) exist (daemon hasn't reached its next cycle yet) OR (b) be absent (daemon already consumed and unlinked it). Both are fine.

- [ ] **Step 6: Verify no regressions in existing consumers**

```sh
ssh root@192.168.225.1 'journalctl -u qmanager-watchcat --since "5 minutes ago" | tail -20'
```

Expected: normal watchcat log output — no errors, no reference to undefined variables. Watchcat reads `internet_available` (unchanged), so it should look identical to pre-Phase-2 logs.

- [ ] **Step 7: Trigger Carrier Limited state**

To force a `limited` outcome, point the daemon at a target that returns 200 instead of 204:

```sh
ssh root@192.168.225.1 'echo "PING_TARGET_1=http://example.com/" >> /etc/qmanager/environment && systemctl restart qmanager-ping'
```

Wait `intercept_secs` cycles (~8s by default). Then in the QManager UI, look at the Network Status card.

Expected:
- The Internet badge flips to yellow with text "Carrier Limited".
- Hovering the badge shows a tooltip with text matching `limitedTooltip()` (e.g., "Network reachable but probe returned HTTP 200, not 204. Carrier may be redirecting traffic to a billing or activation page.").
- The card's pulsating service circles still show modem/radio status (they're driven by `service_status`, not internet) — these should be unchanged.

- [ ] **Step 8: Restore real targets and verify return to Online**

```sh
ssh root@192.168.225.1 'sed -i "/^PING_TARGET_1=http:\\/\\/example.com\\//d" /etc/qmanager/environment && systemctl restart qmanager-ping'
```

Wait `recover_secs` cycles. The badge should flip back to green "Online".

- [ ] **Step 9: Run the CGI smoke test on the device**

```sh
ssh root@192.168.225.1 'bash -' < scripts/test/ping-profile-cgi.sh
```

Expected: `Results: 9 passed, 0 failed`. (This is a sandboxed test — it doesn't touch live state.)

- [ ] **Step 10: Run `cargo test` in the daemon (regression check)**

From WSL2:
```sh
cd ping-daemon && cargo test
```

Expected: all Phase 1 tests pass — should be a no-op since no Rust files changed in Phase 2.

---

## Self-Review Checklist (run before declaring the plan complete)

**Spec coverage:**
- [x] §2 (CGI endpoint) → Task 1
- [x] §3 (Poller forwarding — read_ping_data extension) → Task 2
- [x] §3 (Poller forwarding — connectivity block extension) → Task 3
- [x] §4a (Type extensions) → Task 4
- [x] §4b (Hook) → Task 5
- [x] §4c (Card component) → Task 6
- [x] §4e (System Settings page mount) → Task 7
- [x] §4d (Network Status badge update) → Task 8
- [x] §6.1 (CGI smoke test) → Task 1
- [x] §6.2 (Daemon cargo test regression) → Task 9 Step 10
- [x] §6.3 (Poller forwarding manual verification) → Task 9 Step 3
- [x] §6.4 (Frontend manual UAT) → Task 9 Steps 4-8
- [x] Cross-consumer compat regression check → Task 9 Step 6

**Type consistency:**
- `PingTriState` (new type) used consistently in Task 4 (definition), Task 8 (import + helper signature). NOT named `ConnectivityState` (collides with existing).
- `PingProfile` used in Tasks 4, 5, 6.
- `ConnectivityStatus.state` field is `PingTriState | null` (Task 4) and consumed via `c?.state` (Task 8). Match.
- `ConnectivityStatus.profile` field is `string` (not `PingProfile`) — Task 4 documents why; Task 6's daemon-stuck check compares against the saved-profile string.

**Placeholder scan:**
- No "TBD", "TODO", "implement later" markers.
- No "add appropriate error handling" or "similar to Task N" — every step shows full code.
- No vague references — every type, function, and method appears in a defined task.

---

## References

- Spec: `docs/superpowers/specs/2026-05-09-ping-profile-ui-design.md`
- Phase 1 spec: `docs/superpowers/specs/2026-05-09-rust-ping-daemon-design.md`
- CGI precedent: `scripts/www/cgi-bin/quecmanager/monitoring/sms_alerts.sh`
- Card precedent: `components/system-settings/system-settings-card.tsx`
- Hook precedent: `hooks/use-system-settings.ts`
- Network Status badge: `components/dashboard/network-status.tsx`
- Poller entry points: `scripts/usr/bin/qmanager_poller:985` (`read_ping_data`), `:1576` (status.json `connectivity:` block)
