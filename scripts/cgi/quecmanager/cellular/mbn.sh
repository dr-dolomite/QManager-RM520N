#!/bin/sh
# =============================================================================
# mbn.sh — CGI Endpoint: MBN Configuration (GET + POST)
# =============================================================================
# GET:  Reads MBN auto-select status and profile list.
# POST: Applies MBN profile changes or triggers device reboot.
#
# AT commands used (GET):
#   AT+QMBNCFG="AutoSel"   -> Auto-select status (0 or 1)
#   AT+QMBNCFG="list"      -> All MBN profiles with status
#
# AT commands used (POST, action=apply_profile):
#   AT+QMBNCFG="AutoSel",0           -> Disable auto-select
#   AT+QMBNCFG="deactivate"          -> Deactivate current profile
#   AT+QMBNCFG="select","<name>"     -> Select new profile
#
# AT commands used (POST, action=auto_sel):
#   AT+QMBNCFG="AutoSel",<0|1>       -> Set auto-select
#
# POST action=reboot:
#   Executes system reboot command
#
# Endpoint: GET/POST /cgi-bin/quecmanager/cellular/mbn.sh
# Install location: /www/cgi-bin/quecmanager/cellular/mbn.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
. /usr/lib/qmanager/qlog.sh 2>/dev/null || {
    qlog_init() { :; }
    qlog_info() { :; }
    qlog_warn() { :; }
    qlog_error() { :; }
    qlog_debug() { :; }
}
qlog_init "cgi_mbn"

# --- Configuration -----------------------------------------------------------
CMD_GAP=0.2

# --- HTTP Headers ------------------------------------------------------------
echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo "Access-Control-Allow-Origin: *"
echo "Access-Control-Allow-Methods: GET, POST, OPTIONS"
echo "Access-Control-Allow-Headers: Content-Type"
echo ""

# --- Handle CORS preflight ---------------------------------------------------
if [ "$REQUEST_METHOD" = "OPTIONS" ]; then
    exit 0
fi

# --- Helper: Execute AT command via qcmd, return stripped response -----------
strip_at_response() {
    printf '%s' "$1" | tr -d '\r' | sed '1d' | sed '/^OK$/d' | sed '/^ERROR$/d'
}

run_at() {
    local raw
    raw=$(qcmd "$1" 2>/dev/null)
    local rc=$?
    if [ $rc -ne 0 ] || [ -z "$raw" ]; then
        return 1
    fi
    case "$raw" in
        *ERROR*) return 1 ;;
    esac
    strip_at_response "$raw"
}

