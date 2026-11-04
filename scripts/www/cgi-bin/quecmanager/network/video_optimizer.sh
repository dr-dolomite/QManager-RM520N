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
#   GET ...?section=full_bypass
#       → Full Bypass settings + engine status (adds sni_domain)
#       Legacy alias: ?section=masquerade (see "The rename" below)
#   GET ...?action=verify_status
#       → poll /tmp/qmanager_dpi_verify.json (running|complete|idle|error)
#   GET ...?action=install_status
#       → poll /tmp/qmanager_dpi_install.json (idle|running|complete|error)
#   POST {"action":"save","enabled":bool}
#       → Video Optimizer enable/disable (mutex: disables full bypass)
#   POST {"action":"save_full_bypass","enabled":bool,"sni_domain":str}
#       → Full Bypass enable/disable (mutex: disables video optimizer)
#       Legacy alias: "save_masquerade" (see "The rename" below)
#
# The rename (2026-09-01)
# -----------------------
# "Traffic Masquerade" became "Full Bypass". The old name described the RM551E
# behaviour, where nfqws rewrote the ClientHello's SNI to a spoofed identity;
# tpws, this platform's engine, has no fake-SNI mode and only splits the real
# ClientHello, so nothing was ever masqueraded here. The mode differs from
# Video Optimizer in SCOPE (no hostlist), which is what the new name says.
#
# ?section=masquerade and action=save_masquerade are kept as deprecated
# aliases for ONE release. An OTA replaces this script and the JS bundle
# together, so a device is never half-updated — but a browser tab left open
# across the OTA still holds the old bundle, and without the aliases its next
# write returns unknown_action. Remove both aliases once no supported upgrade
# path can still be serving the old bundle.
#   POST {"action":"save_force_tcp","enabled":bool}
#       → QUIC Force-TCP toggle (standalone iptables rule, independent of the
#         engine: no binary check, no mutex, untouched by install/uninstall)
#   POST {"action":"verify"}
#       → spawn the two-phase speed comparison
#   POST {"action":"install"}
#       → spawn the tpws binary installer
#   POST {"action":"uninstall"}
#       → spawn the tpws binary removal (idempotent)
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
    if [ "$1" = "full_bypass" ]; then
        enabled=$(qm_config_get full_bypass enabled 0)
        sni=$(qm_config_get full_bypass sni_domain 'speedtest.net')
    else
        enabled=$(qm_config_get video_optimizer enabled 0)
    fi
    status=$(dpi_service_status)
    # "enabled" is the config intent; the engine may be stopped because the
    # binary isn't installed yet — the UI reads both, exactly like RM551.
    # The full-bypass view merges sni_domain in the SAME jq pass (RM551 emits
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
        --argjson ftcp "$([ "$(qm_config_get quic force_tcp 0)" = "1" ] && echo true || echo false)" \
        --argjson ftcpact "$(dpi_force_tcp_rule_present && echo true || echo false)" \
        '{success:true,enabled:$enabled,status:$status,uptime:$uptime,packets_processed:$pkts,domains_loaded:$domains,binary_installed:$bin,kernel_module_loaded:$kmod,force_tcp:$ftcp,force_tcp_active:$ftcpact}')
    if [ "$1" = "full_bypass" ]; then
        printf '%s' "$json" | jq --arg sni_domain "$sni" '. + {sni_domain: $sni_domain}'
    else
        printf '%s' "$json"
    fi
}

