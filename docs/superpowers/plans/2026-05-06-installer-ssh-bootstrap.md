# Installer SSH Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On fresh RM520N-GL installs, automatically bootstrap dropbear SSH with the temporary root password `qmanager` so the user can SSH in immediately, without first completing web-UI onboarding. On OTA upgrades and systems where SSH is already present, do nothing.

**Architecture:** Add a single new function `setup_ssh_early()` to `scripts/install_rm520n.sh`. It runs once, immediately after `install_dependencies`, gated by a fresh-install check (`/etc/qmanager/VERSION` absent) and a port-22 safety check. Failure is non-fatal and surfaces in the post-install summary via a `SSH_BOOTSTRAP_STATUS` shell variable. The existing late, interactive `setup_ssh()` function and its call are removed.

**Tech Stack:** POSIX shell (BusyBox-compatible) + bash; systemd; Entware opkg; dropbear; openssl `passwd -1` for MD5-crypt hash.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `scripts/install_rm520n.sh` | Modified | Add `SSH_BOOTSTRAP_STATUS` variable, add `setup_ssh_early()` function, wire into `main()` after `install_dependencies`, extend `print_summary()` to display SSH status, remove old `setup_ssh()` function and its call. |

No other files are modified. Onboarding, sudoers, the `qmanager_set_ssh_password` helper, and the firewall service are all unchanged.

---

## Conventions used by this script

The plan refers to these globals (already defined in `install_rm520n.sh`) — do not redefine them:

- `SYSTEMD_DIR=/lib/systemd/system`
- `WANTS_DIR=/lib/systemd/system/multi-user.target.wants`
- `SRC_DEPS=$INSTALL_DIR/dependencies`
- `OPKG=/opt/bin/opkg`
- `CONF_DIR=/etc/qmanager` (so the VERSION file lives at `$CONF_DIR/VERSION`)
- Color vars: `BOLD`, `DIM`, `NC`, `GREEN`, `YELLOW`
- Helpers: `info "msg"`, `warn "msg"`, `error "msg"`

The script uses `set -e` at the top. Functions that may "fail" without aborting must use `... || { ...; return 0; }` patterns and never use a bare `[ ]` test as the last statement (per project memory `feedback_set_e_traps.md`).

---

## Task 1: Add `SSH_BOOTSTRAP_STATUS` initial value

**Files:**
- Modify: `scripts/install_rm520n.sh` (Configuration section, near line 98)

- [ ] **Step 1: Add the status variable**

Open `scripts/install_rm520n.sh`. Find the line:

```bash
# Watchcat lock prevents Tier-4 reboot during install
WATCHCAT_LOCK="/tmp/qmanager_watchcat.lock"
```

Immediately after the `WATCHCAT_LOCK=...` line, add:

```bash
# Status of early SSH bootstrap; set by setup_ssh_early(), read by print_summary().
# Values: installed | skipped_ota | skipped_existing | failed_install | failed_unit | failed_start | failed_password | not_run
SSH_BOOTSTRAP_STATUS="not_run"
```

- [ ] **Step 2: Syntax check**

Run: `bash -n scripts/install_rm520n.sh`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/install_rm520n.sh
git commit -m "installer: add SSH_BOOTSTRAP_STATUS state variable"
```

---

## Task 2: Add the `setup_ssh_early()` function

**Files:**
- Modify: `scripts/install_rm520n.sh` (insert new function before the existing `setup_ssh()` definition, around line 1235)

- [ ] **Step 1: Insert the function**

Open `scripts/install_rm520n.sh`. Find the existing comment line:

```bash
# --- SSH Setup (Optional) ----------------------------------------------------
```

Immediately **before** that section, insert this entire block:

```bash
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
        if [ ! -f "$SYSTEMD_DIR/dropbear.service" ]; then
            warn "Failed to write dropbear.service"
            SSH_BOOTSTRAP_STATUS="failed_unit"
            return 0
        fi
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

    SSH_BOOTSTRAP_STATUS="installed"
    info "Root password set to 'qmanager' (will be replaced on web onboarding)"
}

```

- [ ] **Step 2: Syntax check**

Run: `bash -n scripts/install_rm520n.sh`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/install_rm520n.sh
git commit -m "installer: add setup_ssh_early for fresh-install SSH bootstrap"
```

---

## Task 3: Wire `setup_ssh_early` into `main()` and remove old call

**Files:**
- Modify: `scripts/install_rm520n.sh` (`main()`, around lines 1424–1451)

- [ ] **Step 1: Insert the new call after `install_dependencies`**

Find this block in `main()`:

