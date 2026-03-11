#!/bin/sh
# =============================================================================
# profile_mgr.sh — QManager SIM Profile Manager Library
# =============================================================================
# A sourceable library providing profile CRUD operations, validation,
# AT command conversion helpers, and active profile management.
#
# This is a LIBRARY — no persistent process, no polling.
# CGI scripts and the apply script source it and call functions directly.
#
# Dependencies: qlog_* functions (from qlog.sh)
# Install location: /usr/lib/qmanager/profile_mgr.sh
#
# Usage:
#   . /usr/lib/qmanager/profile_mgr.sh
#   profile_list        → JSON array of profile summaries
#   profile_get <id>    → Full profile JSON
#   profile_save        → Create/update profile (reads JSON from stdin)
#   profile_delete <id> → Remove profile + cleanup
#   profile_count       → Current number of profiles
#   get_active_profile  → Read active profile ID
#   set_active_profile <id> → Write active profile ID
#   clear_active_profile    → Clear active profile
# =============================================================================

# --- Configuration -----------------------------------------------------------
PROFILE_DIR="/etc/qmanager/profiles"
ACTIVE_PROFILE_FILE="/etc/qmanager/active_profile"
PROFILE_APPLY_PID_FILE="/tmp/qmanager_profile_apply.pid"
MAX_PROFILES=10

# Ensure profile directory exists
mkdir -p "$PROFILE_DIR" 2>/dev/null

# --- Profile ID Generation ---------------------------------------------------
# Format: p_<unix_timestamp>_<3-char-hex>
# Uses /dev/urandom with hexdump (BusyBox-safe).
_generate_profile_id() {
    local ts suffix
    ts=$(date +%s)
    suffix=$(hexdump -n 2 -e '"%04x"' /dev/urandom 2>/dev/null | cut -c1-3)
    # Fallback if hexdump fails
    [ -z "$suffix" ] && suffix=$(printf '%03x' $$)
    echo "p_${ts}_${suffix}"
}

# --- Validation Helpers -------------------------------------------------------

# Validate IMEI: exactly 15 digits
_validate_imei() {
    case "$1" in
        [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) return 0 ;;
        '') return 0 ;; # Empty IMEI allowed (means "don't change")
        *) return 1 ;;
    esac
}

# Validate TTL/HL: integer 0-255
_validate_ttl_hl() {
    case "$1" in
        ''|*[!0-9]*) return 1 ;;
        *)
            [ "$1" -ge 0 ] && [ "$1" -le 255 ] 2>/dev/null && return 0
            return 1
            ;;
    esac
}

# Validate PDP type
_validate_pdp_type() {
    case "$1" in
        IP|IPV6|IPV4V6) return 0 ;;
        *) return 1 ;;
    esac
}

# Validate CID: 1-15
_validate_cid() {
    case "$1" in
        ''|*[!0-9]*) return 1 ;;
        *)
            [ "$1" -ge 1 ] && [ "$1" -le 15 ] 2>/dev/null && return 0
            return 1
            ;;
    esac
}

# =============================================================================
# Profile CRUD Operations
# =============================================================================

# --- profile_count -----------------------------------------------------------
# Returns the number of profile files in the profiles directory.
profile_count() {
    local count=0
    for f in "$PROFILE_DIR"/p_*.json; do
        [ -f "$f" ] && count=$((count + 1))
    done
    echo "$count"
}

# --- profile_list ------------------------------------------------------------
# Returns a JSON object with a profiles array (summaries) and active_profile_id.
# Output: {"profiles":[...],"active_profile_id":"..."}
profile_list() {
    local active_id profiles_json
    active_id=$(get_active_profile)

    # Collect matching profile files
    local files=""
    for f in "$PROFILE_DIR"/p_*.json; do
        [ -f "$f" ] && files="$files $f"
    done

    # Build profiles array: extract summary fields from each file
    if [ -n "$files" ]; then
        profiles_json=$(jq -s '[.[] | {id, name, mno, sim_iccid, created_at, updated_at}]' $files 2>/dev/null)
        [ -z "$profiles_json" ] && profiles_json="[]"
    else
        profiles_json="[]"
    fi

    # Build final response
    if [ -n "$active_id" ]; then
        jq -n --argjson profiles "$profiles_json" --arg active "$active_id" \
            '{profiles: $profiles, active_profile_id: $active}'
    else
        jq -n --argjson profiles "$profiles_json" \
            '{profiles: $profiles, active_profile_id: null}'
    fi
}

# --- profile_get <id> --------------------------------------------------------
# Returns the full profile JSON for a given ID.
# Outputs the raw file content (it's already valid JSON).
# Returns 1 if profile not found.
profile_get() {
    local id="$1"
    local file="$PROFILE_DIR/${id}.json"

    if [ ! -f "$file" ]; then
        qlog_warn "Profile not found: $id" 2>/dev/null
        return 1
    fi

    cat "$file"
}

