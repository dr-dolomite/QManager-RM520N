---
name: mount-unit-property-readback-cannot-fail
description: systemd DERIVES After=/BindsTo=/RequiresMountsFor= for mount units from mountinfo, so `systemctl show opt.mount` reports ordering as present on an untouched device — a verification that passes with no change applied
metadata:
  type: reference
---

`systemctl show` on a **mount** unit is not evidence that anything was written.
systemd synthesizes `After=`, `BindsTo=` and `RequiresMountsFor=` for mount units
out of `/proc/self/mountinfo` *after the mount exists*, so those properties read as
correct on a completely unmodified device.

**Why:** two failure modes at once. The readback passes when no change was applied,
and it passes a write that silently failed. It also answers a question about the
running system, not about the boot job transaction — the edges it reports were
absent at the only moment they mattered. This is what let F11's "ordering against
`opt.mount` is inert" diagnosis survive inspection for months.

**How to apply:** when documenting or verifying a change to a mount unit (or any
unit whose properties systemd derives), assert on the **fragment bytes on disk**,
never on a property readback. The inverse holds for a hand-written `.service`:
there a byte check misses a directive placed in the wrong `[Section]`, and only the
parsed readback catches it (`_verify_dropbear_unit`, F10 / `7c139e4`). Pick per
unit; there is no universally right answer, and a doc that recommends one pattern
globally is wrong. Both cases are written up in
`docs/reference/platform-matrix.md` under F10 and F11.
