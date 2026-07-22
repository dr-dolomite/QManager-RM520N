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
cgi_error()   { printf '{"success":false,"error":"%s","detail":"%s"}\n' "$1" "$2"; }
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
    BODY="{\"action\":\"save_settings\",\"profile\":\"$p\",\"target_ipv4\":\"1.1.1.1\",\"target_ipv6\":\"2606:4700:4700::1111\"}"
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
if echo "$RES" | jq -e '.success == false and .error == "missing_action"' >/dev/null; then
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

# ─── Target validation: empty target rejected ───────────────────────────────
BODY='{"action":"save_settings","profile":"relaxed","target_ipv4":"","target_ipv6":"2606:4700:4700::1111"}'
LEN=${#BODY}
RES=$(printf '%s' "$BODY" | run_cgi POST application/json "$LEN")
if echo "$RES" | jq -e '.success == false and .error == "invalid_target"' >/dev/null; then
    pass "empty target_ipv4 rejected"
else
    fail "empty target_ipv4 rejected — got: $RES"
fi

# ─── Target validation: shell-injection attempt rejected ────────────────────
BODY='{"action":"save_settings","profile":"relaxed","target_ipv4":"1.1.1.1\";rm -rf /tmp","target_ipv6":"2606:4700:4700::1111"}'
LEN=${#BODY}
RES=$(printf '%s' "$BODY" | run_cgi POST application/json "$LEN")
if echo "$RES" | jq -e '.success == false and .error == "invalid_target"' >/dev/null; then
    pass "shell metacharacter in target rejected"
else
    fail "shell metacharacter in target rejected — got: $RES"
fi

# ─── Target validation: bare IPv4 hostname accepted ─────────────────────────
BODY='{"action":"save_settings","profile":"relaxed","target_ipv4":"youtube.com","target_ipv6":"2606:4700:4700::1111"}'
LEN=${#BODY}
RES=$(printf '%s' "$BODY" | run_cgi POST application/json "$LEN")
if echo "$RES" | jq -e '.success == true' >/dev/null; then
    pass "bare IPv4-family hostname accepted"
else
    fail "bare IPv4-family hostname accepted — got: $RES"
fi

# ─── Target validation: IPv6 without a colon rejected ───────────────────────
BODY='{"action":"save_settings","profile":"relaxed","target_ipv4":"1.1.1.1","target_ipv6":"nocolonhere"}'
LEN=${#BODY}
RES=$(printf '%s' "$BODY" | run_cgi POST application/json "$LEN")
if echo "$RES" | jq -e '.success == false and .error == "invalid_target"' >/dev/null; then
    pass "IPv6 target without ':' rejected"
else
    fail "IPv6 target without ':' rejected — got: $RES"
fi

# ─── Target validation: previously-set keys survive an unrelated field merge ─
# The atomic key-merge must leave interval_sec (daemon/Watchdog-owned) intact
# across a profile+targets save.
printf '%s' '{"profile":"relaxed","interval_sec":7,"target_ipv4":"1.1.1.1","target_ipv6":"2606:4700:4700::1111"}' > "$PING_PROFILE_CONFIG"
BODY='{"action":"save_settings","profile":"quiet","target_ipv4":"1.1.1.1","target_ipv6":"2606:4700:4700::1111"}'
LEN=${#BODY}
RES=$(printf '%s' "$BODY" | run_cgi POST application/json "$LEN")
if echo "$RES" | jq -e '.success == true' >/dev/null && [ "$(jq -r .interval_sec "$PING_PROFILE_CONFIG")" = "7" ]; then
    pass "atomic key-merge preserves interval_sec across save"
else
    fail "atomic key-merge preserves interval_sec — config: $(cat "$PING_PROFILE_CONFIG")"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
