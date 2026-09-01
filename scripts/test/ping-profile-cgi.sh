#!/bin/sh
# Smoke test for /cgi-bin/quecmanager/settings/ping_profile.sh
# Invokes the CGI script directly (no HTTP / no auth) and validates output.
#
# WHAT CHANGED AND WHY
# --------------------
# The probe chain grew from two slots (target_ipv4 tried first, target_ipv6 as
# fallback) to four, in a fixed probe order:
#
#     target_host_1  target_host_2  target_ip_1  target_ip_2
#
# The two slot KINDS validate differently, and mixing them up is the defect
# this file exists to catch:
#
#   - a host_ slot takes a hostname. The resolver, not a config key, decides
#     the address family, so there is no v4/v6 slot distinction any more.
#   - an ip_ slot takes an IPv4 LITERAL. It is the DNS-independent fallback, so
#     a hostname there defeats the entire point of the leg -- if the resolver is
#     the thing that is broken, a hostname fallback fails for the same reason
#     the hostname legs already did, and the device reports an outage it does
#     not have.
#
# The retired keys (target_ipv4, target_ipv6, intercept_secs) must be gone from
# this endpoint entirely, and the atomic key-merge must still leave the
# daemon-owned cadence and debounce keys alone.
#
# Run on the device or on a host with the script + dependencies present.
# Requires: jq.
#
# Test files use a temp dir so this is non-destructive to the running daemon.
#
# This harness is COMMITTED RED, before the four-slot CGI exists
# (change-workflow.md, Phase 4a). The builder who writes the CGI does not edit
# this file.
#
# `set -u` but deliberately NOT `set -e`: this file counts failures and reports
# them all. Under `set -e` the first jq that runs against a config the CGI
# refused to write aborts the whole run at exit 2, and every later assertion --
# including the validator coverage that is the point of this change -- silently
# never runs.
set -u

if ! command -v jq >/dev/null; then
    echo "SKIP: jq not found" >&2
    exit 0
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

