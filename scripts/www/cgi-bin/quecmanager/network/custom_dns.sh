#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# custom_dns.sh — CGI Endpoint: Custom DNS Server Configuration (GET + POST)
# =============================================================================
# GET:  Reads the QManager-managed sentinel block from /etc/data/dnsmasq.conf,
#       reports enabled state, configured servers, and dnsmasq proxy availability.
# POST action=save:
#       Validates input, builds a candidate config, validates with dnsmasq --test,
#       atomically swaps it in, chowns it back to radio:radio, then HUPs dnsmasq.
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
#   sudo /bin/mv /etc/data/dnsmasq.conf.qmanager.new /etc/data/dnsmasq.conf
#   sudo /bin/chown radio:radio /etc/data/dnsmasq.conf
#   sudo /usr/bin/killall -HUP dnsmasq
#
# Endpoint: GET/POST /cgi-bin/quecmanager/network/custom_dns.sh
# Install:  /www/cgi-bin/quecmanager/network/custom_dns.sh
# =============================================================================

qlog_init "cgi_custom_dns"
cgi_headers
cgi_handle_options

# --- Constants ----------------------------------------------------------------
DNSMASQ_CONF="/etc/data/dnsmasq.conf"
STAGING_FILE="/etc/data/dnsmasq.conf.qmanager.new"
MOBILEAP_XML="/etc/data/mobileap_cfg.xml"
SENTINEL_BEGIN="# QMANAGER-CUSTOM-DNS-BEGIN v1"
SENTINEL_END="# QMANAGER-CUSTOM-DNS-END v1"
MAX_SERVERS=4

# =============================================================================
# Helpers
# =============================================================================

# get_dns_mode — extract <DNSMode> from mobileap_cfg.xml.
# Tries xmlstarlet first; falls back to grep+sed.
get_dns_mode() {
    if [ ! -f "$MOBILEAP_XML" ]; then
        printf "UNKNOWN"
        return
    fi
    local val
    if command -v xmlstarlet >/dev/null 2>&1; then
        val=$(xmlstarlet sel -t -v "//DNSMode" "$MOBILEAP_XML" 2>/dev/null)
    else
        val=$(grep -oE '<DNSMode>[^<]*</DNSMode>' "$MOBILEAP_XML" 2>/dev/null \
              | sed 's/<[^>]*>//g')
    fi
    printf '%s' "${val:-UNKNOWN}"
}

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

# validate_ip_addr — returns 0 if the argument looks like a valid IPv4 or IPv6
# address.  Uses a permissive regex — the real gate is dnsmasq --test.
validate_ip_addr() {
    local addr="$1"
    # IPv4: four dotted decimal octets 0-255
    case "$addr" in
        *:*) : ;;   # contains colon — treat as IPv6 below
        [0-9]*.[0-9]*.[0-9]*.[0-9]*)
            # Each octet must be 0-255
            local IFS='.'
            set -- $addr
            [ $# -eq 4 ] || return 1
            for octet in "$@"; do
                case "$octet" in
                    ''|*[!0-9]*) return 1 ;;
                esac
                [ "$octet" -ge 0 ] && [ "$octet" -le 255 ] || return 1
            done
            return 0
            ;;
        *) return 1 ;;
    esac
    # IPv6: must contain at least one colon and only hex digits, colons, or
    # a single '%' scope suffix; empty segments from '::' are fine.
    case "$addr" in
        *[!0-9A-Fa-f:.]* ) return 1 ;;
        *:*) return 0 ;;
    esac
    return 1
}

# parse_sentinel_block — emit only the lines between our sentinels (exclusive).
# Returns nothing if the block is not present or is corrupted.
# Signals corruption via exit status 2.
parse_sentinel_block() {
    local file="$1"
    local in_block=0
    local found_begin=0
    local found_end=0
    while IFS= read -r line; do
        case "$line" in
            "$SENTINEL_BEGIN")
                found_begin=1
                in_block=1
                ;;
            "$SENTINEL_END")
                found_end=1
                in_block=0
                ;;
            *)
                [ "$in_block" -eq 1 ] && printf '%s\n' "$line"
                ;;
        esac
    done < "$file"
    # Corrupted: one sentinel present without the other
    if [ "$found_begin" -eq 1 ] && [ "$found_end" -eq 0 ]; then return 2; fi
    if [ "$found_begin" -eq 0 ] && [ "$found_end" -eq 1 ]; then return 2; fi
    return 0
}

