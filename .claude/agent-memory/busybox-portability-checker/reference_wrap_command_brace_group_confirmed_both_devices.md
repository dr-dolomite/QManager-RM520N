---
name: busybox_wrap_command_brace_group_confirmed_both_devices
description: The GUI installer's wrap_command()/exec_stream() brace-group + conditional-separator + double-wrap-for-2>&1 pattern is confirmed syntactically and behaviorally identical on BusyBox ash 1.31.1 (RM520N-GL) AND 1.29.3 (RG501Q-EU).
type: reference
---

`installer-gui/src/qmanager_installer/core/transport/base.py`'s `wrap_command()` wraps every device
command as `{ cmd; }; echo __QM_RC=$?`, or `{ cmd & }; echo __QM_RC=$?` (no `;` before the closing
brace) when `cmd` already ends in a backgrounded `&` — this avoids the `& ;` syntax error that a bare
separator would produce for e.g. the reboot step. `ssh.py`'s `exec_stream` additionally wraps the
already-wrapped string one more time — `{ wrap_command(cmd); } 2>&1` — so that `2>&1` applies to the
whole group (including the user command's own stderr) rather than just the trailing `echo`.

Confirmed live on 2026-08-26, identical results on both devices:
- `{ true & }; echo __QM_RC=$?` — parses and returns rc=0 immediately, no syntax error, on both ash 1.31.1 and 1.29.3.
- `{ sync; (sleep 1; true) >/dev/null 2>&1 & }; echo __QM_RC=$?` (the exact shape of `installer.py`'s real `reboot_cmd`, with `true` substituted for `reboot` to keep the probe read-only) — same result on both: rc=0 returned immediately, background job doesn't block the echo.
- `{ { echo out; echo err 1>&2; }; echo __QM_RC=$?; } 2>&1` (the exact shape `exec_stream` sends) — both stdout and stderr lines came through merged and in order on both devices, RC line still parseable.

No divergence between the two BusyBox versions on any of the wrapper's control-flow shapes. This
closes out the audit item asking to verify the wrapper "under BusyBox ash specifically, not just
bash/dash" — it now also covers the older 1.29.3 build, not just the RM520N-GL reference target that
an earlier review had verified.

Also confirmed clean on both devices in the same session: `_SIMPLEADMIN_PROBE`'s `; true` fix (empty
loop still exits 0), `_DISK_PROBE`'s `df -k /tmp | awk 'NR==2 {print $4}'` (identical 6-column
tmpfs df output on both busybox df builds), and `sha256sum ... | awk '{print $1}'`. See
[[rg501q-wget-timeout-applet-provenance]] for the wget/timeout applet findings from the same pass.
