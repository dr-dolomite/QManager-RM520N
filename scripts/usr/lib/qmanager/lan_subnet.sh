#!/bin/sh
# lan_subnet.sh — LAN gateway IP / subnet: read, validate, and edit mobileap_cfg.xml.
#
# QCMAP reads /etc/data/mobileap_cfg.xml at boot and generates dnsmasq's
# dhcp-range from it, so an edit here takes effect after a reboot. The file is
# the only place the netmask lives (AT+QMAP has no mask field).
#
# Writers (qm_lan_write, qm_lan_subnet_normalize) must run as root. Readers and
# the pure math helpers run as any user. Nothing here reboots or restarts anything.
#
# Return codes: 0 ok, 1 error (original file untouched).
#
# All 32-bit-unsafe math is avoided: RFC1918 addresses exceed 2^31, so the
# subnet math works on the low 16 bits (octets 3+4) only. The caller must have
# a prefix of 16..30, which makes octets 1+2 pure network bits.

[ -n "${_QM_LAN_SUBNET_LOADED:-}" ] && return 0
_QM_LAN_SUBNET_LOADED=1

: "${QM_LAN_CFG:=/etc/data/mobileap_cfg.xml}"
# Present = normalize already ran or the user saved a LAN from the UI; install/OTA then never touch the mask.
: "${QM_LAN_MARKER:=/usrdata/.qm_lan_subnet_set}"

# Scratch results of qm_lan_split / qm_lan_calc (globals by design: no subshell forks).
QM_LAN_O1="" QM_LAN_O2="" QM_LAN_O3="" QM_LAN_O4=""
QM_LAN_LOW16=0 QM_LAN_NETLOW=0 QM_LAN_HOSTMASK=0

_qm_lan_log() {
    if command -v "qlog_$1" >/dev/null 2>&1; then
        "qlog_$1" "$2"
    else
        printf 'lan_subnet: %s: %s\n' "$1" "$2" >&2
    fi
}

# --- Pure helpers ------------------------------------------------------------

# qm_lan_split <ip> — strict dotted quad (4 octets, 0-255, no leading zeros); sets QM_LAN_O1..O4.
qm_lan_split() {
    case "$1" in
        ''|*[!0-9.]*|.*|*.|*..*) return 1 ;;
    esac
    _qml_ifs=$IFS
    IFS=.
    set -- $1
    IFS=$_qml_ifs
    [ $# -eq 4 ] || return 1
    for _qml_o in "$1" "$2" "$3" "$4"; do
        [ "${#_qml_o}" -le 3 ] || return 1
        case "$_qml_o" in 0?*) return 1 ;; esac
        [ "$_qml_o" -le 255 ] || return 1
    done
    QM_LAN_O1=$1 QM_LAN_O2=$2 QM_LAN_O3=$3 QM_LAN_O4=$4
    return 0
}

# qm_lan_prefix_to_mask <0..32> — prints the dotted netmask.
qm_lan_prefix_to_mask() {
    _qml_p=$1
    case "$_qml_p" in ''|*[!0-9]*) return 1 ;; esac
    [ "${#_qml_p}" -le 2 ] && [ "$_qml_p" -le 32 ] || return 1
    _qml_out=""
    _qml_i=0
    while [ "$_qml_i" -lt 4 ]; do
        if [ "$_qml_p" -ge 8 ]; then
            _qml_v=255
            _qml_p=$((_qml_p - 8))
        elif [ "$_qml_p" -gt 0 ]; then
            _qml_v=$((256 - (1 << (8 - _qml_p))))
            _qml_p=0
        else
            _qml_v=0
        fi
        _qml_out="${_qml_out:+$_qml_out.}$_qml_v"
        _qml_i=$((_qml_i + 1))
    done
    printf '%s\n' "$_qml_out"
}

