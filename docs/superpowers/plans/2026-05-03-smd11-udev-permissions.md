# /dev/smd11 udev-Based Permission Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the timing-dependent one-shot chmod in `qmanager_setup` with an event-driven udev rule that sets `/dev/smd11` to `root:dialout` mode `660` whenever the kernel creates the device — fixing PRAIRE platform (RG502Q/RM502Q) where the modem re-creates `smd11` after `qmanager-setup.service` runs, and adding modem-reset resilience to RM520N-GL.

**Architecture:** Drop two QManager-owned files: a high-priority udev rule (`99-qmanager-smd11.rules`) that fires on the kernel `add` event for `smd11`, and a tiny helper script (`qmanager_smd11_udev.sh`) that performs the chown + chmod. Installer copies them, reloads udev, and triggers the rule synchronously. The existing one-shot block in `qmanager_setup` stays as a belt-and-suspenders fallback (idempotent, costs ~1 syscall). No OEM file modification — rule priority `99-` ensures it runs after vendor rules. Same code path works on both platforms; no branching.

**Tech Stack:** udev (eudev/systemd-udev), POSIX sh, systemd, QManager installer (bash).

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `scripts/etc/udev/rules.d/99-qmanager-smd11.rules` | Create | udev rule firing the helper on `smd11` add events |
| `scripts/usr/lib/qmanager/qmanager_smd11_udev.sh` | Create | Helper that chowns/chmods `/dev/smd11` |
| `scripts/install_rm520n.sh` | Modify | Deploy the rule + helper, reload udev, trigger rule, log status |
| `scripts/uninstall_rm520n.sh` | Modify | Remove the rule + helper, reload udev |
| `scripts/usr/bin/qmanager_setup` | Modify | Keep existing chmod block but add comment explaining udev relationship |
| `docs/rm520n-gl-architecture.md` | Modify | Document the udev approach in the boot/permissions section |

---

## Task 1: Create the udev helper script

**Files:**
- Create: `scripts/usr/lib/qmanager/qmanager_smd11_udev.sh`

- [ ] **Step 1: Write the helper script**

Create `scripts/usr/lib/qmanager/qmanager_smd11_udev.sh` with this exact content:

```sh
#!/bin/sh
# =============================================================================
# qmanager_smd11_udev.sh — udev hook for /dev/smd11 permissions
# =============================================================================
# Invoked by /etc/udev/rules.d/99-qmanager-smd11.rules whenever the kernel
# emits an "add" event for /dev/smd11. Sets ownership to root:dialout and
# mode 660 so www-data (member of dialout) can open the device for AT
# commands via atcli_smd11.
#
# This runs in udev's minimal environment (no PATH, no controlling tty).
# Use absolute paths and avoid anything that needs stdout/stderr.
#
# Exit 0 unconditionally — udev logs RUN+= failures noisily and we do not
# want a missing /dev node (race between event and our handler) to spam the
# kernel log. The qmanager_setup oneshot covers any miss at boot.
# =============================================================================

DEVICE="/dev/smd11"

if [ -e "$DEVICE" ]; then
    /bin/chown root:dialout "$DEVICE" 2>/dev/null
    /bin/chmod 660 "$DEVICE" 2>/dev/null
fi

exit 0
```

- [ ] **Step 2: Verify the file has LF line endings**

Run: `file scripts/usr/lib/qmanager/qmanager_smd11_udev.sh`
Expected: `... ASCII text` (not `... with CRLF line terminators`).

If CRLF, run: `sed -i 's/\r$//' scripts/usr/lib/qmanager/qmanager_smd11_udev.sh`

- [ ] **Step 3: Commit**

```bash
git add scripts/usr/lib/qmanager/qmanager_smd11_udev.sh
git commit -m "feat(udev): add /dev/smd11 permission helper for udev"
```

---

## Task 2: Create the udev rule

**Files:**
- Create: `scripts/etc/udev/rules.d/99-qmanager-smd11.rules`

- [ ] **Step 1: Write the udev rule**

Create `scripts/etc/udev/rules.d/99-qmanager-smd11.rules` with this exact content:

```
# QManager: set /dev/smd11 to root:dialout mode 660 on every add event.
# Numeric prefix "99-" ensures this runs after OEM/vendor data_udev_rules.rules
# so we override their settings. ACTION=="add" prevents redundant firing on
# "change" or "remove" events.
KERNEL=="smd11", ACTION=="add", RUN+="/usr/lib/qmanager/qmanager_smd11_udev.sh"
```

- [ ] **Step 2: Verify the file has a trailing newline and LF endings**

