#!/bin/sh
# =============================================================================
# video_optimizer.sh — CGI Endpoint: Traffic Engine (DPI) status & control
# =============================================================================
# Implements the documented DPI Settings contract in docs/API-REFERENCE.md
# (re-ported from the RM551E branch, re-architected around the tpws engine).
#
# Endpoints:
#   GET /cgi-bin/quecmanager/network/video_optimizer.sh
#       → Video Optimizer settings + engine status
#   GET ...?section=masquerade
#       → Traffic Masquerade settings + engine status (adds sni_domain)
#   GET ...?action=verify_status
#       → poll /tmp/qmanager_dpi_verify.json (running|complete|idle|error)
#   GET ...?action=install_status
#       → poll /tmp/qmanager_dpi_install.json (idle|running|complete|error)
#   POST {"action":"save","enabled":bool}
#       → Video Optimizer enable/disable (mutex: disables masquerade)
#   POST {"action":"save_masquerade","enabled":bool,"sni_domain":str}
#       → Traffic Masquerade enable/disable (mutex: disables video optimizer)
#   POST {"action":"verify"}
#       → spawn the two-phase speed comparison
#   POST {"action":"install"}
#       → spawn the tpws binary installer
#
# Status values: running | stopped | restarting | error
# "kernel_module_loaded" reports whether the REDIRECT rule is applied — the
# tpws engine needs no kernel module (nfqws did); the field keeps its
# contract slot and carries the closest equivalent truth.
#
# Install location: /www/cgi-bin/quecmanager/network/video_optimizer.sh
# =============================================================================

. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/platform.sh
. /usr/lib/qmanager/config.sh
. /usr/lib/qmanager/dpi_state.sh

qlog_init "cgi_video_optimizer"
cgi_headers
cgi_handle_options

# ---------------------------------------------------------------------------
# Query param extraction (action / section)
# NOTE: QUERY_STRING never carries a leading "?" or "&" — the RM551 pattern
# s/.*action=\([^&]*\).*/\1/p must be used verbatim; an earlier port that
# required [?&] silently matched NOTHING, so every action= GET fell through
# to the plain status endpoint.
# ---------------------------------------------------------------------------
ACTION=""
SECTION=""
if [ -n "$QUERY_STRING" ]; then
    ACTION=$(printf '%s' "$QUERY_STRING" | sed -n 's/.*action=\([^&]*\).*/\1/p')
    SECTION=$(printf '%s' "$QUERY_STRING" | sed -n 's/.*section=\([^&]*\).*/\1/p')
fi

# ---------------------------------------------------------------------------
# Emit the engine status JSON shared by both modes
# ---------------------------------------------------------------------------
emit_status() {
    local enabled status sni json
    if [ "$1" = "masquerade" ]; then
        enabled=$(qm_config_get traffic_masquerade enabled 0)
        sni=$(qm_config_get traffic_masquerade sni_domain 'speedtest.net')
    else
        enabled=$(qm_config_get video_optimizer enabled 0)
    fi
    status=$(dpi_service_status)
    # "enabled" is the config intent; the engine may be stopped because the
    # binary isn't installed yet — the UI reads both, exactly like RM551.
    # The masquerade view merges sni_domain in the SAME jq pass (RM551 emits
    # a single self-contained document; a pipeline-merge with `input` would
    # break, since `input` without -n consumes the one stdin line and then
    # hits EOF).
    json=$(jq -n \
        --argjson enabled "$([ "$enabled" = "1" ] && echo true || echo false)" \
        --arg status "$status" \
        --arg uptime "$(dpi_uptime_str)" \
        --argjson pkts "$(dpi_packets_processed)" \
        --argjson domains "$(dpi_domains_loaded)" \
        --argjson bin "$(dpi_binary_installed && echo true || echo false)" \
        --argjson kmod "$(dpi_rule_present && echo true || echo false)" \
        '{success:true,enabled:$enabled,status:$status,uptime:$uptime,packets_processed:$pkts,domains_loaded:$domains,binary_installed:$bin,kernel_module_loaded:$kmod}')
    if [ "$1" = "masquerade" ]; then
        printf '%s' "$json" | jq --arg sni_domain "$sni" '. + {sni_domain: $sni_domain}'
    else
        printf '%s' "$json"
    fi
}

# ---------------------------------------------------------------------------
# Boolean validation — contract payloads use real booleans
# ---------------------------------------------------------------------------
bool_of() {
    case "$1" in
        true) echo 1 ;;
        false) echo 0 ;;
        *) return 1 ;;
    esac
}