# =============================================================================
# GET — Fetch MBN auto-select status and profile list
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching MBN settings"

    # --- 1. Auto-select status ---
    auto_sel="0"
    autosel_resp=$(run_at 'AT+QMBNCFG="AutoSel"')
    sleep "$CMD_GAP"

    if [ -n "$autosel_resp" ]; then
        # +QMBNCFG: "AutoSel",<0|1>
        auto_sel=$(printf '%s' "$autosel_resp" | awk -F',' '
            /\+QMBNCFG:.*"AutoSel"/ {
                val = $2; gsub(/[^0-9]/, "", val)
                if (val != "") print val
            }
        ')
        [ -z "$auto_sel" ] && auto_sel="0"
    fi

    # --- 2. Profile list ---
    list_resp=$(run_at 'AT+QMBNCFG="list"')
    sleep "$CMD_GAP"

    if [ -n "$list_resp" ]; then
        # +QMBNCFG: "List",<idx>,<sel>,<act>,"<name>",<ver>,<date>
        profiles_json=$(printf '%s' "$list_resp" | awk -F',' '
            /\+QMBNCFG:.*"List"/ {
                idx = $2; gsub(/[^0-9]/, "", idx)
                sel = $3; gsub(/[^0-9]/, "", sel)
                act = $4; gsub(/[^0-9]/, "", act)
                name = $5; gsub(/"/, "", name); gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
                ver = $6; gsub(/[[:space:]]/, "", ver)
                date = $7; gsub(/[[:space:]\r]/, "", date)
                if (idx != "" && name != "") {
                    printf "%s\t%s\t%s\t%s\t%s\t%s\n", idx, sel, act, name, ver, date
                }
            }
        ' | jq -Rsc '
            split("\n") | map(select(length > 0) | split("\t") |
                {
                    index: (.[0] | tonumber),
                    selected: (.[1] == "1"),
                    activated: (.[2] == "1"),
                    name: .[3],
                    version: .[4],
                    date: .[5]
                }
            )
        ')
    else
        profiles_json="[]"
    fi

    qlog_info "MBN: auto_sel=$auto_sel, profiles=$(printf '%s' "$profiles_json" | jq -c length)"

    jq -n \
        --arg auto_sel "$auto_sel" \
        --argjson profiles "$profiles_json" \
        '{
            success: true,
            auto_sel: ($auto_sel | tonumber),
            profiles: $profiles
        }'
    exit 0
fi

# =============================================================================
# POST — Apply MBN changes or reboot
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    # --- Read POST body ---
    if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
        POST_DATA=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null)
    else
        echo '{"success":false,"error":"no_body","detail":"POST body is empty"}'
        exit 0
    fi

    # --- Extract action ---
    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')

    if [ -z "$ACTION" ]; then
        echo '{"success":false,"error":"missing_action","detail":"action field is required"}'
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: apply_profile
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "apply_profile" ]; then
        PROFILE_NAME=$(printf '%s' "$POST_DATA" | jq -r '.profile_name // empty')

        if [ -z "$PROFILE_NAME" ]; then
            echo '{"success":false,"error":"missing_profile","detail":"profile_name is required"}'
            exit 0
        fi

        qlog_info "Applying MBN profile: $PROFILE_NAME"

        # Step 1: Disable auto-select
        result=$(qcmd 'AT+QMBNCFG="AutoSel",0' 2>/dev/null)
        case "$result" in
            *ERROR*)
                qlog_error "Failed to disable auto-select: $result"
                echo '{"success":false,"error":"autosel_failed","detail":"Failed to disable auto-select"}'
                exit 0
                ;;
        esac
        sleep "$CMD_GAP"

        # Step 2: Deactivate current profile
        result=$(qcmd 'AT+QMBNCFG="deactivate"' 2>/dev/null)
        case "$result" in
            *ERROR*)
                qlog_error "Failed to deactivate profile: $result"
                echo '{"success":false,"error":"deactivate_failed","detail":"Failed to deactivate current profile"}'
                exit 0
                ;;
        esac
        sleep "$CMD_GAP"

        # Step 3: Select new profile
        result=$(qcmd "AT+QMBNCFG=\"select\",\"$PROFILE_NAME\"" 2>/dev/null)
        case "$result" in
            *ERROR*)
                qlog_error "Failed to select profile '$PROFILE_NAME': $result"
                echo '{"success":false,"error":"select_failed","detail":"Failed to select MBN profile"}'
                exit 0
                ;;
        esac

        qlog_info "MBN profile '$PROFILE_NAME' selected (reboot required)"
        jq -n '{"success":true,"reboot_required":true}'
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: auto_sel
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "auto_sel" ]; then
        AUTO_SEL_VAL=$(printf '%s' "$POST_DATA" | jq -r 'if has("auto_sel") then (.auto_sel | tostring) else "" end')

        case "$AUTO_SEL_VAL" in
            0|1) ;;
            *)
                echo '{"success":false,"error":"invalid_auto_sel","detail":"auto_sel must be 0 or 1"}'
                exit 0
                ;;
        esac

        qlog_info "Setting MBN auto-select to $AUTO_SEL_VAL"

        result=$(qcmd "AT+QMBNCFG=\"AutoSel\",$AUTO_SEL_VAL" 2>/dev/null)
        case "$result" in
            *ERROR*)
                qlog_error "Failed to set auto-select: $result"
                echo '{"success":false,"error":"autosel_failed","detail":"Failed to set auto-select"}'
                exit 0
                ;;
        esac

        qlog_info "MBN auto-select set to $AUTO_SEL_VAL (reboot required)"
        jq -n '{"success":true,"reboot_required":true}'
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: reboot
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "reboot" ]; then
        qlog_info "Device reboot requested via MBN settings"

        # Return response BEFORE rebooting
        jq -n '{"success":true}'

        # Schedule reboot with delay to ensure HTTP response is flushed
        ( sleep 1 && reboot ) &
        exit 0
    fi

    # --- Unknown action ---
    echo '{"success":false,"error":"invalid_action","detail":"action must be apply_profile, auto_sel, or reboot"}'
    exit 0
fi

# --- Method not allowed -------------------------------------------------------
echo '{"success":false,"error":"method_not_allowed","detail":"Use GET or POST"}'
