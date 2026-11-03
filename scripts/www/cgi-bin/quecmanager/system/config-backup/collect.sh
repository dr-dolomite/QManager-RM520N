#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/config_backup_sections.sh
# collect.sh — Config Backup collector.
# GET                      -> {success, sections:[keys this build can back up]}
# GET ?sections=k1,k2,...  -> {success, header, payload, unavailable:[...]} (plaintext;
#                             the browser encrypts it)

qlog_init "cgi_config_backup_collect"

EVENTS_FILE="/tmp/qmanager_events.json"
MAX_EVENTS=50
if [ -f /usr/lib/qmanager/events.sh ]; then
    . /usr/lib/qmanager/events.sh
else
    append_event() { :; }
fi

cgi_headers
cgi_handle_options

if [ "$REQUEST_METHOD" != "GET" ]; then
    cgi_error "method_not_allowed" "Use GET"
    exit 0
fi

SECTIONS_CSV=$(printf '%s' "$QUERY_STRING" | tr '&' '\n' | sed -n 's/^sections=//p' | head -n 1 | sed 's/%2[Cc]/,/g')

if [ -z "$SECTIONS_CSV" ]; then
    jq -n --arg k "$(cfg_backup_known_sections)" \
        '{success:true, sections:($k | split(" ") | map(select(length > 0)))}'
    exit 0
fi

KEYS=""
for k in $(printf '%s' "$SECTIONS_CSV" | tr ',' ' '); do
    if ! cfg_backup_is_known_section "$k"; then
        cgi_error "unknown_section" "$k"
        exit 0
    fi
    case " $KEYS " in *" $k "*) ;; *) KEYS="$KEYS $k" ;; esac
done

if clash=$(cfg_backup_conflict "$KEYS"); then
    cgi_error "sections_conflict" "$clash"
    exit 0
fi

STATUS_FILE="/tmp/qmanager_status.json"
DEV=$(jq -c '{model:(.device.model // ""), firmware:(.device.firmware // ""), imei:(.device.imei // "")}' \
    "$STATUS_FILE" 2>/dev/null)
[ -n "$DEV" ] || DEV='{"model":"","firmware":"","imei":""}'
QMV=$(head -n 1 /etc/qmanager/VERSION 2>/dev/null)
[ -n "$QMV" ] || QMV="unknown"
CREATED=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# One section that cannot be read is left out and reported, not fatal.
FRAG_DIR=$(mktemp -d /tmp/qmanager_cfgbk_collect.XXXXXX) || {
    cgi_error "collect_failed" "no temp dir"
    exit 0
}
trap 'rm -rf "$FRAG_DIR"' EXIT

INCLUDED=""
UNAVAILABLE=""
for k in $KEYS; do
    if cfg_backup_collect "$k" > "$FRAG_DIR/$k.json" 2>/dev/null &&
        jq -e 'type == "object"' "$FRAG_DIR/$k.json" >/dev/null 2>&1; then
        INCLUDED="$INCLUDED $k"
    else
        qlog_warn "collect: section $k could not be read"
        rm -f "$FRAG_DIR/$k.json"
        UNAVAILABLE="$UNAVAILABLE $k"
    fi
done

if [ -z "$INCLUDED" ]; then
    cgi_error "collect_failed" "No section could be read"
    exit 0
fi

SECTIONS_JSON=$(cd "$FRAG_DIR" && for k in $INCLUDED; do
    jq -c --arg k "$k" '{($k): .}' "$k.json"
done | jq -s -c 'add')

COUNT=$(echo $INCLUDED | wc -w)
append_event "config_backup_collected" "Configuration backup collected ($COUNT sections)" "info" 2>/dev/null

jq -n \
    --arg created "$CREATED" --argjson dev "$DEV" --arg qmv "$QMV" \
    --arg platform "$CFG_BACKUP_PLATFORM" --arg fv "$CFG_BACKUP_FORMAT_VERSION" \
    --arg inc "$INCLUDED" --arg una "$UNAVAILABLE" \
    --argjson sections "$SECTIONS_JSON" \
    '{
        success: true,
        header: {
            magic: "QMBACKUP",
            version: 1,
            format_version: $fv,
            platform: $platform,
            created_at: $created,
            device: ($dev + {qmanager_version: $qmv}),
            sections_included: ($inc | split(" ") | map(select(length > 0)))
        },
        payload: {schema: 1, sections: $sections},
        unavailable: ($una | split(" ") | map(select(length > 0)))
    }'
