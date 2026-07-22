#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/cgi_at.sh
. /usr/lib/qmanager/platform.sh
. /usr/lib/qmanager/ttl_state.sh
# =============================================================================
# apn.sh — CGI Endpoint: WAN Profile Management (GET + POST), AT-only
# =============================================================================
# RM520N-GL has no Casa RDB key-value store and no wmmd daemon, so every
# profile field is sourced directly from AT commands through qcmd.
#
# GET  -> List all 6 WAN profile slots (one per PDP context CID 1-6).
# POST -> {"action":"save"|"toggle"|"deactivate", ...} applies a configuration
#         change. "deactivate" is the WS6 single-APN action — see addendum below.
#
# AT commands used (GET):
#   AT+CGDCONT?        -> defined PDP contexts (CID, PDP type, APN)
#   AT+CGACT?          -> per-context activation state
#   AT+QICSGP=<cid>    -> Quectel context config (auth type, username, password)
#   AT+CGCONTRDP=<cid> -> dynamic params of an ACTIVE context (IP, gw, DNS)
#
# AT commands used (POST):
#   AT+CGDCONT=<cid>,"<pdp>","<apn>"               -> define APN + PDP type
#   AT+QICSGP=<cid>,<ctx>,"<apn>","<u>","<p>",<a>  -> APN + auth (Quectel)
#   AT+CGACT=<0|1>,<cid>                           -> toggle context (action: toggle)
#   AT+COPS=2 / AT+COPS=0                          -> detach/re-attach (action: save)
#
# NOTE: AT+CGAUTH is NOT supported on RM520N-GL firmware (returns ERROR), so
# authentication is written via the Quectel-native AT+QICSGP, which also
# carries the APN and an IP-stack context type.
#
# Endpoint: GET/POST /cgi-bin/quecmanager/cellular/apn.sh
# Install location: <docroot>/cgi-bin/quecmanager/cellular/apn.sh
#
# -----------------------------------------------------------------------------
# WS6 addendum — single-APN (RM551E `use-apn-settings.ts`) contract
# -----------------------------------------------------------------------------
# Additively, GET also emits `active`, `active_cid`, `internet_cid`, the
# single stored `apn{apn,pdp_type,cid}` object, and `cids[]` (one tagged entry
# per CID 1-$MAX_PROFILES) — all derived from the SAME AT reads above plus one
# extra AT+CGPADDR;+QMAP="WWAN" round-trip via cgi_at.sh's detect_active_cid().
# None of the existing 6-slot `profiles[]`/`toggle` output is touched.
#
# The single stored APN setting lives in its own flat sidecar,
# /usrdata/qmanager/apn_setting.json (sibling of apn_names.json, same
# world-writable dir, same atomic tmp+mv write pattern) — NOT the source's v2
# apn_profiles.json store, which has no migration primitive on this platform.
#
# POST action=save gets a NEW branch, selected when the request body has no
# `index` key (the legacy 6-slot contract always sends one; the WS6 contract
# sends `cid` instead). That branch runs a LIGHTER apply — AT+COPS=2 ->
# AT+CGDCONT=<cid>,"<pdp>","<apn>" -> AT+COPS=0 -- deliberately skipping the
# AT+QICSGP auth write and the name-sidecar write below, so a single-APN save
# never blanks a legacy slot's stored auth credentials or profile name.
#
# POST action=deactivate is NEW: reverts the modem to carrier-default (blank
# CGDCONT APN) via the same COPS cycle and sets the sidecar's active=0. A
# request while already active=0 is a no-op that never touches the modem.
# -----------------------------------------------------------------------------

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_apn"
cgi_headers
cgi_handle_options

# --- Configuration -----------------------------------------------------------
MAX_PROFILES=6
NAME_FILE="/usrdata/qmanager/apn_names.json"
# WS6 single-APN sidecar (see addendum above). Sibling of NAME_FILE, same dir
# perms (/usrdata/qmanager is 0777), same lazy-create-on-first-save pattern —
# no installer seeding needed.
SETTING_FILE="/usrdata/qmanager/apn_setting.json"

# =============================================================================
# Helpers
# =============================================================================

# die <error_code> <detail> — emit a JSON error and stop. CGI exits 0; the
# client distinguishes success via the "success" field, not the HTTP status.
die() {
    qlog_error "$1: ${2:-}"
    cgi_error "$1" "${2:-}"
    exit 0
}

