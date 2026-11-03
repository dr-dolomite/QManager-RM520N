#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# logs.sh — CGI Endpoint: System Log Viewer & Management (GET + POST)
# =============================================================================
# GET:  Parses /tmp/qmanager.log (+ rotated files), applies filters, returns
#       structured JSON with entries, stats, and available component list.
#
# Query parameters (GET):
#   lines            — Max entries to return (default: 100)
#   level            — Minimum log level: DEBUG|INFO|WARN|ERROR
#   component        — Filter by component name (exact match)
#   search           — Case-insensitive text search across entire line
#   include_rotated  — 1 to include rotated log files (default: 0)
#
# POST actions:
#   {"action":"clear"}  — Truncate current log, remove rotated files
#   {"action":"status"} — Return log file statistics only
#
# Endpoint: GET/POST /cgi-bin/quecmanager/system/logs.sh
# Install location: /www/cgi-bin/quecmanager/system/logs.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_logs"
cgi_headers
cgi_handle_options

# --- Constants ---------------------------------------------------------------
LOG_FILE="/tmp/qmanager.log"
MAX_ROTATED=2

# --- Helpers -----------------------------------------------------------------

# Set variable $2 to query parameter $1, decoded like the old echo|grep|sed pipeline. No fork.
qs_param() {
    _qs_v=""
    _qs_ifs=$IFS; IFS='&'; set -f
    for _qs_kv in $QUERY_STRING; do
        case "$_qs_kv" in "$1="*) _qs_v=${_qs_kv#"$1="}; break ;; esac
    done
    IFS=$_qs_ifs; set +f
    _qs_v=${_qs_v//+/ }; _qs_v=${_qs_v//%20/ }; _qs_v=${_qs_v//%2F/\/}; _qs_v=${_qs_v//%3A/:}
    eval "$2=\$_qs_v"
}

# Gather log file paths in order (oldest rotated first, then current)
get_log_sources() {
    local include_rotated="$1"
    if [ "$include_rotated" = "1" ]; then
        i=$MAX_ROTATED
        while [ "$i" -ge 1 ]; do
            [ -f "${LOG_FILE}.${i}" ] && echo "${LOG_FILE}.${i}"
            i=$((i - 1))
        done
    fi
    [ -f "$LOG_FILE" ] && echo "$LOG_FILE"
}

# Get log file statistics
get_stats() {
    local size_kb=0
    local line_count=0
    local rotated=0

    if [ -f "$LOG_FILE" ]; then
        local size_bytes
        size_bytes=$(wc -c < "$LOG_FILE" 2>/dev/null)
        size_kb=$((size_bytes / 1024))
        line_count=$(wc -l < "$LOG_FILE" 2>/dev/null)
    fi

    i=1
    while [ "$i" -le "$MAX_ROTATED" ]; do
        [ -f "${LOG_FILE}.${i}" ] && rotated=$((rotated + 1))
        i=$((i + 1))
    done

    jq -n \
        --argjson size_kb "$size_kb" \
        --argjson lines "$line_count" \
        --argjson rotated "$rotated" \
        '{current_size_kb: $size_kb, current_lines: $lines, rotated_files: $rotated}'
}

# One awk pass over the sources: filtered tail of entries, component list and stats,
# printed in jq's pretty-print format; body = old jq pipeline's except cases listed in logs.md.
render_logs() {
    local sources="$1"
    local size_kb=0 line_count=0 rotated=0

    if [ -f "$LOG_FILE" ]; then
        set -- $(wc -lc < "$LOG_FILE" 2>/dev/null)
        line_count=${1:-0}; size_kb=$(( ${2:-0} / 1024 ))
    fi
    i=1
    while [ "$i" -le "$MAX_ROTATED" ]; do
        [ -f "${LOG_FILE}.${i}" ] && rotated=$((rotated + 1))
        i=$((i + 1))
    done

    # shellcheck disable=SC2086
    awk -v max_lines="$PARAM_LINES" \
        -v filter_level="$PARAM_LEVEL" \
        -v filter_component="$PARAM_COMPONENT" \
        -v filter_search="$PARAM_SEARCH" \
        -v size_kb="$size_kb" -v line_count="$line_count" -v rotated="$rotated" '
    # utf8only = 1: repair invalid UTF-8 but leave ASCII unescaped.
    function esc(s, utf8only,    out, i, n, c, b, len, bad, cp, j, ch) {
        if (s !~ HI && (utf8only || (!index(s, "\\") && !index(s, "\"") && s !~ CTL))) return s
        out = ""; n = length(s); i = 1
        while (i <= n) {
            c = substr(s, i, 1); b = O[c]
            if (b < 128) { if (!utf8only && (c in E)) c = E[c]; out = out c; i++; continue }
            # Invalid UTF-8 -> one U+FFFD per bad sequence, as jq 1.7 jvp_utf8_next decides it.
            len = 1; bad = 1
            if (b >= 194 && b <= 244) {
                bad = 0
                if (b < 224) { len = 2; cp = b - 192 } else if (b < 240) { len = 3; cp = b - 224 } else { len = 4; cp = b - 240 }
                # A sequence cut off by the end of the field takes the rest of the field, ASCII too.
                if (i + len - 1 > n) { bad = 1; len = n - i + 1 }
                for (j = 1; !bad && j < len; j++) {
                    ch = O[substr(s, i + j, 1)]
                    if (ch < 128 || ch > 191) { bad = 1; len = j; break }
                    cp = cp * 64 + ch - 128
                }
                if (!bad && (cp < FIRST[len] || (cp >= 55296 && cp <= 57343) || cp > 1114111)) bad = 1
            }
            if (bad) c = FFFD; else c = substr(s, i, len)
            out = out c; i += len
        }
        return out
    }
    BEGIN {
        lvl["DEBUG"] = 0
        lvl["INFO"]  = 1
        lvl["WARN"]  = 2
        lvl["ERROR"] = 3
        min_level = 0
        if (filter_level != "" && filter_level in lvl) {
            min_level = lvl[filter_level]
        }
        count = 0
        ncomp = 0
        ml = max_lines + 0
        filter_search_lower = tolower(filter_search)
        # jq string escapes: \\ \" \b \t \n \f \r, other C0 and DEL as \u00xx
        for (i = 1; i < 32; i++) E[sprintf("%c", i)] = sprintf("\\u%04x", i)
        E[sprintf("%c", 8)] = "\\b"; E[sprintf("%c", 9)] = "\\t"; E[sprintf("%c", 10)] = "\\n"
        E[sprintf("%c", 12)] = "\\f"; E[sprintf("%c", 13)] = "\\r"
        E[sprintf("%c", 127)] = "\\u007f"; E["\\"] = "\\\\"; E["\""] = "\\\""
        CTL = "[" sprintf("%c", 1) "-" sprintf("%c", 31) sprintf("%c", 127) "]"
        HI = "[" sprintf("%c", 128) "-" sprintf("%c", 255) "]"
        for (i = 1; i < 256; i++) O[sprintf("%c", i)] = i
        FIRST[2] = 128; FIRST[3] = 2048; FIRST[4] = 65536
        FFFD = sprintf("%c%c%c", 239, 191, 189)
    }
    # Same matches as: grep -h -o "\[[^:]*:" | sed "s/\[//;s/:$//" | sort -u
    index($0, "[") {
        s = $0
        while (match(s, /\[[^:]*:/)) {
            c = substr(s, RSTART + 1, RLENGTH - 2)
            if (!(c in seen)) { seen[c] = 1; if (c != "") comp[++ncomp] = c }
            s = substr(s, RSTART + RLENGTH)
        }
    }
    /^\[/ {
        ts_end = index($0, "]")
        if (ts_end == 0) next
        timestamp = substr($0, 2, ts_end - 2)

        rest = substr($0, ts_end + 2)

        # First whitespace-separated word, as split(rest, parts, /[[:space:]]+/) gave parts[1].
        if (match(rest, /[[:space:]]/)) level = substr(rest, 1, RSTART - 1); else level = rest

        if (!(level in lvl)) next
        if (lvl[level] < min_level) next

        comp_start = index(rest, "[")
        comp_end_pos = index(rest, "]")
        if (comp_start == 0 || comp_end_pos == 0) next
        comp_pid = substr(rest, comp_start + 1, comp_end_pos - comp_start - 1)

        cp_sep = index(comp_pid, ":")
        if (cp_sep > 0) {
            component = substr(comp_pid, 1, cp_sep - 1)
            pid = substr(comp_pid, cp_sep + 1)
        } else {
            component = comp_pid
            pid = ""
        }

        if (filter_component != "" && component != filter_component) next

        message = substr(rest, comp_end_pos + 2)
        sub(/^[[:space:]]+/, "", message)

        if (filter_search != "") {
            test_line = tolower($0)
            if (index(test_line, filter_search_lower) == 0) next
        }

        count++
        if (ml < 1) next
        # Ring buffer of the newest ml entries (the old pass kept every entry).
        k = count % ml
        timestamps[k] = timestamp
        levels[k] = level
        components[k] = component
        pids[k] = pid
        messages[k] = message
    }
    END {
        start = 1
        if (count > ml) start = count - ml + 1
        printf "{\n  \"success\": true,\n"
        if (start > count) {
            printf "  \"entries\": [],\n  \"total\": 0,\n"
        } else {
            printf "  \"entries\": [\n"
            for (i = start; i <= count; i++) {
                k = i % ml
                printf "    {\n      \"timestamp\": \"%s\",\n      \"level\": \"%s\",\n      \"component\": \"%s\",\n      \"pid\": \"%s\",\n      \"message\": \"%s\"\n    }%s\n", \
                    esc(timestamps[k]), esc(levels[k]), esc(components[k]), esc(pids[k]), esc(messages[k]), (i < count ? "," : "")
            }
            # total = entries - 1: the old `wc -l` over the NDJSON lost the last newline (docs/reference/logs.md).
            printf "  ],\n  \"total\": %d,\n", count - start
        }
        printf "  \"stats\": {\n    \"current_size_kb\": %d,\n    \"current_lines\": %d,\n    \"rotated_files\": %d\n  },\n", size_kb, line_count, rotated
        for (i = 2; i <= ncomp; i++) {
            c = comp[i]
            for (j = i - 1; j >= 1 && comp[j] > c; j--) comp[j + 1] = comp[j]
            comp[j + 1] = c
        }
        # Old jq -R decoded each "name\n" line alone, so a cut-off sequence ate the newline and joined two names.
        acc = ""; m = 0
        for (i = 1; i <= ncomp; i++) {
            acc = acc esc(comp[i] "\n", 1)
            while ((p = index(acc, "\n")) > 0) { if (p > 1) outc[++m] = substr(acc, 1, p - 1); acc = substr(acc, p + 1) }
        }
        if (acc != "") outc[++m] = acc
        if (m == 0) {
            printf "  \"available_components\": []\n}\n"
        } else {
            printf "  \"available_components\": [\n"
            for (i = 1; i <= m; i++) printf "    \"%s\"%s\n", esc(outc[i]), (i < m ? "," : "")
            printf "  ]\n}\n"
        }
    }' $sources
}

# =============================================================================
# GET — Read and filter logs
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qs_param lines PARAM_LINES
    qs_param level PARAM_LEVEL
    qs_param component PARAM_COMPONENT
    qs_param search PARAM_SEARCH
    qs_param include_rotated PARAM_INCLUDE_ROTATED

    # Defaults and validation
    PARAM_LINES="${PARAM_LINES:-100}"
    PARAM_INCLUDE_ROTATED="${PARAM_INCLUDE_ROTATED:-0}"
    # Sanitize lines param — must be numeric
    case "$PARAM_LINES" in
        *[!0-9]*) PARAM_LINES=100 ;;
    esac

    qlog_debug "Reading logs: lines=$PARAM_LINES level=$PARAM_LEVEL component=$PARAM_COMPONENT search=$PARAM_SEARCH"

    SOURCES=$(get_log_sources "$PARAM_INCLUDE_ROTATED")

    if [ -z "$SOURCES" ]; then
        # No log files exist yet
        jq -n '{
            success: true,
            entries: [],
            total: 0,
            stats: {current_size_kb: 0, current_lines: 0, rotated_files: 0},
            available_components: []
        }'
        exit 0
    fi

    render_logs "$SOURCES"
    exit 0
fi

# =============================================================================
# POST — Actions (clear, status)
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    action=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')

    case "$action" in
        clear)
            qlog_info "Clearing all log files"
            [ -f "$LOG_FILE" ] && : > "$LOG_FILE"
            i=1
            while [ "$i" -le "$MAX_ROTATED" ]; do
                rm -f "${LOG_FILE}.${i}"
                i=$((i + 1))
            done
            qlog_info "Log files cleared"
            cgi_success
            ;;
        status)
            stats=$(get_stats)
            printf '%s' "$stats" | jq '{success: true} + .'
            ;;
        *)
            cgi_error "invalid_action" "Action must be: clear or status"
            ;;
    esac
    exit 0
fi

# --- Method not allowed -------------------------------------------------------
cgi_method_not_allowed
