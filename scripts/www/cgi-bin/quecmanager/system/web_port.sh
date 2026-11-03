#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# web_port.sh — CGI Endpoint: QManager web ports (GET + POST)
# =============================================================================
# GET  -> {success, http_port, https_port, listening:{http,https},
#          last_result:{status:"pending|applied|unchanged|rolled_back|failed", http_port, https_port, at}|null}
# POST {"http_port":N,"https_port":N} -> {success, apply_in_progress, http_port, https_port}
# The apply restarts lighttpd about 1 s after this reply (detached, see qmanager_web_port).
# Errors: invalid_port | ports_equal | port_reserved | port_in_use | busy | apply_failed
#
# Endpoint: GET/POST /cgi-bin/quecmanager/system/web_port.sh
# Doc: docs/reference/web-port.md
# =============================================================================

qlog_init "cgi_web_port"
cgi_headers
cgi_handle_options

if [ ! -f /usr/lib/qmanager/web_port.sh ]; then
    cgi_error "apply_failed" "Web port library is missing"
    exit 0
fi
. /usr/lib/qmanager/web_port.sh

bool() { "$@" && echo true || echo false; }

emit_state() {
    wp_read_file
    _last="null"
    if [ -r "$WP_RESULT" ] && read -r _st _rh _rs _at < "$WP_RESULT" \
       && wp_port_valid "$_rh" && wp_port_valid "$_rs"; then
        case "$_st" in
            pending|applied|unchanged|rolled_back|failed) ;;
            *) _st="failed" ;;
        esac
        case "$_at" in ''|*[!0-9]*) _at=0 ;; esac
        _last=$(jq -n --arg status "$_st" --argjson h "$_rh" --argjson s "$_rs" \
            --argjson at "$_at" '{status:$status, http_port:$h, https_port:$s, at:$at}')
    fi
    jq -n \
        --argjson http "$WP_HTTP" \
        --argjson https "$WP_HTTPS" \
        --argjson lh "$(bool wp_port_open "$WP_HTTP")" \
        --argjson ls "$(bool wp_port_open "$WP_HTTPS")" \
        --argjson last "$_last" \
        '{success:true, http_port:$http, https_port:$https,
          listening:{http:$lh, https:$ls}, last_result:$last}'
}

if [ "$REQUEST_METHOD" = "GET" ]; then
    emit_state
    exit 0
fi

if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    # Numbers only (device jq has no regex); the helper validates the range and the rest.
    HTTP_PORT=$(printf '%s' "$POST_DATA" | jq -r 'if (.http_port | type) == "number" then (.http_port | floor | tostring) else empty end' 2>/dev/null)
    HTTPS_PORT=$(printf '%s' "$POST_DATA" | jq -r 'if (.https_port | type) == "number" then (.https_port | floor | tostring) else empty end' 2>/dev/null)
    if ! wp_port_valid "$HTTP_PORT" || ! wp_port_valid "$HTTPS_PORT"; then
        cgi_error "invalid_port" "Ports must be whole numbers from 1 to 65535"
        exit 0
    fi

    OUT=$(sudo -n /usr/bin/qmanager_web_port set "$HTTP_PORT" "$HTTPS_PORT" 2>/dev/null)
    set -- $OUT
    case "${1:-}" in
        applying|unchanged)
            _moving=false
            [ "$1" = "applying" ] && _moving=true
            qlog_info "Web port $1: http=$HTTP_PORT https=$HTTPS_PORT"
            jq -n --argjson m "$_moving" --argjson h "$HTTP_PORT" --argjson s "$HTTPS_PORT" \
                '{success:true, apply_in_progress:$m, http_port:$h, https_port:$s}'
            ;;
        error)
            case "${2:-}" in
                invalid_port) cgi_error "invalid_port" "Ports must be whole numbers from 1 to 65535" ;;
                ports_equal) cgi_error "ports_equal" "HTTP and HTTPS need different ports" ;;
                port_reserved) cgi_error "port_reserved" "Port ${3:-} is reserved" ;;
                port_in_use) cgi_error "port_in_use" "Port ${3:-} is already used by another service" ;;
                busy) cgi_error "busy" "${3:-apply}" ;;
                *) cgi_error "apply_failed" "${3:-${2:-}}" ;;
            esac
            ;;
        *)
            cgi_error "apply_failed" "The web port helper did not answer"
            ;;
    esac
    exit 0
fi

cgi_method_not_allowed
