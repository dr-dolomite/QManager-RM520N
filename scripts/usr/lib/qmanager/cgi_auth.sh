#!/bin/sh
# cgi_auth.sh — Cookie-based authentication library for QManager CGI scripts.
# Sourced by cgi_base.sh. Provides require_auth() and password helpers.
#
# Storage:
#   /etc/qmanager/auth.json              — password hash + salt (persistent)
#   /tmp/qmanager_sessions/<token>        — one file per session (RAM, cleared on reboot)
#   /tmp/qmanager_auth_attempts.json      — rate limiting state (RAM)
#   /tmp/qmanager_auth_attempts.lock      — flock target serializing RMW on the above
#
# Attempts file shape (all fields defaulted on read for upgrade compatibility
# with the pre-ladder flat-lockout shape, which had no "level"/"last_failure"):
#   {"count":N,"first_attempt":EPOCH,"locked_until":EPOCH,
#    "level":0-4,"last_failure":EPOCH}

[ -n "$_CGI_AUTH_LOADED" ] && return 0
_CGI_AUTH_LOADED=1

AUTH_CONFIG="/etc/qmanager/auth.json"
SESSIONS_DIR="/tmp/qmanager_sessions"
ATTEMPTS_FILE="/tmp/qmanager_auth_attempts.json"
ATTEMPTS_LOCK="/tmp/qmanager_auth_attempts.lock"

SESSION_MAX_AGE=3600  # 1 hour

# Cookie names
COOKIE_SESSION="qm_session"
COOKIE_INDICATOR="qm_logged_in"

# Rate limiting
MAX_ATTEMPTS=5
LOCKOUT_WINDOW=300       # 5-minute window for counting pre-ladder attempts
LOCKOUT_STEPS="30 120 300 900"  # progressive lockout ladder, seconds; last = cap
LEVEL_DECAY=3600         # quiet seconds after which the ladder level resets to 0

# ---------------------------------------------------------------------------
# Setup check
# ---------------------------------------------------------------------------
is_setup_required() {
    [ ! -f "$AUTH_CONFIG" ] && return 0
    [ ! -s "$AUTH_CONFIG" ] && return 0
    return 1
}

# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

qm_generate_salt() {
    head -c 16 /dev/urandom | openssl dgst -sha256 -hex 2>/dev/null | awk '{print substr($NF,1,32)}'
}

qm_hash_password() {
    printf '%s' "${2}${1}" | openssl dgst -sha256 -hex 2>/dev/null | awk '{print $NF}'
}