# PDP type <-> frontend vocabulary. AT+CGDCONT uses IP/IPV6/IPV4V6; the UI
# uses ipv4/ipv6/ipv4v6 (see PDP_TYPE_OPTIONS in types/wan-profiles.ts).
pdp_to_frontend() {
    case "$1" in
        IP|IPV4) echo "ipv4" ;;
        IPV6)    echo "ipv6" ;;
        IPV4V6)  echo "ipv4v6" ;;
        *)       echo "" ;;
    esac
}
pdp_to_at() {
    case "$1" in
        ipv4)   echo "IP" ;;
        ipv6)   echo "IPV6" ;;
        ipv4v6) echo "IPV4V6" ;;
        *)      echo "" ;;
    esac
}

# Auth type <-> frontend vocabulary. AT (QICSGP/CGAUTH) uses 0/1/2.
auth_to_frontend() {
    case "$1" in
        1) echo "pap" ;;
        2) echo "chap" ;;
        *) echo "none" ;;
    esac
}
auth_to_at() {
    case "$1" in
        pap)  echo "1" ;;
        chap) echo "2" ;;
        *)    echo "0" ;;
    esac
}

# PDP type -> AT+QICSGP context type (1 = IPv4, 2 = IPv6, 3 = IPv4v6).
pdp_to_ctxtype() {
    case "$1" in
        ipv4) echo "1" ;;
        ipv6) echo "2" ;;
        *)    echo "3" ;;
    esac
}

# Carrier-provisioned APN classification. CIDs 2/3 ship as the operator's IMS
# (VoLTE) and SOS (emergency) contexts; tagging apn_type lets the frontend's
# isCarrierProfile() guard lock those rows so they cannot be edited or toggled.
apn_type_of() {
    case "$1" in
        ims|IMS) echo "ims" ;;
        sos|SOS) echo "emergency" ;;
        *)       echo "" ;;
    esac
}

# Read the persisted profile-name sidecar as a compact JSON object.
# Missing/corrupt file -> "{}" (all names empty; not an error).
read_names_json() {
    if [ -f "$NAME_FILE" ]; then
        _nj=$(jq -c '.' "$NAME_FILE" 2>/dev/null)
        [ -n "$_nj" ] && { printf '%s' "$_nj"; return; }
    fi
    printf '%s' "{}"
}

# write_name <cid> <name> — merge one {cid:name} entry into the sidecar.
# Written by www-data (CGI runs as www-data; /usrdata/qmanager is 0777),
# then chmod 644 explicitly so the mode does not depend on umask.
write_name() {
    _wc="$1"
    _wn="$2"
    _wdir=$(dirname "$NAME_FILE")
    [ -d "$_wdir" ] || mkdir -p "$_wdir" 2>/dev/null
    _wcur=$(read_names_json)
    _wnew=$(printf '%s' "$_wcur" | jq -c --arg k "$_wc" --arg v "$_wn" '.[$k]=$v' 2>/dev/null)
    [ -z "$_wnew" ] && return 1
    _wtmp="${NAME_FILE}.tmp.$$"
    printf '%s\n' "$_wnew" > "$_wtmp" 2>/dev/null || return 1
    chmod 644 "$_wtmp" 2>/dev/null
    mv "$_wtmp" "$NAME_FILE" 2>/dev/null || { rm -f "$_wtmp" 2>/dev/null; return 1; }
    chmod 644 "$NAME_FILE" 2>/dev/null
    return 0
}

# --- WS6 single-APN sidecar (SETTING_FILE) ----------------------------------

# Read the persisted single-APN setting as a compact JSON object.
# Missing/corrupt file -> {"active":0} (defensive: treat as carrier default
# with no stored APN, never an error).
read_setting_json() {
    if [ -f "$SETTING_FILE" ]; then
        _sj=$(jq -c '.' "$SETTING_FILE" 2>/dev/null)
        [ -n "$_sj" ] && { printf '%s' "$_sj"; return; }
    fi
    printf '%s' '{"active":0}'
}