# ---------------------------------------------------------------------------
# GET routing
# ---------------------------------------------------------------------------
if [ "$REQUEST_METHOD" = "GET" ]; then
    case "$ACTION" in
        verify_status)
            if [ -f "$DPI_VERIFY_FILE" ] && [ -s "$DPI_VERIFY_FILE" ]; then
                jq -n --argjson body "$(cat "$DPI_VERIFY_FILE" 2>/dev/null)" \
                    '{success:true,status:$body.status,timestamp:$body.timestamp,without_bypass:$body.without_bypass,with_bypass:$body.with_bypass,reference:$body.reference,improvement:$body.improvement,message:$body.message,detail:$body.detail}'
            else
                echo '{"success":true,"status":"idle"}'
            fi
            exit 0
            ;;
        install_status)
            # worker_alive lets the UI distinguish a slow download from a
            # dead installer instead of idling to a blind timeout.
            dpi_alive=false
            if [ -f "$DPI_INSTALL_PID" ] && pid_alive "$(cat "$DPI_INSTALL_PID" 2>/dev/null)"; then
                dpi_alive=true
            fi
            if [ -f "$DPI_INSTALL_FILE" ] && [ -s "$DPI_INSTALL_FILE" ]; then
                # The writer truncates the marker in place, so a poll can
                # catch a half-written line — re-read once before giving up,
                # and never let an unreadable state blank the UI message.
                _dpi_read() {
                    jq -n --argjson body "$(cat "$DPI_INSTALL_FILE" 2>/dev/null)" \
                        '{success:($body.status=="complete"),status:$body.status,message:($body.message//""),detail:($body.detail//"")}' 2>/dev/null
                }
                OUT=$(_dpi_read)
                [ -n "$OUT" ] || { sleep 1; OUT=$(_dpi_read); }
                if [ -n "$OUT" ]; then
                    # A "running" marker whose worker is gone AND which hasn't
                    # been touched in 30s means the installer died mid-run
                    # without recording a terminal state. The age guard avoids
                    # misreading the normal finish race (final marker written,
                    # process not yet exited).
                    _st=$(printf '%s' "$OUT" | jq -r .status)
                    if [ "$_st" = "running" ] && [ "$dpi_alive" != true ]; then
                        _now=$(date +%s)
                        _mtime=$(stat -c %Y "$DPI_INSTALL_FILE" 2>/dev/null || echo "$_now")
                        [ $((_now - _mtime)) -gt 30 ] && \
                            OUT='{"success":false,"status":"error","message":"Installer exited unexpectedly","detail":"no completion was recorded"}'
                    fi
                    printf '%s' "$OUT" | jq -c --argjson wa "$dpi_alive" '. + {worker_alive:$wa}'
                elif [ "$dpi_alive" = true ]; then
                    echo '{"success":true,"status":"running","message":"Working…","detail":"","worker_alive":true}'
                else
                    echo '{"success":false,"status":"error","message":"Installer exited unexpectedly","detail":"no status was recorded","worker_alive":false}'
                fi
            else
                printf '{"success":true,"status":"idle","worker_alive":%s}\n' "$dpi_alive"
            fi
            exit 0
            ;;
        hostlist)
            # UI-support endpoint (extension beyond the documented contract):
            # read the hostlist file as a domain array — comments stripped,
            # lines trimmed. sed/grep only: this firmware's Entware jq is
            # compiled WITHOUT Oniguruma regex support, so gsub()-based
            # parsing aborts at runtime and the endpoint returns nothing.
            if [ -f "$DPI_HOSTLIST" ]; then
                domains=$(sed -e 's/\r$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$DPI_HOSTLIST" \
                          | grep -v '^#' | grep -v '^$' | jq -R . | jq -s .)
                [ -n "$domains" ] || domains='[]'
                jq -n --argjson domains "$domains" '{success:true,domains:$domains}'
            else
                echo '{"success":true,"domains":[]}'
            fi
            exit 0
            ;;
        *)
            if [ "$SECTION" = "hostlist" ]; then
                # RM551-contract section: read the hostlist + the default
                # list (for restore) as domain arrays — comments stripped,
                # lines trimmed (a stray whitespace line would poison the
                # next save's strict per-domain validation).
                if [ -f "$DPI_HOSTLIST" ]; then
                    domains=$(sed -e 's/\r$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$DPI_HOSTLIST" \
                              | grep -v '^#' | grep -v '^$' | jq -R . | jq -s .)
                    [ -n "$domains" ] || domains='[]'
                else
                    domains='[]'
                fi
                if [ -f "$DPI_HOSTLIST_DEFAULT" ]; then
                    default_domains=$(sed -e 's/\r$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$DPI_HOSTLIST_DEFAULT" \
                                      | grep -v '^#' | grep -v '^$' | jq -R . | jq -s .)
                    [ -n "$default_domains" ] || default_domains='[]'
                else
                    default_domains='[]'
                fi
                count=$(printf '%s' "$domains" | jq 'length')
                jq -n --argjson domains "$domains" --argjson default_domains "$default_domains" --argjson count "$count" \
                    '{"success":true,"domains":$domains,"default_domains":$default_domains,"count":$count}'
                exit 0
            fi
            # "masquerade" is the pre-rename spelling, accepted for one release
            # so a browser tab held open across an OTA keeps reading status.
            if [ "$SECTION" = "full_bypass" ] || [ "$SECTION" = "masquerade" ]; then
                # sni_domain is stored for API-REFERENCE contract parity but is
                # inert in the tpws engine (no fake-SNI mode) — see dpi_state.sh.
                emit_status full_bypass
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
            EN_INT=$(dpi_bool_of "$EN") || {
                cgi_error "invalid_enabled" "enabled must be true or false"
                exit 0
            }
            # Binary check, config + mutex, engine start/stop: lib dpi_state.sh.
            dpi_save_mode video_optimizer "$EN_INT"
            case $? in
                2) cgi_error "binary_not_installed" "tpws is not installed — run install first"; exit 0 ;;
                3) cgi_error "engine_start_failed" "settings saved but the engine did not start"; exit 0 ;;
            esac
            cgi_success
            exit 0
            ;;
        save_full_bypass|save_masquerade)
            # --- Full Bypass save ---
            # "save_masquerade" is the pre-rename action name, accepted for one
            # release so a browser tab held open across an OTA can still write.
            # has() — NOT "// empty": jq's alternative operator treats `false`
            # as absent (false // empty → no output), so a disable request
            # read as an empty string and failed bool_of validation.
            EN=$(printf '%s' "$POST_DATA" | jq -r 'if has("enabled") then .enabled else empty end' 2>/dev/null)
            EN_INT=$(dpi_bool_of "$EN") || {
                cgi_error "invalid_enabled" "enabled must be true or false"
                exit 0
            }
            # sni_domain: validated + stored for API-REFERENCE contract parity
            # (RM551's fake-SNI domain), inert in the tpws engine — Full Bypass
            # splits every real ClientHello instead of forging one. That gap is
            # what the rename was for. See docs/reference/dpi.md.
            SNI=$(printf '%s' "$POST_DATA" | jq -r '.sni_domain // "speedtest.net"' 2>/dev/null)
            dpi_sni_valid "$SNI" || { cgi_error "invalid_sni_domain" "$DPI_SNI_ERR"; exit 0; }
            dpi_save_mode full_bypass "$EN_INT" "$SNI" "$ACTION"
            case $? in
                2) cgi_error "binary_not_installed" "tpws is not installed — run install first"; exit 0 ;;
                3) cgi_error "engine_start_failed" "settings saved but the engine did not start"; exit 0 ;;
            esac
            cgi_success
            exit 0
            ;;
        save_force_tcp)
            # --- QUIC Force-TCP save ---
            # Standalone QUIC handle — deliberately NO binary check, no
            # mutex, no svc_start/stop: install/uninstall and engine
            # enable/disable have nothing to do with this rule. The rule is
            # applied/removed here and re-asserted every 60s by the ensure
            # timer (independent of engine state).
            EN=$(printf '%s' "$POST_DATA" | jq -r 'if has("enabled") then .enabled else empty end' 2>/dev/null)
            EN_INT=$(dpi_bool_of "$EN") || {
                cgi_error "invalid_enabled" "enabled must be true or false"
                exit 0
            }
            dpi_save_force_tcp "$EN_INT"
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
            # Pre-flight using the EXACT command line the sudoers rule
            # whitelists (-n = never prompt): a broken sudoers setup fails
            # here, visibly, instead of as a silent detached-spawn death.
            if ! $_SUDO -n /usr/bin/qmanager_dpi_install --probe >/dev/null 2>&1; then
                cgi_error "sudo_unavailable" "cannot escalate via sudo"
                exit 0
            fi
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
        uninstall)
            # --- Spawn tpws binary removal ---
            # Mirror of install: same sudoers pre-flight, same detached spawn,
            # same marker protocol for install_status polling.
            if ! $_SUDO -n /usr/bin/qmanager_dpi_install --probe >/dev/null 2>&1; then
                cgi_error "sudo_unavailable" "cannot escalate via sudo"
                exit 0
            fi
            if [ -f "$DPI_INSTALL_PID" ] && pid_alive "$(cat "$DPI_INSTALL_PID" 2>/dev/null)"; then
                echo '{"success":true,"status":"running"}'
                exit 0
            fi
            if ! dpi_binary_installed; then
                echo '{"success":true,"status":"already"}'
                exit 0
            fi
            $_SUDO /usr/bin/qmanager_dpi_install uninstall </dev/null >/dev/null 2>&1 &
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
                qlog_info "save_hostlist rejected: no payload"
                cgi_error "invalid_hostlist" "domains must be a non-empty array"
                exit 0
            }
            # Shape + per-domain validation and the atomic write: lib dpi_state.sh.
            dpi_hostlist_check "$DOMAINS" || {
                qlog_info "save_hostlist rejected: $DPI_HL_LOG"
                cgi_error "invalid_hostlist" "$DPI_HL_DETAIL"
                exit 0
            }
            if dpi_hostlist_write "$DOMAINS"; then
                cgi_success
            else
                cgi_error "write_failed" "could not write the hostlist file"
            fi
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