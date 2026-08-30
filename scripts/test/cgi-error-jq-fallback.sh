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
# SCOPE (widened by F17, 2026-08-30): every JSON emitter on the pre-auth
# path now has a jq-free fallback — cgi_error, cgi_success,
# cgi_method_not_allowed, and cgi_auth.sh's require_auth. F2 deliberately
# covered cgi_error only, and section [5] used to ASSERT that narrowness.
# F17 retired that assertion because require_auth is the FIRST thing a
# browser hits: on a bootstrap-broken device the UI was still mute before
# F2's fallback could ever be reached. Sections [5] and [6] now pin the
# WIDER scope.
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
    #
    # Passed through the ENVIRONMENT, not spliced into the snippet text.
    # run_cgi builds an inner script by string concatenation, so an
    # interpolated `"` would close the inner shell string and the hostile
    # value would be de-fanged before cgi_error ever received it — the test
    # would then be measuring the harness's quoting, not the escaper's.
    export HOSTILE_DETAIL='he said "hi" \ then C:\path'
    ESC_OUT=$(run_cgi "$NOJQ_STUB" 'cgi_error "bad\"code" "$HOSTILE_DETAIL"' | strip_cr)

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

# F17 inverts what this used to assert. The old check demanded that
# cgi_success stay jq-dependent, pinning F2's deliberately narrow scope.
# That scope is now retired: a jq-less device that answers 200-with-nothing
# is mute whether the empty body came from cgi_error or cgi_success.
SUCCESS_WANT=$(printf '{
  "success": true
}
')
SUCCESS_OUT=$(run_cgi "$NOJQ_STUB" 'cgi_success' | strip_cr)
if [ -z "$SUCCESS_OUT" ]; then
    bad "cgi_success returned an EMPTY BODY with jq unavailable — the F17 defect"
elif [ "$SUCCESS_OUT" = "$SUCCESS_WANT" ]; then
    ok "cgi_success falls back to a byte-identical envelope"
else
    bad "cgi_success fallback does not match jq's envelope; got: $(printf '%s' "$SUCCESS_OUT" | tr '
' '~')"
fi

MNA_WANT=$(printf '{
  "success": false,
  "error": "method_not_allowed",
  "detail": "Use GET or POST"
}
')
MNA_OUT=$(run_cgi "$NOJQ_STUB" 'cgi_method_not_allowed' | strip_cr)
if [ -z "$MNA_OUT" ]; then
    bad "cgi_method_not_allowed returned an EMPTY BODY with jq unavailable — the F17 defect"
elif [ "$MNA_OUT" = "$MNA_WANT" ]; then
    ok "cgi_method_not_allowed falls back to a byte-identical envelope"
else
    bad "cgi_method_not_allowed fallback does not match jq's envelope; got: $(printf '%s' "$MNA_OUT" | tr '
' '~')"
fi

# The jq path must stay primary in both, for the same reason it does in
# cgi_error: jq is the escaping authority, the fallback is the safety net.
for _fn in cgi_success cgi_method_not_allowed; do
    _body=$(awk "/^${_fn}\(\) \{$/,/^\}$/" "$CGI_BASE")
    if printf '%s' "$_body" | grep -q 'jq -n'; then
        ok "$_fn still calls jq first"
    else
        bad "$_fn no longer calls jq — the fallback was meant to be a fallback, not a replacement"
    fi
done

printf '
[6] require_auth — the PRE-AUTH path, first thing a browser hits (F17)
'

AUTH_LIB="$REPO_ROOT/scripts/usr/lib/qmanager/cgi_auth.sh"

# require_auth lives in cgi_auth.sh, which cgi_base.sh sources by ABSOLUTE
# path (/usr/lib/qmanager/...). Off-device that source fails and cgi_base.sh
# installs a no-op stub, so the repo copy must be sourced explicitly on top
# of it. Its own `_CGI_AUTH_LOADED` re-entry guard is unset (the real load
# never happened), so this load takes effect.
#
# require_auth ends in `exit 0`, hence the subshell. Its output is
# "Status: 401", then cgi_headers, then the body — so drop everything up to
# and including the blank line that terminates the headers.
run_require_auth() {
    CGI_BASE="$CGI_BASE" AUTH_LIB="$AUTH_LIB" _SKIP_AUTH=1 bash -c '
        set +e
        . "$CGI_BASE"
        . "$AUTH_LIB"
        '"$1"'
        ( require_auth )
    ' 2>/dev/null | strip_cr | sed -n '/^{/,$p'
}

SETUP_WANT=$(printf '{
  "success": false,
  "error": "setup_required",
  "detail": "No password configured"
}
')
UNAUTH_WANT=$(printf '{
  "success": false,
  "error": "unauthorized",
  "detail": "Invalid or expired session"
}
')

SETUP_STUB="$NOJQ_STUB
is_setup_required() { return 0; }"
SETUP_OUT=$(run_require_auth "$SETUP_STUB")
if [ -z "$SETUP_OUT" ]; then
    bad "require_auth emitted NO BODY for setup_required with jq unavailable — the browser's first request answers 401 with nothing in it, so the UI is mute before cgi_error's fallback can ever be reached (F17)"
elif [ "$SETUP_OUT" = "$SETUP_WANT" ]; then
    ok "setup_required envelope survives a jq-less device"
else
    bad "setup_required envelope changed; got: $(printf '%s' "$SETUP_OUT" | tr '
' '~')"
fi

UNAUTH_STUB="$NOJQ_STUB
is_setup_required() { return 1; }
qm_get_cookie() { printf '%s' stale-token; }
qm_validate_session() { return 1; }"
UNAUTH_OUT=$(run_require_auth "$UNAUTH_STUB")
if [ -z "$UNAUTH_OUT" ]; then
    bad "require_auth emitted NO BODY for unauthorized with jq unavailable (F17)"
elif [ "$UNAUTH_OUT" = "$UNAUTH_WANT" ]; then
    ok "unauthorized envelope survives a jq-less device"
else
    bad "unauthorized envelope changed; got: $(printf '%s' "$UNAUTH_OUT" | tr '
' '~')"
fi

# The jq path stays primary here too — but via cgi_error, not a second
# inline `jq -n`. A bare `jq -n` left inside require_auth is the defect.
RA_FN=$(awk '/^require_auth\(\) \{$/,/^\}$/' "$AUTH_LIB")
if printf '%s' "$RA_FN" | grep -q 'jq -n'; then
    bad "require_auth still emits an inline 'jq -n' envelope — that is the F17 defect, not a fallback"
else
    ok "require_auth no longer emits inline 'jq -n' envelopes"
fi

# The reorder is what makes the above possible, and it is silent if it
# regresses: cgi_base.sh calls require_auth at LOAD TIME, so cgi_error must
# be defined ABOVE that call or require_auth reaches an undefined function.
ERR_LINE=$(grep -n '^cgi_error() {' "$CGI_BASE" | head -1 | cut -d: -f1)
CALL_LINE=$(grep -n '^    require_auth$' "$CGI_BASE" | head -1 | cut -d: -f1)
if [ -n "$ERR_LINE" ] && [ -n "$CALL_LINE" ] && [ "$ERR_LINE" -lt "$CALL_LINE" ]; then
    ok "cgi_error is defined above cgi_base.sh's load-time require_auth call (line $ERR_LINE < $CALL_LINE)"
else
    bad "cgi_error (line ${ERR_LINE:-?}) is NOT above the load-time require_auth call (line ${CALL_LINE:-?}) — require_auth would call an undefined function on a real request"
fi

printf '\n[cgi-error-jq-fallback] %d passed, %d failed\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
