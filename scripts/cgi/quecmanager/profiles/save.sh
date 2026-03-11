#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# save.sh — CGI Endpoint: Create or Update SIM Profile
# =============================================================================
# Accepts a JSON profile definition via POST body. If the JSON contains an
# "id" field matching an existing profile, it updates. Otherwise, it creates.
#
# Enforces the 10-profile limit on create.
#
# Endpoint: POST /cgi-bin/quecmanager/profiles/save.sh
# Request body: Profile JSON (see architecture doc §4.1)
# Response: {"success":true,"id":"<profile_id>"}
#       or: {"success":false,"error":"...","detail":"..."}
#
# Install location: /www/cgi-bin/quecmanager/profiles/save.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_profile_save"
cgi_headers
cgi_handle_options

# --- Source profile manager library ------------------------------------------
. /usr/lib/qmanager/profile_mgr.sh

# --- Validate method ---------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

# --- Read POST body ----------------------------------------------------------
cgi_read_post

qlog_info "Profile save request received (${CONTENT_LENGTH} bytes)"

# --- Pass to profile_save (reads from stdin) ---------------------------------
echo "$POST_DATA" | profile_save
