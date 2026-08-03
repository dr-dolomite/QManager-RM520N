#!/bin/sh
# AT command helper library — shared utilities for CGI scripts and daemons.
# Source after qlog.sh or cgi_base.sh so qlog functions are already available.

[ -n "$_CGI_AT_LOADED" ] && return 0
_CGI_AT_LOADED=1

# Ensure qlog_warn is a no-op if sourced before logging is initialised.
command -v qlog_warn >/dev/null 2>&1 || qlog_warn() { :; }

# ---------------------------------------------------------------------------
# strip_at_response <raw>
# Remove the command echo, trailing OK, and ERROR lines from a raw qcmd
# response, then print the payload on stdout.
# ---------------------------------------------------------------------------
strip_at_response() {
    printf '%s' "$1" | tr -d '\r' | sed -e '1d' -e '/^OK$/d' -e '/^ERROR$/d'
}

# ---------------------------------------------------------------------------
# run_at <at_command>
# Execute an AT command via qcmd and print the stripped response.
# Returns 0 on success, 1 on failure (no output written on failure).
#
# Usage:
#   result=$(run_at "AT+CGDCONT?") || { handle_error; }
# ---------------------------------------------------------------------------
run_at() {
    local raw
    raw=$(qcmd "$1" 2>/dev/null)
    local rc=$?
    if [ $rc -ne 0 ] || [ -z "$raw" ]; then
        qlog_warn "AT command failed: $1 (rc=$rc)"
        return 1
    fi
    case "$raw" in
        *ERROR*)
            qlog_warn "AT command returned ERROR: $1"
            return 1
            ;;
    esac
    strip_at_response "$raw"
}

