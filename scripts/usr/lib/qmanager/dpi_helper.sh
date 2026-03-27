#!/bin/sh
# dpi_helper.sh — Video Optimizer (DPI evasion) shared functions
# Sourced by: qmanager_dpi (init.d), video_optimizer.sh (CGI), qmanager_dpi_verify

[ -n "$_DPI_HELPER_LOADED" ] && return 0
_DPI_HELPER_LOADED=1

NFQWS_BIN="/usr/bin/nfqws"
NFQWS_PID="/var/run/nfqws.pid"
DPI_HOSTLIST="/etc/qmanager/video_domains.txt"
DPI_HOSTLIST_DEFAULT="/etc/qmanager/video_domains_default.txt"
DPI_QUEUE_NUM=200
# Auto-detect cellular interface from default route, fallback to rmnet_data0
DPI_INTERFACE=$(ip route 2>/dev/null | awk '/^default/{print $5; exit}')
DPI_INTERFACE="${DPI_INTERFACE:-rmnet_data0}"
DPI_NFT_COMMENT="qmanager_dpi"

# Check if nfqws binary is installed and executable
dpi_check_binary() {
    [ -x "$NFQWS_BIN" ]
}

# Check if NFQUEUE kernel support is available (built-in or module)
dpi_check_kmod() {
    # Check if compiled into kernel (CONFIG_NETFILTER_NETLINK_QUEUE=y)
    if zcat /proc/config.gz 2>/dev/null | grep -q 'CONFIG_NETFILTER_NETLINK_QUEUE=y'; then
        return 0
    fi
    # Check if loaded as module
    if lsmod 2>/dev/null | grep -q nfnetlink_queue; then
        return 0
    fi
    # Try loading as module
    modprobe nfnetlink_queue 2>/dev/null || return 1
    return 0
}

# Insert nftables NFQUEUE rules for DPI evasion on the configured interface
dpi_insert_rules() {
    local iface="${1:-$DPI_INTERFACE}"

    # TCP — intercept first 1-4 packets of TLS handshake on port 443
    nft add rule inet fw4 mangle_postrouting oifname "$iface" tcp dport 443 \
        ct original packets 1-4 counter queue num "$DPI_QUEUE_NUM" bypass \
        comment "\"$DPI_NFT_COMMENT\"" 2>/dev/null || return 1

    # QUIC — intercept first 1-4 packets of QUIC handshake on port 443
    nft add rule inet fw4 mangle_postrouting oifname "$iface" udp dport 443 \
        ct original packets 1-4 counter queue num "$DPI_QUEUE_NUM" bypass \
        comment "\"$DPI_NFT_COMMENT\"" 2>/dev/null || return 1

    return 0
}

# Remove all DPI nftables rules (identified by comment)
dpi_remove_rules() {
    # List postrouting rules, find handles for our rules, delete them
    nft -a list chain inet fw4 mangle_postrouting 2>/dev/null | \
        grep "$DPI_NFT_COMMENT" | \
        awk '{print $NF}' | \
        while read handle; do
            nft delete rule inet fw4 mangle_postrouting handle "$handle" 2>/dev/null
        done
    return 0
}

# Get service status: running, stopped, or error
dpi_get_status() {
    if [ -f "$NFQWS_PID" ] && kill -0 "$(cat "$NFQWS_PID" 2>/dev/null)" 2>/dev/null; then
        echo "running"
    else
        echo "stopped"
    fi
}

# Calculate uptime from PID file timestamp
dpi_get_uptime() {
    if [ ! -f "$NFQWS_PID" ]; then
        echo "0s"
        return
    fi

    local now pid_mtime elapsed
    now=$(date +%s)
    pid_mtime=$(stat -c %Y "$NFQWS_PID" 2>/dev/null) || { echo "0s"; return; }
    elapsed=$((now - pid_mtime))

    if [ "$elapsed" -ge 86400 ]; then
        echo "$((elapsed / 86400))d $((elapsed % 86400 / 3600))h"
    elif [ "$elapsed" -ge 3600 ]; then
        echo "$((elapsed / 3600))h $((elapsed % 3600 / 60))m"
    elif [ "$elapsed" -ge 60 ]; then
        echo "$((elapsed / 60))m $((elapsed % 60))s"
    else
        echo "${elapsed}s"
    fi
}

# Read packet count from nftables rule counters
dpi_get_packet_count() {
    local count=0
    count=$(nft list chain inet fw4 mangle_postrouting 2>/dev/null | \
        awk '/'"$DPI_NFT_COMMENT"'/ && /packets/ {for(i=1;i<=NF;i++) if($i=="packets") sum+=$(i+1)} END {print sum+0}')
    echo "${count:-0}"
}

# Count domains loaded from hostlist
dpi_get_domain_count() {
    if [ -f "$DPI_HOSTLIST" ]; then
        grep -v '^[[:space:]]*#' "$DPI_HOSTLIST" 2>/dev/null | grep -c -v '^[[:space:]]*$' || echo "0"
    else
        echo "0"
    fi
}

# Check if required shared libraries are present
dpi_check_libs() {
    for lib in libnetfilter_queue libnfnetlink libmnl; do
        if ! find /usr/lib -name "${lib}*" -type f 2>/dev/null | grep -q .; then
            return 1
        fi
    done
    return 0
}
