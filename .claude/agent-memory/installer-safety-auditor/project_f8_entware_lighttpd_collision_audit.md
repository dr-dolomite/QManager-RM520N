---
name: project_f8_entware_lighttpd_collision_audit
description: Phase 1 gate findings for F8 (rc.unslung.service races QManager's lighttpd.service at boot) — which candidate fix actually survives OTA, and why
type: project
---

F8 (docs/reference/platform-matrix.md:343): `rc.unslung.service` (install_rm520n.sh:1046-1063)
runs every `/opt/etc/init.d/S*` script including Entware's `S80lighttpd`, which races
QManager's own `lighttpd.service` (installed :1500-1508, enabled :2929-2933) at every boot —
no `Conflicts=`/`Before=`/`After=` between them. Live-confirmed on RG501Q-EU 2026-08-25:
Entware imposter won port 80, UI unreachable on both HTTP and HTTPS.

**Why this matters for any fix candidate — the two guard-vs-overwrite facts:**

1. `rc.unslung.service`'s content is written **only once ever**, guarded by
   `if [ ! -f /lib/systemd/system/rc.unslung.service ]` (install_rm520n.sh:1046). OTA
   (`qmanager_update`) always runs `--skip-packages`, which gates OFF `install_dependencies()`
   entirely (main():3532 `[ "$DO_PACKAGES" = "1" ] && install_dependencies`) — so this whole
   block, including the guard, never even runs on OTA. **Any fix that requires editing
   `rc.unslung.service`'s own content will never reach an already-installed device**, only
   fresh installs.
2. `lighttpd.service` is reinstalled **unconditionally every run** (:1503-1508, inside
   `install_backend()` which is NOT gated by `DO_PACKAGES` — runs on every OTA too) via
   `install_file()` (:281-294), which always does a full `cp`+CRLF-strip+`chmod`+`mv`, never
   a skip-if-exists. **A fix that only edits `lighttpd.service`'s content (Candidate 1) is
   OTA-deliverable to every existing device on their next update.** This asymmetry is the
   single biggest lever in choosing between the two candidates.

**S80lighttpd provenance — confirmed, not a QManager-authored file.** It arrives as a side
effect of Entware's `lighttpd` package (`opkg install lighttpd` / `opkg upgrade lighttpd ...`,
install_rm520n.sh:1104-1111), which only runs inside `install_dependencies()` — same
`DO_PACKAGES` gate as above, so OTA never touches it either. Confirmed no other opkg install
in the file (sudo, jq, curl, coreutils-timeout, dropbear, msmtp) is a plausible source of a
second init.d web server. Standard opkg/Entware behavior (not directly testable from this
repo) is that init.d scripts are data files, not conffiles, so a **package version bump**
that triggers a real reinstall (not the same-version no-op most `opkg upgrade` calls hit)
would silently restore a chmod'd-off or renamed `S80lighttpd` to its default armed state —
this makes Candidate 2 (neutralize S80lighttpd) non-robust unless the neutralization step is
reapplied unconditionally every run, not applied once.

**The idiom that solves the OTA-reach problem**: `remove_conflicts()` (install_rm520n.sh:555-576)
and `ensure_zoneinfo_packages()` (:591 comment block, :584-589) both run **unconditionally in
main(), even with `--skip-packages`** specifically because OTA always passes that flag and a
step gated behind `install_dependencies()` would "stay silently broken forever for every
existing user" (:585-589, their own words). Any S80lighttpd-neutering step must be pulled out
of `install_dependencies()` and given this same always-run treatment to actually reach OTA'd
devices — see [[project_ota_skips_packages]].

**Uninstaller does NOT restore rc.unslung.service or S80lighttpd.** `uninstall_rm520n.sh:112-115`
(`rm -f /lib/systemd/system/rc.unslung.service` etc.) is inside the `usage()` help-text
function, printed only for `--help`/bad args — never executed. The uninstaller's actual Step 2
(:311-316) only removes QManager's own `lighttpd.service` override ("restores Entware default"
per its own comment) and never touches `rc.unslung.service` or anything under
`/opt/etc/init.d/`. Confirmed by grep: no other rc.unslung/S80lighttpd reference in the
uninstaller. This means: if Candidate 2 permanently neuters S80lighttpd (chmod -x or rename to
K80lighttpd) and ships, then `uninstall` (which removes QManager's lighttpd.service but leaves
Entware's rc.unslung.service running unconditionally by design) leaves the device with **no
working web server at all** post-uninstall — the uninstaller must be extended to restore
S80lighttpd if a neutering fix is chosen.

**Mount topology note**: `/opt/etc/init.d/S80lighttpd` lives on `/opt` = bind-mounted
`/usrdata/opt`, part of the always-rw ubi2_0 volumes (see
[[project_mount_topology]]) — NOT rootfs. Candidate 2's chmod/rename needs **no**
`mount -o remount,rw /` and **no** `sync` before it; that discipline only applies to the
rootfs-resident unit-file writes Candidate 1 would touch (which already `sync` at :1509).

**No collision happens during the install run itself** — confirmed no `systemctl start
rc.unslung` or `systemctl start rc.unslung.service` anywhere in install_rm520n.sh; it's only
wants-symlinked for the next boot (:1060-1061), never started synchronously. The race is
strictly a boot-time phenomenon (fresh-install reboot, or any later reboot on an
already-provisioned device — since rc.unslung.service, once created, is never revisited by
OTA per the guard above).

**Precedent for Candidate 1's mechanism**: the codebase already uses `After=`/`Before=`
extensively between qmanager-*.service units (e.g. qmanager-firewall.service:4
`Before=qmanager-setup.service lighttpd.service`) — ordering directives are idiomatic here.
`Conflicts=` is used nowhere yet in this repo — would be a first.

**Blast radius of rc.unslung beyond S80lighttpd**: cannot be determined from the repo — this
is live `/opt/etc/init.d/S*` enumeration on the device, not something the installer/uninstaller
source encodes. Do not guess at this from repo state alone.

See also [[project_ota_skips_packages]], [[project_mount_topology]],
[[project_installer_bare_mv_aborts_ota_after_stop_services]] (same "guarded, so OTA never
re-touches it" bug family as the rc.unslung.service `if [ ! -f ]` guard).