# ---------------------------------------------------------------------------
# detect_active_cid
# Determine which CID is carrying WAN data by cross-referencing
# AT+CGPADDR (IPs assigned per CID) with AT+QMAP="WWAN" (authoritative WAN CID).
#
# Sets global: active_cid="<number>"  (defaults to "1" if both methods fail)
# Respects:    CMD_GAP (inter-command sleep, defaults to 0.2s if unset)
#
# Usage:
#   detect_active_cid
#   echo "Active CID: $active_cid"
# ---------------------------------------------------------------------------
detect_active_cid() {
    local cgpaddr_cids qmap_cid raw
    active_cid=""

    # Compound AT: fetch both CID sources in one call
    raw=$(qcmd 'AT+CGPADDR;+QMAP="WWAN"' 2>/dev/null)

    # Step 1: +CGPADDR lines — collect CIDs with real IPv4 addresses
    cgpaddr_cids=""
    cgpaddr_cids=$(printf '%s\n' "$raw" | awk -F'[,"]' '
        /\+CGPADDR:/ {
            cid = $1; gsub(/[^0-9]/, "", cid)
            ip = $3
            if (ip != "" && ip != "0.0.0.0" && ip !~ /^0+(\.0+)*$/) {
                split(ip, octets, ".")
                if (length(octets) == 4 && octets[1]+0 > 0) {
                    print cid
                }
            }
        }
    ')

    # Step 2: +QMAP line — WAN-connected CID (authoritative)
    qmap_cid=$(printf '%s\n' "$raw" | awk -F',' '
        /\+QMAP:/ {
            gsub(/"/, "", $5)
            ip = $5
            cid = $3
            gsub(/[^0-9]/, "", cid)
            if (ip != "" && ip != "0.0.0.0" && ip != "0:0:0:0:0:0:0:0") {
                print cid
                exit
            }
        }
    ')

    # Step 3: QMAP is authoritative; CGPADDR is fallback
    if [ -n "$qmap_cid" ]; then
        active_cid="$qmap_cid"
        qlog_debug "Active CID from QMAP: $qmap_cid (CGPADDR CIDs: $cgpaddr_cids)"
    elif [ -n "$cgpaddr_cids" ]; then
        active_cid=$(printf '%s\n' "$cgpaddr_cids" | head -1)
        qlog_debug "Active CID from CGPADDR fallback: $active_cid"
    fi

    # Default to CID 1 if both detection methods failed
    [ -z "$active_cid" ] && active_cid="1"
}

# ---------------------------------------------------------------------------
# parse_cgdcont <raw_response>
# Parse AT+CGDCONT? response into a JSON array [{cid, pdp_type, apn}].
# Outputs JSON array to stdout. Outputs "[]" if input is empty or unmatched.
#
# Usage:
#   profiles_json=$(parse_cgdcont "$cgdcont_resp")
# ---------------------------------------------------------------------------
parse_cgdcont() {
    local raw="$1"
    if [ -z "$raw" ]; then
        echo "[]"
        return
    fi
    printf '%s' "$raw" | awk -F'"' '
        /\+CGDCONT:/ {
            split($0, a, /[,]/)
            gsub(/[^0-9]/, "", a[1])
            cid = a[1]
            pdp = $2
            apn = $4
            if (cid != "") {
                printf "%s\t%s\t%s\n", cid, pdp, apn
            }
        }
    ' | jq -Rsc '
        split("\n") | map(select(length > 0) | split("\t") |
            {cid: (.[0] | tonumber), pdp_type: .[1], apn: .[2]}
        )
    '
}

# ---------------------------------------------------------------------------
# parse_cgcontrdp <stripped_cgcontrdp_response>
#   -> "<v4addr>\t<v4gw>\t<dns1>\t<dns2>\t<v6addr>"
# RM520N-GL format (no MTU / interface fields present):
#   +CGCONTRDP: <cid>,<bearer>,"<apn>","<addr>",<gw>,"<dns1>","<dns2>"
# Promoted here from apn.sh (same field layout / same awk -F'"' split) so
# apn.sh's existing `cut -f1..5` consumers are unaffected. The 5-field arity
# and field ORDER are contract — callers slice them positionally with
# `cut -f1..5`. Do not widen or reorder without updating every consumer.
#
# IPv4-vs-IPv6 is decided by OCTET COUNT, not by punctuation. 3GPP returns an
# IPv6 address as 16 dotted-decimal octets, NOT colon-hex — verified live on
# this firmware, which emits the dotted form in +CGCONTRDP, +CGPADDR and
# +CGDCONT? alike (colon-hex shows up only in +QMAP). A `addr ~ /:/` test
# therefore never matches an IPv6 +CGCONTRDP address, and since the address is
# per-CID and a dual-stack context emits the IPv6 record SECOND, the old test
# sent it down the IPv4 branch where it overwrote v4/gw/dns1/dns2 wholesale and
# left v6 permanently empty. Counting octets is the only reliable split:
#   4 octets  -> IPv4        16 octets -> IPv6        contains ':' -> IPv6
# First record of each family wins, so a later record can no longer clobber an
# earlier one. Colon-hex is kept as a fallback for firmwares that do emit it.
#
# Input is normalised with `tr '\r' '\n'` first: some firmwares glue successive
# records with a bare CR instead of CRLF, which would otherwise leave two
# records on one awk line and hide the second entirely (parse_at.sh's sibling
# parser has carried this same normalisation since it was written).
#
# Usage:
#   fields=$(parse_cgcontrdp "$rdp_resp"); v4addr=$(printf '%s' "$fields" | cut -f1)
# ---------------------------------------------------------------------------
parse_cgcontrdp() {
    printf '%s\n' "$1" | tr '\r' '\n' | awk -F'"' '
        /\+CGCONTRDP:/ {
            addr = $4; sub(/ .*/, "", addr)

            # Field positions are NOT fixed: the gateway may be quoted or bare,
            # and that shifts everything after it by two -F(") fields. Observed
            # live on this firmware, same CID minutes apart:
            #   IPv4 ctx: ...,"apn","addr",,"dns1","dns2"        <- bare gw
            #   IPv6 ctx: ...,"apn","addr","gw","dns1","dns2"    <- quoted gw
            # Reading a fixed $6/$8 therefore returned the GATEWAY as dns1 and
            # dropped dns2 entirely on any context with a quoted gateway.
            # Count the quoted tokens instead (they sit on even fields, so
            # int(NF/2)): 5 tokens means apn/addr/gw/dns1/dns2, 4 means the
            # gateway was bare and lives in the separator run at $5.
            nq = int(NF / 2)
            if (nq >= 5) { gw = $6; d1 = $8; d2 = $10 }
            else         { gw = $5; d1 = $6; d2 = $8 }
            gsub(/[^0-9.:]/, "", gw)

            n = split(addr, _oct, "[.]")
            if ((addr ~ /:/) || n == 16) {
                if (v6 == "") v6 = addr
            } else if (n == 4) {
                # Gateway is address-family-specific (the consumer emits it as
                # ipv4_gateway), so it is only ever taken from an IPv4 record.
                if (v4 == "") { v4 = addr; v4gw = gw }
            }
            # DNS is NOT family-specific in the consumer contract — apn.sh
            # emits plain dns1/dns2, not ipv4_dns1 — so take them from
            # whichever record supplies them. Without this, an IPv6-only
            # context (which this SIM does hand out) would report no DNS at
            # all. First non-empty wins, so a dual-stack context still
            # prefers the IPv4 record that arrives first.
            if (d1 != "" && dns1 == "") dns1 = d1
            if (d2 != "" && dns2 == "") dns2 = d2
        }
        END { printf "%s\t%s\t%s\t%s\t%s\n", v4, v4gw, dns1, dns2, v6 }'
}

# ---------------------------------------------------------------------------
# parse_cgcontrdp_apn <stripped_cgcontrdp_response> -> "<apn>" (empty if none)
# Sibling of parse_cgcontrdp, kept separate rather than widening its 5-tuple:
# same "+CGCONTRDP: <cid>,<bearer>,"<apn>","<addr>",<gw>,"<dns1>","<dns2>""
# field layout (split on '"'), field 2 = apn. Used by apn_apply.sh to verify
# what the network actually negotiated (AT+CGDCONT? only echoes back what
# was asked for, never what was granted).
#
# Usage:
#   negotiated=$(parse_cgcontrdp_apn "$rdp_resp")
# ---------------------------------------------------------------------------
parse_cgcontrdp_apn() {
    printf '%s\n' "$1" | awk -F'"' '/\+CGCONTRDP:/ {print $2; exit}'
}

# ---------------------------------------------------------------------------
# validate_imei <imei>
# Validate that <imei> is exactly 15 decimal digits.
# Returns 0 if valid, 1 if invalid (including empty input).
#
# Usage:
#   validate_imei "$NEW_IMEI" || { echo "Invalid IMEI"; exit 1; }
# ---------------------------------------------------------------------------
validate_imei() {
    case "$1" in
        [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) return 0 ;;
        *) return 1 ;;
    esac
}

# ---------------------------------------------------------------------------
# wait_modem_ready <seconds>
# Block for <seconds> to allow the modem AT interface to come up after boot.
# Used by one-shot boot daemons that must wait before issuing AT commands.
#
# Usage:
#   wait_modem_ready "$SETTLE_TIME"
# ---------------------------------------------------------------------------
wait_modem_ready() {
    local secs="${1:-10}"
    local i=0
    while [ "$i" -lt "$secs" ]; do
        sleep 1
        i=$((i + 1))
    done
}