# qm_lan_mask_to_prefix <netmask> — prints the prefix; fails on a non-contiguous or malformed mask.
qm_lan_mask_to_prefix() {
    qm_lan_split "$1" || return 1
    _qml_bits=0
    _qml_seen_partial=0
    for _qml_o in "$QM_LAN_O1" "$QM_LAN_O2" "$QM_LAN_O3" "$QM_LAN_O4"; do
        [ "$_qml_seen_partial" -eq 1 ] && [ "$_qml_o" -ne 0 ] && return 1
        case "$_qml_o" in
            255) _qml_b=8 ;;
            254) _qml_b=7 ;;
            252) _qml_b=6 ;;
            248) _qml_b=5 ;;
            240) _qml_b=4 ;;
            224) _qml_b=3 ;;
            192) _qml_b=2 ;;
            128) _qml_b=1 ;;
            0)   _qml_b=0 ;;
            *)   return 1 ;;
        esac
        [ "$_qml_o" -ne 255 ] && _qml_seen_partial=1
        _qml_bits=$((_qml_bits + _qml_b))
    done
    printf '%s\n' "$_qml_bits"
}

# qm_lan_is_private <ip> — 0 only for 10/8, 172.16/12, 192.168/16 (so 100.64/10 and 169.254/16 fail).
qm_lan_is_private() {
    qm_lan_split "$1" || return 1
    case "$QM_LAN_O1" in
        10) return 0 ;;
        172) [ "$QM_LAN_O2" -ge 16 ] && [ "$QM_LAN_O2" -le 31 ] && return 0 ;;
        192) [ "$QM_LAN_O2" -eq 168 ] && return 0 ;;
    esac
    return 1
}

# qm_lan_calc <ip> <prefix 16..30> — sets QM_LAN_LOW16 (octets 3+4), NETLOW, HOSTMASK.
# With prefix >= 16 and an RFC1918 ip, the whole subnet stays inside its private block.
qm_lan_calc() {
    qm_lan_split "$1" || return 1
    case "$2" in ''|*[!0-9]*) return 1 ;; esac
    [ "${#2}" -le 2 ] && [ "$2" -ge 16 ] && [ "$2" -le 30 ] || return 1
    QM_LAN_LOW16=$((QM_LAN_O3 * 256 + QM_LAN_O4))
    QM_LAN_HOSTMASK=$(((1 << (32 - $2)) - 1))
    QM_LAN_NETLOW=$((QM_LAN_LOW16 - (QM_LAN_LOW16 & QM_LAN_HOSTMASK)))
    return 0
}

# qm_lan_host_ok <ip> <prefix> — 0 when the ip is a usable host (not the network or broadcast address).
qm_lan_host_ok() {
    qm_lan_calc "$1" "$2" || return 1
    _qml_h=$((QM_LAN_LOW16 - QM_LAN_NETLOW))
    [ "$_qml_h" -ne 0 ] && [ "$_qml_h" -ne "$QM_LAN_HOSTMASK" ]
}

# qm_lan_dhcp_range <gateway-ip> <prefix> — prints "start end".
# Rule: keep <gateway /24>.20-.170 when it sits inside the usable hosts and
# excludes the gateway; else use the larger gap beside the gateway, capped at 151 addresses.
qm_lan_dhcp_range() {
    qm_lan_host_ok "$1" "$2" || return 1
    _qml_lo=$((QM_LAN_NETLOW + 1))
    _qml_hi=$((QM_LAN_NETLOW + QM_LAN_HOSTMASK - 1))
    _qml_g=$QM_LAN_LOW16
    _qml_s=$((QM_LAN_O3 * 256 + 20))
    _qml_e=$((QM_LAN_O3 * 256 + 170))
    if [ "$_qml_s" -ge "$_qml_lo" ] && [ "$_qml_e" -le "$_qml_hi" ] \
        && { [ "$_qml_g" -lt "$_qml_s" ] || [ "$_qml_g" -gt "$_qml_e" ]; }; then
        :
    else
        if [ $((_qml_hi - _qml_g)) -ge $((_qml_g - _qml_lo)) ]; then
            _qml_s=$((_qml_g + 1))
            _qml_e=$_qml_hi
        else
            _qml_s=$_qml_lo
            _qml_e=$((_qml_g - 1))
        fi
        if [ $((_qml_e - _qml_s)) -gt 150 ]; then
            _qml_e=$((_qml_s + 150))
        fi
    fi
    printf '%s.%s.%s.%s %s.%s.%s.%s\n' \
        "$QM_LAN_O1" "$QM_LAN_O2" "$((_qml_s >> 8))" "$((_qml_s & 255))" \
        "$QM_LAN_O1" "$QM_LAN_O2" "$((_qml_e >> 8))" "$((_qml_e & 255))"
}

