#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# sms.sh — SMS Center CGI (RM520N-GL): conversations, sent log, SMSC, storage-aware delete.
# SMS goes through `qsms` (QMI WMS, no AT lock); the SMSC and the CPMS heal go through `qcmd`.
#
# GET                 {success, messages[], threads[], storage:{used,total,me,sm}, smsc:{addr,status,time}|null,
#                      unread_total:0, storage_errors?}
# GET ?addr=<a>       {success, addr, count, messages[] (oldest-first), has_more:false}
# GET ?action=smsc    {success, smsc} | modem_busy | smsc_read_failed
#
# POST body: { "action": ..., ... }
#   send       { phone, message }                    also logged as sent (or failed)
#   delete     { indexes:[...], storage:"ME"|"SM" }
#   delete     { storage:"SENT", identities:["S<seq>:<time>", ...] }
#   delete     { addr, index:"ALL" }                 every modem message from addr + the sent records to addr
#   delete_all {}                                    ME + SM + the sent log
#   set_smsc   { addr }                              AT+CSCA write, read back

qlog_init "cgi_sms"
cgi_headers
cgi_handle_options

QSMS="/usr/bin/qsms"
QCMD="/usr/bin/qcmd"
PREF_FILE="/etc/qmanager/sms_storage"

if [ -f /usr/lib/qmanager/sms_sent.sh ]; then
    . /usr/lib/qmanager/sms_sent.sh
else
    sms_sent_read() { printf '[]\n'; }
    sms_sent_append() { return 1; }
    sms_sent_delete_identities() { return 1; }
    sms_sent_delete_addr() { return 1; }
    sms_sent_clear() { return 0; }
fi

# Saved incoming-storage choice: "SM" only when the file says so, else "ME".
sms_pref() {
    _sp=$({ tr -d ' \r\n' < "$PREF_FILE" | tr 'a-z' 'A-Z'; } 2>/dev/null)
    [ "$_sp" = "SM" ] && printf 'SM' || printf 'ME'
}

# CPMS mem3 is the modem's WMS route for new messages: re-assert the saved choice (default ME).
heal_routing() {
    _hr=$(sms_pref)
    "$QCMD" "AT+CPMS=\"$_hr\",\"$_hr\",\"$_hr\"" >/dev/null 2>&1
}

# Plain-language text from a qsms failure envelope: .detail, else a fixed sentence per code.
qsms_detail() {
    local d
    d=$(printf '%s' "$1" | jq -r '
        .detail // (
            if .error == "bad_number" then "That phone number is not valid."
            elif .error == "message_too_long" then "The message is too long to send."
            else "The modem did not answer." end
        )' 2>/dev/null)
    # Empty or non-JSON output (qsms missing or crashed) leaves jq silent.
    printf '%s' "${d:-The modem did not answer.}"
}

_sms_busy_reply() {
    jq -n '{"success":false,"error":"modem_busy","detail":"Could not acquire AT lock"}'
}

# --- Query string ------------------------------------------------------------
# _sms_qs <name> — raw (still encoded) value of a query parameter, "" if absent.
_sms_qs() {
    _qs="&$QUERY_STRING"
    case "$_qs" in
        *"&$1="*)
            _qv="${_qs#*&"$1"=}"
            printf '%s' "${_qv%%&*}"
            ;;
    esac
}

# _sms_urldecode <s> — form-urlencoded decode ("+" is a space, %XX a byte; %00 dropped,
# a malformed escape stays literal). BusyBox awk's %c emits the raw byte, so UTF-8 survives.
_sms_urldecode() {
    _SMS_UD="$1" awk 'BEGIN {
        s = ENVIRON["_SMS_UD"]; hex = "0123456789abcdef"; n = length(s)
        for (i = 1; i <= n; i++) {
            c = substr(s, i, 1)
            if (c == "+") { printf " "; continue }
            if (c == "%" && i + 2 <= n) {
                a = index(hex, tolower(substr(s, i + 1, 1)))
                b = index(hex, tolower(substr(s, i + 2, 1)))
                if (a && b) {
                    v = (a - 1) * 16 + (b - 1)
                    if (v > 0) printf "%c", v
                    i += 2
                    continue
                }
            }
            printf "%s", c
        }
    }'
}

# Device UTC offset in seconds east of UTC (qsms timestamps are device-local, no zone).
_sms_utc_offset() {
    _off=$(date +%z 2>/dev/null | awk '{
        s = substr($0, 1, 1); h = substr($0, 2, 2) + 0; m = substr($0, 4, 2) + 0
        o = h * 3600 + m * 60; if (s == "-") o = -o; print o }')
    case "$_off" in
        ''|-|*[!0-9-]*) _off=0 ;;
    esac
    printf '%s' "$_off"
}

