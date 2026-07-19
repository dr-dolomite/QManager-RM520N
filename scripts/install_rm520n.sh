#!/bin/bash
# =============================================================================
# QManager Installation Script — RM520N-GL
# =============================================================================
# Installs QManager frontend and backend onto the RM520N-GL modem,
# replacing SimpleAdmin as the web management interface.
#
# Expected archive layout (tar.gz extracted to /tmp/qmanager_install/):
#   out/                    — Next.js static export (frontend)
#   scripts/                — Backend shell scripts
#     etc/systemd/system/   — Systemd unit files
#     etc/sudoers.d/        — Sudoers rules
#     etc/qmanager/         — Config files
#     usr/bin/              — Daemons and utilities
#     usr/lib/qmanager/     — Shared shell libraries
#     www/cgi-bin/          — CGI API endpoints
#     usrdata/qmanager/     — lighttpd config
#   dependencies/           — Bundled binaries and packages
#     atcli_smd11           — ARM binary (AT command transport via /dev/smd11)
#     sms_tool              — ARM binary (SMS send/recv/delete via /dev/smd11)
#     jq.ipk                — JSON processor (Entware package)
#     dropbear_*.ipk        — SSH server (Entware package)
#   install_rm520n.sh       — This script
#
# Usage:
#   1. Transfer qmanager.tar.gz to /tmp/ on the device
#   2. cd /tmp && tar xzf qmanager.tar.gz
#   3. cd /tmp/qmanager_install && bash install_rm520n.sh
#
# Flags:
#   --frontend-only    Only install frontend files
#   --backend-only     Only install backend scripts
#   --no-enable        Don't enable systemd services
#   --no-start         Don't start services after install
#   --skip-packages    Skip dependency installation
#   --no-reboot        Don't reboot after installation
#   --force            Skip modem firmware detection in preflight
#   --help             Show this help
#
# =============================================================================

set -e

# --- Configuration -----------------------------------------------------------

VERSION="v0.1.5"
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"

# Destinations
QMANAGER_ROOT="/usrdata/qmanager"
WWW_ROOT="/usrdata/qmanager/www"
CGI_DIR="/usrdata/qmanager/www/cgi-bin/quecmanager"
LIB_DIR="/usr/lib/qmanager"
BIN_DIR="/usr/bin"
SYSTEMD_DIR="/lib/systemd/system"
WANTS_DIR="/lib/systemd/system/multi-user.target.wants"
TAILSCALE_DIR="/usrdata/tailscale"

# Detect Entware vs system sudo (called as function — must re-evaluate
# after install_dependencies installs sudo on a fresh modem)
detect_sudo() {
    if [ -f /opt/etc/sudoers ]; then
        SUDOERS_DIR="/opt/etc/sudoers.d"
        SUDOERS_CONF="/opt/etc/sudoers"
        SUDO_BIN="/opt/bin/sudo"
    elif [ -f /etc/sudoers ]; then
        SUDOERS_DIR="/etc/sudoers.d"
        SUDOERS_CONF="/etc/sudoers"
        SUDO_BIN="/usr/bin/sudo"
    else
        SUDOERS_DIR=""
        SUDOERS_CONF=""
        SUDO_BIN=""
    fi
}
detect_sudo
CONF_DIR="/etc/qmanager"
CERT_DIR="/usrdata/qmanager/certs"
SESSION_DIR="/tmp/qmanager_sessions"
BACKUP_DIR="/etc/qmanager/backups"
LIGHTTPD_CONF="/usrdata/qmanager/lighttpd.conf"

# Source directories (relative to INSTALL_DIR)
SRC_FRONTEND="$INSTALL_DIR/out"
SRC_SCRIPTS="$INSTALL_DIR/scripts"
SRC_DEPS="$INSTALL_DIR/dependencies"

# Entware opkg path
OPKG="/opt/bin/opkg"

# Optional packages (not bundled — installed from Entware if available)
OPTIONAL_PACKAGES="msmtp"

# Two-phase version write: written at preflight, finalized at the end
VERSION_PENDING="/etc/qmanager/VERSION.pending"

# Watchcat lock prevents Tier-4 reboot during install
WATCHCAT_LOCK="/tmp/qmanager_watchcat.lock"

# Status of early SSH bootstrap; set by setup_ssh_early(), read by print_summary().
# Values: installed | skipped_ota | skipped_existing | failed_install | failed_start | failed_password | not_run
SSH_BOOTSTRAP_STATUS="not_run"

# Install log (qmanager_update tails this for step progress)
LOG_FILE="/tmp/qmanager_install.log"

# Services gated on config: only re-enable if they were already enabled
UCI_GATED_SERVICES="qmanager-watchcat qmanager-tower-failover qmanager-discord qmanager-sms-forward"

# Conflict packages that must be removed before installing
CONFLICT_PACKAGES="socat socat-at-bridge"

# --- Colors & Icons ----------------------------------------------------------

if [ -t 1 ]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    BLUE='\033[0;34m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' BLUE='' BOLD='' DIM='' NC=''
fi
ICO_OK='✓'; ICO_WARN='⚠'; ICO_ERR='✗'; ICO_STEP='▶'

# --- Logging -----------------------------------------------------------------

log_init() {
    : > "$LOG_FILE"
    _log_raw "QManager install started — version $VERSION"
}

_log_raw() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE"
}

info() {
    _log_raw "INFO  $1"
    printf "    ${GREEN}${ICO_OK}${NC}  %s\n" "$1"
}

warn() {
    _log_raw "WARN  $1"
    printf "    ${YELLOW}${ICO_WARN}${NC}  %s\n" "$1"
}

error() {
    _log_raw "ERROR $1"
    printf "    ${RED}${ICO_ERR}${NC}  %s\n" "$1"
}

die() {
    error "$1"
    exit 1
}

TOTAL_STEPS=9; CURRENT_STEP=0

# step() writes the step header used by qmanager_update to track progress —
# the exact "=== Step N/M: <label> ===" format is the tail-target pattern.
step() {
    CURRENT_STEP=$(( CURRENT_STEP + 1 ))
    local label="$1"
    _log_raw "=== Step ${CURRENT_STEP}/${TOTAL_STEPS}: ${label} ==="
    printf "\n  ${DIM}[Step %d/%d]${NC}\n" "$CURRENT_STEP" "$TOTAL_STEPS"
    printf "  ${BLUE}${BOLD}${ICO_STEP}${NC}${BOLD} %s${NC}\n" "$label"
}

count_files() { find "$1" -type f 2>/dev/null | wc -l | tr -d ' '; }

# --- Atomic File Install Helpers ---------------------------------------------

# install_file <src> <dst> <mode>
# Copies src to dst atomically (temp + mv). Strips CRLF for non-ELF files.
install_file() {
    local src="$1" dst="$2" mode="$3"
    local tmp="${dst}.qm_install.$$"

    cp "$src" "$tmp" || return 1

    if ! head -c 4 "$tmp" 2>/dev/null | grep -q $'\x7fELF'; then
        tr -d '\r' < "$tmp" > "${tmp}.cr" && mv "${tmp}.cr" "$tmp"
    fi

    chmod "$mode" "$tmp" || { rm -f "$tmp"; return 1; }
    mv "$tmp" "$dst" || { rm -f "$tmp"; return 1; }
    return 0
}

# install_dir_flat <src> <dst> <mode>
# Installs all regular files from a flat source dir. Dies on any failure.
install_dir_flat() {
    local src="$1" dst="$2" mode="$3"
    local count=0
    for f in "$src"/*; do
        [ -f "$f" ] || continue
        install_file "$f" "$dst/$(basename "$f")" "$mode" \
            || die "Failed to install $(basename "$f") from $src"
        count=$(( count + 1 ))
    done
    printf '%d' "$count"
}

# install_tree <src> <dst>
# Recursively copies src tree to dst (wiping dst first), then sets permissions.
install_tree() {
    local src="$1" dst="$2"
    rm -rf "$dst"
    mkdir -p "$dst"
    cp -r "$src"/. "$dst/"
    # Strip CRLF first — the .cr-rewrite + mv pattern below replaces files
    # with new ones whose mode comes from umask (typically 644). Apply final
    # modes AFTER stripping so the executable bit can't be silently wiped.
    find "$dst" -type f -not -name "*.sh" | while IFS= read -r f; do
        if ! head -c 4 "$f" 2>/dev/null | grep -q $'\x7fELF'; then
            tr -d '\r' < "$f" > "${f}.cr" && mv "${f}.cr" "$f" 2>/dev/null || true
        fi
    done
    find "$dst" -name "*.sh" | while IFS= read -r f; do
        tr -d '\r' < "$f" > "${f}.cr" && mv "${f}.cr" "$f" 2>/dev/null || true
    done
    # Final mode pass — must be last to survive the CRLF rewrites above.
    find "$dst" -name "*.sh" -exec chmod 755 {} \;
    find "$dst" -not -name "*.sh" -type f -exec chmod 644 {} \;
}

# --- Two-phase Version Write -------------------------------------------------

mark_version_pending() {
    mkdir -p "$CONF_DIR"
    printf '%s\n' "$VERSION" > "$VERSION_PENDING"
    _log_raw "Version $VERSION marked as pending"
}

finalize_version() {
    if [ -f "$VERSION_PENDING" ]; then
        mv "$VERSION_PENDING" "$CONF_DIR/VERSION"
        _log_raw "Version $VERSION finalized"
    fi
}

# --- Modem Firmware Detection ------------------------------------------------

detect_modem_firmware() {
    local model=""

    # Try version file first (fastest, no AT round-trip)
    if [ -f /etc/quectel-project-version ]; then
        model=$(grep -m1 "^Project Name:" /etc/quectel-project-version 2>/dev/null \
            | sed 's/^Project Name:[[:space:]]*//' | tr -d '[:space:]')
    fi

    # Fall back to AT stack
    if [ -z "$model" ] && [ -x "$BIN_DIR/atcli_smd11" ]; then
        model=$(timeout 5 "$BIN_DIR/atcli_smd11" "ATI" 2>/dev/null \
            | grep -i "RM520N" | head -1 | tr -d '[:space:]') || true
        [ -z "$model" ] && model=$(timeout 5 "$BIN_DIR/atcli_smd11" "AT+GMR" 2>/dev/null \
            | grep -i "RM520N" | head -1 | tr -d '[:space:]') || true
    fi

    # Fall back to poller cache
    if [ -z "$model" ]; then
        for f in /tmp/qmanager_status.json /etc/qmanager/status.json; do
            [ -f "$f" ] && model=$(grep -o '"RM520N[^"]*"' "$f" 2>/dev/null | head -1 \
                | tr -d '"[:space:]') && [ -n "$model" ] && break
        done
    fi

    printf '%s' "$(printf '%s' "$model" | tr '[:lower:]' '[:upper:]')"
}

