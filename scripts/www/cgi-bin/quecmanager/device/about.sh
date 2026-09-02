#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/cgi_at.sh
# =============================================================================
# about.sh -- CGI Endpoint: About Device (GET-only)
# =============================================================================
# Gathers device identity, network addresses, 3GPP release info, public IPs,
# and host system info into a single JSON response.
#
# Data sources:
#   /tmp/qmanager_status.json       -> Poller cache (firmware, IMEI, WAN IPs,
#                                       LAN IP/gateway via collect_boot_data)
#   AT+QNWCFG="3gpp_rel"           -> 3GPP release versions (LTE, NR5G)
#   https://api.ipify.org           -> Public IPv4 (3s timeout, non-blocking)
#   https://api6.ipify.org          -> Public IPv6 (3s timeout, non-blocking)
#   /etc/quectel-project-version    -> Modem firmware revision, read through
#                                       hw_profile.sh (never parsed here)
#   uname -r                       -> Linux kernel version
#
# Endpoint: GET /cgi-bin/quecmanager/device/about.sh
# Install location: /www/cgi-bin/quecmanager/device/about.sh
# =============================================================================

qlog_init "cgi_about"
cgi_headers
cgi_handle_options

# Hardware identity library — the single tolerant parser for the Quectel vendor
# version file. Sourced AFTER cgi_headers on purpose: hw_profile.sh emits
# nothing at source time today (its top level is only `:` defaults, two
# constants and function definitions), but a library that ever did would
# corrupt the HTTP headers, and the ordering costs nothing.
#
# Guarded, and it logs on both arms — mirroring qmanager_poller:417-423. A
# missing library is a partial install / mid-OTA / rollback window, not an
# error worth failing the whole endpoint over: resolve_firmware_revision()
# below degrades to an empty firmware string and every other field still
# serves.
if [ -f /usr/lib/qmanager/hw_profile.sh ]; then
    . /usr/lib/qmanager/hw_profile.sh 2>/dev/null \
        || qlog_error "hw_profile.sh failed to load; firmware revision reports empty"
else
    qlog_error "hw_profile.sh not found; firmware revision reports empty"
fi

CACHE_FILE="/tmp/qmanager_status.json"
CMD_GAP=0.2
PUB_IP_TIMEOUT=3

# --- Cleanup for temp files --------------------------------------------------
pub4_file="/tmp/qmanager_pub_ipv4.$$"
pub6_file="/tmp/qmanager_pub_ipv6.$$"
cleanup() {
    rm -f "$pub4_file" "$pub6_file"
}
trap cleanup EXIT INT TERM

# --- GET only ----------------------------------------------------------------
if [ "$REQUEST_METHOD" != "GET" ]; then
    cgi_method_not_allowed
    exit 0
fi