# write_setting_json <apn> <pdp_type> <cid> <active> — atomic tmp+mv, 644.
# <pdp_type> is frontend vocabulary (ipv4/ipv6/ipv4v6); <active> is 0 or 1.
write_setting_json() {
    _sa="$1"
    _sp="$2"
    _sc="$3"
    _sact="$4"
    _sdir=$(dirname "$SETTING_FILE")
    [ -d "$_sdir" ] || mkdir -p "$_sdir" 2>/dev/null
    _snew=$(jq -n \
        --arg apn "$_sa" \
        --arg pdp_type "$_sp" \
        --argjson cid "$_sc" \
        --argjson active "$_sact" \
        '{apn: $apn, pdp_type: $pdp_type, cid: $cid, active: $active}' 2>/dev/null)
    [ -z "$_snew" ] && return 1
    _stmp="${SETTING_FILE}.tmp.$$"
    printf '%s\n' "$_snew" > "$_stmp" 2>/dev/null || return 1
    chmod 644 "$_stmp" 2>/dev/null
    mv "$_stmp" "$SETTING_FILE" 2>/dev/null || { rm -f "$_stmp" 2>/dev/null; return 1; }
    chmod 644 "$SETTING_FILE" 2>/dev/null
    return 0
}

# get_cgact_state <cid> — activation state for one CID from the cached
# AT+CGACT? response ("1" = active, "" otherwise).
get_cgact_state() {
    printf '%s\n' "$cgact_raw" | awk -F'[:,]' -v c="$1" '
        /\+CGACT:/ {
            cid = $2; gsub(/[^0-9]/, "", cid)
            if (cid == c) { st = $3; gsub(/[^0-9]/, "", st); print st; exit }
        }'
}

# parse_qicsgp <stripped_qicsgp_response> -> "<auth>\t<username>\t<haspw>"
# Hardware-verified field order (RM520N-GL):
#   +QICSGP: <ctxtype>,"<apn>","<username>","<password>",<authtype>
parse_qicsgp() {
    printf '%s\n' "$1" | awk -F'"' '
        /\+QICSGP:/ {
            user = $4
            pw   = $6
            auth = $7; gsub(/[^0-9]/, "", auth)
            haspw = (pw == "") ? "0" : "1"
            printf "%s\t%s\t%s\n", auth, user, haspw
            exit
        }'
}

# parse_cgcontrdp <stripped_cgcontrdp_response>
#   -> "<v4addr>\t<v4gw>\t<dns1>\t<dns2>\t<v6addr>"
# RM520N-GL format (no MTU / interface fields present):
#   +CGCONTRDP: <cid>,<bearer>,"<apn>","<addr>",<gw>,"<dns1>","<dns2>"
parse_cgcontrdp() {
    printf '%s\n' "$1" | awk -F'"' '
        /\+CGCONTRDP:/ {
            addr = $4; sub(/ .*/, "", addr)
            gw = $5; gsub(/[^0-9.:]/, "", gw)
            d1 = $6
            d2 = $8
            if (addr ~ /:/) { v6 = addr }
            else { v4 = addr; v4gw = gw; v4d1 = d1; v4d2 = d2 }
        }
        END { printf "%s\t%s\t%s\t%s\t%s\n", v4, v4gw, v4d1, v4d2, v6 }'
}

