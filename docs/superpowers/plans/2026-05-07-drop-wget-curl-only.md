# Drop wget Support — curl-Only Network I/O Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every `wget` (and dead `uclient-fetch`) code path from QManager-RM520N so the project depends solely on `curl` for HTTP/HTTPS I/O. This eliminates a missing-dependency footgun on Quectel x5x/x6x modems where BusyBox `wget` lacks TLS and Entware `wget` would otherwise add ~5 MB to the install footprint.

**Architecture:** All HTTP fetches (installer bootstrap, OTA updater, auto-update cron, GitHub API polling, ttyd download, Entware bootstrap, public-IP lookup, speedtest CLI download) are consolidated onto `curl`. RM520N-GL ships `curl` natively with full TLS support (per CLAUDE.md), so no fallback is required. The installer gains an explicit preflight check that fails fast if `curl` is somehow absent rather than silently degrading. No new abstractions are introduced — each caller keeps the same flag idioms it already uses for its `curl` branch (e.g. `-fSL` for downloads, `-sL --max-time -D` for API+headers, `-sLk` for public-IP probes).

**Tech Stack:** POSIX shell (`/bin/sh`) + bash, `curl`, `jq`. No tests/build steps for shell scripts in this repo — verification is `bash -n` syntax check + `grep` audit + manual smoke read.

**Files affected (8):**
- Modify: `qmanager-installer.sh` (bootstrap downloader)
- Modify: `scripts/install_rm520n.sh` (Entware opkg + speedtest CLI download, add curl preflight)
- Modify: `scripts/usr/bin/qmanager_update` (`http_download` helper)
- Modify: `scripts/usr/bin/qmanager_auto_update` (cron release-list fetch)
- Modify: `scripts/usr/bin/qmanager_console_mgr` (ttyd download)
- Modify: `scripts/www/cgi-bin/quecmanager/system/update.sh` (`http_api_fetch` + a stale comment)
- Modify: `scripts/www/cgi-bin/quecmanager/device/about.sh` (public IP lookup)
- Modify: `CLAUDE.md` (drop "or wget fallback" wording in tailscale note; add curl-only contract line)

**Verification gate (used after every edit):**
- `bash -n <file>` — must exit 0
- `grep -nE '\bwget\b|\buclient-fetch\b' <file>` — must produce no matches (after edit)
- Final repo-wide audit: `grep -rnE '\bwget\b|\buclient-fetch\b' scripts/ qmanager-installer.sh CLAUDE.md` returns zero hits.

---

## Task 1: Installer Bootstrap (`qmanager-installer.sh`) — drop both wget branches in `download_file`

**Files:**
- Modify: `qmanager-installer.sh:78-97` (`download_file` function)

**Context:** This is the entrypoint script users `curl | bash` to install QManager. It currently has a 3-tier fallback: `curl` → Entware `/opt/bin/wget` → system `wget`. The Entware path is moot because the installer bootstrap runs *before* Entware is installed, and the system `wget` branch is the failure mode we're removing across the board.

- [ ] **Step 1: Edit `download_file` to be curl-only**

Replace lines 78–97 of `qmanager-installer.sh` with:

```sh
download_file() {
    local url="$1" dest="$2"

    # curl is required (native on RM520N-GL with TLS support).
    # No wget fallback — BusyBox wget lacks TLS, and Entware wget isn't
    # available this early in the bootstrap.
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL -o "$dest" "$url" 2>/dev/null && return 0
    fi

    return 1
}
```

- [ ] **Step 2: Verify syntax**

Run: `bash -n qmanager-installer.sh`
Expected: exit 0, no output.

- [ ] **Step 3: Verify no remaining wget references in the file**

Run: `grep -nE '\bwget\b|\buclient-fetch\b' qmanager-installer.sh`
Expected: no output (exit 1).

- [ ] **Step 4: Commit**

```bash
git add qmanager-installer.sh
git commit -m "refactor(installer): drop wget fallback from bootstrap downloader"
```

---

## Task 2: Main Installer (`scripts/install_rm520n.sh`) — replace 3 wget calls + add curl preflight

**Files:**
- Modify: `scripts/install_rm520n.sh:486-491` (Entware opkg/opkg.conf download)
- Modify: `scripts/install_rm520n.sh:621-633` (speedtest CLI download)
- Modify: `scripts/install_rm520n.sh` preflight section (add curl presence check)

