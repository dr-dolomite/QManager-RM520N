# Bootloop rescue

Recovery tooling for an RM520N-GL that is rebooting itself in a loop and is
only reachable over SSH for a few seconds per cycle.

**Not shipped to the device.** `scripts-dev/` sits outside the installer's
`SRC_SCRIPTS` root — this is a workstation tool.

## The idea

Racing a tiny SSH window over and over to "run the fix" is a losing game,
because every attempt costs you a full cycle and most of them lose. So don't
race it repeatedly. Win it **once**, and use that one win to take away the
device's ability to reboot:

```
systemctl mask reboot.target systemd-reboot.service
+ replace /sbin/reboot with a stub that logs its caller
```

After that the loop stops, the device stays up indefinitely, and every
subsequent step is unhurried. All of it is reversible with `-Restore`.

On this platform `/sbin/reboot` is a **symlink to `/bin/systemctl`**, not to
BusyBox — so `reboot` is really `systemctl reboot`, which starts
`reboot.target`. That's why masking the target is the load-bearing half:
a binary stub alone would be bypassed by anything calling `systemctl reboot`
directly. The stub is kept anyway, because it records *who* called it.

## Usage

```powershell
Install-Module Posh-SSH -Scope CurrentUser   # once

# Start this FIRST, then power on the modem.
.\Rescue-BootloopModem.ps1

# Look, change nothing (may be cut short — the loop is still running):
.\Rescue-BootloopModem.ps1 -DiagOnly

# Give the device back its reboot capability once it's healthy:
.\Rescue-BootloopModem.ps1 -Restore
```

Credentials come from `.env` (`MODEM_IP`, `MODEM_SSH_USER`,
`MODEM_SSH_PASSWORD`) or from `-ModemIP` / `-User` / `-Password`.

## Reading the result

The whole point is this section of the diagnostics:

```
########## WHO HAS BEEN CALLING REBOOT ##########
```

| What you see | What it means |
|---|---|
| A named process (e.g. `qmanager_watchcat`, `qmanager_update`) | That's the culprit. It is now harmless — `reboot` is a no-op — so fix it calmly. |
| **Empty**, while the device stays up | Nothing in userspace is calling reboot. The resets come from below: kernel panic, hardware watchdog, or a modem-side subsystem restart. Masking QManager was never going to help. |
| **Empty**, and it *still* reboots | Same conclusion, more strongly — the reset bypasses userspace entirely. Look at `dmesg` and `/var/log/messages.0` in the diagnostics. |

That second row is the case worth planning for: if masking QManager didn't
stop the loop, this tool's job is as much to **rule QManager out** as to fix it.

## What it changes on the device

| Path | Purpose | Undone by `-Restore` |
|---|---|---|
| `/etc/qmrescue/` | State, saved originals, logs | left in place (harmless, and it's the evidence) |
| `/sbin/reboot` | Replaced with logging stub | yes |
| `reboot.target`, `systemd-reboot.service` | Masked | yes |
| `/usr/bin/qmanager_{scheduled_reboot,auto_update,update,watchcat}` | Stubbed (originals in `/etc/qmrescue/backup/`) | yes |
| `timers.target.wants/qmanager-*.timer` | Unlinked | **no** — deliberate; re-enable schedules from the UI |

A transcript of every run is written next to the script as
`rescue-YYYYMMDD-HHMMSS.log`.

## Safety

- Every payload is `sh -n`-validated against the device's real BusyBox ash.
- Stage A is idempotent — if a cycle cuts it off, just re-run.
- Nothing is deleted; originals are copied aside first.
- If `-Restore` reports no saved original, repair the symlink by hand:
  `ln -sf /bin/systemctl /sbin/reboot`