# Timing-safe string comparison via awk
qm_timing_safe_compare() {
    _result=$(printf '%s\n%s' "$1" "$2" | awk '
        NR==1 { a=$0 }
        NR==2 {
            b=$0
            len = length(a)
            if (length(b) > len) len = length(b)
            diff = (length(a) != length(b))
            for (i=1; i<=len; i++)
                if (substr(a,i,1) != substr(b,i,1)) diff=1
            print diff
        }')
    [ "$_result" = "0" ]
}

qm_verify_password() {
    _input_password="$1"
    [ ! -f "$AUTH_CONFIG" ] && return 1

    _auth_fields=$(jq -r '[.salt // "", .hash // ""] | @tsv' "$AUTH_CONFIG" 2>/dev/null)
    _stored_salt=$(printf '%s' "$_auth_fields" | cut -f1)
    _stored_hash=$(printf '%s' "$_auth_fields" | cut -f2)

    [ -z "$_stored_salt" ] && return 1
    [ -z "$_stored_hash" ] && return 1

    _computed_hash=$(qm_hash_password "$_input_password" "$_stored_salt")
    qm_timing_safe_compare "$_computed_hash" "$_stored_hash"
}

qm_save_password() {
    _new_salt=$(qm_generate_salt)
    _new_hash=$(qm_hash_password "$1" "$_new_salt")

    jq -n --arg hash "$_new_hash" --arg salt "$_new_salt" \
        '{"hash":$hash,"salt":$salt,"version":1}' > "$AUTH_CONFIG"
    chmod 600 "$AUTH_CONFIG"
}

# ---------------------------------------------------------------------------
# Cookie helpers
# ---------------------------------------------------------------------------

# Extract a named cookie value from HTTP_COOKIE
# Usage: _cookie_val=$(qm_get_cookie "cookie_name")
qm_get_cookie() {
    _cookie_name="$1"
    # HTTP_COOKIE format: "name1=val1; name2=val2"
    printf '%s' "$HTTP_COOKIE" | awk -v name="$_cookie_name" '
    BEGIN { RS=";[ \t]*"; FS="=" }
    $1 == name { print $2; exit }
    '
}

# Emit Set-Cookie headers for both session and indicator cookies
# Usage: qm_set_session_cookies <token>
qm_set_session_cookies() {
    echo "Set-Cookie: ${COOKIE_SESSION}=${1}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}"
    echo "Set-Cookie: ${COOKIE_INDICATOR}=1; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}"
}

# Emit Set-Cookie headers that clear both cookies
qm_clear_session_cookies() {
    echo "Set-Cookie: ${COOKIE_SESSION}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
    echo "Set-Cookie: ${COOKIE_INDICATOR}=; SameSite=Strict; Path=/; Max-Age=0"
}

# ---------------------------------------------------------------------------
# Session management (directory-based, one file per session)
# ---------------------------------------------------------------------------

qm_generate_token() {
    head -c 32 /dev/urandom | openssl dgst -sha256 -hex 2>/dev/null | awk '{print $NF}'
}

# Validate token is safe for use as a filename (hex chars only)
_is_valid_token() {
    printf '%s' "$1" | grep -qE '^[0-9a-f]{64}$'
}

# Create a new session. Prints the token to stdout.
qm_create_session() {
    mkdir -p "$SESSIONS_DIR"
    _token=$(qm_generate_token)
    date +%s > "${SESSIONS_DIR}/${_token}"
    printf '%s' "$_token"
}

# Validate a session token: check file exists and not expired.
# Returns 0 if valid, 1 if invalid/expired.
qm_validate_session() {
    _check_token="$1"
    [ -z "$_check_token" ] && return 1
    _is_valid_token "$_check_token" || return 1

    _session_file="${SESSIONS_DIR}/${_check_token}"
    [ ! -f "$_session_file" ] && return 1

    _created=$(cat "$_session_file" 2>/dev/null)
    [ -z "$_created" ] && return 1

    _now=$(date +%s)
    _age=$(( _now - _created ))
    [ "$_age" -gt "$SESSION_MAX_AGE" ] && {
        rm -f "$_session_file"
        return 1
    }

    return 0
}

# Destroy a specific session
qm_destroy_session() {
    _token="$1"
    [ -z "$_token" ] && return
    _is_valid_token "$_token" || return
    rm -f "${SESSIONS_DIR}/${_token}"
}

# Clean up expired sessions (called on login)
qm_cleanup_sessions() {
    [ ! -d "$SESSIONS_DIR" ] && return
    _now=$(date +%s)
    for _f in "${SESSIONS_DIR}"/*; do
        [ ! -f "$_f" ] && continue
        _created=$(cat "$_f" 2>/dev/null)
        [ -z "$_created" ] && { rm -f "$_f"; continue; }
        _age=$(( _now - _created ))
        [ "$_age" -gt "$SESSION_MAX_AGE" ] && rm -f "$_f"
    done
}

# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------
#
# Progressive lockout ladder:
#   attempts 1..5 (level 0)  -> allowed, RATE_LIMIT_ATTEMPTS_REMAINING counts down
#   attempt 6                -> locked  30s (level 1, first LOCKOUT_STEPS entry)
#   next failure              -> locked 120s (level 2)
#   next failure              -> locked 300s (level 3)
#   next failure              -> locked 900s (level 4 = cap, stays here)
#   successful login          -> qm_clear_attempts deletes the file, level -> 0
#   LEVEL_DECAY (1h) quiet    -> level decays back to 0 on next read
#
# The "escalate on next failure" behavior (no need to fail 5 more times once
# the ladder is engaged) is why the level>=1 branches below re-lock on a
# SINGLE failed attempt rather than waiting for count to reach MAX_ATTEMPTS
# again — count only gates the very first level-0 -> level-1 transition.
#
# qm_get_rate_limit_status() is the READ-ONLY half — safe to call from an
# unauthenticated status probe (auth/check.sh) since it never mutates
# ATTEMPTS_FILE. qm_check_rate_limit() is the LOGIN-PATH half: same read, plus
# the level-0 -> level-1 engage-lockout mutation, guarded by ATTEMPTS_LOCK.
# qm_record_failed_attempt() performs the level>=1 escalate-on-failure
# mutation, also under ATTEMPTS_LOCK.
#
# Concurrency: BusyBox flock has no -w/--timeout, so qm_attempts_flock_wait
# polls a bounded `flock -x -n` loop (mirrors sim_registry.sh's
# sim_registry_flock_wait). If the lock is still held after the poll window,
# the write proceeds UNLOCKED rather than hanging or failing the request —
# losing one counted attempt to a race is preferable to a login endpoint that
# blocks or 500s.

# _qm_lockout_seconds <level> — seconds for ladder level N (1-based), clamped
# to the last LOCKOUT_STEPS entry for any level beyond the ladder's length.
_qm_lockout_seconds() {
    _qm_ls_lvl="$1"
    [ "$_qm_ls_lvl" -lt 1 ] 2>/dev/null && _qm_ls_lvl=1
    _qm_ls_n=0
    _qm_ls_val=0
    for _qm_ls_s in $LOCKOUT_STEPS; do
        _qm_ls_n=$(( _qm_ls_n + 1 ))
        _qm_ls_val="$_qm_ls_s"
        [ "$_qm_ls_n" -ge "$_qm_ls_lvl" ] && break
    done
    printf '%s' "$_qm_ls_val"
}

# _qm_lockout_step_count — number of rungs in LOCKOUT_STEPS, so the stored
# "level" field never grows unbounded across repeated re-lockouts.
_qm_lockout_step_count() {
    _qm_lsc_n=0
    for _qm_lsc_s in $LOCKOUT_STEPS; do
        _qm_lsc_n=$(( _qm_lsc_n + 1 ))
    done
    printf '%s' "$_qm_lsc_n"
}

# _qm_rate_limit_read_state — read ATTEMPTS_FILE (defaulting every field for
# upgrade compatibility with the pre-ladder shape), apply level decay, and
# expose the result via globals: _RL_COUNT _RL_FIRST _RL_LOCKED_UNTIL
# _RL_LEVEL _RL_LAST_FAILURE. Never mutates the file.
_qm_rate_limit_read_state() {
    _RL_COUNT=0
    _RL_FIRST=0
    _RL_LOCKED_UNTIL=0
    _RL_LEVEL=0
    _RL_LAST_FAILURE=0

    [ ! -f "$ATTEMPTS_FILE" ] && return 0

    _rl_fields=$(jq -r '[(.count // 0), (.first_attempt // 0), (.locked_until // 0), (.level // 0), (.last_failure // 0)] | @tsv' "$ATTEMPTS_FILE" 2>/dev/null)
    _RL_COUNT=$(printf '%s' "$_rl_fields" | cut -f1)
    _RL_FIRST=$(printf '%s' "$_rl_fields" | cut -f2)
    _RL_LOCKED_UNTIL=$(printf '%s' "$_rl_fields" | cut -f3)
    _RL_LEVEL=$(printf '%s' "$_rl_fields" | cut -f4)
    _RL_LAST_FAILURE=$(printf '%s' "$_rl_fields" | cut -f5)

    # Defensive re-default in case jq/cut produced blanks (corrupt/partial file)
    [ -z "$_RL_COUNT" ] && _RL_COUNT=0
    [ -z "$_RL_FIRST" ] && _RL_FIRST=0
    [ -z "$_RL_LOCKED_UNTIL" ] && _RL_LOCKED_UNTIL=0
    [ -z "$_RL_LEVEL" ] && _RL_LEVEL=0
    [ -z "$_RL_LAST_FAILURE" ] && _RL_LAST_FAILURE=0

    _rl_now=$(date +%s)
    if [ "$_RL_LAST_FAILURE" -gt 0 ] 2>/dev/null; then
        _rl_quiet=$(( _rl_now - _RL_LAST_FAILURE ))
        [ "$_rl_quiet" -gt "$LEVEL_DECAY" ] 2>/dev/null && _RL_LEVEL=0
    fi
}

# _qm_rate_limit_remaining — MAX_ATTEMPTS minus the current count, clamped
# to [0, MAX_ATTEMPTS]. Assumes _qm_rate_limit_read_state has just run.
_qm_rate_limit_remaining() {
    _rl_remaining=$(( MAX_ATTEMPTS - _RL_COUNT ))
    [ "$_rl_remaining" -lt 0 ] 2>/dev/null && _rl_remaining=0
    [ "$_rl_remaining" -gt "$MAX_ATTEMPTS" ] 2>/dev/null && _rl_remaining=$MAX_ATTEMPTS
    printf '%s' "$_rl_remaining"
}

# qm_attempts_flock_wait <fd> <timeout_seconds>
# BusyBox flock has no -w/--timeout — poll `flock -x -n` in a loop instead.
# Always returns after at most <timeout_seconds>; caller proceeds regardless
# of success (best-effort locking, never a hang or a blocked request).
qm_attempts_flock_wait() {
    _qm_fw_fd="$1"
    _qm_fw_wait="$2"
    _qm_fw_elapsed=0
    while [ "$_qm_fw_elapsed" -lt "$_qm_fw_wait" ]; do
        flock -x -n "$_qm_fw_fd" 2>/dev/null && return 0
        sleep 1
        _qm_fw_elapsed=$(( _qm_fw_elapsed + 1 ))
    done
    flock -x -n "$_qm_fw_fd" 2>/dev/null
}

_qm_ensure_attempts_lock() {
    [ -e "$ATTEMPTS_LOCK" ] || : > "$ATTEMPTS_LOCK" 2>/dev/null
    chmod 666 "$ATTEMPTS_LOCK" 2>/dev/null
}

# _qm_engage_lockout <level> — write a fresh lockout at the given ladder
# level: locked_until = now + step(level), last_failure = now, level = level
# (clamped), count/first_attempt carried over unchanged. Must be called with
# ATTEMPTS_LOCK held (or best-effort unlocked after a timed-out acquire).
_qm_engage_lockout() {
    _qm_el_lvl="$1"
    _qm_el_cap=$(_qm_lockout_step_count)
    [ "$_qm_el_lvl" -gt "$_qm_el_cap" ] 2>/dev/null && _qm_el_lvl=$_qm_el_cap

    _qm_rate_limit_read_state
    _qm_el_now=$(date +%s)
    _qm_el_seconds=$(_qm_lockout_seconds "$_qm_el_lvl")

    jq -n --argjson count "$_RL_COUNT" --argjson first "$_RL_FIRST" \
        --argjson locked "$(( _qm_el_now + _qm_el_seconds ))" \
        --argjson level "$_qm_el_lvl" --argjson lastf "$_qm_el_now" \
        '{"count":$count,"first_attempt":$first,"locked_until":$locked,"level":$level,"last_failure":$lastf}' \
        > "${ATTEMPTS_FILE}.tmp" 2>/dev/null \
        && mv "${ATTEMPTS_FILE}.tmp" "$ATTEMPTS_FILE"
}

# qm_get_rate_limit_status — READ-ONLY. Sets RATE_LIMIT_RETRY_AFTER and
# RATE_LIMIT_ATTEMPTS_REMAINING. Returns 0 (not locked) or 1 (locked). Never
# writes ATTEMPTS_FILE — safe to call from an unauthenticated probe on every
# page load (auth/check.sh) without ever extending anyone's lockout.
qm_get_rate_limit_status() {
    RATE_LIMIT_RETRY_AFTER=0
    RATE_LIMIT_ATTEMPTS_REMAINING=$MAX_ATTEMPTS

    [ ! -f "$ATTEMPTS_FILE" ] && return 0

    _qm_rate_limit_read_state
    _qm_grl_now=$(date +%s)

    if [ "$_RL_LOCKED_UNTIL" -gt "$_qm_grl_now" ] 2>/dev/null; then
        RATE_LIMIT_RETRY_AFTER=$(( _RL_LOCKED_UNTIL - _qm_grl_now ))
        RATE_LIMIT_ATTEMPTS_REMAINING=0
        return 1
    fi

    RATE_LIMIT_ATTEMPTS_REMAINING=$(_qm_rate_limit_remaining)
    return 0
}

# qm_check_rate_limit — LOGIN-PATH gate, called before qm_verify_password.
# Same read as qm_get_rate_limit_status, plus two mutations under
# ATTEMPTS_LOCK: resetting a fully-expired pre-ladder counting window, and
# engaging the level 0 -> 1 lockout the first time count reaches
# MAX_ATTEMPTS. Level >= 1 re-lockouts are engaged by qm_record_failed_attempt
# instead (a single failure re-locks once the ladder is engaged).
qm_check_rate_limit() {
    qm_get_rate_limit_status
    [ $? -eq 1 ] && return 1

    [ ! -f "$ATTEMPTS_FILE" ] && return 0

    _qm_rate_limit_read_state
    _qm_crl_now=$(date +%s)

    # Pre-ladder counting window fully expired with no lock ever engaged.
    _qm_crl_window_age=$(( _qm_crl_now - _RL_FIRST ))
    if [ "$_RL_LEVEL" -eq 0 ] 2>/dev/null && [ "$_RL_FIRST" -gt 0 ] 2>/dev/null \
        && [ "$_qm_crl_window_age" -gt "$LOCKOUT_WINDOW" ] 2>/dev/null; then
        rm -f "$ATTEMPTS_FILE"
        RATE_LIMIT_ATTEMPTS_REMAINING=$MAX_ATTEMPTS
        return 0
    fi

    # First-time ladder trigger: MAX_ATTEMPTS reached, never locked before.
    if [ "$_RL_LEVEL" -eq 0 ] 2>/dev/null && [ "$_RL_COUNT" -ge "$MAX_ATTEMPTS" ] 2>/dev/null; then
        _qm_ensure_attempts_lock
        (
            qm_attempts_flock_wait 9 3
            _qm_engage_lockout 1
        ) 9<"$ATTEMPTS_LOCK"

        _qm_rate_limit_read_state
        _qm_crl_now=$(date +%s)
        [ "$_RL_LOCKED_UNTIL" -gt "$_qm_crl_now" ] 2>/dev/null \
            && RATE_LIMIT_RETRY_AFTER=$(( _RL_LOCKED_UNTIL - _qm_crl_now ))
        RATE_LIMIT_ATTEMPTS_REMAINING=0
        return 1
    fi

    return 0
}

# qm_record_failed_attempt — call after a failed qm_verify_password. Under
# ATTEMPTS_LOCK: bumps count (resetting the pre-ladder window if it expired),
# and if the ladder is already engaged (level >= 1), immediately escalates to
# the next level and re-locks — the "next failure -> longer lockout" rule.
qm_record_failed_attempt() {
    _qm_ensure_attempts_lock
    (
        qm_attempts_flock_wait 9 3
        _qm_record_failed_attempt_locked
    ) 9<"$ATTEMPTS_LOCK"
}

# Internal — assumes fd 9 is flock'd (or lock acquisition timed out and this
# proceeds best-effort unlocked; see qm_attempts_flock_wait).
_qm_record_failed_attempt_locked() {
    _qm_rfa_now=$(date +%s)

    if [ ! -f "$ATTEMPTS_FILE" ]; then
        jq -n --argjson now "$_qm_rfa_now" \
            '{"count":1,"first_attempt":$now,"locked_until":0,"level":0,"last_failure":$now}' \
            > "$ATTEMPTS_FILE" 2>/dev/null
        return 0
    fi

    _qm_rate_limit_read_state
    _qm_rfa_count="$_RL_COUNT"
    _qm_rfa_first="$_RL_FIRST"
    _qm_rfa_level="$_RL_LEVEL"

    if [ "$_qm_rfa_level" -eq 0 ] 2>/dev/null; then
        _qm_rfa_window_age=$(( _qm_rfa_now - _qm_rfa_first ))
        if [ "$_qm_rfa_first" -eq 0 ] 2>/dev/null || [ "$_qm_rfa_window_age" -gt "$LOCKOUT_WINDOW" ] 2>/dev/null; then
            _qm_rfa_count=0
            _qm_rfa_first=0
        fi
    fi

    [ "$_qm_rfa_first" -eq 0 ] 2>/dev/null && _qm_rfa_first=$_qm_rfa_now
    _qm_rfa_count=$(( _qm_rfa_count + 1 ))

    if [ "$_qm_rfa_level" -ge 1 ] 2>/dev/null; then
        _qm_rfa_new_level=$(( _qm_rfa_level + 1 ))
        _qm_rfa_cap=$(_qm_lockout_step_count)
        [ "$_qm_rfa_new_level" -gt "$_qm_rfa_cap" ] 2>/dev/null && _qm_rfa_new_level=$_qm_rfa_cap
        _qm_rfa_seconds=$(_qm_lockout_seconds "$_qm_rfa_new_level")

        jq -n --argjson count "$_qm_rfa_count" --argjson first "$_qm_rfa_first" \
            --argjson locked "$(( _qm_rfa_now + _qm_rfa_seconds ))" \
            --argjson level "$_qm_rfa_new_level" --argjson lastf "$_qm_rfa_now" \
            '{"count":$count,"first_attempt":$first,"locked_until":$locked,"level":$level,"last_failure":$lastf}' \
            > "${ATTEMPTS_FILE}.tmp" 2>/dev/null && mv "${ATTEMPTS_FILE}.tmp" "$ATTEMPTS_FILE"
    else
        jq -n --argjson count "$_qm_rfa_count" --argjson first "$_qm_rfa_first" \
            --argjson lastf "$_qm_rfa_now" \
            '{"count":$count,"first_attempt":$first,"locked_until":0,"level":0,"last_failure":$lastf}' \
            > "${ATTEMPTS_FILE}.tmp" 2>/dev/null && mv "${ATTEMPTS_FILE}.tmp" "$ATTEMPTS_FILE"
    fi
}

qm_clear_attempts() {
    rm -f "$ATTEMPTS_FILE"
}

# ---------------------------------------------------------------------------
# SSH (root) password management
# ---------------------------------------------------------------------------

# Set the system root password for SSH access.
# Pipes password to the privileged helper via sudo (password never in args).
# Returns 0 on success, 1 on failure.
qm_set_ssh_password() {
    _ssh_pw="$1"
    [ -z "$_ssh_pw" ] && return 1

    # Source platform.sh for $_SUDO if not already loaded
    if [ -z "$_PLATFORM_LOADED" ]; then
        . /usr/lib/qmanager/platform.sh
    fi

    _result=$(printf '%s\n' "$_ssh_pw" | $_SUDO /usr/bin/qmanager_set_ssh_password 2>/dev/null)
    _rc=$?

    if [ "$_rc" -eq 0 ]; then
        qlog_info "SSH root password updated"
        return 0
    else
        qlog_error "SSH password update failed: $_result"
        return 1
    fi
}

# ---------------------------------------------------------------------------
# Auth enforcement — called by cgi_base.sh on every request
# ---------------------------------------------------------------------------

# Main auth gate — rejects unauthenticated requests
#
# Both envelopes go through cgi_base.sh's cgi_error, which keeps jq as the
# primary path and falls back to a hand-built envelope when jq produces
# nothing. These used to be inline `jq -n` calls, and that made this the
# MUTE half of the F2 fix: require_auth is the first thing a browser hits,
# so on a device whose Entware bootstrap failed (no /opt/bin/jq) every
# request answered 401 with a completely empty body — the UI died before
# cgi_error's fallback could ever be reached (tracker F17).
#
# cgi_error and cgi_headers both come from cgi_base.sh, which calls this
# function at LOAD TIME. Both are defined above that call on purpose; see
# the ordering note on cgi_error.
require_auth() {
    # Setup mode
    if is_setup_required; then
        echo "Status: 401 Unauthorized"
        cgi_headers
        cgi_error "setup_required" "No password configured"
        exit 0
    fi

    # CORS preflight passes without auth
    [ "$REQUEST_METHOD" = "OPTIONS" ] && return 0

    # Read session token from cookie
    _token=$(qm_get_cookie "$COOKIE_SESSION")
    if [ -z "$_token" ] || ! qm_validate_session "$_token"; then
        echo "Status: 401 Unauthorized"
        cgi_headers
        cgi_error "unauthorized" "Invalid or expired session"
        exit 0
    fi
}
