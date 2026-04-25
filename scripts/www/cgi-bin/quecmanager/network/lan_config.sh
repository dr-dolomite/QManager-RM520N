#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/cgi_at.sh

qlog_init "cgi_lan_config"
cgi_headers
cgi_handle_options

CONFIG_FILE="/etc/data/mobileap_cfg.xml"

xml_get() {
    key="$1"
    file="$2"
    [ -f "$file" ] || return 0
    sed -n "s/.*<$key>\\(.*\\)<\\/$key>.*/\\1/p" "$file" | head -1 | tr -d ' \r\n'
}

iface_addr() {
    iface="$1"
    ip -4 addr show "$iface" 2>/dev/null | awk '/inet /{print $2; exit}'
}

iface_state() {
    iface="$1"
    [ -e "/sys/class/net/$iface/operstate" ] && cat "/sys/class/net/$iface/operstate" || printf 'unknown'
}

valid_ip() {
    printf '%s' "$1" | awk -F. '
        NF != 4 { exit 1 }
        {
            for (i = 1; i <= 4; i++) {
                if ($i !~ /^[0-9]+$/ || $i < 0 || $i > 255) exit 1
            }
        }'
}

valid_netmask() {
    case "$1" in
        255.255.255.255|255.255.255.254|255.255.255.252|255.255.255.248|255.255.255.240|255.255.255.224|255.255.255.192|255.255.255.128|255.255.255.0|255.255.254.0|255.255.252.0|255.255.248.0|255.255.240.0|255.255.224.0|255.255.192.0|255.255.128.0|255.255.0.0|255.254.0.0|255.252.0.0|255.248.0.0|255.240.0.0|255.224.0.0|255.192.0.0|255.128.0.0|255.0.0.0) return 0 ;;
        *) return 1 ;;
    esac
}

ip_le() {
    awk -v a="$1" -v b="$2" 'BEGIN {
        split(a, aa, "."); split(b, bb, ".");
        ai = aa[1] * 16777216 + aa[2] * 65536 + aa[3] * 256 + aa[4];
        bi = bb[1] * 16777216 + bb[2] * 65536 + bb[3] * 256 + bb[4];
        exit !(ai <= bi)
    }'
}

xml_escape() {
    printf '%s' "$1" | sed 's/&/\\&amp;/g; s/</\\&lt;/g; s/>/\\&gt;/g'
}

write_config() {
    lan_ip="$1"
    subnet_mask="$2"
    dhcp_enabled="$3"
    dhcp_start="$4"
    dhcp_end="$5"
    lease_time="$6"

    tmp="${CONFIG_FILE}.tmp.$$"
    mode=$(stat -c '%a' "$CONFIG_FILE" 2>/dev/null || echo 755)
    owner=$(stat -c '%U' "$CONFIG_FILE" 2>/dev/null || echo radio)
    group=$(stat -c '%G' "$CONFIG_FILE" 2>/dev/null || echo radio)

    sed \
        -e "s|<APIPAddr>.*</APIPAddr>|<APIPAddr>$(xml_escape "$lan_ip")</APIPAddr>|" \
        -e "s|<SubNetMask>.*</SubNetMask>|<SubNetMask>$(xml_escape "$subnet_mask")</SubNetMask>|" \
        -e "s|<EnableDHCPServer>.*</EnableDHCPServer>|<EnableDHCPServer>$(xml_escape "$dhcp_enabled")</EnableDHCPServer>|" \
        -e "s|<StartIP>.*</StartIP>|<StartIP>$(xml_escape "$dhcp_start")</StartIP>|" \
        -e "s|<EndIP>.*</EndIP>|<EndIP>$(xml_escape "$dhcp_end")</EndIP>|" \
        -e "s|<LeaseTime>.*</LeaseTime>|<LeaseTime>$(xml_escape "$lease_time")</LeaseTime>|" \
        "$CONFIG_FILE" > "$tmp" || {
            rm -f "$tmp"
            return 1
        }

    chmod "$mode" "$tmp" 2>/dev/null || true
    chown "$owner:$group" "$tmp" 2>/dev/null || true

    mv "$tmp" "$CONFIG_FILE" || {
        rm -f "$tmp"
        return 1
    }
    sync
}

