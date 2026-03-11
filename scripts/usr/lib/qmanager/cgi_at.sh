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
    local gap="${CMD_GAP:-0.2}"
    local cgpaddr_resp cgpaddr_cids qmap_resp qmap_cid
    active_cid=""

    # Step 1: AT+CGPADDR — collect all CIDs that have a real IPv4 address
    cgpaddr_resp=$(run_at "AT+CGPADDR")
    sleep "$gap"

    cgpaddr_cids=""
    if [ -n "$cgpaddr_resp" ]; then
        cgpaddr_cids=$(printf '%s' "$cgpaddr_resp" | awk -F'[,"]' '
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
    fi

    # Step 2: AT+QMAP="WWAN" — get the WAN-connected CID (authoritative)
    qmap_cid=""
    qmap_resp=$(run_at 'AT+QMAP="WWAN"')
    if [ -n "$qmap_resp" ]; then
        # +QMAP: "WWAN",<connected>,<cid>,"<type>","<ip>"
        qmap_cid=$(printf '%s' "$qmap_resp" | awk -F',' '
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
    fi

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
