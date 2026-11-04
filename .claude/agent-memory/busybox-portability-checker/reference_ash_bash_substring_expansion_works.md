---
name: reference_ash_bash_substring_expansion_works
description: "BusyBox ash on both RM520N-GL and RG501Q-EU supports bash-style ${var:offset:length} substring expansion under the actual /bin/sh — not a portability bug in a #!/bin/sh script"
type: reference
---

Confirmed live 2026-08-30 on both devices (RM520N-GL BusyBox 1.31.1 via
`/bin/busybox.nosuid`, RG501Q-EU BusyBox 1.29.3 via `/usr/lib/busybox/bin/sh`):

```
sh -c 'h=7f454c4601020100000001002800; echo "${h:0:8}"'   # → 7f454c46 on both
sh -c 'h=7f454c4601020100000001002800; echo "${h:8:2}"'   # → 01 on both
```

Both BusyBox ash builds here are compiled with `CONFIG_ASH_BASH_COMPAT`, so
`${var:offset:length}` — normally flagged as a bashism — actually works under
the real resolved `/bin/sh` on this platform. Found while auditing
`_dpi_is_arm32()` in `scripts/usr/bin/qmanager_dpi_install` (uses
`${h:0:8}`/`${h:8:2}`/`${h:36:4}` under a `#!/bin/sh` shebang) — this is NOT a
defect, verified rather than flagged on sight.

**Caveat**: this confirms availability, not universality — do not extend this
to other bash parameter-expansion forms (`${var,,}`, `${var^^}`, array
subscripts, etc.) without testing those specifically; `ASH_BASH_COMPAT`
enables a specific feature set, not full bash compatibility.

Related: [[reference_busybox_flock_fd_form_confirmed]], general pattern of
"verify the applet/feature on-device rather than inferring from the shebang."
