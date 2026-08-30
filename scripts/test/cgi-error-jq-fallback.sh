#!/usr/bin/env bash
# Regression harness for cgi_error's jq-free fallback in
# scripts/usr/lib/qmanager/cgi_base.sh (F2, Phase A tracker).
#
# WHY THIS EXISTS
# ----------------
# cgi_error is the single error reporter for 53 CGI scripts (81 endpoints),
# and it was ITSELF a `jq -n` call. On a device where the Entware bootstrap
# failed, /opt/bin/jq does not exist — so every endpoint answered with a
# 200, the right Content-Type, and a COMPLETELY EMPTY BODY. The web UI went
# mute with nothing to trace: the error reporter depended on the very thing
# that was missing. See docs/reference/rg501q-bringup.md for the bootstrap
# failure that surfaced this.
#
# The fix keeps jq as the primary path and falls back only when jq produced
# nothing. That detector is deliberately a BEHAVIOUR probe (run it, look at
# the output) and not `command -v jq` — a presence check cannot tell "a
# thing named jq" from "a jq that works", which is the exact defect class
# behind F1 / F5 / F6 / F16 in this same tracker.
#
# SCOPE PIN: the fallback is inside cgi_error ONLY. cgi_success,
# cgi_method_not_allowed, and cgi_auth.sh's require_auth stay jq-dependent
# by decision (tracker F2: "minimum viable fix: a jq-free fallback inside
# cgi_error only"). Section [5] pins that scope so a later change that
# quietly widens or narrows it is visible.
#
# Behavioural throughout: cgi_base.sh's library sources all have `|| { ...
# no-op fallbacks ... }` guards, so it can be sourced off-device, and
# _SKIP_AUTH=1 disables the load-time require_auth call.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CGI_BASE="$REPO_ROOT/scripts/usr/lib/qmanager/cgi_base.sh"

pass_count=0
fail_count=0

ok()  { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; }

[ -f "$CGI_BASE" ] || { echo "cgi_base.sh not found at $CGI_BASE" >&2; exit 1; }

# Resolve the REAL jq now, before any stubbing, so the escaping assertions
# have a trustworthy parser to validate against.
JQ_BIN=$(command -v jq 2>/dev/null || true)

# On Windows, jq emits CRLF; on both devices it emits LF (probed 2026-08-30
# on RM520N-GL 61368cd2 and RG501Q-EU b7e3d6f1). Strip CR before comparing
# so this harness gives the same verdict on the workstation and on-device.
strip_cr() { tr -d '\r'; }

# Run a snippet with cgi_base.sh sourced. $1 = extra shell code (stubs),
# $2 = the call to make.
run_cgi() {
    CGI_BASE="$CGI_BASE" _SKIP_AUTH=1 bash -c '
        set +e
        . "$CGI_BASE"
        '"$1"'
        '"$2"'
    ' 2>/dev/null || true
}

# The envelope every consumer reads: hooks do `data.detail || data.error`
# across ~40 call sites (hooks/use-auth.ts, use-band-locking.ts, ...), so
# the key set and types are the contract, not just "some JSON".
EXPECTED=$(printf '{\n  "success": false,\n  "error": "no_body",\n  "detail": "POST body is empty"\n}\n')

printf '\n[1] jq path still works and is still primary\n'

JQ_OUT=$(run_cgi '' 'cgi_error "no_body" "POST body is empty"' | strip_cr)

if [ -z "$JQ_OUT" ]; then
    bad "cgi_error produced nothing with a working jq — the primary path is broken"
elif [ "$JQ_OUT" = "$EXPECTED" ]; then
    ok "jq path emits the expected envelope"
else
    bad "jq path envelope changed unexpectedly; got: $(printf '%s' "$JQ_OUT" | tr '\n' '~')"
fi

printf '\n[2] jq-less device still gets a diagnosable body (the F2 defect)\n'

# Shadow jq with a function that fails the way a missing binary does.
# A shell function outranks a PATH lookup, so this holds even though
# cgi_base.sh prepends /opt/bin to PATH.
NOJQ_STUB='jq() { return 127; }'
NOJQ_OUT=$(run_cgi "$NOJQ_STUB" 'cgi_error "no_body" "POST body is empty"' | strip_cr)

if [ -z "$NOJQ_OUT" ]; then
    bad "cgi_error returned an EMPTY BODY with jq unavailable — this is the F2 defect: 81 endpoints answer 200 with nothing in them and no error anyone can trace"