Run: `tail -c 1 scripts/etc/udev/rules.d/99-qmanager-smd11.rules | od -c | head -1`
Expected: ends with `\n`.

Run: `file scripts/etc/udev/rules.d/99-qmanager-smd11.rules`
Expected: `ASCII text` (not CRLF).

- [ ] **Step 3: Commit**

```bash
git add scripts/etc/udev/rules.d/99-qmanager-smd11.rules
git commit -m "feat(udev): add /dev/smd11 add-event rule"
```

---

## Task 3: Wire the udev artifacts into the installer

**Files:**
- Modify: `scripts/install_rm520n.sh` (add an `install_udev_rules` step + call site + step counter)

- [ ] **Step 1: Add the install function**

Open `scripts/install_rm520n.sh`. Locate the `install_backend()` function (around line 523). After the function ends (closing `}` around line 693, before `# --- Fix Line Endings ---` at line 695), insert this new function:

```bash
# --- Install udev Rules ------------------------------------------------------

install_udev_rules() {
    step "Installing udev rules for /dev/smd11"

    local rule_src="$SRC_SCRIPTS/etc/udev/rules.d/99-qmanager-smd11.rules"
    local rule_dst="/etc/udev/rules.d/99-qmanager-smd11.rules"
    local helper_src="$SRC_SCRIPTS/usr/lib/qmanager/qmanager_smd11_udev.sh"
    local helper_dst="/usr/lib/qmanager/qmanager_smd11_udev.sh"

    if [ ! -f "$rule_src" ] || [ ! -f "$helper_src" ]; then
        warn "udev rule sources missing — skipping (smd11 perms rely on qmanager-setup oneshot)"
        return 0
    fi

    # Remount rootfs rw — /etc and /usr/lib live on the read-only root.
    mount -o remount,rw / 2>/dev/null || true

    mkdir -p /etc/udev/rules.d /usr/lib/qmanager

    cp "$helper_src" "$helper_dst"
    sed -i 's/\r$//' "$helper_dst"
    chmod 755 "$helper_dst"
    chown root:root "$helper_dst"
    info "Helper installed: $helper_dst"

    cp "$rule_src" "$rule_dst"
    sed -i 's/\r$//' "$rule_dst"
    chmod 644 "$rule_dst"
    chown root:root "$rule_dst"
    info "Rule installed: $rule_dst"

    sync

    # Reload rules and trigger an add event on smd11 so the rule fires now
    # (rather than waiting for the next reboot or modem reset).
    if command -v udevadm >/dev/null 2>&1; then
        udevadm control --reload-rules 2>/dev/null || warn "udevadm reload failed"
        if [ -e /dev/smd11 ]; then
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
        warn "udevadm not found — rule will activate at next reboot"
    fi
}
```

- [ ] **Step 2: Add the call site in `main()`**

In `scripts/install_rm520n.sh`, locate the `main()` function. Find this block (around line 1031-1036):

```bash
    if [ "$DO_BACKEND" = "1" ]; then
        install_backend
        fix_line_endings
        fix_permissions
        [ "$DO_ENABLE" = "1" ] && enable_services
    fi
```

Replace it with:

```bash
    if [ "$DO_BACKEND" = "1" ]; then
        install_backend
        install_udev_rules
        fix_line_endings
        fix_permissions
        [ "$DO_ENABLE" = "1" ] && enable_services
    fi
```

- [ ] **Step 3: Update the step counter**

In `main()` (around line 1017), find:

```bash
    [ "$DO_BACKEND" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 3 ))
```

Replace with:

```bash
    [ "$DO_BACKEND" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 4 ))
```

- [ ] **Step 4: Lint the installer for syntax**

Run: `bash -n scripts/install_rm520n.sh`
Expected: no output (syntax OK).

- [ ] **Step 5: Commit**

```bash
git add scripts/install_rm520n.sh
git commit -m "feat(installer): deploy udev rule for /dev/smd11 perms"
```

---

## Task 4: Wire the udev artifacts into the uninstaller

**Files:**
- Modify: `scripts/uninstall_rm520n.sh`

- [ ] **Step 1: Inspect the current uninstaller to find the right insertion point**

Run: `grep -n "rm -f\|rm -rf\|udev\|smd11" scripts/uninstall_rm520n.sh`

Identify the section that removes installed files (typically a block doing `rm -f /usr/bin/qmanager_*`, `rm -rf /usrdata/qmanager`, etc.).

- [ ] **Step 2: Add removal of udev rule + helper**

In `scripts/uninstall_rm520n.sh`, in the file-removal section identified above, add these lines (preserving the existing style — match the `info`/`warn`/quiet patterns already used in that file):