# --- XML read ----------------------------------------------------------------

# qm_lan_read [file] — prints "ip mask start end"; 1 = unreadable/incomplete.
# awk, not xmllint (absent on RG501Q-EU): first one-line <Tag>v</Tag> in MobileAPLanCfg (DHCPCfg for the pool).
qm_lan_read() {
    _qml_f=${1:-$QM_LAN_CFG}
    [ -r "$_qml_f" ] || return 1
    _qml_v=$(awk '
        { sub(/\r$/, "") }
        /^[[:space:]]*<MobileAPLanCfg>[[:space:]]*$/ { lan = 1; next }
        /^[[:space:]]*<\/MobileAPLanCfg>[[:space:]]*$/ { lan = 0; dhcp = 0; next }
        !lan { next }
        /^[[:space:]]*<DHCPCfg>[[:space:]]*$/ { dhcp = 1; next }
        /^[[:space:]]*<\/DHCPCfg>[[:space:]]*$/ { dhcp = 0; next }
        !/^[[:space:]]*<[A-Za-z]+>[^<]*<\/[A-Za-z]+>[[:space:]]*$/ { next }
        {
            t = $0; sub(/^[[:space:]]*</, "", t); sub(/>.*/, "", t)
            v = $0; sub(/^[[:space:]]*<[A-Za-z]+>/, "", v); sub(/<.*/, "", v)
            if (index($0, "</" t ">") == 0) next
            if (!dhcp && t == "APIPAddr" && ip == "") ip = v
            if (!dhcp && t == "SubNetMask" && mk == "") mk = v
            if (dhcp && t == "StartIP" && st == "") st = v
            if (dhcp && t == "EndIP" && en == "") en = v
        }
        END { if (ip != "" && mk != "" && st != "" && en != "") print ip, mk, st, en }
    ' "$_qml_f" 2>/dev/null) || return 1
    [ -n "$_qml_v" ] || return 1
    printf '%s\n' "$_qml_v"
}

# --- XML write ---------------------------------------------------------------

# _qm_lan_count <regex> <file> — prints the matching line count; fails on a grep error (rc 2).
_qm_lan_count() {
    _qml_n=$(grep -c -E "$1" "$2" 2>/dev/null) || { [ $? -eq 1 ] || return 1; }
    printf '%s\n' "$_qml_n"
}

# _qm_lan_line_re <Tag> [value] — anchored regex for a whole `<Tag>value</Tag>` line.
_qm_lan_line_re() {
    if [ $# -ge 2 ]; then
        _qml_vre=$(printf '%s' "$2" | sed 's/\./\\./g')
        printf '^[[:space:]]*<%s>%s</%s>[[:space:]]*$\n' "$1" "$_qml_vre" "$1"
    else
        printf '^[[:space:]]*<%s>[^<]*</%s>[[:space:]]*$\n' "$1" "$1"
    fi
}

# _qm_lan_tri <rwx-triple> — prints the octal digit for one ls mode triple.
_qm_lan_tri() {
    case "$1" in
        rwx|rws|rwt) echo 7 ;;
        rw-|rwS|rwT) echo 6 ;;
        r-x|r-s|r-t) echo 5 ;;
        r--|r-S|r-T) echo 4 ;;
        -wx|-ws|-wt) echo 3 ;;
        -w-|-wS|-wT) echo 2 ;;
        --x|--s|--t) echo 1 ;;
        ---|--S|--T) echo 0 ;;
        *) return 1 ;;
    esac
}