if [ "$REQUEST_METHOD" = "GET" ]; then
    if [ ! -f "$CONFIG_FILE" ]; then
        cgi_error "missing_config" "mobileap_cfg.xml not found"
        exit 0
    fi

    lanip_raw=$(qcmd 'AT+QMAP="LANIP"' 2>/dev/null | tr -d '\r')
    lanip_line=$(printf '%s\n' "$lanip_raw" | grep '+QMAP:.*"LANIP"' | head -1)
    at_start=$(printf '%s' "$lanip_line" | awk -F',' '{gsub(/"| /,"",$2); print $2}')
    at_end=$(printf '%s' "$lanip_line" | awk -F',' '{gsub(/"| /,"",$3); print $3}')
    at_gateway=$(printf '%s' "$lanip_line" | awk -F',' '{gsub(/"| /,"",$4); print $4}')

    jq -n \
        --arg config_file "$CONFIG_FILE" \
        --arg ap_ip "$(xml_get APIPAddr "$CONFIG_FILE")" \
        --arg assign_ap_ip "$(xml_get AssignAPIPAddr "$CONFIG_FILE")" \
        --arg subnet_mask "$(xml_get SubNetMask "$CONFIG_FILE")" \
        --arg dhcp_enabled "$(xml_get EnableDHCPServer "$CONFIG_FILE")" \
        --arg dhcp_start "$(xml_get StartIP "$CONFIG_FILE")" \
        --arg dhcp_end "$(xml_get EndIP "$CONFIG_FILE")" \
        --arg lease_time "$(xml_get LeaseTime "$CONFIG_FILE")" \
        --arg ippt_enabled "$(xml_get IPPassthroughEnable "$CONFIG_FILE")" \
        --arg ippt_device_type "$(xml_get IPPassthroughDeviceType "$CONFIG_FILE")" \
        --arg ippt_hostname "$(xml_get IPPassthroughHostName "$CONFIG_FILE")" \
        --arg ippt_mac "$(xml_get IPPassthroughMacAddr "$CONFIG_FILE")" \
        --arg ql_ippt_nat_pdn "$(xml_get QL_IPPassthroughFeatureWithNATPDN "$CONFIG_FILE")" \
        --arg at_start "$at_start" \
        --arg at_end "$at_end" \
        --arg at_gateway "$at_gateway" \
        --arg bridge0_addr "$(iface_addr bridge0)" \
        --arg eth0_addr "$(iface_addr eth0)" \
        --arg bridge0_state "$(iface_state bridge0)" \
        --arg eth0_state "$(iface_state eth0)" \
        --arg has_xmlstarlet "$(command -v xmlstarlet >/dev/null 2>&1 && echo true || echo false)" \
        '{
          success: true,
          mode: "read_write",
          config_file: $config_file,
          tools: { xmlstarlet_available: ($has_xmlstarlet == "true") },
          lan: {
            ip_address: $ap_ip,
            assign_ip_address: ($assign_ap_ip == "1"),
            subnet_mask: $subnet_mask,
            bridge0: { state: $bridge0_state, ipv4_cidr: $bridge0_addr },
            eth0: { state: $eth0_state, ipv4_cidr: $eth0_addr }
          },
          dhcp: {
            enabled: ($dhcp_enabled == "1"),
            start_ip: $dhcp_start,
            end_ip: $dhcp_end,
            lease_time_seconds: (try ($lease_time | tonumber) catch null)
          },
          ip_passthrough_xml: {
            enabled: ($ippt_enabled == "1"),
            device_type: $ippt_device_type,
            host_name: $ippt_hostname,
            mac_address: $ippt_mac,
            nat_pdn: $ql_ippt_nat_pdn
          },
          modem_lanip_at: {
            command: "AT+QMAP=\"LANIP\"",
            dhcp_start_ip: $at_start,
            dhcp_end_ip: $at_end,
            gateway_ip: $at_gateway
          },
          supported_future_writes: ["APIPAddr", "SubNetMask", "EnableDHCPServer", "StartIP", "EndIP", "LeaseTime"],
          apply_notes: [
            "Writes update /etc/data/mobileap_cfg.xml atomically",
            "The endpoint also attempts AT+QMAP=\"LANIP\",start,end,gateway after saving",
            "If the live AT apply is not accepted, reboot the modem to load XML changes"
          ]
        }'
    exit 0
fi

if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post
    action=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')

    if [ "$action" != "save" ]; then
        cgi_error "invalid_action" "action must be save"
        exit 0
    fi

    lan_ip=$(printf '%s' "$POST_DATA" | jq -r '.lan_ip // empty')
    subnet_mask=$(printf '%s' "$POST_DATA" | jq -r '.subnet_mask // empty')
    dhcp_enabled_raw=$(printf '%s' "$POST_DATA" | jq -r '.dhcp_enabled // empty')
    dhcp_start=$(printf '%s' "$POST_DATA" | jq -r '.dhcp_start // empty')
    dhcp_end=$(printf '%s' "$POST_DATA" | jq -r '.dhcp_end // empty')
    lease_time=$(printf '%s' "$POST_DATA" | jq -r '.lease_time_seconds // empty')

    if ! valid_ip "$lan_ip"; then
        cgi_error "invalid_lan_ip" "lan_ip must be a valid IPv4 address"
        exit 0
    fi
    if ! valid_netmask "$subnet_mask"; then
        cgi_error "invalid_subnet_mask" "subnet_mask must be a valid contiguous IPv4 netmask"
        exit 0
    fi
    if ! valid_ip "$dhcp_start"; then
        cgi_error "invalid_dhcp_start" "dhcp_start must be a valid IPv4 address"
        exit 0
    fi
    if ! valid_ip "$dhcp_end"; then
        cgi_error "invalid_dhcp_end" "dhcp_end must be a valid IPv4 address"
        exit 0
    fi
    if ! ip_le "$dhcp_start" "$dhcp_end"; then
        cgi_error "invalid_dhcp_range" "dhcp_start must be lower than or equal to dhcp_end"
        exit 0
    fi
    case "$dhcp_enabled_raw" in
        true|1) dhcp_enabled=1 ;;
        false|0) dhcp_enabled=0 ;;
        *)
            cgi_error "invalid_dhcp_enabled" "dhcp_enabled must be boolean"
            exit 0
            ;;
    esac
    case "$lease_time" in
        ''|*[!0-9]*)
            cgi_error "invalid_lease_time" "lease_time_seconds must be numeric"
            exit 0
            ;;
    esac
    if [ "$lease_time" -lt 60 ] || [ "$lease_time" -gt 604800 ]; then
        cgi_error "invalid_lease_time" "lease_time_seconds must be between 60 and 604800"
        exit 0
    fi

    helper_response=$(printf '%s' "$POST_DATA" | $_SUDO /usr/bin/qmanager_lan_config_mgr save 2>/dev/null)
    if [ -z "$helper_response" ]; then
        cgi_error "helper_failed" "Privileged LAN config helper failed"
        exit 0
    fi

    printf '%s\n' "$helper_response"
    exit 0
fi

cgi_method_not_allowed