```bash
    # udev rule + helper (smd11 permissions)
    if [ -f /etc/udev/rules.d/99-qmanager-smd11.rules ]; then
        rm -f /etc/udev/rules.d/99-qmanager-smd11.rules
        info "Removed udev rule: 99-qmanager-smd11.rules"
    fi
    rm -f /usr/lib/qmanager/qmanager_smd11_udev.sh

    if command -v udevadm >/dev/null 2>&1; then
        udevadm control --reload-rules 2>/dev/null || true
    fi
```

If the uninstaller does not use `info`/`warn` helpers, drop them and use plain `echo` calls matching its style.

- [ ] **Step 3: Lint the uninstaller**

Run: `bash -n scripts/uninstall_rm520n.sh`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add scripts/uninstall_rm520n.sh
git commit -m "feat(uninstaller): remove smd11 udev rule and helper"
```

---

## Task 5: Annotate the `qmanager_setup` fallback

**Files:**
- Modify: `scripts/usr/bin/qmanager_setup` (lines 22-27)

- [ ] **Step 1: Update the comment block**

In `scripts/usr/bin/qmanager_setup`, find this block (lines 22-27):

```sh
# AT device permissions — www-data (via dialout group) needs read/write access
# /dev/smd11 defaults to crw------- root:root; must open it to dialout group
if [ -e /dev/smd11 ]; then
    chown root:dialout /dev/smd11
    chmod 660 /dev/smd11
fi
```

Replace it with:

```sh
# AT device permissions — www-data (via dialout group) needs read/write access.
# Primary mechanism: /etc/udev/rules.d/99-qmanager-smd11.rules fires on the
# kernel "add" event and sets these same permissions. This block is a
# belt-and-suspenders fallback for the case where the device exists at boot
# but the udev rule didn't apply (e.g. udev not loaded yet, rule file missing,
# or upgrade in progress). It is idempotent — safe to run when permissions
# are already correct.
if [ -e /dev/smd11 ]; then
    chown root:dialout /dev/smd11
    chmod 660 /dev/smd11
fi
```

- [ ] **Step 2: Verify the file is still valid POSIX sh**

Run: `sh -n scripts/usr/bin/qmanager_setup`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add scripts/usr/bin/qmanager_setup
git commit -m "docs(setup): note udev rule as primary smd11 perm mechanism"
```

---

## Task 6: Document the udev approach

**Files:**
- Modify: `docs/rm520n-gl-architecture.md`

- [ ] **Step 1: Find the right section**

Run: `grep -n "smd11\|permissions\|qmanager_setup\|udev" docs/rm520n-gl-architecture.md`

Identify the section discussing `/dev/smd11` permissions or the boot sequence (typically a "Permissions" or "Boot sequence" heading).

- [ ] **Step 2: Add a subsection**

In the relevant location, add this subsection (adjust heading depth `###` to match surrounding sections):

```markdown
### `/dev/smd11` permissions — udev rule

QManager owns `/etc/udev/rules.d/99-qmanager-smd11.rules`, which fires on
every kernel `add` event for `smd11` and runs
`/usr/lib/qmanager/qmanager_smd11_udev.sh`. The helper sets the device to
`root:dialout` mode `660` so `www-data` (member of `dialout`) can open it
via `atcli_smd11`.

Why udev instead of a one-shot at boot:

- On PRAIRE-derived platforms (e.g. RG502Q / RM502Q), the modem subsystem
  re-creates `/dev/smd11` *after* `qmanager-setup.service` runs, so the
  one-shot's `if [ -e /dev/smd11 ]` guard returns false and permissions are
  never set. udev fires the moment the device node exists.
- The rule also fires on in-session modem resets (firmware update,
  watchcat-triggered modem-only restart), restoring permissions without
  requiring a full system reboot.

The `qmanager_setup` one-shot retains the same `chown`/`chmod` as a
fallback in case udev hasn't loaded the rule yet. The two paths are
idempotent and never conflict.

The rule is removed by the uninstaller, which also reloads udev so the
removal takes effect immediately.
```

- [ ] **Step 3: Commit**

```bash
git add docs/rm520n-gl-architecture.md
git commit -m "docs: document udev-based smd11 permission rule"
```

---

## Task 7: On-device verification

**Files:** None modified — this task validates the deployed system.

- [ ] **Step 1: Build the install bundle**

Run from project root: `bun run build` (or whatever build command produces `out/` and the `qmanager.tar.gz` bundle — check existing CLAUDE.md / README for the canonical command).