# ---------------------------------------------------------------------------
# GET routing
# ---------------------------------------------------------------------------
if [ "$REQUEST_METHOD" = "GET" ]; then
    case "$ACTION" in
        verify_status)
            if [ -f "$DPI_VERIFY_FILE" ] && [ -s "$DPI_VERIFY_FILE" ]; then
                jq -n --argjson body "$(cat "$DPI_VERIFY_FILE" 2>/dev/null)" \
                    '{success:true,status:$body.status,timestamp:$body.timestamp,without_bypass:$body.without_bypass,with_bypass:$body.with_bypass,improvement:$body.improvement,message:$body.message,detail:$body.detail}'
            else
                echo '{"success":true,"status":"idle"}'
            fi
            exit 0
            ;;
        install_status)
            if [ -f "$DPI_INSTALL_FILE" ] && [ -s "$DPI_INSTALL_FILE" ]; then
                # Contract shape: running is success:false (in progress),
                # complete is success:true, error is success:false.
                jq -n --argjson body "$(cat "$DPI_INSTALL_FILE" 2>/dev/null)" \
                    '{success:($body.status=="complete"),status:$body.status,message:$body.message,detail:$body.detail}'
            else
                echo '{"success":true,"status":"idle"}'
            fi
            exit 0
            ;;
        hostlist)
            # UI-support endpoint (extension beyond the documented contract):
            # read the hostlist file as a domain array, comments stripped.
            if [ -f "$DPI_HOSTLIST" ]; then
                jq -R -s '
                    split("\n") |
                    map(gsub("\r"; "") | select(length > 0)) |
                    map(select(startswith("#") | not)) |
                    {success:true, domains:.}
                ' "$DPI_HOSTLIST" 2>/dev/null
            else
                echo '{"success":true,"domains":[]}'
            fi
            exit 0
            ;;
        *)
            if [ "$SECTION" = "hostlist" ]; then
                # RM551-contract section: read the hostlist + the default
                # list (for restore) as domain arrays, comments stripped.
                if [ -f "$DPI_HOSTLIST" ]; then
                    domains=$(grep -v '^[[:space:]]*#' "$DPI_HOSTLIST" | grep -v '^[[:space:]]*$' | jq -R . | jq -s .)
                else
                    domains='[]'
                fi
                if [ -f "$DPI_HOSTLIST_DEFAULT" ]; then
                    default_domains=$(grep -v '^[[:space:]]*#' "$DPI_HOSTLIST_DEFAULT" | grep -v '^[[:space:]]*$' | jq -R . | jq -s .)
                else
                    default_domains='[]'
                fi
                count=$(printf '%s' "$domains" | jq 'length')
                jq -n --argjson domains "$domains" --argjson default_domains "$default_domains" --argjson count "$count" \
                    '{"success":true,"domains":$domains,"default_domains":$default_domains,"count":$count}'
                exit 0
            fi
            if [ "$SECTION" = "masquerade" ]; then
                # sni_domain is stored for API-REFERENCE contract parity but is
                # inert in the tpws engine (no fake-SNI mode) — see dpi_state.sh.
                emit_status masquerade
            else
                emit_status
            fi
            exit 0
            ;;
    esac
fi

