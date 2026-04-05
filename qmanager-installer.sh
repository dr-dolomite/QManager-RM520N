#!/bin/bash
# ==============================================================================
# QManager — Installer Bootstrap for RM520N-GL
# Quectel Modem Manager
# https://github.com/dr-dolomite/QManager-RM520N
#
# Usage:
#   /opt/bin/wget -O /tmp/qmanager-installer.sh \
#     https://github.com/dr-dolomite/QManager-RM520N/raw/refs/heads/main/qmanager-installer.sh && \
#     bash /tmp/qmanager-installer.sh
#
# Environment variables:
#   QMANAGER_VERSION  Pin a specific release version (default: latest including pre-releases)
#
# ==============================================================================

# --- Configuration -----------------------------------------------------------

GITHUB_REPO="dr-dolomite/QManager-RM520N"
GITHUB_API="https://api.github.com/repos/${GITHUB_REPO}/releases"
ARCHIVE_PATH="/tmp/qmanager.tar.gz"
CHECKSUM_PATH="/tmp/qmanager_sha256sum.txt"
EXTRACT_DIR="/tmp/qmanager_install"

# Device paths (must match install_rm520n.sh / uninstall_rm520n.sh)
WWW_ROOT="/usrdata/simpleadmin/www"
CGI_DIR="/usrdata/simpleadmin/www/cgi-bin/quecmanager"
LIB_DIR="/usr/lib/qmanager"
BIN_DIR="/usr/bin"
SYSTEMD_DIR="/lib/systemd/system"
CONF_DIR="/etc/qmanager"

# --- Colors & Formatting -----------------------------------------------------

if [ -t 1 ]; then
    BOLD='\033[1m'
    DIM='\033[2m'
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    CYAN='\033[0;36m'
    NC='\033[0m'
else
    BOLD='' DIM='' RED='' GREEN='' YELLOW='' CYAN='' NC=''
fi

# --- Helpers -----------------------------------------------------------------

info()  { printf "  ${GREEN}*${NC}  %s\n" "$1"; }
warn()  { printf "  ${YELLOW}!${NC}  %s\n" "$1"; }
err()   { printf "  ${RED}x${NC}  %s\n" "$1"; }
step()  { printf "\n  ${CYAN}>${NC}  ${BOLD}%s${NC}\n" "$1"; }

die() {
    err "$1"
    exit 1
}

# --- Checks ------------------------------------------------------------------

check_root() {
    [ "$(id -u)" -eq 0 ] || die "This script must be run as root"
}

check_platform() {
    # RM520N-GL runs SDXLEMUR kernel on ARMv7l
    if [ ! -d /usrdata ]; then
        die "RM520N-GL platform not detected (/usrdata missing)"
    fi
}

is_installed() {
    [ -d "$LIB_DIR" ] || [ -d "$CGI_DIR" ] || [ -f "$SYSTEMD_DIR/qmanager-poller.service" ]
}

# --- Download Helper ---------------------------------------------------------

download_file() {
    local url="$1" dest="$2"

    # Entware wget (has SSL support — BusyBox wget does not)
    if [ -x /opt/bin/wget ]; then
        /opt/bin/wget -q -O "$dest" "$url" 2>/dev/null && return 0
    fi

    # curl (if available)
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL -o "$dest" "$url" 2>/dev/null && return 0
    fi

    # Fallback: system wget (may fail on HTTPS)
    if command -v wget >/dev/null 2>&1; then
        wget -q -O "$dest" "$url" 2>/dev/null && return 0
    fi

    return 1
}

# --- GitHub API Helper -------------------------------------------------------

fetch_release_info() {
    local api_url="$1" tmp_file="/tmp/qm_installer_api.json"
    local is_list=false
    rm -f "$tmp_file"

    # Detect if we're querying the list endpoint (array) vs a single release (object)
    case "$api_url" in */releases|*/releases\?*) is_list=true ;; esac

    if ! download_file "$api_url" "$tmp_file"; then
        return 1
    fi

    # Parse with jq if available, otherwise fallback to grep
    if command -v jq >/dev/null 2>&1; then
        if $is_list; then
            RELEASE_TAG=$(jq -r '.[0].tag_name // empty' "$tmp_file" 2>/dev/null)
        else
            RELEASE_TAG=$(jq -r '.tag_name // empty' "$tmp_file" 2>/dev/null)
        fi
    else
        # Fallback: grep for tag_name in JSON (first match)
        RELEASE_TAG=$(grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' "$tmp_file" | head -1 | cut -d'"' -f4)
    fi

    rm -f "$tmp_file"
    [ -n "$RELEASE_TAG" ]
}