# _qm_lan_pin <orig> <copy> — give <copy> the owner and mode of <orig> (ls -ln); fall back to radio 0755.
_qm_lan_pin() {
    _qml_ls=$(ls -ln "$1" 2>/dev/null) || _qml_ls=""
    set -- "$1" "$2" $_qml_ls
    _qml_mode=$3 _qml_uid=$5 _qml_gid=$6
    _qml_oct=""
    case "$_qml_mode" in
        ??????????)
            _qml_t=${_qml_mode#?}
            _qml_a=$(_qm_lan_tri "${_qml_t%??????}") || _qml_a=""
            _qml_b=${_qml_t#???}
            _qml_b=$(_qm_lan_tri "${_qml_b%???}") || _qml_b=""
            _qml_c=$(_qm_lan_tri "${_qml_t#??????}") || _qml_c=""
            [ -n "$_qml_a" ] && [ -n "$_qml_b" ] && [ -n "$_qml_c" ] && _qml_oct="$_qml_a$_qml_b$_qml_c"
            ;;
    esac
    case "$_qml_uid$_qml_gid" in ''|*[!0-9]*) _qml_oct="" ;; esac
    if [ -n "$_qml_oct" ]; then
        chown "$_qml_uid:$_qml_gid" "$2" 2>/dev/null || return 1
        chmod "$_qml_oct" "$2" 2>/dev/null || return 1
    else
        chown radio:radio "$2" 2>/dev/null || return 1
        chmod 0755 "$2" 2>/dev/null || return 1
    fi
}

