---
name: rg501q-wget-timeout-applet-provenance
description: On RG501Q-EU (BusyBox 1.29.3), timeout IS a native busybox applet (present on a fresh device); only wget is genuinely Entware-only. RM520N-GL (BusyBox 1.31.1) ships both natively.
type: reference
---

Confirmed live on 2026-08-26 via `busybox 2>&1 | grep -A200 "Currently defined functions"` on both
devices, cross-checked against `readlink -f` and symlink mtimes.

**RM520N-GL (BusyBox 1.31.1):** `/usr/bin/wget` and `/usr/bin/timeout` are BOTH symlinks to
`/bin/busybox.nosuid`, and both `wget` and `timeout` appear in busybox's own applet list. Both are
native BusyBox applets, present on a stock device with zero Entware involvement.

**RG501Q-EU (BusyBox 1.29.3):** `/usr/bin/timeout` -> `/usr/lib/busybox/usr/bin/timeout`, a native
BusyBox applet (`timeout` appears in the applet list; the symlink's mtime — Feb 21 2025 13:xx —
matches this device's own firmware `Package Time`, i.e. it ships in the image, not something
QManager's Entware bootstrap created). `/usr/bin/wget` -> `/opt/bin/wget` -> `/opt/libexec/wget-ssl`
(Entware's GNU Wget 1.25.0); **`wget` does NOT appear in busybox 1.29.3's own applet list at all** —
it was excluded at build time. The wget symlink's mtime (Aug 25 2025) is long after the firmware
build date, confirming it was created during on-device Entware provisioning, not shipped in the image.

**Correction to prior assumption:** the two applets were previously grouped together as "Entware-only
on RG501Q" (see `docs/reference/platform-matrix.md` / installer preflight known-facts). That is true
for `wget` but FALSE for `timeout` — `timeout` is available on a genuinely fresh, never-provisioned
RG501Q via BusyBox itself. Matters for any future preflight/probe logic that assumes "no Entware yet"
implies "no timeout command" on this device; it doesn't. (It does NOT affect
`installer-gui`'s current commands — that codebase never invokes `timeout` on the device at all,
only via Python-side/paramiko wall-clock timeouts and self-bounded `curl --max-time` /
`wget -T` flags baked into the probe strings themselves.)

Both devices' `/usr/bin/wget` — whether the BusyBox applet (RM520N-GL) or Entware's GNU Wget
(RG501Q-EU) — accept the short flags `-q -T <secs> -O <file>` used by
`installer-gui/src/qmanager_installer/core/preflight.py`'s `_ENTWARE_PROBE`; confirmed live on both
(BusyBox wget's `--help` lists `-T SEC` / `-O FILE` explicitly; GNU wget accepts the same short
forms). Neither wget build accepts GNU long-form `--version`/`-V` cross-consistently (BusyBox wget
rejects `-V` outright), so never rely on `wget --version`/`-V` output parsing for a version probe on
this project's devices — `command -v wget` plus a real fetch attempt is the only reliable liveness
check, consistent with the project's existing "verdict from behaviour, not from a name resolving" rule.

See also [[busybox_wrap_command_brace_group_confirmed_both_devices]].