# --- Download Helper ---------------------------------------------------------
#
# curl/wget auto-detection — mirrors scripts/usr/lib/qmanager/downloader.sh.
# Inlined because the installer runs before that library is on disk. curl is
# preferred; wget is a first-class fallback so curl need not be force-installed.

_DL_TOOL=""

dl_resolve() {
    if [ -z "$_DL_TOOL" ]; then
        if command -v curl >/dev/null 2>&1; then
            _DL_TOOL="curl"
        elif command -v wget >/dev/null 2>&1; then
            _DL_TOOL="wget"
        else
            _DL_TOOL="none"
        fi
    fi
    [ "$_DL_TOOL" != "none" ]
}

# dl_get <url> <dest> — download url to dest; dest is removed on failure so a
# partial file or an HTTP error page is never left behind as a "success".
dl_get() {
    local url="$1" dest="$2" rc
    dl_resolve || return 1
    case "$_DL_TOOL" in
        curl) curl -fsSL -o "$dest" "$url" ;;
        wget) wget -q -T 60 -O "$dest" "$url" ;;
    esac
    rc=$?
    [ "$rc" -ne 0 ] && rm -f "$dest"
    return "$rc"
}

# --- Pre-flight Checks -------------------------------------------------------

preflight() {
    step "Running pre-flight checks"

    if [ "$(id -u)" -ne 0 ]; then
        die "This script must be run as root"
    fi

    # A downloader is required for fetching Entware, GitHub releases, etc.
    # curl is preferred; wget is accepted as a first-class fallback so curl no
    # longer has to be force-installed. The downloads themselves are the real
    # TLS test — here we only confirm a tool exists and warn (never abort) if
    # HTTPS looks unreachable with the selected tool.
    if ! dl_resolve; then
        die "No downloader found. Install 'curl' or 'wget' and re-run."
    fi
    info "Using '$_DL_TOOL' to download files"
    if [ "$_DL_TOOL" = "wget" ]; then
        if ! wget -q -T 8 -O /dev/null https://api.github.com/ 2>/dev/null; then
            warn "Could not confirm HTTPS works with wget — if downloads fail,"
            warn "your wget may lack TLS support; install curl or a TLS-capable wget."
        fi
    fi

    if [ "$DO_FORCE" = "1" ]; then
        warn "--force: skipping modem firmware detection"
    else
        if [ -f /etc/quectel-project-version ]; then
            local ver project_name
            ver=$(cat /etc/quectel-project-version 2>/dev/null)
            project_name=$(grep -m1 "^Project Name:" /etc/quectel-project-version 2>/dev/null \
                | sed 's/^Project Name:[[:space:]]*//' | tr -d '[:space:]')

            case "$project_name" in
                RM551E*)
                    die "Incompatible device: $project_name detected. Use the QManager RM551E installer."
                    ;;
                RM520N*)
                    info "Detected: RM520N-GL ($ver)"
                    ;;
                "")
                    warn "Cannot parse device model from firmware version — proceeding anyway"
                    ;;
                *)
                    warn "Unrecognized device: $project_name"
                    printf "\n"
                    printf "%s\n" "$ver" | sed 's/^/    /'
                    printf "\n  This installer targets RM520N-GL devices. Your device may not be compatible.\n"
                    printf "  Do you want to proceed anyway? [y/N] "

                    # Prefer /dev/tty so the prompt still works when stdin is
                    # piped (curl|bash, adb shell without -t, etc.). Use a
                    # redirect probe (not [ -r ]) — /dev/tty always has read
                    # permissions but returns ENXIO on open when there is no
                    # controlling terminal (systemd service, OTA worker, etc.).
                    local answer=""
                    if { true </dev/tty; } 2>/dev/null; then
                        read -r answer </dev/tty || answer=""
                    elif [ -t 0 ]; then
                        read -r answer || answer=""
                    fi
                    # No terminal available (OTA update, curl|bash, headless ADB):
                    # auto-proceed with a warning rather than aborting. The old
                    # qmanager_update worker (pre-v0.1.8) does not pass --force, so
                    # dying here silently breaks OTA upgrades on variant devices.
                    if [ -z "$answer" ]; then
                        printf "\n"
                        warn "No terminal available — proceeding non-interactively. Use --force to suppress this check."
                        answer="y"
                    fi
                    case "$answer" in
                        [Yy]|[Yy][Ee][Ss]) info "Proceeding on user request" ;;
                        *) die "Installation aborted by user" ;;
                    esac
                    ;;
            esac
        else
            warn "Cannot detect firmware version (/etc/quectel-project-version not found) — proceeding anyway"
        fi
    fi

    # Remount root filesystem read-write if needed
    if ! touch /usr/.qm_rw_test 2>/dev/null; then
        mount -o remount,rw / 2>/dev/null || die "Could not remount / read-write"
    fi
    rm -f /usr/.qm_rw_test

    # Check source directories exist
    if [ "$DO_FRONTEND" = "1" ] && [ ! -d "$SRC_FRONTEND" ]; then
        die "Frontend source not found at $SRC_FRONTEND"
    fi
    if [ "$DO_BACKEND" = "1" ] && [ ! -d "$SRC_SCRIPTS" ]; then
        die "Backend scripts not found at $SRC_SCRIPTS"
    fi

    mark_version_pending
    info "Pre-flight checks passed"
}

# --- Remove Conflicts --------------------------------------------------------

# Removes packages that must not coexist with QManager (e.g. socat-at-bridge
# which holds /dev/smd11 open, blocking atcli_smd11).
# Runs even with --skip-packages so conflicts are cleared on every update.
remove_conflicts() {
    # Skip silently if Entware isn't available yet (fresh install, pre-bootstrap)
    if [ ! -x "$OPKG" ]; then
        _log_raw "remove_conflicts: opkg not available — skipping (pre-Entware)"
        return 0
    fi

    for pkg in $CONFLICT_PACKAGES; do
        if "$OPKG" list-installed 2>/dev/null | grep -q "^${pkg} "; then
            info "Removing conflicting package: $pkg"
            if "$OPKG" remove "$pkg" >/dev/null 2>&1; then
                info "Removed $pkg"
            elif "$OPKG" remove --force-removal-of-dependent-packages "$pkg" >/dev/null 2>&1; then
                info "Removed $pkg (force-deps)"
            elif "$OPKG" remove --force-depends "$pkg" >/dev/null 2>&1; then
                info "Removed $pkg (force-depends)"
            else
                die "Cannot remove conflicting package '$pkg' — please remove it manually and re-run"
            fi
        fi
    done
}

# --- Install Dependencies ----------------------------------------------------

