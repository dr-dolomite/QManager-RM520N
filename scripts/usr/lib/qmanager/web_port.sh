#!/bin/sh
# web_port.sh — QManager web port library (lighttpd HTTP/HTTPS ports)
# The port file is the one source; lighttpd.conf and the firewall are derived from it.
# Callers: qmanager_web_port, qmanager_firewall, system/web_port.sh, qmanager_health_check.
# Doc: docs/reference/web-port.md

[ -n "${_WEB_PORT_LOADED:-}" ] && return 0
_WEB_PORT_LOADED=1

WP_DEFAULT_HTTP=80
WP_DEFAULT_HTTPS=443
WP_DIR="/usrdata/qmanager"
WP_FILE="$WP_DIR/web_port"
WP_CONF="$WP_DIR/lighttpd.conf"
WP_RESULT="/tmp/qmanager_web_port_result"
WP_LOCK_DIR="/run/qmanager_web_port"
WP_LOCK="$WP_LOCK_DIR/lock"
WP_LIGHTTPD="/opt/sbin/lighttpd"
WP_NETSTAT="/opt/bin/netstat"

# 22 dropbear, 53 dnsmasq, 989 tpws, 5037 adbd, 8080 ttyd, then the browsers' unsafe-port list.
WP_RESERVED="1 7 9 11 13 15 17 19 20 21 22 23 25 37 42 43 53 69 77 79 87 95 101 102 103 104
109 110 111 113 115 117 119 123 135 137 139 143 161 179 389 427 465 512 513 514 515 526 530
531 532 540 548 554 556 563 587 601 636 989 990 993 995 1719 1720 1723 2049 3659 4045 4190
5037 5060 5061 6000 6566 6665 6666 6667 6668 6669 6679 6697 8080 10080"

# wp_port_valid <n> -> 0 for an integer 1..65535 with no leading zero.
wp_port_valid() {
    case "${1:-}" in
        ''|*[!0-9]*|0*) return 1 ;;
    esac
    [ "${#1}" -le 5 ] && [ "$1" -le 65535 ]
}

wp_port_reserved() {
    for _wpr in $WP_RESERVED; do
        [ "$_wpr" = "$1" ] && return 0
    done
    return 1
}

# wp_read_file -> sets WP_HTTP WP_HTTPS (defaults on any fault) and WP_PREV_HTTP WP_PREV_HTTPS (may be empty).
# Parsed line by line, never sourced.
wp_read_file() {
    WP_HTTP=""
    WP_HTTPS=""
    WP_PREV_HTTP=""
    WP_PREV_HTTPS=""
    if [ -f "$WP_FILE" ] && [ ! -L "$WP_FILE" ]; then
        # `|| [ -n ... ]` keeps a hand-edited last line that has no newline.
        while IFS='=' read -r _wrf_k _wrf_v || [ -n "$_wrf_k" ]; do
            wp_port_valid "$_wrf_v" || continue
            case "$_wrf_k" in
                http) WP_HTTP="$_wrf_v" ;;
                https) WP_HTTPS="$_wrf_v" ;;
                prev_http) WP_PREV_HTTP="$_wrf_v" ;;
                prev_https) WP_PREV_HTTPS="$_wrf_v" ;;
            esac
        done < "$WP_FILE"
    fi
    if [ -z "$WP_HTTP" ] || [ -z "$WP_HTTPS" ] || [ "$WP_HTTP" = "$WP_HTTPS" ]; then
        WP_HTTP=$WP_DEFAULT_HTTP
        WP_HTTPS=$WP_DEFAULT_HTTPS
    fi
    if [ -z "$WP_PREV_HTTP" ] || [ -z "$WP_PREV_HTTPS" ]; then
        WP_PREV_HTTP=""
        WP_PREV_HTTPS=""
    fi
}

wp_is_default() {
    [ "$1" = "$WP_DEFAULT_HTTP" ] && [ "$2" = "$WP_DEFAULT_HTTPS" ]
}

# wp_fw_ports -> the ports qmanager_firewall guards: the defaults, the configured pair and any prev pair.
wp_fw_ports() {
    wp_read_file
    _wfp_out=""
    for _wfp_p in $WP_DEFAULT_HTTP $WP_DEFAULT_HTTPS $WP_HTTP $WP_HTTPS $WP_PREV_HTTP $WP_PREV_HTTPS; do
        case " $_wfp_out " in *" $_wfp_p "*) ;; *) _wfp_out="$_wfp_out $_wfp_p" ;; esac
    done
    echo $_wfp_out
}

