#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# lan_devices.sh — CGI Endpoint: Connected LAN Devices (GET-only, read-only)
# =============================================================================
# Devices on the LAN bridge: dnsmasq DHCP leases (named) merged with the ip
# neighbour table (catches static-IP devices), deduped by MAC, lease wins.
# Backs the MAC picker on the IP Passthrough page; does not touch its apply path.
#
# Response: { success, devices: [ { mac (lowercase), ip, hostname ("" if unknown) } ] }
#
# Endpoint: GET /cgi-bin/quecmanager/network/lan_devices.sh
# Install location: /usrdata/qmanager/www/cgi-bin/quecmanager/network/lan_devices.sh
# =============================================================================

qlog_init "cgi_lan_devices"
cgi_headers
cgi_handle_options

if [ "$REQUEST_METHOD" != "GET" ]; then
    cgi_method_not_allowed
    exit 0
fi

qlog_info "Listing connected LAN devices"

# --- Bridge: bridge0 on both platforms; else the first bridge in sysfs --------
BRIDGE="bridge0"
if [ ! -d "/sys/class/net/$BRIDGE/bridge" ]; then
    BRIDGE=""
    for _b in /sys/class/net/*/bridge; do
        [ -d "$_b" ] || continue
        BRIDGE=$(basename "$(dirname "$_b")")
        break
    done
fi

# --- Lease file: dnsmasq's own argv / conf-file, else the measured path -------
LEASE_FILE=""
for _pid in $(pidof dnsmasq 2>/dev/null); do
    _args=$(tr '\0' '\n' < "/proc/$_pid/cmdline" 2>/dev/null) || continue
    LEASE_FILE=$(printf '%s\n' "$_args" | sed -n 's/^--dhcp-leasefile=//p' | head -n 1)
    if [ -z "$LEASE_FILE" ]; then
        _conf=$(printf '%s\n' "$_args" | sed -n 's/^--conf-file=//p' | head -n 1)
        [ -r "$_conf" ] && LEASE_FILE=$(sed -n 's/^dhcp-leasefile=//p' "$_conf" | head -n 1)
    fi
    [ -n "$LEASE_FILE" ] && break
done
[ -n "$LEASE_FILE" ] || LEASE_FILE="/var/run/data/dnsmasq.leases"
qlog_debug "bridge=${BRIDGE:-none} lease file=$LEASE_FILE"

# --- Neighbour table, scoped to the LAN bridge --------------------------------
if [ -n "$BRIDGE" ]; then
    NEIGH=$(ip neigh show dev "$BRIDGE" 2>/dev/null)
else
    NEIGH=$(ip neigh show 2>/dev/null)
fi

# --- Merge: leases first (named), then neighbours; IPv4 beats IPv6 for the ip -
LEASES=""
[ -r "$LEASE_FILE" ] && LEASES=$(cat "$LEASE_FILE" 2>/dev/null)

devices_tsv=$(
    {
        printf '%s\n' "$LEASES" | sed 's/^/L /'
        printf '%s\n' "$NEIGH" | sed 's/^/N /'
    } | awk '
        function ismac(m) {
            return m ~ /^[0-9a-f][0-9a-f]:[0-9a-f][0-9a-f]:[0-9a-f][0-9a-f]:[0-9a-f][0-9a-f]:[0-9a-f][0-9a-f]:[0-9a-f][0-9a-f]$/
        }
        $1 == "L" {
            mac = tolower($3)
            if (!ismac(mac) || mac in ip) next
            order[++n] = mac
            ip[mac] = $4
            host[mac] = ($5 == "*") ? "" : $5
            next
        }
        $1 == "N" {
            mac = ""
            for (i = 2; i < NF; i++) if ($i == "lladdr") mac = tolower($(i + 1))
            if (!ismac(mac)) next
            nip = $2
            if (!(mac in ip)) { order[++n] = mac; ip[mac] = ""; host[mac] = "" }
            if (ip[mac] == "" && nip !~ /:/) ip[mac] = nip
        }
        END { for (k = 1; k <= n; k++) print order[k] "\t" ip[order[k]] "\t" host[order[k]] }
    ' 2>/dev/null
)

# split() on a literal string is not regex, so it works on device jq (no Oniguruma).
devices_json=$(printf '%s\n' "$devices_tsv" | jq -R -s '
    split("\n")
    | map(select(length > 0) | split("\t") | {mac: .[0], ip: .[1], hostname: .[2]})
' 2>/dev/null)
[ -n "$devices_json" ] || devices_json="[]"

jq -n --argjson devices "$devices_json" '{success: true, devices: $devices}'
exit 0