# ==============================================================================
# Option 1 — Install
# ==============================================================================

do_install() {
    check_root
    check_platform

    printf "\n"
    if is_installed; then
        warn "QManager is already installed. This will upgrade it."
        printf "\n  Continue? [y/N] "
        read -r ans
        case "$ans" in y|Y|yes|YES) ;; *) printf "\n  Aborted.\n\n"; return ;; esac
    fi

    # Resolve release version
    step "Checking latest release..."
    RELEASE_TAG=""

    if [ -n "${QMANAGER_VERSION:-}" ]; then
        info "Pinned version: $QMANAGER_VERSION"
        if ! fetch_release_info "${GITHUB_API}/tags/${QMANAGER_VERSION}"; then
            die "Release $QMANAGER_VERSION not found on GitHub"
        fi
    else
        # Fetch all releases (includes pre-releases) — latest first
        if ! fetch_release_info "${GITHUB_API}?per_page=1"; then
            die "Could not fetch latest release from GitHub. Check your internet connection."
        fi
    fi

    info "Release: $RELEASE_TAG"

    # Construct download URLs
    local base_url="https://github.com/${GITHUB_REPO}/releases/download/${RELEASE_TAG}"
    local tarball_url="${base_url}/qmanager.tar.gz"
    local checksum_url="${base_url}/sha256sum.txt"

    # Download tarball
    step "Downloading QManager ${RELEASE_TAG}..."
    printf "     %s\n" "$tarball_url"

    rm -f "$ARCHIVE_PATH"
    if ! download_file "$tarball_url" "$ARCHIVE_PATH"; then
        printf "\n"
        die "Download failed. Check your internet connection."
    fi
    [ -f "$ARCHIVE_PATH" ] || die "Download failed — archive not found"

    local size
    size=$(du -k "$ARCHIVE_PATH" 2>/dev/null | awk '{print $1 "K"}')
    info "Downloaded qmanager.tar.gz ($size)"

    # Download and verify checksum
    rm -f "$CHECKSUM_PATH"
    if download_file "$checksum_url" "$CHECKSUM_PATH" && [ -s "$CHECKSUM_PATH" ]; then
        local expected_sha256 actual_sha256
        expected_sha256=$(awk '{print $1}' "$CHECKSUM_PATH")
        actual_sha256=$(sha256sum "$ARCHIVE_PATH" 2>/dev/null | awk '{print $1}')

        if [ -z "$actual_sha256" ]; then
            warn "sha256sum not available — skipping integrity check"
        elif [ "$actual_sha256" != "$expected_sha256" ]; then
            err "SHA-256 mismatch!"
            err "  Expected: $expected_sha256"
            err "  Got:      $actual_sha256"
            rm -f "$ARCHIVE_PATH" "$CHECKSUM_PATH"
            die "Archive integrity check failed — download may be corrupt or tampered"
        else
            info "SHA-256 verified"
        fi
    else
        warn "Checksum file not available — skipping integrity check"
    fi
    rm -f "$CHECKSUM_PATH"

    # Extract
    step "Extracting archive..."
    rm -rf "$EXTRACT_DIR"
    tar xzf "$ARCHIVE_PATH" -C /tmp/ 2>/dev/null || die "Extraction failed — archive may be corrupt"
    [ -d "$EXTRACT_DIR" ] || die "Extraction failed — $EXTRACT_DIR not found"
    info "Extracted to $EXTRACT_DIR"

    # Run install_rm520n.sh from the archive
    step "Running QManager installer..."
    printf "\n"
    if [ -f "$EXTRACT_DIR/install_rm520n.sh" ]; then
        chmod +x "$EXTRACT_DIR/install_rm520n.sh"
        bash "$EXTRACT_DIR/install_rm520n.sh"
    else
        die "install_rm520n.sh not found inside archive"
    fi

    # Cleanup
    step "Cleaning up..."
    rm -f "$ARCHIVE_PATH"
    info "Temporary files removed"
}