Expected: a `qmanager.tar.gz` (or equivalent) ready to scp to the device.

- [ ] **Step 2: Transfer and install on a test RM520N-GL device**

```sh
# From host:
scp -O qmanager.tar.gz root@192.168.225.1:/tmp/

# On device (via SSH or web console):
cd /tmp && tar xzf qmanager.tar.gz
cd qmanager_install && bash install_rm520n.sh --no-reboot
```

Expected output during install includes the new step:
```
[Step N/M]
▶ Installing udev rules for /dev/smd11
    ✓  Helper installed: /usr/lib/qmanager/qmanager_smd11_udev.sh
    ✓  Rule installed: /etc/udev/rules.d/99-qmanager-smd11.rules
    ✓  Rule applied: /dev/smd11 = root:dialout 660
```

- [ ] **Step 3: Verify the rule fires on a synthetic add event**

On device:

```sh
udevadm test /sys/class/smdpkt/smd11 2>&1 | grep -E "RUN|qmanager"
```

Expected: includes a line referencing `/usr/lib/qmanager/qmanager_smd11_udev.sh`.

If the sysfs path differs, find the right one with: `find /sys -name "smd11" 2>/dev/null`.

- [ ] **Step 4: Verify permissions reset survives a manual chmod tampering**

On device:

```sh
chmod 600 /dev/smd11
chown root:root /dev/smd11
stat -c '%U:%G %a' /dev/smd11
# Expected: root:root 600

udevadm trigger --action=add /dev/smd11
udevadm settle
stat -c '%U:%G %a' /dev/smd11
# Expected: root:dialout 660
```

- [ ] **Step 5: Verify permissions survive a reboot**

On device:

```sh
reboot
# Wait 60s, reconnect, then:
stat -c '%U:%G %a' /dev/smd11
# Expected: root:dialout 660
```

Also verify the poller is healthy:

```sh
systemctl is-active qmanager-poller
# Expected: active
journalctl -u qmanager-poller --since "2 minutes ago" | grep -i "smd11\|permission\|denied"
# Expected: no permission/denied errors
```

- [ ] **Step 6: Verify www-data can actually use the device**

On device:

```sh
sudo -u www-data /usr/bin/atcli_smd11 "AT"
# Expected: OK response within ~1s
```

- [ ] **Step 7: Sanity-check uninstall removes the rule**

On device:

```sh
bash /tmp/qmanager_install/uninstall_rm520n.sh --no-reboot
ls /etc/udev/rules.d/99-qmanager-smd11.rules 2>&1
# Expected: "No such file or directory"
ls /usr/lib/qmanager/qmanager_smd11_udev.sh 2>&1
# Expected: "No such file or directory"
```

Then re-install for normal operation:

```sh
cd /tmp/qmanager_install && bash install_rm520n.sh --no-reboot
```

- [ ] **Step 8: Record results and commit a verification note (optional)**

If any step revealed a deviation (e.g. PRAIRE has no `dialout` group, sysfs path differs), update the affected task above and re-run the affected verification step. Commit any plan corrections separately:

```bash
git add docs/superpowers/plans/2026-05-03-smd11-udev-permissions.md
git commit -m "docs(plan): adjust smd11 udev plan based on device verification"
```

---

## Notes for the Implementer

- **PRAIRE platform note:** The plan does not include platform branching because the udev rule is platform-agnostic. If on-device verification (Task 7) shows that PRAIRE lacks a `dialout` group or that `www-data` is not a member, the helper's `chown` target needs adjusting per-platform. In that case, add a `getent group dialout` check inside `qmanager_smd11_udev.sh` and fall back to `chown root:www-data` — but only after confirming the actual platform state. Do not pre-emptively branch.

- **Why `99-` prefix:** udev processes rules files in lexical order. OEM rules typically live in lower-numbered files (`50-`, `60-`, etc.). Our `99-` runs last, so we always win the final `chown`/`chmod`.

- **Why `ACTION=="add"`:** Without it, the rule fires on `change` and `remove` events too. On `remove`, the helper runs against a non-existent device — harmless because of our `[ -e ]` guard, but noisy in the kernel log.

- **Why `exit 0` unconditionally in the helper:** udev treats any non-zero exit from `RUN+=` as an error worth logging. A transient race where the device disappears between the event firing and our `chown` is not actionable — the next event will re-fire the rule.

- **No TDD here:** Shell + udev + device-node interactions don't have a meaningful unit-test surface inside this repo. Verification is on-device (Task 7). If a future change adds testable logic (e.g., the helper grows conditionals), add a shellcheck pass and a sourceable test fixture at that point.