# post <json-body> — POST it and echo the CGI's response.
post() {
    _body="$1"
    _len=${#_body}
    printf '%s' "$_body" | run_cgi POST application/json "$_len"
}

# A well-formed save carrying all four slots.
GOOD='{"action":"save_settings","profile":"relaxed","target_host_1":"cloudflare.com","target_host_2":"google.com","target_ip_1":"1.1.1.1","target_ip_2":"8.8.8.8"}'

# body_with <slot> <value> — GOOD with one slot replaced, for validator tests.
body_with() {
    printf '%s' "$GOOD" | jq -c --arg k "$1" --arg v "$2" '.[$k] = $v'
}

# reject_slot <slot> <value> <label>
#
# A rejection is only evidence if it is a rejection of the RIGHT thing. The
# endpoint currently refuses every body in this file because it is still
# looking for target_ipv4, so a bare "success == false" check would report a
# green validator that does not exist. The detail string must name the slot
# under test.
reject_slot() {
    _slot="$1"; _val="$2"; _label="$3"
    _res=$(post "$(body_with "$_slot" "$_val")")
    if ! echo "$_res" | jq -e '.success == false and .error == "invalid_target"' >/dev/null 2>&1; then
        fail "$_label — expected invalid_target, got: $_res"
        return
    fi
    if echo "$_res" | jq -r '.detail // ""' | grep -q "$_slot"; then
        pass "$_label"
    else
        fail "$_label — rejected, but the detail does not name $_slot: $_res"
    fi
}

# Test 1: GET with no config file returns relaxed default
rm -f "$PING_PROFILE_CONFIG"
RES=$(run_cgi GET)
if echo "$RES" | jq -e '.success == true and .settings.profile == "relaxed"' >/dev/null; then
    pass "GET with no config returns relaxed default"
else
    fail "GET with no config returns relaxed default — got: $RES"
fi

# Test 1b: GET exposes all four target slots with their documented defaults
for pair in "target_host_1:cloudflare.com" "target_host_2:google.com" "target_ip_1:1.1.1.1" "target_ip_2:8.8.8.8"; do
    key="${pair%%:*}"; want="${pair#*:}"
    got=$(echo "$RES" | jq -r ".settings.$key // \"<absent>\"")
    if [ "$got" = "$want" ]; then
        pass "GET default settings.$key = $want"
    else
        fail "GET default settings.$key = '$got', expected '$want'"
    fi
done

# Test 1c: the retired slots are gone from the GET payload
for key in target_ipv4 target_ipv6 intercept_secs; do
    if echo "$RES" | jq -e ".settings | has(\"$key\")" >/dev/null 2>&1; then
        fail "GET still exposes the retired settings.$key"
    else
        pass "GET no longer exposes settings.$key"
    fi
done

# Test 2: POST each valid profile, verify file + reload flag + all four slots
for p in sensitive regular relaxed quiet; do
    rm -f "$PING_PROFILE_RELOAD_FLAG"
    RES=$(post "$(printf '%s' "$GOOD" | jq -c --arg p "$p" '.profile = $p')")
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

# Test 2b: all four slots landed in the config file, not just the profile name
for pair in "target_host_1:cloudflare.com" "target_host_2:google.com" "target_ip_1:1.1.1.1" "target_ip_2:8.8.8.8"; do
    key="${pair%%:*}"; want="${pair#*:}"
    got=$(jq -r ".$key // \"<absent>\"" "$PING_PROFILE_CONFIG" 2>/dev/null)
    if [ "$got" = "$want" ]; then
        pass "saved config carries $key = $want"
    else
        fail "saved config $key = '$got', expected '$want'"
    fi
done

# Test 3: GET after POST returns the saved profile
RES=$(run_cgi GET)
if echo "$RES" | jq -e '.success == true and .settings.profile == "quiet"' >/dev/null; then
    pass "GET after POST reflects saved profile"
else
    fail "GET after POST — got: $RES"
fi

# Test 4: Invalid profile rejected
RES=$(post '{"action":"save_settings","profile":"bogus"}')
if echo "$RES" | jq -e '.success == false and .error == "invalid_profile"' >/dev/null; then
    pass "Invalid profile rejected"
else
    fail "Invalid profile rejected — got: $RES"
fi

# Test 5: Missing action rejected
RES=$(post '{}')
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

# ─── Slot validation: every slot is required ────────────────────────────────
for slot in target_host_1 target_host_2 target_ip_1 target_ip_2; do
    reject_slot "$slot" "" "empty $slot rejected"
done

# ─── Slot validation: shell metacharacters rejected in every slot ───────────
for slot in target_host_1 target_host_2 target_ip_1 target_ip_2; do
    reject_slot "$slot" '1.1.1.1";rm -rf /tmp' "shell metacharacter in $slot rejected"
done

# ─── Slot validation: an ip_ slot rejects a HOSTNAME ────────────────────────
# The literal legs exist precisely so the verdict survives a broken resolver.
# A hostname here fails for the same reason the two hostname legs already did,
# and the device then reports an outage it does not have.
for slot in target_ip_1 target_ip_2; do
    reject_slot "$slot" "cloudflare.com" "hostname in $slot rejected (it must be an IPv4 literal)"
done

# ─── Slot validation: an ip_ slot rejects an IPv6 literal ───────────────────
# The literal slots are IPv4 by definition; the family question moved to the
# resolver on the hostname legs.
reject_slot target_ip_1 '2606:4700:4700::1111' "IPv6 literal in target_ip_1 rejected"

# ─── Slot validation: an ip_ slot rejects a malformed dotted quad ───────────
for badip in "1.1.1" "1.1.1.1.1" "999.1.1.1" "1.1.1.-1"; do
    reject_slot target_ip_2 "$badip" "malformed IPv4 literal '$badip' rejected in target_ip_2"
done

# ─── Slot validation: a host_ slot rejects an out-of-charset hostname ───────
# A hostname is letters, digits, hyphen and dot. Everything else is either a
# shell hazard or something ping could never resolve.
for badhost in "under_score.example" "space here.com" "bad|pipe.com" "-leading.example" "trailing-.example" "double..dot.com"; do
    reject_slot target_host_1 "$badhost" "charset violation '$badhost' rejected in target_host_1"
done

# ─── Slot validation: a legitimate hostname is accepted in a host_ slot ─────
RES=$(post "$(body_with target_host_2 "one.one.one.one")")
if echo "$RES" | jq -e '.success == true' >/dev/null; then
    pass "a well-formed hostname is accepted in target_host_2"
else
    fail "a well-formed hostname was rejected in target_host_2 — got: $RES"
fi

# ─── Corrupt config self-heals on save (regression: cf177d0) ────────────────
# Test 7 above leaves malformed JSON in place ON PURPOSE and the save-path
# tests below inherit it — that is this file's coverage of the corrupt-config
# case, not cross-talk. Do not "clean it up".
# The save path merges into the existing file, so unusable content used to
# abort jq and fail every save forever while GET still served defaults. Each
# shape below must self-heal to a valid object, not a write_failed.
for BAD in 'this is not valid json' '' '   ' 'null' '5' '[1,2]'; do
    printf '%s' "$BAD" > "$PING_PROFILE_CONFIG"
    RES=$(post "$(printf '%s' "$GOOD" | jq -c '.profile = "regular"')")
    if echo "$RES" | jq -e '.success == true' >/dev/null 2>&1 &&
        jq -e 'type == "object" and .profile == "regular"' "$PING_PROFILE_CONFIG" >/dev/null 2>&1; then
        pass "save over unusable config self-heals [<$BAD>]"
    else
        fail "save over unusable config [<$BAD>] — got: $RES / config: $(cat "$PING_PROFILE_CONFIG")"
    fi
done

# The save must never promote a zero-byte temp file over a live config.
if [ -s "$PING_PROFILE_CONFIG" ]; then
    pass "config is non-empty after corrupt-config recovery"
else
    fail "config was truncated to zero bytes by the recovery path"
fi

# ─── The atomic key-merge leaves the daemon-owned keys intact ───────────────
# interval_sec is the single home for probe cadence and is written by a
# different owner (the Watchdog CGI). fail_secs / recover_secs / history_secs
# are the daemon's own debounce tuning. A save that rebuilds the object instead
# of merging into it silently resets all four.
printf '%s' '{"profile":"relaxed","interval_sec":7,"fail_secs":21,"recover_secs":11,"history_secs":420,"target_host_1":"cloudflare.com","target_host_2":"google.com","target_ip_1":"1.1.1.1","target_ip_2":"8.8.8.8"}' > "$PING_PROFILE_CONFIG"
RES=$(post "$(printf '%s' "$GOOD" | jq -c '.profile = "quiet"')")
if echo "$RES" | jq -e '.success == true' >/dev/null; then
    for pair in "interval_sec:7" "fail_secs:21" "recover_secs:11" "history_secs:420"; do
        key="${pair%%:*}"; want="${pair#*:}"
        got=$(jq -r ".$key // \"<absent>\"" "$PING_PROFILE_CONFIG")
        if [ "$got" = "$want" ]; then
            pass "atomic key-merge preserves $key across save"
        else
            fail "atomic key-merge lost $key (got '$got', expected '$want')"
        fi
    done
else
    fail "the merge-preservation save was rejected — got: $RES"
fi

# ─── STATIC: the retired keys are gone from the endpoint ────────────────────
# Comments are stripped first so this file's own prose about the retired keys
# cannot satisfy or trip the assertion.
CGI_CODE=$(sed -e 's/#.*$//' "$CGI")
for gone in target_ipv4 target_ipv6 intercept_secs; do
    if printf '%s' "$CGI_CODE" | grep -q "$gone"; then
        fail "ping_profile.sh still references the retired $gone"
    else
        pass "ping_profile.sh no longer references $gone"
    fi
done
# ...and the new slots are genuinely named in the code, not merely tolerated.
for sym in target_host_1 target_host_2 target_ip_1 target_ip_2; do
    if printf '%s' "$CGI_CODE" | grep -q "$sym"; then
        pass "ping_profile.sh names $sym"
    else
        fail "ping_profile.sh never names $sym"
    fi
done

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