# =============================================================================
# GET — list all 6 WAN profile slots
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Listing WAN profiles (AT)"

    cgdcont_raw=$(run_at 'AT+CGDCONT?')
    cgact_raw=$(run_at 'AT+CGACT?')
    names_json=$(read_names_json)

    tsv=""
    cid=1
    while [ "$cid" -le "$MAX_PROFILES" ]; do
        # --- AT+CGDCONT? — APN + PDP type for defined contexts -------------
        cgd_line=$(printf '%s\n' "$cgdcont_raw" | grep "^+CGDCONT: $cid,")
        if [ -n "$cgd_line" ]; then
            pdp_raw=$(printf '%s' "$cgd_line" | awk -F'"' '{print $2}')
            apn=$(printf '%s' "$cgd_line" | awk -F'"' '{print $4}')
            defined=1
        else
            pdp_raw=""
            apn=""
            defined=0
        fi
        pdp_type=$(pdp_to_frontend "$pdp_raw")
        apn_type=$(apn_type_of "$apn")

        # --- AT+CGACT? — activation state ----------------------------------
        state=$(get_cgact_state "$cid")
        [ "$state" = "1" ] && enabled=1 || enabled=0

        # --- AT+QICSGP — auth type, username, password presence ------------
        auth_type="none"
        username=""
        has_password=0
        if [ "$defined" = "1" ]; then
            qicsgp=$(run_at "AT+QICSGP=$cid")
            if [ -n "$qicsgp" ]; then
                qfields=$(parse_qicsgp "$qicsgp")
                qauth=$(printf '%s' "$qfields" | cut -f1)
                username=$(printf '%s' "$qfields" | cut -f2)
                has_password=$(printf '%s' "$qfields" | cut -f3)
                auth_type=$(auth_to_frontend "$qauth")
                [ -z "$has_password" ] && has_password=0
            fi
        fi

        # --- AT+CGCONTRDP — dynamic params of an ACTIVE context ------------
        # An inactive (or undefined) context returns a bare "OK" with no
        # +CGCONTRDP: line on RM520N-GL, so empty output simply means "no
        # runtime data" — it is not treated as a failure.
        v4addr=""; v4gw=""; dns1=""; dns2=""; v6addr=""
        if [ "$defined" = "1" ] && [ "$enabled" = "1" ]; then
            rdp=$(run_at "AT+CGCONTRDP=$cid")
            if [ -n "$rdp" ]; then
                rfields=$(parse_cgcontrdp "$rdp")
                v4addr=$(printf '%s' "$rfields" | cut -f1)
                v4gw=$(printf '%s'   "$rfields" | cut -f2)
                dns1=$(printf '%s'   "$rfields" | cut -f3)
                dns2=$(printf '%s'   "$rfields" | cut -f4)
                v6addr=$(printf '%s' "$rfields" | cut -f5)
            fi
        fi

        # --- Derived status fields -----------------------------------------
        [ -n "$v4addr" ] && status_ipv4="up" || status_ipv4=""
        [ -n "$v6addr" ] && status_ipv6="up" || status_ipv6=""
        if [ -n "$v4addr" ] || [ -n "$v6addr" ]; then
            connect_progress="connected"
        elif [ "$enabled" = "1" ]; then
            connect_progress="connecting"
        else
            connect_progress="disconnected"
        fi

        # 16 tab-separated columns; name is looked up from $names by index
        # in jq so user-typed text never enters the TSV stream.
        tsv="${tsv}${cid}	${apn}	${pdp_type}	${auth_type}	${username}	${has_password}	${enabled}	${cid}	${apn_type}	${status_ipv4}	${status_ipv6}	${connect_progress}	${v4addr}	${v4gw}	${dns1}	${dns2}