# qm_lan_write <file> <ip> <mask> <start> <end> — edit the four lines on a same-dir copy, validate, mv over.
# Root only. Returns 0 or 1 (original untouched).
qm_lan_write() {
    _qmw_f=$1
    [ $# -eq 5 ] || return 1
    [ -f "$_qmw_f" ] && [ ! -L "$_qmw_f" ] || { _qm_lan_log error "$_qmw_f is not a regular file"; return 1; }
    for _qmw_v in "$2" "$3" "$4" "$5"; do
        qm_lan_split "$_qmw_v" || { _qm_lan_log error "refusing malformed value '$_qmw_v'"; return 1; }
    done

    # Exactly one line per tag. `<SubNetMask>` is anchored so <WebServerSubNetMask> never matches.
    for _qmw_t in APIPAddr SubNetMask StartIP EndIP; do
        _qmw_n=$(_qm_lan_count "$(_qm_lan_line_re "$_qmw_t")" "$_qmw_f") || return 1
        [ "$_qmw_n" = "1" ] || { _qm_lan_log error "expected 1 <$_qmw_t> line, found $_qmw_n"; return 1; }
    done

    # One-time record of the factory file; never restored automatically.
    if [ ! -e "$_qmw_f.qm-bak" ]; then
        cp -p "$_qmw_f" "$_qmw_f.qm-bak" 2>/dev/null || { _qm_lan_log error "cannot write $_qmw_f.qm-bak"; return 1; }
    fi

    _qmw_tmp="$_qmw_f.qm-run.$$"
    rm -f "$_qmw_tmp"
    sed -e "s#^\([[:space:]]*\)<APIPAddr>[^<]*</APIPAddr>#\1<APIPAddr>$2</APIPAddr>#" \
        -e "s#^\([[:space:]]*\)<SubNetMask>[^<]*</SubNetMask>#\1<SubNetMask>$3</SubNetMask>#" \
        -e "s#^\([[:space:]]*\)<StartIP>[^<]*</StartIP>#\1<StartIP>$4</StartIP>#" \
        -e "s#^\([[:space:]]*\)<EndIP>[^<]*</EndIP>#\1<EndIP>$5</EndIP>#" \
        "$_qmw_f" > "$_qmw_tmp" 2>/dev/null || { rm -f "$_qmw_tmp"; _qm_lan_log error "sed failed"; return 1; }

    # Every new line present once, every other line byte-identical, the copy reads back; xmllint where present.
    _qmw_set="$2 $3 $4 $5"
    _qmw_ok=1
    for _qmw_pair in "APIPAddr:$2" "SubNetMask:$3" "StartIP:$4" "EndIP:$5"; do
        _qmw_n=$(_qm_lan_count "$(_qm_lan_line_re "${_qmw_pair%%:*}" "${_qmw_pair#*:}")" "$_qmw_tmp") || _qmw_n=x
        [ "$_qmw_n" = "1" ] || _qmw_ok=0
    done
    _qmw_re='<(APIPAddr|SubNetMask|StartIP|EndIP)>'
    _qmw_ck_a=$(grep -v -E "$_qmw_re" "$_qmw_f" 2>/dev/null | cksum)
    _qmw_ck_b=$(grep -v -E "$_qmw_re" "$_qmw_tmp" 2>/dev/null | cksum)
    [ "$_qmw_ck_a" = "$_qmw_ck_b" ] || _qmw_ok=0
    if command -v xmllint >/dev/null 2>&1; then
        xmllint --noout "$_qmw_tmp" >/dev/null 2>&1 || _qmw_ok=0
    fi
    [ "$(qm_lan_read "$_qmw_tmp" 2>/dev/null)" = "$_qmw_set" ] || _qmw_ok=0
    if [ "$_qmw_ok" -ne 1 ]; then
        rm -f "$_qmw_tmp"
        _qm_lan_log error "edited copy failed verification, original untouched"
        return 1
    fi

    _qm_lan_pin "$_qmw_f" "$_qmw_tmp" || { rm -f "$_qmw_tmp"; _qm_lan_log error "cannot pin owner/mode"; return 1; }
    mv -f "$_qmw_tmp" "$_qmw_f" 2>/dev/null || { rm -f "$_qmw_tmp"; _qm_lan_log error "mv over $_qmw_f failed"; return 1; }
    _qm_lan_log info "LAN config written: $_qmw_set"
    return 0
}

# qm_lan_mark_set — record that the LAN mask is settled; failure only logs.
qm_lan_mark_set() {
    # Subshell: BusyBox sh exits outright when a redirect on the `:` builtin fails.
    ( : > "$QM_LAN_MARKER" ) 2>/dev/null || _qm_lan_log warn "cannot write $QM_LAN_MARKER"
    return 0
}

# qm_lan_subnet_normalize [file] — runs once: factory layout (225.1 + /22 + pool in 225.2-254) -> /24.
# Skips when QM_LAN_MARKER exists; any other layout is left alone and marked. Returns 0 unless the write fails.
qm_lan_subnet_normalize() {
    _qmn_f=${1:-$QM_LAN_CFG}
    [ -e "$QM_LAN_MARKER" ] && { _qm_lan_log info "LAN subnet already settled, left as is"; return 0; }
    [ -f "$_qmn_f" ] || { _qm_lan_log info "no $_qmn_f, nothing to normalize"; return 0; }
    _qmn_cur=$(qm_lan_read "$_qmn_f") || { _qm_lan_log error "cannot read $_qmn_f"; return 1; }
    set -- $_qmn_cur
    _qmn_ok=0
    case "$1 $2 $3 $4" in
        "192.168.225.1 255.255.252.0 192.168.225."[0-9]*" 192.168.225."[0-9]*)
            # Pool must stay valid hosts under /24: 2..254, start <= end (gateway is .1).
            _qmn_s=${3##*.} _qmn_e=${4##*.}
            qm_lan_split "$3" && qm_lan_split "$4" &&
                [ "$_qmn_s" -ge 2 ] && [ "$_qmn_e" -le 254 ] && [ "$_qmn_s" -le "$_qmn_e" ] && _qmn_ok=1
            ;;
    esac
    if [ "$_qmn_ok" -ne 1 ]; then
        _qm_lan_log info "LAN layout is not the factory /22, left as is: $_qmn_cur"
        qm_lan_mark_set
        return 0
    fi
    qm_lan_write "$_qmn_f" "$1" "255.255.255.0" "$3" "$4" || return 1
    _qm_lan_log info "LAN subnet normalized 255.255.252.0 -> 255.255.255.0"
    qm_lan_mark_set
    return 0
}

# --- LAN change: request check + apply (network/lan_config.sh and Config Backup) ---

: "${QM_UPDATE_PID_FILE:=/tmp/qmanager_update.pid}"
QM_LAN_ERR="" QM_LAN_ERR_DETAIL="" QM_LAN_ERR_HTTP="" QM_LAN_NETMASK=""
QM_LAN_CUR_IP="" QM_LAN_CUR_MASK="" QM_LAN_CUR_PREFIX=""

# qm_lan_update_running — 0 while an OTA worker is alive (needs platform.sh's pid_alive).
qm_lan_update_running() {
    [ -f "$QM_UPDATE_PID_FILE" ] || return 1
    _qlu_pid=$(cat "$QM_UPDATE_PID_FILE" 2>/dev/null)
    case "$_qlu_pid" in ''|*[!0-9]*) return 1 ;; esac
    pid_alive "$_qlu_pid"
}

# qm_lan_current — sets QM_LAN_CUR_IP/MASK/PREFIX; 1 = unreadable, 2 = malformed mask.
qm_lan_current() {
    _qlc=$(qm_lan_read) || return 1
    set -- $_qlc
    QM_LAN_CUR_IP="$1"
    QM_LAN_CUR_MASK="$2"
    QM_LAN_CUR_PREFIX=$(qm_lan_mask_to_prefix "$QM_LAN_CUR_MASK") || return 2
    return 0
}

# qm_lan_check_request <ipaddr> <prefix> — sets QM_LAN_NETMASK; on failure QM_LAN_ERR + QM_LAN_ERR_DETAIL and rc 1.
qm_lan_check_request() {
    _qlr_ip=$1
    _qlr_p=$2
    case "$_qlr_p" in
        ''|*[!0-9]*)
            QM_LAN_ERR="invalid_prefix"; QM_LAN_ERR_DETAIL="prefix must be an integer between 16 and 30"; return 1 ;;
    esac
    if [ "${#_qlr_p}" -gt 2 ] || [ "$_qlr_p" -lt 16 ] || [ "$_qlr_p" -gt 30 ]; then
        QM_LAN_ERR="invalid_prefix"; QM_LAN_ERR_DETAIL="prefix must be an integer between 16 and 30"; return 1
    fi
    # Strict dotted quad: 4 octets 0-255, no leading zeros.
    if ! qm_lan_split "$_qlr_ip"; then
        QM_LAN_ERR="invalid_ipaddr"; QM_LAN_ERR_DETAIL="Address must be four numeric octets 0-255 without leading zeros"; return 1
    fi
    # RFC1918 only; with prefix >= 16 the whole subnet stays inside its private block.
    if ! qm_lan_is_private "$_qlr_ip"; then
        QM_LAN_ERR="invalid_private_address"; QM_LAN_ERR_DETAIL="Address must be in 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16"; return 1
    fi
    if ! qm_lan_host_ok "$_qlr_ip" "$_qlr_p"; then
        QM_LAN_ERR="invalid_host_in_subnet"; QM_LAN_ERR_DETAIL="Address is the network/broadcast address for /$_qlr_p"; return 1
    fi
    QM_LAN_NETMASK=$(qm_lan_prefix_to_mask "$_qlr_p") || {
        QM_LAN_ERR="invalid_prefix"; QM_LAN_ERR_DETAIL="Cannot derive netmask"; return 1
    }
    return 0
}

# qm_lan_apply_run <ipaddr> <prefix> — the sudo helper; on failure QM_LAN_ERR/_DETAIL/_HTTP, QM_LAN_APPLY_RC, rc 1.
qm_lan_apply_run() {
    QM_LAN_ERR_HTTP=""
    $_SUDO -n /usr/bin/qmanager_lan_apply "$1" "$2" </dev/null >/dev/null 2>&1
    QM_LAN_APPLY_RC=$?
    case "$QM_LAN_APPLY_RC" in
        0) return 0 ;;
        3)
            QM_LAN_ERR="update_in_progress"; QM_LAN_ERR_DETAIL="A software update is running"; QM_LAN_ERR_HTTP="409 Conflict" ;;
        4)
            QM_LAN_ERR="lan_busy"; QM_LAN_ERR_DETAIL="Another LAN change is in progress" ;;
        *)
            _qm_lan_log error "qmanager_lan_apply failed (rc=$QM_LAN_APPLY_RC)"
            QM_LAN_ERR="lan_save_failed"; QM_LAN_ERR_DETAIL="Failed to save LAN settings" ;;
    esac
    return 1
}
