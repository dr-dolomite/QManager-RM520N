#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# diagnostics.sh: POST {"action":"capture"} runs qmanager_debug_report and returns {"success":true,"filename","content"}.
# Errors: report_tool_missing | capture_failed | unknown_action | method_not_allowed. Auth via cgi_base.sh.

qlog_init "cgi_diagnostics"
cgi_headers
cgi_handle_options

REPORT_TOOL="/usr/bin/qmanager_debug_report"

if [ "$REQUEST_METHOD" = "POST" ]; then

    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r 'if .action == null then empty else .action end')

    if [ "$ACTION" = "capture" ]; then
        qlog_info "Diagnostic capture requested"

        if [ ! -x "$REPORT_TOOL" ]; then
            qlog_error "report tool missing or not executable: $REPORT_TOOL"
            cgi_error "report_tool_missing" "Diagnostic report tool is not installed"
            exit 0
        fi

        # The tool prints the artifact path as its LAST stdout line. Capture all
        # stdout, then take the final non-empty line as the path.
        TOOL_OUT=$("$REPORT_TOOL" 2>/dev/null)
        ARTIFACT=$(printf '%s\n' "$TOOL_OUT" | sed '/^$/d' | tail -n 1)

        if [ -z "$ARTIFACT" ] || [ ! -f "$ARTIFACT" ]; then
            qlog_error "capture failed — no artifact produced (last line: '$ARTIFACT')"
            cgi_error "capture_failed" "Diagnostic report could not be generated"
            exit 0
        fi

        qlog_info "Diagnostic report ready: $ARTIFACT"

        # --rawfile embeds the report as a raw string (no JSON parsing); the tool
        # already byte-sanitized it.
        jq -n \
            --arg filename "$ARTIFACT" \
            --rawfile content "$ARTIFACT" \
            '{success:true, filename:$filename, content:$content}'
        exit 0
    fi

    cgi_error "unknown_action" "Unknown action: $ACTION"
    exit 0
fi

# Method not allowed
cgi_error "method_not_allowed" "Only POST is supported"