# =============================================================================
# 1. Fire off public IP fetches FIRST (background, non-blocking)
#    These run in parallel while we do everything else.
# =============================================================================
if command -v curl >/dev/null 2>&1; then
    # -L: follow redirects; -k: tolerate missing CA certs
    ( curl -sLk --max-time "$PUB_IP_TIMEOUT" https://api.ipify.org > "$pub4_file" 2>/dev/null ) &
    pid4=$!
    ( curl -sLk --max-time "$PUB_IP_TIMEOUT" https://api6.ipify.org > "$pub6_file" 2>/dev/null ) &
    pid6=$!
else
    pid4=""
    pid6=""
fi

# =============================================================================
# 2. Read poller cache (single jq call)
# =============================================================================
c_firmware=""
c_build_date=""
c_manufacturer=""
c_model=""
c_imei=""
c_wan_ipv4=""
c_wan_ipv6=""
lan_ip=""
lan_gateway=""

if [ -f "$CACHE_FILE" ]; then
    eval "$(jq -r '
        @sh "c_firmware=\(.device.firmware // "")",
        @sh "c_build_date=\(.device.build_date // "")",
        @sh "c_manufacturer=\(.device.manufacturer // "")",
        @sh "c_model=\(.device.model // "")",
        @sh "c_imei=\(.device.imei // "")",
        @sh "c_wan_ipv4=\(.network.wan_ipv4 // "")",
        @sh "c_wan_ipv6=\(.network.wan_ipv6 // "")",
        @sh "lan_ip=\(.network.device_ip // "")",
        @sh "lan_gateway=\(.network.lan_gateway // "")"
    ' "$CACHE_FILE" 2>/dev/null)"
fi

# =============================================================================
# 3. AT commands for data not in the poller cache
# =============================================================================
# 3GPP release is the only live AT call here. LAN IP/gateway moved to the
# poller's collect_boot_data() and is read from the cache above.
rel_lte=""
rel_nr5g=""

raw=$(qcmd 'AT+QNWCFG="3gpp_rel"' 2>/dev/null)

# 3GPP release versions -- +QNWCFG: "3gpp_rel",R17,R17
line=$(printf '%s\n' "$raw" | grep '+QNWCFG:.*"3gpp_rel"' | head -1 | tr -d '\r ')
if [ -n "$line" ]; then
    rel_lte=$(printf '%s' "$line" | cut -d',' -f2)
    rel_nr5g=$(printf '%s' "$line" | cut -d',' -f3)
fi

# =============================================================================
# 4. Host system info
# =============================================================================

# resolve_firmware_revision -- the modem firmware build string, for the About
# page's system.openwrt_version field. Display-only: nothing computes on it.
#
# Reads through hw_profile.sh's qm_hw_fw_fingerprint instead of hand-rolling a
# second parser for the same five-line vendor file. This was the LAST such
# parser in the tree; one straggler is the worst resting state, because the
# next person to touch identity reads finds two idioms and picks the wrong one.
#
# TWO NORMALIZATIONS keep the wire format matching the pre-migration output:
#
#   1. The library returns its "unknown" sentinel where the old expression
#      returned "" — deliberately, per hw_profile.sh:49-51, so that a caller
#      cannot mistake "unreadable" for a value. That is right for the library
#      and wrong for this field: `unknown` would render verbatim on the About
#      page. Map it back.
#   2. A missing library returns "" rather than aborting.
#
# RETURN, NEVER EXIT. cgi_headers has already run by this point, so an `exit`
# here would leave lighttpd emitting headers and a zero-length body — killing
# every field in the response, not just this one.
#
# NOT byte-identical to the old expression in every case, and better where it
# differs: the library takes only the first match, anchors on ^Project,
# requires a colon, strips to the first colon rather than the last, preserves
# internal spaces, and drops a trailing tab. No vendor file produces an input
# that tells them apart; the harness header enumerates all six.
resolve_firmware_revision() {
    local fw
    command -v qm_hw_fw_fingerprint >/dev/null 2>&1 || { printf ''; return 0; }
    fw=$(qm_hw_fw_fingerprint)
    [ "$fw" = "${QM_HW_UNKNOWN:-unknown}" ] && fw=""
    printf '%s' "$fw"
    return 0
}

sys_hostname=$(cat /proc/sys/kernel/hostname 2>/dev/null || echo "")
sys_kernel=$(uname -r 2>/dev/null || echo "")
sys_openwrt=$(resolve_firmware_revision)

# =============================================================================
# 5. Collect public IP results (wait for background jobs, bounded by timeout)
# =============================================================================
public_ipv4=""
public_ipv6=""

[ -n "$pid4" ] && wait "$pid4" 2>/dev/null
[ -n "$pid6" ] && wait "$pid6" 2>/dev/null

# Read and validate (basic sanity: no HTML, no error pages)
if [ -f "$pub4_file" ]; then
    raw=$(cat "$pub4_file" 2>/dev/null | tr -d '\n\r ')
    case "$raw" in
        *"<"*|"") ;;  # HTML or empty — skip
        *) public_ipv4="$raw" ;;
    esac
fi
if [ -f "$pub6_file" ]; then
    raw=$(cat "$pub6_file" 2>/dev/null | tr -d '\n\r ')
    case "$raw" in
        *"<"*|"") ;;
        *) public_ipv6="$raw" ;;
    esac
fi

# =============================================================================
# 6. Build JSON response
# =============================================================================
jq -n \
    --arg model "$c_model" \
    --arg mfr "$c_manufacturer" \
    --arg firmware "$c_firmware" \
    --arg build_date "$c_build_date" \
    --arg imei "$c_imei" \
    --arg rel_lte "$rel_lte" \
    --arg rel_nr5g "$rel_nr5g" \
    --arg device_ip "$lan_ip" \
    --arg lan_gw "$lan_gateway" \
    --arg wan4 "$c_wan_ipv4" \
    --arg wan6 "$c_wan_ipv6" \
    --arg pub4 "$public_ipv4" \
    --arg pub6 "$public_ipv6" \
    --arg hostname "$sys_hostname" \
    --arg kernel "$sys_kernel" \
    --arg owrt "$sys_openwrt" \
    '{
        success: true,
        device: {
            model: $model,
            manufacturer: $mfr,
            firmware: $firmware,
            build_date: $build_date,
            imei: $imei
        },
        "3gpp_release": {
            lte: $rel_lte,
            nr5g: $rel_nr5g
        },
        network: {
            device_ip: $device_ip,
            lan_gateway: $lan_gw,
            wan_ipv4: $wan4,
            wan_ipv6: $wan6,
            public_ipv4: $pub4,
            public_ipv6: $pub6
        },
        system: {
            hostname: $hostname,
            kernel_version: $kernel,
            openwrt_version: $owrt
        }
    }'