# wp_write_file <http> <https> [<prev_http> <prev_https>] -> root-only, in-dir temp + mv.
# The default pair with no prev removes the file (missing = 80/443).
wp_write_file() {
    if [ -z "${3:-}" ] && wp_is_default "$1" "$2"; then
        rm -f "$WP_FILE"
        return $?
    fi
    _wwf_tmp=$(mktemp "$WP_DIR/.web_port.XXXXXX") || return 1
    {
        printf 'http=%s\nhttps=%s\n' "$1" "$2"
        if [ -n "${3:-}" ]; then
            printf 'prev_http=%s\nprev_https=%s\n' "$3" "$4"
        fi
    } > "$_wwf_tmp" || { rm -f "$_wwf_tmp"; return 1; }
    chmod 644 "$_wwf_tmp" && chown root:root "$_wwf_tmp" && mv -f "$_wwf_tmp" "$WP_FILE" \
        || { rm -f "$_wwf_tmp"; return 1; }
}

# _wp_listeners <port> -> "PID/name" (or "-") of every TCP listener on <port>, v4 and v6.
_wp_listeners() {
    "$WP_NETSTAT" -ltnp 2>/dev/null | awk -v p="$1" '
        $1 ~ /^tcp/ { n = split($4, a, ":"); if (a[n] == p) print $NF }'
}

wp_listening() {
    _wp_listeners "$1" | grep -q '/lighttpd$'
}

# Anything listens on <port>. For www-data, which sees "-" for every root-started socket, lighttpd's included.
wp_port_open() {
    [ -n "$(_wp_listeners "$1")" ]
}

# Something other than lighttpd holds the port. Root-only: as www-data every socket shows as "-".
wp_port_taken() {
    _wp_listeners "$1" | grep -qv '/lighttpd$'
}

# wp_validate <http> <https> -> prints a code and returns 1 on failure.
# Codes: invalid_port | ports_equal | port_reserved:N | port_in_use:N
wp_validate() {
    if ! wp_port_valid "$1" || ! wp_port_valid "$2"; then
        echo "invalid_port"; return 1
    fi
    if [ "$1" = "$2" ]; then
        echo "ports_equal"; return 1
    fi
    for _wv_p in "$1" "$2"; do
        if wp_port_reserved "$_wv_p"; then
            echo "port_reserved:$_wv_p"; return 1
        fi
    done
    for _wv_p in "$1" "$2"; do
        if wp_port_taken "$_wv_p"; then
            echo "port_in_use:$_wv_p"; return 1
        fi
    done
    return 0
}

# wp_result <status> <http> <https> -> /tmp result line, root-created via temp + mv.
wp_result() {
    _wr_tmp=$(mktemp /tmp/.qmanager_web_port_result.XXXXXX) || return 1
    printf '%s %s %s %s\n' "$1" "$2" "$3" "$(date +%s)" > "$_wr_tmp"
    chmod 644 "$_wr_tmp"
    # A directory or link planted at the name would take the file inside it.
    if [ -L "$WP_RESULT" ] || [ -d "$WP_RESULT" ]; then
        rm -rf "$WP_RESULT"
    fi
    mv -f "$_wr_tmp" "$WP_RESULT" || rm -f "$_wr_tmp"
}

# _wp_render_to <http> <https> <out> -> rewrite the three marker lines of $WP_CONF into <out>.
_wp_render_to() {
    awk -v h="$1" -v s="$2" '
        / # qm:web_port:http$/ { print "server.port      = " h " # qm:web_port:http"; c1++; next }
        / # qm:web_port:https$/ { print "$SERVER[\"socket\"] == \"0.0.0.0:" s "\" { # qm:web_port:https"; c2++; next }
        / # qm:web_port:redirect$/ {
            port = (s == 443) ? "" : ":" s
            print "    url.redirect = (\"\" => \"https://${url.authority.noport}" port "${url.path}${qsa}\") # qm:web_port:redirect"
            c3++; next
        }
        { print }
        END { exit (c1 == 1 && c2 == 1 && c3 == 1) ? 0 : 1 }
    ' "$WP_CONF" > "$3"
}

