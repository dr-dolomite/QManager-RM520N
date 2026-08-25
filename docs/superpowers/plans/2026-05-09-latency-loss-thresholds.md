# Latency & Loss Thresholds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `high_latency` and `high_packet_loss` event thresholds in the poller user-configurable through a new System Settings card, replacing the hardcoded 90 ms / 20 % values.

**Architecture:** Three-preset chip pattern (`Standard / Tolerant / Very Tolerant`) per row, two rows (latency + packet loss) in one card. Preset names are stored at `/etc/qmanager/quality_thresholds.json`; threshold values resolve in `events.sh` (single source of truth, mirroring `qmanager_ping`'s `for_profile()`). New CGI mirrors `ping_profile.sh`; new flag `/tmp/qmanager_events_reload` triggers a once-per-cycle re-read in `events.sh`.

**Tech Stack:** Bash 3.2+ shell (POSIX), `jq`, lighttpd CGI, React 19 + Next.js 15, TypeScript, Tailwind v4, shadcn/ui, motion/react, sonner.

**Spec:** `docs/superpowers/specs/2026-05-09-latency-loss-thresholds-design.md`

---

## File Structure

**New files:**
- `scripts/etc/qmanager/quality_thresholds.json` — default config shipped to fresh installs
- `scripts/www/cgi-bin/quecmanager/settings/quality_thresholds.sh` — GET/POST CGI
- `scripts/test/quality-thresholds-cgi.sh` — CGI smoke test (mirrors `ping-profile-cgi.sh`)
- `scripts/test/events-quality-thresholds.sh` — events.sh helper test
- `hooks/use-quality-thresholds.ts` — React fetch/save hook
- `components/system-settings/quality-thresholds-card.tsx` — the card

**Modified files:**
- `scripts/usr/lib/qmanager/events.sh` — add config state + helpers, replace hardcoded literals
- `types/modem-status.ts` — add `QualityPreset`, `QUALITY_PRESETS`, `QualityThresholdsSettings`
- `components/system-settings/system-settings.tsx` — mount the new card after `<ConnectivitySensitivityCard />`
- `RELEASE_NOTES.md` — New Features bullet announcing the new card and default change

---

## Conventions for Subagents

- **Bash style:** This codebase targets BusyBox sh on RM551E and Bash 3.2 on RM520N-GL. Stick to POSIX where the surrounding file does. Never use `[[ ]]`, `set -o pipefail`, `${var,,}`, or arrays. Use `[ ]` and `case`.
- **`set -e` traps:** Never end a function with `[ -x ] && cmd` — it returns the test's exit code, which can kill `set -e` callers. Use `if [ -x ]; then cmd; fi`. (See memory `feedback_set_e_traps.md`.)
- **Line endings:** Author every shell file with LF. The repo `.gitattributes` enforces LF on `*.sh` but verify your editor is configured.
- **CGI test pattern:** Use `QM_LIB_DIR` env override + a stub `cgi_base.sh`. Copy the harness scaffolding from `scripts/test/ping-profile-cgi.sh`.
- **TypeScript imports:** Use `@/...` aliases. Prefer `import type` for type-only.
- **Emojis:** Do not introduce emoji literals into code or commit messages. Status glyphs (`●`, `⚠`) inside the card are deliberate UI characters; keep them limited to the locations the plan specifies.
- **No comments narrating the task** — the file should read as if the change were always there.

---

## Task 1: Backend — events.sh module state + helpers + literal replacement

**Files:**
- Modify: `scripts/usr/lib/qmanager/events.sh` (around lines 21–22 and 274–342)
- Test: `scripts/test/events-quality-thresholds.sh` (new file)

**Why combined:** The helpers and the literal replacement must ship together. If we add the helpers but don't use them, dead code lives in the tree until Task 2 lands. If we replace literals first, `events.sh` references undefined globals. One commit, three steps.

- [ ] **Step 1: Write the failing test**

Create `scripts/test/events-quality-thresholds.sh`:

```bash
#!/usr/bin/env bash
# Test the quality-threshold helpers in events.sh in isolation.
# Sources events.sh, exercises _qt_load + _qt_check_reload, asserts the
# four module-level threshold globals end up at the right values.
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EVENTS="$REPO_ROOT/scripts/usr/lib/qmanager/events.sh"

if [ ! -f "$EVENTS" ]; then
    echo "FAIL: events.sh not found at $EVENTS" >&2
    exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
    echo "SKIP: jq not on PATH" >&2
    exit 0
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1" >&2; }

# Stub the qlog_* helpers events.sh expects from cgi_base.sh.
stub() {
    cat <<'STUB'
qlog_init()  { :; }
qlog_debug() { :; }
qlog_info()  { :; }
qlog_warn()  { :; }
qlog_error() { :; }
EVENTS_FILE="${EVENTS_FILE:-/dev/null}"
MAX_EVENTS="${MAX_EVENTS:-100}"
STUB
}

# --- Test 1: defaults match "tolerant" when JSON is absent --------------
(
    set +eu
    eval "$(stub)"
    export QUALITY_CONFIG="$work/missing.json"
    export QUALITY_RELOAD_FLAG="$work/missing.flag"
    . "$EVENTS"
    [ "$_qt_lat_thresh" = "250" ]    || { echo "lat_thresh=$_qt_lat_thresh"; exit 1; }
    [ "$_qt_lat_debounce" = "3" ]    || { echo "lat_debounce=$_qt_lat_debounce"; exit 1; }
    [ "$_qt_loss_thresh" = "30" ]    || { echo "loss_thresh=$_qt_loss_thresh"; exit 1; }
    [ "$_qt_loss_debounce" = "3" ]   || { echo "loss_debounce=$_qt_loss_debounce"; exit 1; }
) && ok "defaults = tolerant when config missing" || bad "defaults = tolerant when config missing"

# --- Test 2: standard preset resolves to 150ms / 15% --------------------
(
    set +eu
    eval "$(stub)"
    cfg="$work/std.json"
    printf '{"latency":{"preset":"standard"},"loss":{"preset":"standard"}}\n' > "$cfg"
    export QUALITY_CONFIG="$cfg"
    export QUALITY_RELOAD_FLAG="$work/std.flag"
    . "$EVENTS"
    [ "$_qt_lat_thresh" = "150" ]  || { echo "lat_thresh=$_qt_lat_thresh"; exit 1; }
    [ "$_qt_lat_debounce" = "3" ]  || { echo "lat_debounce=$_qt_lat_debounce"; exit 1; }
    [ "$_qt_loss_thresh" = "15" ]  || { echo "loss_thresh=$_qt_loss_thresh"; exit 1; }
    [ "$_qt_loss_debounce" = "3" ] || { echo "loss_debounce=$_qt_loss_debounce"; exit 1; }
) && ok "standard preset resolves to 150ms / 15%" || bad "standard preset resolves to 150ms / 15%"

# --- Test 3: very-tolerant preset resolves to 500ms / 50% --------------
(
    set +eu
    eval "$(stub)"
    cfg="$work/vt.json"
    printf '{"latency":{"preset":"very-tolerant"},"loss":{"preset":"very-tolerant"}}\n' > "$cfg"
    export QUALITY_CONFIG="$cfg"
    export QUALITY_RELOAD_FLAG="$work/vt.flag"
    . "$EVENTS"
    [ "$_qt_lat_thresh" = "500" ]  || { echo "lat_thresh=$_qt_lat_thresh"; exit 1; }
    [ "$_qt_lat_debounce" = "2" ]  || { echo "lat_debounce=$_qt_lat_debounce"; exit 1; }
    [ "$_qt_loss_thresh" = "50" ]  || { echo "loss_thresh=$_qt_loss_thresh"; exit 1; }
    [ "$_qt_loss_debounce" = "2" ] || { echo "loss_debounce=$_qt_loss_debounce"; exit 1; }
) && ok "very-tolerant preset resolves to 500ms / 50%" || bad "very-tolerant preset resolves to 500ms / 50%"

# --- Test 4: invalid preset name falls back to defaults ----------------
(
    set +eu
    eval "$(stub)"
    cfg="$work/bad.json"
    printf '{"latency":{"preset":"bogus"},"loss":{"preset":"bogus"}}\n' > "$cfg"
    export QUALITY_CONFIG="$cfg"
    export QUALITY_RELOAD_FLAG="$work/bad.flag"
    . "$EVENTS"
    [ "$_qt_lat_thresh" = "250" ]  || { echo "lat_thresh=$_qt_lat_thresh"; exit 1; }
    [ "$_qt_loss_thresh" = "30" ]  || { echo "loss_thresh=$_qt_loss_thresh"; exit 1; }
) && ok "invalid preset name keeps tolerant defaults" || bad "invalid preset name keeps tolerant defaults"

# --- Test 5: malformed JSON falls back to defaults ---------------------
(
    set +eu
    eval "$(stub)"
    cfg="$work/malformed.json"
    printf 'not valid json' > "$cfg"
    export QUALITY_CONFIG="$cfg"
    export QUALITY_RELOAD_FLAG="$work/malformed.flag"
    . "$EVENTS"
    [ "$_qt_lat_thresh" = "250" ]  || { echo "lat_thresh=$_qt_lat_thresh"; exit 1; }
    [ "$_qt_loss_thresh" = "30" ]  || { echo "loss_thresh=$_qt_loss_thresh"; exit 1; }
) && ok "malformed JSON keeps tolerant defaults" || bad "malformed JSON keeps tolerant defaults"

# --- Test 6: reload flag triggers re-read and is consumed --------------
(
    set +eu
    eval "$(stub)"
    cfg="$work/reload.json"
    flag="$work/reload.flag"
    printf '{"latency":{"preset":"tolerant"},"loss":{"preset":"tolerant"}}\n' > "$cfg"
    export QUALITY_CONFIG="$cfg"
    export QUALITY_RELOAD_FLAG="$flag"
    . "$EVENTS"
    # Mutate config and touch flag.
    printf '{"latency":{"preset":"standard"},"loss":{"preset":"standard"}}\n' > "$cfg"
    touch "$flag"
    _qt_check_reload
    [ "$_qt_lat_thresh" = "150" ]  || { echo "after reload lat_thresh=$_qt_lat_thresh"; exit 1; }
    [ "$_qt_loss_thresh" = "15" ]  || { echo "after reload loss_thresh=$_qt_loss_thresh"; exit 1; }
    [ ! -f "$flag" ]               || { echo "reload flag not consumed"; exit 1; }
) && ok "reload flag triggers re-read and is consumed" || bad "reload flag triggers re-read and is consumed"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bash scripts/test/events-quality-thresholds.sh
```

Expected: All 6 tests FAIL with `_qt_lat_thresh: unbound variable` (the helpers don't exist yet).

- [ ] **Step 3: Edit `scripts/usr/lib/qmanager/events.sh` — add module state and helpers**

Locate the existing block at the top (around line 21):

```sh
[ -n "$_EVENTS_LOADED" ] && return 0
_EVENTS_LOADED=1

PCI_STATE_FILE="/tmp/qmanager_pci_state.json"
EVENT_STATE_FILE="${EVENT_STATE_FILE:-/tmp/qmanager_event_state.json}"
```

Insert the following block immediately after that, before the existing `append_event` function:

```sh
# ---------------------------------------------------------------------------
# Quality threshold config — drives high_latency / high_packet_loss events
# ---------------------------------------------------------------------------
QUALITY_CONFIG="${QUALITY_CONFIG:-/etc/qmanager/quality_thresholds.json}"
QUALITY_RELOAD_FLAG="${QUALITY_RELOAD_FLAG:-/tmp/qmanager_events_reload}"

# Defaults match the "tolerant" preset; survive a missing or malformed JSON.
_qt_lat_thresh=250
_qt_lat_debounce=3
_qt_loss_thresh=30
_qt_loss_debounce=3

_qt_apply_lat() {
    case "$1" in
        standard)      _qt_lat_thresh=150; _qt_lat_debounce=3 ;;
        tolerant)      _qt_lat_thresh=250; _qt_lat_debounce=3 ;;
        very-tolerant) _qt_lat_thresh=500; _qt_lat_debounce=2 ;;
    esac
}

_qt_apply_loss() {
    case "$1" in
        standard)      _qt_loss_thresh=15; _qt_loss_debounce=3 ;;
        tolerant)      _qt_loss_thresh=30; _qt_loss_debounce=3 ;;
        very-tolerant) _qt_loss_thresh=50; _qt_loss_debounce=2 ;;
    esac
}

_qt_load() {
    [ -f "$QUALITY_CONFIG" ] || return 0
    local lat loss
    lat=$(jq -r '.latency.preset // "tolerant"' "$QUALITY_CONFIG" 2>/dev/null)
    loss=$(jq -r '.loss.preset // "tolerant"' "$QUALITY_CONFIG" 2>/dev/null)
    case "$lat"  in standard|tolerant|very-tolerant) _qt_apply_lat  "$lat"  ;; esac
    case "$loss" in standard|tolerant|very-tolerant) _qt_apply_loss "$loss" ;; esac
}

_qt_check_reload() {
    [ -f "$QUALITY_RELOAD_FLAG" ] || return 0
    _qt_load
    rm -f "$QUALITY_RELOAD_FLAG"
    qlog_info "Quality thresholds reloaded: lat=${_qt_lat_thresh}ms/${_qt_lat_debounce} loss=${_qt_loss_thresh}%/${_qt_loss_debounce}"
}

# Initial load on first source. After this, only the reload flag triggers re-reads.
_qt_load
```

- [ ] **Step 4: Edit `scripts/usr/lib/qmanager/events.sh` — replace hardcoded literals**

In `detect_data_connection_events()` (starts around line 274), make these changes:

**4a.** Add the reload check at the very top of the function (after the recovery-suppression block). Find:

```sh
detect_data_connection_events() {
    # Suppress internet events during active watchcat recovery.
    # ...
    if [ "$conn_during_recovery" = "true" ]; then
        prev_ev_internet="$conn_internet_available"   # keep state in sync
        return
    fi

    # --- Internet connectivity ---
```

Insert between the recovery block and the `--- Internet connectivity ---` block:

```sh
    # Pick up any pending threshold reload from the CGI before evaluating quality.
    _qt_check_reload

```

**4b.** Replace the latency block. Find (around line 301):

```sh
    # --- High latency detection (threshold: 90ms, debounce: 3 readings) ---
    # Skip when ping daemon is stale (conn_latency="null") — don't touch streaks
    if [ "$conn_latency" != "null" ] && [ -n "$conn_latency" ]; then
        # Use awk for decimal comparison (POSIX shell has no float math)
        if echo "$conn_latency" | awk '{exit !($1 > 90)}'; then
            ev_high_lat_streak=$((ev_high_lat_streak + 1))
            if [ "$ev_high_lat_streak" -ge 3 ] && [ "$ev_lat_alerted" = "false" ]; then
```

Replace with:

```sh
    # --- High latency detection (threshold + debounce from quality_thresholds.json) ---
    # Skip when ping daemon is stale (conn_latency="null") — don't touch streaks
    if [ "$conn_latency" != "null" ] && [ -n "$conn_latency" ]; then
        # Use awk for decimal comparison (POSIX shell has no float math)
        if echo "$conn_latency" | awk -v t="$_qt_lat_thresh" '{exit !($1 > t)}'; then
            ev_high_lat_streak=$((ev_high_lat_streak + 1))
            if [ "$ev_high_lat_streak" -ge "$_qt_lat_debounce" ] && [ "$ev_lat_alerted" = "false" ]; then
```

**4c.** Replace the packet loss block. Find (around line 323):

```sh
    # --- High packet loss detection (threshold: 20%, debounce: 3 readings) ---
    if [ "$conn_packet_loss" != "null" ] && [ -n "$conn_packet_loss" ]; then
        if [ "$conn_packet_loss" -ge 20 ] 2>/dev/null; then
            ev_high_loss_streak=$((ev_high_loss_streak + 1))
            if [ "$ev_high_loss_streak" -ge 3 ] && [ "$ev_loss_alerted" = "false" ]; then
```

Replace with:

```sh
    # --- High packet loss detection (threshold + debounce from quality_thresholds.json) ---
    if [ "$conn_packet_loss" != "null" ] && [ -n "$conn_packet_loss" ]; then
        if [ "$conn_packet_loss" -ge "$_qt_loss_thresh" ] 2>/dev/null; then
            ev_high_loss_streak=$((ev_high_loss_streak + 1))
            if [ "$ev_high_loss_streak" -ge "$_qt_loss_debounce" ] && [ "$ev_loss_alerted" = "false" ]; then
```

Leave the rest of both blocks (the recovery branches and the `else` resets) unchanged.

- [ ] **Step 5: Run the test to verify it passes**

```bash
bash scripts/test/events-quality-thresholds.sh
```

Expected:
```
  PASS  defaults = tolerant when config missing
  PASS  standard preset resolves to 150ms / 15%
  PASS  very-tolerant preset resolves to 500ms / 50%
  PASS  invalid preset name keeps tolerant defaults
  PASS  malformed JSON keeps tolerant defaults
  PASS  reload flag triggers re-read and is consumed

Results: 6 passed, 0 failed
```

- [ ] **Step 6: Run the syntax gate to confirm no regressions**

```bash
bash scripts/test/run-all.sh
```

Expected: PASS — all scripts parsed cleanly.

- [ ] **Step 7: Commit**

```bash
git add scripts/usr/lib/qmanager/events.sh scripts/test/events-quality-thresholds.sh
git commit -m "feat(events): configurable latency & loss thresholds"
```

---

## Task 2: Backend — default config JSON

**Files:**
- Create: `scripts/etc/qmanager/quality_thresholds.json`

- [ ] **Step 1: Create the file**

Create `scripts/etc/qmanager/quality_thresholds.json` with exactly this content (no trailing whitespace, LF line ending, final newline):

```json
{
  "latency": { "preset": "tolerant" },
  "loss": { "preset": "tolerant" }
}
```

- [ ] **Step 2: Verify shape with jq**

```bash
jq -e '.latency.preset == "tolerant" and .loss.preset == "tolerant"' scripts/etc/qmanager/quality_thresholds.json
```

Expected: `true` and exit code 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/etc/qmanager/quality_thresholds.json
git commit -m "feat(config): default quality_thresholds.json (tolerant/tolerant)"
```

---

## Task 3: Backend — CGI script + smoke test

**Files:**
- Create: `scripts/www/cgi-bin/quecmanager/settings/quality_thresholds.sh`
- Create: `scripts/test/quality-thresholds-cgi.sh`

- [ ] **Step 1: Write the failing test**

Create `scripts/test/quality-thresholds-cgi.sh`:

```bash
#!/bin/sh
# Smoke test for /cgi-bin/quecmanager/settings/quality_thresholds.sh
# Mirrors scripts/test/ping-profile-cgi.sh.
set -eu

if ! command -v jq >/dev/null; then
    echo "FAIL: jq not found" >&2
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CGI="$REPO_ROOT/scripts/www/cgi-bin/quecmanager/settings/quality_thresholds.sh"

if [ ! -f "$CGI" ]; then
    echo "FAIL: CGI script not found at $CGI" >&2
    exit 1
fi

TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT
export QUALITY_CONFIG="$TEST_DIR/quality_thresholds.json"
export QUALITY_RELOAD_FLAG="$TEST_DIR/qmanager_events_reload"

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
cgi_error()   { printf '{"success":false,"error":"%s","detail":"%s"}\n' "$1" "$2"; }
STUB

run_cgi() {
    env REQUEST_METHOD="$1" \
        CONTENT_TYPE="${2:-}" \
        CONTENT_LENGTH="${3:-0}" \
        QM_LIB_DIR="$STUB_LIB" \
        QUALITY_CONFIG="$QUALITY_CONFIG" \
        QUALITY_RELOAD_FLAG="$QUALITY_RELOAD_FLAG" \
        _SKIP_AUTH=1 \
        sh "$CGI"
}

PASS=0
FAIL=0
pass() { PASS=$((PASS+1)); echo "PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "FAIL: $1" >&2; }

# Test 1: GET with no config returns tolerant default + is_default=true
rm -f "$QUALITY_CONFIG"
RES=$(run_cgi GET)
if echo "$RES" | jq -e '.success == true and .settings.latency.preset == "tolerant" and .settings.loss.preset == "tolerant" and .is_default == true' >/dev/null; then
    pass "GET with no config returns tolerant defaults + is_default=true"
else
    fail "GET with no config — got: $RES"
fi

# Test 2: POST each valid preset combination, verify file + reload flag
for lat in standard tolerant very-tolerant; do
    for loss in standard tolerant very-tolerant; do
        rm -f "$QUALITY_RELOAD_FLAG"
        BODY=$(printf '{"action":"save_settings","latency":{"preset":"%s"},"loss":{"preset":"%s"}}' "$lat" "$loss")
        LEN=${#BODY}
        RES=$(printf '%s' "$BODY" | run_cgi POST application/json "$LEN")
        if ! echo "$RES" | jq -e '.success == true' >/dev/null; then
            fail "POST lat=$lat loss=$loss — got: $RES"
            continue
        fi
        if [ "$(jq -r .latency.preset "$QUALITY_CONFIG")" != "$lat" ] \
            || [ "$(jq -r .loss.preset "$QUALITY_CONFIG")" != "$loss" ]; then
            fail "POST lat=$lat loss=$loss — config not updated"
            continue
        fi
        if [ ! -f "$QUALITY_RELOAD_FLAG" ]; then
            fail "POST lat=$lat loss=$loss — reload flag not touched"
            continue
        fi
        pass "POST lat=$lat loss=$loss (config+flag)"
    done
done

# Test 3: GET after POST returns saved values + is_default=false
RES=$(run_cgi GET)
if echo "$RES" | jq -e '.success == true and .settings.latency.preset == "very-tolerant" and .settings.loss.preset == "very-tolerant" and .is_default == false' >/dev/null; then
    pass "GET after POST reflects saved values + is_default=false"
else
    fail "GET after POST — got: $RES"
fi

# Test 4: Invalid latency preset rejected
BODY='{"action":"save_settings","latency":{"preset":"bogus"},"loss":{"preset":"tolerant"}}'
LEN=${#BODY}
RES=$(printf '%s' "$BODY" | run_cgi POST application/json "$LEN")
if echo "$RES" | jq -e '.success == false and .error == "invalid_latency_preset"' >/dev/null; then
    pass "Invalid latency preset rejected"
else
    fail "Invalid latency preset — got: $RES"
fi

# Test 5: Invalid loss preset rejected
BODY='{"action":"save_settings","latency":{"preset":"tolerant"},"loss":{"preset":"bogus"}}'
LEN=${#BODY}
RES=$(printf '%s' "$BODY" | run_cgi POST application/json "$LEN")
if echo "$RES" | jq -e '.success == false and .error == "invalid_loss_preset"' >/dev/null; then
    pass "Invalid loss preset rejected"
else
    fail "Invalid loss preset — got: $RES"
fi

# Test 6: Missing action rejected
BODY='{}'
LEN=${#BODY}
RES=$(printf '%s' "$BODY" | run_cgi POST application/json "$LEN")
if echo "$RES" | jq -e '.success == false and .error == "missing_action"' >/dev/null; then
    pass "Missing action rejected"
else
    fail "Missing action — got: $RES"
fi

# Test 7: Unknown action rejected
BODY='{"action":"delete"}'
LEN=${#BODY}
RES=$(printf '%s' "$BODY" | run_cgi POST application/json "$LEN")
if echo "$RES" | jq -e '.success == false and .error == "unknown_action"' >/dev/null; then
    pass "Unknown action rejected"
else
    fail "Unknown action — got: $RES"
fi

# Test 8: Atomic write — no .tmp lingers
if [ -f "${QUALITY_CONFIG}.tmp" ]; then
    fail "Atomic write — .tmp file lingers after success"
else
    pass "Atomic write — no .tmp file lingers"
fi

# Test 9: Malformed JSON config falls back to tolerant on GET
echo 'not valid json' > "$QUALITY_CONFIG"
RES=$(run_cgi GET)
if echo "$RES" | jq -e '.success == true and .settings.latency.preset == "tolerant" and .settings.loss.preset == "tolerant"' >/dev/null; then
    pass "GET with malformed config falls back to tolerant"
else
    fail "GET with malformed config — got: $RES"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bash scripts/test/quality-thresholds-cgi.sh
```

Expected: FAIL — "CGI script not found".

- [ ] **Step 3: Implement the CGI**

Create `scripts/www/cgi-bin/quecmanager/settings/quality_thresholds.sh`:

```sh
#!/bin/sh
# =============================================================================
# quality_thresholds.sh — CGI Endpoint: Latency & Loss Thresholds (GET + POST)
# =============================================================================
# GET:  Returns current per-row preset selections + is_default flag.
# POST: Saves preset selections (one of standard/tolerant/very-tolerant per row),
#       writes /etc/qmanager/quality_thresholds.json atomically, pokes the
#       events.sh reload flag at /tmp/qmanager_events_reload.
#
# Threshold values themselves resolve in scripts/usr/lib/qmanager/events.sh
# (single source of truth) — this CGI writes only preset names.
#
# Endpoint: GET/POST /cgi-bin/quecmanager/settings/quality_thresholds.sh
# Install location: /www/cgi-bin/quecmanager/settings/quality_thresholds.sh
# =============================================================================

LIB_DIR="${QM_LIB_DIR:-/usr/lib/qmanager}"
. "$LIB_DIR/cgi_base.sh"

qlog_init "cgi_quality_thresholds"
cgi_headers
cgi_handle_options

CONFIG="${QUALITY_CONFIG:-/etc/qmanager/quality_thresholds.json}"
RELOAD_FLAG="${QUALITY_RELOAD_FLAG:-/tmp/qmanager_events_reload}"

VALID_PRESETS='standard tolerant very-tolerant'

is_valid_preset() {
    case "$1" in
        standard|tolerant|very-tolerant) return 0 ;;
        *) return 1 ;;
    esac
}

# =============================================================================
# GET — Fetch current presets
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching quality thresholds"

    lat="tolerant"
    loss="tolerant"
    is_default=true

    if [ -f "$CONFIG" ]; then
        is_default=false
        v_lat=$(jq -r '.latency.preset // empty' "$CONFIG" 2>/dev/null) || v_lat=""
        v_loss=$(jq -r '.loss.preset // empty' "$CONFIG" 2>/dev/null) || v_loss=""
        case "$v_lat" in
            standard|tolerant|very-tolerant) lat="$v_lat" ;;
            *) qlog_warn "quality_thresholds.json had unexpected latency preset '$v_lat', returning default" ;;
        esac
        case "$v_loss" in
            standard|tolerant|very-tolerant) loss="$v_loss" ;;
            *) qlog_warn "quality_thresholds.json had unexpected loss preset '$v_loss', returning default" ;;
        esac
    fi

    jq -n --arg lat "$lat" --arg loss "$loss" --argjson is_default "$is_default" \
        '{success: true, settings: {latency: {preset: $lat}, loss: {preset: $loss}}, is_default: $is_default}'
    exit 0
fi

# =============================================================================
# POST — Save presets
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

    new_lat=$(printf '%s' "$POST_DATA" | jq -r '.latency.preset // empty' 2>/dev/null)
    if ! is_valid_preset "$new_lat"; then
        cgi_error "invalid_latency_preset" "latency.preset must be one of: $VALID_PRESETS"
        exit 0
    fi

    new_loss=$(printf '%s' "$POST_DATA" | jq -r '.loss.preset // empty' 2>/dev/null)
    if ! is_valid_preset "$new_loss"; then
        cgi_error "invalid_loss_preset" "loss.preset must be one of: $VALID_PRESETS"
        exit 0
    fi

    mkdir -p "$(dirname "$CONFIG")"

    # Atomic write: jq into .tmp, then mv.
    if ! jq -n --arg lat "$new_lat" --arg loss "$new_loss" \
        '{latency: {preset: $lat}, loss: {preset: $loss}}' > "${CONFIG}.tmp"; then
        rm -f "${CONFIG}.tmp"
        cgi_error "write_failed" "Failed to generate config JSON"
        exit 0
    fi

    if ! mv "${CONFIG}.tmp" "$CONFIG"; then
        rm -f "${CONFIG}.tmp"
        cgi_error "write_failed" "Failed to write config file"
        exit 0
    fi

    qlog_info "Quality thresholds saved: latency=$new_lat loss=$new_loss"

    # Poke events.sh reload (failure non-fatal; old config remains active).
    if ! touch "$RELOAD_FLAG" 2>/dev/null; then
        qlog_warn "Failed to touch reload flag at $RELOAD_FLAG (poller may not reload until restart)"
    fi

    cgi_success
    exit 0
fi

# =============================================================================
# Unsupported method
# =============================================================================
cgi_error "method_not_allowed" "Only GET and POST are supported"
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bash scripts/test/quality-thresholds-cgi.sh
```

Expected:
```
PASS: GET with no config returns tolerant defaults + is_default=true
PASS: POST lat=standard loss=standard (config+flag)
... (9 POST combinations)
PASS: GET after POST reflects saved values + is_default=false
PASS: Invalid latency preset rejected
PASS: Invalid loss preset rejected
PASS: Missing action rejected
PASS: Unknown action rejected
PASS: Atomic write — no .tmp file lingers
PASS: GET with malformed config falls back to tolerant

Results: 17 passed, 0 failed
```

- [ ] **Step 5: Run the full pre-build gate**

```bash
bash scripts/test/run-all.sh
bash scripts/test/run-harnesses.sh
```

Expected: both PASS, no syntax errors, no harness failures.

- [ ] **Step 6: Commit**

```bash
git add scripts/www/cgi-bin/quecmanager/settings/quality_thresholds.sh scripts/test/quality-thresholds-cgi.sh
git commit -m "feat(cgi): quality_thresholds GET/POST endpoint"
```

---

## Task 4: Frontend — types

**Files:**
- Modify: `types/modem-status.ts` (append new types after `PING_PROFILES` declaration around line 340)

- [ ] **Step 1: Append the type declarations**

Open `types/modem-status.ts` and locate the `PING_PROFILES` array around line 335–340:

```ts
export const PING_PROFILES: readonly PingProfile[] = [
  "sensitive",
  "regular",
  "relaxed",
  "quiet",
] as const;
```

Insert this block immediately after that closing bracket and before the `export type ConnectivityState` declaration:

```ts
/** User-selectable preset for high_latency / high_packet_loss event thresholds. */
export type QualityPreset = "standard" | "tolerant" | "very-tolerant";

/** Display-order list of quality presets. */
export const QUALITY_PRESETS: readonly QualityPreset[] = [
  "standard",
  "tolerant",
  "very-tolerant",
] as const;

/** Persisted shape of /etc/qmanager/quality_thresholds.json (also the GET response settings field). */
export interface QualityThresholdsSettings {
  latency: { preset: QualityPreset };
  loss: { preset: QualityPreset };
}
```

- [ ] **Step 2: Type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add types/modem-status.ts
git commit -m "types(modem-status): QualityPreset + QualityThresholdsSettings"
```

---

## Task 5: Frontend — `useQualityThresholds` hook

**Files:**
- Create: `hooks/use-quality-thresholds.ts`

**Reference:** Mirror the structure of `hooks/use-ping-profile.ts`.

- [ ] **Step 1: Create the hook**

Create `hooks/use-quality-thresholds.ts`:

```ts
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { QualityThresholdsSettings } from "@/types/modem-status";

// =============================================================================
// useQualityThresholds — Fetch & Save Hook for Latency & Loss Thresholds
// =============================================================================
// Backend: GET/POST /cgi-bin/quecmanager/settings/quality_thresholds.sh
//
// GET returns { success, settings: QualityThresholdsSettings, is_default }.
// POST { action: "save_settings", ...QualityThresholdsSettings } writes the
// config and pokes /tmp/qmanager_events_reload; events.sh picks up the
// change at the start of its next detection cycle.
// =============================================================================

const ENDPOINT = "/cgi-bin/quecmanager/settings/quality_thresholds.sh";

interface QualityThresholdsResponse {
  success: boolean;
  settings?: QualityThresholdsSettings;
  is_default?: boolean;
  error?: string;
  detail?: string;
}

export interface UseQualityThresholdsReturn {
  thresholds: QualityThresholdsSettings | undefined;
  isDefault: boolean;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  saveError: string | null;
  save: (next: QualityThresholdsSettings) => Promise<QualityThresholdsResponse>;
}

export function useQualityThresholds(): UseQualityThresholdsReturn {
  const [thresholds, setThresholds] = useState<
    QualityThresholdsSettings | undefined
  >(undefined);
  const [isDefault, setIsDefault] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchThresholds = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const json: QualityThresholdsResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success || !json.settings) {
        throw new Error(
          json.detail ?? json.error ?? "Failed to load thresholds",
        );
      }

      setThresholds(json.settings);
      setIsDefault(Boolean(json.is_default));
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to load thresholds",
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchThresholds();
  }, [fetchThresholds]);

  const save = useCallback(
    async (
      next: QualityThresholdsSettings,
    ): Promise<QualityThresholdsResponse> => {
      setSaveError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_settings",
            latency: next.latency,
            loss: next.loss,
          }),
        });

        const json: QualityThresholdsResponse = await resp.json();
        if (!mountedRef.current) return json;

        if (!json.success) {
          throw new Error(json.detail ?? json.error ?? "Save failed");
        }

        // Optimistic update + silent re-fetch (clears is_default to false).
        setThresholds(next);
        fetchThresholds(true);

        return json;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Save failed";
        if (mountedRef.current) setSaveError(msg);
        throw err;
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [fetchThresholds],
  );

  return {
    thresholds,
    isDefault,
    isLoading,
    error,
    isSaving,
    saveError,
    save,
  };
}
```

- [ ] **Step 2: Type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add hooks/use-quality-thresholds.ts
git commit -m "feat(hook): useQualityThresholds React Query hook"
```

---

## Task 6: Frontend — `QualityThresholdsCard` component

**Files:**
- Create: `components/system-settings/quality-thresholds-card.tsx`

**Reference:** Layout and animation conventions mirror `components/system-settings/connectivity-sensitivity-card.tsx`. The chip-meta-pair structure is identical.

- [ ] **Step 1: Create the card**

Create `components/system-settings/quality-thresholds-card.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
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

import { useQualityThresholds } from "@/hooks/use-quality-thresholds";
import { useModemStatus } from "@/hooks/use-modem-status";
import {
  QUALITY_PRESETS,
  type QualityPreset,
  type QualityThresholdsSettings,
} from "@/types/modem-status";

// ─── Animation variants ────────────────────────────────────────────────────

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
};

// ─── Preset metadata ────────────────────────────────────────────────────────

interface PresetMeta {
  label: string;
  blurb: string;
  threshold: number;
  debounce: number;
}

const LATENCY_META: Record<QualityPreset, PresetMeta> = {
  standard: {
    label: "Standard",
    blurb: "Good cellular. Flags any sustained latency over 150 ms.",
    threshold: 150,
    debounce: 3,
  },
  tolerant: {
    label: "Tolerant",
    blurb: "Average cellular. Allows occasional spikes before flagging.",
    threshold: 250,
    debounce: 3,
  },
  "very-tolerant": {
    label: "Very Tolerant",
    blurb: "Poor signal areas. Only flags when latency stays high for a while.",
    threshold: 500,
    debounce: 2,
  },
};

const LOSS_META: Record<QualityPreset, PresetMeta> = {
  standard: {
    label: "Standard",
    blurb: "Tight quality bar. Flags loss above 15 %.",
    threshold: 15,
    debounce: 3,
  },
  tolerant: {
    label: "Tolerant",
    blurb: "Acceptable on cellular under load. Won't fire from short bursts.",
    threshold: 30,
    debounce: 3,
  },
  "very-tolerant": {
    label: "Very Tolerant",
    blurb: "Severe drops only — useful in poor signal areas.",
    threshold: 50,
    debounce: 2,
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return `${Math.round(ms)} ms`;
}

function formatLoss(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return "—";
  return `${pct} %`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function QualityThresholdsCard() {
  const { thresholds, isDefault, isLoading, error, isSaving, saveError, save } =
    useQualityThresholds();
  const { data: modemStatus } = useModemStatus();
  const { saved, markSaved } = useSaveFlash();

  const [selected, setSelected] = useState<QualityThresholdsSettings | undefined>(
    thresholds,
  );

  useEffect(() => {
    if (thresholds && !selected) setSelected(thresholds);
  }, [thresholds, selected]);

  const isDirty = useMemo(() => {
    if (!thresholds || !selected) return false;
    return (
      selected.latency.preset !== thresholds.latency.preset ||
      selected.loss.preset !== thresholds.loss.preset
    );
  }, [thresholds, selected]);

  const canSave = isDirty && !isSaving;

  const handleSave = async () => {
    if (!canSave || !selected) return;
    try {
      await save(selected);
      markSaved();
      toast.success("Quality thresholds updated");
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
          <CardTitle>Latency &amp; Loss Thresholds</CardTitle>
          <CardDescription>
            When QManager flags slow latency or packet loss as a network event.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-20 w-full rounded-md" />
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
  if (error && !thresholds) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Latency &amp; Loss Thresholds</CardTitle>
          <CardDescription>
            When QManager flags slow latency or packet loss as a network event.
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

  if (!selected) return null;

  const latPreset = selected.latency.preset;
  const lossPreset = selected.loss.preset;
  const latMeta = LATENCY_META[latPreset];
  const lossMeta = LOSS_META[lossPreset];

  const liveLatency = modemStatus?.connectivity?.latency_ms ?? null;
  const liveLoss = modemStatus?.connectivity?.packet_loss_pct ?? null;

  const latencyOk =
    liveLatency === null || liveLatency <= latMeta.threshold;
  const lossOk = liveLoss === null || liveLoss < lossMeta.threshold;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Latency &amp; Loss Thresholds</CardTitle>
        <CardDescription>
          When QManager flags slow latency or packet loss as a network event.
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
          className="grid gap-5"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* ── Latency row ─────────────────────────────────────────── */}
          <motion.div variants={itemVariants} className="grid gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Latency</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                Current: <span className="font-semibold">{formatLatency(liveLatency)}</span>
              </span>
            </div>

            <ToggleGroup
              type="single"
              value={latPreset}
              onValueChange={(v) => {
                if (v && (QUALITY_PRESETS as readonly string[]).includes(v)) {
                  setSelected({
                    ...selected,
                    latency: { preset: v as QualityPreset },
                  });
                }
              }}
              className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1"
              aria-label="Latency threshold preset"
            >
              {QUALITY_PRESETS.map((p) => (
                <ToggleGroupItem
                  key={p}
                  value={p}
                  className="data-[state=on]:bg-background data-[state=on]:shadow-sm rounded-sm text-sm"
                  aria-label={`${LATENCY_META[p].label} (${LATENCY_META[p].threshold} ms)`}
                >
                  {LATENCY_META[p].label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <div className="rounded-md border bg-muted/40 px-3 py-2.5 text-sm">
              <p className="text-foreground">
                <span className="font-semibold">{latMeta.label}</span>
                <span className="text-muted-foreground"> — {latMeta.blurb}</span>
              </p>
              <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1">
                <MetaPair label="Threshold" value={`${latMeta.threshold} ms`} />
                <MetaPair label="Debounce" value={`${latMeta.debounce} samples`} />
                <MetaPair
                  label="Current"
                  value={formatLatency(liveLatency)}
                  glyph={
                    liveLatency === null
                      ? null
                      : latencyOk
                        ? "ok"
                        : "warn"
                  }
                />
              </div>
            </div>
          </motion.div>

          <Separator />

          {/* ── Packet loss row ─────────────────────────────────────── */}
          <motion.div variants={itemVariants} className="grid gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Packet loss</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                Current: <span className="font-semibold">{formatLoss(liveLoss)}</span>
              </span>
            </div>

            <ToggleGroup
              type="single"
              value={lossPreset}
              onValueChange={(v) => {
                if (v && (QUALITY_PRESETS as readonly string[]).includes(v)) {
                  setSelected({
                    ...selected,
                    loss: { preset: v as QualityPreset },
                  });
                }
              }}
              className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1"
              aria-label="Packet loss threshold preset"
            >
              {QUALITY_PRESETS.map((p) => (
                <ToggleGroupItem
                  key={p}
                  value={p}
                  className="data-[state=on]:bg-background data-[state=on]:shadow-sm rounded-sm text-sm"
                  aria-label={`${LOSS_META[p].label} (${LOSS_META[p].threshold} percent)`}
                >
                  {LOSS_META[p].label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <div className="rounded-md border bg-muted/40 px-3 py-2.5 text-sm">
              <p className="text-foreground">
                <span className="font-semibold">{lossMeta.label}</span>
                <span className="text-muted-foreground"> — {lossMeta.blurb}</span>
              </p>
              <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1">
                <MetaPair label="Threshold" value={`${lossMeta.threshold} %`} />
                <MetaPair label="Debounce" value={`${lossMeta.debounce} samples`} />
                <MetaPair
                  label="Current"
                  value={formatLoss(liveLoss)}
                  glyph={liveLoss === null ? null : lossOk ? "ok" : "warn"}
                />
              </div>
            </div>
          </motion.div>

          {isDefault && (
            <motion.p
              variants={itemVariants}
              className="text-xs text-muted-foreground"
            >
              Default after recent update — pick Standard for stricter thresholds.
            </motion.p>
          )}

          {/* ── Save button ──────────────────────────────────────────── */}
          <motion.div variants={itemVariants} className="flex justify-end">
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

function MetaPair({
  label,
  value,
  glyph = null,
}: {
  label: string;
  value: string;
  glyph?: "ok" | "warn" | null;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums flex items-center gap-1.5">
        {value}
        {glyph === "ok" && <span className="text-success">●</span>}
        {glyph === "warn" && (
          <span className="text-warning animate-pulse">⚠</span>
        )}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/system-settings/quality-thresholds-card.tsx
git commit -m "feat(ui): QualityThresholdsCard for System Settings"
```

---

## Task 7: Frontend — wire card into System Settings page

**Files:**
- Modify: `components/system-settings/system-settings.tsx`

- [ ] **Step 1: Add the import and the JSX mount**

Open `components/system-settings/system-settings.tsx`. Add the new import alongside the existing card imports:

```tsx
import QualityThresholdsCard from "@/components/system-settings/quality-thresholds-card";
```

Then in the JSX, insert `<QualityThresholdsCard />` immediately after `<ConnectivitySensitivityCard />`:

```tsx
        <ConnectivitySensitivityCard />
        <QualityThresholdsCard />
```

The full file should look like:

```tsx
"use client";

import { useSystemSettings } from "@/hooks/use-system-settings";
import SystemSettingsCard from "@/components/system-settings/system-settings-card";
import ScheduledOperationsCard from "@/components/system-settings/scheduled-operations-card";
import SSHPasswordCard from "@/components/system-settings/ssh-password-card";
import ModemSubsystemCard from "@/components/system-settings/modem-subsystem-card";
import ConnectivitySensitivityCard from "@/components/system-settings/connectivity-sensitivity-card";
import QualityThresholdsCard from "@/components/system-settings/quality-thresholds-card";

const SystemSettings = () => {
  const hookData = useSystemSettings();

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">System Settings</h1>
      </div>
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
        <SystemSettingsCard {...hookData} />
        <ScheduledOperationsCard {...hookData} />
        <SSHPasswordCard />
        <ModemSubsystemCard />
        <ConnectivitySensitivityCard />
        <QualityThresholdsCard />
      </div>
    </div>
  );
};

export default SystemSettings;
```

- [ ] **Step 2: Type-check + lint**

```bash
bunx tsc --noEmit
bun run lint
```

Expected: no errors, no warnings.

- [ ] **Step 3: Commit**

```bash
git add components/system-settings/system-settings.tsx
git commit -m "feat(ui): mount QualityThresholdsCard in System Settings"
```

---

## Task 8: RELEASE_NOTES.md entry

**Files:**
- Modify: `RELEASE_NOTES.md`

- [ ] **Step 1: Read current RELEASE_NOTES.md to find the in-progress version section**

```bash
head -40 RELEASE_NOTES.md
```

Identify the current unreleased version's `### New Features` block (the topmost one). If no `### New Features` block exists for the current version, add one above any existing `### Improvements` block.

- [ ] **Step 2: Add the bullet**

Insert this bullet at the top of the `### New Features` list:

```markdown
- **Configurable Latency & Loss Thresholds** — Recent Activities no longer floods with `High Latency` events on average cellular signal. New System Settings card lets you pick `Standard / Tolerant / Very Tolerant` per row. **Default changes from 90 ms / 20 % to 250 ms / 30 %** — pick `Standard` if you want stricter thresholds.
```

- [ ] **Step 3: Verify formatting**

```bash
head -20 RELEASE_NOTES.md
```

Expected: the new bullet appears under `### New Features`, sentence-case bold lead-in, no trailing whitespace.

- [ ] **Step 4: Commit**

```bash
git add RELEASE_NOTES.md
git commit -m "docs(release): announce Latency & Loss Thresholds card + default change"
```

---

## Task 9: Final verification — full test gate

**Files:** None changed in this task — it's a verification gate.

- [ ] **Step 1: Run the full pre-build gate**

```bash
bash scripts/test/run-all.sh
```

Expected: PASS — N scripts parsed cleanly. Confirms no shell syntax regressions.

- [ ] **Step 2: Run all functional harnesses**

```bash
bash scripts/test/run-harnesses.sh
```

Expected: All harnesses PASS, including the two new ones (`events-quality-thresholds.sh`, `quality-thresholds-cgi.sh`).

- [ ] **Step 3: Run TypeScript type-check + ESLint**

```bash
bunx tsc --noEmit
bun run lint
```

Expected: no errors, no warnings.

- [ ] **Step 4: Run full Next.js build to catch any production-build regressions**

```bash
bun run build
```

Expected: build succeeds, no errors.

- [ ] **Step 5: No commit needed for this task — verification only**

If all four steps PASS, the implementation is complete and ready for UAT against a live device. No git activity in this task.

---

## Out of scope for this plan (verified)

- `qmanager_poller` daemon entry point — sources `events.sh` already; no init changes needed (`_qt_load` runs at source-time)
- `qmanager_ping` Rust daemon — separate concern (presence vs. quality)
- Watchcat / SimFailover / `email_alerts.sh` / `sms_alerts.sh` — none consume `high_latency`/`high_packet_loss` events
- Discord bot — `/events` reads the events ring buffer; new event volume is *lower*, not different shape
- Installer — already glob-deploys CGI scripts and `scripts/etc/qmanager/` contents

## Live-device UAT checklist (post-merge, not in plan)

After deployment to the test device:

1. Open `/system-settings`. Expect the new card to render directly below `Connectivity Sensitivity`.
2. With default `Tolerant` preset and current ~150 ms baseline: confirm event count drops from ~25/h to ≤ 2/h over a 1 h window.
3. Switch to `Standard`: confirm event count rises (closer to old behaviour).
4. Switch to `Very Tolerant`: confirm only sustained 500 ms+ flapping fires events.
5. Confirm `is_default` hint disappears after first save.
6. Confirm Save button is disabled when no chip changes are pending.
7. Toggle dark/light mode: confirm parity.
