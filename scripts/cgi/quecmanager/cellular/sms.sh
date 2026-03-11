#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# sms.sh — CGI Endpoint: SMS Center (GET + POST)
# =============================================================================
# GET:  Returns all received SMS messages and storage status via sms_tool.
# POST: Sends, deletes individual, or deletes all SMS messages.
#
# External tool (pre-installed, pre-configured port — NEVER change port):
#   sms_tool recv -j              -> JSON: {"msg":[{index,sender,timestamp,content,...}]}
#   sms_tool send <phone> <msg>   -> Send an SMS
#   sms_tool delete <index>       -> Delete one message
#   sms_tool delete all           -> Delete all messages
#   sms_tool status               -> Storage status (plain text)
#
# POST body: { "action": "send"|"delete"|"delete_all", ... }
#   action=send:       { "action":"send", "phone":"...", "message":"..." }
#   action=delete:     { "action":"delete", "index": <number> }
#   action=delete_all: { "action":"delete_all" }
#
# Endpoint: GET/POST /cgi-bin/quecmanager/cellular/sms.sh
# Install location: /www/cgi-bin/quecmanager/cellular/sms.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_sms"
cgi_headers
cgi_handle_options

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
# 1. Strip leading "+" (sms_tool requires no + prefix)
# 2. If starts with "0" (local format), detect country from SIM's MCC
#    and replace leading 0 with the country calling code
normalize_phone() {
    _phone="$1"

    # Strip + prefix
    _phone=$(printf '%s' "$_phone" | sed 's/^+//')

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
# GET — Fetch inbox messages + storage status
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching SMS inbox and status"

    # 1. Get messages via sms_tool recv -j (JSON output: {"msg":[...]})
    raw_json=$(sms_tool recv -j 2>/dev/null)
    if [ -n "$raw_json" ]; then
        raw_msgs=$(printf '%s' "$raw_json" | jq '.msg // []' 2>/dev/null)
        [ -z "$raw_msgs" ] && raw_msgs="[]"
    else
        raw_msgs="[]"
    fi

    # Validate JSON — if extraction failed, fallback to empty
    printf '%s' "$raw_msgs" | jq empty 2>/dev/null || raw_msgs="[]"

    # 2. Merge multi-part messages (same sender+reference) into single entries
    #    - Single messages (no "reference" field) pass through as-is
    #    - Multi-part messages are grouped by sender+reference, sorted by part,
    #      content concatenated, all storage indexes collected for bulk delete
    messages=$(printf '%s' "$raw_msgs" | jq '
        [.[] | select(has("reference") | not) |
            {indexes: [.index], sender, content, timestamp}
        ] as $singles |
        ([.[] | select(has("reference"))] |
            group_by(.sender + "|" + (.reference | tostring)) |
            [.[] | sort_by(.part) | {
                indexes: [.[].index],
                sender: .[0].sender,
                content: ([.[].content] | join("")),
                timestamp: .[0].timestamp
            }]
        ) as $merged |
        ($singles + $merged) | sort_by(-.indexes[0])
    ' 2>/dev/null)
    [ -z "$messages" ] && messages="[]"
    printf '%s' "$messages" | jq empty 2>/dev/null || messages="[]"

    # 2. Get storage status via sms_tool status (plain text, needs parsing)
    status_raw=$(sms_tool status 2>/dev/null)
    # Parse "used" and "total" from output — expected pattern: N/M somewhere in output
    storage_used=$(printf '%s' "$status_raw" | grep -o '[0-9]*/[0-9]*' | head -1 | cut -d'/' -f1)
    storage_total=$(printf '%s' "$status_raw" | grep -o '[0-9]*/[0-9]*' | head -1 | cut -d'/' -f2)
    [ -z "$storage_used" ] && storage_used=0
    [ -z "$storage_total" ] && storage_total=0

    # 3. Build JSON response
    jq -n \
        --argjson messages "$messages" \
        --argjson used "$storage_used" \
        --argjson total "$storage_total" \
        '{
            success: true,
            messages: $messages,
            storage: {
                used: $used,
                total: $total
            }
        }'
    exit 0
fi

# =============================================================================
# POST — Send / Delete / Delete All
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

        # Normalize: strip +, replace leading 0 with country code
        PHONE=$(normalize_phone "$RAW_PHONE")

        qlog_info "Sending SMS to $PHONE (raw: $RAW_PHONE)"
        result=$(sms_tool send "$PHONE" "$MESSAGE" 2>&1)
        rc=$?

        if [ $rc -ne 0 ]; then
            qlog_error "sms_tool send failed (rc=$rc): $result"
            jq -n --arg detail "$result" \
                '{"success":false,"error":"send_failed","detail":$detail}'
            exit 0
        fi

        qlog_info "SMS sent successfully to $PHONE"
        cgi_success
        exit 0
    fi

    # --- action: delete ------------------------------------------------------
    # Accepts "indexes": [n, ...] — deletes all storage slots for a (possibly
    # merged multi-part) message.
    if [ "$ACTION" = "delete" ]; then
        INDEXES_JSON=$(printf '%s' "$POST_DATA" | jq -c '.indexes // empty' 2>/dev/null)

        if [ -z "$INDEXES_JSON" ] || [ "$INDEXES_JSON" = "null" ]; then
            cgi_error "missing_indexes" "indexes array is required"
            exit 0
        fi

        qlog_info "Deleting SMS indexes: $INDEXES_JSON"
        fail_count=0
        printf '%s' "$INDEXES_JSON" | jq -r '.[]' | while read -r idx; do
            result=$(sms_tool delete "$idx" 2>&1)
            rc=$?
            if [ $rc -ne 0 ]; then
                qlog_warn "Failed to delete index $idx: $result"
                fail_count=$((fail_count + 1))
            fi
        done

        qlog_info "SMS delete complete"
        cgi_success
        exit 0
    fi

    # --- action: delete_all --------------------------------------------------
    if [ "$ACTION" = "delete_all" ]; then
        qlog_info "Deleting all SMS messages"
        result=$(sms_tool delete all 2>&1)
        rc=$?

        if [ $rc -ne 0 ]; then
            qlog_error "sms_tool delete all failed (rc=$rc): $result"
            jq -n --arg detail "$result" \
                '{"success":false,"error":"delete_all_failed","detail":$detail}'
            exit 0
        fi

        qlog_info "All SMS messages deleted"
        cgi_success
        exit 0
    fi

    # --- Unknown action ------------------------------------------------------
    cgi_error "invalid_action" "action must be send, delete, or delete_all"
    exit 0
fi

# --- Method not allowed ------------------------------------------------------
cgi_method_not_allowed
