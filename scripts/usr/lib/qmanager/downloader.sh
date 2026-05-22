#!/bin/sh
# =============================================================================
# downloader.sh — HTTP(S) download abstraction with curl/wget auto-detection
# =============================================================================
# Picks whichever downloader is present, preferring curl when both exist.
# wget is a first-class fallback, so curl no longer has to be force-installed.
#
# TLS capability is probed only *advisorily* (qm_https_ok): the real download
# is the authoritative test, so a probe miss never blocks a working transport.
#
# Sourced by runtime / OTA scripts:
#   . /usr/lib/qmanager/downloader.sh
#
# NOTE: qmanager-installer.sh and install_rm520n.sh carry an INLINE copy of
# this detection logic because they run before this file is on disk. Keep the
# three copies behaviourally in sync.
# =============================================================================

[ -n "$_QM_DOWNLOADER_LOADED" ] && return 0
_QM_DOWNLOADER_LOADED=1

# Entware-installed curl/wget live in /opt/bin, which is absent from the
# lighttpd CGI PATH and the cron environment. Mirror cgi_base.sh.
export PATH="/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin:$PATH"

# Cached detection results (process lifetime).
QM_DL_TOOL=""
_QM_DL_DETECTED=""
_QM_HTTPS_OK=""

# HTTPS probe target — small, fast, always-HTTPS. Override via env if needed.
QM_HTTPS_PROBE_URL="${QM_HTTPS_PROBE_URL:-https://api.github.com/}"

# -----------------------------------------------------------------------------
# qm_downloader — echo the resolved downloader name ("curl" / "wget"), or ""
# when neither is available. Returns 0 if a tool was found, 1 otherwise.
# Detection is non-network (presence only); curl is preferred.
# -----------------------------------------------------------------------------
qm_downloader() {
    if [ -z "$_QM_DL_DETECTED" ]; then
        if command -v curl >/dev/null 2>&1; then
            QM_DL_TOOL="curl"
        elif command -v wget >/dev/null 2>&1; then
            QM_DL_TOOL="wget"
        else
            QM_DL_TOOL=""
        fi
        _QM_DL_DETECTED=1
    fi
    printf '%s' "$QM_DL_TOOL"
    [ -n "$QM_DL_TOOL" ]
}

# -----------------------------------------------------------------------------
# qm_https_ok — best-effort HTTPS probe. Returns 0 if an HTTPS request to
# GitHub succeeds with the selected downloader.
#
# Advisory only: a failure means "could not confirm" — it may be a TLS-less
# wget OR simply no network. Callers should warn, never abort, on a failure.
# Result is cached for the process lifetime.
# -----------------------------------------------------------------------------
qm_https_ok() {
    if [ -z "$_QM_HTTPS_OK" ]; then
        local tool rc
        tool=$(qm_downloader) || { _QM_HTTPS_OK="no"; return 1; }
        case "$tool" in
            curl) curl -fsS --max-time 8 -o /dev/null "$QM_HTTPS_PROBE_URL" 2>/dev/null ;;
            wget) wget -q -T 8 -O /dev/null "$QM_HTTPS_PROBE_URL" 2>/dev/null ;;
        esac
        rc=$?
        if [ "$rc" -eq 0 ]; then _QM_HTTPS_OK="yes"; else _QM_HTTPS_OK="no"; fi
    fi
    [ "$_QM_HTTPS_OK" = "yes" ]
}

# -----------------------------------------------------------------------------
# qm_download <url> <dest> [timeout] — download url to dest.
# Returns 0 on success. dest is removed on any failure so a partial file or an
# HTTP error page is never mistaken for a good download.
# -----------------------------------------------------------------------------
qm_download() {
    local url="$1" dest="$2" timeout="${3:-120}" tool rc
    tool=$(qm_downloader) || return 1
    case "$tool" in
        curl) curl -fSL --max-time "$timeout" -o "$dest" "$url" ;;
        wget) wget -q -T "$timeout" -O "$dest" "$url" ;;
        *)    return 1 ;;
    esac
    rc=$?
    [ "$rc" -ne 0 ] && rm -f "$dest"
    return "$rc"
}

# -----------------------------------------------------------------------------
# qm_download_headers <url> <body> <header_file> [timeout]
# Like qm_download but also captures response headers for rate-limit checks.
# curl writes them via -D; wget emits them on stderr (indented). Callers must
# parse the header file case-insensitively (the two formats differ).
#
# Unlike qm_download this does NOT fail on HTTP 4xx/5xx — the caller wants the
# error body + headers (e.g. to detect a GitHub 403 rate-limit response).
# -----------------------------------------------------------------------------
qm_download_headers() {
    local url="$1" body="$2" hdr="$3" timeout="${4:-15}" tool rc
    tool=$(qm_downloader) || return 1
    case "$tool" in
        curl)
            # No -f: a 403 page is still wanted for rate-limit detection.
            curl -sL --max-time "$timeout" -o "$body" -D "$hdr" "$url"
            rc=$?
            ;;
        wget)
            # -S (dump response headers) is GNU wget only — BusyBox wget would
            # abort on the unknown option — so detect the variant first.
            if wget --version 2>/dev/null | grep -qi 'GNU Wget'; then
                # GNU wget: -S writes every response header to stderr (incl.
                # X-RateLimit-Reset). No -q here — it would suppress -S too.
                wget -T "$timeout" -S -O "$body" "$url" 2>"$hdr"
            else
                # BusyBox wget has no header-dump option. Run non-quiet so its
                # stderr still carries the HTTP status line on an error
                # ("wget: server returned error: HTTP/1.1 403 Forbidden") —
                # enough for coarse rate-limit detection, just no reset time.
                wget -T "$timeout" -O "$body" "$url" 2>"$hdr"
            fi
            rc=$?
            # A captured "HTTP/" status line means a response was received
            # (200, or a 403 rate-limit) — treat that as success so the caller
            # can inspect the headers. A bare network failure keeps rc != 0.
            grep -qi 'HTTP/' "$hdr" 2>/dev/null && rc=0
            ;;
        *)
            return 1
            ;;
    esac
    return "$rc"
}
