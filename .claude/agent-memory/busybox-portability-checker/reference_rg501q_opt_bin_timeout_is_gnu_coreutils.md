---
name: rg501q_opt_bin_timeout_is_gnu_coreutils
description: RG501Q-EU now has /opt/bin/timeout -> GNU coreutils 9.9 (installed 2026-08-25 via Entware), which platform.sh's qm_timeout prefers over BusyBox — updates the earlier "timeout is native-busybox-only" finding
type: reference
---

Confirmed live 2026-09-03 during Phase 5 validation of commit 7b1ba0f
(qmanager_ping qm_timeout adoption).

On RG501Q-EU, `/opt/bin/timeout` now exists and is a symlink to
`/opt/libexec/timeout-coreutils` — real GNU coreutils 9.9 (`timeout (GNU
coreutils) 9.9`), not a BusyBox applet. Symlink mtime is 2026-08-25, matching
the qm_timeout shim's ship date (26f5c31/f5f14e4) — an Entware package was
installed specifically to back it, or as a side effect of that rollout.

`/usr/bin/timeout` on RG501Q-EU is still the native BusyBox applet
(`/usr/lib/busybox/usr/bin/timeout`, BusyBox 1.29.3, legacy `-t SECS` form) —
[[rg501q_wget_timeout_applet_provenance]] is still correct about that binary.

**What changed:** `platform.sh`'s `qm_timeout` probe checks `/opt/bin/timeout`
FIRST via absolute-path `-x` test (not `$PATH` lookup), so it finds and
prefers this GNU coreutils binary over BusyBox's legacy applet — even under a
systemd unit's restricted PATH (`/usr/local/sbin:/usr/local/bin:/usr/sbin:
/usr/bin:/sbin:/bin`, no `/opt/bin`), because the check is `[ -x
/opt/bin/timeout ]`, an absolute path test, not a `$PATH` resolution.
Measured: `env -i PATH=<daemon PATH> sh -c '. platform.sh; echo
$_QM_TIMEOUT_BIN $_QM_TIMEOUT_FORM'` on RG501Q-EU returns
`/opt/bin/timeout positional` — NOT the legacy BusyBox path a naive reading
of "RG501Q-EU is 1.29.3, legacy-only" would predict.

**On RM520N-GL**, `/opt/bin/timeout` does not exist at all (`ls: No such file
or directory`), so the probe correctly falls through to `/usr/bin/timeout ->
/bin/busybox.nosuid` (BusyBox 1.31.1, positional-only).

**Implication for future portability checks:** don't assume which `timeout`
binary a device will use from its BusyBox version alone — Entware package
presence on `/opt/bin/timeout` can silently take precedence. Always probe
`_QM_TIMEOUT_BIN`/`_QM_TIMEOUT_FORM` live rather than predicting them, and
don't be surprised if a "money check" money-check result doesn't match the
BusyBox-version-implied expectation — it can still be correct.

See also [[qm_timeout_fallback_stdout_capture_confirmed]].