"
        cid=$((cid + 1))
    done

    profiles_json=$(printf '%s' "$tsv" | jq -Rsc --argjson names "$names_json" '
        split("\n") | map(select(length > 0) | split("\t") | {
            index:            (.[0] | tonumber),
            name:             ($names[.[0]] // ""),
            apn:              .[1],
            pdp_type:         .[2],
            auth_type:        .[3],
            username:         .[4],
            has_password:     (.[5] == "1"),
            mtu:              null,
            enabled:          (.[6] == "1"),
            default_route:    false,
            ip_passthrough:   false,
            modem_profile:    (.[7] | tonumber),
            apn_type:         .[8],
            vlan_index:       "",
            status_ipv4:      .[9],
            status_ipv6:      .[10],
            connect_progress: .[11],
            ipv4_address:     .[12],
            ipv4_gateway:     .[13],
            dns1:             .[14],
            dns2:             .[15],
            ipv6_address:     "",
            mtu_negotiated:   null,
            interface:        "",
            pdp_error:        ""
        })')

    if [ -z "$profiles_json" ]; then
        die "parse_failed" "Could not assemble WAN profile list"
    fi

    qlog_info "WAN profiles: $(printf '%s' "$profiles_json" | jq -c length) slots"

    # -------------------------------------------------------------------
    # WS6 addendum — active CID + tagged cids[] + stored single-APN object
    # -------------------------------------------------------------------
    # detect_active_cid (cgi_at.sh) issues one extra compound round-trip
    # (AT+CGPADDR;+QMAP="WWAN"); QMAP is authoritative, CGPADDR is the
    # fallback, and it defaults active_cid="1" on a transient read failure —
    # matching this endpoint's existing lenient GET behavior (the profiles[]
    # loop above already degrades to empty slots rather than dying on an AT
    # hiccup, so active_cid does the same instead of failing the whole GET).
    detect_active_cid
    internet_cid="$active_cid"

    # cids[] is derived from profiles_json (no extra AT calls) — index/apn/
    # apn_type are already known per CID from the AT+CGDCONT? loop above.
    cids_json=$(printf '%s' "$profiles_json" | jq -c --argjson active_cid "$active_cid" '
        [.[] | {
            cid:         .modem_profile,
            apn:         .apn,
            apn_type:    .apn_type,
            is_internet: (.modem_profile == $active_cid)
        }]')
    [ -z "$cids_json" ] && die "parse_failed" "Could not assemble modem context list"

    # Stored single-APN setting (WS6 sidecar). Defensive defaults mirror
    # read_setting_json's {"active":0} fallback for a missing/corrupt file.
    setting_json=$(read_setting_json)
    active_ptr=$(printf '%s' "$setting_json" | jq -r 'if .active == 1 then 1 else 0 end')
    setting_apn=$(printf '%s' "$setting_json" | jq -r 'if .apn == null then "" else .apn end')
    setting_pdp=$(printf '%s' "$setting_json" | jq -r 'if .pdp_type == null then "ipv4v6" else .pdp_type end')
    setting_cid=$(printf '%s' "$setting_json" | jq -r 'if .cid == null then 1 else .cid end')
    case "$setting_cid" in
        ''|*[!0-9]*) setting_cid=1 ;;
    esac

    apn_obj=$(jq -n \
        --arg apn "$setting_apn" \
        --arg pdp_type "$setting_pdp" \
        --argjson cid "$setting_cid" \
        '{apn: $apn, pdp_type: $pdp_type, cid: $cid}')
    [ -z "$apn_obj" ] && die "parse_failed" "Could not assemble stored APN object"

    qlog_info "APN setting (WS6): active=$active_ptr active_cid=$active_cid apn=$setting_apn"

    jq -n \
        --argjson profiles "$profiles_json" \
        --argjson max "$MAX_PROFILES" \
        --argjson active "$active_ptr" \
        --argjson active_cid "$active_cid" \
        --argjson internet_cid "$internet_cid" \
        --argjson apn_obj "$apn_obj" \
        --argjson cids "$cids_json" \
        '{
            success: true,
            max_profiles: $max,
            data_source: "at",
            profiles: $profiles,
            active: $active,
            active_cid: $active_cid,
            internet_cid: $internet_cid,
            apn: $apn_obj,
            cids: $cids
        }'
    exit 0
fi

# =============================================================================
# POST — apply a profile change ({"action":"save"|"toggle", ...})
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    cgi_read_post
    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')

    # -----------------------------------------------------------------------
    # action: deactivate — WS6 single-APN contract, NEW. No client-supplied
    # cid/index (the target CID is read from the sidecar) so this must run
    # BEFORE the common index/cid validation below.
    # -----------------------------------------------------------------------
    if [ "$ACTION" = "deactivate" ]; then
        setting_json=$(read_setting_json)
        cur_active=$(printf '%s' "$setting_json" | jq -r 'if .active == 1 then 1 else 0 end')

        # Already carrier-default: nothing to revert, do NOT touch the modem
        # (avoids an unnecessary WAN drop).
        if [ "$cur_active" != "1" ]; then
            qlog_info "Deactivate (WS6): already carrier default; no modem write"
            jq -n '{success: true, active: 0}'
            exit 0
        fi

        SET_CID=$(printf '%s' "$setting_json" | jq -r 'if .cid == null then 1 else .cid end')
        SET_PDP=$(printf '%s' "$setting_json" | jq -r 'if .pdp_type == null then "ipv4v6" else .pdp_type end')
        case "$SET_CID" in
            ''|*[!0-9]*) SET_CID=1 ;;
        esac
        PDP_AT=$(pdp_to_at "$SET_PDP")
        [ -z "$PDP_AT" ] && PDP_AT="IPV4V6"

        qlog_info "Deactivate (WS6): reverting cid=$SET_CID to carrier default; active=0"

        cops_recover() { run_at "AT+COPS=0" >/dev/null 2>&1 || true; }

        # --- Drive the modem first; empty APN -> carrier reassigns default -
        if ! run_at "AT+COPS=2" >/dev/null; then
            die "cops_detach_failed" "AT+COPS=2 (deregister) failed for CID $SET_CID"
        fi
        if ! run_at "AT+CGDCONT=$SET_CID,\"$PDP_AT\",\"\"" >/dev/null; then
            cops_recover
            die "cgdcont_failed" "AT+CGDCONT (blank APN) failed for CID $SET_CID"
        fi
        if ! run_at "AT+COPS=0" >/dev/null; then
            die "cops_attach_failed" "AT+COPS=0 (re-register) failed for CID $SET_CID"
        fi

        # --- Persist active=0. A persist failure AFTER a successful modem
        # revert still reports success: the modem is already on carrier-
        # default, so failing the request would mislead the UI. Warn only.
        if ! write_setting_json "" "$SET_PDP" "$SET_CID" 0; then
            qlog_warn "Reverted cid $SET_CID on modem but failed to persist active=0 to $SETTING_FILE"
        fi

        jq -n '{success: true, active: 0}'
        exit 0
    fi

    # --- Common: validate the target slot index (1-6 == CID) ---------------
    # action:"save" accepts either the legacy 6-slot `index` field or the
    # WS6 single-APN `cid` field (same integer, different key name depending
    # on which frontend contract is calling).
    IDX=$(printf '%s' "$POST_DATA" | jq -r '(.index // .cid // empty) | tostring')
    case "$IDX" in
        *[!0-9]*|"") die "invalid_index" "index/cid must be a number 1-${MAX_PROFILES}" ;;
    esac
    if [ "$IDX" -lt 1 ] || [ "$IDX" -gt "$MAX_PROFILES" ]; then
        die "invalid_index" "index/cid must be 1-${MAX_PROFILES}"
    fi

    # -----------------------------------------------------------------------
    # action: toggle — activate/deactivate one PDP context
    # -----------------------------------------------------------------------
    if [ "$ACTION" = "toggle" ]; then
        ENABLED=$(printf '%s' "$POST_DATA" | jq -r 'if .enabled == true then "1" elif .enabled == false then "0" else "" end')
        [ -z "$ENABLED" ] && die "missing_fields" "enabled (boolean) is required"

        qlog_info "Toggle profile $IDX -> enabled=$ENABLED"
        if ! run_at "AT+CGACT=$ENABLED,$IDX" >/dev/null; then
            die "cgact_failed" "AT+CGACT=$ENABLED,$IDX failed"
        fi
        cgi_success
        exit 0
    fi

    # -----------------------------------------------------------------------
    # action: save — write APN, PDP type, auth, name; then reactivate
    # -----------------------------------------------------------------------
    if [ "$ACTION" = "save" ]; then
        # ---------------------------------------------------------------
        # WS6 single-APN save (use-apn-settings.ts ApnSaveRequest contract:
        # {action:"save", apn, pdp_type, cid} — no "index"). Selected purely
        # by the ABSENCE of "index" in the request body, so the legacy
        # 6-slot save path below is completely untouched for callers that
        # send one.
        #
        # This is deliberately a LIGHTER apply than the legacy save below:
        # AT+COPS=2 -> AT+CGDCONT -> AT+COPS=0 only. It skips the AT+QICSGP
        # auth write and the name-sidecar write on purpose — a single-APN
        # save must never blank out a legacy slot's stored auth credentials
        # or profile name just because the WS6 request didn't carry them.
        # ---------------------------------------------------------------
        HAS_INDEX=$(printf '%s' "$POST_DATA" | jq -r 'has("index")')
        if [ "$HAS_INDEX" != "true" ]; then
            WS_APN=$(printf '%s' "$POST_DATA" | jq -r 'if .apn == null then "" else .apn end')
            WS_PDP=$(printf '%s' "$POST_DATA" | jq -r 'if .pdp_type == null then "" else .pdp_type end')

            [ -z "$WS_APN" ] && die "missing_fields" "apn is required"
            case "$WS_APN" in
                *'"'*) die "invalid_value" "APN may not contain a double-quote" ;;
            esac
            WS_PDP_AT=$(pdp_to_at "$WS_PDP")
            [ -z "$WS_PDP_AT" ] && die "invalid_pdp_type" "pdp_type must be ipv4, ipv6, or ipv4v6"

            qlog_info "Save APN (WS6): apn=$WS_APN pdp=$WS_PDP_AT cid=$IDX"

            cops_recover() { run_at "AT+COPS=0" >/dev/null 2>&1 || true; }

            # --- Step 1: deregister from the network -----------------------
            if ! run_at "AT+COPS=2" >/dev/null; then
                die "cops_detach_failed" "AT+COPS=2 (deregister) failed for CID $IDX"
            fi

            # --- Step 2: APN + PDP type -------------------------------------
            if ! run_at "AT+CGDCONT=$IDX,\"$WS_PDP_AT\",\"$WS_APN\"" >/dev/null; then
                cops_recover
                die "cgdcont_failed" "AT+CGDCONT failed for CID $IDX"
            fi

            # --- Step 3: re-register so the modem attaches with the new APN -
            if ! run_at "AT+COPS=0" >/dev/null; then
                die "cops_attach_failed" "AT+COPS=0 (re-register) failed for CID $IDX"
            fi

            # --- Step 4: re-apply persisted TTL/HL hotspot-bypass rules -----
            # (parity with the legacy save path — TTL is orthogonal to APN).
            read -r persisted_ttl persisted_hl <<EOF
