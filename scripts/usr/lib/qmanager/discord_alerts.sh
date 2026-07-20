#!/bin/sh
# discord_alerts.sh — Discord Bot shell helper
# Sourced by CGI scripts for sending test DMs via the bot status file.
# Install location: /usr/lib/qmanager/discord_alerts.sh

[ -n "$_DISCORD_ALERTS_LOADED" ] && return 0
_DISCORD_ALERTS_LOADED=1

_DA_CONFIG="/etc/qmanager/discord_bot.json"
_DA_STATUS="/tmp/qmanager_discord_status.json"
_DA_LOG="/tmp/qmanager_discord_log.json"
_DA_RELOAD_FLAG="/tmp/qmanager_discord_reload"

da_is_installed() {
    [ -x /usr/bin/qmanager_discord ]
}

da_is_running() {
    # svc_is_running comes from platform.sh (sourced via cgi_base.sh) — uses sudo
    # for the www-data CGI context. But the poller drives real alerts through
    # alert_engine.sh and does NOT source platform.sh, so fall back to a pgrep
    # that works standalone. (The old /run/qmanager-discord.pid check was dead:
    # qmanager-discord.service is Type=simple with no PIDFile=, so nothing ever
    # created that file — every poller-fired Discord alert silently failed.)
    if command -v svc_is_running >/dev/null 2>&1; then
        svc_is_running qmanager_discord
        return $?
    fi
    pgrep -f '/usr/bin/qmanager_discord' >/dev/null 2>&1
}

da_is_connected() {
    [ -f "$_DA_STATUS" ] || return 1
    jq -r '.connected // false' "$_DA_STATUS" 2>/dev/null | grep -q "^true$"
}

da_touch_reload() {
    touch "$_DA_RELOAD_FLAG" 2>/dev/null
}

da_bot_status_json() {
    if [ -f "$_DA_STATUS" ]; then
        cat "$_DA_STATUS"
    else
        printf '{"connected":false,"error":"not_started"}'
    fi
}

# =============================================================================
# discord_dispatch_message — Hand a message off to the qmanager_discord
# daemon for delivery (used by alert_engine.sh and the CGI's send_test)
# =============================================================================
# Fire-and-forget: atomically writes the command file the daemon polls, then
# returns. The daemon (not this shell code) performs the actual Discord API
# call and, on success, appends the NDJSON log entry itself — this function
# only reports whether the hand-off reached a running daemon, so a caller
# whose write fails (or who finds no daemon running) can log a "failed"
# attempt of its own, since nothing else ever will.
# Returns: 0 = daemon running and command file written; 1 = otherwise.
_DA_CMD_FILE="/tmp/qmanager_discord_cmd"

discord_dispatch_message() {
    local message="$1" tmp

    if ! da_is_running; then
        qlog_warn "Discord alerts: dispatch skipped — qmanager_discord is not running"
        return 1
    fi

    tmp="${_DA_CMD_FILE}.tmp.$$"
    if ! jq -n --arg message "$message" '{message:$message}' > "$tmp" 2>/dev/null; then
        rm -f "$tmp"
        qlog_error "Discord alerts: failed to build command payload"
        return 1
    fi
    if ! mv "$tmp" "$_DA_CMD_FILE" 2>/dev/null; then
        rm -f "$tmp"
        qlog_error "Discord alerts: failed to write command file $_DA_CMD_FILE"
        return 1
    fi
    return 0
}
