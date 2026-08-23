#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/cgi_at.sh
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
qlog_init "cgi_mbn"
cgi_headers
cgi_handle_options

# --- Configuration -----------------------------------------------------------
CMD_GAP=0.2

# =============================================================================
# GET — Fetch MBN auto-select status and profile list
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching MBN settings"

    # --- Compound AT: fetch auto-select status and profile list in one call ---
    # qcmd signals failure via exit status + stderr, never via the literal
    # string "ERROR" on stdout — a lock-timeout or modem ERROR here used to
    # go completely undetected (no rc capture at all) and fall through to
    # "0 profiles" / auto_sel=0 defaults, reporting success:true with
    # fabricated settings. rc is captured on the very next statement, before
    # anything else touches $?.
    raw=$(qcmd 'AT+QMBNCFG="AutoSel";+QMBNCFG="list"' 2>/dev/null)
    rc=$?
    if [ $rc -ne 0 ] || [ -z "$raw" ]; then
        qlog_error "MBN compound query failed (rc=$rc); refusing to fabricate settings"
        cgi_error "read_failed" "Unable to read MBN settings from modem"
        exit 0
    fi

    # --- 1. Auto-select status ---
    auto_sel="0"
    autosel_line=$(printf '%s\n' "$raw" | grep '+QMBNCFG:.*"AutoSel"' | head -1)
    if [ -n "$autosel_line" ]; then
        auto_sel=$(printf '%s' "$autosel_line" | awk -F',' '{
            val = $2; gsub(/[^0-9]/, "", val)
            if (val != "") print val
        }')
        [ -z "$auto_sel" ] && auto_sel="0"
    fi

    # --- 2. Profile list ---
    list_lines=$(printf '%s\n' "$raw" | grep '+QMBNCFG:.*"List"')
    if [ -n "$list_lines" ]; then
        # +QMBNCFG: "List",<idx>,<sel>,<act>,"<name>",<ver>,<date>
        profiles_json=$(printf '%s' "$list_lines" | awk -F',' '
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

    cgi_read_post

    # qcmd write helper — rc + positive OK assertion. qcmd never writes the
    # literal string "ERROR" to stdout (failure = exit status + stderr,
    # empty stdout), so `case "$result" in *ERROR*)` could never match and
    # every write below fell through to "success". A write additionally
    # needs to see the modem's own "OK" — qcmd's third exit arm can return 0
    # with unconfirmed pass-through data for a response containing neither
    # OK nor ERROR. The assertion must match a LINE that IS "OK", not a
    # substring — the echoed command is part of $_aw_out, and this helper is
    # called with $PROFILE_NAME embedded in the command string; the
    # sanitizer only excludes non-alphanumeric characters, so a profile name
    # containing "OK" (e.g. "Rogers-OK") would false-positive a bare `*OK*`
    # glob. Same convention as strip_at_response's `/^OK$/d`. No `local` in
    # this script's existing style — `_aw_` prefixed vars avoid clobbering
    # caller scope and stay readable for the caller's own log line right
    # after the call.
    at_write() {
        _aw_out=$(qcmd "$1" 2>/dev/null)
        _aw_rc=$?
        if [ $_aw_rc -ne 0 ]; then
            return $_aw_rc
        fi
        if printf '%s' "$_aw_out" | tr -d '\r' | grep -qx 'OK'; then
            return 0
        fi
        return 1
    }

    # --- Extract action ---
    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')

    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: apply_profile
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "apply_profile" ]; then
        PROFILE_NAME=$(printf '%s' "$POST_DATA" | jq -r '.profile_name // empty')

        if [ -z "$PROFILE_NAME" ]; then
            cgi_error "missing_profile" "profile_name is required"
            exit 0
        fi

        # Sanitize: only allow safe characters in profile name
        # (alphanumeric, underscores, dots, hyphens, spaces)
        clean=$(printf '%s' "$PROFILE_NAME" | tr -d 'A-Za-z0-9_. -')
        if [ -n "$clean" ]; then
            cgi_error "invalid_profile" "Profile name contains invalid characters"
            exit 0
        fi

        qlog_info "Applying MBN profile: $PROFILE_NAME"

        # Step 1: Disable auto-select
        # NOTE: fixing this failure detection is a real sequencing change —
        # today all three steps run regardless of step 1's outcome; a
        # confirmed step-1 failure now stops steps 2-3 from running at all.
        if ! at_write 'AT+QMBNCFG="AutoSel",0'; then
            qlog_error "Failed to disable auto-select (rc=$_aw_rc): $_aw_out"
            cgi_error "autosel_failed" "Failed to disable auto-select"
            exit 0
        fi
        sleep "$CMD_GAP"

        # Step 2: Deactivate current profile
        if ! at_write 'AT+QMBNCFG="deactivate"'; then
            qlog_error "Failed to deactivate profile (rc=$_aw_rc): $_aw_out"
            cgi_error "deactivate_failed" "Failed to deactivate current profile"
            exit 0
        fi
        sleep "$CMD_GAP"

        # Step 3: Select new profile
        if ! at_write "AT+QMBNCFG=\"select\",\"$PROFILE_NAME\""; then
            qlog_error "Failed to select profile '$PROFILE_NAME' (rc=$_aw_rc): $_aw_out"
            cgi_error "select_failed" "Failed to select MBN profile"
            exit 0
        fi

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
                cgi_error "invalid_auto_sel" "auto_sel must be 0 or 1"
                exit 0
                ;;
        esac

        qlog_info "Setting MBN auto-select to $AUTO_SEL_VAL"

        if ! at_write "AT+QMBNCFG=\"AutoSel\",$AUTO_SEL_VAL"; then
            qlog_error "Failed to set auto-select (rc=$_aw_rc): $_aw_out"
            cgi_error "autosel_failed" "Failed to set auto-select"
            exit 0
        fi

        qlog_info "MBN auto-select set to $AUTO_SEL_VAL (reboot required)"
        jq -n '{"success":true,"reboot_required":true}'
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: reboot
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "reboot" ]; then
        qlog_info "Device reboot requested via MBN settings"

        cgi_reboot_response
    fi

    # --- Unknown action ---
    cgi_error "invalid_action" "action must be apply_profile, auto_sel, or reboot"
    exit 0
fi

# --- Method not allowed -------------------------------------------------------
cgi_method_not_allowed
