---
name: rg501q-factory-reset-disables-adb
description: A factory reset of the RG501Q-EU reverts usbcfg to PID 0x0800, which exposes NO ADB interface — the device looks "gone" to adb while still fully enumerated and answering AT
metadata:
  type: reference
---

Measured 2026-08-25 on RG501Q-EU serial `b7e3d6f1`.

After the user factory-reset the device, `adb devices` returned an empty list and
`adb -s b7e3d6f1 shell` failed with `device 'b7e3d6f1' not found`. **The device
was not gone.** It had re-enumerated under a different USB composition:

| | before reset | after reset |
|---|---|---|
| USB PID | `0x0801` | `0x0800` |
| `MI_06 ADB Interface` | present | **absent** |

`AT+QCFG="usbcfg"` reads `+QCFG: "usbcfg",0x2C7C,0x0800,1,1,1,1,1,0,0`.

**Why this bites:** the RG501Q-EU has **no SSH** (never installed — no
ssh/sshd/dropbear in its stock image), so adb was the *only* shell transport.
Losing adb means losing all shell access, which makes an on-device filesystem
census impossible and blocks any `adb push` staging.

**How to apply:**
- Never conclude the RG501Q is disconnected from an empty `adb devices` alone.
  Check `Get-PnpDevice -Status OK | ? FriendlyName -match 'Quectel'` first — if a
  composite with that serial is `OK`, the device is attached and the USB
  composition changed.
- Identity is still readable over the host's Quectel AT COM port with zero shell
  access — see [[at_probe_over_host_com_port]].
- Restoring adb requires an `AT+QCFG="usbcfg",...` **write**, which is a
  configuration change. Do not issue it under a read-only brief; escalate and
  let the user decide, since it also re-enumerates the USB device.