# --- SMSC ----------------------------------------------------------------------
# _sms_smsc_read — sets SMSC_ADDR. rc 0 ok, 1 read failed, 2 modem busy.
_sms_smsc_read() {
    SMSC_ADDR=""
    _sc_out=$("$QCMD" 'AT+CSCA?' 2>&1)
    _sc_rc=$?
    if [ "$_sc_rc" -ne 0 ]; then
        case "$_sc_out" in
            *modem_busy*|*scan_in_progress*) return 2 ;;
        esac
        return 1
    fi
    _sc_line=$(printf '%s\n' "$_sc_out" | tr -d '\r' | grep '^+CSCA:' | head -n1)
    [ -n "$_sc_line" ] || return 1
    SMSC_ADDR=$(printf '%s' "$_sc_line" | sed -n 's/^+CSCA: *"\([^"]*\)".*/\1/p')
    [ -n "$SMSC_ADDR" ] || return 1
    return 0
}

_sms_smsc_json() {
    jq -cn --arg addr "$1" '{addr: $addr, status: "", time: ""}'
}

# --- Message model -------------------------------------------------------------
# jq program over a slurped stream: .[0] raw qsms messages, .[1] the sent log, .[2] the
# smsc object or null. Defines $all (merged, newest-first); $off = device UTC offset.
# Multi-part groups key on storage+sender+reference+total; a reused reference starts a new
# message when parts are >24 h apart or a part repeats with other text.
SMS_JQ_MODEL='
def tsort: .[6:8] + .[0:2] + .[3:5] + .[8:];
def pep: try (strptime("%m/%d/%y %H:%M:%S") | mktime) catch 0;
def epoch: (try (("20" + .[6:8] + "-" + .[0:2] + "-" + .[3:5] + "T" + .[9:17] + "Z")
             | fromdateiso8601) catch null) as $e | if $e == null then 0 else $e - $off end;
def clusters: reduce .[] as $m ([];
    if length > 0 and ($m.ep - .[-1][-1].ep) <= 86400
       and ([.[-1][] | select(.part == $m.part and .content != $m.content)] | length) == 0
    then .[-1] += [$m] else . + [[$m]] end);
def kind:
  (explode) as $c
  | if any($c[]; (. >= 65 and . <= 90) or (. >= 97 and . <= 122) or . >= 128)
    then "alphanumeric"
    else (ltrimstr("+") | explode) as $d
      | if ($d | length) > 0 and ($d | length) <= 6 and all($d[]; . >= 48 and . <= 57)
        then "shortcode" else "msisdn" end
    end;