$(ttl_state_read_persisted)
EOF
            persisted_ttl="${persisted_ttl:-0}"
            persisted_hl="${persisted_hl:-0}"
            if [ "$persisted_ttl" -gt 0 ] 2>/dev/null || [ "$persisted_hl" -gt 0 ] 2>/dev/null; then
                qlog_info "Re-applying persisted TTL=$persisted_ttl HL=$persisted_hl after APN save"
                if ! ttl_state_apply "$persisted_ttl" "$persisted_hl"; then
                    qlog_warn "TTL/HL re-apply failed after APN save; rules may be partial"
                fi
            fi

            # --- Persist to the WS6 sidecar (best-effort after modem apply) -
            # Modem is the source of truth: if the modem write succeeded but
            # the sidecar persist fails, still report success and warn.
            if ! write_setting_json "$WS_APN" "$WS_PDP" "$IDX" 1; then
                qlog_warn "Applied APN to modem but failed to persist $SETTING_FILE"
            fi

            jq -n '{success: true, active: 1}'
            exit 0
        fi

        # ---- Legacy 6-slot save (unchanged) --------------------------------
        NAME=$(printf '%s' "$POST_DATA" | jq -r '.name // ""')
        APN=$(printf '%s' "$POST_DATA" | jq -r '.apn // ""')
        PDP=$(printf '%s' "$POST_DATA" | jq -r '.pdp_type // ""')
        AUTH=$(printf '%s' "$POST_DATA" | jq -r '.auth_type // "none"')
        USERNAME=$(printf '%s' "$POST_DATA" | jq -r '.username // ""')
        PASSWORD=$(printf '%s' "$POST_DATA" | jq -r '.password // ""')
        MTU=$(printf '%s' "$POST_DATA" | jq -r 'if (.mtu | type) == "number" then (.mtu | tostring) else "" end')

        # --- Validate ------------------------------------------------------
        [ -z "$APN" ] && die "missing_fields" "apn is required"
        PDP_AT=$(pdp_to_at "$PDP")
        [ -z "$PDP_AT" ] && die "invalid_pdp_type" "pdp_type must be ipv4, ipv6, or ipv4v6"

        # Reject embedded double-quotes: they would break the quoted AT args.
        case "$APN$USERNAME$PASSWORD" in
            *'"'*) die "invalid_value" "APN/username/password may not contain a double-quote" ;;
        esac

        AUTH_AT=$(auth_to_at "$AUTH")

        qlog_info "Save profile $IDX: apn=$APN pdp=$PDP_AT auth=$AUTH"

        # Apply order: deregister -> write APN -> re-register.
        #
        # Why a full attach cycle (not AT+CGACT=0,<cid> / AT+CGACT=1,<cid>):
        # in EPS (LTE / 5G-NSA), the default EPS bearer for CID 1 is
        # established at *attach time* and the APN is a contract field with
        # the MME/PGW. AT+CGACT only cycles the user-plane of an already-
        # established bearer — the MME keeps the original APN. The new
        # CGDCONT value never reaches the network. AT+COPS=2 forces a full
        # detach, so the next AT+COPS=0 attach carries the freshly-written
        # APN in its Attach Request and the PGW builds a new bearer.
        #
        # The CGI runs on lighttpd via LAN/Wi-Fi to the modem; the cellular
        # WAN drops briefly during the cycle, but the HTTP/SSH path to the
        # modem itself does not. No buffer sleep is needed — run_at goes
        # through qcmd's flock, which is synchronous on OK/ERROR.

        # Helper: best-effort re-register on the error path. Never leave
        # the modem detached after a partial save.
        cops_recover() { run_at "AT+COPS=0" >/dev/null 2>&1 || true; }

        # --- Step 1: deregister from the network --------------------------
        if ! run_at "AT+COPS=2" >/dev/null; then
            die "cops_detach_failed" "AT+COPS=2 (deregister) failed for CID $IDX"
        fi

        # --- Step 2: APN + PDP type ---------------------------------------
        if ! run_at "AT+CGDCONT=$IDX,\"$PDP_AT\",\"$APN\"" >/dev/null; then
            cops_recover
            die "cgdcont_failed" "AT+CGDCONT failed for CID $IDX"
        fi

        # --- Step 3: APN + PDP authentication via AT+QICSGP ---------------
        # AT+CGAUTH is unsupported on RM520N-GL, so the Quectel-native
        # AT+QICSGP carries the auth write. It also (re)sets the APN and an
        # IP-stack context type — harmless, since the APN matches Step 2.
        # With no auth, the username/password fields are written empty to
        # clear any stored credential. A blank password on a PAP/CHAP
        # profile means "keep the stored secret": QICSGP's password field is
        # mandatory, so the existing value is read back and reused rather
        # than wiped.
        CTXTYPE=$(pdp_to_ctxtype "$PDP")
        if [ "$AUTH_AT" = "0" ]; then
            qicsgp_cmd="AT+QICSGP=$IDX,$CTXTYPE,\"$APN\",\"\",\"\",0"
        else
            eff_pass="$PASSWORD"
            if [ -z "$eff_pass" ]; then
                cur_qicsgp=$(run_at "AT+QICSGP=$IDX")
                eff_pass=$(printf '%s\n' "$cur_qicsgp" | awk -F'"' '/\+QICSGP:/ {print $6; exit}')
                qlog_info "Profile $IDX: password blank — preserving stored credential"
            fi
            qicsgp_cmd="AT+QICSGP=$IDX,$CTXTYPE,\"$APN\",\"$USERNAME\",\"$eff_pass\",$AUTH_AT"
        fi
        if ! run_at "$qicsgp_cmd" >/dev/null; then
            cops_recover
            die "qicsgp_failed" "AT+QICSGP failed for CID $IDX"
        fi

        # --- Step 4: persist the profile name (filesystem only) -----------
        if ! write_name "$IDX" "$NAME"; then
            qlog_warn "Failed to persist profile name for CID $IDX to $NAME_FILE"
        fi

        # --- Step 5: MTU — no reliable per-context AT write on RM520N -----
        # Do not report a write that cannot happen as success.
        if [ -n "$MTU" ] && [ "$MTU" != "1500" ] && [ "$MTU" != "0" ]; then
            qlog_warn "Profile $IDX: requested MTU=$MTU ignored (no per-context MTU write on RM520N-GL AT)"
        fi

        # --- Step 6: re-register so the modem attaches with the new APN ---
        # AT+COPS=0 = automatic operator selection. The MME/PGW build a
        # fresh default EPS bearer using the CGDCONT/QICSGP values written
        # above. AT+CGCONTRDP=<cid> will reflect the new negotiated APN
        # once attach completes.
        if ! run_at "AT+COPS=0" >/dev/null; then
            die "cops_attach_failed" "AT+COPS=0 (re-register) failed for CID $IDX"
        fi

        # --- Step 7: re-apply persisted TTL/HL hotspot-bypass rules -------
        # iptables rules survive interface flaps, so this is belt-and-
        # suspenders, but it keeps parity with the documented "TTL is
        # re-applied after an APN change" behavior.
        read -r persisted_ttl persisted_hl <<EOF
$(ttl_state_read_persisted)
EOF
        persisted_ttl="${persisted_ttl:-0}"
        persisted_hl="${persisted_hl:-0}"
        if [ "$persisted_ttl" -gt 0 ] 2>/dev/null || [ "$persisted_hl" -gt 0 ] 2>/dev/null; then
            qlog_info "Re-applying persisted TTL=$persisted_ttl HL=$persisted_hl after profile save"
            if ! ttl_state_apply "$persisted_ttl" "$persisted_hl"; then
                qlog_warn "TTL/HL re-apply failed after profile save; rules may be partial"
            fi
        fi

        cgi_success
        exit 0
    fi

    die "invalid_action" "action must be 'save', 'toggle', or 'deactivate'"
fi

# --- Method not allowed -------------------------------------------------------
cgi_method_not_allowed