**Context:** The installer downloads opkg + opkg.conf via `wget` and the Ookla speedtest archive via `wget || curl`. Curl is documented in CLAUDE.md as "native on RM520N-GL, has TLS support" — so we both replace these calls *and* add an explicit preflight that fails loudly if curl is missing on a non-standard image.

- [ ] **Step 1: Replace the Entware opkg downloads (lines 486–491)**

Find the block:

```sh
        # Download opkg binary and config
        wget -q "$ENTWARE_URL/opkg" -O /opt/bin/opkg \
            || die "Failed to download opkg from $ENTWARE_URL"
        chmod 755 /opt/bin/opkg
        wget -q "$ENTWARE_URL/opkg.conf" -O /opt/etc/opkg.conf \
            || die "Failed to download opkg.conf from $ENTWARE_URL"
        info "Downloaded opkg package manager"
```

Replace with:

```sh
        # Download opkg binary and config (curl-only — BusyBox wget lacks TLS)
        curl -fsSL -o /opt/bin/opkg "$ENTWARE_URL/opkg" \
            || die "Failed to download opkg from $ENTWARE_URL"
        chmod 755 /opt/bin/opkg
        curl -fsSL -o /opt/etc/opkg.conf "$ENTWARE_URL/opkg.conf" \
            || die "Failed to download opkg.conf from $ENTWARE_URL"
        info "Downloaded opkg package manager"
```

- [ ] **Step 2: Replace the speedtest CLI download (lines 621–633)**

Find the block:

```sh
        SPEEDTEST_URL="https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-armhf.tgz"
        SPEEDTEST_DIR="/usrdata/root/bin"
        mkdir -p "$SPEEDTEST_DIR"
        if wget -q "$SPEEDTEST_URL" -O /tmp/speedtest.tgz 2>/dev/null || \
           curl -fsSL "$SPEEDTEST_URL" -o /tmp/speedtest.tgz 2>/dev/null; then
```

Replace the `if` line and the `wget` line so the block becomes:

```sh
        SPEEDTEST_URL="https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-armhf.tgz"
        SPEEDTEST_DIR="/usrdata/root/bin"
        mkdir -p "$SPEEDTEST_DIR"
        if curl -fsSL "$SPEEDTEST_URL" -o /tmp/speedtest.tgz 2>/dev/null; then
```

Leave the `tar -xzf …` / `chmod +x` / `info …` body and the `else warn …` branch unchanged.

- [ ] **Step 3: Add a curl preflight check**

Locate the existing preflight section (search for the first `command -v` check after `set -e` near the top of the file — typically a check-tools block; if no such block exists, add it right after the `# --- Configuration -----` block and before any function definitions that depend on curl).

Add this check, placed alongside any existing tool checks (do not invent a new helper if a `check_*` style already exists — match the local idiom; otherwise inline):

```sh
# Hard requirement: curl with TLS. We removed all wget fallbacks intentionally.
if ! command -v curl >/dev/null 2>&1; then
    echo "ERROR: curl is required but not found in PATH. Aborting." >&2
    exit 1
fi
```

If the file already has a `check_root` / `check_platform` style and a `main()` orchestrator, add a `check_curl()` function next to them and call it from `main()` immediately after `check_platform`. Match local style.

- [ ] **Step 4: Verify syntax and absence of wget**

Run:
```
bash -n scripts/install_rm520n.sh
grep -nE '\bwget\b|\buclient-fetch\b' scripts/install_rm520n.sh
```
Expected: `bash -n` exits 0 with no output; grep produces no matches.

- [ ] **Step 5: Commit**

```bash
git add scripts/install_rm520n.sh
git commit -m "refactor(installer): drop wget; require curl preflight"
```

---

## Task 3: OTA Updater (`scripts/usr/bin/qmanager_update`) — curl-only `http_download`

**Files:**
- Modify: `scripts/usr/bin/qmanager_update:52-64` (`http_download` function)

**Context:** Background OTA worker. `http_download` currently tries curl → wget → uclient-fetch. Per the user decision, both fallbacks are removed.

- [ ] **Step 1: Replace `http_download`**

Find lines 52–64:

```sh
http_download() {
    local url="$1" dest="$2" timeout="${3:-120}"
    # curl first — BusyBox wget on RM520N-GL lacks TLS support for HTTPS URLs
    if command -v curl >/dev/null 2>&1; then
        curl -fSL --max-time "$timeout" -o "$dest" "$url"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "$dest" -T "$timeout" "$url"
    elif command -v uclient-fetch >/dev/null 2>&1; then
        uclient-fetch -qO "$dest" --timeout="$timeout" "$url"
    else
        return 1
    fi
}
```

Replace with:

```sh
http_download() {
    local url="$1" dest="$2" timeout="${3:-120}"
    # curl is the only supported transport (TLS, redirects, fail-on-4xx/5xx).
    if ! command -v curl >/dev/null 2>&1; then
        log "ERROR: curl not found — cannot download $url"
        return 1
    fi
    curl -fSL --max-time "$timeout" -o "$dest" "$url"
}
```

The `log` function is already defined at the top of `qmanager_update` (line 30) so the error line is captured in `/tmp/qmanager_update.log`.

- [ ] **Step 2: Verify**

Run:
```
bash -n scripts/usr/bin/qmanager_update
grep -nE '\bwget\b|\buclient-fetch\b' scripts/usr/bin/qmanager_update
```
Expected: bash -n exits 0; grep produces no matches.

- [ ] **Step 3: Commit**

```bash
git add scripts/usr/bin/qmanager_update
git commit -m "refactor(update): drop wget/uclient-fetch from http_download"
```

---

## Task 4: Auto-Update Cron (`scripts/usr/bin/qmanager_auto_update`) — curl-only release-list fetch

**Files:**
- Modify: `scripts/usr/bin/qmanager_auto_update:54-69` (the `fetched=…` block)

**Context:** Cron-driven update checker. Tries uclient-fetch → curl → wget. Reduce to curl-only.

- [ ] **Step 1: Replace the fetch block**

Find lines 54–69:

```sh
fetched=0
if command -v uclient-fetch >/dev/null 2>&1; then
    uclient-fetch -qO "$tmp_body" --timeout=15 "$api_url" 2>/dev/null && fetched=1
fi
if [ "$fetched" != "1" ] && command -v curl >/dev/null 2>&1; then
    curl -sL --max-time 15 -o "$tmp_body" "$api_url" 2>/dev/null && fetched=1
fi
if [ "$fetched" != "1" ] && command -v wget >/dev/null 2>&1; then
    wget -qO "$tmp_body" -T 15 "$api_url" 2>/dev/null && fetched=1
fi

if [ "$fetched" != "1" ] || [ ! -s "$tmp_body" ]; then
    qlog_warn "Failed to fetch releases from GitHub"
    rm -f "$tmp_body"
    exit 1
fi
```

Replace with:

```sh
fetched=0
if command -v curl >/dev/null 2>&1; then
    curl -sL --max-time 15 -o "$tmp_body" "$api_url" 2>/dev/null && fetched=1
fi

if [ "$fetched" != "1" ] || [ ! -s "$tmp_body" ]; then
    qlog_warn "Failed to fetch releases from GitHub (curl missing or network down)"
    rm -f "$tmp_body"
    exit 1
fi
```

- [ ] **Step 2: Verify**

Run:
```
bash -n scripts/usr/bin/qmanager_auto_update
grep -nE '\bwget\b|\buclient-fetch\b' scripts/usr/bin/qmanager_auto_update
```
Expected: bash -n exits 0; grep produces no matches.

- [ ] **Step 3: Commit**

```bash
git add scripts/usr/bin/qmanager_auto_update
git commit -m "refactor(auto-update): drop wget/uclient-fetch fallbacks"
```

---

## Task 5: Update CGI (`scripts/www/cgi-bin/quecmanager/system/update.sh`) — curl-only `http_api_fetch` + comment cleanup

**Files:**
- Modify: `scripts/www/cgi-bin/quecmanager/system/update.sh:75-96` (`http_api_fetch` function and its preceding comment)
- Modify: `scripts/www/cgi-bin/quecmanager/system/update.sh:252` (stale uclient-fetch comment)

**Context:** Frontend-facing CGI for "Check for updates". Currently curl → wget → uclient-fetch. Curl supports `-D <header_file>` for the rate-limit-detection capture; wget's `-S` was the closest equivalent and is no longer needed.

- [ ] **Step 1: Replace `http_api_fetch`**

Find lines 75–96:

```sh
# Fetch URL to a file, capturing HTTP headers for rate-limit detection.
# curl first — BusyBox wget on RM520N-GL lacks TLS support for HTTPS URLs.
http_api_fetch() {
    local url="$1" out_file="$2" header_file="$3" timeout="${4:-15}"

    # curl — supports HTTPS, -D captures response headers
    if command -v curl >/dev/null 2>&1; then
        curl -sL --max-time "$timeout" -o "$out_file" -D "$header_file" "$url" && return 0
    fi

    # wget (full wget-ssl supports -S; BusyBox wget may not handle HTTPS)
    if command -v wget >/dev/null 2>&1; then
        wget -qO "$out_file" -T "$timeout" -S "$url" 2>"$header_file" && return 0
    fi

    # uclient-fetch — OpenWRT only
    if command -v uclient-fetch >/dev/null 2>&1; then
        uclient-fetch -qO "$out_file" --timeout="$timeout" "$url" 2>"$header_file" && return 0
    fi

    return 1
}
```

Replace with:

```sh
# Fetch URL to a file, capturing HTTP headers for rate-limit detection.
# curl is the sole transport (TLS + -D header capture).
http_api_fetch() {
    local url="$1" out_file="$2" header_file="$3" timeout="${4:-15}"

    if ! command -v curl >/dev/null 2>&1; then
        return 1
    fi
    curl -sL --max-time "$timeout" -o "$out_file" -D "$header_file" "$url"
}
```

Note: relying on curl's exit status as the function's exit status is intentional and matches the previous `&& return 0` semantics — non-zero curl exit propagates to the caller as a fetch failure.

- [ ] **Step 2: Update the stale comment on line ~252**

Find:

```sh
    # Download URL from GitHub Releases (stable, redirect handled by uclient-fetch/curl)
```

Replace with:

```sh
    # Download URL from GitHub Releases (stable, redirect handled by curl -L)
```

- [ ] **Step 3: Verify**

Run:
```
bash -n scripts/www/cgi-bin/quecmanager/system/update.sh
grep -nE '\bwget\b|\buclient-fetch\b' scripts/www/cgi-bin/quecmanager/system/update.sh
```
Expected: bash -n exits 0; grep produces no matches.

- [ ] **Step 4: Commit**

```bash
git add scripts/www/cgi-bin/quecmanager/system/update.sh
git commit -m "refactor(update-cgi): curl-only http_api_fetch"
```

---

## Task 6: Public IP Probe (`scripts/www/cgi-bin/quecmanager/device/about.sh`) — drop wget branch

**Files:**
- Modify: `scripts/www/cgi-bin/quecmanager/device/about.sh:49-63` (the parallel-fetch IPv4/IPv6 block)

**Context:** Background public-IP lookup against api.ipify.org / api6.ipify.org. Currently curl preferred, wget fallback, else `pid4=""`. Drop the wget branch.

- [ ] **Step 1: Replace the fetch block**

Find lines 49–63:

```sh
if command -v curl >/dev/null 2>&1; then
    # -L: follow redirects; -k: tolerate missing CA certs (common on OpenWRT)
    ( curl -sLk --max-time "$PUB_IP_TIMEOUT" https://api.ipify.org > "$pub4_file" 2>/dev/null ) &
    pid4=$!
    ( curl -sLk --max-time "$PUB_IP_TIMEOUT" https://api6.ipify.org > "$pub6_file" 2>/dev/null ) &
    pid6=$!
elif command -v wget >/dev/null 2>&1; then
    ( wget -qO- -T "$PUB_IP_TIMEOUT" https://api.ipify.org > "$pub4_file" 2>/dev/null ) &
    pid4=$!
    ( wget -qO- -T "$PUB_IP_TIMEOUT" https://api6.ipify.org > "$pub6_file" 2>/dev/null ) &
    pid6=$!
else
    pid4=""
    pid6=""
fi
```

Replace with:

```sh
if command -v curl >/dev/null 2>&1; then
    # -L: follow redirects; -k: tolerate missing CA certs
    ( curl -sLk --max-time "$PUB_IP_TIMEOUT" https://api.ipify.org > "$pub4_file" 2>/dev/null ) &
    pid4=$!
    ( curl -sLk --max-time "$PUB_IP_TIMEOUT" https://api6.ipify.org > "$pub6_file" 2>/dev/null ) &
    pid6=$!
else
    pid4=""
    pid6=""
fi
```

- [ ] **Step 2: Verify**