elif [ "$NOJQ_OUT" = "$EXPECTED" ]; then
    ok "fallback envelope is byte-identical to the jq envelope"
else
    bad "fallback envelope does not match the jq envelope byte-for-byte; got: $(printf '%s' "$NOJQ_OUT" | tr '\n' '~')"
fi

printf '\n[3] fallback emits LF only (no CR smuggled into the body)\n'

if [ -z "$NOJQ_OUT" ]; then
    bad "skipped — no fallback output to check (see [2])"
else
    RAW_NOJQ=$(run_cgi "$NOJQ_STUB" 'cgi_error "no_body" "POST body is empty"')
    if printf '%s' "$RAW_NOJQ" | grep -q "$(printf '\r')"; then
        bad "fallback output contains a CR — the device serves LF-only JSON"
    else
        ok "fallback output is LF-only"
    fi
fi

printf '\n[4] fallback escapes JSON-hostile input instead of emitting broken JSON\n'

if [ -z "$JQ_BIN" ]; then
    bad "skipped — no real jq on PATH to validate the fallback output against"
else
    # Quote, backslash, tab and an embedded newline: each one produces
    # invalid JSON if pasted into a string body unescaped.
    HOSTILE_DETAIL='he said "hi" \ then C:\path'
    ESC_OUT=$(run_cgi "$NOJQ_STUB" 'cgi_error "bad\"code" "'"$HOSTILE_DETAIL"'"' | strip_cr)

    if [ -z "$ESC_OUT" ]; then
        bad "fallback produced nothing for input containing quotes/backslashes"
    elif ! printf '%s' "$ESC_OUT" | "$JQ_BIN" -e . >/dev/null 2>&1; then
        bad "fallback emitted INVALID JSON for quote/backslash input: $(printf '%s' "$ESC_OUT" | tr '\n' '~')"
    else
        GOT_ERR=$(printf '%s' "$ESC_OUT" | "$JQ_BIN" -r '.error')
        GOT_DET=$(printf '%s' "$ESC_OUT" | "$JQ_BIN" -r '.detail')
        GOT_SUC=$(printf '%s' "$ESC_OUT" | "$JQ_BIN" -r '.success')
        [ "$GOT_SUC" = "false" ] \
            && ok "escaped envelope keeps success:false (boolean, not the string \"false\")" \
            || bad "escaped envelope has success=$GOT_SUC"
        [ "$GOT_ERR" = 'bad"code' ] \
            && ok "quote in the error code round-trips" \
            || bad "error code did not round-trip: got [$GOT_ERR]"
        [ "$GOT_DET" = "$HOSTILE_DETAIL" ] \
            && ok "quotes and backslashes in the detail round-trip" \
            || bad "detail did not round-trip: got [$GOT_DET] want [$HOSTILE_DETAIL]"
    fi

    # A raw control byte inside a JSON string is a parse error. Multi-line
    # details reach cgi_error from command output, so this is not theoretical.
    ML_OUT=$(run_cgi "$NOJQ_STUB" 'cgi_error "multiline" "$(printf "line1\nline2\tcol")"' | strip_cr)
    if [ -z "$ML_OUT" ]; then
        bad "fallback produced nothing for multi-line input"
    elif printf '%s' "$ML_OUT" | "$JQ_BIN" -e . >/dev/null 2>&1; then
        ok "multi-line / tab detail still yields parseable JSON"
    else
        bad "fallback emitted INVALID JSON for a multi-line detail: $(printf '%s' "$ML_OUT" | tr '\n' '~')"
    fi
fi

printf '\n[5] scope pin — the fallback is inside cgi_error only\n'

ERR_FN=$(awk '/^cgi_error\(\) \{$/,/^\}$/' "$CGI_BASE")
if printf '%s' "$ERR_FN" | grep -q 'jq -n'; then
    ok "cgi_error still calls jq first (jq remains the primary path)"
else
    bad "cgi_error no longer calls jq — the fallback was meant to be a fallback, not a replacement"
fi

SUCCESS_OUT=$(run_cgi "$NOJQ_STUB" 'cgi_success' | strip_cr)
if [ -z "$SUCCESS_OUT" ]; then
    ok "cgi_success is still jq-dependent (tracker F2 scoped the fix to cgi_error; widening it is a decision, not a drive-by)"
else
    bad "cgi_success grew a jq-free path — out of F2's approved scope; re-scope deliberately or revert"
fi

printf '\n[cgi-error-jq-fallback] %d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