# strip_sentinel_block — write every line of $1 to stdout EXCEPT the sentinel
# block and its delimiters.
strip_sentinel_block() {
    local file="$1"
    local in_block=0
    while IFS= read -r line; do
        case "$line" in
            "$SENTINEL_BEGIN") in_block=1 ;;
            "$SENTINEL_END")   in_block=0 ;;
            *)
                [ "$in_block" -eq 0 ] && printf '%s\n' "$line"
                ;;
        esac
    done < "$file"
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

    # --- Config file presence ---
    if [ ! -f "$DNSMASQ_CONF" ]; then
        conf_missing=1
    fi

    # --- Parse sentinel block ---
    if [ "$conf_missing" -eq 0 ]; then
        block_content=$(parse_sentinel_block "$DNSMASQ_CONF")
        block_status=$?

        if [ "$block_status" -eq 2 ]; then
            block_corrupt=1
            # Return enabled=false — frontend offers "Clear stored config"
        elif [ "$block_status" -eq 0 ] && [ -n "$block_content" ]; then
            enabled=true
            # Extract no-resolv and server= lines from block content
            if printf '%s\n' "$block_content" | grep -q '^no-resolv$'; then
                ignore_carrier=true
            fi
            # Build servers array from server= lines
            servers_json=$(printf '%s\n' "$block_content" \
                | grep '^server=' \
                | sed 's/^server=//' \
                | jq -R . \
                | jq -s .)
        fi
    fi

    # --- DNS mode from XML ---
    dns_mode=$(get_dns_mode)
    if [ "$dns_mode" = "PROXY" ]; then
        available=true
    fi

    # --- Current upstream resolution ---
    if [ "$enabled" = "true" ]; then
        # Our block is active — live upstream is our configured servers
        current_upstream_json="$servers_json"
        current_source="custom"
    else
        # Read from /run/resolv.conf (carrier-assigned)
        if [ -f "/run/resolv.conf" ]; then
            current_upstream_json=$(grep '^nameserver ' /run/resolv.conf \
                | awk '{print $2}' \
                | jq -R . \
                | jq -s .)
            if [ "$current_upstream_json" != "[]" ] && [ -n "$current_upstream_json" ]; then
                current_source="carrier"
            fi
        fi
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

        ENABLED=$(printf '%s' "$POST_DATA" | jq -r '.enabled // empty')
        IGNORE_CARRIER=$(printf '%s' "$POST_DATA" | jq -r '.ignore_carrier // "false"')
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
        dns_mode=$(get_dns_mode)
        if [ "$dns_mode" != "PROXY" ]; then
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

                if ! validate_ip_addr "$addr"; then
                    IFS="$old_IFS"
                    jq -n --arg addr "$addr" \
                        '{"ok":false,"error":"invalid IP address: \($addr)","field":"servers"}'
                    exit 0
                fi

                server_count=$((server_count + 1))
                if [ "$server_count" -gt "$MAX_SERVERS" ]; then
                    IFS="$old_IFS"
                    jq -n --arg max "$MAX_SERVERS" \
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

        # --- Confirm config file exists ---
        if [ ! -f "$DNSMASQ_CONF" ]; then
            jq -n '{"ok":false,"error":"dnsmasq config file not found"}'
            exit 0
        fi

        # --- Build candidate file: strip old block, optionally append new one ---
        {
            strip_sentinel_block "$DNSMASQ_CONF"
            if [ "$ENABLED" = "true" ]; then
                printf '%s\n' "$SENTINEL_BEGIN"
                if [ "$IGNORE_CARRIER" = "true" ]; then
                    printf 'no-resolv\n'
                fi
                # server_list already has each line terminated with \n
                printf '%s' "$server_list"
                printf '%s\n' "$SENTINEL_END"
            fi
        } > "$STAGING_FILE"

        write_status=$?
        if [ "$write_status" -ne 0 ]; then
            rm -f "$STAGING_FILE"
            jq -n '{"ok":false,"error":"failed to write staging config file"}'
            exit 0
        fi

        # --- Server-side syntax validation ---
        dnsmasq_err=$(dnsmasq --test --conf-file="$STAGING_FILE" 2>&1)
        dnsmasq_exit=$?
        if [ "$dnsmasq_exit" -ne 0 ]; then
            rm -f "$STAGING_FILE"
            jq -n --arg err "$dnsmasq_err" \
                '{"ok":false,"error":"dnsmasq rejected this configuration: \($err)"}'
            exit 0
        fi

        qlog_info "dnsmasq --test passed; applying"

        # --- Apply: atomic mv + chown + HUP ---
        if ! sudo /bin/mv "$STAGING_FILE" "$DNSMASQ_CONF"; then
            rm -f "$STAGING_FILE"
            jq -n '{"ok":false,"error":"failed to install config (mv failed)"}'
            exit 0
        fi

        if ! sudo /bin/chown radio:radio "$DNSMASQ_CONF"; then
            qlog_warn "chown radio:radio failed (non-fatal but QCMAP rewrites may break)"
        fi

        if ! sudo /usr/bin/killall -HUP dnsmasq; then
            qlog_warn "killall -HUP dnsmasq failed — settings saved but not yet live"
            jq -n '{"ok":false,"error":"config saved but dnsmasq reload failed; try rebooting"}'
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
