---
name: at-probe-over-host-com-port
description: When SSH and adb are both dead, read modem identity via the Quectel AT COM port the Windows host already enumerates — plus how to map a COM port back to a physical device serial
metadata:
  type: reference
---

Both test modems expose a **Quectel USB AT Port** as a COM port on the Windows
host. This is a *third* transport, independent of SSH (RM520N-GL) and adb
(RG501Q-EU), and it survives situations that kill both — including a factory
reset that disables adb.

**Why it matters:** a "device unreachable" conclusion from SSH+adb alone is
premature. The AT port answers even when the device has no shell access at all.

## Mapping a COM port to a physical device

`[System.IO.Ports.SerialPort]::GetPortNames()` lists ports but not which modem
owns them. Resolve it via the PnP parent — the parent InstanceId carries the
USB **serial**, which is the same string adb uses as its device serial:

```powershell
Get-PnpDevice -Status OK | Where-Object { $_.FriendlyName -match 'Quectel' } |
  Select-Object Class, FriendlyName, InstanceId
# then, for the AT port's InstanceId:
(Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_Parent').Data
# -> USB\VID_2C7C&PID_0800\b7e3d6f1   <- serial b7e3d6f1
```

`Get-PnpDevice` with **no** `-Status OK` filter returns stale registry entries
for devices that are *not currently attached* (they show `Status Unknown`).
Always filter to `-Status OK` before claiming a device is present. Comparing the
stale entry against the live one is itself useful — it shows what the USB
composition looked like *before* a change.

## Read-only probe pattern

```powershell
$sp = New-Object System.IO.Ports.SerialPort 'COM24',115200,'None',8,'One'
$sp.ReadTimeout = 4000
$sp.Open()
$sp.DiscardInBuffer(); $sp.Write("ATI`r")
Start-Sleep -Milliseconds 900
$buf=''; while ($sp.BytesToRead -gt 0) { $buf += $sp.ReadExisting(); Start-Sleep -Milliseconds 150 }
$sp.Close()
```

The port echoes the command back before the response, so strip the first line.
Keep to query forms only (`ATI`, `AT+CGMM`, `AT+CGSN`, `AT+QCFG="usbcfg"` with no
value). This port is a *direct* modem channel — it does **not** go through
QManager's `flock` on `/tmp/qmanager_at.lock`, so on a device where the poller is
running you are issuing AT traffic outside the mutex. Prefer it when the device
has no shell; prefer `qcmd` when it does.

Related: [[posh_ssh_connection_recipe]], [[rg501q_factory_reset_disables_adb]]
