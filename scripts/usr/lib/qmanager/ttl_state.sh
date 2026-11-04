#!/bin/sh
# =============================================================================
# ttl_state.sh — TTL/HL State Library for QManager
# =============================================================================
# Provides read/write/apply functions for IPv4 TTL and IPv6 HL override rules
# on the rmnet+ interface (iptables/ip6tables mangle POSTROUTING).
#
# Persisted state lives at /etc/qmanager/ttl_state (plain key=value, NOT shell
# code) so it is writable by www-data without sudo. Format:
#   TTL=64
#   HL=64
# Either or both keys may be absent or 0 (meaning "not set").
#
# DEPENDENCY: platform.sh MUST be sourced by the caller before this library.
# This lib uses run_iptables / run_ip6tables from platform.sh — it does NOT
# source platform.sh itself to avoid double-loading side effects.
#
# Install location: /usr/lib/qmanager/ttl_state.sh
#
# Public API:
#   TTL_STATE_FILE              — constant: /etc/qmanager/ttl_state
#   TTL_STATE_DIR               — constant: /etc/qmanager
#   ttl_state_validate_field    — CGI input check (sets TTL_ERR_CODE/DETAIL)
#   ttl_state_read_persisted    — print "<ttl> <hl>" from file (0 if absent)
#   ttl_state_read_live         — print "<ttl> <hl>" from live iptables rules
#   ttl_state_write_persisted   — atomic write (or remove if both 0)
#   ttl_state_apply             — clear old rules, insert new ones
#   ttl_state_clear             — apply 0 0 + remove file
# =============================================================================

[ -n "$_TTL_STATE_LOADED" ] && return 0
_TTL_STATE_LOADED=1

# --- Constants ---------------------------------------------------------------
TTL_STATE_FILE="/etc/qmanager/ttl_state"
TTL_STATE_DIR="/etc/qmanager"

# ICMPv6 types whose Hop Limit is fixed by RFC, so HL never rewrites them:
# ND 133-137 need 255 (RFC 4861), MLD 130-132 and 143 need 1 (RFC 2710/3810).
# Kept in sync with qmanager_fw_apply's allow-list.
_TTL_ND_TYPES="130 131 132 133 134 135 136 137 143"

# =============================================================================
# _ttl_is_int — validate that $1 is a non-negative integer 0-255
# Returns 0 if valid, 1 if not.
# =============================================================================
_ttl_is_int() {
    case "$1" in
        ''|*[!0-9]*) return 1 ;;
    esac
    [ "$1" -ge 0 ] && [ "$1" -le 255 ]
}

# =============================================================================
# ttl_state_validate_field <TTL|HL> <value> — the CGI's input check
# =============================================================================
# On failure returns 1 with TTL_ERR_CODE / TTL_ERR_DETAIL set to the CGI's error pair.
ttl_state_validate_field() {
    local label="$1" val="$2" code
    code="invalid_$(printf '%s' "$label" | tr 'A-Z' 'a-z')"
    case "$val" in
        ''|*[!0-9]*)
            TTL_ERR_CODE="$code"
            TTL_ERR_DETAIL="$label must be a number between 0 and 255"
            return 1
            ;;
    esac
    if [ "$val" -gt 255 ] 2>/dev/null; then
        TTL_ERR_CODE="$code"
        TTL_ERR_DETAIL="$label must be between 0 and 255"
        return 1
    fi
    return 0
}

# =============================================================================
# ttl_state_read_persisted — read TTL and HL from persisted state file
# =============================================================================
# Prints "<ttl> <hl>" to stdout (two integers separated by space).
# Missing file or malformed/absent keys default to 0.
ttl_state_read_persisted() {
    local ttl=0 hl=0 val

    if [ -f "$TTL_STATE_FILE" ]; then
        val=$(grep '^TTL=' "$TTL_STATE_FILE" 2>/dev/null | cut -d'=' -f2 | tr -d ' \r\n')
        if _ttl_is_int "$val"; then
            ttl="$val"
        fi

        val=$(grep '^HL=' "$TTL_STATE_FILE" 2>/dev/null | cut -d'=' -f2 | tr -d ' \r\n')
        if _ttl_is_int "$val"; then
            hl="$val"
        fi
    fi

    printf '%s %s\n' "$ttl" "$hl"
}

# =============================================================================
# ttl_state_read_live — read active TTL/HL values from live iptables rules
# =============================================================================
# Prints "<ttl> <hl>" to stdout.
# Parses "TTL set to <N>" from iptables mangle POSTROUTING output.
# Parses "HL set to <N>" from ip6tables mangle POSTROUTING output.
# Defaults to 0 for missing rules.
ttl_state_read_live() {
    local ttl=0 hl=0 val

    val=$(run_iptables -w 5 -t mangle -vnL POSTROUTING 2>/dev/null \
        | grep -io 'TTL set to [0-9]*' \
        | head -n1 \
        | awk '{print $4}')
    if _ttl_is_int "$val"; then
        ttl="$val"
    fi

    val=$(run_ip6tables -w 5 -t mangle -vnL POSTROUTING 2>/dev/null \
        | grep -io 'HL set to [0-9]*' \
        | head -n1 \
        | awk '{print $4}')
    if _ttl_is_int "$val"; then
        hl="$val"
    fi

    printf '%s %s\n' "$ttl" "$hl"
}