# --- profile_save ------------------------------------------------------------
# Creates or updates a profile. Reads JSON from stdin.
# On create: generates ID, sets created_at/updated_at, enforces 10-limit.
# On update: preserves ID + created_at, updates updated_at.
# Output: {"success":true,"id":"<profile_id>"} on stdout.
# Returns 1 on validation failure (error JSON on stdout).
profile_save() {
    local input
    input=$(cat)

    if [ -z "$input" ]; then
        printf '{"success":false,"error":"empty_input","detail":"No profile data provided"}\n'
        return 1
    fi

    # --- Extract all fields from input JSON ---
    local name mno sim_iccid
    local apn_cid apn_name apn_pdp_type
    local imei ttl hl
    local existing_id

    name=$(printf '%s' "$input" | jq -r '.name // empty')
    mno=$(printf '%s' "$input" | jq -r '.mno // empty')
    sim_iccid=$(printf '%s' "$input" | jq -r '.sim_iccid // empty')
    existing_id=$(printf '%s' "$input" | jq -r '.id // empty')

    # APN settings — frontend sends these as flat keys
    apn_cid=$(printf '%s' "$input" | jq -r '(.cid) | if . == null then empty else tostring end')
    apn_name=$(printf '%s' "$input" | jq -r '.apn_name // empty')
    apn_pdp_type=$(printf '%s' "$input" | jq -r '.pdp_type // empty')

    imei=$(printf '%s' "$input" | jq -r '.imei // empty')
    ttl=$(printf '%s' "$input" | jq -r '(.ttl) | if . == null then empty else tostring end')
    hl=$(printf '%s' "$input" | jq -r '(.hl) | if . == null then empty else tostring end')
    # --- Apply defaults for optional fields ---
    [ -z "$apn_cid" ] && apn_cid=1
    [ -z "$apn_pdp_type" ] && apn_pdp_type="IPV4V6"
    [ -z "$ttl" ] && ttl=0
    [ -z "$hl" ] && hl=0

    # --- Validation ---
    local errors=""

    if [ -z "$name" ]; then
        errors="${errors}Profile name is required. "
    fi

    if ! _validate_cid "$apn_cid"; then
        errors="${errors}CID must be 1-15. "
    fi

    if [ -n "$apn_pdp_type" ] && ! _validate_pdp_type "$apn_pdp_type"; then
        errors="${errors}Invalid PDP type (must be IP, IPV6, or IPV4V6). "
    fi

    if [ -n "$imei" ] && ! _validate_imei "$imei"; then
        errors="${errors}IMEI must be exactly 15 digits. "
    fi

    if ! _validate_ttl_hl "$ttl"; then
        errors="${errors}TTL must be 0-255. "
    fi

    if ! _validate_ttl_hl "$hl"; then
        errors="${errors}HL must be 0-255. "
    fi

    if [ -n "$errors" ]; then
        jq -n --arg detail "$errors" \
            '{success: false, error: "validation_failed", detail: $detail}'
        return 1
    fi

    # --- Determine if create or update ---
    local id created_at updated_at
    updated_at=$(date +%s)

    if [ -n "$existing_id" ] && [ -f "$PROFILE_DIR/${existing_id}.json" ]; then
        # UPDATE: preserve ID and created_at
        id="$existing_id"
        created_at=$(jq -r '(.created_at) | if . == null then empty else tostring end' "$PROFILE_DIR/${id}.json" 2>/dev/null)
        [ -z "$created_at" ] && created_at="$updated_at"
        qlog_info "Updating profile: $id ($name)" 2>/dev/null
    else
        # CREATE: enforce limit, generate ID
        local count
        count=$(profile_count)
        if [ "$count" -ge "$MAX_PROFILES" ]; then
            jq -n --argjson max "$MAX_PROFILES" \
                '{"success":false,"error":"limit_reached","detail":("Maximum " + ($max | tostring) + " profiles allowed")}'
            return 1
        fi
        id=$(_generate_profile_id)
        created_at="$updated_at"
        qlog_info "Creating profile: $id ($name)" 2>/dev/null
    fi

    # --- Write profile JSON to temp file, then atomic mv ---
    local tmp_file="$PROFILE_DIR/${id}.json.tmp"
    local final_file="$PROFILE_DIR/${id}.json"

    jq -n \
        --arg id "$id" \
        --arg name "$name" \
        --arg mno "$mno" \
        --arg sim_iccid "$sim_iccid" \
        --argjson created_at "$created_at" \
        --argjson updated_at "$updated_at" \
        --argjson apn_cid "$apn_cid" \
        --arg apn_name "$apn_name" \
        --arg apn_pdp_type "$apn_pdp_type" \
        --arg imei "$imei" \
        --argjson ttl "$ttl" \
        --argjson hl "$hl" \
        '{
            id: $id,
            name: $name,
            mno: $mno,
            sim_iccid: $sim_iccid,
            created_at: $created_at,
            updated_at: $updated_at,
            settings: {
                apn: {
                    cid: $apn_cid,
                    name: $apn_name,
                    pdp_type: $apn_pdp_type
                },
                imei: $imei,
                ttl: $ttl,
                hl: $hl
            }
        }' > "$tmp_file" || {
        qlog_error "jq failed writing profile: $id" 2>/dev/null
        rm -f "$tmp_file"
        printf '{"success":false,"error":"write_failed","detail":"Failed to generate profile JSON"}\n'
        return 1
    }

    # Atomic replace
    mv "$tmp_file" "$final_file"

    if [ $? -ne 0 ]; then
        qlog_error "Failed to write profile: $id" 2>/dev/null
        rm -f "$tmp_file"
        printf '{"success":false,"error":"write_failed","detail":"Failed to save profile to disk"}\n'
        return 1
    fi

    jq -n --arg id "$id" '{success: true, id: $id}'
    return 0
}