install_dependencies() {
    step "Installing dependencies"

    # --- System users & groups ------------------------------------------------
    # Create www-data user/group if missing (lighttpd runs as www-data:dialout)
    if ! getent group dialout >/dev/null 2>&1; then
        addgroup dialout 2>/dev/null || groupadd dialout 2>/dev/null || true
        info "Created group: dialout"
    fi
    if ! getent group www-data >/dev/null 2>&1; then
        addgroup www-data 2>/dev/null || groupadd www-data 2>/dev/null || true
        info "Created group: www-data"
    fi
    if ! id www-data >/dev/null 2>&1; then
        adduser -S -H -D -G www-data www-data 2>/dev/null || \
        useradd -r -M -s /sbin/nologin -g www-data www-data 2>/dev/null || true
        info "Created user: www-data"
    fi
    # Add www-data to dialout (needed to access /dev/smd11 with mode 660 root:dialout).
    # Try every known helper, then VERIFY — silent failure here was the root cause of
    # the x5* (PRAIRE/sdxprairie) compatibility regression where /dev/smd11 ended up
    # unreachable through the dialout group on platforms whose addgroup/usermod
    # variants don't accept the "add user to group" syntax.
    addgroup www-data dialout 2>/dev/null || \
    usermod -aG dialout www-data 2>/dev/null || \
    gpasswd -a www-data dialout 2>/dev/null || true

    # Membership check: `id -Gn` prints group NAMES space-separated (e.g. "www-data dialout").
    # `id www-data` alone prints `groups=33(www-data),20(dialout)` — splitting that on commas
    # gives tokens like "20(dialout)" not "dialout", which is why a naive grep -qx fails
    # (verified live on RM520N-GL BusyBox v1.31.1).
    if ! id -Gn www-data 2>/dev/null | tr ' ' '\n' | grep -qx 'dialout'; then
        warn "addgroup/usermod/gpasswd did not add www-data to dialout — falling back to direct /etc/group edit"
        if grep -q '^dialout:' /etc/group 2>/dev/null; then
            # Group exists — append www-data to its member list. Safe to run only
            # because the surrounding `id -Gn ... | grep -qx` already proved
            # www-data is NOT yet a member; otherwise this would duplicate.
            # Two-step sed handles the empty-member-list case (trailing colon):
            #   "dialout:x:20:"            → ",www-data" appended → ":,"  → ":"
            #   "dialout:x:20:user1"       → ",www-data" appended (no :, to clean)
            sed -i \
                -e '/^dialout:/s/$/,www-data/' \
                -e '/^dialout:/s/:,/:/' \
                /etc/group
        else
            # Group missing entirely. GID 20 is the canonical Debian dialout GID
            # and matches every Quectel image we have evidence for.
            echo 'dialout:x:20:www-data' >> /etc/group
        fi
        sync
        if ! id -Gn www-data 2>/dev/null | tr ' ' '\n' | grep -qx 'dialout'; then
            die "Could not add www-data to dialout group — manual /etc/group fix required"
        fi
        info "www-data added to dialout via /etc/group fallback"
    fi

    # --- atcli_smd11 (AT command transport — direct /dev/smd11 access) --------
    if [ -f "$SRC_DEPS/atcli_smd11" ]; then
        install_file "$SRC_DEPS/atcli_smd11" "$BIN_DIR/atcli_smd11" 755 \
            || die "Failed to install atcli_smd11"
        info "atcli_smd11 installed to $BIN_DIR/atcli_smd11"
    elif [ -x "$BIN_DIR/atcli_smd11" ]; then
        info "atcli_smd11 already installed"
    else
        die "atcli_smd11 not found in $SRC_DEPS and not installed on device"
    fi

    # --- sms_tool (SMS send/recv/delete — handles multi-part reassembly) ------
    if [ -f "$SRC_DEPS/sms_tool" ]; then
        install_file "$SRC_DEPS/sms_tool" "$BIN_DIR/sms_tool" 755 \
            || die "Failed to install sms_tool"
        info "sms_tool installed to $BIN_DIR/sms_tool"
    elif [ -x "$BIN_DIR/sms_tool" ]; then
        info "sms_tool already installed"
    else
        warn "sms_tool not found — SMS features will not work"
    fi

    # --- qmanager_discord (optional Discord bot binary) -----------------------
    if [ -f "$SRC_DEPS/qmanager_discord" ]; then
        install_file "$SRC_DEPS/qmanager_discord" "$BIN_DIR/qmanager_discord" 755 \
            || warn "Failed to install qmanager_discord"
        info "qmanager_discord installed to $BIN_DIR/qmanager_discord"
    elif [ -x "$BIN_DIR/qmanager_discord" ]; then
        info "qmanager_discord already installed"
    else
        info "qmanager_discord not bundled — Discord bot feature disabled"
    fi

    # --- Entware bootstrap -------------------------------------------------------
    # If opkg is not installed, bootstrap Entware from scratch.
    # This replicates the RGMII toolkit's Entware installation process.
    if [ ! -x "$OPKG" ]; then
        info "Entware not found — bootstrapping from bin.entware.net"

        # Prevent library conflicts during bootstrap
        unset LD_LIBRARY_PATH
        unset LD_PRELOAD

        ENTWARE_ARCH="armv7sf-k3.2"
        ENTWARE_URL="http://bin.entware.net/${ENTWARE_ARCH}/installer"

        # Rename factory opkg if present (conflicts with Entware opkg)
        if command -v opkg >/dev/null 2>&1; then
            _old_opkg=$(command -v opkg)
            mv "$_old_opkg" "${_old_opkg}_old" 2>/dev/null || true
            info "Renamed factory opkg to opkg_old"
        fi

        # Create /usrdata/opt and bind-mount to /opt via systemd
        mkdir -p /usrdata/opt

        if [ ! -f /lib/systemd/system/opt.mount ]; then
            cat > /lib/systemd/system/opt.mount << 'MOUNTEOF'
[Unit]
Description=Bind /usrdata/opt to /opt

[Mount]
What=/usrdata/opt
Where=/opt
Type=none
Options=bind

[Install]
WantedBy=multi-user.target
MOUNTEOF
            info "Created opt.mount systemd unit"
        fi

        # Bootstrap service ensures opt.mount starts at boot
        if [ ! -f /lib/systemd/system/start-opt-mount.service ]; then
            cat > /lib/systemd/system/start-opt-mount.service << 'SVCEOF'
[Unit]
Description=Ensure opt.mount is started at boot
After=network.target

[Service]
Type=oneshot
ExecStart=/bin/systemctl start opt.mount

[Install]
WantedBy=multi-user.target
SVCEOF
            ln -sf /lib/systemd/system/start-opt-mount.service \
                /lib/systemd/system/multi-user.target.wants/start-opt-mount.service
            info "Created start-opt-mount.service"
        fi

        systemctl daemon-reload
        systemctl start opt.mount 2>/dev/null || true
        info "Mounted /usrdata/opt → /opt"

        # Create directory structure
        for folder in bin etc lib/opkg tmp var/lock; do
            mkdir -p "/opt/$folder"
        done
        chmod 777 /opt/tmp

        # Download opkg binary and config. ENTWARE_URL is plain HTTP, so any
        # downloader works here — including a TLS-less BusyBox wget.
        dl_get "$ENTWARE_URL/opkg" /opt/bin/opkg \
            || die "Failed to download opkg from $ENTWARE_URL"
        # wget (unlike curl -f) writes HTTP error pages to the output file on a
        # 4xx/5xx. Verify the download is a real ELF binary before trusting it:
        # the first 4 bytes of every ELF file are 0x7F 'E' 'L' 'F', so the
        # literal "ELF" appears in the first 4 bytes (an HTML/JSON error page
        # never does). head + grep only — no od dependency.
        if ! head -c4 /opt/bin/opkg 2>/dev/null | grep -q 'ELF'; then
            rm -f /opt/bin/opkg
            die "Downloaded opkg is not a valid binary (server error or bad mirror?)"
        fi
        chmod 755 /opt/bin/opkg
        dl_get "$ENTWARE_URL/opkg.conf" /opt/etc/opkg.conf \
            || die "Failed to download opkg.conf from $ENTWARE_URL"
        info "Downloaded opkg package manager"

        # Install base Entware
        /opt/bin/opkg update >/dev/null 2>&1 \
            || die "opkg update failed — check internet connectivity"
        /opt/bin/opkg install entware-opt >/dev/null 2>&1 \
            || die "Failed to install entware-opt base package"
        info "Entware base installed"

        # Link system user/group files
        for file in passwd group shells shadow gshadow; do
            [ -f "/etc/$file" ] && ln -sf "/etc/$file" "/opt/etc/$file"
        done
        [ -f /etc/localtime ] && ln -sf /etc/localtime /opt/etc/localtime

        # Create Entware init.d service (starts Entware services at boot)
        if [ ! -f /lib/systemd/system/rc.unslung.service ]; then
            cat > /lib/systemd/system/rc.unslung.service << 'RCEOF'
[Unit]
Description=Start Entware services

[Service]
Type=oneshot
ExecStartPre=/bin/sleep 5
ExecStart=/opt/etc/init.d/rc.unslung start
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
RCEOF
            ln -sf /lib/systemd/system/rc.unslung.service \
                /lib/systemd/system/multi-user.target.wants/rc.unslung.service
            info "Created rc.unslung.service"
        fi

        # Create global symlinks for critical Entware binaries
        ln -sf /opt/bin/opkg /bin/opkg 2>/dev/null || true
        ln -sf /opt/bin/jq /usr/bin/jq 2>/dev/null || true

        systemctl daemon-reload
        info "Entware bootstrap complete"
    else
        info "Entware already installed at $OPKG"
    fi

    # --- Entware packages (requires opkg to be available) ---------------------
    _opkg_ready=0
    if [ -x "$OPKG" ]; then
        if "$OPKG" update >/dev/null 2>&1; then
            _opkg_ready=1
        else
            warn "opkg update failed — no internet connection?"
            warn "Skipping Entware package installs (lighttpd, sudo, jq, etc.)"
            warn "Re-run the installer with internet to complete package setup"
        fi
    fi

    if [ "$_opkg_ready" = "1" ]; then
        # lighttpd (web server + required modules)
        if [ -x /opt/sbin/lighttpd ]; then
            info "lighttpd is already installed"
            # Upgrade lighttpd + all modules together to prevent version mismatch
            # (plugin-version must match lighttpd-version or modules fail to load)
            "$OPKG" upgrade lighttpd lighttpd-mod-cgi lighttpd-mod-openssl \
                lighttpd-mod-redirect lighttpd-mod-proxy >/dev/null 2>&1 \
                && info "lighttpd packages synced" \
                || true
        else
            "$OPKG" install lighttpd >/dev/null 2>&1 \
                && info "lighttpd installed from Entware" \
                || die "Failed to install lighttpd from Entware"
        fi
        # Install required modules (Entware packages them ALL separately)
        for mod in lighttpd-mod-cgi lighttpd-mod-openssl lighttpd-mod-redirect lighttpd-mod-proxy; do
            "$OPKG" install "$mod" >/dev/null 2>&1 \
                && info "$mod installed" \
                || warn "$mod not available"
        done

        # sudo (privilege escalation for CGI)
        if command -v sudo >/dev/null 2>&1; then
            info "sudo is already installed"
        else
            "$OPKG" install sudo >/dev/null 2>&1 \
                && info "sudo installed from Entware" \
                || warn "sudo not available — CGI privilege escalation will not work"
        fi

        # jq
        if command -v jq >/dev/null 2>&1; then
            info "jq is already installed"
        elif ls "$SRC_DEPS"/jq*.ipk >/dev/null 2>&1; then
            "$OPKG" install "$SRC_DEPS"/jq*.ipk >/dev/null 2>&1 \
                && info "jq installed from bundled package" \
                || die "Failed to install jq from bundled package"
        else
            "$OPKG" install jq >/dev/null 2>&1 \
                && info "jq installed from Entware" \
                || die "Failed to install jq"
        fi

        # Ensure jq is in standard PATH (lighttpd CGI won't see /opt/bin)
        [ -x /opt/bin/jq ] && ln -sf /opt/bin/jq /usr/bin/jq 2>/dev/null || true

        # Same for curl — Entware-installed curl lands in /opt/bin/, but
        # CGI scripts and BusyBox shells don't have /opt/bin on PATH.
        [ -x /opt/bin/curl ] && ! command -v curl >/dev/null 2>&1 && \
            ln -sf /opt/bin/curl /usr/bin/curl 2>/dev/null || true

        # coreutils-timeout
        if command -v timeout >/dev/null 2>&1; then
            info "timeout is already installed"
        else
            "$OPKG" install coreutils-timeout >/dev/null 2>&1 \
                && info "coreutils-timeout installed from Entware" \
                || warn "coreutils-timeout not available — some commands may hang without timeout safety"
        fi

        # dropbear (SSH server)
        if command -v dropbear >/dev/null 2>&1; then
            info "dropbear is already installed"
        elif ls "$SRC_DEPS"/dropbear*.ipk >/dev/null 2>&1; then
            "$OPKG" install "$SRC_DEPS"/dropbear*.ipk >/dev/null 2>&1 \
                && info "dropbear installed from bundled package" \
                || warn "dropbear install failed (optional — SSH server)"
        else
            info "dropbear not bundled and not installed (optional)"
        fi
    fi

    # --- Ookla Speedtest CLI (speed test from web UI) ---
    if command -v speedtest >/dev/null 2>&1; then
        info "speedtest CLI is already installed"
    else
        SPEEDTEST_URL="https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-armhf.tgz"
        SPEEDTEST_DIR="/usrdata/root/bin"
        mkdir -p "$SPEEDTEST_DIR"
        if dl_get "$SPEEDTEST_URL" /tmp/speedtest.tgz 2>/dev/null; then
            tar -xzf /tmp/speedtest.tgz -C "$SPEEDTEST_DIR" speedtest 2>/dev/null
            rm -f /tmp/speedtest.tgz "$SPEEDTEST_DIR/speedtest.md"
            chmod +x "$SPEEDTEST_DIR/speedtest"
            ln -sf "$SPEEDTEST_DIR/speedtest" /bin/speedtest
            info "speedtest CLI installed to $SPEEDTEST_DIR/speedtest"
        else
            warn "speedtest CLI download failed (optional — requires internet)"
        fi
    fi

    # --- Optional packages (from Entware, not bundled) ---
    if [ -x "$OPKG" ]; then
        for pkg in $OPTIONAL_PACKAGES; do
            if command -v "$pkg" >/dev/null 2>&1; then
                info "$pkg is already installed"
            else
                "$OPKG" install "$pkg" >/dev/null 2>&1 && info "$pkg installed" \
                    || warn "$pkg not available (optional)"
            fi
        done
    fi
}

