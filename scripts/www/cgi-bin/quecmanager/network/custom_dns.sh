#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/network_validate.sh
# =============================================================================
# custom_dns.sh — CGI Endpoint: Custom DNS Server Configuration (GET + POST)
# =============================================================================
# GET:  Reads the QManager-managed sentinel block from /etc/data/dnsmasq.conf,
#       reports enabled state, configured servers, and dnsmasq proxy availability.
# POST action=save:
#       Validates input, stages a candidate and pre-checks it with dnsmasq --test,
#       then hands off to the root helper qmanager_dns_apply (re-validates the
#       sentinel block, installs radio:radio, HUPs dnsmasq).
# POST action=clear:
#       Strips the sentinel block and reloads — equivalent to save with enabled=false.
#
# Config injection target:  /etc/data/dnsmasq.conf  (persistent UBIFS, same
#   volume as /usrdata; QCMAP includes it via conf-file= in the runtime bridge0
#   config and never rewrites anything outside known dhcp-option-force fields)
#
# Sentinel format:
#   # QMANAGER-CUSTOM-DNS-BEGIN v1
#   no-resolv                        (only when ignoreCarrier=true)
#   server=1.1.1.1                   (one line per upstream; max 4)
#   # QMANAGER-CUSTOM-DNS-END v1
#
# Sudoers-required commands:
#   sudo -n /usr/bin/qmanager_dns_apply apply
#
# Endpoint: GET/POST /cgi-bin/quecmanager/network/custom_dns.sh
# Install:  /www/cgi-bin/quecmanager/network/custom_dns.sh
# =============================================================================

qlog_init "cgi_custom_dns"
cgi_headers
cgi_handle_options

# =============================================================================
# Helpers
# =============================================================================

# get_passthrough_bypass — true when IP passthrough is active AND DNS proxy is
# disabled, meaning LAN clients bypass dnsmasq entirely.
# Both fields live in mobileap_cfg.xml.
# Returns the literal strings "true" or "false".
get_passthrough_bypass() {
    # TODO: full passthrough-bypass detection needs robust XML parsing of
    # MPDN_rule fields; returning false is the safe default (frontend treats
    # false as "no interop concern").
    printf "false"
}

# build_get_payload — emit the full GET JSON object.
# Used by GET directly and also embedded in a successful POST response.
build_get_payload() {
    local conf_missing=0
    local block_corrupt=0
    local enabled=false
    local ignore_carrier=false
    local servers_json="[]"
    local dns_mode
    local available=false
    local current_upstream_json="[]"
    local current_source="unknown"
    local passthrough_bypass

    # --- Config presence + sentinel block (lib: network_validate.sh) ---
    qm_dns_read_state
    conf_missing=$QM_DNS_CONF_MISSING
    block_corrupt=$QM_DNS_CORRUPT
    enabled=$QM_DNS_ENABLED
    ignore_carrier=$QM_DNS_IGNORE
    servers_json=$QM_DNS_SERVERS_JSON

    # --- DNS mode from XML ---
    dns_mode=$(qm_dns_mode)
    if qm_dns_mode_available "$dns_mode"; then
        available=true
    fi

    # --- Current upstream resolution ---
    if [ "$enabled" = "true" ]; then
        # Our block is active — live upstream is our configured servers
        current_upstream_json="$servers_json"
        current_source="custom"
    else
        # Carrier-assigned upstream: /run/resolv.conf, else /etc/resolv.conf
        # (SDX55 has only the latter). First candidate with nameservers wins.
        local resolv_file
        local resolv_json
        for resolv_file in /run/resolv.conf /etc/resolv.conf; do
            [ -f "$resolv_file" ] || continue
            resolv_json=$(grep '^nameserver ' "$resolv_file" \
                | awk '{print $2}' \
                | jq -R . \
                | jq -s .)
            if [ -n "$resolv_json" ] && [ "$resolv_json" != "[]" ]; then
                current_upstream_json="$resolv_json"
                current_source="carrier"
                break
            fi
        done
    fi

    # --- Passthrough bypass ---
    passthrough_bypass=$(get_passthrough_bypass)

    # --- Emit JSON ---
    if [ "$conf_missing" -eq 1 ]; then
        jq -n \
            --argjson enabled false \
            --argjson available false \
            '{"enabled":$enabled,"ignoreCarrier":false,"servers":[],"dnsMode":"UNKNOWN","available":$available,"currentUpstream":[],"currentSource":"unknown","passthroughBypass":false,"error":"dnsmasq config file not found"}'
        return
    fi

    jq -n \
        --argjson enabled          "$enabled" \
        --argjson ignoreCarrier    "$ignore_carrier" \
        --argjson servers          "$servers_json" \
        --arg     dnsMode          "$dns_mode" \
        --argjson available        "$available" \
        --argjson currentUpstream  "$current_upstream_json" \
        --arg     currentSource    "$current_source" \
        --argjson passthroughBypass "$passthrough_bypass" \
        --argjson blockCorrupt     "$( [ "$block_corrupt" -eq 1 ] && printf 'true' || printf 'false' )" \
        '{
            "enabled":           $enabled,
            "ignoreCarrier":     $ignoreCarrier,
            "servers":           $servers,
            "dnsMode":           $dnsMode,
            "available":         $available,
            "currentUpstream":   $currentUpstream,
            "currentSource":     $currentSource,
            "passthroughBypass": $passthroughBypass,
            "blockCorrupt":      $blockCorrupt
        }'
}

