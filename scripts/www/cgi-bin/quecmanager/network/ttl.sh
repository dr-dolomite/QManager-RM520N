#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/platform.sh
. /usr/lib/qmanager/ttl_state.sh
# =============================================================================
# ttl.sh — CGI Endpoint: TTL / Hop Limit Configuration (GET + POST)
# =============================================================================
# GET:  Returns live iptables state (not the persisted file) so the UI always
#       reflects what is actually in the kernel.
# POST: Validates input, applies via ttl_state_apply, persists via
#       ttl_state_write_persisted, then re-reads live state for the response.
#       Explicit cgi_error on apply or persist failure — no silent success.
#
# State file: /etc/qmanager/ttl_state  (writable by www-data, plain key=value)
# Boot persistence: /lib/systemd/system/qmanager_ttl.service
#
# POST body: { "ttl": 64, "hl": 64 }
#   - ttl: 0-255  (0 = disable / use default)
#   - hl:  0-255  (0 = disable / use default)
#
# Endpoint: GET/POST /cgi-bin/quecmanager/network/ttl.sh
# Install location: /www/cgi-bin/quecmanager/network/ttl.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_ttl"
cgi_headers
cgi_handle_options

# --- Configuration -----------------------------------------------------------
TTL_INIT="qmanager_ttl"

# =============================================================================
# GET — Read current TTL/HL configuration
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Reading TTL/HL configuration"

    set -- $(ttl_state_read_live)
    cur_ttl="$1"
    cur_hl="$2"

    is_enabled="false"
    if [ "$cur_ttl" -gt 0 ] 2>/dev/null || [ "$cur_hl" -gt 0 ] 2>/dev/null; then
        is_enabled="true"
    fi

    autostart="false"
    if svc_is_enabled "$TTL_INIT"; then
        autostart="true"
    fi

    qlog_info "Current (live): TTL=$cur_ttl HL=$cur_hl enabled=$is_enabled autostart=$autostart"

    jq -n \
        --argjson is_enabled "$is_enabled" \
        --argjson ttl "$cur_ttl" \
        --argjson hl "$cur_hl" \
        --argjson autostart "$autostart" \
        '{
            success: true,
            is_enabled: $is_enabled,
            ttl: $ttl,
            hl: $hl,
            autostart: $autostart
        }'
    exit 0
fi

# =============================================================================
# POST — Apply TTL/HL configuration
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    new_ttl=$(printf '%s' "$POST_DATA" | jq -r '.ttl // 0')
    new_hl=$(printf '%s' "$POST_DATA" | jq -r '.hl // 0')

    ttl_state_validate_field TTL "$new_ttl" || { cgi_error "$TTL_ERR_CODE" "$TTL_ERR_DETAIL"; exit 0; }
    ttl_state_validate_field HL "$new_hl" || { cgi_error "$TTL_ERR_CODE" "$TTL_ERR_DETAIL"; exit 0; }

    qlog_info "Applying TTL=$new_ttl HL=$new_hl"

    # Apply to kernel first; if iptables fails, surface it before persisting
    if ! ttl_state_apply "$new_ttl" "$new_hl"; then
        qlog_error "ttl_state_apply failed for TTL=$new_ttl HL=$new_hl"
        cgi_error "apply_failed" "Failed to apply iptables rules"
        exit 0
    fi

    # Persist; if write fails, surface it (rules are live but won't survive reboot)
    if ! ttl_state_write_persisted "$new_ttl" "$new_hl"; then
        qlog_error "ttl_state_write_persisted failed for TTL=$new_ttl HL=$new_hl"
        cgi_error "persist_failed" "Rules applied but failed to persist to disk"
        exit 0
    fi

    # Re-read LIVE state so response reflects reality (not what client sent)
    set -- $(ttl_state_read_live)
    cur_ttl="$1"
    cur_hl="$2"

    is_enabled="false"
    if [ "$cur_ttl" -gt 0 ] 2>/dev/null || [ "$cur_hl" -gt 0 ] 2>/dev/null; then
        is_enabled="true"
    fi

    qlog_info "TTL/HL applied & persisted: TTL=$cur_ttl HL=$cur_hl enabled=$is_enabled"

    jq -n \
        --argjson is_enabled "$is_enabled" \
        --argjson ttl "$cur_ttl" \
        --argjson hl "$cur_hl" \
        '{
            success: true,
            is_enabled: $is_enabled,
            ttl: $ttl,
            hl: $hl
        }'
    exit 0
fi

# --- Method not allowed -------------------------------------------------------
cgi_method_not_allowed