# --- Stop Running Services ---------------------------------------------------

stop_services() {
    step "Stopping QManager services"

    # Stop watchcat first — it can trigger Tier-4 reboots if it sees the poller die
    touch "$WATCHCAT_LOCK"
    systemctl stop qmanager-watchcat 2>/dev/null || true
    killall -9 qmanager_watchcat 2>/dev/null || true
    touch "$WATCHCAT_LOCK"  # re-touch after SIGKILL as defense in depth

    # Stop socat-at-bridge services if present from previous installations
    # (idempotent — systemctl stop is a no-op for inactive/missing units)
    systemctl stop socat-smd11 socat-smd11-to-ttyIN socat-smd11-from-ttyIN 2>/dev/null || true
    for svc in socat-smd11 socat-smd11-to-ttyIN socat-smd11-from-ttyIN; do
        rm -f "$WANTS_DIR/${svc}.service"
    done

    # Collect all qmanager-* units (excluding watchcat — already stopped above)
    _units=""
    for unit in "$SYSTEMD_DIR"/qmanager-*.service; do
        [ -f "$unit" ] || continue
        svc=$(basename "$unit" .service)
        [ "$svc" = "qmanager-watchcat" ] && continue
        _units="$_units $svc"
    done
    # Single batched stop — systemd processes these in parallel internally
    if [ -n "$_units" ]; then
        systemctl stop $_units 2>/dev/null || true
    fi

    # SIGTERM all qmanager_* processes (update and auto_update excluded —
    # qmanager_update is our own parent; qmanager_auto_update owns the outer loop)
    for bin in "$BIN_DIR"/qmanager_*; do
        [ -f "$bin" ] || continue
        proc=$(basename "$bin")
        case "$proc" in
            qmanager_update|qmanager_auto_update) continue ;;
        esac
        killall "$proc" 2>/dev/null || true
    done

    sleep 1

    # SIGKILL any stragglers (same exclusions)
    for bin in "$BIN_DIR"/qmanager_*; do
        [ -f "$bin" ] || continue
        proc=$(basename "$bin")
        case "$proc" in
            qmanager_update|qmanager_auto_update) continue ;;
        esac
        killall -9 "$proc" 2>/dev/null || true
    done

    info "All services stopped"
}

# --- Backup Originals --------------------------------------------------------

backup_originals() {
    step "Backing up original files"

    mkdir -p "$BACKUP_DIR"

    # Backup existing QManager auth (preserves password across upgrades)
    if [ -f "$CONF_DIR/auth.json" ]; then
        local ts; ts=$(date +%Y%m%d_%H%M%S)
        cp "$CONF_DIR/auth.json" "$BACKUP_DIR/auth.json.$ts" 2>/dev/null || true
        info "Backed up auth config"
    fi

    # Backup existing lighttpd config (if upgrading)
    if [ -f "$LIGHTTPD_CONF" ]; then
        cp "$LIGHTTPD_CONF" "${LIGHTTPD_CONF}.bak"
        info "Backed up existing lighttpd.conf"
    fi

    info "Backups complete"
}

# --- Install Frontend --------------------------------------------------------

