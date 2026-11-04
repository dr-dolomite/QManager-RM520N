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
# discord_dispatch_message <message> [trigger] [recipient]
# =============================================================================
# Fire-and-forget: drops one JSON file into the spool dir the daemon drains in
# name order, then returns. The daemon performs the Discord call and appends
# the NDJSON log row itself, so a caller logs only its own hand-off failure.
# Returns: 0 = daemon running and entry spooled; 1 = otherwise.
_DA_SPOOL="${_DA_SPOOL:-/tmp/qmanager_discord_spool}"
_DA_SPOOL_MAX=50
_DA_SEQ=0

discord_dispatch_message() {
    local message="$1" trigger="${2:-alert}" recipient="${3:-discord}"
    local f n=0 tmp name

    if ! da_is_running; then
        qlog_warn "Discord alerts: dispatch skipped — qmanager_discord is not running"
        return 1
    fi

    # Created only by qmanager_setup / the daemon (root); a dir made here would be untrusted and removed.
    if [ -L "$_DA_SPOOL" ] || [ ! -d "$_DA_SPOOL" ]; then
        qlog_error "Discord alerts: spool dir $_DA_SPOOL is missing"
        return 1
    fi

    for f in "$_DA_SPOOL"/*.json; do
        [ -e "$f" ] && n=$((n + 1))
    done
    if [ "$n" -ge "$_DA_SPOOL_MAX" ]; then
        qlog_warn "Discord alerts: dispatch refused — spool holds $n entries (daemon not draining)"
        return 1
    fi

    _DA_SEQ=$((_DA_SEQ + 1))
    tmp="$_DA_SPOOL/.tmp.$$.$_DA_SEQ"
    if ! jq -n --arg message "$message" --arg trigger "$trigger" --arg recipient "$recipient" \
        '{message:$message, trigger:$trigger, recipient:$recipient}' > "$tmp" 2>/dev/null; then
        rm -f "$tmp"
        qlog_error "Discord alerts: failed to build spool payload"
        return 1
    fi
    # ln fails if the name exists (a subshell shares $$ and _DA_SEQ), so bump and retry.
    # Zero-padded epoch keeps lexical order = send order, even at 1970 boot-time clocks.
    n=0
    while [ "$n" -lt 20 ]; do
        n=$((n + 1))
        name=$(printf '%010d-%s-%04d.json' "$(date +%s)" "$$" "$_DA_SEQ")
        if ln "$tmp" "$_DA_SPOOL/$name" 2>/dev/null; then
            rm -f "$tmp"
            return 0
        fi
        _DA_SEQ=$((_DA_SEQ + 1))
    done
    rm -f "$tmp"
    qlog_error "Discord alerts: failed to write spool entry in $_DA_SPOOL"
    return 1
}