def who: ((.addr // "") | kind) as $k
  | . + {display_name: .addr, addr_kind: $k,
         display_source: (if $k == "alphanumeric" then "network" else "raw" end)};

(.[0]) as $raw | (.[1]) as $sent |
(
  ([$raw[] | select(has("reference") | not) |
     {indexes: [.index], sender, content, timestamp, storage}]
  ) +
  ([$raw[] | select(has("reference")) | . + {ep: (.timestamp | pep)}] |
     group_by(.storage + "|" + .sender + "|" + (.reference | tostring) + "|" + ((.total // 0) | tostring)) |
     [.[] | sort_by(.ep) | clusters[]
      | sort_by(.part) | {
         indexes: [.[].index],
         sender: .[0].sender,
         content: ([unique_by(.part)[].content] | join("")),
         timestamp: .[0].timestamp,
         storage: .[0].storage
     }])
  | map((.timestamp | epoch) as $t
        | . + {addr: (.sender // ""), index: .indexes[0], time: $t,
               direction: "inbound", type: 1, status: "success", result: 1,
               identity: (.storage + (.indexes[0] | tostring) + ":" + ($t | tostring))}
        | who)
) as $inbound |
($sent | map(select(.addr != null and .seq != null) |
    ((.time // 0) | tonumber? // 0) as $t
    | (if .status == "failed" then "failed" else "success" end) as $st
    | {indexes: [], index: null, sender: .addr, addr: .addr,
       content: (.content // ""), storage: "SENT",
       timestamp: (($t + $off) | strftime("%m/%d/%y %H:%M:%S")),
       time: $t, seq: .seq,
       direction: "outbound", type: 0, status: $st,
       result: (if $st == "success" then 1 else 0 end),
       identity: ("S" + (.seq | tostring) + ":" + ($t | tostring))}
    | who)
) as $outbound |
(($inbound + $outbound) | sort_by(.time, (.timestamp | tsort)) | reverse) as $all
'

# _sms_model_input <smsc_json|null> — the model input stream for jq -s; raw qsms messages are in $raw_msgs.
_sms_model_input() {
    printf '%s\n' "$raw_msgs"
    sms_sent_read
    printf '%s\n' "$1"
}

# _sms_read_raw — fill raw_msgs / list_errs from `qsms list all`. On failure prints the error reply, rc 1.
_sms_read_raw() {
    list_json=$("$QSMS" list all 2>/dev/null)
    if [ "$(printf '%s' "$list_json" | jq -r '.success' 2>/dev/null)" != "true" ]; then
        detail=$(qsms_detail "$list_json")
        qlog_error "SMS list failed: $detail"
        jq -n --arg detail "$detail" '{"success":false,"error":"sms_unavailable","detail":$detail}'
        return 1
    fi
    list_errs=$(printf '%s' "$list_json" | jq -c 'if (.storage_errors | type) == "object" then .storage_errors else {} end' 2>/dev/null)
    [ -n "$list_errs" ] || list_errs="{}"
    [ "$list_errs" = "{}" ] || qlog_warn "SMS list storage errors: $list_errs"
    raw_msgs=$(printf '%s' "$list_json" | jq -c 'if (.msg | type) == "array" then .msg else [] end' 2>/dev/null)
    [ -n "$raw_msgs" ] || raw_msgs="[]"
    return 0
}

# _sms_reply <json> — print a built reply, or an error envelope if the model produced nothing.
_sms_reply() {
    if [ -n "$1" ]; then
        printf '%s\n' "$1"
    else
        qlog_error "SMS model build failed"
        cgi_error "command_failed" "Could not build the message list"
    fi
}

# _sms_delete_slots <ME|SM> <i,j,..> <count> — one qsms delete; sets DEL_FAILED to the slots not deleted.
_sms_delete_slots() {
    _dr=$("$QSMS" delete "$1" "$2" 2>/dev/null)
    _dn=$(printf '%s' "$_dr" | jq -r 'if (.deleted | type) == "array" then (.deleted | length) else 0 end' 2>/dev/null)
    case "$_dn" in ''|*[!0-9]*) _dn=0 ;; esac
    DEL_FAILED=$(($3 - _dn))
    [ "$DEL_FAILED" -lt 0 ] && DEL_FAILED=0
    return 0
}

# --- MCC to country calling code lookup --------------------------------------
# Maps the SIM's MCC (first 3 digits of IMSI) to ITU-T calling code.
# Used to normalize local numbers (leading 0) to international format.
mcc_to_calling_code() {
    case "$1" in
        # North America (NANP)
        302) echo "1" ;;                                  # Canada
        310|311|312|313|314|315|316) echo "1" ;;          # USA
        330|332|338|342|344|346|348|350|352) echo "1" ;;  # Caribbean NANP
        354|356|358|360|362|364|365|366) echo "1" ;;      # Caribbean NANP
        370|374|376) echo "1" ;;                          # Dominican Rep/Trinidad/Turks
        # Central & South America
        334) echo "52" ;;   # Mexico
        368) echo "53" ;;   # Cuba
        702) echo "501" ;;  # Belize
        704) echo "502" ;;  # Guatemala
        706) echo "503" ;;  # El Salvador
        708) echo "504" ;;  # Honduras
        710) echo "505" ;;  # Nicaragua
        712) echo "506" ;;  # Costa Rica
        714) echo "507" ;;  # Panama
        716) echo "51" ;;   # Peru
        722) echo "54" ;;   # Argentina
        724) echo "55" ;;   # Brazil
        730) echo "56" ;;   # Chile
        732) echo "57" ;;   # Colombia
        734) echo "58" ;;   # Venezuela
        736) echo "591" ;;  # Bolivia
        738) echo "592" ;;  # Guyana
        740) echo "593" ;;  # Ecuador
        744) echo "595" ;;  # Paraguay
        746) echo "597" ;;  # Suriname
        748) echo "598" ;;  # Uruguay
        372) echo "509" ;;  # Haiti
        340) echo "590" ;;  # French Antilles
        363) echo "297" ;;  # Aruba
        # Europe
        202) echo "30" ;;   # Greece
        204) echo "31" ;;   # Netherlands
        206) echo "32" ;;   # Belgium
        208) echo "33" ;;   # France
        212) echo "377" ;;  # Monaco
        213) echo "376" ;;  # Andorra
        214) echo "34" ;;   # Spain
        216) echo "36" ;;   # Hungary
        218) echo "387" ;;  # Bosnia
        219) echo "385" ;;  # Croatia
        220) echo "381" ;;  # Serbia
        222|225) echo "39" ;; # Italy/Vatican
        226) echo "40" ;;   # Romania
        228) echo "41" ;;   # Switzerland
        230) echo "420" ;;  # Czech Republic
        231) echo "421" ;;  # Slovakia
        232) echo "43" ;;   # Austria
        234|235) echo "44" ;; # United Kingdom
        238) echo "45" ;;   # Denmark
        240) echo "46" ;;   # Sweden
        242) echo "47" ;;   # Norway
        244) echo "358" ;;  # Finland
        246) echo "370" ;;  # Lithuania
        247) echo "371" ;;  # Latvia
        248) echo "372" ;;  # Estonia
        250) echo "7" ;;    # Russia
        255) echo "380" ;;  # Ukraine
        257) echo "375" ;;  # Belarus
        259) echo "373" ;;  # Moldova
        260) echo "48" ;;   # Poland
        262) echo "49" ;;   # Germany
        266) echo "350" ;;  # Gibraltar
        268) echo "351" ;;  # Portugal
        270) echo "352" ;;  # Luxembourg
        272) echo "353" ;;  # Ireland
        274) echo "354" ;;  # Iceland
        276) echo "355" ;;  # Albania
        278) echo "356" ;;  # Malta
        280) echo "357" ;;  # Cyprus
        282) echo "995" ;;  # Georgia
        283) echo "374" ;;  # Armenia
        284) echo "359" ;;  # Bulgaria
        286) echo "90" ;;   # Turkey
        288) echo "298" ;;  # Faroe Islands
        290) echo "299" ;;  # Greenland
        292) echo "378" ;;  # San Marino
        293) echo "386" ;;  # Slovenia
        294) echo "389" ;;  # North Macedonia
        295) echo "423" ;;  # Liechtenstein
        297) echo "382" ;;  # Montenegro
        # Middle East & Central Asia
        400) echo "994" ;;  # Azerbaijan
        401) echo "7" ;;    # Kazakhstan
        402) echo "975" ;;  # Bhutan
        404|405|406) echo "91" ;; # India
        410) echo "92" ;;   # Pakistan
        412) echo "93" ;;   # Afghanistan
        413) echo "94" ;;   # Sri Lanka
        414) echo "95" ;;   # Myanmar
        415) echo "961" ;;  # Lebanon
        416) echo "962" ;;  # Jordan
        417) echo "963" ;;  # Syria
        418) echo "964" ;;  # Iraq
        419) echo "965" ;;  # Kuwait
        420) echo "966" ;;  # Saudi Arabia
        421) echo "967" ;;  # Yemen
        422) echo "968" ;;  # Oman
        424|430|431) echo "971" ;; # UAE
        425) echo "972" ;;  # Israel
        426) echo "973" ;;  # Bahrain
        427) echo "974" ;;  # Qatar
        428) echo "976" ;;  # Mongolia
        429) echo "977" ;;  # Nepal
        432) echo "98" ;;   # Iran
        434) echo "998" ;;  # Uzbekistan
        436) echo "992" ;;  # Tajikistan
        437) echo "996" ;;  # Kyrgyzstan
        438) echo "993" ;;  # Turkmenistan
        # East & Southeast Asia
        440|441) echo "81" ;; # Japan
        450) echo "82" ;;   # South Korea
        452) echo "84" ;;   # Vietnam
        454) echo "852" ;;  # Hong Kong
        455) echo "853" ;;  # Macau
        456) echo "855" ;;  # Cambodia
        457) echo "856" ;;  # Laos
        460|461) echo "86" ;; # China
        466) echo "886" ;;  # Taiwan
        467) echo "850" ;;  # North Korea
        470) echo "880" ;;  # Bangladesh
        472) echo "960" ;;  # Maldives
        502) echo "60" ;;   # Malaysia
        505) echo "61" ;;   # Australia
        510) echo "62" ;;   # Indonesia
        514) echo "670" ;;  # East Timor
        515) echo "63" ;;   # Philippines
        520) echo "66" ;;   # Thailand
        525) echo "65" ;;   # Singapore
        528) echo "673" ;;  # Brunei
        530) echo "64" ;;   # New Zealand
        536) echo "674" ;;  # Nauru
        537) echo "675" ;;  # Papua New Guinea
        539) echo "676" ;;  # Tonga
        540) echo "677" ;;  # Solomon Islands
        541) echo "678" ;;  # Vanuatu
        542) echo "679" ;;  # Fiji
        545) echo "686" ;;  # Kiribati
        546) echo "687" ;;  # New Caledonia
        547) echo "689" ;;  # French Polynesia
        548) echo "682" ;;  # Cook Islands
        549) echo "685" ;;  # Samoa
        550) echo "691" ;;  # Micronesia
        551) echo "692" ;;  # Marshall Islands
        552) echo "680" ;;  # Palau
        # Africa
        602) echo "20" ;;   # Egypt
        603) echo "213" ;;  # Algeria
        604) echo "212" ;;  # Morocco
        605) echo "216" ;;  # Tunisia
        606) echo "218" ;;  # Libya
        607) echo "220" ;;  # Gambia
        608) echo "221" ;;  # Senegal
        609) echo "222" ;;  # Mauritania
        610) echo "223" ;;  # Mali
        611) echo "224" ;;  # Guinea
        612) echo "225" ;;  # Ivory Coast
        613) echo "226" ;;  # Burkina Faso
        614) echo "227" ;;  # Niger
        615) echo "228" ;;  # Togo
        616) echo "229" ;;  # Benin
        617) echo "230" ;;  # Mauritius
        618) echo "231" ;;  # Liberia
        619) echo "232" ;;  # Sierra Leone
        620) echo "233" ;;  # Ghana
        621) echo "234" ;;  # Nigeria
        622) echo "235" ;;  # Chad
        623) echo "236" ;;  # Central African Republic
        624) echo "237" ;;  # Cameroon
        625) echo "238" ;;  # Cape Verde
        626) echo "239" ;;  # Sao Tome
        627) echo "240" ;;  # Equatorial Guinea
        628) echo "241" ;;  # Gabon
        629) echo "242" ;;  # Congo
        630) echo "243" ;;  # DR Congo
        631) echo "244" ;;  # Angola
        632) echo "245" ;;  # Guinea-Bissau
        633) echo "248" ;;  # Seychelles
        634) echo "249" ;;  # Sudan
        635) echo "250" ;;  # Rwanda
        636) echo "251" ;;  # Ethiopia
        637) echo "252" ;;  # Somalia
        638) echo "253" ;;  # Djibouti
        639) echo "254" ;;  # Kenya
        640) echo "255" ;;  # Tanzania
        641) echo "256" ;;  # Uganda
        642) echo "257" ;;  # Burundi
        643) echo "258" ;;  # Mozambique
        645) echo "260" ;;  # Zambia
        646) echo "261" ;;  # Madagascar
        647) echo "262" ;;  # Reunion
        648) echo "263" ;;  # Zimbabwe
        649) echo "264" ;;  # Namibia
        650) echo "265" ;;  # Malawi
        651) echo "266" ;;  # Lesotho
        652) echo "267" ;;  # Botswana
        653) echo "268" ;;  # Eswatini
        654) echo "269" ;;  # Comoros
        655) echo "27" ;;   # South Africa
        657) echo "291" ;;  # Eritrea
        659) echo "211" ;;  # South Sudan
        *) echo "" ;;       # Unknown MCC
    esac
}