# ---------------------------------------------------------------------------
# POST routing
# ---------------------------------------------------------------------------
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty' 2>/dev/null)
    case "$ACTION" in
        save)
            # --- Video Optimizer save ---
            # has() — NOT "// empty": jq's alternative operator treats `false`
            # as absent (false // empty → no output), so a disable request
            # read as an empty string and failed bool_of validation.
            EN=$(printf '%s' "$POST_DATA" | jq -r 'if has("enabled") then .enabled else empty end' 2>/dev/null)
            EN_INT=$(bool_of "$EN") || {
                cgi_error "invalid_enabled" "enabled must be true or false"
                exit 0
            }
            # Engine requires the binary — refuse to "enable" into a dead state.
            if [ "$EN_INT" = "1" ] && ! dpi_binary_installed; then
                cgi_error "binary_not_installed" "tpws is not installed — run install first"
                exit 0
            fi
            qm_config_set video_optimizer enabled "$EN_INT"
            # Mutex: video optimizer owns the engine; masquerade must yield.
            qm_config_set traffic_masquerade enabled 0
            qlog_info "save: video_optimizer enabled=$EN_INT"
            if [ "$EN_INT" = "1" ]; then
                svc_start qmanager-dpi
            else
                dpi_remove_rule
                svc_stop qmanager-dpi
            fi
            cgi_success
            exit 0
            ;;
        save_masquerade)
            # --- Traffic Masquerade save ---
            # has() — NOT "// empty": jq's alternative operator treats `false`
            # as absent (false // empty → no output), so a disable request
            # read as an empty string and failed bool_of validation.
            EN=$(printf '%s' "$POST_DATA" | jq -r 'if has("enabled") then .enabled else empty end' 2>/dev/null)
            EN_INT=$(bool_of "$EN") || {
                cgi_error "invalid_enabled" "enabled must be true or false"
                exit 0
            }
            # sni_domain: validated + stored for API-REFERENCE contract parity
            # (RM551's fake-SNI domain), inert in the tpws engine — masquerade
            # splits every ClientHello instead. See docs/reference/dpi.md.
            SNI=$(printf '%s' "$POST_DATA" | jq -r '.sni_domain // "speedtest.net"' 2>/dev/null)
            case "$SNI" in
                ''|*[!A-Za-z0-9._-]*) cgi_error "invalid_sni_domain" "sni_domain contains invalid characters"; exit 0 ;;
            esac
            if ! printf '%s' "$SNI" | grep -q '\.'; then
                cgi_error "invalid_sni_domain" "sni_domain must contain at least one dot"
                exit 0
            fi
            [ "${#SNI}" -le 253 ] || {
                cgi_error "invalid_sni_domain" "sni_domain exceeds 253 characters"
                exit 0
            }
            if [ "$EN_INT" = "1" ] && ! dpi_binary_installed; then
                cgi_error "binary_not_installed" "tpws is not installed — run install first"
                exit 0
            fi
            qm_config_set traffic_masquerade enabled "$EN_INT"
            qm_config_set traffic_masquerade sni_domain "$SNI"
            # Mutex: masquerade owns the engine; video optimizer must yield.
            qm_config_set video_optimizer enabled 0
            qlog_info "save_masquerade: enabled=$EN_INT sni_domain=$SNI"
            if [ "$EN_INT" = "1" ]; then
                svc_start qmanager-dpi
            else
                dpi_remove_rule
                svc_stop qmanager-dpi
            fi
            cgi_success
            exit 0
            ;;
        verify)
            # --- Spawn two-phase speed comparison ---
            if [ -f "$DPI_VERIFY_PID" ] && pid_alive "$(cat "$DPI_VERIFY_PID" 2>/dev/null)"; then
                echo '{"success":true,"status":"running"}'
                exit 0
            fi
            if ! dpi_binary_installed; then
                cgi_error "binary_not_installed" "tpws is not installed — run install first"
                exit 0
            fi
            $_SUDO /usr/bin/qmanager_dpi_verify start </dev/null >/dev/null 2>&1 &
            echo '{"success":true,"status":"started"}'
            exit 0
            ;;
        install)
            # --- Spawn tpws installer ---
            if [ -f "$DPI_INSTALL_PID" ] && pid_alive "$(cat "$DPI_INSTALL_PID" 2>/dev/null)"; then
                echo '{"success":true,"status":"running"}'
                exit 0
            fi
            if dpi_binary_installed; then
                echo '{"success":true,"status":"already"}'
                exit 0
            fi
            $_SUDO /usr/bin/qmanager_dpi_install install </dev/null >/dev/null 2>&1 &
            echo '{"success":true,"status":"started"}'
            exit 0
            ;;
        save_hostlist)
            # UI-support endpoint (extension beyond the documented contract):
            # atomically rewrite the hostlist. Validation is two-pass: the
            # array shape + per-domain charset/length/count, then the atomic
            # write. www-data owns the file, so no sudo is involved.
            DOMAINS=$(printf '%s' "$POST_DATA" | jq -r '.domains // empty' 2>/dev/null)
            [ -n "$DOMAINS" ] || {
                cgi_error "invalid_hostlist" "domains must be a non-empty array"
                exit 0
            }
            printf '%s' "$DOMAINS" | jq -e 'type == "array" and length <= 300' >/dev/null 2>&1 || {
                cgi_error "invalid_hostlist" "domains must be an array of at most 300 entries"
                exit 0
            }
            printf '%s' "$DOMAINS" | jq -e '
                all(.[]; type == "string" and length > 0 and length <= 253
                     and test("^[A-Za-z0-9._-]+$") and contains("."))' >/dev/null 2>&1 || {
                cgi_error "invalid_hostlist" "each domain must be a valid hostname (letters, digits, dots, dashes)"
                exit 0
            }
            {
                printf '# QManager Video Optimizer hostlist\n'
                printf '%s' "$DOMAINS" | jq -r '.[]'
            } > "$DPI_HOSTLIST.tmp" && mv "$DPI_HOSTLIST.tmp" "$DPI_HOSTLIST"
            qlog_info "save_hostlist: $(printf '%s' "$DOMAINS" | jq 'length') domains written"
            cgi_success
            exit 0
            ;;
        restore_hostlist)
            # RM551-contract action: restore the factory default hostlist.
            # The default file is seeded by qmanager_setup; www-data owns both
            # files so no sudo is involved (same atomic tmp+mv pattern).
            if [ ! -f "$DPI_HOSTLIST_DEFAULT" ]; then
                cgi_error "no_default" "Default hostname list not found"
                exit 0
            fi
            cp "$DPI_HOSTLIST_DEFAULT" "$DPI_HOSTLIST.tmp" && mv "$DPI_HOSTLIST.tmp" "$DPI_HOSTLIST"
            qlog_info "restore_hostlist: restored factory default"
            cgi_success
            exit 0
            ;;
        *)
            cgi_error "invalid_action" "Unknown action '$ACTION'"
            exit 0
            ;;
    esac
fi

cgi_method_not_allowed