# ==============================================================================
# Option 2 — Uninstall
# ==============================================================================

do_uninstall() {
    check_root
    check_platform

    printf "\n"
    if ! is_installed; then
        warn "QManager does not appear to be installed."
        printf "\n  Continue anyway? [y/N] "
        read -r ans
        case "$ans" in y|Y|yes|YES) ;; *) printf "\n  Aborted.\n\n"; return ;; esac
    fi

    if [ -f "$EXTRACT_DIR/uninstall_rm520n.sh" ]; then
        step "Running QManager uninstaller..."
        printf "\n"
        bash "$EXTRACT_DIR/uninstall_rm520n.sh"
    else
        warn "Uninstall script not found at $EXTRACT_DIR/uninstall_rm520n.sh"
        warn "If you installed from a previous release, SSH in and run:"
        printf "\n     bash /tmp/qmanager_install/uninstall_rm520n.sh\n\n"
    fi
}

# ==============================================================================
# Option 3 — Download Only
# ==============================================================================

do_download_only() {
    printf "\n"

    # Resolve release version
    step "Checking latest release..."
    RELEASE_TAG=""

    if [ -n "${QMANAGER_VERSION:-}" ]; then
        info "Pinned version: $QMANAGER_VERSION"
        if ! fetch_release_info "${GITHUB_API}/tags/${QMANAGER_VERSION}"; then
            die "Release $QMANAGER_VERSION not found on GitHub"
        fi
    else
        if ! fetch_release_info "${GITHUB_API}?per_page=1"; then
            die "Could not fetch latest release from GitHub. Check your internet connection."
        fi
    fi

    local tarball_url="https://github.com/${GITHUB_REPO}/releases/download/${RELEASE_TAG}/qmanager.tar.gz"

    step "Downloading QManager ${RELEASE_TAG}..."
    printf "     %s\n" "$tarball_url"

    rm -f "$ARCHIVE_PATH"
    if ! download_file "$tarball_url" "$ARCHIVE_PATH"; then
        printf "\n"
        die "Download failed. Check your internet connection."
    fi

    if [ -f "$ARCHIVE_PATH" ]; then
        local size
        size=$(du -k "$ARCHIVE_PATH" 2>/dev/null | awk '{print $1 "K"}')
        info "Downloaded to $ARCHIVE_PATH ($size)"
        printf "\n"
        printf "  To install later:\n\n"
        printf "     cd /tmp && tar xzf qmanager.tar.gz\n"
        printf "     cd qmanager_install && bash install_rm520n.sh\n\n"
    else
        die "Download failed"
    fi
}

# ==============================================================================
# Menu
# ==============================================================================

show_menu() {
    clear 2>/dev/null || true
    printf "\n"
    printf "  ${CYAN}==========================================${NC}\n"
    printf "  ${BOLD}       QManager — Setup Wizard${NC}\n"
    printf "  ${DIM}   Quectel RM520N-GL Modem Manager${NC}\n"
    printf "  ${CYAN}==========================================${NC}\n"
    printf "\n"

    # Show install status
    if is_installed; then
        printf "  Status: ${GREEN}Installed${NC}\n"
    else
        printf "  Status: ${DIM}Not installed${NC}\n"
    fi
    printf "\n"

    printf "  ${BOLD}[1]${NC}  Install QManager\n"
    printf "  ${BOLD}[2]${NC}  Uninstall QManager\n"
    printf "  ${BOLD}[3]${NC}  Download Only\n"
    printf "\n"
    printf "  ${DIM}[0]  Exit${NC}\n"
    printf "\n"
    printf "  Select an option: "
}

# ==============================================================================
# Entrypoint
# ==============================================================================

main() {
    show_menu
    read -r choice

    case "$choice" in
        1) do_install ;;
        2) do_uninstall ;;
        3) do_download_only ;;
        0) printf "\n  Goodbye.\n\n"; exit 0 ;;
        *)
            printf "\n"
            err "Invalid option: $choice"
            printf "\n"
            exit 1
            ;;
    esac
}

main