# --- Normalize phone number --------------------------------------------------
# 1. Strip leading "+" (qsms reads 6+ digits as international)
# 2. If starts with "0" (local format), detect country from SIM's MCC
#    and replace leading 0 with the country calling code
normalize_phone() {
    _phone="$1"

    # Strip + prefix and the spaces, dashes, dots and brackets people type
    _phone=$(printf '%s' "$_phone" | tr -d ' ().-' | sed 's/^+//')

    # If starts with 0, replace with country calling code from SIM's MCC
    case "$_phone" in
        0*)
            _imsi=$(qcmd 'AT+CIMI' 2>/dev/null | grep -o '[0-9]\{15\}')
            if [ -n "$_imsi" ]; then
                _mcc=$(printf '%s' "$_imsi" | cut -c1-3)
                _cc=$(mcc_to_calling_code "$_mcc")
                if [ -n "$_cc" ]; then
                    _phone="${_cc}${_phone#0}"
                    qlog_info "Normalized local number: 0... -> ${_cc}... (MCC=$_mcc)"
                else
                    qlog_warn "Unknown MCC=$_mcc, sending number as-is"
                fi
            else
                qlog_warn "Could not read IMSI, sending number as-is"
            fi
            ;;
    esac

    printf '%s' "$_phone"
}