```bash
    [ "$DO_PACKAGES" = "1" ] && install_dependencies

    stop_services
```

Replace it with:

```bash
    [ "$DO_PACKAGES" = "1" ] && install_dependencies

    # SSH bootstrap runs after install_dependencies so Entware + bundled
    # dropbear .ipk are available, and before stop_services so it never has
    # to wait on QManager service teardown.
    setup_ssh_early

    stop_services
```

- [ ] **Step 2: Remove the old late call**

Find this line further down in `main()`:

```bash
    setup_ssh
```

(It appears once, on a line of its own, between `at_stack_check` and `print_summary`.)

Delete the line entirely (including its trailing newline so we don't leave a blank double-line).

- [ ] **Step 3: Update `TOTAL_STEPS` accounting**

`setup_ssh_early` calls `step "..."`, which increments `CURRENT_STEP` against `TOTAL_STEPS`. We need `TOTAL_STEPS` to grow by 1 to keep the `[Step N/M]` display correct.

Find this block in `main()`:

```bash
    # Calculate steps: preflight always runs; others are conditional
    TOTAL_STEPS=3  # preflight + stop_services + cleanup_legacy_scripts
```

Change the value and comment to:

```bash
    # Calculate steps: preflight always runs; others are conditional
    TOTAL_STEPS=4  # preflight + setup_ssh_early + stop_services + cleanup_legacy_scripts
```

- [ ] **Step 4: Syntax check**

Run: `bash -n scripts/install_rm520n.sh`
Expected: no output, exit code 0.

- [ ] **Step 5: Confirm the old `setup_ssh` is no longer called**

Run: `grep -nE 'setup_ssh($|[^_])' scripts/install_rm520n.sh`
(The regex matches `setup_ssh` only when it is NOT followed by `_` — i.e. excludes `setup_ssh_early`.)
Expected: exactly one match — the old function's definition line `setup_ssh() {` (still present in the file; will be deleted in Task 5). No call sites.

If the output shows more than one line, a call site was missed — return to Step 2 and find it.

- [ ] **Step 6: Commit**

```bash
git add scripts/install_rm520n.sh
git commit -m "installer: call setup_ssh_early after install_dependencies; drop late setup_ssh call"
```

---

## Task 4: Show SSH status in `print_summary`

**Files:**
- Modify: `scripts/install_rm520n.sh` (`print_summary()`, around lines 1342–1366)

- [ ] **Step 1: Add SSH summary lines**

Find the `print_summary()` function. Locate this block near the end of the function:

```bash
    printf "\n"
    printf "  Open in browser:  ${BOLD}https://192.168.225.1${NC}\n"
    printf "  Web console:      ${BOLD}https://192.168.225.1/console${NC}\n\n"

    if [ ! -f "$CONF_DIR/auth.json" ]; then
        info "First-time setup: you will be prompted to create a password"
    fi
    printf "\n"
}
```

Replace it with:

```bash
    printf "\n"
    printf "  Open in browser:  ${BOLD}https://192.168.225.1${NC}\n"
    printf "  Web console:      ${BOLD}https://192.168.225.1/console${NC}\n"

    case "$SSH_BOOTSTRAP_STATUS" in
        installed)
            printf "  SSH:              ${BOLD}ssh root@192.168.225.1${NC} ${DIM}(temp password: qmanager — replaced on web onboarding)${NC}\n"
            ;;
        failed_install|failed_unit|failed_start|failed_password)
            printf "  ${YELLOW}${BOLD}SSH bootstrap failed${NC} (${SSH_BOOTSTRAP_STATUS}). Re-run installer or set up dropbear manually.\n"
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
```

- [ ] **Step 2: Syntax check**

Run: `bash -n scripts/install_rm520n.sh`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/install_rm520n.sh
git commit -m "installer: surface SSH bootstrap result in summary"
```

---

## Task 5: Remove the old `setup_ssh()` function

**Files:**
- Modify: `scripts/install_rm520n.sh` (delete the old function, lines ~1235–1338)

- [ ] **Step 1: Confirm no callers remain**

Run: `grep -n 'setup_ssh\b' scripts/install_rm520n.sh`
Expected: only the function definition remains (`setup_ssh() {` on one line); no call sites — `setup_ssh_early` matches a different word and should not appear in the output.

If a caller appears, do not delete the function — return to Task 3 and remove the missed caller first.

- [ ] **Step 2: Delete the old function**

Find this comment header:

```bash
# --- SSH Setup (Optional) ----------------------------------------------------
```

Delete that header line and every line of the `setup_ssh()` function up to and including its closing `}`. The deletion ends with the line:

```bash
    info "SSH setup complete — connect via: ssh root@192.168.225.1"
}
```

The next line in the file should be the start of the next section:

```bash
# --- Summary -----------------------------------------------------------------
```

- [ ] **Step 3: Syntax check**

Run: `bash -n scripts/install_rm520n.sh`
Expected: no output, exit code 0.

- [ ] **Step 4: Confirm `setup_ssh` is fully gone**

Run: `grep -n 'setup_ssh\b' scripts/install_rm520n.sh`
Expected: no matches at all (the only remaining function name is `setup_ssh_early`, which `\b` boundary excludes).

- [ ] **Step 5: Commit**

```bash
git add scripts/install_rm520n.sh
git commit -m "installer: remove obsolete late setup_ssh function"
```

---

## Task 6: On-device verification

This is shell code that runs on a real RM520N-GL device — there is no automated test harness for the installer. Run through the four scenarios below on a target device to confirm behavior.

The build/transfer commands assume the standard QManager build flow (project memory: use `bun` for builds; run from project root in PowerShell).

- [ ] **Step 1: Build the install tarball**

Run from project root: `bun run build:install`
Expected: produces `qmanager.tar.gz` (or whatever this project's build script outputs — check `package.json` `scripts.build:install`). If the build script name differs, use the project's documented packaging command. The artifact must contain the modified `install_rm520n.sh` and the bundled `dropbear*.ipk` under `dependencies/`.

- [ ] **Step 2: Transfer to a clean-flashed RM520N-GL device**

This requires a device with **no prior QManager install** (no `/etc/qmanager/VERSION` file). Confirm with:

`ssh root@<device-ip> 'ls -l /etc/qmanager/VERSION 2>&1'`
Expected: `No such file or directory`.

If a previous install exists, either re-flash the device or remove `/etc/qmanager/VERSION` to simulate a fresh install for this verification.

Then transfer:

```powershell
scp -O qmanager.tar.gz root@<device-ip>:/tmp/
ssh root@<device-ip> 'cd /tmp && tar xzf qmanager.tar.gz && cd qmanager_install && bash install_rm520n.sh --no-reboot'
```

(`-O` for legacy SCP per project memory `feedback_scp_legacy_mode.md`.)

- [ ] **Step 3: Verify Scenario A — fresh install, no SSH present**

During the install you should see a `[Step N/M] ▶ Bootstrap SSH (fresh install)` block with these `info` lines (subset acceptable depending on prior state):

- `dropbear already installed` (or one of the install-from-package lines)
- `Created dropbear.service` (first run)
- `dropbear started on port 22`
- `Root password set to 'qmanager' (will be replaced on web onboarding)`

The final summary should include the line:
`SSH:              ssh root@192.168.225.1 (temp password: qmanager — replaced on web onboarding)`

From the developer host:

```powershell
ssh root@<device-ip>
# When prompted for password, enter: qmanager
```

Expected: login succeeds. Run `systemctl is-active dropbear` — expected `active`.

- [ ] **Step 4: Verify Scenario B — re-run installer (now an "OTA")**

On the same device, run:

`ssh root@<device-ip> 'cd /tmp/qmanager_install && bash install_rm520n.sh --no-reboot'`

In the install output, the `Bootstrap SSH (fresh install)` step should print:
`OTA upgrade detected — skipping SSH bootstrap`

The summary should NOT contain the `SSH:` line.

The root password set in Scenario A should still work (the bootstrap was skipped, so it wasn't reset).

- [ ] **Step 5: Verify Scenario C — port 22 already in use**

Simulate this only if you have a second device or an OEM image with SSH already running. On a device with `/etc/qmanager/VERSION` removed but a pre-existing dropbear active, re-run the installer.

Expected output line during the SSH step:
`SSH already running on port 22 — skipping bootstrap`

The summary should NOT contain the `SSH:` line.

- [ ] **Step 6: Verify Scenario D — onboarding overwrites the bootstrap password**

After Scenario A, open `https://<device-ip>/` in a browser, complete onboarding with a new password (e.g. `mynewpass`).

Then from the developer host:

```powershell
ssh root@<device-ip>
# qmanager → expect FAIL
# mynewpass → expect SUCCESS
```

This confirms the existing onboarding → `qmanager_set_ssh_password` path still overwrites the temporary bootstrap password as designed.

- [ ] **Step 7: Final commit only if any verification fixes were needed**

If Scenarios A–D all pass on the first try, no commit is needed — the implementation is complete.

If any scenario fails, return to the relevant Task (1–5), fix, re-run `bash -n`, rebuild the tarball, and re-verify the failing scenario only.