Run:
```
bash -n scripts/www/cgi-bin/quecmanager/device/about.sh
grep -nE '\bwget\b|\buclient-fetch\b' scripts/www/cgi-bin/quecmanager/device/about.sh
```
Expected: bash -n exits 0; grep produces no matches.

- [ ] **Step 3: Commit**

```bash
git add scripts/www/cgi-bin/quecmanager/device/about.sh
git commit -m "refactor(about): drop wget fallback from public IP probe"
```

---

## Task 7: Console Manager (`scripts/usr/bin/qmanager_console_mgr`) — drop wget fallback for ttyd download

**Files:**
- Modify: `scripts/usr/bin/qmanager_console_mgr:31-39` (ttyd download block)

**Context:** Downloads ttyd binary (~1 MB armhf). Currently curl with wget fallback. Drop the wget branch.

- [ ] **Step 1: Replace the download block**

Find lines 31–39:

```sh
    echo "Downloading ttyd v${TTYD_VERSION}..."
    if ! curl -fSL -o "$TTYD_BIN" "$DOWNLOAD_URL" 2>/dev/null; then
        if ! wget -q -O "$TTYD_BIN" "$DOWNLOAD_URL" 2>/dev/null; then
            echo "ERROR: Failed to download ttyd" >&2
            rm -f "$TTYD_BIN"
            mount -o remount,ro / 2>/dev/null || true
            return 1
        fi
    fi
```

Replace with:

```sh
    echo "Downloading ttyd v${TTYD_VERSION}..."
    if ! curl -fSL -o "$TTYD_BIN" "$DOWNLOAD_URL" 2>/dev/null; then
        echo "ERROR: Failed to download ttyd" >&2
        rm -f "$TTYD_BIN"
        mount -o remount,ro / 2>/dev/null || true
        return 1
    fi
```

- [ ] **Step 2: Verify**

Run:
```
bash -n scripts/usr/bin/qmanager_console_mgr
grep -nE '\bwget\b|\buclient-fetch\b' scripts/usr/bin/qmanager_console_mgr
```
Expected: bash -n exits 0; grep produces no matches.

- [ ] **Step 3: Commit**

```bash
git add scripts/usr/bin/qmanager_console_mgr
git commit -m "refactor(console): drop wget fallback from ttyd downloader"
```

---

## Task 8: Documentation Sync (`CLAUDE.md`)

**Files:**
- Modify: `CLAUDE.md:113` (Tailscale note — drop the "or wget fallback" wording, since there is no wget anywhere)
- Modify: `CLAUDE.md` (add a one-line "HTTP transport" entry to the Removed/Deferred section, or as a new bullet near other invariants — see Step 2)

**Context:** CLAUDE.md is the canonical project memory. The Tailscale paragraph currently warns "do NOT add `-fSL`, timeouts, or wget fallback". After this change there is no wget anywhere in the project, so that phrasing should be tightened. We also want a single durable line that future contributors see when they open CLAUDE.md, stating the curl-only contract.

- [ ] **Step 1: Tighten the Tailscale wording**

In `CLAUDE.md`, find the substring:

```
Download lands in `/usrdata/` (persistent partition) via bare `curl -O` — **do NOT add `-fSL`, timeouts, or wget fallback**, these all contributed to the original hang.
```

Replace with:

```
Download lands in `/usrdata/` (persistent partition) via bare `curl -O` — **do NOT add `-fSL` or timeouts**, both contributed to the original hang.
```

(Use `Edit` with `old_string` containing the full sentence above to make the replacement unique.)

- [ ] **Step 2: Add a curl-only contract note**

Locate the bullet that begins `- **Installer internet resilience:**` (line ~111). Immediately after that bullet, insert a new bullet:

```
- **HTTP transport:** All network I/O (installer bootstrap, OTA updater, auto-update cron, GitHub API, public-IP probe, ttyd/speedtest downloads, Entware bootstrap) uses `curl` only. wget and uclient-fetch fallbacks were removed in 2026-05 — BusyBox wget on Quectel x5x/x6x platforms lacks TLS, and Entware wget would add ~5 MB to the install footprint. The installer fails fast in preflight if `curl` is missing.
```

- [ ] **Step 3: Verify the doc edit doesn't accidentally re-introduce wget**