# =============================================================================
# GET — read current state
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "GET custom DNS config"
    build_get_payload
    exit 0
fi

# =============================================================================
# POST — save or clear
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')

    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action=clear — strip our block and reload; same path as save with enabled=false
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "clear" ]; then
        POST_DATA=$(printf '{"action":"save","enabled":"false","ignore_carrier":"false","servers":""}')
        ACTION="save"
        qlog_info "action=clear mapped to save with enabled=false"
    fi

    # -------------------------------------------------------------------------
    # action=save
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "save" ]; then

        # has() — NOT "// empty": jq's alternative operator treats `false` as
        # absent (false // empty → no output), so a disable request read as an
        # empty string and failed the true|false gate below.
        ENABLED=$(printf '%s' "$POST_DATA" | jq -r 'if has("enabled") then .enabled else empty end')
        IGNORE_CARRIER=$(printf '%s' "$POST_DATA" | jq -r 'if has("ignore_carrier") then .ignore_carrier else "false" end')
        SERVERS_RAW=$(printf '%s' "$POST_DATA" | jq -r '.servers // empty')

        qlog_info "save: enabled=$ENABLED ignore_carrier=$IGNORE_CARRIER servers=$SERVERS_RAW"

        # --- Validate enabled ---
        case "$ENABLED" in
            true|false) ;;
            *)
                jq -n '{"ok":false,"error":"enabled must be true or false","field":"enabled"}'
                exit 0
                ;;
        esac

        # --- Validate ignore_carrier ---
        case "$IGNORE_CARRIER" in
            true|false) ;;
            *)
                jq -n '{"ok":false,"error":"ignore_carrier must be true or false","field":"ignore_carrier"}'
                exit 0
                ;;
        esac

        # --- Gate: dnsMode must be PROXY ---
        dns_mode=$(qm_dns_mode)
        if ! qm_dns_mode_available "$dns_mode"; then
            jq -n --arg mode "$dns_mode" \
                '{"ok":false,"error":"Custom DNS is unavailable while DNS Mode is \($mode)"}'
            # HTTP 409 body; lighttpd reads status from Status: header if present
            # cgi_base.sh emits headers already — annotate with a comment here
            # noting the semantic intent (409 Conflict).
            exit 0
        fi

        # --- Validate and collect servers (only when enabled=true) ---
        server_list=""
        server_count=0

        if [ "$ENABLED" = "true" ]; then
            if [ -z "$SERVERS_RAW" ]; then
                jq -n '{"ok":false,"error":"at least one server is required when enabled is true","field":"servers"}'
                exit 0
            fi

            # SERVERS_RAW is comma-separated; split on commas. Save and restore
            # the original IFS so we don't permanently clobber the POSIX default
            # (space-tab-newline) for the rest of the script.
            old_IFS="$IFS"
            IFS=','
            for raw_addr in $SERVERS_RAW; do
                IFS="$old_IFS"
                # Strip surrounding whitespace
                addr=$(printf '%s' "$raw_addr" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
                if [ -z "$addr" ]; then
                    IFS=','
                    continue
                fi

                if ! qm_dns_valid_ip "$addr"; then
                    IFS="$old_IFS"
                    jq -n --arg addr "$addr" \
                        '{"ok":false,"error":"invalid IP address: \($addr)","field":"servers"}'
                    exit 0
                fi

                server_count=$((server_count + 1))
                if [ "$server_count" -gt "$QM_DNS_MAX_SERVERS" ]; then
                    IFS="$old_IFS"
                    jq -n --arg max "$QM_DNS_MAX_SERVERS" \
                        '{"ok":false,"error":"too many servers (max \($max))","field":"servers"}'
                    exit 0
                fi

                server_list="${server_list}server=${addr}
"
                IFS=','
            done
            IFS="$old_IFS"

            if [ "$server_count" -eq 0 ]; then
                jq -n '{"ok":false,"error":"at least one valid server is required","field":"servers"}'
                exit 0
            fi
        fi

        # --- Stage, dnsmasq --test, root helper (lib: network_validate.sh) ---
        if ! qm_dns_apply_candidate "$ENABLED" "$IGNORE_CARRIER" "$server_list"; then
            jq -n --arg error "$QM_DNS_ERR" '{"ok":false,"error":$error}'
            exit 0
        fi

        qlog_info "custom DNS applied successfully"

        # --- Return ok + full current state so frontend avoids a refetch ---
        applied=$(build_get_payload)
        jq -n --argjson applied "$applied" '{"ok":true,"applied":$applied}'
        exit 0
    fi

    # --- Unknown action ---
    cgi_error "invalid_action" "action must be save or clear"
    exit 0
fi

# --- Method not allowed -------------------------------------------------------
cgi_method_not_allowed