install_frontend() {
    step "Installing frontend"

    # Create web root if it doesn't exist (independent install — no SimpleAdmin)
    mkdir -p "$WWW_ROOT"
    mkdir -p "$WWW_ROOT/cgi-bin"

    local file_count
    file_count=$(count_files "$SRC_FRONTEND")
    info "Deploying $file_count frontend files to $WWW_ROOT"

    # Clean www root — preserve cgi-bin
    for item in "$WWW_ROOT"/*; do
        name=$(basename "$item")
        case "$name" in
            cgi-bin) continue ;;
            *) rm -rf "$item" ;;
        esac
    done

    # Copy new frontend
    cp -r "$SRC_FRONTEND"/* "$WWW_ROOT/"

    info "Frontend installed ($file_count files)"
}

# --- Install Backend ---------------------------------------------------------

install_backend() {
    step "Installing backend scripts"

    # --- Shared libraries ---
    mkdir -p "$LIB_DIR"
    if [ -d "$SRC_SCRIPTS/usr/lib/qmanager" ]; then
        local lib_count
        lib_count=$(install_dir_flat "$SRC_SCRIPTS/usr/lib/qmanager" "$LIB_DIR" 644)
        info "$lib_count libraries installed to $LIB_DIR"
    fi

    # --- Tailscale systemd units (staged for on-demand install) ---
    # These are NOT installed as active units — qmanager_tailscale_mgr copies
    # them to /lib/systemd/system/ when the user clicks "Install Tailscale".
    for f in tailscaled.service tailscaled.defaults qmanager-console.service; do
        src="$SRC_SCRIPTS/etc/systemd/system/$f"
        if [ -f "$src" ]; then
            install_file "$src" "$LIB_DIR/$f" 644 \
                || warn "Failed to stage $f"
        fi
    done

    # --- Upgrade existing Tailscale deployment ---
    # If Tailscale is already installed, update the live systemd unit and staged
    # copy so service fixes (e.g. ExecStartPost chmod) take effect on next boot.
    if [ -x "$TAILSCALE_DIR/tailscaled" ] && [ -f "$LIB_DIR/tailscaled.service" ]; then
        install_file "$LIB_DIR/tailscaled.service" "$SYSTEMD_DIR/tailscaled.service" 644 \
            || warn "Failed to update live tailscaled.service"
        mkdir -p "$TAILSCALE_DIR/systemd"
        install_file "$LIB_DIR/tailscaled.service" "$TAILSCALE_DIR/systemd/tailscaled.service" 644 \
            || warn "Failed to update staged tailscaled.service"
        info "Updated deployed tailscaled.service"
    fi

    # --- Daemons and utilities ---
    local bin_count=0
    if [ -d "$SRC_SCRIPTS/usr/bin" ]; then
        for f in "$SRC_SCRIPTS/usr/bin"/*; do
            [ -f "$f" ] || continue
            local fname; fname=$(basename "$f")
            install_file "$f" "$BIN_DIR/$fname" 755 \
                || die "Failed to install $fname"
            bin_count=$(( bin_count + 1 ))
        done
        info "$bin_count daemons/utilities installed to $BIN_DIR"
    fi

    # --- CGI endpoints ---
    if [ -d "$SRC_SCRIPTS/www/cgi-bin/quecmanager" ]; then
        install_tree "$SRC_SCRIPTS/www/cgi-bin/quecmanager" "$CGI_DIR"
        # Defensive chmod — install_tree should already have set 755/644, but
        # any silent mode regression here means lighttpd 500s on every request.
        find "$CGI_DIR" -name "*.sh" -type f -exec chmod 755 {} \;
        find "$CGI_DIR" -name "*.json" -exec chmod 644 {} \;
        local cgi_count
        cgi_count=$(find "$CGI_DIR" -name "*.sh" -type f | wc -l | tr -d ' ')
        info "$cgi_count CGI scripts installed to $CGI_DIR"
    fi

    # --- Console startup script ---
    if [ -d "$SRC_SCRIPTS/usrdata/qmanager/console" ]; then
        mkdir -p "$QMANAGER_ROOT/console"
        for f in "$SRC_SCRIPTS/usrdata/qmanager/console"/*; do
            [ -f "$f" ] || continue
            local mode=644
            case "$f" in *.sh) mode=755 ;; esac
            install_file "$f" "$QMANAGER_ROOT/console/$(basename "$f")" "$mode" || true
        done
        info "Console startup script installed"
    fi

    # --- Systemd unit files (SimpleAdmin pattern: /lib/systemd/system/) ---
    if [ -d "$SRC_SCRIPTS/etc/systemd/system" ]; then
        # Ensure rootfs is writable (may have reverted since preflight)
        mount -o remount,rw / 2>/dev/null || true

        # Remove old /etc/systemd/system/ units from previous installs
        rm -f /etc/systemd/system/qmanager*.service /etc/systemd/system/qmanager*.target
        rm -rf /etc/systemd/system/qmanager.target.wants

        # Copy service files to /lib/systemd/system/ (persistent on RM520N-GL)
        for f in "$SRC_SCRIPTS/etc/systemd/system"/qmanager*.service; do
            [ -f "$f" ] || continue
            install_file "$f" "$SYSTEMD_DIR/$(basename "$f")" 644 \
                || die "Failed to install $(basename "$f")"
        done

        # Install lighttpd service file — ensures correct config path is used.
        # Entware's default service may point to /opt/etc/lighttpd/lighttpd.conf
        # instead of /usrdata/qmanager/lighttpd.conf where QManager's config lives.
        if [ -f "$SRC_SCRIPTS/etc/systemd/system/lighttpd.service" ]; then
            install_file "$SRC_SCRIPTS/etc/systemd/system/lighttpd.service" \
                "$SYSTEMD_DIR/lighttpd.service" 644 \
                || die "Failed to install lighttpd.service"
            info "lighttpd.service installed (config: /usrdata/qmanager/lighttpd.conf)"
        fi
        sync

        systemctl daemon-reload
        info "Systemd units installed to $SYSTEMD_DIR"
    fi

    # --- Sudoers (re-detect after install_dependencies may have installed sudo) ---
    detect_sudo
    if [ -f "$SRC_SCRIPTS/etc/sudoers.d/qmanager" ] && [ -n "$SUDOERS_DIR" ]; then
        mkdir -p "$SUDOERS_DIR"
        # Ensure sudoers includes the drop-in directory
        if ! grep -q "includedir.*sudoers.d" "$SUDOERS_CONF" 2>/dev/null; then
            echo "#includedir $SUDOERS_DIR" >> "$SUDOERS_CONF"
            info "Added #includedir $SUDOERS_DIR to $SUDOERS_CONF"
        fi
        install_file "$SRC_SCRIPTS/etc/sudoers.d/qmanager" "$SUDOERS_DIR/qmanager" 440 \
            || die "Failed to install sudoers rules"
        chown root:root "$SUDOERS_DIR/qmanager"
        info "Sudoers rules installed to $SUDOERS_DIR (440)"
    elif [ -z "$SUDOERS_DIR" ]; then
        warn "sudo not found — install Entware sudo: $OPKG install sudo"
        warn "Skipping sudoers rules (CGI privilege escalation will not work)"
    fi

    # --- lighttpd config ---
    mkdir -p "$QMANAGER_ROOT"
    if [ -f "$SRC_SCRIPTS/usrdata/qmanager/lighttpd.conf" ]; then
        install_file "$SRC_SCRIPTS/usrdata/qmanager/lighttpd.conf" "$LIGHTTPD_CONF" 644 \
            || die "Failed to install lighttpd.conf"
        info "lighttpd config installed"
    fi

    # --- TLS certificates ---
    mkdir -p "$CERT_DIR"
    if [ ! -f "$CERT_DIR/server.key" ]; then
        # Generate self-signed cert if none exist
        openssl req -x509 -newkey rsa:2048 -keyout "$CERT_DIR/server.key" \
            -out "$CERT_DIR/server.crt" -days 3650 -nodes \
            -subj "/CN=QManager" 2>/dev/null
        info "Generated self-signed TLS certificate"
    else
        info "TLS certs already exist"
    fi

    # --- Create required directories ---
    # www-data (lighttpd CGI) needs write access to config dir (auth.json, profiles)
    # and session dir (session tokens). Also needs dialout group for serial device access.
    addgroup www-data dialout 2>/dev/null || true
    mkdir -p "$CONF_DIR/profiles"
    chown -R www-data:www-data "$CONF_DIR"

    # Custom DNS needs a www-data-owned staging dir on /dev/ubi2_0 (same volume
    # as /etc/data/dnsmasq.conf) so the CGI can write the candidate config and
    # the final rename into place stays atomic. install -d self-heals owner/mode
    # on re-run, so this is safe on upgrade.
    install -d -o www-data -g www-data -m 0700 /etc/data/qmanager

    # --- Migrate legacy TTL state file (one-time, non-fatal) -----------------
    # Old path: /etc/firewall.user.ttl (root-owned, unwritable by www-data CGI)
    # New path: /etc/qmanager/ttl_state (www-data-owned via CONF_DIR chown above)
    if [ -f /etc/firewall.user.ttl ] && [ ! -f "$CONF_DIR/ttl_state" ]; then
        info "Migrating legacy TTL state from /etc/firewall.user.ttl ..."
        (
            . "$LIB_DIR/platform.sh" 2>/dev/null
            . "$LIB_DIR/ttl_state.sh" 2>/dev/null
            old_ttl=$(grep -o -- '--ttl-set [0-9]*' /etc/firewall.user.ttl 2>/dev/null | awk '{print $2}' | head -n1)
            old_hl=$(grep -o -- '--hl-set [0-9]*' /etc/firewall.user.ttl 2>/dev/null | awk '{print $2}' | head -n1)
            [ -z "$old_ttl" ] && old_ttl=0
            [ -z "$old_hl" ] && old_hl=0
            if [ "$old_ttl" -eq 0 ] && [ "$old_hl" -eq 0 ]; then
                info "Legacy /etc/firewall.user.ttl had no parseable TTL/HL — leaving in place for inspection"
            else
                ttl_state_write_persisted "$old_ttl" "$old_hl" && \
                    info "Migrated TTL=$old_ttl HL=$old_hl to $TTL_STATE_FILE"
                rm -f /etc/firewall.user.ttl || true
                info "Removed legacy /etc/firewall.user.ttl"
            fi
        ) || true
    fi

    mkdir -p "$SESSION_DIR"
    chown www-data:www-data "$SESSION_DIR"
    chmod 700 "$SESSION_DIR"
    mkdir -p /var/lock

    # --- Config files (deploy new, don't overwrite existing) ---
    if [ -d "$SRC_SCRIPTS/etc/qmanager" ]; then
        for f in "$SRC_SCRIPTS/etc/qmanager"/*; do
            [ -f "$f" ] || continue
            local fname; fname=$(basename "$f")
            if [ ! -f "$CONF_DIR/$fname" ]; then
                install_file "$f" "$CONF_DIR/$fname" 644 \
                    || warn "Failed to deploy config: $fname"
                info "Deployed config: $fname"
            fi
        done
    fi

    # --- Initialize JSON config if missing ---
    if [ -f "$LIB_DIR/config.sh" ]; then
        . "$LIB_DIR/config.sh"
        qm_config_init
        info "Config initialized at /etc/qmanager/qmanager.conf"
    fi

    # --- Bootstrap default ping_profile.json / migrate legacy env vars ----------
    install_ping_profile
    migrate_ping_environment
    prune_stale_ping_environment

    info "Backend installed"
}

# --- Bootstrap Default ping_profile.json -------------------------------------

# Bootstrap default ping_profile.json on first install. Idempotent.
install_ping_profile() {
    local target="/etc/qmanager/ping_profile.json"
    local source_file="$SRC_SCRIPTS/etc/qmanager/ping_profile.json"

    mkdir -p /etc/qmanager
    if [ ! -f "$target" ]; then
        if [ -f "$source_file" ]; then
            cp "$source_file" "$target"
            chmod 644 "$target"
            echo "  Installed default ping profile (relaxed)"
        else
            echo "  WARNING: $source_file missing from installer payload" >&2
        fi
    else
        echo "  Existing ping profile preserved at $target"
    fi
}

# --- Migrate Legacy Ping Environment -----------------------------------------

# Migrate old cycle-count env vars in /etc/qmanager/environment to time-based.
# Old: FAIL_THRESHOLD=3 (cycles)  ->  New: FAIL_SECS=15 (seconds, assuming 5s probe interval)
# Idempotent: re-running on already-migrated file is a no-op.
migrate_ping_environment() {
    local env_file="/etc/qmanager/environment"
    [ -f "$env_file" ] || return 0

    # Skip if migration already happened (FAIL_SECS present, FAIL_THRESHOLD absent)
    if grep -q '^FAIL_SECS=' "$env_file" && ! grep -q '^FAIL_THRESHOLD=' "$env_file"; then
        return 0
    fi
    if ! grep -q '^FAIL_THRESHOLD=\|^RECOVER_THRESHOLD=\|^HISTORY_SIZE=' "$env_file"; then
        return 0
    fi

    echo "  Migrating ping env vars from cycle-count to time-based..."
    local interval=5
    if grep -q '^PING_INTERVAL=' "$env_file"; then
        interval=$(grep '^PING_INTERVAL=' "$env_file" | head -1 | cut -d= -f2)
        # Defensive default if the value is missing or non-numeric
        case "$interval" in
            ''|*[!0-9]*) interval=5 ;;
        esac
    fi

    local backup="${env_file}.pre-rust-ping.bak"
    cp "$env_file" "$backup"

    local tmp; tmp=$(mktemp)
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            FAIL_THRESHOLD=*)
                local n="${line#FAIL_THRESHOLD=}"
                case "$n" in ''|*[!0-9]*) n=3 ;; esac
                printf 'FAIL_SECS=%s\n' "$((n * interval))" >> "$tmp"
                ;;
            RECOVER_THRESHOLD=*)
                local n="${line#RECOVER_THRESHOLD=}"
                case "$n" in ''|*[!0-9]*) n=2 ;; esac
                printf 'RECOVER_SECS=%s\n' "$((n * interval))" >> "$tmp"
                ;;
            HISTORY_SIZE=*)
                local n="${line#HISTORY_SIZE=}"
                case "$n" in ''|*[!0-9]*) n=60 ;; esac
                printf 'HISTORY_SECS=%s\n' "$((n * interval))" >> "$tmp"
                ;;
            *)
                printf '%s\n' "$line" >> "$tmp"
                ;;
        esac
    done < "$env_file"
    mv "$tmp" "$env_file"
    chmod 644 "$env_file"
    echo "  Migrated $env_file (backup at $backup)"
}

# --- Prune Stale Ping Environment Vars ---------------------------------------

# Strip env vars that were removed in a past release and are now no-ops or harmful.
# Idempotent: safe to run on every install/upgrade.
#   CARRIER_FILE — removed in v0.1.9: daemon now relies solely on HTTP probes.
prune_stale_ping_environment() {
    local env_file="/etc/qmanager/environment"
    [ -f "$env_file" ] || return 0

    local stale_keys="CARRIER_FILE"
    local pruned=0
    local tmp; tmp=$(mktemp)

    while IFS= read -r line || [ -n "$line" ]; do
        local key="${line%%=*}"
        local drop=0
        for k in $stale_keys; do
            [ "$key" = "$k" ] && drop=1 && break
        done
        if [ "$drop" = "1" ]; then
            pruned=$(( pruned + 1 ))
        else
            printf '%s\n' "$line" >> "$tmp"
        fi
    done < "$env_file"

    if [ "$pruned" -gt 0 ]; then
        mv "$tmp" "$env_file"
        chmod 644 "$env_file"
        echo "  Removed $pruned stale ping env var(s) from $env_file (CARRIER_FILE no longer used)"
    else
        rm -f "$tmp"
    fi
}

# --- Cleanup Legacy Scripts --------------------------------------------------

# Removes scripts, units, and libraries that no longer exist in the source tree.
# Prevents stale handlers from running after features are removed.
cleanup_legacy_scripts() {
    step "Cleaning up legacy scripts"

    local removed=0

    # /usr/bin/qmanager_* — remove if not in source (scripts/usr/bin/) AND not bundled in dependencies/
    for installed in "$BIN_DIR"/qmanager_*; do
        [ -f "$installed" ] || continue
        fname=$(basename "$installed")
        if [ ! -f "$SRC_SCRIPTS/usr/bin/$fname" ] && [ ! -f "$SRC_DEPS/$fname" ]; then
            rm -f "$installed"
            rm -f "$WANTS_DIR/${fname}.service"
            _log_raw "Removed legacy: $fname"
            info "Removed legacy: $fname"
            removed=$(( removed + 1 ))
        fi
    done

    # /lib/systemd/system/qmanager-*.service — remove if not in source
    for installed in "$SYSTEMD_DIR"/qmanager-*.service; do
        [ -f "$installed" ] || continue
        fname=$(basename "$installed")
        if [ ! -f "$SRC_SCRIPTS/etc/systemd/system/$fname" ]; then
            rm -f "$installed"
            rm -f "$WANTS_DIR/$fname"
            _log_raw "Removed legacy: $fname"
            info "Removed legacy: $fname"
            removed=$(( removed + 1 ))
        fi
    done

    # /usr/lib/qmanager/*.sh — remove if not in source
    for installed in "$LIB_DIR"/*.sh; do
        [ -f "$installed" ] || continue
        fname=$(basename "$installed")
        if [ ! -f "$SRC_SCRIPTS/usr/lib/qmanager/$fname" ]; then
            rm -f "$installed"
            _log_raw "Removed legacy: $fname"
            info "Removed legacy: $fname"
            removed=$(( removed + 1 ))
        fi
    done

    if [ "$removed" -eq 0 ]; then
        info "No legacy scripts to remove"
    else
        info "Removed $removed legacy file(s)"
    fi
}

# --- Install udev Rules ------------------------------------------------------

# scrub_vendor_smd11_rules: remove third-party smd11 entries from vendor udev files.
#
# Background: rgmii-toolkit and various community fixes (e.g. 1alessandro1's
# upstream advice) edit Quectel's /etc/udev/rules.d/data_udev_rules.rules and
# /etc/udev/scripts/data_udev_script.sh to chown /dev/smd11 to www-data:www-data.
# Vanilla Quectel firmware does NOT claim smd11 (confirmed on RM520N-GL —
# vendor's data_udev_rules.rules only lists smd7..smd10), so any smd11 entry
# we find is from a previous third-party install and will race our own rule.
#
# Removing them eliminates the race so our 99-qmanager-smd11.rules is the sole
# writer of /dev/smd11 permissions. A one-time backup (.qmanager.bak) is kept
# per file so a curious operator can restore the original.
scrub_vendor_smd11_rules() {
    local vendor_rules="/etc/udev/rules.d/data_udev_rules.rules"
    local vendor_script="/etc/udev/scripts/data_udev_script.sh"
    local scrubbed=0

    if [ -f "$vendor_rules" ] && grep -q 'KERNEL=="smd11"' "$vendor_rules" 2>/dev/null; then
        [ -f "$vendor_rules.qmanager.bak" ] || cp "$vendor_rules" "$vendor_rules.qmanager.bak"
        sed -i '/KERNEL=="smd11"/d' "$vendor_rules"
        info "Removed competing smd11 rule from $vendor_rules (backup: .qmanager.bak)"
        scrubbed=1
    fi

    if [ -f "$vendor_script" ] && grep -qE '^[[:space:]]*smd11\)' "$vendor_script" 2>/dev/null; then
        [ -f "$vendor_script.qmanager.bak" ] || cp "$vendor_script" "$vendor_script.qmanager.bak"
        # Delete the smd11) case in two passes for safety:
        #   Pass 1 — one-liner form:  "    smd11) cmd ;;"
        #            Match the whole line at once.
        #   Pass 2 — multi-line form: "smd11)" alone, then body, then "    ;;" alone.
        #            End anchor requires a line whose ENTIRE non-whitespace content
        #            is ";;", so any nested "case ... ;;" inside the block can't
        #            close the range early and over-delete (defensive — vanilla
        #            Quectel scripts and the known third-party edits don't nest,
        #            but this future-proofs us).
        sed -i '/^[[:space:]]*smd11)[^)]*;;[[:space:]]*$/d' "$vendor_script"
        sed -i '/^[[:space:]]*smd11)[[:space:]]*$/,/^[[:space:]]*;;[[:space:]]*$/d' "$vendor_script"
        info "Removed competing smd11 case from $vendor_script (backup: .qmanager.bak)"
        scrubbed=1
    fi

    if [ "$scrubbed" -eq 1 ]; then
        sync
        command -v udevadm >/dev/null 2>&1 && udevadm control --reload-rules 2>/dev/null || true
    fi
    return 0
}

install_udev_rules() {
    step "Installing udev rules for /dev/smd11"

    local rule_src="$SRC_SCRIPTS/etc/udev/rules.d/99-qmanager-smd11.rules"
    local rule_dst="/etc/udev/rules.d/99-qmanager-smd11.rules"
    local helper_src="$SRC_SCRIPTS/etc/udev/scripts/qmanager_smd11_udev.sh"
    local helper_dst="/usr/lib/qmanager/qmanager_smd11_udev.sh"

    if [ ! -f "$rule_src" ] || [ ! -f "$helper_src" ]; then
        warn "udev rule sources missing — skipping (smd11 perms rely on qmanager-setup oneshot)"
        return 0
    fi

    # Remount rootfs rw — /etc and /usr/lib live on the read-only root.
    mount -o remount,rw / 2>/dev/null || true

    mkdir -p /etc/udev/rules.d /usr/lib/qmanager

    # Strip any third-party smd11 entries from vendor files first, so our rule
    # is the only one firing on smd11 add events (no race for ownership).
    scrub_vendor_smd11_rules

    # helper lives outside install_backend's LIB_DIR glob to preserve 755
    install_file "$helper_src" "$helper_dst" 755 \
        || die "Failed to install udev helper"
    chown root:root "$helper_dst"
    info "Helper installed: $helper_dst"

    install_file "$rule_src" "$rule_dst" 644 \
        || die "Failed to install udev rule"
    chown root:root "$rule_dst"
    info "Rule installed: $rule_dst"

    sync

    # Reload rules and trigger an add event on smd11 so the rule fires now
    # (rather than waiting for the next reboot or modem reset).
    if command -v udevadm >/dev/null 2>&1; then
        if udevadm control --reload-rules 2>/dev/null; then
            if [ -c /dev/smd11 ]; then
                udevadm trigger --action=add /dev/smd11 2>/dev/null || true
                udevadm settle --timeout=5 2>/dev/null || true
                # Verify the rule actually applied
                local mode owner
                mode=$(stat -c '%a' /dev/smd11 2>/dev/null)
                owner=$(stat -c '%U:%G' /dev/smd11 2>/dev/null)
                if [ "$mode" = "660" ] && [ "$owner" = "root:dialout" ]; then
                    info "Rule applied: /dev/smd11 = $owner $mode"
                else
                    warn "Rule did not apply cleanly: /dev/smd11 = $owner $mode (expected root:dialout 660)"
                fi
            else
                info "/dev/smd11 not present yet — rule will fire when modem creates it"
            fi
        else
            warn "udevadm reload failed — rule will activate at next reboot"
        fi
    else
        warn "udevadm not found — rule will activate at next reboot"
    fi
}

# --- Enable Services ---------------------------------------------------------

enable_services() {
    step "Enabling systemd services"

    # Ensure rootfs is writable for symlink creation
    mount -o remount,rw / 2>/dev/null || true

    # SimpleAdmin's proven pattern: symlink each service directly into
    # multi-user.target.wants. No intermediate target — RM520N-GL's minimal
    # systemd handles direct wants reliably.
    mkdir -p "$WANTS_DIR"

    # Remove old target-based setup from previous installs
    rm -f "$WANTS_DIR/qmanager.target"
    rm -rf /etc/systemd/system/qmanager.target.wants

    # Ensure lighttpd is enabled for boot
    if [ -f "$SYSTEMD_DIR/lighttpd.service" ]; then
        ln -sf "$SYSTEMD_DIR/lighttpd.service" "$WANTS_DIR/lighttpd.service"
        info "Enabled lighttpd"
    fi

    # Capture pre-install symlink state for gated services so we can restore
    # the same enabled/disabled state rather than force-enabling them.
    local gated_was_enabled=""
    for svc in $UCI_GATED_SERVICES; do
        if [ -L "$WANTS_DIR/${svc}.service" ]; then
            gated_was_enabled="$gated_was_enabled $svc"
        fi
    done

    # Scan all installed qmanager units and enable/skip based on gating
    for unit in "$SYSTEMD_DIR"/qmanager-*.service; do
        [ -f "$unit" ] || continue
        svc=$(basename "$unit" .service)

        # Check if this service is in the gated list
        local is_gated=0
        for g in $UCI_GATED_SERVICES; do
            if [ "$svc" = "$g" ]; then
                is_gated=1
                break
            fi
        done

        if [ "$is_gated" = "1" ]; then
            # Only re-enable if it was already enabled before this run
            local was_on=0
            for w in $gated_was_enabled; do
                if [ "$w" = "$svc" ]; then
                    was_on=1
                    break
                fi
            done
            if [ "$was_on" = "1" ]; then
                ln -sf "$unit" "$WANTS_DIR/${svc}.service"
                info "Re-enabled $svc (was previously enabled)"
            else
                info "Skipped $svc (enable manually if needed)"
            fi
        else
            ln -sf "$unit" "$WANTS_DIR/${svc}.service"
            info "Enabled $svc"
        fi
    done

    # --- Discord bot (gated on binary + config + enabled flag) ----------------
    if [ -x "$BIN_DIR/qmanager_discord" ] && [ -f /etc/qmanager/discord_bot.json ]; then
        enabled=$(jq -r '.enabled // false' /etc/qmanager/discord_bot.json 2>/dev/null)
        if [ "$enabled" = "true" ]; then
            ln -sf "$SYSTEMD_DIR/qmanager-discord.service" "$WANTS_DIR/qmanager-discord.service"
            info "Discord bot service enabled"
        fi
    fi

    sync
    systemctl daemon-reload
}

# --- Start Services ----------------------------------------------------------

start_services() {
    step "Starting QManager services"

    # AT device permissions — www-data (dialout group) needs read/write on /dev/smd11
    if [ -e /dev/smd11 ]; then
        chown root:dialout /dev/smd11
        chmod 660 /dev/smd11
        info "Set /dev/smd11 permissions for dialout group"
    fi

    # Start firewall before lighttpd (protects web UI before accepting connections)
    systemctl start qmanager-firewall 2>/dev/null || true

    # Restart lighttpd to pick up new config
    systemctl restart lighttpd 2>/dev/null || warn "Could not restart lighttpd"
    info "lighttpd restarted with QManager config"

    # Run setup oneshot (creates lock files, session dirs, permissions)
    systemctl start qmanager-setup 2>/dev/null || true

    # Start always-on services with verification
    for svc in qmanager-cfun-fix qmanager-ping qmanager-poller qmanager-ttl qmanager-mtu qmanager-imei-check; do
        systemctl start "$svc" 2>/dev/null || true
    done

    # Start Discord bot if binary present, config exists, and enabled flag is true
    if [ -x "$BIN_DIR/qmanager_discord" ] && [ -f /etc/qmanager/discord_bot.json ]; then
        _dc_enabled=$(jq -r '.enabled // false' /etc/qmanager/discord_bot.json 2>/dev/null)
        if [ "$_dc_enabled" = "true" ]; then
            systemctl start qmanager-discord 2>/dev/null || warn "Could not start qmanager-discord"
            info "Discord bot started"
        fi
    fi
    sleep 2

    # Download ttyd for web console (non-fatal — console is optional)
    if [ ! -x /usrdata/qmanager/console/ttyd ]; then
        info "Downloading ttyd for web console..."
        /usr/bin/qmanager_console_mgr install 2>/dev/null || warn "ttyd download failed — web console unavailable"
    fi

    # Verify critical services
    local svc_errors=0
    for svc in qmanager-firewall lighttpd qmanager-setup qmanager-ping qmanager-poller; do
        if systemctl is-active "$svc" >/dev/null 2>&1; then
            info "$svc is running"
        else
            warn "$svc is NOT running — check: journalctl -u $svc"
            svc_errors=$((svc_errors + 1))
        fi
    done

    # Verify AT device access
    if [ -x "$BIN_DIR/atcli_smd11" ] && [ -e /dev/smd11 ]; then
        if timeout 3 "$BIN_DIR/atcli_smd11" "AT" >/dev/null 2>&1; then
            info "AT device responds (atcli_smd11 → /dev/smd11)"
        else
            warn "AT device not responding — modem may not be ready yet"
        fi
    fi

    if [ "$svc_errors" -gt 0 ]; then
        warn "$svc_errors service(s) failed to start"
    fi
}

# --- Health Check ------------------------------------------------------------

# Polls for a live qmanager_poller PID and its status cache (warn-only).
health_check() {
    local deadline=$(( $(date +%s) + 10 ))
    local ok=0
    while [ "$(date +%s)" -lt "$deadline" ]; do
        if pgrep -x qmanager_poller >/dev/null 2>&1 && \
           [ -f /tmp/qmanager_status.json ]; then
            ok=1
            break
        fi
        sleep 1
    done
    if [ "$ok" = "1" ]; then
        info "health_check: poller running and status cache present"
    else
        warn "health_check: poller not ready within 10s — check: journalctl -u qmanager-poller"
    fi
}

# --- AT Stack Check ----------------------------------------------------------

# Sends a test AT command through qcmd. Warn-only so a cold modem doesn't
# block a successful install from being reported.
at_stack_check() {
    local ok=0
    local i=1
    while [ "$i" -le 3 ]; do
        if command -v qcmd >/dev/null 2>&1; then
            local out
            out=$(timeout 8 qcmd 'ATI' 2>/dev/null) || true
            if printf '%s' "$out" | grep -q '^OK'; then
                ok=1
                break
            fi
        fi
        i=$(( i + 1 ))
        sleep 2
    done
    if [ "$ok" = "1" ]; then
        info "at_stack_check: AT stack responding"
    else
        warn "at_stack_check: no OK from ATI after 3 attempts"
        warn "  Troubleshooting: check /dev/smd11 permissions (should be root:dialout 660)"
        warn "  and verify atcli_smd11 is executable: $BIN_DIR/atcli_smd11"
    fi
}

# --- Early SSH Bootstrap (fresh installs only) -------------------------------
# Runs once, right after install_dependencies (so Entware/dropbear are available)
# and before the rest of the install. On fresh installs with no existing SSH,
# installs dropbear, writes a systemd unit, starts it, and sets root's password
# to "qmanager" so the user can SSH in immediately. Web-UI onboarding overwrites
# this temporary password later.
#
# Skips entirely on OTA upgrades (VERSION file present) or when port 22 is
# already in use by another SSH server.

setup_ssh_early() {
    step "Bootstrap SSH (fresh install)"

    # 1. Fresh-install gate. /etc/qmanager/VERSION only exists from a prior
    #    successful install. VERSION.pending (written by preflight) is ignored
    #    on purpose — that's the in-flight marker, not the prior-install marker.
    if [ -f "$CONF_DIR/VERSION" ]; then
        SSH_BOOTSTRAP_STATUS="skipped_ota"
        info "OTA upgrade detected — skipping SSH bootstrap"
        return 0
    fi

    # 2. Port-22 safety check. If anything is already listening, leave it alone.
    if command -v ss >/dev/null 2>&1; then
        if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE '(^|:)22$'; then
            SSH_BOOTSTRAP_STATUS="skipped_existing"
            info "SSH already running on port 22 — skipping bootstrap"
            return 0
        fi
    elif command -v netstat >/dev/null 2>&1; then
        if netstat -ltn 2>/dev/null | awk '{print $4}' | grep -qE '(^|:)22$'; then
            SSH_BOOTSTRAP_STATUS="skipped_existing"
            info "SSH already running on port 22 — skipping bootstrap"
            return 0
        fi
    fi
    if pidof dropbear >/dev/null 2>&1 || pidof sshd >/dev/null 2>&1; then
        SSH_BOOTSTRAP_STATUS="skipped_existing"
        info "SSH daemon already running — skipping bootstrap"
        return 0
    fi

    # 3. Ensure dropbear is installed. install_dependencies already does this on
    #    a fresh install, so this is normally a no-op fallback. We still try the
    #    bundled .ipk first, then Entware, in case install_dependencies failed
    #    on dropbear specifically.
    if ! command -v dropbear >/dev/null 2>&1; then
        if [ -x "$OPKG" ]; then
            if ls "$SRC_DEPS"/dropbear*.ipk >/dev/null 2>&1; then
                "$OPKG" install "$SRC_DEPS"/dropbear*.ipk >/dev/null 2>&1 \
                    && info "dropbear installed from bundled package" \
                    || { warn "dropbear install failed (bundled .ipk)"; SSH_BOOTSTRAP_STATUS="failed_install"; return 0; }
            else
                "$OPKG" install dropbear >/dev/null 2>&1 \
                    && info "dropbear installed from Entware" \
                    || { warn "dropbear install failed (Entware)"; SSH_BOOTSTRAP_STATUS="failed_install"; return 0; }
            fi
        else
            warn "Cannot install dropbear — opkg not available"
            SSH_BOOTSTRAP_STATUS="failed_install"
            return 0
        fi
    else
        info "dropbear already installed"
    fi

    # 4. Write the systemd unit. opkg's post-install hook generates RSA/ECDSA/
    #    ED25519 host keys in /opt/etc/dropbear/, which persists via the
    #    /usrdata/opt bind mount. dropbear finds them automatically.
    if [ ! -f "$SYSTEMD_DIR/dropbear.service" ]; then
        mount -o remount,rw / 2>/dev/null || true
        cat > "$SYSTEMD_DIR/dropbear.service" << 'SSHEOF'
[Unit]
Description=Dropbear SSH Server
After=network.target

[Service]
Type=simple
ExecStart=/opt/sbin/dropbear -F -E -p 22
Restart=on-failure

[Install]
WantedBy=multi-user.target
SSHEOF
        sync
        info "Created dropbear.service"
    fi

    # systemctl enable does not work on RM520N-GL — direct symlink instead.
    ln -sf "$SYSTEMD_DIR/dropbear.service" "$WANTS_DIR/dropbear.service"
    systemctl daemon-reload 2>/dev/null || true

    # 5. Start dropbear and verify it's active.
    systemctl start dropbear 2>/dev/null || true
    sleep 1
    if ! systemctl is-active dropbear >/dev/null 2>&1; then
        warn "dropbear failed to start — check: journalctl -u dropbear"
        SSH_BOOTSTRAP_STATUS="failed_start"
        return 0
    fi
    info "dropbear started on port 22"

    # 6. Set root's password to "qmanager" inline. The qmanager_set_ssh_password
    #    helper isn't installed at this point in the install (backend hasn't run),
    #    so we replicate its core logic here. Onboarding will overwrite the
    #    password on first web login.
    local _password="qmanager"
    local _salt _hash _escaped_hash
    _salt=$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')
    _hash=$(printf '%s\n' "$_password" | openssl passwd -1 -salt "$_salt" -stdin 2>/dev/null)

    if [ -z "$_hash" ]; then
        warn "openssl passwd failed — root password not set"
        SSH_BOOTSTRAP_STATUS="failed_password"
        return 0
    fi

    if [ ! -f /etc/shadow ]; then
        warn "/etc/shadow not found — root password not set"
        SSH_BOOTSTRAP_STATUS="failed_password"
        return 0
    fi

    mount -o remount,rw / 2>/dev/null || true

    # Escape sed-special chars in the hash. Using | as the sed delimiter so /
    # in the hash isn't a problem; only &, \, and | need escaping.
    _escaped_hash=$(printf '%s' "$_hash" | sed 's/[&\\|]/\\&/g')

    # Match locked (root:!:...), passwordless (root::...), or any-existing-hash forms.
    if ! sed -i "s|^root:[^:]*:|root:${_escaped_hash}:|" /etc/shadow 2>/dev/null; then
        warn "Failed to update /etc/shadow"
        SSH_BOOTSTRAP_STATUS="failed_password"
        return 0
    fi
    sync

    SSH_BOOTSTRAP_STATUS="installed"
    info "Root password set to 'qmanager' (will be replaced on web onboarding)"
}

# --- Summary -----------------------------------------------------------------

print_summary() {
    printf "\n"
    printf "  ══════════════════════════════════════════\n"
    printf "  ${GREEN}${BOLD}  QManager — Installation Complete${NC}\n"
    printf "  ${DIM}  RM520N-GL Edition${NC}\n"
    printf "  ══════════════════════════════════════════\n\n"

    printf "  ${DIM}Frontend:  ${NC}%s\n" "$WWW_ROOT"
    printf "  ${DIM}CGI:       ${NC}%s\n" "$CGI_DIR"
    printf "  ${DIM}Libraries: ${NC}%s\n" "$LIB_DIR"
    printf "  ${DIM}Daemons:   ${NC}%s/qmanager_*\n" "$BIN_DIR"
    printf "  ${DIM}Systemd:   ${NC}%s/qmanager-*\n" "$SYSTEMD_DIR"
    printf "  ${DIM}Config:    ${NC}%s\n" "$CONF_DIR"
    printf "  ${DIM}Certs:     ${NC}%s\n" "$CERT_DIR"
    printf "  ${DIM}Log:       ${NC}%s\n" "$LOG_FILE"

    printf "\n"
    printf "  Open in browser:  ${BOLD}https://192.168.225.1${NC}\n"
    printf "  Web console:      ${BOLD}https://192.168.225.1/console${NC}\n"

    case "$SSH_BOOTSTRAP_STATUS" in
        installed)
            printf "  SSH:              ${BOLD}ssh root@192.168.225.1${NC} ${DIM}(temp password: qmanager — replaced on web onboarding)${NC}\n"
            ;;
        failed_install|failed_start|failed_password)
            printf "  ${YELLOW}SSH bootstrap failed${NC} (${SSH_BOOTSTRAP_STATUS}). Re-run installer or set up dropbear manually.\n"
            ;;
        skipped_ota|skipped_existing|not_run)
            : # no SSH line — avoid noise on upgrades or pre-existing setups
            ;;
    esac
    printf "\n"

    if [ ! -f "$CONF_DIR/auth.json" ]; then
        info "First-time setup: you will be prompted to create a password"
    fi
    printf "\n"
}

# --- Usage -------------------------------------------------------------------

usage() {
    printf "QManager Installer (RM520N-GL) v%s\n\n" "$VERSION"
    printf "Usage: bash install_rm520n.sh [OPTIONS]\n\n"
    printf "Options:\n"
    printf "  --frontend-only    Only install frontend files\n"
    printf "  --backend-only     Only install backend scripts\n"
    printf "  --no-enable        Don't enable systemd services\n"
    printf "  --no-start         Don't start services after install\n"
    printf "  --skip-packages    Skip dependency installation\n"
    printf "  --no-reboot        Don't reboot after installation\n"
    printf "  --force            Skip modem firmware detection in preflight\n"
    printf "  --help             Show this help\n\n"
}

# --- Main --------------------------------------------------------------------

main() {
    DO_FRONTEND=1; DO_BACKEND=1; DO_ENABLE=1; DO_START=1
    DO_PACKAGES=1; DO_REBOOT=1; DO_FORCE=0

    while [ $# -gt 0 ]; do
        case "$1" in
            --frontend-only) DO_FRONTEND=1; DO_BACKEND=0 ;;
            --backend-only)  DO_FRONTEND=0; DO_BACKEND=1 ;;
            --no-enable)     DO_ENABLE=0 ;;
            --no-start)      DO_START=0 ;;
            --skip-packages) DO_PACKAGES=0 ;;
            --no-reboot)     DO_REBOOT=0 ;;
            --force)         DO_FORCE=1 ;;
            --help|-h)       usage; exit 0 ;;
            *) error "Unknown option: $1"; usage; exit 1 ;;
        esac
        shift
    done

    # Watchcat lock cleanup on any exit — prevents Tier-4 reboot if installer aborts
    trap 'rm -f "$WATCHCAT_LOCK"' EXIT INT TERM

    log_init

    printf "\n"
    printf "  ══════════════════════════════════════════\n"
    printf "  ${BOLD}  QManager — RM520N-GL Installer${NC}\n"
    printf "  ${DIM}  Version: %s${NC}\n" "$VERSION"
    printf "  ══════════════════════════════════════════\n"

    # Calculate steps: preflight always runs; others are conditional
    TOTAL_STEPS=4  # preflight + setup_ssh_early + stop_services + cleanup_legacy_scripts
    [ "$DO_PACKAGES" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))
    [ "$DO_FRONTEND" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 2 ))  # backup + frontend
    [ "$DO_BACKEND" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 2 ))   # backend + udev
    [ "$DO_BACKEND" = "1" ] && [ "$DO_ENABLE" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))
    [ "$DO_START" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))

    preflight

    # remove_conflicts runs even with --skip-packages (e.g. socat-at-bridge
    # must be gone before atcli_smd11 can open /dev/smd11)
    remove_conflicts

    [ "$DO_PACKAGES" = "1" ] && install_dependencies

    # SSH bootstrap runs after install_dependencies so Entware + bundled
    # dropbear .ipk are available, and before stop_services so it never has
    # to wait on QManager service teardown.
    setup_ssh_early

    stop_services

    if [ "$DO_FRONTEND" = "1" ]; then
        backup_originals
        install_frontend
    fi

    if [ "$DO_BACKEND" = "1" ]; then
        install_backend
        cleanup_legacy_scripts
        install_udev_rules
        [ "$DO_ENABLE" = "1" ] && enable_services
    fi

    [ "$DO_START" = "1" ] && start_services

    [ "$DO_START" = "1" ] && health_check
    [ "$DO_START" = "1" ] && at_stack_check

    print_summary

    finalize_version

    # Self-cleanup: remove the staging directory only when invoked from the
    # canonical OTA path — avoids deleting a developer's working copy
    case "$INSTALL_DIR" in
        /tmp/qmanager_install|/tmp/qmanager_install/)
            rm -rf "$INSTALL_DIR" 2>/dev/null || true ;;
    esac

    if [ "$DO_REBOOT" = "1" ]; then
        printf "  Rebooting in 5 seconds — press Ctrl+C to cancel...\n\n"
        sync
        sleep 5
        reboot
    fi
}

main "$@"
