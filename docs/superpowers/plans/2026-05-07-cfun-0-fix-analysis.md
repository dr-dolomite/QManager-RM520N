# CFUN-0 Fix — Analysis

Source: `simpleadmin-source/RMxxx_rgmii_toolkit.sh` lines 658–707, README line 18, `at-list.md` lines 72/80.

## What CFUN means

`AT+CFUN=<n>` is the 3GPP "phone functionality" command. The relevant states for Quectel modems:

| Value | State | Effect |
|-------|-------|--------|
| `0` | Minimum functionality | RF off, SIM disabled — modem is "asleep" / disconnected from cellular |
| `1` | Full functionality | RF on, SIM active — normal online operation |
| `4` | Airplane mode | RF off, SIM still readable |
| `1,1` | Full + reset | Soft modem reboot |

So a modem stuck at `CFUN=0` is powered up but has its radio shut off. From the user's perspective the modem appears "dead": no signal, no registration, no data — but it is otherwise running.

## The bug being worked around

Some Quectel modems (the README says "certain modems that don't start in CFUN=1 mode") boot into `CFUN=0` instead of `CFUN=1`. The exact cause is firmware-specific — speculation in the community points to:

- Stale NV state from a previous `AT+CFUN=0` issued before reboot (e.g. by a profile/APN change script that didn't re-issue `CFUN=1`).
- A firmware quirk on some RM5xx units where the boot init sequence races and the radio never comes up.

Whatever the root cause, the symptom is consistent: after reboot, the modem is online (CGI/SSH respond, AT serial works) but the cellular radio is off.

## How SimpleAdmin's fix works

A two-file install, idempotent (the menu offers uninstall if already present):

### 1. The script — `/usrdata/cfun_fix.sh`

```sh
#!/bin/sh
/bin/echo -e 'AT+CFUN=1 \r' > /dev/smd7
```

That's the entire fix. It writes a single AT command to SMD channel 7 (the AT command port on RGMII-toolkit platforms). `\r` is the AT-line terminator. Output is not read back — it is fire-and-forget.

If the modem already booted at `CFUN=1`, this is a no-op (firmware accepts the redundant command and returns OK). If it booted at `CFUN=0`, this flips the radio on.

### 2. The systemd unit — `/lib/systemd/system/cfunfix.service`

```ini
[Unit]
Description=CFUN Fix Service
After=network.target

[Service]
Type=oneshot
ExecStart=/usrdata/cfun_fix.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

Key choices:

- **`Type=oneshot` + `RemainAfterExit=yes`** — runs once at boot, then stays "active" so systemd doesn't try to restart it.
- **`After=network.target`** — waits until the network stack is up. (Not strictly necessary since `/dev/smd7` isn't network-dependent, but harmless.)
- **Enabled via direct symlink** into `multi-user.target.wants/` (line 702), not `systemctl enable`. This matches the platform-wide pattern noted in `CLAUDE.md` ("`systemctl enable` does not work").
- **Read-only rootfs handling** — installer brackets the writes with `mount -o remount,rw /` then `mount -o remount,ro /` (lines 662, 704).

### Uninstall path

Stops the service, removes the wants/ symlink, deletes the unit, deletes the script, reloads systemd. Clean and complete.

## Relationship to RM520N-GL / QManager

This fix targets the RGMII toolkit family (RM502/RM520/RM521 etc.) using the SMD device path `/dev/smd7`. On QManager / RM520N-GL the AT transport is `/dev/smd11` via `atcli_smd11`, not `/dev/smd7`. So if this fix were ever ported to QManager, the device path would change to `/dev/smd11` and the install path would follow QManager's own conventions:

- Direct symlink into `multi-user.target.wants/` (already done here — same pattern).
- Stripping `\r` from the unit file post-copy (Windows line-ending safety).
- Using `qcmd` or `atcli_smd11` instead of raw `echo > /dev/smd11` to honor the `/tmp/qmanager_at.lock` flock and avoid colliding with the poller.
- Possibly running it as `ExecStartPre` on the poller service rather than its own unit.

## Simple explanation

Some Quectel modems boot with their cellular radio switched OFF (a state called "CFUN=0"). The modem is alive, the OS works, but there's no signal. The fix is one shell line that writes `AT+CFUN=1` to the modem's command port at every boot — that turns the radio back on. It's wrapped in a tiny systemd service so it runs automatically on startup. If the modem already booted normally, the command does nothing harmful. If the modem booted broken, this saves you from doing it by hand every time.