# =============================================================================
# ttl_state_write_persisted <ttl> <hl> — write state file atomically
# =============================================================================
# If both values are 0, removes the file instead (clears ConditionPathExists).
# Returns 0 on success, non-zero on failure.
ttl_state_write_persisted() {
    local ttl="$1" hl="$2"

    # Validate inputs
    if ! _ttl_is_int "$ttl"; then
        [ "$(command -v qlog_warn 2>/dev/null)" ] && qlog_warn "ttl_state_write_persisted: invalid TTL '$ttl'"
        return 1
    fi
    if ! _ttl_is_int "$hl"; then
        [ "$(command -v qlog_warn 2>/dev/null)" ] && qlog_warn "ttl_state_write_persisted: invalid HL '$hl'"
        return 1
    fi

    # If both are 0, remove the file so the systemd unit short-circuits
    if [ "$ttl" -eq 0 ] && [ "$hl" -eq 0 ]; then
        rm -f "$TTL_STATE_FILE"
        return 0
    fi

    mkdir -p "$TTL_STATE_DIR" 2>/dev/null

    local tmp="${TTL_STATE_FILE}.tmp"
    printf 'TTL=%s\nHL=%s\n' "$ttl" "$hl" > "$tmp" || return 1
    mv "$tmp" "$TTL_STATE_FILE"
}

# =============================================================================
# ttl_state_apply <ttl> <hl> — clear old rules and insert new ones
# =============================================================================
# Reads live state, deletes any existing TTL/HL POSTROUTING rules on rmnet+,
# then inserts new rules if the values are non-zero. A non-zero HL also adds
# ACCEPT rules above it for outgoing ND and MLD, so those keep their Hop Limit.
# Returns 0 on success (failures from -D are silenced; -I failures propagate).
ttl_state_apply() {
    local ttl="$1" hl="$2"

    # Validate inputs
    if ! _ttl_is_int "$ttl"; then
        [ "$(command -v qlog_warn 2>/dev/null)" ] && qlog_warn "ttl_state_apply: invalid TTL '$ttl'"
        return 1
    fi
    if ! _ttl_is_int "$hl"; then
        [ "$(command -v qlog_warn 2>/dev/null)" ] && qlog_warn "ttl_state_apply: invalid HL '$hl'"
        return 1
    fi

    # --- Drain ALL existing TTL/HL rules on rmnet+ ---
    # iptables -D removes one rule per invocation. If duplicates exist (from
    # past racy applies, manual edits, or boot+CGI double-apply), a single -D
    # leaves stragglers that lie to the next read_live. Loop until empty.
    # Bound iterations to avoid infinite loops if delete silently no-ops.
    local val i=0
    while [ "$i" -lt 32 ]; do
        val=$(run_iptables -w 5 -t mangle -vnL POSTROUTING 2>/dev/null \
            | grep -io 'TTL set to [0-9]*' \
            | head -n1 \
            | awk '{print $4}')
        _ttl_is_int "$val" || break
        [ "$val" -eq 0 ] && break
        run_iptables -w 5 -t mangle -D POSTROUTING \
            -o rmnet+ -j TTL --ttl-set "$val" 2>/dev/null || break
        i=$((i + 1))
    done

    i=0
    while [ "$i" -lt 32 ]; do
        val=$(run_ip6tables -w 5 -t mangle -vnL POSTROUTING 2>/dev/null \
            | grep -io 'HL set to [0-9]*' \
            | head -n1 \
            | awk '{print $4}')
        _ttl_is_int "$val" || break
        [ "$val" -eq 0 ] && break
        run_ip6tables -w 5 -t mangle -D POSTROUTING \
            -o rmnet+ -j HL --hl-set "$val" 2>/dev/null || break
        i=$((i + 1))
    done

    # Drop the ND/MLD exemption rules too; they are re-inserted below when HL > 0.
    local t
    for t in $_TTL_ND_TYPES; do
        i=0
        while [ "$i" -lt 8 ]; do
            run_ip6tables -w 5 -t mangle -D POSTROUTING \
                -o rmnet+ -p ipv6-icmp --icmpv6-type "$t" -j ACCEPT 2>/dev/null || break
            i=$((i + 1))
        done
    done

    # --- Insert new rules (skip if value is 0) ---
    if [ "$ttl" -gt 0 ]; then
        run_iptables -w 5 -t mangle -I POSTROUTING \
            -o rmnet+ -j TTL --ttl-set "$ttl" || return 1
    fi
    if [ "$hl" -gt 0 ]; then
        run_ip6tables -w 5 -t mangle -I POSTROUTING \
            -o rmnet+ -j HL --hl-set "$hl" || return 1
        # Inserted after the HL rule so they sit above it and ND/MLD keep their own HL.
        for t in $_TTL_ND_TYPES; do
            run_ip6tables -w 5 -t mangle -I POSTROUTING \
                -o rmnet+ -p ipv6-icmp --icmpv6-type "$t" -j ACCEPT || return 1
        done
    fi

    return 0
}

# =============================================================================
# ttl_state_clear — remove all TTL/HL rules and delete the persisted file
# =============================================================================
ttl_state_clear() {
    ttl_state_apply 0 0 || return 1
    rm -f "$TTL_STATE_FILE"
}