# --- profile_delete <id> -----------------------------------------------------
# Removes a profile file. Clears active_profile if it was the deleted one.
# Returns 1 if profile not found.
profile_delete() {
    local id="$1"

    if [ -z "$id" ]; then
        printf '{"success":false,"error":"no_id","detail":"Profile ID is required"}\n'
        return 1
    fi

    local file="$PROFILE_DIR/${id}.json"

    if [ ! -f "$file" ]; then
        printf '{"success":false,"error":"not_found","detail":"Profile not found"}\n'
        return 1
    fi

    # Remove the file
    rm -f "$file"

    if [ $? -ne 0 ]; then
        qlog_error "Failed to delete profile: $id" 2>/dev/null
        printf '{"success":false,"error":"delete_failed","detail":"Failed to remove profile file"}\n'
        return 1
    fi

    # If this was the active profile, clear it
    local active_id
    active_id=$(get_active_profile)
    if [ "$active_id" = "$id" ]; then
        clear_active_profile
        qlog_info "Cleared active profile (deleted: $id)" 2>/dev/null
    fi

    qlog_info "Deleted profile: $id" 2>/dev/null
    jq -n --arg id "$id" '{success: true, id: $id}'
    return 0
}

# =============================================================================
# Active Profile Management
# =============================================================================

# Returns the currently active profile ID, or empty string if none.
get_active_profile() {
    if [ -f "$ACTIVE_PROFILE_FILE" ]; then
        local id
        id=$(cat "$ACTIVE_PROFILE_FILE" 2>/dev/null | tr -d ' \n\r')
        # Verify the profile still exists
        if [ -n "$id" ] && [ -f "$PROFILE_DIR/${id}.json" ]; then
            echo "$id"
        fi
    fi
}

# Set the active profile ID.
set_active_profile() {
    local id="$1"
    if [ -z "$id" ]; then
        return 1
    fi
    # Verify profile exists
    if [ ! -f "$PROFILE_DIR/${id}.json" ]; then
        qlog_warn "Cannot set active profile — not found: $id" 2>/dev/null
        return 1
    fi
    printf '%s' "$id" > "$ACTIVE_PROFILE_FILE"
    qlog_info "Active profile set: $id" 2>/dev/null
}

# Clear the active profile.
clear_active_profile() {
    rm -f "$ACTIVE_PROFILE_FILE"
}

# =============================================================================
# AT Command Conversion Helpers
# =============================================================================

# NOTE: mode_to_at() and at_to_mode() removed — band locking and network mode
# are now owned by Connection Scenarios, not SIM Profiles. These helpers will
# be reimplemented in the Connection Scenarios library when that feature is built.

# =============================================================================
# PID File Lock (Profile Apply Singleton)
# =============================================================================

# profile_check_lock
# Check if a profile apply process is currently running.
# Returns 0 if free (stale PID cleaned), 1 if locked.
# On lock, sets global: _profile_lock_pid
profile_check_lock() {
    if [ -f "$PROFILE_APPLY_PID_FILE" ]; then
        _profile_lock_pid=$(cat "$PROFILE_APPLY_PID_FILE" 2>/dev/null)
        if [ -n "$_profile_lock_pid" ] && kill -0 "$_profile_lock_pid" 2>/dev/null; then
            return 1
        fi
        rm -f "$PROFILE_APPLY_PID_FILE"
    fi
    _profile_lock_pid=""
    return 0
}

# profile_acquire_lock
# Check + acquire the profile apply lock (writes $$ to PID file).
# Returns 0 on success, 1 if already locked.
profile_acquire_lock() {
    profile_check_lock || return 1
    echo $$ > "$PROFILE_APPLY_PID_FILE" || {
        qlog_error "Failed to write PID file" 2>/dev/null
        return 1
    }
    return 0
}