Run:
```
grep -nE '\bwget\b' CLAUDE.md
```
Expected: matches only inside the new "HTTP transport" bullet (the words "wget and uclient-fetch fallbacks were removed" and "BusyBox wget on Quectel"). No active code-style references remain.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: codify curl-only HTTP transport contract"
```

---

## Task 9: Repo-wide Audit & Final Commit

**Files:** none modified — this task is the verification gate.

**Context:** Final sweep to make sure no wget or uclient-fetch reference snuck through (string fragments inside variable names, comments, etc.).

- [ ] **Step 1: Repo-wide scan for `wget`**

Run:
```
grep -rnE '\bwget\b' scripts/ qmanager-installer.sh CLAUDE.md docs/ README.md RELEASE_NOTES.md
```
Expected: matches only inside `CLAUDE.md`'s new "HTTP transport" bullet. Anything else under `scripts/`, the installer, README, RELEASE_NOTES, or docs is a regression — go back and fix.

- [ ] **Step 2: Repo-wide scan for `uclient-fetch`**

Run:
```
grep -rnE '\buclient-fetch\b' scripts/ qmanager-installer.sh CLAUDE.md docs/ README.md RELEASE_NOTES.md
```
Expected: zero matches anywhere.

- [ ] **Step 3: Syntax-check every script we touched in one shot**

Run (PowerShell):
```
foreach ($f in @(
    'qmanager-installer.sh',
    'scripts/install_rm520n.sh',
    'scripts/usr/bin/qmanager_update',
    'scripts/usr/bin/qmanager_auto_update',
    'scripts/usr/bin/qmanager_console_mgr',
    'scripts/www/cgi-bin/quecmanager/system/update.sh',
    'scripts/www/cgi-bin/quecmanager/device/about.sh'
)) { bash -n $f; if ($LASTEXITCODE -ne 0) { Write-Host "SYNTAX FAIL: $f"; break } }
```
Expected: no "SYNTAX FAIL" output.

- [ ] **Step 4: (Optional) Smoke-install on a target device**

If a development RM520N-GL is available:
1. Build the tarball (`bun run build:tarball` or the project's standard release flow).
2. SCP to device, run `install_rm520n.sh` from a fresh `/usrdata/qmanager/` removal — confirm Entware bootstrap downloads opkg via curl (watch the `info "Downloaded opkg package manager"` line).
3. Trigger an OTA check from the web UI — confirm it succeeds and the headers file populates.
4. Open the About card — confirm public IPv4/IPv6 populate.
5. Trigger ttyd install via Web Console card — confirm download succeeds.

If no device is available, skip this step and rely on the static checks above plus reviewer eyes.

- [ ] **Step 5: Update RELEASE_NOTES.md**

Append (or create) a New Features / Improvements entry for the next release. Match the style established in `feedback_release_notes_style.md` (New Features → Improvements, 1–2 sentence bullets, user-facing tone). Suggested text under **Improvements**:

```markdown
- Removed wget dependency from installer, OTA updater, and runtime CGIs — QManager now uses curl exclusively. This makes installs reliable on Quectel x5x/x6x firmwares that lack wget, and removes the ~5 MB Entware wget footprint that previous fallbacks would have required.
```

Edit `RELEASE_NOTES.md` to add this bullet under the next pending release block (do not edit shipped release sections).

- [ ] **Step 6: Final commit**

```bash
git add RELEASE_NOTES.md
git commit -m "docs(release): note curl-only transport in upcoming release"
```

---

## Self-Review Checklist (already applied)

- **Spec coverage:** All 8 wget call sites identified by `grep -rn` are covered (Tasks 1–7). Doc + audit covered (Tasks 8–9). uclient-fetch dead branches removed in Tasks 3, 4, 5 per user-confirmed scope expansion.
- **Placeholders:** None. Every `Edit` shows full old/new text. Every command shows expected output. No "implement later".
- **Type/identifier consistency:** Function names (`download_file`, `http_download`, `http_api_fetch`) preserved exactly. Existing log helpers (`log`, `qlog_warn`, `info`, `die`) re-used, not renamed. CLI flags align with each script's existing curl idiom (`-fsSL` installer/bootstrap, `-fSL --max-time` downloader, `-sL --max-time -D` API+headers, `-sLk --max-time` public-IP probe).
- **Side-effect risk:** The only behavioral change beyond removing fallbacks is the new curl preflight in `install_rm520n.sh`. RM520N-GL ships curl in the base image, so this is a defensive guard, not a new requirement.