# =============================================================================
# GET
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    REQ_ACTION=$(_sms_qs action)

    # --- ?action=smsc ----------------------------------------------------------
    if [ "$REQ_ACTION" = "smsc" ]; then
        _sms_smsc_read
        case $? in
            0) jq -n --argjson smsc "$(_sms_smsc_json "$SMSC_ADDR")" '{success: true, smsc: $smsc}' ;;
            2) _sms_busy_reply ;;
            *) cgi_error "smsc_read_failed" "Could not read the SMS centre number" ;;
        esac
        exit 0
    fi

    off=$(_sms_utc_offset)

    # --- ?addr=<addr> — one thread, oldest-first --------------------------------
    case "&$QUERY_STRING" in
        *"&addr="*)
            ADDR=$(_sms_urldecode "$(_sms_qs addr)")
            if [ -z "$ADDR" ]; then
                cgi_error "missing_addr" "addr is required"
                exit 0
            fi
            _sms_read_raw || exit 0
            reply=$(_sms_model_input null | jq -s --argjson off "$off" --arg addr "$ADDR" \
                "$SMS_JQ_MODEL"'
                | [$all[] | select(.addr == $addr or .addr == ($addr | ltrimstr("+")))] | reverse
                | {success: true, addr: $addr, count: length, messages: ., has_more: false}' 2>/dev/null)
            _sms_reply "$reply"
            exit 0
            ;;
    esac

    # --- Inbox -------------------------------------------------------------------
    qlog_info "Fetching SMS inbox and status (ME + SM + sent)"
    heal_routing
    _sms_read_raw || exit 0

    # A storage that fails to answer counts as 0/0.
    status_json=$("$QSMS" status all 2>/dev/null)
    printf '%s' "$status_json" | jq empty 2>/dev/null || status_json='{}'

    # SMSC is decoration: a busy or failed read is smsc:null, never an error.
    smsc_json=null
    if _sms_smsc_read; then
        smsc_json=$(_sms_smsc_json "$SMSC_ADDR")
    fi

    reply=$(_sms_model_input "$smsc_json" | jq -s --argjson off "$off" \
        --argjson st "$status_json" --argjson errs "$list_errs" \
        "$SMS_JQ_MODEL"'
        | (.[2]) as $smsc
        | ($st.storages // []) as $s
        | (($s | map(select(.storage == "ME")) | .[0]) // {used: 0, total: 0}) as $me
        | (($s | map(select(.storage == "SM")) | .[0]) // {used: 0, total: 0}) as $sm
        | {
            success: true,
            messages: $all,
            threads: ($all | group_by(.addr) | map(max_by(.time) as $l | {
                addr: $l.addr, sender: $l.addr,
                display_name: $l.display_name, display_source: $l.display_source,
                addr_kind: $l.addr_kind,
                latestMessage: $l.content, content: $l.content,
                timestamp: $l.timestamp, timestampSec: $l.time,
                unreadCount: 0, latestIndex: ($l.index // 0),
                direction: $l.direction, type: $l.type, status: $l.status
              }) | sort_by(.timestampSec) | reverse),
            storage: {
                used: ($me.used + $sm.used),
                total: ($me.total + $sm.total),
                me: {used: $me.used, total: $me.total},
                sm: {used: $sm.used, total: $sm.total}
            },
            smsc: $smsc,
            unread_total: 0
          }
        + (if ($errs | length) > 0 then {storage_errors: $errs} else {} end)' 2>/dev/null)
    _sms_reply "$reply"
    exit 0
fi

# =============================================================================
# POST
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')

    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # --- action: send --------------------------------------------------------
    if [ "$ACTION" = "send" ]; then
        RAW_PHONE=$(printf '%s' "$POST_DATA" | jq -r '.phone // empty')
        MESSAGE=$(printf '%s' "$POST_DATA" | jq -r '.message // empty')

        if [ -z "$RAW_PHONE" ]; then
            cgi_error "missing_phone" "phone number is required"
            exit 0
        fi
        if [ -z "$MESSAGE" ]; then
            cgi_error "missing_message" "message text is required"
            exit 0
        fi

        PHONE=$(normalize_phone "$RAW_PHONE")
        # An alphanumeric sender cannot be replied to; refuse before qsms so no failed record is logged.
        case "$PHONE" in
            ''|*[!0-9]*)
                jq -n --arg addr "$PHONE" '{success: false, error: "send_failed", detail: "That phone number is not valid.", addr: $addr, parts: 0, sent_parts: 0, concat_ref: null, refs: null, ambiguous: false}'
                exit 0
                ;;
        esac
        qlog_info "Sending SMS to $PHONE (raw: $RAW_PHONE)"

        result=$("$QSMS" send "$PHONE" "$MESSAGE" 2>/dev/null)
        if [ "$(printf '%s' "$result" | jq -r '.success' 2>/dev/null)" = "true" ]; then
            # Logged under the normalized number: inbound senders carry no "+", so the bubble threads with them.
            sms_sent_append "$PHONE" "$MESSAGE" success \
                || qlog_warn "SMS send: sent, but could not log the message"
            qlog_info "SMS sent successfully to $PHONE"
            # addr = the normalized number the record is filed under, so the UI opens that thread.
            jq -n --arg addr "$PHONE" '{success: true, addr: $addr}'
        else
            sms_sent_append "$PHONE" "$MESSAGE" failed \
                || qlog_warn "SMS send: could not log the failed message"
            detail=$(qsms_detail "$result")
            qlog_error "SMS send failed to $PHONE: $detail"
            # parts / sent_parts let the UI warn that a resend repeats the parts already delivered.
            parts=$(printf '%s' "$result" | jq -r '.parts // 0' 2>/dev/null)
            sent_parts=$(printf '%s' "$result" | jq -r '.sent_parts // 0' 2>/dev/null)
            case "$parts" in ''|*[!0-9]*) parts=0 ;; esac
            case "$sent_parts" in ''|*[!0-9]*) sent_parts=0 ;; esac
            # concat_ref / refs / ambiguous pass through from qsms as-is (null when absent, false kept).
            extra=$(printf '%s' "$result" | jq -c '{concat_ref: .concat_ref, refs: .refs, ambiguous: .ambiguous}' 2>/dev/null)
            [ -z "$extra" ] && extra='{"concat_ref":null,"refs":null,"ambiguous":null}'
            jq -n --arg detail "$detail" --arg addr "$PHONE" --argjson parts "$parts" --argjson sent "$sent_parts" --argjson extra "$extra" \
                '{"success":false,"error":"send_failed","detail":$detail,"addr":$addr,"parts":$parts,"sent_parts":$sent} + $extra'
        fi
        exit 0
    fi

    # --- action: delete --------------------------------------------------------
    if [ "$ACTION" = "delete" ]; then
        STORAGE=$(printf '%s' "$POST_DATA" | jq -r '.storage // "ME"' 2>/dev/null)
        DEL_ADDR=$(printf '%s' "$POST_DATA" | jq -r 'if .addr == null then empty else (.addr | tostring) end' 2>/dev/null)
        DEL_INDEX=$(printf '%s' "$POST_DATA" | jq -r 'if .index == null then empty else (.index | tostring) end' 2>/dev/null)

        # --- sent-log records ---------------------------------------------------
        if [ "$STORAGE" = "SENT" ]; then
            IDS=$(printf '%s' "$POST_DATA" | jq -c 'if (.identities | type) == "array" and (.identities | length) > 0 and all(.identities[]; type == "string") then .identities else empty end' 2>/dev/null)
            if [ -z "$IDS" ]; then
                cgi_error "missing_identities" "identities array is required"
                exit 0
            fi
            if sms_sent_delete_identities "$IDS"; then
                qlog_info "Deleted sent SMS records: $IDS"
                cgi_success
            else
                qlog_error "Could not update the sent SMS log"
                cgi_error "partial_failure" "sent messages could not be deleted"
            fi
            exit 0
        fi

        # --- a whole conversation -----------------------------------------------
        if [ -n "$DEL_ADDR" ] && [ "$DEL_INDEX" = "ALL" ]; then
            qlog_info "Deleting SMS conversation with $DEL_ADDR"
            list_json=$("$QSMS" list all 2>/dev/null)
            if [ "$(printf '%s' "$list_json" | jq -r '.success' 2>/dev/null)" != "true" ]; then
                cgi_error "partial_failure" "$(qsms_detail "$list_json")"
                exit 0
            fi

            fail_count=0
            # One "<ST> <count> i,j,.." line per storage holding this sender.
            groups=$(printf '%s' "$list_json" | jq -r --arg addr "$DEL_ADDR" '
                [.msg[]? | select(.sender == $addr)] | group_by(.storage)
                | .[] | "\(.[0].storage) \(length) \([.[].index | tostring] | join(","))"' 2>/dev/null)
            # Newline-only splitting, no globbing.
            _sms_ifs="$IFS"
            IFS='
'
            set -f
            for g in $groups; do
                st="${g%% *}"
                rest="${g#* }"
                cnt="${rest%% *}"
                idxs="${rest#* }"
                case "$st" in ME|SM) ;; *) fail_count=$((fail_count + 1)); continue ;; esac
                case "$cnt" in ''|*[!0-9]*) fail_count=$((fail_count + 1)); continue ;; esac
                case "$idxs" in ''|*[!0-9,]*) fail_count=$((fail_count + cnt)); continue ;; esac
                _sms_delete_slots "$st" "$idxs" "$cnt"
                if [ "$DEL_FAILED" -gt 0 ]; then
                    qlog_warn "SMS delete $DEL_ADDR from $st: $DEL_FAILED of $cnt failed"
                    fail_count=$((fail_count + DEL_FAILED))
                fi
            done
            set +f
            IFS="$_sms_ifs"

            if ! sms_sent_delete_addr "$DEL_ADDR"; then
                qlog_error "Could not drop sent SMS records for $DEL_ADDR"
                fail_count=$((fail_count + 1))
            fi

            if [ "$fail_count" -gt 0 ]; then
                cgi_error "partial_failure" "$fail_count message(s) failed to delete"
                exit 0
            fi
            qlog_info "SMS conversation with $DEL_ADDR deleted"
            cgi_success
            exit 0
        fi

        # --- modem slots by index -----------------------------------------------
        # Deletes every slot of one (possibly merged) message in one storage.
        INDEXES_JSON=$(printf '%s' "$POST_DATA" | jq -c '.indexes // empty' 2>/dev/null)

        if [ -z "$INDEXES_JSON" ] || [ "$INDEXES_JSON" = "null" ]; then
            cgi_error "missing_indexes" "indexes array is required"
            exit 0
        fi

        case "$STORAGE" in
            ME|SM) : ;;
            *) STORAGE="ME" ;;
        esac

        # Only non-negative integers reach qsms; anything else counts as a failure.
        want=$(printf '%s' "$INDEXES_JSON" | jq -r 'if type == "array" then length else 0 end' 2>/dev/null)
        idx_list=$(printf '%s' "$INDEXES_JSON" | jq -r '
            if type == "array" then
                [.[] | (if type == "string" then (tonumber? // null) else . end)
                     | select(type == "number" and . >= 0 and . == floor) | tostring] | join(",")
            else "" end' 2>/dev/null)
        [ -z "$want" ] && want=0

        qlog_info "Deleting SMS indexes from $STORAGE: $INDEXES_JSON"
        fail_count=$want
        if [ -n "$idx_list" ]; then
            result=$("$QSMS" delete "$STORAGE" "$idx_list" 2>/dev/null)
            done_n=$(printf '%s' "$result" | jq -r '(.deleted // []) | length' 2>/dev/null)
            [ -z "$done_n" ] && done_n=0
            fail_count=$((want - done_n))
        fi

        if [ "$fail_count" -gt 0 ]; then
            qlog_warn "SMS delete completed with $fail_count failure(s)"
            cgi_error "partial_failure" "$fail_count message(s) failed to delete"
            exit 0
        fi

        qlog_info "SMS delete complete"
        cgi_success
        exit 0
    fi

    # --- action: delete_all ---------------------------------------------------
    if [ "$ACTION" = "delete_all" ]; then
        qlog_info "Deleting all SMS messages (ME + SM + sent log)"

        me_result=$("$QSMS" delete ME all 2>/dev/null)
        sm_result=$("$QSMS" delete SM all 2>/dev/null)
        me_ok=$(printf '%s' "$me_result" | jq -r '.success' 2>/dev/null)
        sm_ok=$(printf '%s' "$sm_result" | jq -r '.success' 2>/dev/null)
        sent_detail="ok"
        sms_sent_clear || sent_detail="could not clear the sent log"

        if [ "$me_ok" != "true" ] || [ "$sm_ok" != "true" ] || [ "$sent_detail" != "ok" ]; then
            me_detail=$(printf '%s' "$me_result" | jq -r 'if .success then "ok" else (.detail // "\(.remaining // "?") left") end' 2>/dev/null)
            sm_detail=$(printf '%s' "$sm_result" | jq -r 'if .success then "ok" else (.detail // "\(.remaining // "?") left") end' 2>/dev/null)
            qlog_error "SMS delete all failed: ME='$me_detail' SM='$sm_detail' SENT='$sent_detail'"
            jq -n --arg me "${me_detail:-no reply}" --arg sm "${sm_detail:-no reply}" --arg sent "$sent_detail" \
                '{"success":false,"error":"delete_all_failed","detail":("ME: " + $me + " | SM: " + $sm + " | SENT: " + $sent)}'
            exit 0
        fi

        qlog_info "All SMS messages deleted (ME + SM + sent log)"
        cgi_success
        exit 0
    fi

    # --- action: set_smsc ----------------------------------------------------
    if [ "$ACTION" = "set_smsc" ]; then
        NEW_SMSC=$(printf '%s' "$POST_DATA" | jq -r 'if .addr == null then empty else (.addr | tostring) end' 2>/dev/null)
        # Optional leading +, then 3..20 digits, nothing else.
        digits="${NEW_SMSC#+}"
        case "$digits" in
            ''|*[!0-9]*) digits="" ;;
        esac
        if [ -z "$digits" ] || [ "${#digits}" -lt 3 ] || [ "${#digits}" -gt 20 ]; then
            cgi_error "invalid_smsc" "SMS centre number must be 3 to 20 digits, optionally starting with +"
            exit 0
        fi
        toa=129
        case "$NEW_SMSC" in +*) toa=145 ;; esac

        qlog_info "Setting SMSC to $NEW_SMSC (toa $toa)"
        out=$("$QCMD" "AT+CSCA=\"$NEW_SMSC\",$toa" 2>&1)
        rc=$?
        if [ $rc -ne 0 ]; then
            case "$out" in
                *modem_busy*|*scan_in_progress*)
                    _sms_busy_reply
                    exit 0
                    ;;
            esac
            qlog_error "SMSC write failed (rc=$rc)"
            cgi_error "smsc_write_failed" "The modem did not accept the SMS centre number"
            exit 0
        fi
        if ! printf '%s\n' "$out" | tr -d '\r' | grep -q '^OK'; then
            qlog_error "SMSC write rejected: $(printf '%s' "$out" | tr -d '\r' | tr '\n' ' ')"
            cgi_error "smsc_write_failed" "The modem did not accept the SMS centre number"
            exit 0
        fi

        _sms_smsc_read
        case $? in
            0) ;;
            2) _sms_busy_reply; exit 0 ;;
            *)
                cgi_error "smsc_write_failed" "The SMS centre number could not be read back"
                exit 0
                ;;
        esac
        jq -n --argjson smsc "$(_sms_smsc_json "$SMSC_ADDR")" '{success: true, smsc: $smsc}'
        exit 0
    fi

    # --- Unknown action (mark_read / mark_unread are client-side) --------------
    cgi_error "invalid_action" "action must be send, delete, delete_all or set_smsc"
    exit 0
fi

# --- Method not allowed ------------------------------------------------------
cgi_method_not_allowed