# _wp_readback <http> <https> <file> -> 0 when the file carries exactly these ports.
_wp_readback() {
    _wrb_h=$(sed -n 's/^server\.port *= *\([0-9]*\) # qm:web_port:http$/\1/p' "$3")
    _wrb_s=$(sed -n 's/^\$SERVER\["socket"\] == "0\.0\.0\.0:\([0-9]*\)" { # qm:web_port:https$/\1/p' "$3")
    _wrb_r=$(sed -n 's/^.*noport}\(:[0-9]*\)\{0,1\}\${url\.path}.* # qm:web_port:redirect$/x\1/p' "$3")
    _wrb_want="x"
    [ "$2" = "$WP_DEFAULT_HTTPS" ] || _wrb_want="x:$2"
    [ "$_wrb_h" = "$1" ] && [ "$_wrb_s" = "$2" ] && [ "$_wrb_r" = "$_wrb_want" ]
}

# _wp_render_pair <http> <https> -> write $WP_CONF.new, read it back, -tt it, mv.
# 0 = conf replaced, 10 = conf already had these ports, 1 = failure. Both 0 and 10 passed -tt.
_wp_render_pair() {
    _wrp_new="$WP_CONF.new"
    rm -f "$_wrp_new"
    _wp_render_to "$1" "$2" "$_wrp_new" || { rm -f "$_wrp_new"; return 1; }
    _wp_readback "$1" "$2" "$_wrp_new" || { rm -f "$_wrp_new"; return 1; }
    "$WP_LIGHTTPD" -tt -f "$_wrp_new" >/dev/null 2>&1 || { rm -f "$_wrp_new"; return 1; }
    if cmp -s "$_wrp_new" "$WP_CONF"; then
        rm -f "$_wrp_new"
        return 10
    fi
    chmod 644 "$_wrp_new" && chown root:root "$_wrp_new" && mv -f "$_wrp_new" "$WP_CONF" \
        || { rm -f "$_wrp_new"; return 1; }
    sync
}

# wp_render -> conf from the port file; on failure resets the port file and renders 80/443.
# Prints rendered|current|fallback|failed <http> <https>; never fails, so lighttpd.service always starts.
wp_render() {
    wp_read_file
    # No binary (e.g. /opt not mounted yet) says nothing about the port: keep the saved one.
    if [ ! -x "$WP_LIGHTTPD" ]; then
        echo "failed $WP_HTTP $WP_HTTPS"
        return 0
    fi
    _wp_render_pair "$WP_HTTP" "$WP_HTTPS"
    case $? in
        0) echo "rendered $WP_HTTP $WP_HTTPS"; return 0 ;;
        10) echo "current $WP_HTTP $WP_HTTPS"; return 0 ;;
    esac
    # Reset the saved port only when 80/443 passes where it failed, so a cert or module fault keeps it.
    if ! wp_is_default "$WP_HTTP" "$WP_HTTPS"; then
        _wp_render_pair "$WP_DEFAULT_HTTP" "$WP_DEFAULT_HTTPS"
        case $? in
            0|10)
                wp_write_file "$WP_DEFAULT_HTTP" "$WP_DEFAULT_HTTPS"
                echo "fallback $WP_DEFAULT_HTTP $WP_DEFAULT_HTTPS"
                return 0
                ;;
        esac
    fi
    echo "failed $WP_HTTP $WP_HTTPS"
    return 0
}

_wp_pid_is() {
    case "${1:-}" in ''|*[!0-9]*) return 1 ;; esac
    [ -r "/proc/$1/cmdline" ] || return 1
    case "$(tr '\000' ' ' < "/proc/$1/cmdline" 2>/dev/null)" in
        *"$2"*) return 0 ;;
    esac
    return 1
}

# wp_busy -> prints update | restore when one runs.
wp_busy() {
    if _wp_pid_is "$(cat /tmp/qmanager_update.pid 2>/dev/null)" qmanager_update; then
        echo "update"; return 0
    fi
    if _wp_pid_is "$(cat /tmp/qmanager_config_restore.pid 2>/dev/null)" qmanager_config_restore; then
        echo "restore"; return 0
    fi
    return 1
}
